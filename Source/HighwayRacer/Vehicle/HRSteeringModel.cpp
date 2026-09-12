// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.

#include "Vehicle/HRSteeringModel.h"

float FHRSteeringModel::Update(float RawInput, float SpeedKmh, float YawSlipDeg, float DeltaTime)
{
	if (DeltaTime <= KINDA_SMALL_NUMBER)
	{
		return FMath::Sign(Current) * FMath::Pow(FMath::Abs(Current), 1.0f + OutputExpo);
	}

	RawInput = FMath::Clamp(RawInput, -1.0f, 1.0f);
	SpeedKmh = FMath::Abs(SpeedKmh);

	// --- 1. Autoridad por velocidad ---------------------------------------
	// Se aplica AL OBJETIVO, no al resultado. Si se aplicase despues, al
	// acelerar con el volante puesto el angulo caeria de golpe.
	LastAuthority = FMath::GetMappedRangeValueClamped(
		FVector2f(FullAuthorityKmh, MinAuthorityKmh),
		FVector2f(1.0f, MinAuthority),
		SpeedKmh);

	float Target = RawInput * LastAuthority;

	// --- 2. Asistencia de contravolante -----------------------------------
	// Cuando el coche va cruzado, el volante "quiere" irse hacia el lado del
	// deslizamiento. Mezclamos parte de ese angulo en el objetivo.
	if (CounterSteerAssist > KINDA_SMALL_NUMBER && SpeedKmh > 25.0f)
	{
		// 25 grados de deriva se consideran el tope util de la asistencia.
		const float SlipNorm = FMath::Clamp(YawSlipDeg / 25.0f, -1.0f, 1.0f);
		Target = FMath::Lerp(Target, FMath::Clamp(SlipNorm, -1.0f, 1.0f), CounterSteerAssist);
	}

	// --- 3. Seleccion de constante de tiempo ------------------------------
	float Rate;
	if (FMath::IsNearlyZero(RawInput, 1e-3f))
	{
		// Sin tecla: el avance del eje devuelve el volante al centro.
		Rate = ReturnRate;
	}
	else if (Current * Target < 0.0f)
	{
		// El objetivo esta al otro lado del centro: contravolante.
		Rate = CounterSteerRate;
	}
	else if (FMath::Abs(Target) < FMath::Abs(Current))
	{
		// Mismo lado pero pidiendo menos angulo: sigue siendo soltar.
		Rate = ReturnRate;
	}
	else
	{
		Rate = TurnInRate;
	}

	// Interpolacion de VELOCIDAD CONSTANTE, no exponencial: FInterpTo nunca
	// llega al objetivo y deja un error residual que en direccion se siente
	// como un volante blando. FInterpConstantTo llega y se queda.
	Current = FMath::FInterpConstantTo(Current, Target, DeltaTime, Rate);
	Current = FMath::Clamp(Current, -1.0f, 1.0f);

	// --- 4. Expo de salida -------------------------------------------------
	const float Sign = (Current < 0.0f) ? -1.0f : 1.0f;
	return Sign * FMath::Pow(FMath::Abs(Current), 1.0f + OutputExpo);
}
