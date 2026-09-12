/* ==========================================================================
   HIGHWAY RACER · Vehiculo
   --------------------------------------------------------------------------
   Rapier DynamicRayCastVehicleController + el modelo CarConcept.

   Por que raycast y no cuerpos rigidos por rueda: es el mismo enfoque que usa
   Chaos Vehicles en Unreal — cada rueda es un rayo con muelle. Es estable a
   200 km/h, barato, y responde igual en cualquier framerate. Simular cuatro
   ruedas como cuerpos con friccion da tumbos y se cae en cuanto toca un borde.

   La geometria NO esta hardcodeada: las posiciones de buje y el radio se leen
   del propio GLB al cargarlo. Si mañana cambias de coche, esto sigue valiendo.
   ========================================================================== */

import * as THREE from 'three';
import { clamp } from './steering.js';

const KMH = 3.6;

/** Nombres de los nodos de rueda dentro de CarConcept.glb */
const WHEEL_NODES = ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR'];

export class Vehicle {
  /**
   * @param {object}  RAPIER  modulo rapier ya inicializado
   * @param {object}  world   RAPIER.World
   * @param {THREE.Object3D} gltfScene  escena del GLB
   */
  constructor(RAPIER, world, gltfScene, opts = {}) {
    this.R = RAPIER;
    this.world = world;
    this.model = gltfScene;

    this.mass = opts.mass ?? 1780.0;           // kg, S650 GT en orden de marcha
    this.maxSteerAngle = opts.maxSteerAngle ?? THREE.MathUtils.degToRad(38);

    this.#measure();
    this.#buildBody(opts.spawn ?? new THREE.Vector3(0, 0.6, 0));
    this.#buildWheels();
    this.#rigVisuals();
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
      this.hubs.push({ name, node, pos: p, radius: (bb.max.y - bb.min.y) * 0.5, bottom: bb.min.y });
    }

    // Radio comun: media de las cuatro. Evita que una rueda flote y otra
    // se hunda si el artista no las dejo identicas.
    this.wheelRadius = this.hubs.reduce((a, h) => a + h.radius, 0) / this.hubs.length;

    // El origen del modelo no esta en el suelo: lo bajamos para que el
    // neumatico apoye exactamente en y=0 del chasis.
    this.groundOffset = -Math.min(...this.hubs.map(h => h.bottom));

    const bb = new THREE.Box3().setFromObject(this.model);
    const size = bb.getSize(new THREE.Vector3());
    this.dims = { length: size.z, width: size.x, height: size.y };

