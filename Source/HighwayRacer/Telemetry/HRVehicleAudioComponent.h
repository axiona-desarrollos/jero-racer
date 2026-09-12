// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.
//
// TAREA 2 - AUDIO Y TELEMETRIA
//
// Traduce FHRVehicleTelemetry a parametros de audio. El motor de sonido es
// intercambiable: MetaSounds por defecto, FMOD detras de HR_WITH_FMOD.
//
// DOS DECISIONES QUE IMPORTAN:
//
// 1. Los parametros se suavizan AQUI, no en el grafo de audio. La telemetria
//    fisica tiene ruido de cuantizacion del solver; empujarla cruda a un
//    crossfade de samples produce zipper noise audible. El suavizado es
//    asimetrico: subir de vueltas es instantaneo (ataque), bajar es lento
//    (release), igual que la inercia real del ciguenal.
//
// 2. El muestreo va a frecuencia FIJA (UpdateRateHz), desacoplado del frame
//    rate. A 144 fps no tiene sentido empujar 144 veces por segundo un
//    parametro que el audio interpola de todas formas, y a 30 fps queremos
//    la misma curva. Sin esto, el motor suena distinto segun el hardware.

#pragma once

#include "CoreMinimal.h"
#include "Components/SceneComponent.h"
#include "Telemetry/HRVehicleTelemetry.h"
#include "HRVehicleAudioComponent.generated.h"

class UAudioComponent;
class USoundBase;

UENUM(BlueprintType)
enum class EHRAudioBackend : uint8
{
	/** UAudioComponent + MetaSounds (nativo de UE5). */
	MetaSounds UMETA(DisplayName = "MetaSounds"),
	/** FMOD Studio. Requiere HR_WITH_FMOD=1 en Build.cs. */
	FMOD       UMETA(DisplayName = "FMOD Studio"),
};

/** Nombres de los parametros del grafo. Configurables para no atar el C++ al asset. */
USTRUCT(BlueprintType)
struct HIGHWAYRACER_API FHRAudioParameterNames
{
	GENERATED_BODY()

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio")
	FName RPM = FName("RPM");

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio")
	FName NormalizedRPM = FName("RPMNorm");

	/** Mezcla on-throttle / off-throttle. Es EL parametro de un motor creible. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio")
	FName Load = FName("Load");

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio")
	FName EngineBraking = FName("Overrun");

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio")
	FName Gear = FName("Gear");

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio")
	FName SpeedKmh = FName("Speed");

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio")
	FName TyreSlip = FName("TyreSlip");

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio")
	FName RevLimiter = FName("Limiter");
};

UCLASS(ClassGroup = "HighwayRacer", meta = (BlueprintSpawnableComponent))
class HIGHWAYRACER_API UHRVehicleAudioComponent : public USceneComponent
{
	GENERATED_BODY()

public:
	UHRVehicleAudioComponent();

	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType,
	                           FActorComponentTickFunction* ThisTickFunction) override;

	/** Ultimo juego de valores enviado al audio. Para depurar y para el HUD. */
	UFUNCTION(BlueprintPure, Category = "HighwayRacer|Audio")
	float GetSmoothedRPM() const { return SmoothedRPM; }

	UFUNCTION(BlueprintPure, Category = "HighwayRacer|Audio")
	float GetSmoothedLoad() const { return SmoothedLoad; }

	/** Gancho para disenadores: se llama en cada cambio de marcha detectado. */
	UFUNCTION(BlueprintImplementableEvent, Category = "HighwayRacer|Audio")
	void OnGearChanged(int32 NewGear, int32 OldGear, float LoadAtShift);

	/** Se llama una vez al entrar en el limitador. */
	UFUNCTION(BlueprintImplementableEvent, Category = "HighwayRacer|Audio")
	void OnRevLimiterHit();

protected:
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio")
	EHRAudioBackend Backend = EHRAudioBackend::MetaSounds;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio")
	FHRAudioParameterNames ParameterNames;

	/** MetaSound (o Sound Cue) del motor. Debe ser un loop. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio|Assets")
	TObjectPtr<USoundBase> EngineSound;

	/** Loop de derrape de neumatico. Su volumen lo gobierna TyreSlip. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio|Assets")
	TObjectPtr<USoundBase> TyreSound;

	/** Loop de viento. Volumen gobernado por la velocidad. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio|Assets")
	TObjectPtr<USoundBase> WindSound;

	/** Nombre del evento FMOD, si Backend == FMOD. Ej: "event:/Vehicles/V8". */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio|FMOD")
	FString FMODEventPath;

	/** Frecuencia de empuje de parametros. 60 Hz basta y sobra. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio|Tuning",
		meta = (ClampMin = "15.0", ClampMax = "240.0"))
	float UpdateRateHz = 60.0f;

	/** RPM/s de subida. Alto = el motor responde seco al acelerador. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio|Tuning")
	float RPMAttackRate = 9000.0f;

	/** RPM/s de bajada. Mas bajo: la inercia del ciguenal. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio|Tuning")
	float RPMReleaseRate = 4200.0f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio|Tuning")
	float LoadAttackRate = 7.0f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio|Tuning")
	float LoadReleaseRate = 3.2f;

	/**
	 * Corte de carga durante el cambio, en segundos. Un 10R80 real corta
	 * inyeccion ~90 ms: es el "blip" que hace que un cambio suene a cambio.
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Audio|Tuning")
	float ShiftCutSeconds = 0.09f;

private:
	void EnsureAudioComponents();
	void PushParameters(const FHRVehicleTelemetry& T);
	void PushFloat(UAudioComponent* Target, FName Name, float Value);

	UPROPERTY(Transient)
	TObjectPtr<UAudioComponent> EngineAudio;

	UPROPERTY(Transient)
	TObjectPtr<UAudioComponent> TyreAudio;

	UPROPERTY(Transient)
	TObjectPtr<UAudioComponent> WindAudio;

	/** El proveedor es el owner. Se resuelve una vez en BeginPlay. */
	const class IHRTelemetryProvider* Provider = nullptr;

	float Accumulator   = 0.0f;
	float SmoothedRPM   = 0.0f;
	float SmoothedLoad  = 0.0f;
	float SmoothedSlip  = 0.0f;
	float ShiftCutTimer = 0.0f;
	int32 LastGear      = 0;
	bool  bWasOnLimiter = false;
	bool  bInitialised  = false;
};
