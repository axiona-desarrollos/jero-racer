// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.
//
// Actor de trafico reciclable.
//
// NO ES UN VEHICULO DE FISICA. El trafico es cinematico: lo mueve el
// subsistema escribiendo transformadas. Meter 60 Chaos Vehicles en escena
// para que hagan de decorado es tirar el presupuesto de fisica del frame en
// coches que el jugador solo adelanta.
//
// La colision se mantiene para que el jugador PUEDA chocar con ellos: el
// cuerpo es cinematico, asi que el impacto lo resuelve el vehiculo del
// jugador contra una masa infinita. Si quieres que el trafico salga despedido,
// activa la simulacion en OnHit y devuelve el actor al pool tras N segundos.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Traffic/HRTrafficTypes.h"
#include "HRTrafficVehicle.generated.h"

class UStaticMeshComponent;
class UStaticMesh;

UCLASS(Blueprintable)
class HIGHWAYRACER_API AHRTrafficVehicle : public AActor, public IHRPoolable
{
	GENERATED_BODY()

public:
	AHRTrafficVehicle();

	//~ IHRPoolable
	virtual void OnAcquiredFromPool_Implementation() override;
	virtual void OnReturnedToPool_Implementation() override;
	//~ End

	/** Variantes de malla/material para que no todos los coches sean iguales. */
	UFUNCTION(BlueprintCallable, Category = "HighwayRacer|Traffic")
	void RandomiseAppearance();

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Traffic")
	TObjectPtr<UStaticMeshComponent> Body;

	/** Se elige una al salir del pool. Deja el array vacio para no variar. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Traffic|Variantes")
	TArray<TObjectPtr<UStaticMesh>> BodyVariants;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Traffic|Variantes")
	TArray<FLinearColor> PaintColors;

	/** Indice del parametro vectorial de color en el material. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Traffic|Variantes")
	FName PaintParameterName = FName("BaseColor");

	/** Gancho para luces traseras, intermitentes, etc. */
	UFUNCTION(BlueprintImplementableEvent, Category = "HighwayRacer|Traffic")
	void OnRecycled();

private:
	UPROPERTY(Transient)
	TObjectPtr<class UMaterialInstanceDynamic> PaintMID;
};
