// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.
//
// Contrato de telemetria del vehiculo.
//
// DECISION DE DISENO: el getter principal es un virtual de C++ puro, NO un
// BlueprintNativeEvent. El sistema de audio lo consulta a 60-120 Hz y cada
// BlueprintNativeEvent paga busqueda en la vtable del UFunction mas el
// despacho de la VM de Blueprint. A esa frecuencia se nota en el perfil.
//
// La exposicion a Blueprint va aparte, por UHRTelemetryLibrary: quien la
// necesite (widgets de HUD, gráficos de dyno, un BP de FMOD) la paga; el
// camino caliente no.

#pragma once

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "HRVehicleTelemetry.generated.h"

/**
 * Estado instantaneo del tren motriz. Se llena una vez por frame en el pawn
 * y lo consumen audio, VFX y HUD. Todos los campos normalizados van 0..1.
 */
USTRUCT(BlueprintType)
struct HIGHWAYRACER_API FHRVehicleTelemetry
{
	GENERATED_BODY()

	// --- Motor ------------------------------------------------------------

	/** Regimen actual en RPM. */
	UPROPERTY(BlueprintReadOnly, Category = "Engine")
	float EngineRPM = 0.0f;

	/** RPM remapeadas 0..1 entre ralenti y corte. Esto es lo que quiere el audio. */
	UPROPERTY(BlueprintReadOnly, Category = "Engine")
	float NormalizedRPM = 0.0f;

	UPROPERTY(BlueprintReadOnly, Category = "Engine")
	float MaxRPM = 7500.0f;

	UPROPERTY(BlueprintReadOnly, Category = "Engine")
	float IdleRPM = 800.0f;

	/**
	 * Derivada del regimen en RPM/s. Negativa y grande = el motor cae.
	 * Es la senal que dispara las llamaradas de escape en lift-off.
	 */
	UPROPERTY(BlueprintReadOnly, Category = "Engine")
	float RPMDeltaPerSec = 0.0f;

	/** True mientras el motor esta contra el limitador. */
	UPROPERTY(BlueprintReadOnly, Category = "Engine")
	bool bOnRevLimiter = false;

	// --- Carga ------------------------------------------------------------

	/** Acelerador ya suavizado, 0..1. */
	UPROPERTY(BlueprintReadOnly, Category = "Load")
	float ThrottleInput = 0.0f;

	UPROPERTY(BlueprintReadOnly, Category = "Load")
	float BrakeInput = 0.0f;

	/**
	 * Carga del motor 0..1: mezcla de acelerador y de si el tren motriz esta
	 * realmente entregando par. Un motor a 6000 rpm con el pie levantado tiene
	 * RPM altas y carga cero — y suena completamente distinto.
	 */
	UPROPERTY(BlueprintReadOnly, Category = "Load")
	float EngineLoad = 0.0f;

	/** Retencion, 0..1. Complementaria de la carga: el "off-throttle" del audio. */
	UPROPERTY(BlueprintReadOnly, Category = "Load")
	float EngineBraking = 0.0f;

	// --- Transmision -------------------------------------------------------

	/** <0 reversa, 0 punto muerto, >0 marcha engranada. */
	UPROPERTY(BlueprintReadOnly, Category = "Transmission")
	int32 Gear = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Transmission")
	int32 TargetGear = 0;

	/** True durante la ventana de GearChangeTime. Dispara el corte de audio. */
	UPROPERTY(BlueprintReadOnly, Category = "Transmission")
	bool bIsShifting = false;

	// --- Chasis ------------------------------------------------------------

	UPROPERTY(BlueprintReadOnly, Category = "Chassis")
	float SpeedKmh = 0.0f;

	UPROPERTY(BlueprintReadOnly, Category = "Chassis")
	float ForwardSpeedCms = 0.0f;

	/**
	 * Angulo entre el morro y el vector velocidad, en grados. Positivo = la
	 * cola se va por la derecha. Es la medida de "cuan cruzado va el coche".
	 */
	UPROPERTY(BlueprintReadOnly, Category = "Chassis")
	float YawSlipDeg = 0.0f;

	/** Deslizamiento medio del eje trasero, normalizado contra SlipThreshold. */
	UPROPERTY(BlueprintReadOnly, Category = "Chassis")
	float RearSlipRatio = 0.0f;

	UPROPERTY(BlueprintReadOnly, Category = "Chassis")
	float FrontSlipRatio = 0.0f;

	UPROPERTY(BlueprintReadOnly, Category = "Chassis")
	bool bAnyWheelSkidding = false;

	UPROPERTY(BlueprintReadOnly, Category = "Chassis")
	bool bAirborne = false;

	/** Angulo de direccion aplicado, -1..1. Para animar el volante del interior. */
	UPROPERTY(BlueprintReadOnly, Category = "Chassis")
	float SteeringNormalized = 0.0f;
};

// ---------------------------------------------------------------------------

UINTERFACE(MinimalAPI, meta = (CannotImplementInterfaceInBlueprint))
class UHRTelemetryProvider : public UInterface
{
	GENERATED_BODY()
};

/**
 * Lo implementa cualquier actor capaz de publicar telemetria de tren motriz.
 * Solo C++: ver la nota de cabecera sobre el coste del despacho.
 */
class HIGHWAYRACER_API IHRTelemetryProvider
{
	GENERATED_BODY()

public:
	/** Rellena el estado del frame actual. No debe recalcular fisica. */
	virtual void GetVehicleTelemetry(FHRVehicleTelemetry& Out) const = 0;
};

// ---------------------------------------------------------------------------

/**
 * Puente a Blueprint. Aqui si se paga el despacho, y esta bien: lo consume
 * HUD y herramientas de tuning, no el bucle de audio.
 */
UCLASS()
class HIGHWAYRACER_API UHRTelemetryLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** Telemetria completa. bValid = false si el actor no implementa la interfaz. */
	UFUNCTION(BlueprintCallable, Category = "HighwayRacer|Telemetry",
		meta = (DisplayName = "Get Vehicle Telemetry"))
	static void GetVehicleTelemetry(const AActor* Actor, FHRVehicleTelemetry& Telemetry, bool& bValid);

	UFUNCTION(BlueprintPure, Category = "HighwayRacer|Telemetry")
	static float GetEngineRPM(const AActor* Actor);

	UFUNCTION(BlueprintPure, Category = "HighwayRacer|Telemetry")
	static float GetEngineLoad(const AActor* Actor);

	UFUNCTION(BlueprintPure, Category = "HighwayRacer|Telemetry")
	static int32 GetCurrentGear(const AActor* Actor);

	/** Texto listo para HUD: "R", "N", "1".."10". */
	UFUNCTION(BlueprintPure, Category = "HighwayRacer|Telemetry")
	static FText GetGearDisplay(const AActor* Actor);
};
