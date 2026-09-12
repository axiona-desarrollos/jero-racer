// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.

#include "Telemetry/HRVehicleAudioComponent.h"
#include "Components/AudioComponent.h"
#include "Kismet/GameplayStatics.h"
#include "GameFramework/Actor.h"

#if HR_WITH_FMOD
#include "FMODBlueprintStatics.h"
#include "FMODAudioComponent.h"
#endif

UHRVehicleAudioComponent::UHRVehicleAudioComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	// Despues del pawn (TG_PostPhysics) para leer la telemetria del frame ya
	// resuelta, no la del frame anterior.
	PrimaryComponentTick.TickGroup = TG_PostPhysics;
	bAutoActivate = true;
}

void UHRVehicleAudioComponent::BeginPlay()
{
	Super::BeginPlay();

	Provider = Cast<IHRTelemetryProvider>(GetOwner());
	if (!Provider)
	{
		UE_LOG(LogTemp, Warning,
			TEXT("[HighwayRacer] %s: el owner no implementa IHRTelemetryProvider. "
			     "El audio del vehiculo quedara mudo."),
			*GetNameSafe(GetOwner()));
		SetComponentTickEnabled(false);
		return;
	}

	EnsureAudioComponents();
	bInitialised = true;
}

void UHRVehicleAudioComponent::EnsureAudioComponents()
{
	AActor* Owner = GetOwner();
	if (!Owner) { return; }

	auto Spawn = [this, Owner](USoundBase* Sound, const TCHAR* Name) -> UAudioComponent*
	{
		if (!Sound) { return nullptr; }
		UAudioComponent* AC = NewObject<UAudioComponent>(Owner, UAudioComponent::StaticClass(), FName(Name));
		AC->SetSound(Sound);
		AC->bAutoActivate  = false;
		AC->bAllowSpatialization = true;
		// El loop del motor no debe reiniciarse nunca: se atenua, no se para.
		AC->bStopWhenOwnerDestroyed = true;
		AC->SetupAttachment(this);
		AC->RegisterComponent();
		AC->Play();
		return AC;
	};

	EngineAudio = Spawn(EngineSound, TEXT("HR_EngineAudio"));
	TyreAudio   = Spawn(TyreSound,   TEXT("HR_TyreAudio"));
	WindAudio   = Spawn(WindSound,   TEXT("HR_WindAudio"));

#if HR_WITH_FMOD
	if (Backend == EHRAudioBackend::FMOD && !FMODEventPath.IsEmpty())
	{
		// Se deja al integrador: UFMODBlueprintStatics::PlayEventAttached(...)
		// y guardar el UFMODAudioComponent resultante. La forma de los datos
		// (SmoothedRPM/Load/Slip) es identica; solo cambia el setter.
	}
#endif
}

void UHRVehicleAudioComponent::TickComponent(float DeltaTime, ELevelTick TickType,
                                             FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	if (!bInitialised || !Provider) { return; }

	// --- reloj fijo ---------------------------------------------------------
	const float Step = 1.0f / FMath::Max(1.0f, UpdateRateHz);
	Accumulator += DeltaTime;
	if (Accumulator < Step) { return; }

	// Se consume el acumulador de una vez: si hubo un hitch no queremos
	// disparar veinte updates seguidos, queremos uno con el dt real.
	const float Elapsed = Accumulator;
	Accumulator = 0.0f;

	FHRVehicleTelemetry T;
	Provider->GetVehicleTelemetry(T);

	// --- eventos discretos --------------------------------------------------
	if (T.Gear != LastGear)
	{
		OnGearChanged(T.Gear, LastGear, SmoothedLoad);
		// El corte solo tiene sentido en subida bajo carga: bajar de marcha
		// para frenar no corta inyeccion, la sube.
		if (T.Gear > LastGear && SmoothedLoad > 0.35f)
		{
			ShiftCutTimer = ShiftCutSeconds;
		}
		LastGear = T.Gear;
	}

	if (T.bOnRevLimiter && !bWasOnLimiter) { OnRevLimiterHit(); }
	bWasOnLimiter = T.bOnRevLimiter;

	ShiftCutTimer = FMath::Max(0.0f, ShiftCutTimer - Elapsed);

	// --- suavizado asimetrico -----------------------------------------------
	{
		const float Rate = (T.EngineRPM > SmoothedRPM) ? RPMAttackRate : RPMReleaseRate;
		SmoothedRPM = FMath::FInterpConstantTo(SmoothedRPM, T.EngineRPM, Elapsed, Rate);
	}
	{
		float TargetLoad = T.EngineLoad;
		if (ShiftCutTimer > 0.0f) { TargetLoad = 0.0f; }   // corte de inyeccion
		const float Rate = (TargetLoad > SmoothedLoad) ? LoadAttackRate : LoadReleaseRate;
		SmoothedLoad = FMath::FInterpConstantTo(SmoothedLoad, TargetLoad, Elapsed, Rate);
	}
	{
		// El derrape ataca rapido y suelta lento: asi el chirrido no parpadea
		// cuando el neumatico entra y sale del umbral.
		const float TargetSlip = FMath::Max(T.RearSlipRatio, T.FrontSlipRatio);
		const float Rate = (TargetSlip > SmoothedSlip) ? 6.0f : 1.8f;
		SmoothedSlip = FMath::FInterpConstantTo(SmoothedSlip, TargetSlip, Elapsed, Rate);
	}

	PushParameters(T);
}

