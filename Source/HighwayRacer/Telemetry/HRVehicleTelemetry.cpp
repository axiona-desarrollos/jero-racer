// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.

#include "Telemetry/HRVehicleTelemetry.h"
#include "GameFramework/Actor.h"

namespace
{
	/** Devuelve la interfaz si el actor la implementa, o nullptr. */
	const IHRTelemetryProvider* AsProvider(const AActor* Actor)
	{
		return Actor ? Cast<const IHRTelemetryProvider>(Actor) : nullptr;
	}
}

void UHRTelemetryLibrary::GetVehicleTelemetry(const AActor* Actor, FHRVehicleTelemetry& Telemetry, bool& bValid)
{
	if (const IHRTelemetryProvider* Provider = AsProvider(Actor))
	{
		Provider->GetVehicleTelemetry(Telemetry);
		bValid = true;
		return;
	}
	Telemetry = FHRVehicleTelemetry();
	bValid = false;
}

float UHRTelemetryLibrary::GetEngineRPM(const AActor* Actor)
{
	FHRVehicleTelemetry T;
	if (const IHRTelemetryProvider* Provider = AsProvider(Actor))
	{
		Provider->GetVehicleTelemetry(T);
	}
	return T.EngineRPM;
}

float UHRTelemetryLibrary::GetEngineLoad(const AActor* Actor)
{
	FHRVehicleTelemetry T;
	if (const IHRTelemetryProvider* Provider = AsProvider(Actor))
	{
		Provider->GetVehicleTelemetry(T);
	}
	return T.EngineLoad;
}

int32 UHRTelemetryLibrary::GetCurrentGear(const AActor* Actor)
{
	FHRVehicleTelemetry T;
	if (const IHRTelemetryProvider* Provider = AsProvider(Actor))
	{
		Provider->GetVehicleTelemetry(T);
	}
	return T.Gear;
}

FText UHRTelemetryLibrary::GetGearDisplay(const AActor* Actor)
{
	const int32 Gear = GetCurrentGear(Actor);
	if (Gear < 0)
	{
		return NSLOCTEXT("HighwayRacer", "GearReverse", "R");
	}
	if (Gear == 0)
	{
		return NSLOCTEXT("HighwayRacer", "GearNeutral", "N");
	}
	return FText::AsNumber(Gear);
}
