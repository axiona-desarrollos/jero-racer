// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.

#include "Traffic/HRTrafficSubsystem.h"
#include "Components/SplineComponent.h"
#include "Components/PrimitiveComponent.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"
#include "GameFramework/Pawn.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/EngineVersionComparison.h"

// TArray cambio la firma de Pop/RemoveAtSwap en 5.5: antes bool, ahora enum.
// Este shim mantiene el modulo compilando en 5.3, 5.4 y 5.5 sin tocar el codigo.
#if UE_VERSION_NEWER_THAN(5, 4, 99)
    #define HR_NO_SHRINK EAllowShrinking::No
#else
    #define HR_NO_SHRINK false
#endif

DECLARE_STATS_GROUP(TEXT("HighwayRacer"), STATGROUP_HighwayRacer, STATCAT_Advanced);
DECLARE_CYCLE_STAT(TEXT("Traffic Tick"), STAT_HRTrafficTick, STATGROUP_HighwayRacer);

namespace
{
	constexpr float KmhToCms = 27.7778f;   // 1 km/h = 27.7778 cm/s
	constexpr float CmsToKmh = 0.036f;
}

// ===========================================================================
//  CICLO DE VIDA DEL SUBSISTEMA
// ===========================================================================

bool UHRTrafficSubsystem::ShouldCreateSubsystem(UObject* Outer) const
{
	if (!Super::ShouldCreateSubsystem(Outer)) { return false; }

	// Solo en mundos de juego: no queremos trafico en el editor, ni en los
	// mundos de preview de las miniaturas del Content Browser.
	if (const UWorld* World = Cast<UWorld>(Outer))
	{
		return World->IsGameWorld();
	}
	return false;
}

void UHRTrafficSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	bRunning = false;
}

void UHRTrafficSubsystem::Deinitialize()
{
	StopTraffic();

	// Al morir el mundo se destruyen igualmente, pero dejar el pool vacio
	// explicitamente evita referencias colgando si alguien reinicializa.
	for (TPair<TObjectPtr<UClass>, FHRPoolBucket>& Pair : Pools)
	{
		for (TObjectPtr<AActor>& Actor : Pair.Value.Free)
		{
			if (IsValid(Actor)) { Actor->Destroy(); }
		}
		Pair.Value.Free.Reset();
	}
	Pools.Empty();

	Super::Deinitialize();
}

TStatId UHRTrafficSubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UHRTrafficSubsystem, STATGROUP_Tickables);
}

// ===========================================================================
//  API PUBLICA
// ===========================================================================

void UHRTrafficSubsystem::StartTraffic(UHRTrafficProfile* Profile, AActor* FocusActor, const FTransform& RoadOrigin)
{
	if (!Profile || Profile->Lanes.Num() == 0 || Profile->Vehicles.Num() == 0)
	{
		UE_LOG(LogTemp, Error, TEXT("[HighwayRacer] Perfil de trafico invalido o vacio."));
		return;
	}

	StopTraffic();

	ActiveProfile  = Profile;
	Focus          = FocusActor ? FocusActor : UGameplayStatics::GetPlayerPawn(GetWorld(), 0);
	RoadTransform  = RoadOrigin;
	SpawnAccumulator = 0.0f;

	// Warmup: se paga aqui, en carga, no durante la partida.
	for (const FHRTrafficEntry& Entry : Profile->Vehicles)
	{
		if (Entry.VehicleClass && Entry.PoolWarmup > 0)
		{
			WarmPool(Entry.VehicleClass, Entry.PoolWarmup);
		}
	}

	bRunning = true;

	UE_LOG(LogTemp, Log, TEXT("[HighwayRacer] Trafico arrancado. Pool pre-creado: %d actores."),
		GetPooledCount());
}

void UHRTrafficSubsystem::StopTraffic()
{
	for (FHRTrafficAgent& Agent : Agents)
	{
		ReleaseToPool(Agent.Actor);
	}
	Agents.Reset();
	bRunning = false;
}

