// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.

using UnrealBuildTool;

public class HighwayRacerEditorTarget : TargetRules
{
	public HighwayRacerEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_4;
		ExtraModuleNames.Add("HighwayRacer");
	}
}
