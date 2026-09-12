// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.

using UnrealBuildTool;

public class HighwayRacerTarget : TargetRules
{
	public HighwayRacerTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_4;
		ExtraModuleNames.Add("HighwayRacer");
	}
}
