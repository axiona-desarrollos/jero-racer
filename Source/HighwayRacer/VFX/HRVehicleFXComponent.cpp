// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.

#include "VFX/HRVehicleFXComponent.h"
#include "Components/RectLightComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "NiagaraComponent.h"
#include "NiagaraSystem.h"
#include "GameFramework/Actor.h"

UHRVehicleFXComponent::UHRVehicleFXComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.TickGroup = TG_PostPhysics;

	// Salida cuadruple del S650 GT. Si el esqueleto no trae sockets se usan
	// estos offsets respecto al origen del chasis.
	ExhaustFallbackOffsets = {
		FVector(-236.0f, -42.0f, 30.0f),
		FVector(-236.0f, -28.0f, 30.0f),
		FVector(-236.0f,  28.0f, 30.0f),
		FVector(-236.0f,  42.0f, 30.0f)
	};
}

void UHRVehicleFXComponent::BeginPlay()
{
	Super::BeginPlay();

	Provider = Cast<IHRTelemetryProvider>(GetOwner());
	if (!Provider)
	{
		UE_LOG(LogTemp, Warning,
			TEXT("[HighwayRacer] %s: el owner no implementa IHRTelemetryProvider. "
			     "El neon funcionara pero las llamaradas no se dispararan solas."),
			*GetNameSafe(GetOwner()));
	}

	BuildUnderglow();
	BuildExhaust();
	SetUnderglowEnabled(bUnderglowEnabled);
}

// ===========================================================================
//  NEON INFERIOR
// ===========================================================================

void UHRVehicleFXComponent::BuildUnderglow()
{
	AActor* Owner = GetOwner();
	if (!Owner) { return; }

	// Cuatro tiras: izquierda, derecha, morro, zaga.
	struct FStrip { const TCHAR* Name; FVector Loc; FRotator Rot; float W; float H; };
	const FStrip Strips[] =
	{
		{ TEXT("HR_Underglow_L"),
		  FVector(0.0f, -UnderglowSideOffsetY, UnderglowHeight),
		  FRotator(-90.0f, 0.0f, 0.0f), 360.0f, 26.0f },

		{ TEXT("HR_Underglow_R"),
		  FVector(0.0f,  UnderglowSideOffsetY, UnderglowHeight),
		  FRotator(-90.0f, 0.0f, 0.0f), 360.0f, 26.0f },

		{ TEXT("HR_Underglow_F"),
		  FVector( UnderglowFrontOffsetX, 0.0f, UnderglowHeight),
		  FRotator(-90.0f, 90.0f, 0.0f), 170.0f, 26.0f },

		{ TEXT("HR_Underglow_B"),
		  FVector(-UnderglowFrontOffsetX, 0.0f, UnderglowHeight),
		  FRotator(-90.0f, 90.0f, 0.0f), 170.0f, 26.0f },
	};

	for (const FStrip& S : Strips)
	{
		URectLightComponent* Light =
			NewObject<URectLightComponent>(Owner, URectLightComponent::StaticClass(), FName(S.Name));
		Light->SetupAttachment(this);
		Light->SetRelativeLocationAndRotation(S.Loc, S.Rot);

		Light->SetSourceWidth(S.W);
		Light->SetSourceHeight(S.H);
		Light->SetAttenuationRadius(UnderglowAttenuation);
		Light->SetIntensity(UnderglowIntensity);
		Light->SetLightColor(UnderglowColor);

		// Decisiones de rendimiento, no de arte:
		//  - sin sombras: 4 luces con sombra bajo el coche cuestan mas que
		//    todo el trafico junto.
		//  - sin specular: el neon ilumina el asfalto, no debe crear brillos
		//    parasitos en la carroceria.
		//  - BarnDoor estrecho: recorta el derrame hacia los lados.
		Light->SetCastShadows(false);
		Light->SetVolumetricScatteringIntensity(1.4f);
		Light->bAffectsWorld = true;
		Light->SetBarnDoorAngle(72.0f);
		Light->SetBarnDoorLength(18.0f);
		Light->SpecularScale = 0.0f;

		Light->RegisterComponent();
		UnderglowLights.Add(Light);
	}
}

void UHRVehicleFXComponent::SetUnderglowEnabled(bool bEnabled)
{
	bUnderglowEnabled = bEnabled;
	for (URectLightComponent* L : UnderglowLights)
	{
		if (L) { L->SetVisibility(bEnabled); }
	}
}

void UHRVehicleFXComponent::SetUnderglowColor(FLinearColor NewColor)
{
	UnderglowColor = NewColor;
	for (URectLightComponent* L : UnderglowLights)
	{
		if (L) { L->SetLightColor(NewColor); }
	}
}

void UHRVehicleFXComponent::UpdateUnderglow(const FHRVehicleTelemetry& T, float DeltaTime)
{
	if (!bUnderglowEnabled || UnderglowRPMPulse <= KINDA_SMALL_NUMBER) { return; }

	// Latido ligado al regimen: sube de frecuencia con las vueltas.
	const float Phase = GetWorld() ? GetWorld()->GetTimeSeconds() * (4.0f + T.NormalizedRPM * 14.0f) : 0.0f;
	const float Pulse = 1.0f + FMath::Sin(Phase) * UnderglowRPMPulse * (0.35f + T.NormalizedRPM * 0.65f);

	for (URectLightComponent* L : UnderglowLights)
	{
		if (L) { L->SetIntensity(UnderglowIntensity * Pulse); }
	}
}

// ===========================================================================
//  ESCAPE
// ===========================================================================

