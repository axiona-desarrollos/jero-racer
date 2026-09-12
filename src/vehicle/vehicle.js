/* ==========================================================================
   HIGHWAY RACER · Vehiculo
   --------------------------------------------------------------------------
   Rapier DynamicRayCastVehicleController + el modelo CarConcept.

   Por que raycast y no cuerpos rigidos por rueda: es el mismo enfoque que usa
   Chaos Vehicles en Unreal — cada rueda es un rayo con muelle. Estable a alta
   velocidad, barato, y con el mismo comportamiento en cualquier framerate.

   La geometria NO esta hardcodeada: las posiciones de buje y el radio se leen
   del propio GLB. Si cambias de coche, esto sigue valiendo.

   SEPARACION SIMULACION / PRESENTACION
     stepControls()  fija mandos y llama a updateVehicle  -> ANTES de world.step()
     capture()       lee el estado ya integrado           -> DESPUES de world.step()
     render(alpha)   interpola entre los dos ultimos capture()
   Leer las poses dentro de stepControls (como hacia la version anterior) pinta
   el estado ANTERIOR al paso: un frame entero de retardo constante.
   ========================================================================== */

import * as THREE from 'three';
import { clamp } from './steering.js';

const KMH = 3.6;
const WHEEL_NODES = ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR'];
const FL = 0, FR = 1, RL = 2, RR = 3;

/**
 * El coche mira a +Z y +Y es arriba, luego cross(up, forward) = Y x Z = +X:
 * +X es la IZQUIERDA del coche. Un angulo POSITIVO en setWheelSteering rota la
 * rueda hacia +X, es decir hacia la izquierda. Nuestra convencion (la del C++)
 * es "+ = derecha". De ahi este signo.
 *
 * Sin el, la flecha izquierda giraba el coche a la derecha.
 */
const STEER_SIGN = -1;

/** Reparto de frenada delantero/trasero de un GT. */
const BRAKE_SPLIT_FRONT = 0.65;
const MAX_BRAKE_TORQUE = 4500;
const HANDBRAKE_TORQUE = 6000;

export class Vehicle {
  constructor(RAPIER, world, gltfScene, opts = {}) {
    this.R = RAPIER;
    this.world = world;
    this.model = gltfScene;

    this.mass = opts.mass ?? 1780.0;
    this.maxSteerAngle = opts.maxSteerAngle ?? THREE.MathUtils.degToRad(38);
    this.spawn = (opts.spawn ?? new THREE.Vector3(0, 0.06, 0)).clone();

    // Temporales reutilizados: en el camino caliente no se asigna memoria.
    // Antes se creaban ~15 objetos THREE por tick (~1000/s) y cada pausa del
    // recolector se convertia en deuda del acumulador.
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);

    this._lastSteer = 0;
    this._lastDt = 1 / 60;
    this._prevSpin = [0, 0, 0, 0];
    // Tope fisico: ni en 1a con el motor al corte la rueda gira mas que esto.
    // 7500 rpm / (4.696 * 3.55) = 450 rpm de rueda = 47 rad/s. Con margen x2.
    this.maxWheelRads = opts.maxWheelRads ?? 100;

