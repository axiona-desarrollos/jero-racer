// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.
//
// TAREA 4 - TRAFFIC POOLING MANAGER
//
// UTickableWorldSubsystem: vive exactamente lo que vive el mundo, no hay que
// colocar un manager en el nivel ni acordarse de referenciarlo, y muere solo
// al cambiar de mapa. Es el sitio correcto para esto en UE5 — un AActor
// manager es lo que se hacia en UE4 y arrastra problemas de orden de
// BeginPlay y de replicacion que aqui no queremos.
//
// TRES DECISIONES DE ARQUITECTURA:
//
// 1. LOS ACTORES DE TRAFICO NO TICKEAN. El movimiento se resuelve en UN bucle
//    dentro del subsistema, sobre un TArray plano de structs. 64 actores
//    tickeando por separado son 64 saltos de cache y 64 llamadas virtuales;
//    un bucle sobre datos contiguos cabe en cache y vectoriza. A esta escala
//    la diferencia es de un orden de magnitud.
//
// 2. NUNCA SE DESTRUYE NADA. Un SpawnActor a 200 km/h cuesta registrar
//    componentes, construir el render state y alocar. El pool crea N al
//    arrancar y a partir de ahi solo alterna visibilidad, colision y tick.
//    Memoria constante, sin fragmentacion, sin trabajo para el GC.
//
// 3. LA CARRETERA ES UNA FUNCION, NO GEOMETRIA. La posicion de un vehiculo se
//    deriva de (distancia a lo largo del eje, carril). Con eso el trafico es
//    independiente de como se genere la malla de la autopista, y "infinito"
//    sale gratis: la distancia es un float que crece.

#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "Traffic/HRTrafficTypes.h"
#include "HRTrafficSubsystem.generated.h"

class USplineComponent;

/** Estado de un vehiculo activo. Struct plano: se recorre en bucle apretado. */
USTRUCT()
struct FHRTrafficAgent
{
	GENERATED_BODY()

	UPROPERTY()
	TObjectPtr<AActor> Actor = nullptr;

	/** Distancia a lo largo del eje de la via, en cm. */
	float Distance = 0.0f;

	/** Velocidad actual y deseada, en cm/s. */
	float SpeedCms = 0.0f;
	float DesiredSpeedCms = 0.0f;

	int32 LaneIndex = 0;
	int32 EntryIndex = 0;
	float HalfLength = 240.0f;
};

/**
 * Instancias libres de una clase concreta.
 * A nivel de archivo, no anidado: UHT no admite USTRUCT dentro de UCLASS.
 */
USTRUCT()
struct FHRPoolBucket
{
	GENERATED_BODY()

	UPROPERTY()
	TArray<TObjectPtr<AActor>> Free;
};

UCLASS()
class HIGHWAYRACER_API UHRTrafficSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	//~ USubsystem
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override;
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	//~ End

	//~ FTickableGameObject
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;
	virtual bool IsTickable() const override { return bRunning; }
	virtual bool IsTickableInEditor() const override { return false; }
	//~ End

	/**
	 * Arranca el trafico.
	 * @param Profile    perfil de densidad, carriles y mezcla
	 * @param FocusActor normalmente el pawn del jugador: define la ventana
	 * @param RoadOrigin origen y orientacion del eje de la via
	 */
	UFUNCTION(BlueprintCallable, Category = "HighwayRacer|Traffic")
	void StartTraffic(UHRTrafficProfile* Profile, AActor* FocusActor, const FTransform& RoadOrigin);

	/** Devuelve todo al pool y detiene el tick. El pool se conserva. */
	UFUNCTION(BlueprintCallable, Category = "HighwayRacer|Traffic")
	void StopTraffic();

	/** Multiplicador de densidad 0..1 aplicado sobre MaxActiveVehicles. */
	UFUNCTION(BlueprintCallable, Category = "HighwayRacer|Traffic")
	void SetDensityScale(float Scale01);

	/**
	 * Si se asigna, la via sigue el spline en vez del eje recto de RoadOrigin.
	 * Permite autopistas con curvas sin tocar nada mas.
	 */
	UFUNCTION(BlueprintCallable, Category = "HighwayRacer|Traffic")
	void SetRoadSpline(USplineComponent* Spline);

	UFUNCTION(BlueprintPure, Category = "HighwayRacer|Traffic")
	int32 GetActiveCount() const { return Agents.Num(); }

	UFUNCTION(BlueprintPure, Category = "HighwayRacer|Traffic")
	int32 GetPooledCount() const;

	UFUNCTION(BlueprintPure, Category = "HighwayRacer|Traffic")
	int32 GetTotalSpawnedEver() const { return TotalCreated; }

	// --- API de pool de proposito general -----------------------------------
	// Reutilizable para escombros, conos, cualquier actor de alta rotacion.

	/** Saca un actor del pool, creandolo solo si el pool esta vacio. */
	AActor* AcquireFromPool(TSubclassOf<AActor> Class);

	/** Lo devuelve al pool: oculto, sin colision, sin tick. */
	void ReleaseToPool(AActor* Actor);

	/** Pre-crea Count instancias de Class. Llamar en carga, no en juego. */
	void WarmPool(TSubclassOf<AActor> Class, int32 Count);

private:
	// --- ciclo de trafico ----------------------------------------------------
	void TickAgents(float DeltaTime);
	void RecycleOutOfRange();
	void TrySpawn(float DeltaTime);

	// --- geometria de la via -------------------------------------------------
	/** Traduce (distancia, carril) a una transformada en el mundo. */
	FTransform EvaluateRoad(float Distance, int32 LaneIndex) const;

	/** Proyecta una posicion del mundo sobre el eje de la via, en cm. */
	float ProjectOntoRoad(const FVector& WorldLocation) const;

	// --- ayudas --------------------------------------------------------------
	int32 PickLaneWeighted() const;
	int32 PickEntryWeighted() const;
	bool  IsGapFree(int32 LaneIndex, float Distance, float HalfLength) const;
	void  SetActorPooledState(AActor* Actor, bool bPooled) const;

	UPROPERTY(Transient)
	TObjectPtr<UHRTrafficProfile> ActiveProfile = nullptr;

	UPROPERTY(Transient)
	TWeakObjectPtr<AActor> Focus;

	UPROPERTY(Transient)
	TWeakObjectPtr<USplineComponent> RoadSpline;

	UPROPERTY(Transient)
	TArray<FHRTrafficAgent> Agents;

	UPROPERTY(Transient)
	TMap<TObjectPtr<UClass>, FHRPoolBucket> Pools;

	FTransform RoadTransform = FTransform::Identity;

	/** Distancia del foco proyectada sobre el eje. Cache del frame. */
	float FocusDistance = 0.0f;

	float SpawnAccumulator = 0.0f;
	float DensityScale = 1.0f;
	int32 TotalCreated = 0;
	bool  bRunning = false;
};
