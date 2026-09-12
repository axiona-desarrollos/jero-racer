// Copyright Axiona Desarrollos Inteligentes S.A.S. All Rights Reserved.
//
// Modelo de direccion y pedales para entrada digital (teclado / D-pad).
//
// EL PROBLEMA: una tecla es binaria. Si mapeas Flecha-Izquierda directo a
// SetSteeringInput(-1) el coche pega un latigazo instantaneo al tope de giro;
// a 200 km/h eso es un trompo garantizado y no se parece en nada a girar un
// volante. Un volante real tiene tres constantes de tiempo distintas:
//
//   1. Meter volante   - el brazo empuja contra el par de autoalineacion. Lento.
//   2. Soltar volante  - el propio avance del eje lo devuelve al centro. Rapido.
//   3. Contravolante   - cruzar el centro para recoger un derrape. Lo mas rapido.
//
// Ademas la autoridad de giro cae con la velocidad: a 30 km/h el tope util son
// 38 grados; a 240 km/h pedir 38 grados vuelca el coche. Por eso el tope se
// escala con una curva de velocidad ANTES de interpolar, no despues: asi la
// interpolacion trabaja siempre contra el objetivo real y no hay saltos cuando
// el coche acelera con el volante puesto.

#pragma once

#include "CoreMinimal.h"
#include "HRSteeringModel.generated.h"

/**
 * Direccion progresiva. Estado propio: llamar Update() una vez por frame.
 */
USTRUCT(BlueprintType)
struct HIGHWAYRACER_API FHRSteeringModel
{
	GENERATED_BODY()

	/** Por debajo de esta velocidad la autoridad de giro es total (1.0). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Authority", meta = (ClampMin = "0.0"))
	float FullAuthorityKmh = 40.0f;

	/** A partir de esta velocidad la autoridad se queda en MinAuthority. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Authority", meta = (ClampMin = "1.0"))
	float MinAuthorityKmh = 250.0f;

	/** Fraccion del tope de giro disponible a velocidad maxima. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Authority", meta = (ClampMin = "0.05", ClampMax = "1.0"))
	float MinAuthority = 0.26f;

	/** Unidades de input por segundo al meter volante. 1.0 = tope en 1 s. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rates", meta = (ClampMin = "0.1"))
	float TurnInRate = 2.1f;

	/** Velocidad de retorno al centro cuando se suelta la tecla. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rates", meta = (ClampMin = "0.1"))
	float ReturnRate = 4.8f;

	/** Velocidad al cruzar el centro (contravolante). El gesto mas urgente. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rates", meta = (ClampMin = "0.1"))
	float CounterSteerRate = 7.0f;

	/**
	 * Expo de salida. 0 = lineal. Valores altos dan mas resolucion cerca del
	 * centro, que es donde se corrige en autopista. Se aplica DESPUES de
	 * interpolar para no deformar las constantes de tiempo.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Response", meta = (ClampMin = "0.0", ClampMax = "1.5"))
	float OutputExpo = 0.40f;

	/**
	 * Asistencia de contravolante. Mezcla hacia el angulo de deslizamiento del
	 * tren trasero cuando el coche esta cruzado. 0 = desactivada (simulacion),
	 * 0.3-0.5 = arcade asistido. No sustituye al jugador: solo adelanta parte
	 * de la correccion para que el teclado sea jugable en derrape.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Assist", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float CounterSteerAssist = 0.0f;

	/**
	 * @param RawInput   -1..1 crudo del Enhanced Input (teclado: -1, 0 o 1)
	 * @param SpeedKmh   velocidad longitudinal con signo ignorado
	 * @param YawSlipDeg angulo entre el morro y el vector velocidad, en grados
	 *                   (positivo = la cola se va por la derecha). Solo se usa
	 *                   si CounterSteerAssist > 0.
	 * @return valor listo para SetSteeringInput(), en -1..1
	 */
	float Update(float RawInput, float SpeedKmh, float YawSlipDeg, float DeltaTime);

	/** Ultimo valor interpolado, sin expo. Util para animar el volante 3D. */
	float GetRawCurrent() const { return Current; }

	/** Autoridad aplicada en el ultimo Update (para HUD / depuracion). */
	float GetLastAuthority() const { return LastAuthority; }

	void Reset() { Current = 0.0f; LastAuthority = 1.0f; }

private:
	float Current       = 0.0f;
	float LastAuthority = 1.0f;
};

/**
 * Suavizado de pedales. Mismo problema que la direccion: el teclado da 0 o 1.
 * Un acelerador que pasa de 0 a 100% en un frame hace que el control de
 * traccion y el audio de motor se vean escalonados.
 */
USTRUCT(BlueprintType)
struct HIGHWAYRACER_API FHRPedalModel
{
	GENERATED_BODY()

	/** Unidades por segundo al pisar. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rates", meta = (ClampMin = "0.1"))
	float PressRate = 3.4f;

	/** Unidades por segundo al soltar. Mas rapido: levantar el pie es instantaneo. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rates", meta = (ClampMin = "0.1"))
	float ReleaseRate = 7.5f;

	float Update(float RawInput, float DeltaTime)
	{
		const float Target = FMath::Clamp(RawInput, 0.0f, 1.0f);
		const float Rate   = (Target > Current) ? PressRate : ReleaseRate;
		Current = FMath::FInterpConstantTo(Current, Target, DeltaTime, Rate);
		return Current;
	}

	float GetCurrent() const { return Current; }
	void Reset() { Current = 0.0f; }

private:
	float Current = 0.0f;
};