void UHRTrafficSubsystem::SetDensityScale(float Scale01)
{
	DensityScale = FMath::Clamp(Scale01, 0.0f, 1.0f);
}

void UHRTrafficSubsystem::SetRoadSpline(USplineComponent* Spline)
{
	RoadSpline = Spline;
}

int32 UHRTrafficSubsystem::GetPooledCount() const
{
	int32 Count = 0;
	for (const TPair<TObjectPtr<UClass>, FHRPoolBucket>& Pair : Pools)
	{
		Count += Pair.Value.Free.Num();
	}
	return Count;
}

// ===========================================================================
//  POOL
// ===========================================================================

void UHRTrafficSubsystem::SetActorPooledState(AActor* Actor, bool bPooled) const
{
	if (!IsValid(Actor)) { return; }

	Actor->SetActorHiddenInGame(bPooled);
	Actor->SetActorEnableCollision(!bPooled);
	Actor->SetActorTickEnabled(false);   // el trafico NUNCA tickea por su cuenta

	// Los componentes de render tambien: ocultar el actor no basta para que
	// dejen de costar en el hilo de render en todos los casos.
	Actor->ForEachComponent<UPrimitiveComponent>(false, [bPooled](UPrimitiveComponent* Prim)
	{
		Prim->SetComponentTickEnabled(false);
		Prim->SetVisibility(!bPooled, true);
	});

	if (bPooled)
	{
		// Fuera de la vista del jugador y de cualquier consulta espacial.
		Actor->SetActorLocation(FVector(0.0f, 0.0f, -100000.0f));
	}
}

void UHRTrafficSubsystem::WarmPool(TSubclassOf<AActor> Class, int32 Count)
{
	UWorld* World = GetWorld();
	if (!World || !Class) { return; }

	FHRPoolBucket& Bucket = Pools.FindOrAdd(Class.Get());
	Bucket.Free.Reserve(Bucket.Free.Num() + Count);

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Params.ObjectFlags |= RF_Transient;   // el trafico no se guarda en el nivel

	for (int32 i = 0; i < Count; ++i)
	{
		AActor* Actor = World->SpawnActor<AActor>(Class, FVector(0.0f, 0.0f, -100000.0f), FRotator::ZeroRotator, Params);
		if (!Actor) { break; }

		++TotalCreated;
		SetActorPooledState(Actor, true);

		if (Actor->Implements<UHRPoolable>())
		{
			IHRPoolable::Execute_OnReturnedToPool(Actor);
		}
		Bucket.Free.Add(Actor);
	}
}

AActor* UHRTrafficSubsystem::AcquireFromPool(TSubclassOf<AActor> Class)
{
	if (!Class) { return nullptr; }

	FHRPoolBucket& Bucket = Pools.FindOrAdd(Class.Get());

	AActor* Actor = nullptr;
	while (Bucket.Free.Num() > 0 && !IsValid(Actor))
	{
		Actor = Bucket.Free.Pop(HR_NO_SHRINK);
	}

	if (!IsValid(Actor))
	{
		// El pool se quedo corto. Se crea uno mas y se avisa: si esto aparece
		// en el log durante el juego, el PoolWarmup del perfil esta mal
		// dimensionado y el jugador va a notar el hitch.
		UWorld* World = GetWorld();
		if (!World) { return nullptr; }

		FActorSpawnParameters Params;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		Params.ObjectFlags |= RF_Transient;
		Actor = World->SpawnActor<AActor>(Class, FVector(0.0f, 0.0f, -100000.0f), FRotator::ZeroRotator, Params);
		if (!Actor) { return nullptr; }

		++TotalCreated;
		UE_LOG(LogTemp, Warning,
			TEXT("[HighwayRacer] Pool agotado para %s: se creo en caliente (total %d). "
			     "Sube PoolWarmup en el perfil."),
			*Class->GetName(), TotalCreated);
	}

	SetActorPooledState(Actor, false);
	if (Actor->Implements<UHRPoolable>())
	{
		IHRPoolable::Execute_OnAcquiredFromPool(Actor);
	}
	return Actor;
}

