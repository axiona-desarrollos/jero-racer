/* ==========================================================================
   HIGHWAY RACER · Motor y transmision
   --------------------------------------------------------------------------
   Datos reales del Coyote 5.0 V8 del Mustang GT S650 y de la caja Ford 10R80,
   tomados de AHRVehiclePawn::ConfigureEngine / ConfigureTransmission.

   LAS CONSTANTES DE ESTE ARCHIVO ESTAN DUPLICADAS EN EL C++ (HRVehiclePawn.cpp).
   tests/powertrain.test.js verifica que sigan coincidiendo.
   ========================================================================== */

import { clamp } from './steering.js';

/** Curva de par NORMALIZADA (0..1 sobre maxTorque) contra RPM. */
export const TORQUE_CURVE = Object.freeze([
  [760, 0.40],
  [1500, 0.66],
  [2500, 0.84],
  [3500, 0.94],
  [4900, 1.00],   // par maximo — 567 Nm
  [5800, 0.97],
  [6600, 0.90],
  [7250, 0.82],   // potencia maxima — 486 CV
  [7500, 0.55],   // caida contra el limitador
]);

export function sampleTorqueCurve(rpm) {
  const c = TORQUE_CURVE;
  if (!(rpm > c[0][0])) return c[0][1];
  if (rpm >= c[c.length - 1][0]) return c[c.length - 1][1];
  for (let i = 0; i < c.length - 1; i++) {
    const [r0, v0] = c[i], [r1, v1] = c[i + 1];
    if (rpm <= r1) return v0 + (v1 - v0) * ((rpm - r0) / (r1 - r0));
  }
  return 0;
}

export const POWERTRAIN_DEFAULTS = Object.freeze({
  maxTorque: 567.0,
  maxRPM: 7500.0,
  idleRPM: 760.0,
  revUpRate: 9000.0,
  revDownRate: 4200.0,
  // Ford 10R80, relaciones reales.
  gears: Object.freeze([4.696, 2.985, 2.146, 1.769, 1.520, 1.275, 1.000, 0.854, 0.689, 0.636]),
  reverseRatio: 2.940,
  finalRatio: 3.55,
  efficiency: 0.92,
  changeUpRPM: 6900.0,
  changeDownRPM: 2300.0,
  gearChangeTime: 0.11,   // el 10R80 es rapido
  automatic: true,
});

export class Powertrain {
  constructor(o = {}) {
    Object.assign(this, POWERTRAIN_DEFAULTS, o);
    this.gears = [...this.gears];
    this.reset();
  }

  /** >0 marcha adelante · 0 punto muerto · <0 reversa */
  get ratio() {
    if (this.gear > 0) return this.gears[this.gear - 1];
    if (this.gear < 0) return -this.reverseRatio;
    return 0;
  }

