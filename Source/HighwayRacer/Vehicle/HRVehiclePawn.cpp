// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.

#include "Vehicle/HRVehiclePawn.h"
#include "Vehicle/HRVehicleWheels.h"
#include "Telemetry/HRVehicleAudioComponent.h"
#include "VFX/HRVehicleFXComponent.h"

#include "ChaosWheeledVehicleMovementComponent.h"
#include "Curves/CurveFloat.h"
#include "Components/SkeletalMeshComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "Camera/CameraComponent.h"

#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "InputActionValue.h"
#include "GameFramework/PlayerController.h"
#include "Engine/LocalPlayer.h"

// Relacion final del GT con Performance Pack.
static constexpr float kFinalDriveRatio = 3.55f;

AHRVehiclePawn::AHRVehiclePawn(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	PrimaryActorTick.bCanEverTick = true;
	// Despues de la fisica: leemos el estado ya resuelto del frame.
	PrimaryActorTick.TickGroup = TG_PostPhysics;

	// ------------------------------------------------------------- camaras
	CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
	CameraBoom->SetupAttachment(GetMesh());
	CameraBoom->SetRelativeLocation(FVector(0.0f, 0.0f, 120.0f));
	CameraBoom->TargetArmLength      = BoomLengthIdle;
	CameraBoom->bUsePawnControlRotation = false;
	CameraBoom->bInheritPitch  = false;
	CameraBoom->bInheritRoll   = false;
	CameraBoom->bInheritYaw    = true;
	CameraBoom->bEnableCameraLag        = true;
	CameraBoom->bEnableCameraRotationLag = true;
	CameraBoom->CameraLagSpeed          = 9.0f;
	CameraBoom->CameraRotationLagSpeed  = 7.0f;
	CameraBoom->CameraLagMaxDistance    = 120.0f;
	CameraBoom->SetRelativeRotation(FRotator(-9.0f, 0.0f, 0.0f));

	ChaseCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("ChaseCamera"));
	ChaseCamera->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
	ChaseCamera->FieldOfView = CameraFovIdle;

	CockpitCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("CockpitCamera"));
	CockpitCamera->SetupAttachment(GetMesh());
	CockpitCamera->SetRelativeLocation(FVector(20.0f, -38.0f, 118.0f)); // volante a la izquierda
	CockpitCamera->FieldOfView = 82.0f;
	CockpitCamera->SetAutoActivate(false);

	// --------------------------------------------------------- subsistemas
	AudioComponent = CreateDefaultSubobject<UHRVehicleAudioComponent>(TEXT("VehicleAudio"));
	FXComponent    = CreateDefaultSubobject<UHRVehicleFXComponent>(TEXT("VehicleFX"));

	// ------------------------------------------------------- fisica Chaos
	ConfigureChassis();
	ConfigureEngine();
	ConfigureTransmission();
	ConfigureSteeringAndDiff();
	ConfigureWheels();
}

UChaosWheeledVehicleMovementComponent* AHRVehiclePawn::GetChaosMovement() const
{
	return Cast<UChaosWheeledVehicleMovementComponent>(GetVehicleMovementComponent());
}

// ===========================================================================
//  CONFIGURACION DE CHAOS
// ===========================================================================

void AHRVehiclePawn::ConfigureChassis()
{
	UChaosWheeledVehicleMovementComponent* Move = GetChaosMovement();
	if (!Move) { return; }

	// S650 GT automatico en orden de marcha.
	Move->Mass          = 1780.0f;
	Move->ChassisWidth  = 193.0f;   // cm
	Move->ChassisHeight = 141.0f;   // cm
	Move->DragCoefficient     = 0.36f;
	Move->DownforceCoefficient = 0.35f;

	// El tensor por defecto hace que el coche gire como una peonza. Alargarlo
	// en X (eje longitudinal) le da la inercia de un coche largo y pesado.
	Move->InertiaTensorScale = FVector(1.0f, 1.35f, 1.45f);

	// Sin esto, a bajas velocidades Chaos duerme el cuerpo y el coche se
	// "pega" al asfalto en los arranques.
	Move->bEnableCenterOfMassOverride = true;
	Move->CenterOfMassOverride = FVector(0.0f, 0.0f, -18.0f); // bajarlo estabiliza

	Move->bMechanicalSimEnabled = true;
	Move->bSuspensionEnabled    = true;
	Move->bWheelFrictionEnabled = true;
}