void UHRTrafficSubsystem::ReleaseToPool(AActor* Actor)
{
	if (!IsValid(Actor)) { return; }

	if (Actor->Implements<UHRPoolable>())
	{
		IHRPoolable::Execute_OnReturnedToPool(Actor);
	}
	SetActorPooledState(Actor, true);

	FHRPoolBucket& Bucket = Pools.FindOrAdd(Actor->GetClass());
	Bucket.Free.Add(Actor);
}

// ===========================================================================
//  GEOMETRIA DE LA VIA
// ===========================================================================

FTransform UHRTrafficSubsystem::EvaluateRoad(float Distance, int32 LaneIndex) const
{
	const FHRTrafficLane& Lane = ActiveProfile->Lanes[
		FMath::Clamp(LaneIndex, 0, ActiveProfile->Lanes.Num() - 1)];

	FVector  Location;
	FRotator Rotation;

	if (const USplineComponent* Spline = RoadSpline.Get())
	{
		// Autopista curva: la distancia es longitud de arco sobre el spline.
		const float Length = Spline->GetSplineLength();
		const float Key    = Length > 0.0f ? FMath::Fmod(Distance, Length) : 0.0f;

		Location = Spline->GetLocationAtDistanceAlongSpline(Key, ESplineCoordinateSpace::World);
		Rotation = Spline->GetRotationAtDistanceAlongSpline(Key, ESplineCoordinateSpace::World);
		Location += Rotation.RotateVector(FVector(0.0f, Lane.LateralOffset, 0.0f));
	}
	else
	{
		// Autopista recta: el caso barato y el habitual en un tramo generado.
		Rotation = RoadTransform.Rotator();
		Location = RoadTransform.GetLocation()
			+ RoadTransform.GetUnitAxis(EAxis::X) * Distance
			+ RoadTransform.GetUnitAxis(EAxis::Y) * Lane.LateralOffset;
	}

	// Los carriles en sentido contrario miran al reves.
	if (Lane.Direction < 0)
	{
		Rotation.Yaw += 180.0f;
	}
	return FTransform(Rotation, Location);
}

float UHRTrafficSubsystem::ProjectOntoRoad(const FVector& WorldLocation) const
{
	if (const USplineComponent* Spline = RoadSpline.Get())
	{
		const float Key = Spline->FindInputKeyClosestToWorldLocation(WorldLocation);
		return Spline->GetDistanceAlongSplineAtSplineInputKey(Key);
	}
	const FVector Delta = WorldLocation - RoadTransform.GetLocation();
	return FVector::DotProduct(Delta, RoadTransform.GetUnitAxis(EAxis::X));
}

// ===========================================================================
//  TICK
// ===========================================================================

void UHRTrafficSubsystem::Tick(float DeltaTime)
{
	SCOPE_CYCLE_COUNTER(STAT_HRTrafficTick);
	Super::Tick(DeltaTime);

	if (!bRunning || !ActiveProfile) { return; }

	AActor* FocusActor = Focus.Get();
	if (!FocusActor)
	{
		// El jugador pudo morir o respawnear: se reengancha solo.
		FocusActor = UGameplayStatics::GetPlayerPawn(GetWorld(), 0);
		Focus = FocusActor;
		if (!FocusActor) { return; }
	}

	FocusDistance = ProjectOntoRoad(FocusActor->GetActorLocation());

	TickAgents(DeltaTime);
	RecycleOutOfRange();
	TrySpawn(DeltaTime);
}

