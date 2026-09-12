/* ==========================================================================
   HIGHWAY RACER · Motor y transmision
   --------------------------------------------------------------------------
   Datos reales del Coyote 5.0 V8 del Mustang GT S650 y de la caja Ford 10R80,
   tomados de AHRVehiclePawn::ConfigureEngine / ConfigureTransmission.

   La meseta ancha de par entre 3500 y 5500 rpm es lo que define el caracter
   de un V8 atmosferico frente a un turbo, y es lo que se va a oir cuando
   conectemos el audio.
   ========================================================================== */

import { clamp } from './steering.js';

/** Curva de par NORMALIZADA (0..1 sobre maxTorque) contra RPM. */
const TORQUE_CURVE = [
  [760,  0.40],
  [1500, 0.66],
  [2500, 0.84],
  [3500, 0.94],
  [4900, 1.00],   // par maximo — 567 Nm
  [5800, 0.97],
  [6600, 0.90],
  [7250, 0.82],   // potencia maxima — 486 CV
  [7500, 0.55],   // caida contra el limitador
];

function sampleCurve(rpm) {
  const c = TORQUE_CURVE;
  if (rpm <= c[0][0]) return c[0][1];
  if (rpm >= c[c.length - 1][0]) return c[c.length - 1][1];
  for (let i = 0; i < c.length - 1; i++) {
    const [r0, v0] = c[i], [r1, v1] = c[i + 1];
    if (rpm <= r1) return v0 + (v1 - v0) * ((rpm - r0) / (r1 - r0));
  }
  return 0;
}

export class Powertrain {
  constructor(o = {}) {
    this.maxTorque   = o.maxTorque   ?? 567.0;    // Nm
    this.maxRPM      = o.maxRPM      ?? 7500.0;
    this.idleRPM     = o.idleRPM     ?? 760.0;
    this.revUpRate   = o.revUpRate   ?? 9000.0;   // rpm/s libres
    this.revDownRate = o.revDownRate ?? 4200.0;

    // Ford 10R80, relaciones reales + grupo final del Performance Pack.
    this.gears       = o.gears ?? [4.696, 2.985, 2.146, 1.769, 1.520,
                                   1.275, 1.000, 0.854, 0.689, 0.636];
    this.finalRatio  = o.finalRatio  ?? 3.55;
    this.efficiency  = o.efficiency  ?? 0.92;

    this.changeUpRPM   = o.changeUpRPM   ?? 6900.0;
    this.changeDownRPM = o.changeDownRPM ?? 2300.0;
    this.gearChangeTime = o.gearChangeTime ?? 0.11;   // el 10R80 es rapido

    this.automatic = o.automatic ?? true;

    this.gear = 1;            // 1..10 · 0 punto muerto · -1 reversa
    this.rpm = this.idleRPM;
    this.shiftTimer = 0;
    this.onLimiter = false;
  }

  get ratio() {
    if (this.gear > 0) return this.gears[this.gear - 1];
    if (this.gear < 0) return -2.940;                  // reversa
    return 0;
  }

  /**
   * @param {number} throttle01   acelerador ya suavizado
   * @param {number} wheelRadsPerSec  velocidad angular media del eje motriz
   * @returns {{force:number, rpm:number, gear:number, shifting:boolean}}
   *          force = newton a repartir entre las ruedas motrices
   */
  update(throttle01, wheelRadsPerSec, dt) {
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    const shifting = this.shiftTimer > 0;
    const ratio = this.ratio;

    // --- regimen -----------------------------------------------------------
    // Con marcha engranada el motor esta atado a las ruedas. En punto muerto
    // o durante el cambio sube y baja libre, con la inercia del ciguenal.
    if (ratio !== 0 && !shifting) {
      const rpmFromWheels = Math.abs(wheelRadsPerSec) * (60 / (2 * Math.PI))
                          * Math.abs(ratio) * this.finalRatio;
      this.rpm = clamp(Math.max(rpmFromWheels, this.idleRPM), this.idleRPM, this.maxRPM);
    } else {
      const target = throttle01 > 0.05 ? this.maxRPM * 0.62 : this.idleRPM;
      const rate = target > this.rpm ? this.revUpRate : this.revDownRate;
      this.rpm = clamp(this.rpm + Math.sign(target - this.rpm) * rate * dt,
                       this.idleRPM, this.maxRPM);
    }
    this.onLimiter = this.rpm >= this.maxRPM - 120;

    // --- caja automatica ---------------------------------------------------
    if (this.automatic && !shifting && this.gear > 0) {
      if (this.rpm >= this.changeUpRPM && this.gear < this.gears.length) {
        this.gear++; this.shiftTimer = this.gearChangeTime;
      } else if (this.rpm <= this.changeDownRPM && this.gear > 1) {
        this.gear--; this.shiftTimer = this.gearChangeTime;
      }
    }

    // --- par a la rueda ----------------------------------------------------
    if (shifting || ratio === 0 || this.onLimiter) {
      return { force: 0, rpm: this.rpm, gear: this.gear, shifting };
    }
    const engineTorque = this.maxTorque * sampleCurve(this.rpm) * throttle01;
    const wheelTorque  = engineTorque * Math.abs(ratio) * this.finalRatio * this.efficiency;
    return {
      torque: wheelTorque * Math.sign(ratio),
      rpm: this.rpm, gear: this.gear, shifting,
    };
  }

  shiftUp()   { if (!this.automatic && this.gear < this.gears.length) { this.gear++; this.shiftTimer = this.gearChangeTime; } }
  shiftDown() { if (!this.automatic && this.gear > -1) { this.gear--; this.shiftTimer = this.gearChangeTime; } }

  /** Texto para el HUD: R · N · 1..10 */
  get gearLabel() { return this.gear < 0 ? 'R' : this.gear === 0 ? 'N' : String(this.gear); }

  get normalizedRPM() {
    return clamp((this.rpm - this.idleRPM) / (this.maxRPM - this.idleRPM), 0, 1);
  }

  reset() { this.gear = 1; this.rpm = this.idleRPM; this.shiftTimer = 0; }
}
