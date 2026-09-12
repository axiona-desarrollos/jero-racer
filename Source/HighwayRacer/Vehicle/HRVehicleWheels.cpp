// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.

#include "Vehicle/HRVehicleWheels.h"
#include "Chaos/ChaosEngineInterface.h"

UHRVehicleWheel::UHRVehicleWheel()
{
	// Neumatico deportivo de calle (Pirelli P Zero de serie en el GT).
	FrictionForceMultiplier = 3.0f;
	SideSlipModifier        = 1.0f;

	// Umbrales de deslizamiento: por debajo de esto FWheelStatus no marca
	// bIsSlipping. Se leen en el componente de VFX y en el de audio.
	SlipThreshold = 22.0f;
	SkidThreshold = 22.0f;

	// Suspension: un GT de calle con Performance Pack es firme pero no rigido.
	SpringRate            = 420.0f;
	SpringPreload         = 90.0f;
	SuspensionMaxRaise    = 7.0f;
	SuspensionMaxDrop     = 9.0f;
	SuspensionDampingRatio = 0.62f;
	SuspensionSmoothing   = 4;
	WheelLoadRatio        = 0.55f;
	RollbarScaling        = 0.30f;

	// Barrido por forma: mas caro que el raycast pero es lo unico que resuelve
	// bien los badenes y las juntas de una autopista a 200 km/h.
	SweepShape = ESweepShape::Shapecast;
	SweepType  = ESweepType::ComplexAndSimpleSweep;

	bABSEnabled             = true;
	bTractionControlEnabled = false;   // lo queremos suelto: es un juego de derrapes
}

UHRWheelFront::UHRWheelFront()
{
	AxleType = EAxleType::Front;

	WheelRadius = 34.3f;
	WheelWidth  = 25.5f;
	WheelMass   = 22.0f;

	bAffectedBySteering  = true;
	bAffectedByEngine    = false;
	bAffectedByBrake     = true;
	bAffectedByHandbrake = false;

	// 38 grados es el tope real de un Mustang; el modelo de direccion de
	// FHRSteeringModel nunca pide mas que esto.
	MaxSteerAngle = 38.0f;

	CorneringStiffness = 1400.0f;

	MaxBrakeTorque     = 4500.0f;
	MaxHandBrakeTorque = 0.0f;
}

UHRWheelRear::UHRWheelRear()
{
	AxleType = EAxleType::Rear;

	WheelRadius = 35.0f;
	WheelWidth  = 27.5f;
	WheelMass   = 24.0f;

	bAffectedBySteering  = false;
	bAffectedByEngine    = true;
	bAffectedByBrake     = true;
	bAffectedByHandbrake = true;

	MaxSteerAngle = 0.0f;

	// Deliberadamente por debajo del delantero (1400): el tren trasero pierde
	// adherencia antes que el delantero. Sin esta asimetria el coche subvira
	// siempre y el lift-off oversteer no existe.
	CorneringStiffness = 1150.0f;

	MaxBrakeTorque     = 2400.0f;
	MaxHandBrakeTorque = 6000.0f;
}