void UHRTrafficSubsystem::TickAgents(float DeltaTime)
{
	const float Follow      = ActiveProfile->FollowDistance;
	const float AccelCms    = ActiveProfile->TrafficAccelKmhPerSec * KmhToCms;
	const float BrakeCms    = ActiveProfile->TrafficBrakeKmhPerSec * KmhToCms;

	// Un solo bucle sobre datos contiguos. Ordenar por carril+distancia haria
	// el seguimiento O(n) en vez de O(n^2), pero con <100 agentes el sort
	// cuesta mas que la comparacion directa; si subes el limite, ordena.
	for (FHRTrafficAgent& Agent : Agents)
	{
		if (!IsValid(Agent.Actor)) { continue; }

		// --- seguimiento del vehiculo de delante ---------------------------
		float GapAhead = TNumericLimits<float>::Max();
		for (const FHRTrafficAgent& Other : Agents)
		{
			if (&Other == &Agent || Other.LaneIndex != Agent.LaneIndex) { continue; }
			const float Gap = Other.Distance - Agent.Distance - Other.HalfLength - Agent.HalfLength;
			if (Gap > 0.0f && Gap < GapAhead) { GapAhead = Gap; }
		}

		// Objetivo: si hay alguien cerca, ajustar a su hueco; si no, crucero.
		float TargetSpeed = Agent.DesiredSpeedCms;
		if (GapAhead < Follow)
		{
			TargetSpeed = Agent.DesiredSpeedCms * FMath::Clamp(GapAhead / Follow, 0.0f, 1.0f);
		}

		const float Rate = (TargetSpeed > Agent.SpeedCms) ? AccelCms : BrakeCms;
		Agent.SpeedCms = FMath::FInterpConstantTo(Agent.SpeedCms, TargetSpeed, DeltaTime, Rate);

		// --- integracion y transformada ------------------------------------
		const FHRTrafficLane& Lane = ActiveProfile->Lanes[Agent.LaneIndex];
		Agent.Distance += Agent.SpeedCms * DeltaTime * static_cast<float>(Lane.Direction);

		const FTransform Xf = EvaluateRoad(Agent.Distance, Agent.LaneIndex);
		// Teletransporte: el trafico es cinematico, no queremos que el motor
		// de fisica intente resolver el desplazamiento como un barrido.
		Agent.Actor->SetActorTransform(Xf, /*bSweep*/ false, nullptr, ETeleportType::TeleportPhysics);
	}
}

void UHRTrafficSubsystem::RecycleOutOfRange()
{
	const float Behind = ActiveProfile->DespawnBehindDistance;
	const float Ahead  = ActiveProfile->DespawnAheadDistance;

	for (int32 i = Agents.Num() - 1; i >= 0; --i)
	{
		const FHRTrafficAgent& Agent = Agents[i];
		const float Relative = Agent.Distance - FocusDistance;

		if (!IsValid(Agent.Actor) || Relative < -Behind || Relative > Ahead)
		{
			ReleaseToPool(Agent.Actor);
			Agents.RemoveAtSwap(i, HR_NO_SHRINK);   // el orden no importa
		}
	}
}

