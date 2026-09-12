// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.
//
// TAREA 1 - VEHICLE DYNAMICS
// Pawn del Ford Mustang GT Fastback (S650). Chaos Vehicles + Enhanced Input.
//
// La configuracion del vehiculo vive en el CONSTRUCTOR, no en BeginPlay: asi
// las subclases Blueprint heredan los valores y el disenador los ve en el
// panel de detalles antes de darle a Play. Si se hiciera en BeginPlay, el BP
// mostraria los defaults de Chaos y sobrescribiriamos al arrancar — el clasico
// "lo cambio en el editor y no pasa nada".

#pragma once

#include "CoreMinimal.h"
#include "WheeledVehiclePawn.h"
#include "Vehicle/HRSteeringModel.h"
#include "Telemetry/HRVehicleTelemetry.h"
#include "HRVehiclePawn.generated.h"

class UCameraComponent;
class USpringArmComponent;
class UInputMappingContext;
class UInputAction;
class UChaosWheeledVehicleMovementComponent;
class UHRVehicleAudioComponent;
class UHRVehicleFXComponent;
struct FInputActionValue;

UCLASS(Abstract, Blueprintable)
class HIGHWAYRACER_API AHRVehiclePawn : public AWheeledVehiclePawn, public IHRTelemetryProvider
{
	GENERATED_BODY()

public:
	AHRVehiclePawn(const FObjectInitializer& ObjectInitializer);

	//~ AActor / APawn
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaTime) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;
	virtual void NotifyControllerChanged() override;
	//~ End

	//~ IHRTelemetryProvider
	virtual void GetVehicleTelemetry(FHRVehicleTelemetry& Out) const override { Out = Telemetry; }
	//~ End

	/** Atajo tipado: AWheeledVehiclePawn ya lo devuelve, esto solo evita el cast. */
	UFUNCTION(BlueprintPure, Category = "HighwayRacer|Vehicle")
	UChaosWheeledVehicleMovementComponent* GetChaosMovement() const;

	UFUNCTION(BlueprintPure, Category = "HighwayRacer|Vehicle")
	float GetSpeedKmh() const;

	/** Cambio manual. Ignorado si la caja esta en automatico. */
	UFUNCTION(BlueprintCallable, Category = "HighwayRacer|Vehicle")
	void ShiftUp();

	UFUNCTION(BlueprintCallable, Category = "HighwayRacer|Vehicle")
	void ShiftDown();

	UFUNCTION(BlueprintCallable, Category = "HighwayRacer|Vehicle")
	void SetAutomaticGearbox(bool bAutomatic);

protected:
	// ---------------------------------------------------------------- camara

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Camera")
	TObjectPtr<USpringArmComponent> CameraBoom;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Camera")
	TObjectPtr<UCameraComponent> ChaseCamera;

	/** Camara de capo/interior. Se alterna con la de persecucion. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Camera")
	TObjectPtr<UCameraComponent> CockpitCamera;

	/** Estira el brazo con la velocidad: da sensacion de aceleracion. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Camera")
	float BoomLengthIdle = 620.0f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Camera")
	float BoomLengthMax = 780.0f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Camera")
	float BoomSpeedForMaxKmh = 260.0f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Camera")
	float CameraFovIdle = 90.0f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Camera")
	float CameraFovMax = 108.0f;

	// ------------------------------------------------------------ subsistemas

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "HighwayRacer")
	TObjectPtr<UHRVehicleAudioComponent> AudioComponent;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "HighwayRacer")
	TObjectPtr<UHRVehicleFXComponent> FXComponent;

	// ----------------------------------------------------------------- input

	/** Se anade al subsistema local al poseer el pawn. */
	UPROPERTY(EditDefaultsOnly, Category = "Input")
	TObjectPtr<UInputMappingContext> DefaultMappingContext;

	UPROPERTY(EditDefaultsOnly, Category = "Input")
	int32 MappingContextPriority = 0;

	UPROPERTY(EditDefaultsOnly, Category = "Input|Actions")
	TObjectPtr<UInputAction> IA_Throttle;

	UPROPERTY(EditDefaultsOnly, Category = "Input|Actions")
	TObjectPtr<UInputAction> IA_Brake;

	/** Eje -1..1. Con teclado va a Flecha-Izq / Flecha-Der (o A / D). */
	UPROPERTY(EditDefaultsOnly, Category = "Input|Actions")
	TObjectPtr<UInputAction> IA_Steer;

	UPROPERTY(EditDefaultsOnly, Category = "Input|Actions")
	TObjectPtr<UInputAction> IA_Handbrake;

	UPROPERTY(EditDefaultsOnly, Category = "Input|Actions")
	TObjectPtr<UInputAction> IA_ShiftUp;

	UPROPERTY(EditDefaultsOnly, Category = "Input|Actions")
	TObjectPtr<UInputAction> IA_ShiftDown;

	UPROPERTY(EditDefaultsOnly, Category = "Input|Actions")
	TObjectPtr<UInputAction> IA_LookAround;

	UPROPERTY(EditDefaultsOnly, Category = "Input|Actions")
	TObjectPtr<UInputAction> IA_ToggleCamera;

	// ------------------------------------------------------------- dinamica

	/** Modelo de volante progresivo. Ver HRSteeringModel.h. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Dynamics")
	FHRSteeringModel SteeringModel;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Dynamics")
	FHRPedalModel ThrottleModel;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Dynamics")
	FHRPedalModel BrakeModel;

	/**
	 * Aerodinamica simplificada: carga vertical proporcional a v^2 aplicada al
	 * centro de masas. Sin esto el coche flota por encima de 220 km/h.
	 * Valor en Newtons a la velocidad de referencia.
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Dynamics|Aero")
	float DownforceAtRefSpeed = 3200.0f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Dynamics|Aero")
	float AeroRefSpeedKmh = 200.0f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Dynamics")
	bool bStartWithAutomaticGearbox = true;

private:
	// --- configuracion de Chaos, llamada desde el constructor ---------------
	void ConfigureChassis();
	void ConfigureEngine();
	void ConfigureTransmission();
	void ConfigureSteeringAndDiff();
	void ConfigureWheels();

	// --- por frame ----------------------------------------------------------
	void ApplyDrivingInput(float DeltaTime);
	void ApplyAerodynamics(float DeltaTime);
	void UpdateCamera(float DeltaTime);
	void UpdateTelemetry(float DeltaTime);

	// --- manejadores de Enhanced Input --------------------------------------
	void Input_Throttle(const FInputActionValue& Value);
	void Input_Brake(const FInputActionValue& Value);
	void Input_Steer(const FInputActionValue& Value);
	void Input_HandbrakeStart(const FInputActionValue& Value);
	void Input_HandbrakeStop(const FInputActionValue& Value);
	void Input_ShiftUp(const FInputActionValue& Value);
	void Input_ShiftDown(const FInputActionValue& Value);
	void Input_Look(const FInputActionValue& Value);
	void Input_ToggleCamera(const FInputActionValue& Value);

	/** Ejes crudos del frame. Los modelos de suavizado los consumen en Tick. */
	float RawThrottle = 0.0f;
	float RawBrake    = 0.0f;
	float RawSteer    = 0.0f;
	bool  bHandbrake  = false;

	bool bCockpitView = false;

	/** Estado publicado a audio / VFX / HUD. */
	FHRVehicleTelemetry Telemetry;

	float PreviousRPM   = 0.0f;
	int32 PreviousGear  = 0;
	float ShiftTimer    = 0.0f;
};
