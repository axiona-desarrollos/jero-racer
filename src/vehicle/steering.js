/* ==========================================================================
   HIGHWAY RACER · Modelo de direccion y pedales
   --------------------------------------------------------------------------
   Puerto fiel de Source/HighwayRacer/Vehicle/HRSteeringModel.{h,cpp}

   LAS CONSTANTES DE ESTE ARCHIVO ESTAN DUPLICADAS EN EL C++.
   Si cambias una aqui, cambiala tambien en HRSteeringModel.h (y al reves).
   tests/steering.test.js verifica que sigan coincidiendo.

   CONVENCION DE SIGNO (la del C++, no la del motor de fisica):
     entrada y salida POSITIVAS = girar a la DERECHA.
     yawSlipDeg POSITIVO        = la cola se va por la DERECHA.
   La conversion al signo que espera Rapier se hace en vehicle.js, en el
   limite con el motor — no aqui.
   ========================================================================== */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** FMath::FInterpConstantTo — velocidad constante, SI llega al objetivo. */
export function interpConstantTo(current, target, dt, speed) {
  if (speed <= 0) return target;
  const dist = target - current;
  if (dist * dist < 1e-8) return target;
  const step = speed * dt;
  return current + clamp(dist, -step, step);
}

/** FMath::GetMappedRangeValueClamped */
export function mappedRangeClamped(inA, inB, outA, outB, v) {
  const t = clamp((v - inA) / (inB - inA), 0, 1);
  return outA + (outB - outA) * t;
}

/** Valores por defecto — espejo exacto de HRSteeringModel.h */
export const STEERING_DEFAULTS = Object.freeze({
  fullAuthorityKmh: 40.0,
  minAuthorityKmh: 250.0,
  minAuthority: 0.26,
  turnInRate: 2.1,
  returnRate: 4.8,
  counterSteerRate: 7.0,
  outputExpo: 0.40,
  counterSteerAssist: 0.0,
});

export const PEDAL_DEFAULTS = Object.freeze({
  pressRate: 3.4,
  releaseRate: 7.5,
});

/**
 * Direccion progresiva.
 *
 * El problema: una tecla es binaria. Mapearla directo al tope de giro da un
 * latigazo instantaneo. Un volante real tiene tres constantes de tiempo
 * distintas — meter, soltar y contravolantear — y aqui estan separadas.
 */
export class SteeringModel {
  constructor(o = {}) {
    Object.assign(this, STEERING_DEFAULTS, o);
    this.current = 0;
    this.lastAuthority = 1;
  }

  /**
   * @param {number} raw        -1..1 crudo del mando (+ = derecha)
   * @param {number} speedKmh   velocidad (se ignora el signo)
   * @param {number} yawSlipDeg + = la cola se va por la derecha
   * @returns {number} -1..1 con expo aplicado (+ = derecha)
   */
  update(raw, speedKmh, yawSlipDeg, dt) {
    const expo = v => (v < 0 ? -1 : 1) * Math.pow(Math.abs(v), 1 + this.outputExpo);
    if (!(dt > 1e-6)) return expo(this.current);

    raw = clamp(raw, -1, 1);
    speedKmh = Math.abs(speedKmh);
    if (!Number.isFinite(yawSlipDeg)) yawSlipDeg = 0;

    // 1. Autoridad por velocidad — se aplica AL OBJETIVO, no al resultado.
    //    Aplicada despues de interpolar, el angulo caeria de golpe al acelerar
    //    con el volante puesto.
    this.lastAuthority = mappedRangeClamped(
      this.fullAuthorityKmh, this.minAuthorityKmh, 1.0, this.minAuthority, speedKmh);

    let target = raw * this.lastAuthority;

    // 2. Asistencia de contravolante: mezcla hacia el angulo de deslizamiento.
    //    Ambos en la misma convencion (+ = derecha), asi que la mezcla es directa.
    if (this.counterSteerAssist > 1e-6 && speedKmh > 25.0) {
      const slipNorm = clamp(yawSlipDeg / 25.0, -1, 1);
      target = lerp(target, slipNorm, this.counterSteerAssist);
    }

    // 3. Seleccion de constante de tiempo.
    let rate;
    if (Math.abs(raw) < 1e-3) rate = this.returnRate;
    else if (this.current * target < 0) rate = this.counterSteerRate;
    else if (Math.abs(target) < Math.abs(this.current)) rate = this.returnRate;
    else rate = this.turnInRate;

    // Velocidad constante, no exponencial: el exponencial nunca llega al
    // objetivo y deja un residuo que se siente como volante blando.
    this.current = clamp(interpConstantTo(this.current, target, dt, rate), -1, 1);
    return expo(this.current);
  }

  /** Sin expo. Para animar el volante 3D del interior. */
  get rawCurrent() { return this.current; }

  reset() { this.current = 0; this.lastAuthority = 1; }
}

/**
 * Suavizado de pedales. El teclado da 0 o 1; un acelerador que salta de 0 a
 * 100% en un frame escalona el audio y el control de traccion.
 */
export class PedalModel {
  constructor(o = {}) {
    Object.assign(this, PEDAL_DEFAULTS, o);
    this.current = 0;
  }

  update(raw, dt) {
    if (!(dt > 1e-6)) return this.current;
    const target = clamp(raw, 0, 1);
    const rate = target > this.current ? this.pressRate : this.releaseRate;
    this.current = interpConstantTo(this.current, target, dt, rate);
    return this.current;
  }

  get value() { return this.current; }
  reset() { this.current = 0; }
}
