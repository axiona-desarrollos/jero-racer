// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.
//
// TAREA 3 - VFX COMPONENT
//
// Dos sistemas independientes colgados del chasis:
//
// NEON INFERIOR: cuatro URectLightComponent, no UPointLightComponent. Un point
// light bajo el coche produce un charco circular que no se parece a una tira
// LED; el rect light con SourceWidth larga y SourceHeight corta da la mancha
// alargada correcta. Coste: los rect lights no proyectan sombra por defecto y
// aqui se dejan asi a proposito — cuatro luces con sombra bajo el coche
// destrozan el frame en una autopista con trafico denso.
//
// LLAMARADAS DE ESCAPE: un V8 atmosferico escupe llama cuando entra
// combustible sin quemar al escape caliente. Eso pasa al LEVANTAR EL PIE con
// el motor arriba de vueltas (overrun), y en el corte de inyeccion de un
// cambio bajo carga. La deteccion no mira el acelerador solo: exige que el
// regimen este CAYENDO de verdad (RPMDeltaPerSec), porque levantar el pie en
// punto muerto no produce llamarada.

#pragma once

#include "CoreMinimal.h"
#include "Components/SceneComponent.h"
#include "Telemetry/HRVehicleTelemetry.h"
#include "HRVehicleFXComponent.generated.h"

class URectLightComponent;
class UNiagaraComponent;
class UNiagaraSystem;

UCLASS(ClassGroup = "HighwayRacer", meta = (BlueprintSpawnableComponent))
class HIGHWAYRACER_API UHRVehicleFXComponent : public USceneComponent
{
	GENERATED_BODY()

public:
	UHRVehicleFXComponent();

	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType,
	                           FActorComponentTickFunction* ThisTickFunction) override;

	// ------------------------------------------------------------------ neon

	UFUNCTION(BlueprintCallable, Category = "HighwayRacer|FX|Underglow")
	void SetUnderglowEnabled(bool bEnabled);

	UFUNCTION(BlueprintCallable, Category = "HighwayRacer|FX|Underglow")
	void SetUnderglowColor(FLinearColor NewColor);

	UFUNCTION(BlueprintPure, Category = "HighwayRacer|FX|Underglow")
	bool IsUnderglowEnabled() const { return bUnderglowEnabled; }

	// --------------------------------------------------------------- escape

	/** Dispara las llamaradas a mano (scripting, cinematicas, nitro). */
	UFUNCTION(BlueprintCallable, Category = "HighwayRacer|FX|Exhaust")
	void FireExhaustFlames(float Intensity = 1.0f);

	/** Gancho para disenadores: sonido de backfire, camera shake, etc. */
	UFUNCTION(BlueprintImplementableEvent, Category = "HighwayRacer|FX|Exhaust")
	void OnExhaustFlames(float Intensity, bool bFromGearShift);

protected:
	// ------------------------------------------------------------ neon: setup

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Underglow")
	bool bUnderglowEnabled = true;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Underglow")
	FLinearColor UnderglowColor = FLinearColor(0.05f, 0.75f, 1.0f);

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Underglow")
	float UnderglowIntensity = 12000.0f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Underglow")
	float UnderglowAttenuation = 340.0f;

	/** Altura del emisor respecto al origen del chasis. Negativo = bajo el coche. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Underglow")
	float UnderglowHeight = -34.0f;

	/** Semidistancia longitudinal de las tiras laterales. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Underglow")
	float UnderglowSideOffsetY = 88.0f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Underglow")
	float UnderglowFrontOffsetX = 175.0f;

	/**
	 * Pulso con las RPM. 0 = fijo. Valores bajos (0.15) dan el latido sutil
	 * que se ve en los coches de exhibicion sin caer en discoteca.
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Underglow",
		meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float UnderglowRPMPulse = 0.15f;

	// --------------------------------------------------------- escape: setup

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Exhaust")
	TObjectPtr<UNiagaraSystem> ExhaustFlameSystem;

	/**
	 * Sockets del SkeletalMesh donde nacen las llamas. El S650 GT lleva salida
	 * cuadruple: dos parejas. Si el esqueleto no tiene sockets, se usan
	 * ExhaustFallbackOffsets.
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Exhaust")
	TArray<FName> ExhaustSockets;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Exhaust")
	TArray<FVector> ExhaustFallbackOffsets;

	/** Nombre del parametro float de intensidad dentro del sistema Niagara. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Exhaust")
	FName NiagaraIntensityParam = FName("User.Intensity");

	// ----------------------------------------------- escape: umbrales fisicos

	/** Por debajo de estas RPM no hay escape caliente: no hay llama. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Exhaust|Trigger")
	float MinRPMForFlames = 3800.0f;

	/** Acelerador que hay que haber pisado para "armar" el efecto. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Exhaust|Trigger",
		meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float ArmThrottle = 0.65f;

	/** Acelerador por debajo del cual se considera pie levantado. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Exhaust|Trigger",
		meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float LiftThrottle = 0.12f;

	/**
	 * Caida de regimen (RPM/s, valor positivo) que confirma el overrun.
	 * Sin esta condicion, soltar el gas en punto muerto dispararia llama.
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Exhaust|Trigger")
	float MinRPMDropRate = 2600.0f;

	/** Ventana tras levantar el pie en la que el disparo sigue siendo valido. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Exhaust|Trigger")
	float LiftWindowSeconds = 0.30f;

	/** Tiempo minimo entre llamaradas. Evita el efecto ametralladora. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Exhaust|Trigger")
	float FlameCooldown = 0.45f;

	/**
	 * Si esta activo, ademas exige que el tren trasero este deslizando: la
	 * llamarada solo sale en un lift-off oversteer de verdad, no en cualquier
	 * levantada de pie. Mas realista, mucho menos frecuente.
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Exhaust|Trigger")
	bool bRequireOversteer = false;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Exhaust|Trigger",
		meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float OversteerSlipThreshold = 0.45f;

	/** Tambien dispara en el corte de inyeccion de una subida bajo carga. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "FX|Exhaust|Trigger")
	bool bFlamesOnUpshift = true;

private:
	void BuildUnderglow();
	void BuildExhaust();
	void UpdateUnderglow(const FHRVehicleTelemetry& T, float DeltaTime);
	void EvaluateFlameTriggers(const FHRVehicleTelemetry& T, float DeltaTime);

	UPROPERTY(Transient)
	TArray<TObjectPtr<URectLightComponent>> UnderglowLights;

	UPROPERTY(Transient)
	TArray<TObjectPtr<UNiagaraComponent>> ExhaustEmitters;

	const class IHRTelemetryProvider* Provider = nullptr;

	float LiftTimer      = 0.0f;   // ventana abierta tras levantar el pie
	float CooldownTimer  = 0.0f;
	bool  bArmed         = false;  // hubo carga alta con el motor arriba
	int32 LastGear       = 0;
};