  /**
   * @param {number} throttle01       acelerador ya suavizado
   * @param {number} wheelRadsPerSec  velocidad angular REAL del eje motriz
   * @returns {{torque:number, rpm:number, gear:number, shifting:boolean, onLimiter:boolean}}
   *          torque = Nm en la rueda, con signo (negativo = marcha atras)
   */
  update(throttle01, wheelRadsPerSec, dt) {
    if (!(dt > 0)) dt = 0;
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    if (!Number.isFinite(wheelRadsPerSec)) wheelRadsPerSec = 0;
    throttle01 = clamp(throttle01, 0, 1);

    // --- regimen, con la relacion ANTERIOR al posible cambio ---------------
    // Con marcha engranada el motor va atado a las ruedas. En punto muerto o
    // durante el cambio el embrague esta abierto y sube/baja libre.
    const rpmAntes = this.rpm;
    const ratioBefore = this.ratio;
    if (ratioBefore !== 0 && this.shiftTimer <= 0) {
      const rpmFromWheels = Math.abs(wheelRadsPerSec) * (60 / (2 * Math.PI))
        * Math.abs(ratioBefore) * this.finalRatio;
      this.rpm = clamp(Math.max(rpmFromWheels, this.idleRPM), this.idleRPM, this.maxRPM);
    } else {
      const target = throttle01 > 0.05 ? this.maxRPM * 0.62 : this.idleRPM;
      const rate = target > this.rpm ? this.revUpRate : this.revDownRate;
      this.rpm = clamp(this.rpm + Math.sign(target - this.rpm) * rate * dt,
        this.idleRPM, this.maxRPM);
    }
    // Derivada del regimen: es LA senal que distingue un lift-off con marcha
    // engranada (el motor frena al coche y cae en picado) de soltar el gas en
    // punto muerto. Sin ella la llamarada saldria donde no toca.
    this.rpmDeltaPerSec = dt > 0 ? (this.rpm - rpmAntes) / dt : 0;
    this.onLimiter = this.rpm >= this.maxRPM - 120;

    // --- caja automatica ---------------------------------------------------
    if (this.automatic && this.shiftTimer <= 0 && this.gear > 0) {
      if (this.rpm >= this.changeUpRPM && this.gear < this.gears.length) {
        this.gear++; this.shiftTimer = this.gearChangeTime;
      } else if (this.rpm <= this.changeDownRPM && this.gear > 1) {
        this.gear--; this.shiftTimer = this.gearChangeTime;
      }
    }

    // --- par a la rueda ----------------------------------------------------
    // OJO: 'shifting' y 'ratio' se reevaluan DESPUES de decidir el cambio.
    // Leidos antes, el tick del cambio entregaba par completo con la relacion
    // vieja — un pico del 57% al pasar de 1a a 2a, justo cuando el C++ manda
    // corte de inyeccion.
    const shifting = this.shiftTimer > 0;
    const ratio = this.ratio;

    // EngineLoad del C++: un motor a 6000 rpm con el pie levantado tiene
    // vueltas altas y carga cero — y suena completamente distinto.
    this.load = shifting ? 0
      : clamp(throttle01 * (0.55 + 0.45 * this.normalizedRPM), 0, 1);

    let torque = 0;
    if (!shifting && ratio !== 0 && !this.onLimiter) {
      const engineTorque = this.maxTorque * sampleTorqueCurve(this.rpm) * throttle01;
      torque = engineTorque * Math.abs(ratio) * this.finalRatio * this.efficiency
        * Math.sign(ratio);
    }
    return { torque, rpm: this.rpm, gear: this.gear, shifting,
      onLimiter: this.onLimiter, rpmDeltaPerSec: this.rpmDeltaPerSec,
      load: this.load };
  }

  /** Cambio manual. Ignorado si la caja esta en automatico. */
  shiftUp() {
    if (this.automatic || this.shiftTimer > 0) return;
    if (this.gear < this.gears.length) { this.gear++; this.shiftTimer = this.gearChangeTime; }
  }

  shiftDown() {
    if (this.automatic || this.shiftTimer > 0) return;
    if (this.gear > 1) { this.gear--; this.shiftTimer = this.gearChangeTime; }
  }

  /** Reversa: solo se puede engranar casi parado, como una caja real. */
  engageReverse(speedKmh) {
    if (Math.abs(speedKmh) < 3 && this.gear >= 0) {
      this.gear = -1; this.shiftTimer = this.gearChangeTime; return true;
    }
    return false;
  }

  engageForward(speedKmh) {
    if (Math.abs(speedKmh) < 3 && this.gear < 0) {
      this.gear = 1; this.shiftTimer = this.gearChangeTime; return true;
    }
    return false;
  }

  /** Texto para el HUD: R · N · 1..10 */
  get gearLabel() { return this.gear < 0 ? 'R' : this.gear === 0 ? 'N' : String(this.gear); }

  get normalizedRPM() {
    return clamp((this.rpm - this.idleRPM) / (this.maxRPM - this.idleRPM), 0, 1);
  }

  reset() {
    this.gear = 1;
    this.rpm = this.idleRPM;
    this.shiftTimer = 0;
    this.onLimiter = false;
    this.rpmDeltaPerSec = 0;
    this.load = 0;
  }
}