void UHRTrafficSubsystem::TrySpawn(float DeltaTime)
{
	const int32 MaxActive = FMath::RoundToInt(ActiveProfile->MaxActiveVehicles * DensityScale);
	if (Agents.Num() >= MaxActive) { return; }

	// El ritmo de intentos reparte el coste: no se generan 40 coches en el
	// frame en que el jugador sale de un tunel.
	SpawnAccumulator += DeltaTime * ActiveProfile->SpawnAttemptsPerSecond;
	int32 Attempts = FMath::FloorToInt(SpawnAccumulator);
	SpawnAccumulator -= Attempts;
	Attempts = FMath::Min(Attempts, 4);   // tope duro por frame

	for (int32 a = 0; a < Attempts && Agents.Num() < MaxActive; ++a)
	{
		const int32 LaneIndex  = PickLaneWeighted();
		const int32 EntryIndex = PickEntryWeighted();
		if (LaneIndex < 0 || EntryIndex < 0) { return; }

		const FHRTrafficLane&  Lane  = ActiveProfile->Lanes[LaneIndex];
		const FHRTrafficEntry& Entry = ActiveProfile->Vehicles[EntryIndex];
		if (!Entry.VehicleClass) { continue; }

		// Sentido contrario: aparece por delante y viene de frente. Mismo
		// sentido: aparece por delante y se aleja, o por detras y adelanta.
		float SpawnDist;
		if (Lane.Direction > 0)
		{
			SpawnDist = FocusDistance + FMath::FRandRange(ActiveProfile->SpawnAheadDistance * 0.45f,
			                                             ActiveProfile->SpawnAheadDistance);
		}
		else
		{
			SpawnDist = FocusDistance + ActiveProfile->SpawnAheadDistance
				+ FMath::FRandRange(0.0f, ActiveProfile->SpawnAheadDistance * 0.5f);
		}

		if (!IsGapFree(LaneIndex, SpawnDist, Entry.HalfLength)) { continue; }

		AActor* Actor = AcquireFromPool(Entry.VehicleClass);
		if (!Actor) { continue; }

		FHRTrafficAgent Agent;
		Agent.Actor      = Actor;
		Agent.LaneIndex  = LaneIndex;
		Agent.EntryIndex = EntryIndex;
		Agent.Distance   = SpawnDist;
		Agent.HalfLength = Entry.HalfLength;
		Agent.DesiredSpeedCms = FMath::FRandRange(Lane.MinSpeedKmh, Lane.MaxSpeedKmh) * KmhToCms;
		// Nace ya a velocidad de crucero: si naciera parado, el jugador veria
		// coches acelerando desde cero en mitad de la autopista.
		Agent.SpeedCms   = Agent.DesiredSpeedCms;

		Actor->SetActorTransform(EvaluateRoad(Agent.Distance, Agent.LaneIndex),
		                         false, nullptr, ETeleportType::TeleportPhysics);
		Agents.Add(Agent);
	}
}

// ===========================================================================
//  AYUDAS
// ===========================================================================

int32 UHRTrafficSubsystem::PickLaneWeighted() const
{
	float Total = 0.0f;
	for (const FHRTrafficLane& Lane : ActiveProfile->Lanes) { Total += FMath::Max(0.0f, Lane.SpawnWeight); }
	if (Total <= 0.0f) { return ActiveProfile->Lanes.Num() > 0 ? 0 : -1; }

	float Roll = FMath::FRandRange(0.0f, Total);
	for (int32 i = 0; i < ActiveProfile->Lanes.Num(); ++i)
	{
		Roll -= FMath::Max(0.0f, ActiveProfile->Lanes[i].SpawnWeight);
		if (Roll <= 0.0f) { return i; }
	}
	return ActiveProfile->Lanes.Num() - 1;
}

int32 UHRTrafficSubsystem::PickEntryWeighted() const
{
	float Total = 0.0f;
	for (const FHRTrafficEntry& E : ActiveProfile->Vehicles) { Total += FMath::Max(0.0f, E.Weight); }
	if (Total <= 0.0f) { return ActiveProfile->Vehicles.Num() > 0 ? 0 : -1; }

	float Roll = FMath::FRandRange(0.0f, Total);
	for (int32 i = 0; i < ActiveProfile->Vehicles.Num(); ++i)
	{
		Roll -= FMath::Max(0.0f, ActiveProfile->Vehicles[i].Weight);
		if (Roll <= 0.0f) { return i; }
	}
	return ActiveProfile->Vehicles.Num() - 1;
}

bool UHRTrafficSubsystem::IsGapFree(int32 LaneIndex, float Distance, float HalfLength) const
{
	const float Required = ActiveProfile->MinGap + HalfLength;
	for (const FHRTrafficAgent& Agent : Agents)
	{
		if (Agent.LaneIndex != LaneIndex) { continue; }
		if (FMath::Abs(Agent.Distance - Distance) < (Required + Agent.HalfLength))
		{
			return false;
		}
	}
	return true;
}