void AHRVehiclePawn::ConfigureEngine()
{
	UChaosWheeledVehicleMovementComponent* Move = GetChaosMovement();
	if (!Move) { return; }

	FVehicleEngineConfig& Engine = Move->EngineSetup;

	// Coyote 5.0 V8: 486 CV a 7250 rpm, 567 Nm a 4900 rpm.
	Engine.MaxTorque         = 567.0f;   // Nm
	Engine.MaxRPM            = 7500.0f;
	Engine.EngineIdleRPM     = 760.0f;
	Engine.EngineBrakeEffect = 0.09f;    // retencion: alta, es un V8 atmosferico
	Engine.EngineRevUpMOI    = 4.2f;     // bajo = sube de vueltas rapido
	Engine.EngineRevDownRate = 720.0f;

	// Curva de par NORMALIZADA (0..1 sobre MaxTorque) contra RPM.
	// La meseta ancha entre 3500 y 5500 es lo que define el caracter del V8
	// atmosferico frente a un turbo.
	if (FRichCurve* Curve = Engine.TorqueCurve.GetRichCurve())
	{
		Curve->Reset();
		Curve->AddKey(760.0f,  0.40f);
		Curve->AddKey(1500.0f, 0.66f);
		Curve->AddKey(2500.0f, 0.84f);
		Curve->AddKey(3500.0f, 0.94f);
		Curve->AddKey(4900.0f, 1.00f);   // par maximo
		Curve->AddKey(5800.0f, 0.97f);
		Curve->AddKey(6600.0f, 0.90f);
		Curve->AddKey(7250.0f, 0.82f);   // potencia maxima
		Curve->AddKey(7500.0f, 0.55f);   // caida contra el limitador
	}
}

void AHRVehiclePawn::ConfigureTransmission()
{
	UChaosWheeledVehicleMovementComponent* Move = GetChaosMovement();
	if (!Move) { return; }

	FVehicleTransmissionConfig& Trans = Move->TransmissionSetup;

	Trans.bUseAutomaticGears = bStartWithAutomaticGearbox;
	Trans.bUseAutoReverse    = true;
	Trans.FinalRatio         = kFinalDriveRatio;

	// Ford 10R80, relaciones reales.
	Trans.ForwardGearRatios = { 4.696f, 2.985f, 2.146f, 1.769f, 1.520f,
	                            1.275f, 1.000f, 0.854f, 0.689f, 0.636f };
	Trans.ReverseGearRatios = { 2.940f };

	Trans.ChangeUpRPM          = 6900.0f;
	Trans.ChangeDownRPM        = 2300.0f;
	Trans.GearChangeTime       = 0.11f;   // el 10R80 es rapido
	Trans.TransmissionEfficiency = 0.92f;
}

void AHRVehiclePawn::ConfigureSteeringAndDiff()
{
	UChaosWheeledVehicleMovementComponent* Move = GetChaosMovement();
	if (!Move) { return; }

	FVehicleDifferentialConfig& Diff = Move->DifferentialSetup;
	Diff.DifferentialType = EVehicleDifferential::RearWheelDrive;
	Diff.FrontRearSplit   = 0.0f;   // irrelevante en propulsion, explicito por claridad

	FVehicleSteeringConfig& Steer = Move->SteeringSetup;
	Steer.SteeringType = ESteeringType::AngleRatio;
	Steer.AngleRatio   = 1.0f;

	// IMPORTANTE: la curva de Chaos se deja PLANA a 1.0 a proposito.
	// La sensibilidad a la velocidad la posee FHRSteeringModel (ver
	// HRSteeringModel.h). Si ambas atenuaran, el giro se reduciria dos veces
	// y el volante quedaria muerto en autopista — y peor, tendriamos dos
	// fuentes de verdad para la misma sensacion.
	if (FRichCurve* Curve = Steer.SteeringCurve.GetRichCurve())
	{
		Curve->Reset();
		Curve->AddKey(0.0f,   1.0f);
		Curve->AddKey(300.0f, 1.0f);
	}
}