    // El frente es donde estan las ruedas delanteras.
    this.forwardSign = Math.sign(this.hubs[0].pos.z) || 1;
  }

  // -------------------------------------------------------------- el chasis
  #buildBody(spawn) {
    const R = this.R;

    // Inercia derivada de una caja equivalente, con la correccion del C++:
    // el tensor por defecto hace que el coche gire como una peonza, asi que
    // se sube la inercia de guiñada (y algo la de cabeceo).
    const w = 1.90, h = 1.05, d = this.dims.length;
    const m12 = this.mass / 12;
    const inertia = {
      x: m12 * (h * h + d * d) * 1.35,   // cabeceo
      y: m12 * (w * w + d * d) * 1.45,   // guiñada  <- la importante
      z: m12 * (w * w + h * h) * 1.00,   // balanceo
    };

    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setLinearDamping(0.05)
      .setAngularDamping(0.6)
      .setCcdEnabled(true);

    this.body = this.world.createRigidBody(desc);

    // Colisionador algo mas estrecho que la carroceria: si calca los retrovisores
    // el coche se engancha en los bordillos.
    // OJO con la altura: si la caja del chasis roza el suelo, el coche arrastra
    // la panza y las ruedas no pueden empujarlo — aceleraba a 0,04 m/s. La caja
    // tiene que quedar POR ENCIMA del punto de contacto del neumatico, que en
    // espacio de chasis esta en y≈0.
    const hx = 0.90, hy = 0.40, hz = this.dims.length * 0.45;
    const cy = 0.74;                     // -> la caja va de 0,34 a 1,14

    // La masa se fija por DENSIDAD, no con setAdditionalMassProperties: ese
    // metodo no llego a aplicarse y el coche se quedaba en 6,9 kg (solo lo que
    // aporta el colisionador con densidad 1). Asi es una sola fuente de verdad.
    const volume = (2 * hx) * (2 * hy) * (2 * hz);
    const density = this.mass / volume;

    const col = R.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(0, cy, 0)
      .setDensity(density)
      .setFriction(0.35)
      .setRestitution(0.05);
    this.collider = this.world.createCollider(col, this.body);

    // Mas inercia de guiñada: sin esto el coche gira como una peonza. Es la
    // misma correccion que InertiaTensorScale en el C++.
    if (typeof this.body.setAdditionalPrincipalAngularInertia === 'function') {
      this.body.setAdditionalPrincipalAngularInertia(
        { x: inertia.x * 0.35, y: inertia.y * 0.45, z: 0 }, true);
    }

    this.controller = this.world.createVehicleController(this.body);
    // OJO: en Rapier 0.20 estos dos NO son metodos, son accessors. Se asignan.
    this.controller.indexUpAxis = 1;            // Y arriba
    this.controller.setIndexForwardAxis = 2;    // Z adelante
  }

  // -------------------------------------------------------------- las ruedas
  #buildWheels() {
    const rest = 0.16;                    // recorrido de suspension en reposo
    this.suspensionRest = rest;

    for (const hub of this.hubs) {
      // El punto de anclaje va por encima del buje: el muelle cuelga de ahi.
      const conn = {
        x: hub.pos.x,
        y: hub.pos.y + this.groundOffset + rest,
        z: hub.pos.z,
      };
      this.controller.addWheel(
        conn,
        { x: 0, y: -1, z: 0 },            // direccion de la suspension
        { x: -1, y: 0, z: 0 },            // eje de giro de la rueda
        rest,
        this.wheelRadius);
    }

    const c = this.controller;
    for (let i = 0; i < 4; i++) {
      const rear = i >= 2;
      // Un GT de calle con Performance Pack: firme, no rigido.
      //
      // Estos numeros estan MEDIDOS, no copiados: la rigidez de Rapier va
      // escalada por la masa del chasis, asi que el valor util depende del
      // coche. Con 1780 kg, k=150 deja ~4 cm de hundimiento estatico (lo real
      // en un GT de calle) y oscilacion residual cero. Por debajo de 60 la
      // suspension toca fondo y el coche arrastra la panza.
      c.setWheelSuspensionStiffness(i, 150.0);
      c.setWheelSuspensionCompression(i, 3.0);
      c.setWheelSuspensionRelaxation(i, 4.0);
      c.setWheelMaxSuspensionTravel(i, 0.22);
      c.setWheelMaxSuspensionForce(i, 60000);

      // Asimetria deliberada, igual que en HRVehicleWheels.cpp: el tren
      // trasero agarra MENOS que el delantero. Sin esto el coche subvira
      // siempre y no existe el sobreviraje al levantar el pie — ni el drift.
      c.setWheelFrictionSlip(i, rear ? 1.55 : 1.95);
      c.setWheelSideFrictionStiffness(i, rear ? 0.72 : 1.0);
    }
  }

  // ------------------------------------------------- separar la parte visual
  #rigVisuals() {
    // Cada rueda pasa a colgar de dos grupos: uno que dirige y sigue a la
    // suspension, y dentro otro que gira. La pinza de freno va en el que NO
    // gira — en un coche real la pinza esta fija al buje, no al disco.
    //
    // Los grupos cuelgan de la ESCENA, no del modelo. El nodo de rueda venia
    // dentro de "BodyUnderside", que tiene su propia transformada: si dejamos
    // las ruedas ahi, al posicionarlas en espacio de chasis acaban desplazadas.
    const parent = this.model.parent ?? this.model;
    this.visual = [];

    for (const hub of this.hubs) {
      const steerG = new THREE.Group();
      const spinG  = new THREE.Group();
      steerG.add(spinG);
      parent.add(steerG);
      steerG.position.copy(hub.pos);
      steerG.updateMatrixWorld(true);

      const pad = hub.node.getObjectByName(`${hub.name}BrakePad`);
      // attach() conserva la transformada en mundo y calcula la local: asi la
      // geometria no se mueve un milimetro al cambiarla de padre.
      for (const ch of [...hub.node.children]) {
        (ch === pad ? steerG : spinG).attach(ch);
      }
      hub.node.removeFromParent();
      this.visual.push({ steerG, spinG });
    }

    // El volante del interior, para animarlo con la direccion.
    this.steeringWheel = this.model.getObjectByName('InteriorSteeringWheel01')
                      ?? this.model.getObjectByName('InteriorSteeringWheel02');

    // El resto del coche cuelga de un contenedor que seguimos al chasis.
    this.bodyRoot = this.model;
    this.bodyRoot.position.y += this.groundOffset;
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
    const fwd = new THREE.Vector3(0, 0, this.forwardSign)
      .applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
    return (v.x * fwd.x + v.z * fwd.z) * KMH;
  }

  /** Angulo entre el morro y el vector velocidad. + = la cola se va a la derecha. */
  get yawSlipDeg() {
    const v = this.body.linvel();
    if (v.x * v.x + v.z * v.z < 0.04) return 0;      // < 20 cm/s: ruido
    const q = this.body.rotation();
    const fwd = new THREE.Vector3(0, 0, this.forwardSign)
      .applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)).setY(0).normalize();
    const vel = new THREE.Vector3(v.x, 0, v.z).normalize();
    const cross = fwd.x * vel.z - fwd.z * vel.x;
    const dot = fwd.dot(vel);
    return THREE.MathUtils.radToDeg(Math.atan2(-cross, Math.abs(dot)));
  }

  /** Velocidad angular media del eje motriz, rad/s. Alimenta el cuentavueltas. */
  get driveWheelRads() {
    const c = this.controller;
    return (Math.abs(c.wheelRotation(2) - this._lastRot2) +
            Math.abs(c.wheelRotation(3) - this._lastRot3)) * 0.5 / Math.max(1e-4, this._lastDt);
  }

  /** Deslizamiento normalizado por eje, 0..1. */
  slipRatios() {
    const c = this.controller;
    const one = i => {
      if (!c.wheelIsInContact(i)) return 0;
      const side = Math.abs(c.wheelSideImpulse(i));
      const fwd  = Math.abs(c.wheelForwardImpulse(i));
      return clamp(Math.hypot(side, fwd) / 2600, 0, 1);
    };
    return {
      front: (one(0) + one(1)) * 0.5,
      rear:  (one(2) + one(3)) * 0.5,
      airborne: ![0, 1, 2, 3].some(i => c.wheelIsInContact(i)),
    };
  }

  // ------------------------------------------------------------------ mandos
  /**
   * @param {number} steer   -1..1 ya pasado por SteeringModel
   * @param {number} torque  Nm en la rueda (del Powertrain)
   * @param {number} brake01 0..1
   * @param {boolean} handbrake
   */
  drive(steer, torque, brake01, handbrake) {
    const c = this.controller;
    const angle = steer * this.maxSteerAngle;
    c.setWheelSteering(0, angle);
    c.setWheelSteering(1, angle);

    // El par va al eje trasero: es propulsion.
    const force = (torque / this.wheelRadius) * 0.5;
    c.setWheelEngineForce(2, force);
    c.setWheelEngineForce(3, force);

    // Reparto de frenada 65/35, como un GT.
    const bf = brake01 * 4500 * 0.65;
    const br = brake01 * 4500 * 0.35 + (handbrake ? 6000 : 0);
    c.setWheelBrake(0, bf); c.setWheelBrake(1, bf);
    c.setWheelBrake(2, br); c.setWheelBrake(3, br);
  }

  /** Carga aerodinamica proporcional a v^2, aplicada por detras del centro. */
  applyAero(refN = 3200, refKmh = 200) {
    const s = this.speedKmh;
    if (s < 60) return;
    const r = s / refKmh;
    const f = refN * r * r;
    const q = this.body.rotation();
    const back = new THREE.Vector3(0, 0, -this.forwardSign * 0.7)
      .applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
    const p = this.body.translation();
    this.body.addForceAtPoint({ x: 0, y: -f, z: 0 },
      { x: p.x + back.x, y: p.y + back.y, z: p.z + back.z }, true);
  }

  // ------------------------------------------------- sincronizar lo que se ve
  sync(dt) {
    this._lastDt = dt;
    const c = this.controller;
    c.updateVehicle(dt);

    const t = this.body.translation();
    const q = this.body.rotation();
    const bq = new THREE.Quaternion(q.x, q.y, q.z, q.w);

    this.bodyRoot.position.set(t.x, t.y + this.groundOffset, t.z);
    this.bodyRoot.quaternion.copy(bq);

    const steerQ = new THREE.Quaternion();
    const upY = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 4; i++) {
      const v = this.visual[i];
      // Buje = anclaje + direccion * longitud actual del muelle, en espacio de
      // chasis. Como los grupos cuelgan de la escena, hay que llevarlo a mundo.
      const conn = c.wheelChassisConnectionPointCs(i);
      const len  = c.wheelSuspensionLength(i);
      v.steerG.position
        .set(conn.x, conn.y - len, conn.z)
        .applyQuaternion(bq)
        .add(new THREE.Vector3(t.x, t.y, t.z));
      v.steerG.quaternion.copy(bq)
        .multiply(steerQ.setFromAxisAngle(upY, c.wheelSteering(i)));
      v.spinG.rotation.x = -c.wheelRotation(i);
    }

    if (this.steeringWheel) {
      this.steeringWheel.rotation.z = -this._lastSteer * 2.6;   // ~150 grados de tope
    }
    this._lastRot2 = c.wheelRotation(2);
    this._lastRot3 = c.wheelRotation(3);
  }

  setSteerForVisual(s) { this._lastSteer = s; }

  respawn(pos = new THREE.Vector3(0, 1.0, 0)) {
    this.body.setTranslation(pos, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}
