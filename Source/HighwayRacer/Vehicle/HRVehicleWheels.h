// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.
//
// Ruedas Chaos del Mustang GT Fastback (S650).
// Cotas reales: delantera 255/40 R19 -> radio 34.3 cm, ancho 25.5 cm
//               trasera  275/40 R19 -> radio 35.0 cm, ancho 27.5 cm
//
// NOTA DE UNIDADES: Chaos trabaja en centimetros. Radio y ancho van en cm,
// los torques de freno en Nm. SpringRate y SpringPreload son adimensionales
// dentro del solver de Chaos: son perillas de tuning, no magnitudes fisicas.

#pragma once

#include "CoreMinimal.h"
#include "ChaosVehicleWheel.h"
#include "HRVehicleWheels.generated.h"

/** Base comun: aqui vive todo lo que comparten los dos ejes. */
UCLASS(Abstract)
class HIGHWAYRACER_API UHRVehicleWheel : public UChaosVehicleWheel
{
	GENERATED_BODY()

public:
	UHRVehicleWheel();
};

/**
 * Eje delantero: dirige, frena fuerte, no recibe par motor.
 * El reparto de frenada delantero/trasero de un GT ronda 65/35.
 */
UCLASS()
class HIGHWAYRACER_API UHRWheelFront : public UHRVehicleWheel
{
	GENERATED_BODY()

public:
	UHRWheelFront();
};

/**
 * Eje trasero: traccion y freno de mano.
 * Menor CorneringStiffness que el delantero para que el coche sea capaz de
 * sobrevirar al levantar el pie — es la base fisica del lift-off oversteer
 * que dispara las llamaradas en UHRVehicleFXComponent.
 */
UCLASS()
class HIGHWAYRACER_API UHRWheelRear : public UHRVehicleWheel
{
	GENERATED_BODY()

public:
	UHRWheelRear();
};