void AHRVehiclePawn::ConfigureWheels()
{
	UChaosWheeledVehicleMovementComponent* Move = GetChaosMovement();
	if (!Move) { return; }

	// Los BoneName deben existir en el esqueleto del SkeletalMesh. Si usas el
	// esqueleto del VehicleTemplate de Epic, estos son los nombres. Con un
	// esqueleto propio, cambialos aqui o sobrescribe WheelSetups en el BP.
	Move->WheelSetups.SetNum(4);

	Move->WheelSetups[0].WheelClass = UHRWheelFront::StaticClass();
	Move->WheelSetups[0].BoneName   = FName("Wheel_Front_Left");
	Move->WheelSetups[0].AdditionalOffset = FVector::ZeroVector;

	Move->WheelSetups[1].WheelClass = UHRWheelFront::StaticClass();
	Move->WheelSetups[1].BoneName   = FName("Wheel_Front_Right");
	Move->WheelSetups[1].AdditionalOffset = FVector::ZeroVector;

	Move->WheelSetups[2].WheelClass = UHRWheelRear::StaticClass();
	Move->WheelSetups[2].BoneName   = FName("Wheel_Rear_Left");
	Move->WheelSetups[2].AdditionalOffset = FVector::ZeroVector;

	Move->WheelSetups[3].WheelClass = UHRWheelRear::StaticClass();
	Move->WheelSetups[3].BoneName   = FName("Wheel_Rear_Right");
	Move->WheelSetups[3].AdditionalOffset = FVector::ZeroVector;
}

// ===========================================================================
//  CICLO DE VIDA
// ===========================================================================

void AHRVehiclePawn::BeginPlay()
{
	Super::BeginPlay();

	SteeringModel.Reset();
	ThrottleModel.Reset();
	BrakeModel.Reset();

	if (UChaosWheeledVehicleMovementComponent* Move = GetChaosMovement())
	{
		PreviousRPM  = Move->GetEngineRotationSpeed();
		PreviousGear = Move->GetCurrentGear();
	}
}

void AHRVehiclePawn::NotifyControllerChanged()
{
	Super::NotifyControllerChanged();

	// Enhanced Input se registra por LocalPlayer, no por pawn: hay que
	// (re)anadir el contexto cada vez que cambia el controlador.
	if (const APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		if (const ULocalPlayer* LP = PC->GetLocalPlayer())
		{
			if (UEnhancedInputLocalPlayerSubsystem* Subsystem =
					LP->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>())
			{
				if (DefaultMappingContext)
				{
					Subsystem->AddMappingContext(DefaultMappingContext, MappingContextPriority);
				}
			}
		}
	}
}

void AHRVehiclePawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	UEnhancedInputComponent* EIC = Cast<UEnhancedInputComponent>(PlayerInputComponent);
	if (!EIC)
	{
		UE_LOG(LogTemp, Error,
			TEXT("[HighwayRacer] El InputComponent por defecto no es Enhanced Input. "
			     "Ajusta DefaultPlayerInputClass y DefaultInputComponentClass en "
			     "Project Settings > Input."));
		return;
	}

	// Triggered dispara cada frame mientras la accion esta activa: es lo que
	// queremos en ejes, porque el suavizado necesita el valor crudo del frame.
	if (IA_Throttle) { EIC->BindAction(IA_Throttle, ETriggerEvent::Triggered, this, &AHRVehiclePawn::Input_Throttle); }
	if (IA_Throttle) { EIC->BindAction(IA_Throttle, ETriggerEvent::Completed, this, &AHRVehiclePawn::Input_Throttle); }
	if (IA_Brake)    { EIC->BindAction(IA_Brake,    ETriggerEvent::Triggered, this, &AHRVehiclePawn::Input_Brake); }
	if (IA_Brake)    { EIC->BindAction(IA_Brake,    ETriggerEvent::Completed, this, &AHRVehiclePawn::Input_Brake); }
	if (IA_Steer)    { EIC->BindAction(IA_Steer,    ETriggerEvent::Triggered, this, &AHRVehiclePawn::Input_Steer); }
	if (IA_Steer)    { EIC->BindAction(IA_Steer,    ETriggerEvent::Completed, this, &AHRVehiclePawn::Input_Steer); }

	if (IA_Handbrake)
	{
		EIC->BindAction(IA_Handbrake, ETriggerEvent::Started,   this, &AHRVehiclePawn::Input_HandbrakeStart);
		EIC->BindAction(IA_Handbrake, ETriggerEvent::Completed, this, &AHRVehiclePawn::Input_HandbrakeStop);
		EIC->BindAction(IA_Handbrake, ETriggerEvent::Canceled,  this, &AHRVehiclePawn::Input_HandbrakeStop);
	}

	if (IA_ShiftUp)      { EIC->BindAction(IA_ShiftUp,      ETriggerEvent::Started,   this, &AHRVehiclePawn::Input_ShiftUp); }
	if (IA_ShiftDown)    { EIC->BindAction(IA_ShiftDown,    ETriggerEvent::Started,   this, &AHRVehiclePawn::Input_ShiftDown); }
	if (IA_LookAround)   { EIC->BindAction(IA_LookAround,   ETriggerEvent::Triggered, this, &AHRVehiclePawn::Input_Look); }
	if (IA_ToggleCamera) { EIC->BindAction(IA_ToggleCamera, ETriggerEvent::Started,   this, &AHRVehiclePawn::Input_ToggleCamera); }
}

