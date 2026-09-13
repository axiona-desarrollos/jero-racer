/* ==========================================================================
   HIGHWAY RACER · Efectos del vehiculo
   --------------------------------------------------------------------------
   Puerto de Source/HighwayRacer/VFX/HRVehicleFXComponent.{h,cpp}

   HUMO DE NEUMATICO
   Nace en el punto de CONTACTO real de cada rueda trasera, no en el buje, y
   sale despedido hacia atras del coche. La densidad la manda el deslizamiento
   del eje, que ya publica la telemetria.

   LLAMARADA DE ESCAPE
   Un V8 atmosferico escupe llama cuando entra combustible sin quemar al
   escape caliente. Eso pasa en dos sitios:
     1. Al LEVANTAR EL PIE con el motor arriba de vueltas (overrun).
     2. En el corte de inyeccion de un cambio bajo carga.
   La deteccion NO mira solo el acelerador: exige que el regimen este CAYENDO
   de verdad. Es lo que distingue un lift-off con marcha engranada (el motor
   frena al coche y cae en picado) de soltar el gas en punto muerto.
   ========================================================================== */

import * as THREE from 'three';
import { ParticleSystem } from './particles.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Umbrales de la llamarada — los mismos del C++. */
export const FLAME = Object.freeze({
  minRPM: 3800,          // por debajo no hay escape caliente
  armThrottle: 0.65,     // acelerador que hay que haber pisado para armar
  liftThrottle: 0.12,    // por debajo se considera pie levantado
  minRPMDrop: 2600,      // rpm/s de caida que confirman el overrun
  liftWindow: 0.30,      // ventana tras levantar el pie
  cooldown: 0.45,        // evita el efecto ametralladora
  onUpshift: true,
});

export class VehicleFX {
  constructor(scene, vehicle) {
    this.vehicle = vehicle;

    this.humo = new ParticleSystem(700, {
      size: 0.9, sizeGrow: 2.6, drag: 0.90, gravity: 0.55,
      blending: THREE.NormalBlending, opacity: 0.34, soft: 0.5,
    });
    this.llama = new ParticleSystem(220, {
      size: 0.30, sizeGrow: 1.1, drag: 0.80, gravity: 1.2,
      blending: THREE.AdditiveBlending, opacity: 1.0, soft: 0.3,
    });
    this.chispas = new ParticleSystem(120, {
      size: 0.07, sizeGrow: -0.02, drag: 0.985, gravity: -6.0,
      blending: THREE.AdditiveBlending, opacity: 1.0, soft: 0.2,
    });
    scene.add(this.humo.points, this.llama.points, this.chispas.points);

    // estado de disparo
    this.armed = false;
    this.liftTimer = 0;
    this.cooldown = 0;
    this.lastGear = 1;
    this.acumHumo = 0;

    this._v = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._q = new THREE.Quaternion();

    // Salida cuadruple. El C++ usa sockets del esqueleto; CarConcept NO trae
    // escapes modelados (solo matricula y pilotos en la zaga), asi que se
    // colocan donde irian, justo bajo el paragolpes.
    //
    // OJO CON EL ESPACIO: estos offsets van en espacio de CHASIS, y el modelo
    // esta groundOffset por encima. Un punto a "y" del modelo esta a
    // y + groundOffset en chasis. La matricula esta a y=0.315 del modelo, o
    // sea 0.474 de chasis: los escapes van justo debajo.
    const zCola = -1.98;
    const yEscape = 0.30 + vehicle.groundOffset;
    this.escapes = [
      new THREE.Vector3(-0.40, yEscape, zCola),
      new THREE.Vector3(-0.22, yEscape, zCola),
      new THREE.Vector3(0.22, yEscape, zCola),
      new THREE.Vector3(0.40, yEscape, zCola),
    ];
    this.ultimaLlamarada = 0;
  }

  /**
   * @param {object} t  telemetria del frame
   * @param {number} dt segundos
   */
  update(t, dt) {
    const v = this.vehicle;
    const q = v.body.rotation();
    this._q.set(q.x, q.y, q.z, q.w);
    this._fwd.set(0, 0, v.forwardSign).applyQuaternion(this._q);

    this.#humo(t, dt);
    this.#llamaradas(t, dt);

    this.humo.update(dt);
    this.llama.update(dt);
    this.chispas.update(dt);
  }

  // ------------------------------------------------------------------ humo
  #humo(t, dt) {
    const v = this.vehicle, c = v.controller;
    const intensidad = clamp((t.rear - 0.18) / 0.62, 0, 1);
    if (intensidad <= 0.02 || t.airborne) { this.acumHumo = 0; return; }

    // Mas deslizamiento y mas velocidad = mas humo, con tope.
    const porSeg = 8 + intensidad * intensidad * 95 * clamp(t.speed / 60, 0.25, 1.6);
    this.acumHumo += porSeg * dt;
    let n = Math.floor(this.acumHumo);
    this.acumHumo -= n;
    n = Math.min(n, 14);

