// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.

using UnrealBuildTool;

public class HighwayRacer : ModuleRules
{
	public HighwayRacer(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		// IWYU: obliga a que cada .cpp declare sus includes. En un modulo de
		// vehiculos esto importa porque ChaosVehicles arrastra medio PhysicsCore.
		bUseUnity = false;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",

			// Input
			"EnhancedInput",

			// Fisica de vehiculos. ChaosVehicles expone el movement component y
			// los structs de configuracion; ChaosVehiclesCore trae los tipos de
			// bajo nivel (FWheelState, curvas) que usamos en telemetria.
			"ChaosVehicles",
			"ChaosVehiclesCore",
			"PhysicsCore",
			"Chaos",

			// VFX
			"Niagara",
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"AudioMixer",
			"AudioExtensions",   // parametros de MetaSounds via UAudioComponent
			"DeveloperSettings", // UHRVehicleSettings
		});

		// --- FMOD (opcional) -------------------------------------------------
		// Si integras FMOD Studio, descomenta. El codigo de audio esta detras
		// de la interfaz IHRAudioBackend, asi que no hay #ifdef regados por el
		// resto del modulo: solo cambia la implementacion del backend.
		//
		// if (Target.Platform == UnrealTargetPlatform.Win64)
		// {
		//     PrivateDependencyModuleNames.Add("FMODStudio");
		//     PublicDefinitions.Add("HR_WITH_FMOD=1");
		// }
		// else
		// {
		//     PublicDefinitions.Add("HR_WITH_FMOD=0");
		// }
		PublicDefinitions.Add("HR_WITH_FMOD=0");
	}
}