void AHRVehiclePawn::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);

	ApplyDrivingInput(DeltaTime);
	ApplyAerodynamics(DeltaTime);
	UpdateTelemetry(DeltaTime);
	UpdateCamera(DeltaTime);
}

// ===========================================================================
//  POR FRAME
// ===========================================================================

void AHRVehiclePawn::ApplyDrivingInput(float DeltaTime)
{
	UChaosWheeledVehicleMovementComponent* Move = GetChaosMovement();
	if (!Move) { return; }

	const float SpeedKmh = GetSpeedKmh();

	// El angulo de deriva del frame anterior alimenta la asistencia de
	// contravolante. Usar el del frame actual crearia un lazo cerrado dentro
	// del mismo tick.
	const float Steer = SteeringModel.Update(RawSteer, SpeedKmh, Telemetry.YawSlipDeg, DeltaTime);
	Move->SetSteeringInput(Steer);

	Move->SetThrottleInput(ThrottleModel.Update(RawThrottle, DeltaTime));
	Move->SetBrakeInput(BrakeModel.Update(RawBrake, DeltaTime));
	Move->SetHandbrakeInput(bHandbrake);
}

void AHRVehiclePawn::ApplyAerodynamics(float DeltaTime)
{
	if (DownforceAtRefSpeed <= KINDA_SMALL_NUMBER) { return; }

	USkeletalMeshComponent* Body = GetMesh();
	if (!Body || !Body->IsSimulatingPhysics()) { return; }

	const float SpeedKmh = GetSpeedKmh();
	if (SpeedKmh < 60.0f) { return; }

	// Carga proporcional a v^2, que es como se comporta la aerodinamica real.
	const float Ratio = SpeedKmh / FMath::Max(1.0f, AeroRefSpeedKmh);
	const float Force = DownforceAtRefSpeed * Ratio * Ratio;

	// Aplicada por detras del centro de masas: carga mas el eje trasero que el
	// delantero. Es lo que evita que la cola se suelte sola a 250 km/h, y lo
	// que hace que el coche se sienta "clavado" en recta.
	const FVector Point = Body->GetComponentLocation() - GetActorForwardVector() * 70.0f;
	Body->AddForceAtLocation(FVector(0.0f, 0.0f, -Force), Point);
}

void AHRVehiclePawn::UpdateCamera(float DeltaTime)
{
	if (!CameraBoom || !ChaseCamera) { return; }

	const float Alpha = FMath::Clamp(GetSpeedKmh() / FMath::Max(1.0f, BoomSpeedForMaxKmh), 0.0f, 1.0f);

	CameraBoom->TargetArmLength = FMath::FInterpTo(
		CameraBoom->TargetArmLength,
		FMath::Lerp(BoomLengthIdle, BoomLengthMax, Alpha),
		DeltaTime, 2.5f);

	ChaseCamera->FieldOfView = FMath::FInterpTo(
		ChaseCamera->FieldOfView,
		FMath::Lerp(CameraFovIdle, CameraFovMax, Alpha),
		DeltaTime, 2.0f);
}