void UHRVehicleFXComponent::BuildExhaust()
{
	AActor* Owner = GetOwner();
	if (!Owner || !ExhaustFlameSystem) { return; }

	USkeletalMeshComponent* Body = Owner->FindComponentByClass<USkeletalMeshComponent>();

	auto MakeEmitter = [&](const TCHAR* Name) -> UNiagaraComponent*
	{
		UNiagaraComponent* NC =
			NewObject<UNiagaraComponent>(Owner, UNiagaraComponent::StaticClass(), FName(Name));
		NC->SetAsset(ExhaustFlameSystem);
		// Los sistemas de llamarada son "burst": no deben auto-activarse ni
		// auto-destruirse; se reciclan con Activate(true) en cada disparo.
		NC->bAutoActivate = false;
		NC->SetAutoDestroy(false);
		return NC;
	};

	int32 Index = 0;
	if (Body && ExhaustSockets.Num() > 0)
	{
		for (const FName& Socket : ExhaustSockets)
		{
			if (!Body->DoesSocketExist(Socket))
			{
				UE_LOG(LogTemp, Warning,
					TEXT("[HighwayRacer] Socket de escape '%s' no existe en %s."),
					*Socket.ToString(), *GetNameSafe(Body->GetSkeletalMeshAsset()));
				continue;
			}
			UNiagaraComponent* NC = MakeEmitter(*FString::Printf(TEXT("HR_Exhaust_%d"), Index++));
			NC->SetupAttachment(Body, Socket);
			NC->RegisterComponent();
			ExhaustEmitters.Add(NC);
		}
	}

	if (ExhaustEmitters.Num() == 0)
	{
		for (const FVector& Offset : ExhaustFallbackOffsets)
		{
			UNiagaraComponent* NC = MakeEmitter(*FString::Printf(TEXT("HR_Exhaust_%d"), Index++));
			NC->SetupAttachment(this);
			NC->SetRelativeLocation(Offset);
			// Apuntando hacia atras.
			NC->SetRelativeRotation(FRotator(0.0f, 180.0f, 0.0f));
			NC->RegisterComponent();
			ExhaustEmitters.Add(NC);
		}
	}
}

void UHRVehicleFXComponent::FireExhaustFlames(float Intensity)
{
	Intensity = FMath::Clamp(Intensity, 0.0f, 1.0f);
	for (UNiagaraComponent* NC : ExhaustEmitters)
	{
		if (!NC) { continue; }
		if (!NiagaraIntensityParam.IsNone())
		{
			NC->SetVariableFloat(NiagaraIntensityParam, Intensity);
		}
		// Reset = true: reinicia el burst aunque el anterior siga vivo.
		NC->Activate(true);
	}
	CooldownTimer = FlameCooldown;
}

void UHRVehicleFXComponent::EvaluateFlameTriggers(const FHRVehicleTelemetry& T, float DeltaTime)
{
	CooldownTimer = FMath::Max(0.0f, CooldownTimer - DeltaTime);
	LiftTimer     = FMath::Max(0.0f, LiftTimer - DeltaTime);

	// --- armado: hubo carga real con el motor caliente de vueltas ----------
	if (T.ThrottleInput >= ArmThrottle && T.EngineRPM >= MinRPMForFlames)
	{
		bArmed = true;
	}

	// --- deteccion de levantada de pie -------------------------------------
	if (bArmed && T.ThrottleInput <= LiftThrottle)
	{
		LiftTimer = LiftWindowSeconds;
		bArmed    = false;   // se consume el armado; hay que volver a pisar
	}

	const bool bCoolReady = (CooldownTimer <= 0.0f);

	// --- caso 1: overrun por levantada -------------------------------------
	// Exige que el regimen este CAYENDO. Esto es lo que distingue un lift-off
	// con marcha engranada (el motor frena al coche y cae de vueltas) de
	// soltar el gas en punto muerto (el motor baja solo, mucho mas despacio).
	if (bCoolReady && LiftTimer > 0.0f &&
	    T.EngineRPM >= MinRPMForFlames &&
	    T.RPMDeltaPerSec <= -MinRPMDropRate)
	{
		const bool bOversteerOK = !bRequireOversteer ||
			(T.RearSlipRatio >= OversteerSlipThreshold && T.RearSlipRatio > T.FrontSlipRatio);

		if (bOversteerOK)
		{
			// Intensidad proporcional a lo violenta que fue la caida.
			const float Drop = FMath::Abs(T.RPMDeltaPerSec) / FMath::Max(1.0f, MinRPMDropRate * 2.5f);
			const float Intensity = FMath::Clamp(0.45f + Drop * 0.55f, 0.0f, 1.0f);

			FireExhaustFlames(Intensity);
			OnExhaustFlames(Intensity, /*bFromGearShift*/ false);
			LiftTimer = 0.0f;
			return;
		}
	}

	// --- caso 2: corte de inyeccion en subida bajo carga -------------------
	if (bFlamesOnUpshift && bCoolReady && T.Gear > LastGear && LastGear > 0 &&
	    T.ThrottleInput > 0.5f && T.EngineRPM >= MinRPMForFlames)
	{
		const float Intensity = FMath::Clamp(0.35f + T.NormalizedRPM * 0.5f, 0.0f, 1.0f);
		FireExhaustFlames(Intensity);
		OnExhaustFlames(Intensity, /*bFromGearShift*/ true);
	}
	LastGear = T.Gear;
}

// ===========================================================================

void UHRVehicleFXComponent::TickComponent(float DeltaTime, ELevelTick TickType,
                                          FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	if (!Provider) { return; }

	FHRVehicleTelemetry T;
	Provider->GetVehicleTelemetry(T);

	UpdateUnderglow(T, DeltaTime);
	EvaluateFlameTriggers(T, DeltaTime);
}