    for (let k = 0; k < n; k++) {
      const rueda = 2 + (k & 1);                  // solo eje trasero
      if (!c.wheelIsInContact(rueda)) continue;
      const cp = c.wheelContactPoint(rueda);

      // Sale hacia atras del coche, se abre en abanico y sube despacio.
      const atras = -0.8 - Math.random() * 2.6;
      this._v.copy(this._fwd).multiplyScalar(atras);
      const lat = (Math.random() - 0.5) * 2.2;
      this.humo.emit(
        cp.x + (Math.random() - 0.5) * 0.35,
        cp.y + 0.06 + Math.random() * 0.12,
        cp.z + (Math.random() - 0.5) * 0.35,
        this._v.x + lat * 0.4, 0.5 + Math.random() * 1.1, this._v.z + lat * 0.4,
        1.1 + Math.random() * 1.4 + intensidad * 0.9,
        0.5 + Math.random() * 0.5,
        0.74, 0.74, 0.76);
    }
  }

  // ------------------------------------------------------------- llamaradas
  #llamaradas(t, dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.liftTimer = Math.max(0, this.liftTimer - dt);

    const rpm = t.rpm, th = t.throttle, drop = t.rpmDeltaPerSec ?? 0;

    // 1. Armado: hubo carga real con el motor caliente de vueltas.
    if (th >= FLAME.armThrottle && rpm >= FLAME.minRPM) this.armed = true;

    // 2. Deteccion de levantada de pie: abre la ventana y consume el armado.
    if (this.armed && th <= FLAME.liftThrottle) {
      this.liftTimer = FLAME.liftWindow;
      this.armed = false;
    }

    const listo = this.cooldown <= 0;

    // --- caso 1: overrun por levantada -----------------------------------
    if (listo && this.liftTimer > 0 && rpm >= FLAME.minRPM && drop <= -FLAME.minRPMDrop) {
      const f = clamp(0.45 + (Math.abs(drop) / (FLAME.minRPMDrop * 2.5)) * 0.55, 0, 1);
      this.disparar(f, false);
      this.liftTimer = 0;
      return;
    }

    // --- caso 2: corte de inyeccion en subida bajo carga ------------------
    if (FLAME.onUpshift && listo && t.gearNum > this.lastGear && this.lastGear > 0
        && th > 0.5 && rpm >= FLAME.minRPM) {
      this.disparar(clamp(0.35 + t.normalizedRPM * 0.5, 0, 1), true);
    }
    this.lastGear = t.gearNum;
  }

  /** Escupe llama por las cuatro salidas. */
  disparar(intensidad = 1, deCambio = false) {
    const v = this.vehicle;
    const i = clamp(intensidad, 0, 1);
    this.cooldown = FLAME.cooldown;
    this.ultimaLlamarada = i;

    const pos = v.body.translation();
    for (const off of this.escapes) {
      this._v.copy(off).applyQuaternion(this._q);
      const x = pos.x + this._v.x, y = pos.y + this._v.y, z = pos.z + this._v.z;

      const n = 8 + Math.round(i * 14);
      for (let k = 0; k < n; k++) {
        // Una llamarada mide medio metro, no diez. Velocidad corta y vida
        // corta: antes salian disparadas y se quedaban tiradas por el suelo.
        const vel = 2.2 + Math.random() * (3.4 + i * 4.0);
        const dx = this._fwd.x * -vel + (Math.random() - 0.5) * 0.7;
        const dz = this._fwd.z * -vel + (Math.random() - 0.5) * 0.7;
        const dy = (Math.random() - 0.3) * 0.8;
        // CUIDADO CON EL TONE MAPPING: con ACES, subir los tres canales por
        // encima de ~2 satura a blanco y la llama sale amarilla. Lo que da el
        // naranja incandescente es la PROPORCION entre canales, no la
        // magnitud. Se queda justo por encima de 1 y con el azul casi a cero.
        const cal = Math.random();
        let r, g, b, vida;
        if (cal > 0.80) {
          // nucleo azul: pegado a la salida y muy corto de vida
          r = 0.34; g = 0.70; b = 1.85;
          vida = 0.05 + Math.random() * 0.05;
        } else if (cal > 0.55) {
          // punta amarilla, entre el nucleo y la llama
          r = 1.85; g = 0.88; b = 0.12;
          vida = 0.08 + Math.random() * 0.08;
        } else {
          // el cuerpo de la llamarada: naranja profundo
          r = 1.70; g = 0.38; b = 0.03;
          vida = 0.10 + Math.random() * (0.12 + i * 0.10);
        }
        this.llama.emit(x, y, z, dx, dy, dz, vida,
          0.11 + Math.random() * 0.16 * (0.6 + i), r, g, b);
      }
      // chispas: pocas, rapidas y persistentes
      const ch = deCambio ? 5 : 3;
      for (let k = 0; k < ch; k++) {
        this.chispas.emit(x, y, z,
          this._fwd.x * -(4 + Math.random() * 7) + (Math.random() - 0.5) * 1.6,
          0.6 + Math.random() * 1.8,
          this._fwd.z * -(4 + Math.random() * 7) + (Math.random() - 0.5) * 1.6,
          0.30 + Math.random() * 0.45, 0.045 + Math.random() * 0.04,
          2.2, 1.0, 0.22);
      }
    }
  }

  clear() { this.humo.clear(); this.llama.clear(); this.chispas.clear(); }
}