void AHRVehiclePawn::UpdateTelemetry(float DeltaTime)
{
	UChaosWheeledVehicleMovementComponent* Move = GetChaosMovement();
	if (!Move || DeltaTime <= KINDA_SMALL_NUMBER) { return; }

	// --- motor -------------------------------------------------------------
	const float RPM    = Move->GetEngineRotationSpeed();
	const float MaxRPM = FMath::Max(1.0f, Move->GetEngineMaxRotationSpeed());
	const float Idle   = Move->EngineSetup.EngineIdleRPM;

	Telemetry.EngineRPM      = RPM;
	Telemetry.MaxRPM         = MaxRPM;
	Telemetry.IdleRPM        = Idle;
	Telemetry.NormalizedRPM  = FMath::Clamp((RPM - Idle) / FMath::Max(1.0f, MaxRPM - Idle), 0.0f, 1.0f);
	Telemetry.RPMDeltaPerSec = (RPM - PreviousRPM) / DeltaTime;
	Telemetry.bOnRevLimiter  = RPM >= (MaxRPM - 120.0f);
	PreviousRPM = RPM;

	// --- transmision -------------------------------------------------------
	const int32 Gear = Move->GetCurrentGear();
	Telemetry.Gear       = Gear;
	Telemetry.TargetGear = Move->GetTargetGear();

	if (Gear != PreviousGear)
	{
		ShiftTimer   = Move->TransmissionSetup.GearChangeTime;
		PreviousGear = Gear;
	}
	ShiftTimer = FMath::Max(0.0f, ShiftTimer - DeltaTime);
	Telemetry.bIsShifting = ShiftTimer > 0.0f;

	// --- carga -------------------------------------------------------------
	// Chaos no expone par instantaneo del motor, asi que la carga se deriva:
	// acelerador pisado, marcha engranada y embrague cerrado. Es una
	// aproximacion, pero es la que necesita el audio (mezcla on/off-throttle).
	const float Throttle = ThrottleModel.GetCurrent();
	Telemetry.ThrottleInput = Throttle;
	Telemetry.BrakeInput    = BrakeModel.GetCurrent();
	Telemetry.EngineLoad    = Telemetry.bIsShifting ? 0.0f
		: FMath::Clamp(Throttle * FMath::Lerp(0.55f, 1.0f, Telemetry.NormalizedRPM), 0.0f, 1.0f);
	Telemetry.EngineBraking = FMath::Clamp((1.0f - Throttle) * Telemetry.NormalizedRPM, 0.0f, 1.0f);

	// --- chasis ------------------------------------------------------------
	Telemetry.ForwardSpeedCms   = Move->GetForwardSpeed();
	Telemetry.SpeedKmh          = GetSpeedKmh();
	Telemetry.SteeringNormalized = SteeringModel.GetRawCurrent();

	const FVector Velocity = GetVelocity();
	if (Velocity.SizeSquared2D() > 400.0f)   // > 20 cm/s, evita ruido parado
	{
		const FVector Fwd = GetActorForwardVector().GetSafeNormal2D();
		const FVector Vel = Velocity.GetSafeNormal2D();
		// Positivo = el vector velocidad apunta a la izquierda del morro,
		// es decir la cola se esta yendo por la derecha.
		const float Cross = FVector::CrossProduct(Fwd, Vel).Z;
		const float Dot   = FVector::DotProduct(Fwd, Vel);
		Telemetry.YawSlipDeg = FMath::RadiansToDegrees(FMath::Atan2(-Cross, FMath::Abs(Dot)));
	}
	else
	{
		Telemetry.YawSlipDeg = 0.0f;
	}

	// Deslizamiento por eje. GetWheelState existe desde UE 5.0; si migras a
	// una version donde cambie, este es el unico punto a tocar.
	float FrontSlip = 0.0f, RearSlip = 0.0f;
	int32 FrontCount = 0, RearCount = 0, AirCount = 0;
	bool bSkid = false;

	const int32 NumWheels = Move->Wheels.Num();
	for (int32 i = 0; i < NumWheels; ++i)
	{
		const FWheelStatus& W = Move->GetWheelState(i);
		if (!W.bIsValid) { continue; }

		if (!W.bInContact) { ++AirCount; }
		bSkid |= W.bIsSkidding;

		const UChaosVehicleWheel* Wheel = Move->Wheels[i];
		const float Threshold = Wheel ? FMath::Max(1.0f, Wheel->SlipThreshold) : 20.0f;
		const float Norm = FMath::Clamp(W.SlipMagnitude / Threshold, 0.0f, 1.0f);

		if (Wheel && Wheel->AxleType == EAxleType::Rear) { RearSlip += Norm; ++RearCount; }
		else                                             { FrontSlip += Norm; ++FrontCount; }
	}

	Telemetry.FrontSlipRatio    = FrontCount > 0 ? FrontSlip / FrontCount : 0.0f;
	Telemetry.RearSlipRatio     = RearCount  > 0 ? RearSlip  / RearCount  : 0.0f;
	Telemetry.bAnyWheelSkidding = bSkid;
	Telemetry.bAirborne         = (NumWheels > 0) && (AirCount == NumWheels);
}

