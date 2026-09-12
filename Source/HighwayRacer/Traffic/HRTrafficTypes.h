// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.
//
// TAREA 4 - TIPOS DEL SISTEMA DE TRAFICO
//
// El perfil de trafico es un UDataAsset, no valores sueltos en el subsistema:
// asi el equipo de diseno ajusta densidad, carriles y mezcla de vehiculos sin
// recompilar, y se pueden tener perfiles distintos por tramo de autopista
// (hora punta, madrugada, obras).

#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "UObject/Interface.h"
#include "HRTrafficTypes.generated.h"

class AActor;

// ---------------------------------------------------------------------------
//  Contrato de reciclado
// ---------------------------------------------------------------------------

UINTERFACE(MinimalAPI, BlueprintType)
class UHRPoolable : public UInterface
{
	GENERATED_BODY()
};

/**
 * Lo implementa todo actor que viva en un pool.
 *
 * REGLA: OnReturnedToPool debe dejar al actor en un estado neutro — sin
 * velocidad, sin timers, sin delegados suscritos, sin efectos activos. Un pool
 * cuyos objetos arrastran estado del uso anterior produce los bugs mas
 * dificiles de reproducir del proyecto: el coche 40 aparece con la sirena del
 * coche de policia que ocupaba ese slot hace dos minutos.
 */
class HIGHWAYRACER_API IHRPoolable
{
	GENERATED_BODY()

public:
	/** El actor sale del pool: activar, mostrar, resetear estado de gameplay. */
	UFUNCTION(BlueprintNativeEvent, Category = "HighwayRacer|Pool")
	void OnAcquiredFromPool();

	/** El actor vuelve al pool: apagar TODO. */
	UFUNCTION(BlueprintNativeEvent, Category = "HighwayRacer|Pool")
	void OnReturnedToPool();
};

// ---------------------------------------------------------------------------
//  Configuracion
// ---------------------------------------------------------------------------

/** Un carril de la autopista. */
USTRUCT(BlueprintType)
struct HIGHWAYRACER_API FHRTrafficLane
{
	GENERATED_BODY()

	/** Desplazamiento lateral respecto al eje de la via, en cm. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Lane")
	float LateralOffset = 0.0f;

	/** +1 = mismo sentido que el jugador. -1 = sentido contrario. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Lane", meta = (ClampMin = "-1", ClampMax = "1"))
	int32 Direction = 1;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Lane")
	float MinSpeedKmh = 90.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Lane")
	float MaxSpeedKmh = 130.0f;

	/** Peso relativo de este carril al elegir donde generar. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Lane", meta = (ClampMin = "0.0"))
	float SpawnWeight = 1.0f;
};

/** Una clase de vehiculo dentro de la mezcla de trafico. */
USTRUCT(BlueprintType)
struct HIGHWAYRACER_API FHRTrafficEntry
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Entry")
	TSubclassOf<AActor> VehicleClass;

	/** Peso relativo en la mezcla. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Entry", meta = (ClampMin = "0.0"))
	float Weight = 1.0f;

	/**
	 * Instancias pre-creadas al arrancar. Es lo que evita el hitch de la
	 * primera aparicion de cada clase: crear un actor con su malla y sus
	 * materiales a 200 km/h se ve como un tiron.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Entry", meta = (ClampMin = "0"))
	int32 PoolWarmup = 8;

	/** Las motos ocupan menos hueco y se permiten entre carriles. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Entry")
	bool bIsMotorcycle = false;

	/** Media longitud del vehiculo en cm. Se usa para el hueco minimo. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Entry")
	float HalfLength = 240.0f;
};

/**
 * Perfil completo de un tramo de autopista.
 */
UCLASS(BlueprintType)
class HIGHWAYRACER_API UHRTrafficProfile : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Traffic")
	TArray<FHRTrafficLane> Lanes;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Traffic")
	TArray<FHRTrafficEntry> Vehicles;

	/** Distancia por delante del jugador donde aparece el trafico, en cm. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Traffic|Ventana")
	float SpawnAheadDistance = 30000.0f;   // 300 m

	/** Margen extra por delante antes de reciclar (trafico en sentido contrario). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Traffic|Ventana")
	float DespawnAheadDistance = 42000.0f;

	/** Distancia por detras a partir de la cual se recicla, en cm. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Traffic|Ventana")
	float DespawnBehindDistance = 12000.0f;   // 120 m

	/** Hueco minimo entre dos vehiculos del mismo carril al generar, en cm. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Traffic|Densidad")
	float MinGap = 2600.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Traffic|Densidad", meta = (ClampMin = "0"))
	int32 MaxActiveVehicles = 64;

	/** Intentos de generacion por segundo. Reparte el coste entre frames. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Traffic|Densidad", meta = (ClampMin = "1.0"))
	float SpawnAttemptsPerSecond = 8.0f;

	/** Frenado del trafico ante el vehiculo de delante: distancia de reaccion. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Traffic|IA")
	float FollowDistance = 1800.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Traffic|IA")
	float TrafficAccelKmhPerSec = 14.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Traffic|IA")
	float TrafficBrakeKmhPerSec = 42.0f;
};
