/* ==========================================================================
   HIGHWAY RACER · Modelo de direccion y pedales
   --------------------------------------------------------------------------
   Puerto fiel de Source/HighwayRacer/Vehicle/HRSteeringModel.{h,cpp}
   Las constantes y el orden de las operaciones son los mismos: si afinas una
   aqui, afinala tambien alla (o al reves). Es la misma sensacion de volante.
   ========================================================================== */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp  = (a, b, t) => a + (b - a) * t;

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

/**
 * FHRSteeringModel.
 *
 * El problema: una tecla es binaria. Mapear la flecha directo al tope de giro
 * da un latigazo instantaneo. Un volante real tiene tres constantes de tiempo
 * distintas — meter, soltar y contravolantear — y aqui estan separadas.
 */
export class SteeringModel {
  constructor(o = {}) {
    /** Por debajo de esta velocidad la autoridad de giro es total. */
    this.fullAuthorityKmh   = o.fullAuthorityKmh   ?? 40.0;
    /** A partir de aqui la autoridad se queda en minAuthority. */
    this.minAuthorityKmh    = o.minAuthorityKmh    ?? 250.0;
    /** Fraccion del tope de giro disponible a velocidad maxima. */
    this.minAuthority       = o.minAuthority       ?? 0.26;

    this.turnInRate         = o.turnInRate         ?? 2.1;  // meter volante
    this.returnRate         = o.returnRate         ?? 4.8;  // soltar
    this.counterSteerRate   = o.counterSteerRate   ?? 7.0;  // cruzar el centro

    /** Expo de salida. Mas resolucion cerca del centro. */
    this.outputExpo         = o.outputExpo         ?? 0.40;
    /** 0 = simulacion pura. 0.3-0.5 = arcade asistido en derrape. */
    this.counterSteerAssist = o.counterSteerAssist ?? 0.0;

    this.current = 0;
    this.lastAuthority = 1;
  }

  /**
   * @param {number} raw        -1..1 crudo del teclado
   * @param {number} speedKmh   velocidad (se ignora el signo)
   * @param {number} yawSlipDeg angulo entre morro y vector velocidad
   * @returns {number} valor -1..1 listo para la direccion
   */
  update(raw, speedKmh, yawSlipDeg, dt) {
    const expo = (v) => (v < 0 ? -1 : 1) * Math.pow(Math.abs(v), 1 + this.outputExpo);
    if (dt <= 1e-6) return expo(this.current);

    raw = clamp(raw, -1, 1);
    speedKmh = Math.abs(speedKmh);

    // 1. Autoridad por velocidad — se aplica AL OBJETIVO, no al resultado.
    //    Si se aplicara despues de interpolar, al acelerar con el volante
    //    puesto el angulo caeria de golpe.
    this.lastAuthority = mappedRangeClamped(
      this.fullAuthorityKmh, this.minAuthorityKmh, 1.0, this.minAuthority, speedKmh);

    let target = raw * this.lastAuthority;

    // 2. Asistencia de contravolante: mezcla hacia el angulo de deslizamiento.
    if (this.counterSteerAssist > 1e-6 && speedKmh > 25.0) {
      const slipNorm = clamp(yawSlipDeg / 25.0, -1, 1);
      target = lerp(target, slipNorm, this.counterSteerAssist);
    }

    // 3. Seleccion de constante de tiempo.
    let rate;
    if (Math.abs(raw) < 1e-3)                            rate = this.returnRate;
    else if (this.current * target < 0)                  rate = this.counterSteerRate;
    else if (Math.abs(target) < Math.abs(this.current))  rate = this.returnRate;
    else                                                 rate = this.turnInRate;

    // Velocidad constante, no exponencial: el exponencial nunca llega al
    // objetivo y deja un error residual que se siente como volante blando.
    this.current = clamp(interpConstantTo(this.current, target, dt, rate), -1, 1);

    return expo(this.current);
  }

  /** Sin expo. Para animar el volante 3D del interior. */
  get rawCurrent() { return this.current; }

  reset() { this.current = 0; this.lastAuthority = 1; }
}

/**
 * FHRPedalModel. Mismo problema que la direccion: el teclado da 0 o 1, y un
 * acelerador que salta de 0 a 100% en un frame escalona el audio y la traccion.
 */
export class PedalModel {
  constructor(o = {}) {
    this.pressRate   = o.pressRate   ?? 3.4;
    this.releaseRate = o.releaseRate ?? 7.5;   // soltar es mas rapido que pisar
    this.current = 0;
  }
  update(raw, dt) {
    const target = clamp(raw, 0, 1);
    const rate = target > this.current ? this.pressRate : this.releaseRate;
    this.current = interpConstantTo(this.current, target, dt, rate);
    return this.current;
  }
  reset() { this.current = 0; }
}