// ===========================================================================
//  API
// ===========================================================================

float AHRVehiclePawn::GetSpeedKmh() const
{
	const UChaosWheeledVehicleMovementComponent* Move = GetChaosMovement();
	// GetForwardSpeed() viene en cm/s.
	return Move ? FMath::Abs(Move->GetForwardSpeed()) * 0.036f : 0.0f;
}

void AHRVehiclePawn::ShiftUp()
{
	if (UChaosWheeledVehicleMovementComponent* Move = GetChaosMovement())
	{
		if (!Move->TransmissionSetup.bUseAutomaticGears)
		{
			Move->SetTargetGear(Move->GetCurrentGear() + 1, true);
		}
	}
}

void AHRVehiclePawn::ShiftDown()
{
	if (UChaosWheeledVehicleMovementComponent* Move = GetChaosMovement())
	{
		if (!Move->TransmissionSetup.bUseAutomaticGears)
		{
			Move->SetTargetGear(Move->GetCurrentGear() - 1, true);
		}
	}
}

void AHRVehiclePawn::SetAutomaticGearbox(bool bAutomatic)
{
	if (UChaosWheeledVehicleMovementComponent* Move = GetChaosMovement())
	{
		Move->SetUseAutomaticGears(bAutomatic);
	}
}

// ===========================================================================
//  ENHANCED INPUT
// ===========================================================================

void AHRVehiclePawn::Input_Throttle(const FInputActionValue& Value)  { RawThrottle = Value.Get<float>(); }
void AHRVehiclePawn::Input_Brake(const FInputActionValue& Value)     { RawBrake    = Value.Get<float>(); }
void AHRVehiclePawn::Input_Steer(const FInputActionValue& Value)     { RawSteer    = Value.Get<float>(); }
void AHRVehiclePawn::Input_HandbrakeStart(const FInputActionValue&)  { bHandbrake  = true; }
void AHRVehiclePawn::Input_HandbrakeStop(const FInputActionValue&)   { bHandbrake  = false; }
void AHRVehiclePawn::Input_ShiftUp(const FInputActionValue&)         { ShiftUp(); }
void AHRVehiclePawn::Input_ShiftDown(const FInputActionValue&)       { ShiftDown(); }

void AHRVehiclePawn::Input_Look(const FInputActionValue& Value)
{
	const FVector2D Axis = Value.Get<FVector2D>();
	if (CameraBoom && !Axis.IsNearlyZero())
	{
		// Mirar alrededor sin mover el coche: solo el yaw relativo del brazo.
		FRotator Rot = CameraBoom->GetRelativeRotation();
		Rot.Yaw   = FMath::Clamp(Rot.Yaw + Axis.X * 2.0f, -170.0f, 170.0f);
		Rot.Pitch = FMath::Clamp(Rot.Pitch + Axis.Y * 1.2f, -30.0f, 12.0f);
		CameraBoom->SetRelativeRotation(Rot);
	}
}

void AHRVehiclePawn::Input_ToggleCamera(const FInputActionValue&)
{
	bCockpitView = !bCockpitView;
	if (ChaseCamera)   { ChaseCamera->SetActive(!bCockpitView); }
	if (CockpitCamera) { CockpitCamera->SetActive(bCockpitView); }
}