    this.#measure();
    this.#buildBody();
    this.#buildWheels();
    this.#rigVisuals();
    this.#initSnapshots();
  }

  // ----------------------------------------------------------- medir el GLB
  #measure() {
    this.model.updateMatrixWorld(true);

    this.hubs = [];
    for (const name of WHEEL_NODES) {
      const node = this.model.getObjectByName(name);
      if (!node) throw new Error(`El modelo no tiene el nodo "${name}"`);
      const p = new THREE.Vector3();
      node.getWorldPosition(p);
      const bb = new THREE.Box3().setFromObject(node);

      // CarConcept viene con las ruedas DELANTERAS giradas 30 grados de
      // fabrica: es una pose de render. El eje de las traseras es (1,0,0)
      // limpio, el de las delanteras (0.866,0,0.5). Si no se quita, la
      // direccion del juego se suma a esa pose y las ruedas bambolean sobre
      // un eje torcido en vez de rodar.
      const restQ = new THREE.Quaternion();
      node.getWorldQuaternion(restQ);
      // OJO CON EL SIGNO: una rotacion de +phi sobre Y lleva X a
      // (cos phi, 0, -sin phi). Con el eje en (0.866, 0, +0.5) el giro de
      // fabrica es -30 grados, luego hay que SUMAR 30 para deshacerlo.
      const axle = new THREE.Vector3(1, 0, 0).applyQuaternion(restQ);
      const bakedYaw = Math.atan2(axle.z, axle.x);
      const corr = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), bakedYaw);

      // La altura del bounding box es el diametro sea cual sea el giro: una
      // rueda es un solido de revolucion, y girarla en Y o en su propio eje
      // no cambia su extension vertical.
      this.hubs.push({
        name, node, pos: p, corr, bakedYawDeg: THREE.MathUtils.radToDeg(bakedYaw),
        radius: (bb.max.y - bb.min.y) * 0.5, bottom: bb.min.y,
      });
    }

    this.wheelRadius = this.hubs.reduce((a, h) => a + h.radius, 0) / this.hubs.length;
    this.groundOffset = -Math.min(...this.hubs.map(h => h.bottom));

    const bb = new THREE.Box3().setFromObject(this.model);
    const size = bb.getSize(new THREE.Vector3());
    this.dims = { length: size.z, width: size.x, height: size.y };
    this.forwardSign = Math.sign(this.hubs[FL].pos.z) || 1;
  }

  // -------------------------------------------------------------- el chasis
  #buildBody() {
    const R = this.R;

    // La caja tiene que quedar POR ENCIMA del punto de contacto del neumatico
    // (y=0 en espacio de chasis). Si roza el suelo el coche arrastra la panza
    // y las ruedas no pueden empujarlo: aceleraba a 0,04 m/s.
    const hx = 0.90, hy = 0.40, hz = this.dims.length * 0.45;
    const cy = 0.74;

    // La masa se fija por DENSIDAD. setAdditionalMassProperties es un no-op
    // silencioso en rapier3d-compat 0.20 — verificado: deja la masa en 0 sobre
    // el desc y no altera la inercia sobre el body.
    //
    // La inercia derivada de la caja sale Iyaw ~ 2760 kg·m2, que esta dentro
    // del rango real de un deportivo (2500-3500). La correccion x1.45 del C++
    // compensaba el tensor por defecto de Unreal, no hace falta aqui.
    const volume = (2 * hx) * (2 * hy) * (2 * hz);

    this.body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(this.spawn.x, this.spawn.y, this.spawn.z)
        .setLinearDamping(0.05)
        .setAngularDamping(0.6)
        .setCcdEnabled(true));

    this.collider = this.world.createCollider(
      R.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(0, cy, 0)
        .setDensity(this.mass / volume)
        .setFriction(0.35)
        .setRestitution(0.05),
      this.body);

    this.controller = this.world.createVehicleController(this.body);
    // OJO: en Rapier 0.20 estos dos son accessors, no metodos.
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
  }

  // -------------------------------------------------------------- las ruedas
  #buildWheels() {
    const rest = 0.16;
    this.suspensionRest = rest;

    for (const hub of this.hubs) {
      this.controller.addWheel(
        { x: hub.pos.x, y: hub.pos.y + this.groundOffset + rest, z: hub.pos.z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        rest,
        this.wheelRadius);
    }

    const c = this.controller;
    for (let i = 0; i < 4; i++) {
      const rear = i >= RL;
      // MEDIDO, no copiado: la rigidez de Rapier va escalada por la masa del
      // chasis. Con 1780 kg, k=150 da ~4 cm de hundimiento estatico (lo real
      // en un GT de calle) y oscilacion residual cero. Por debajo de 60 la
      // suspension toca fondo.
      c.setWheelSuspensionStiffness(i, 150.0);
      c.setWheelSuspensionCompression(i, 3.0);
      c.setWheelSuspensionRelaxation(i, 4.0);
      c.setWheelMaxSuspensionTravel(i, 0.22);
      c.setWheelMaxSuspensionForce(i, 60000);

      // Asimetria deliberada, igual que HRVehicleWheels.cpp (1400 delante /
      // 1150 detras): el tren trasero agarra MENOS. Sin esto el coche subvira
      // siempre y no existe el sobreviraje al levantar el pie — ni el drift.
      c.setWheelFrictionSlip(i, rear ? 1.55 : 1.95);
      c.setWheelSideFrictionStiffness(i, rear ? 0.72 : 1.0);
    }
  }

  // ------------------------------------------------- separar la parte visual
  #rigVisuals() {
    // Los grupos cuelgan de la ESCENA, no del modelo: el nodo de rueda venia
    // dentro de "BodyUnderside", que tiene su propia transformada.
    const parent = this.model.parent ?? this.model;
    this.visual = [];

    for (const hub of this.hubs) {
      const steerG = new THREE.Group();
      const spinG = new THREE.Group();
      steerG.add(spinG);
      parent.add(steerG);
      steerG.position.copy(hub.pos);
      steerG.updateMatrixWorld(true);

      const pad = hub.node.getObjectByName(`${hub.name}BrakePad`);
      // attach() conserva la transformada en mundo. La pinza va al grupo que
      // NO gira: en un coche real esta fija al buje, no al disco.
      for (const ch of [...hub.node.children]) {
        const destino = ch === pad ? steerG : spinG;
        destino.attach(ch);
        // Quitar el giro de fabrica: deja el eje del neumatico alineado con
        // la X del grupo, que es sobre la que rueda.
        ch.quaternion.premultiply(hub.corr);
        ch.position.applyQuaternion(hub.corr);
      }
      hub.node.removeFromParent();
      this.visual.push({ steerG, spinG });
    }

    this.steeringWheel = this.model.getObjectByName('InteriorSteeringWheel01')
      ?? this.model.getObjectByName('InteriorSteeringWheel02');

    this.bodyRoot = this.model;
  }

  /** Dos instantaneas por rueda y por chasis: origen de la interpolacion. */
  #initSnapshots() {
    const mk = () => ({
      pos: new THREE.Vector3(), quat: new THREE.Quaternion(),
      wheels: Array.from({ length: 4 }, () => ({
        pos: new THREE.Vector3(), steer: 0, spin: 0,
      })),
    });
    this.prev = mk();
    this.curr = mk();
    this.capture();
    this.prev.pos.copy(this.curr.pos);
    this.prev.quat.copy(this.curr.quat);
    for (let i = 0; i < 4; i++) {
      this.prev.wheels[i].pos.copy(this.curr.wheels[i].pos);
      this.prev.wheels[i].steer = this.curr.wheels[i].steer;
      this.prev.wheels[i].spin = this.curr.wheels[i].spin;
    }
  }

  // ------------------------------------------------------------------ estado
  get speedKmh() {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.z) * KMH;
  }

  /** Velocidad longitudinal CON signo (negativa marcha atras). */
  get forwardSpeedKmh() {
    const v = this.body.linvel();
    const q = this.body.rotation();
    const f = this._v.set(0, 0, this.forwardSign)
      .applyQuaternion(this._q.set(q.x, q.y, q.z, q.w));
    return (v.x * f.x + v.z * f.z) * KMH;
  }

  /** Angulo entre morro y vector velocidad. + = la cola se va por la DERECHA. */
  get yawSlipDeg() {
    const v = this.body.linvel();
    if (v.x * v.x + v.z * v.z < 0.04) return 0;      // < 20 cm/s: ruido
    const q = this.body.rotation();
    const f = this._v.set(0, 0, this.forwardSign)
      .applyQuaternion(this._q.set(q.x, q.y, q.z, q.w));
    f.y = 0;
    if (f.lengthSq() < 1e-9) return 0;
    f.normalize();
    const vel = this._v2.set(v.x, 0, v.z).normalize();
    const cross = f.x * vel.z - f.z * vel.x;
    const dot = f.x * vel.x + f.z * vel.z;
    return THREE.MathUtils.radToDeg(Math.atan2(-cross, Math.abs(dot)));
  }

  /**
   * Velocidad angular REAL del eje motriz, rad/s. Sube al quemar rueda.
   *
   * wheelRotation() es un angulo ACUMULADO monotono: tras varios minutos vale
   * cientos de radianes. Si la referencia no se pone al dia (p.ej. dejandola en
   * 0 al reiniciar) la resta da un pico de ~30.000 rad/s, el motor se cree en
   * el limitador y CORTA EL PAR — el coche se quedaba sin acelerar.
   * De ahi el tope fisico: nada gira mas rapido que el corte del motor.
   */
  get driveWheelRads() {
    const c = this.controller;
    const dt = Math.max(1e-4, this._lastDt);
    const d2 = Math.abs(c.wheelRotation(RL) - this._prevSpin[RL]);
    const d3 = Math.abs(c.wheelRotation(RR) - this._prevSpin[RR]);
    const r = (d2 + d3) * 0.5 / dt;
    if (!Number.isFinite(r)) return 0;
    return Math.min(r, this.maxWheelRads);
  }

  /**
   * Deslizamiento normalizado por eje, 0..1.
   * Se normaliza contra el limite de adherencia REAL de cada rueda
   * (friccion x carga vertical x dt), no contra una constante magica.
   */
  slipRatios() {
    const c = this.controller;
    const dt = Math.max(1e-4, this._lastDt);
    const one = i => {
      if (!c.wheelIsInContact(i)) return 0;
      const limite = c.wheelFrictionSlip(i) * Math.abs(c.wheelSuspensionForce(i)) * dt;
      if (!(limite > 1e-6)) return 0;
      const usado = Math.hypot(c.wheelSideImpulse(i), c.wheelForwardImpulse(i));
      return clamp(usado / limite, 0, 1);
    };
    let enElAire = 0;
    for (let i = 0; i < 4; i++) if (!c.wheelIsInContact(i)) enElAire++;
    return {
      front: (one(FL) + one(FR)) * 0.5,
      rear: (one(RL) + one(RR)) * 0.5,
      airborne: enElAire === 4,
      wheelsOnGround: 4 - enElAire,
    };
  }

  /** ¿Esta el coche boca abajo? */
  get isUpsideDown() {
    const q = this.body.rotation();
    const up = this._v.set(0, 1, 0).applyQuaternion(this._q.set(q.x, q.y, q.z, q.w));
    return up.y < 0.1;
  }

  // ------------------------------------------------------------------ mandos
  /**
   * @param {number} steer   -1..1 ya pasado por SteeringModel (+ = DERECHA)
   * @param {number} torque  Nm en la rueda, con signo
   * @param {number} brake01 0..1
   * @param {boolean} handbrake
   */
  setControls(steer, torque, brake01, handbrake) {
    const c = this.controller;
    this._lastSteer = steer;

    const angle = STEER_SIGN * clamp(steer, -1, 1) * this.maxSteerAngle;
    c.setWheelSteering(FL, angle);
    c.setWheelSteering(FR, angle);

    // El par va al eje trasero: es propulsion. Se reparte entre las dos ruedas.
    const force = Number.isFinite(torque) ? (torque / this.wheelRadius) * 0.5 : 0;
    c.setWheelEngineForce(RL, force);
    c.setWheelEngineForce(RR, force);

    const b = clamp(brake01, 0, 1) * MAX_BRAKE_TORQUE;
    const bf = b * BRAKE_SPLIT_FRONT;
    const br = b * (1 - BRAKE_SPLIT_FRONT) + (handbrake ? HANDBRAKE_TORQUE : 0);
    c.setWheelBrake(FL, bf); c.setWheelBrake(FR, bf);
    c.setWheelBrake(RL, br); c.setWheelBrake(RR, br);
  }

  /** Carga aerodinamica proporcional a v^2, aplicada por detras del centro. */
  applyAero(refN = 3200, refKmh = 200) {
    const s = this.speedKmh;
    if (s < 60) return;
    const r = s / refKmh;
    const f = refN * r * r;
    const q = this.body.rotation();
    const back = this._v.set(0, 0, -this.forwardSign * 0.7)
      .applyQuaternion(this._q.set(q.x, q.y, q.z, q.w));
    const p = this.body.translation();
    this.body.addForceAtPoint(
      { x: 0, y: -f, z: 0 },
      { x: p.x + back.x, y: p.y + back.y, z: p.z + back.z },
      true);
  }

  /** ANTES de world.step(). */
  stepControls(dt) {
    this._lastDt = dt;
    for (let i = 0; i < 4; i++) this._prevSpin[i] = this.controller.wheelRotation(i);
    this.controller.updateVehicle(dt);
  }

  /** DESPUES de world.step(). Guarda la instantanea para interpolar. */
  capture() {
    const c = this.controller;
    const t = this.body.translation();
    const q = this.body.rotation();

    // curr pasa a prev sin asignar memoria
    const p = this.prev, n = this.curr;
    p.pos.copy(n.pos); p.quat.copy(n.quat);
    for (let i = 0; i < 4; i++) {
      p.wheels[i].pos.copy(n.wheels[i].pos);
      p.wheels[i].steer = n.wheels[i].steer;
      p.wheels[i].spin = n.wheels[i].spin;
    }

    n.pos.set(t.x, t.y, t.z);
    n.quat.set(q.x, q.y, q.z, q.w);

    for (let i = 0; i < 4; i++) {
      const conn = c.wheelChassisConnectionPointCs(i);
      const len = c.wheelSuspensionLength(i);
      n.wheels[i].pos
        .set(conn.x, conn.y - (Number.isFinite(len) ? len : 0), conn.z)
        .applyQuaternion(n.quat)
        .add(n.pos);
      n.wheels[i].steer = c.wheelSteering(i);
      n.wheels[i].spin = c.wheelRotation(i);
    }
  }

  /**
   * Cada frame de render. alpha = acc / STEP, en 0..1.
   * Sin esto el coche se dibuja a saltos de un paso entero: a 144 Hz el 58%
   * de los frames no ejecutan fisica y el coche se congela y salta 0,46 m.
   */
  render(alpha) {
    const a = clamp(alpha, 0, 1);
    const p = this.prev, n = this.curr;

    this.bodyRoot.position.lerpVectors(p.pos, n.pos, a);
    this.bodyRoot.position.y += this.groundOffset;
    this.bodyRoot.quaternion.slerpQuaternions(p.quat, n.quat, a);

    const bq = this._q.slerpQuaternions(p.quat, n.quat, a);
    for (let i = 0; i < 4; i++) {
      const v = this.visual[i];
      v.steerG.position.lerpVectors(p.wheels[i].pos, n.wheels[i].pos, a);
      v.steerG.quaternion.copy(bq).multiply(
        this._q2.setFromAxisAngle(this._up, p.wheels[i].steer +
          (n.wheels[i].steer - p.wheels[i].steer) * a));
      v.spinG.rotation.x = -(p.wheels[i].spin + (n.wheels[i].spin - p.wheels[i].spin) * a);
    }

    if (this.steeringWheel) {
      // ~150 grados de tope a tope. Mismo signo que el volante real.
      this.steeringWheel.rotation.z = -this._lastSteer * 2.6;
    }
  }

  respawn(pos = this.spawn, yawDeg = 0) {
    const y = THREE.MathUtils.degToRad(yawDeg);
    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(y / 2), z: 0, w: Math.cos(y / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelEngineForce(i, 0);
      this.controller.setWheelBrake(i, 0);
      this.controller.setWheelSteering(i, 0);
      // NO poner 0: wheelRotation es acumulado. Referencia = valor actual,
      // asi el delta del primer frame tras reiniciar es exactamente cero.
      this._prevSpin[i] = this.controller.wheelRotation(i);
    }
    this._lastSteer = 0;
    this.capture();
    this.prev.pos.copy(this.curr.pos);
    this.prev.quat.copy(this.curr.quat);
    for (let i = 0; i < 4; i++) {
      this.prev.wheels[i].pos.copy(this.curr.wheels[i].pos);
      this.prev.wheels[i].steer = this.curr.wheels[i].steer;
      this.prev.wheels[i].spin = this.curr.wheels[i].spin;
    }
  }
}
