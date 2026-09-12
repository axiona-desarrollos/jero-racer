// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.

#include "Traffic/HRTrafficVehicle.h"
#include "Components/StaticMeshComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Engine/StaticMesh.h"

AHRTrafficVehicle::AHRTrafficVehicle()
{
	// Lo mueve el subsistema en un bucle unico: este actor no tickea jamas.
	PrimaryActorTick.bCanEverTick = false;

	Body = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Body"));
	SetRootComponent(Body);

	// Cinematico: participa en colisiones pero no lo empuja la fisica.
	Body->SetMobility(EComponentMobility::Movable);
	Body->SetSimulatePhysics(false);
	Body->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
	Body->SetCollisionObjectType(ECC_Vehicle);
	Body->SetCollisionResponseToAllChannels(ECR_Block);
	Body->SetCollisionResponseToChannel(ECC_Camera, ECR_Ignore);

	// A 60 actores, cada sombra proyectada cuenta. Las sombras de contacto
	// del suelo bastan para asentarlos visualmente.
	Body->SetCastShadow(true);
	Body->bCastDynamicShadow = true;
	Body->SetReceivesDecals(false);

	PaintColors = {
		FLinearColor(0.02f, 0.02f, 0.025f),   // negro
		FLinearColor(0.62f, 0.62f, 0.64f),    // plata
		FLinearColor(0.75f, 0.75f, 0.78f),    // blanco
		FLinearColor(0.10f, 0.12f, 0.22f),    // azul oscuro
		FLinearColor(0.28f, 0.04f, 0.05f),    // rojo
	};
}

void AHRTrafficVehicle::OnAcquiredFromPool_Implementation()
{
	RandomiseAppearance();
	OnRecycled();
}

void AHRTrafficVehicle::OnReturnedToPool_Implementation()
{
	// Estado neutro. Todo lo que se encienda durante la vida del actor se
	// apaga AQUI: si no, el siguiente uso hereda el estado del anterior.
	if (Body)
	{
		Body->SetPhysicsLinearVelocity(FVector::ZeroVector);
		Body->SetPhysicsAngularVelocityInDegrees(FVector::ZeroVector);
	}
	SetActorRotation(FRotator::ZeroRotator);
	GetWorldTimerManager().ClearAllTimersForObject(this);
}

void AHRTrafficVehicle::RandomiseAppearance()
{
	if (!Body) { return; }

	if (BodyVariants.Num() > 0)
	{
		const int32 Index = FMath::RandRange(0, BodyVariants.Num() - 1);
		if (UStaticMesh* Mesh = BodyVariants[Index])
		{
			// Solo si cambia: SetStaticMesh recrea el render state y no es gratis.
			if (Body->GetStaticMesh() != Mesh)
			{
				Body->SetStaticMesh(Mesh);
				PaintMID = nullptr;   // el MID pertenecia a la malla anterior
			}
		}
	}

	if (PaintColors.Num() > 0 && !PaintParameterName.IsNone())
	{
		if (!PaintMID)
		{
			PaintMID = Body->CreateDynamicMaterialInstance(0);
		}
		if (PaintMID)
		{
			PaintMID->SetVectorParameterValue(PaintParameterName,
				PaintColors[FMath::RandRange(0, PaintColors.Num() - 1)]);
		}
	}
}