void UHRVehicleAudioComponent::PushFloat(UAudioComponent* Target, FName Name, float Value)
{
	if (Target && !Name.IsNone())
	{
		Target->SetFloatParameter(Name, Value);
	}
}

void UHRVehicleAudioComponent::PushParameters(const FHRVehicleTelemetry& T)
{
	const float MaxRPM = FMath::Max(1.0f, T.MaxRPM);

	switch (Backend)
	{
	case EHRAudioBackend::MetaSounds:
	{
		PushFloat(EngineAudio, ParameterNames.RPM,           SmoothedRPM);
		PushFloat(EngineAudio, ParameterNames.NormalizedRPM, SmoothedRPM / MaxRPM);
		PushFloat(EngineAudio, ParameterNames.Load,          SmoothedLoad);
		PushFloat(EngineAudio, ParameterNames.EngineBraking, T.EngineBraking);
		PushFloat(EngineAudio, ParameterNames.Gear,          static_cast<float>(T.Gear));
		PushFloat(EngineAudio, ParameterNames.RevLimiter,    T.bOnRevLimiter ? 1.0f : 0.0f);

		PushFloat(TyreAudio, ParameterNames.TyreSlip, SmoothedSlip);
		PushFloat(TyreAudio, ParameterNames.SpeedKmh, T.SpeedKmh);
		if (TyreAudio)
		{
			// En el aire no hay neumatico que chirrie.
			TyreAudio->SetVolumeMultiplier(T.bAirborne ? 0.0f : FMath::Clamp(SmoothedSlip, 0.0f, 1.0f));
		}

		PushFloat(WindAudio, ParameterNames.SpeedKmh, T.SpeedKmh);
		if (WindAudio)
		{
			WindAudio->SetVolumeMultiplier(FMath::Clamp((T.SpeedKmh - 40.0f) / 220.0f, 0.0f, 1.0f));
		}
		break;
	}

	case EHRAudioBackend::FMOD:
	{
#if HR_WITH_FMOD
		// UFMODAudioComponent::SetParameter(FName, float). Misma forma de datos:
		//   FMODComp->SetParameter(ParameterNames.RPM,  SmoothedRPM);
		//   FMODComp->SetParameter(ParameterNames.Load, SmoothedLoad);
		//   FMODComp->SetParameter(ParameterNames.TyreSlip, SmoothedSlip);
#else
		// Compilado sin FMOD: se avisa una vez y se cae a MetaSounds.
		static bool bWarned = false;
		if (!bWarned)
		{
			bWarned = true;
			UE_LOG(LogTemp, Warning,
				TEXT("[HighwayRacer] Backend FMOD seleccionado pero el modulo se "
				     "compilo con HR_WITH_FMOD=0. Revisa HighwayRacer.Build.cs."));
		}
#endif
		break;
	}
	}
}
