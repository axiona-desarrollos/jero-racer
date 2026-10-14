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
const BRAKE_SPLIT_FRONT = 0.68;
/**
 * Desaceleracion con el pedal a fondo, en g. Un carro de calle con buenos
 * neumaticos frena a ~1 g; mas que eso es de competicion.
 */
const DECEL_FRENO_G = 1.0;
/**
 * ABS: fraccion del limite de adherencia hasta la que se deja frenar cada
 * rueda. Por debajo de 1 la rueda nunca llega a bloquearse.
 */
const ABS_MARGEN = 0.86;
/**
 * El freno de mano SI bloquea las traseras: es justo lo que hace derrapar.
 * Unidades de Rapier (impulso por paso), muy por encima del limite.
 */
const HANDBRAKE_IMPULSO = 6000;

export class Vehicle {
  constructor(RAPIER, world, gltfScene, opts = {}) {
    this.R = RAPIER;
    this.world = world;
    this.model = gltfScene;

    this.opts = opts;
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
      // Medida exacta (vertice a vertice) para los carros descargados: una
      // rueda girada sobre su eje infla la caja rapida hasta un 40 %, y el
      // carro iria sobre zancos. El CarConcept se afino con la rapida.
      const bb = new THREE.Box3().setFromObject(node, !!this.opts.medidaExacta);

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

    const bb = new THREE.Box3().setFromObject(this.model, !!this.opts.medidaExacta);
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
    // Cada carro trae su caja (ver catalogo.js). Por defecto, la del
    // CarConcept, que es con la que se afino todo el comportamiento.
    const ch = this.opts.chasis ?? {};
    const hx = ch.hx ?? 0.90, hy = ch.hy ?? 0.40;
    const hz = ch.hz ?? this.dims.length * 0.45;
    const cy = ch.cy ?? 0.74;

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
        // NUNCA DORMIR. Con la cuenta atras el coche pasa segundos quieto con
        // el freno de mano, Rapier lo duerme, y el controlador de vehiculo
        // aplica la fuerza del motor a un cuerpo dormido: no se movia al
        // pisar el gas. Un solo cuerpo despierto no cuesta nada.
        .setCanSleep(false)
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
    // Cada carro puede traer su reparto de agarre (ver vehicle/carros.js).
    const agarre = this.opts.agarre ?? {};
    for (let i = 0; i < 4; i++) {
      const rear = i >= RL;
      // MEDIDO, no copiado: la rigidez de Rapier va escalada por la masa del
      // chasis. Con 1780 kg, k=150 da ~4 cm de hundimiento estatico (lo real
      // en un GT de calle) y oscilacion residual cero. Por debajo de 60 la
      // suspension toca fondo.
      c.setWheelSuspensionStiffness(i, 150.0);
      c.setWheelSuspensionCompression(i, 3.0);
      c.setWheelSuspensionRelaxation(i, 4.0);
      // El recorrido NO puede superar la longitud de reposo: si lo hace,
      // Rapier deja comprimir por debajo de cero (con 0.22 y reposo 0.16
      // llegaba a -0.06) y la rueda se dibuja DENTRO de la carroceria.
      // Se deja un tope de goma de 1 cm, como en un coche real.
      c.setWheelMaxSuspensionTravel(i, rest - 0.01);
      c.setWheelMaxSuspensionForce(i, 60000);

      // Asimetria deliberada, igual que HRVehicleWheels.cpp (1400 delante /
      // 1150 detras): el tren trasero agarra MENOS. Sin esto el coche subvira
      // siempre y no existe el sobreviraje al levantar el pie — ni el drift.
      c.setWheelFrictionSlip(i, rear ? agarre.detras ?? 1.55 : agarre.delante ?? 1.95);
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

    // DIRECCION SENSIBLE A LA VELOCIDAD. A 130 km/h el volante a tope ponia
    // las ruedas a 18 grados: el neumatico ya no gira el coche, solo arrastra
    // (perdia 80 km/h en segundo y medio) o lo hace trompear. El tope es el
    // angulo que da la maxima aceleracion lateral que permite el agarre, mas
    // unos grados de deriva del neumatico. En derrape (freno de mano) se deja
    // mas margen para poder contravolantear.
    const v = Math.abs(this.forwardSpeedKmh) / 3.6;
    const batalla = this._batalla ?? (this._batalla = Math.abs(this.hubs[FL].pos.z - this.hubs[RL].pos.z) || 2.7);
    const deriva = (handbrake || this._sinESC > 0) ? 0.30 : 0.065;
    const tope = Math.min(this.maxSteerAngle,
      Math.atan(batalla * 9.3 / Math.max(1, v * v)) + deriva);
    this._delta = clamp(steer, -1, 1) * tope;     // + = derecha, ya con el tope
    const angle = STEER_SIGN * this._delta;
    c.setWheelSteering(FL, angle);
    c.setWheelSteering(FR, angle);

    // El par va al eje trasero: es propulsion. Se reparte entre las dos ruedas.
    // Frenando se corta: en Rapier una rueda con fuerza de motor IGNORA su
    // freno, asi que pisar los dos pedales dejaba el eje trasero sin frenar.
    const pedal = clamp(brake01, 0, 1);
    // Con el freno de mano tambien: si no, acelerar y tirar del freno de mano
    // a la vez (la tecnica del derrape) no bloqueaba las traseras.
    const force = Number.isFinite(torque) && pedal < 0.05 && !handbrake ? (torque / this.wheelRadius) * 0.5 : 0;
    c.setWheelEngineForce(RL, force);
    c.setWheelEngineForce(RR, force);

    // FRENO REALISTA CON ABS.
    // El freno de Rapier es un IMPULSO maximo por paso, no un par. Antes valia
    // 4500 con el pedal a fondo, cuando el limite de adherencia de una rueda
    // ronda 140: cualquier toque de freno bloqueaba las cuatro ruedas, el eje
    // trasero (que agarra menos) perdia el agarre lateral y el coche trompeaba.
    // Ahora el pedal pide una desaceleracion real y cada rueda frena como mucho
    // hasta su limite, descontando lo que ya gasta en sujetar la curva (el
    // circulo de friccion). Asi frena recto y se puede girar mientras frena.
    const dt = this._lastDt;
    const total = pedal * this.mass * 9.81 * DECEL_FRENO_G * dt;
    for (let i = 0; i < 4; i++) {
      const trasera = i >= RL;
      let b = total * (trasera ? 1 - BRAKE_SPLIT_FRONT : BRAKE_SPLIT_FRONT) * 0.5;
      if (b > 0) {
        const limite = c.wheelFrictionSlip(i) * Math.abs(c.wheelSuspensionForce(i)) * dt * ABS_MARGEN;
        const lateral = Math.abs(c.wheelSideImpulse(i));
        const libre = Math.sqrt(Math.max(0, limite * limite - lateral * lateral));
        b = Math.min(b, Math.max(libre, limite * 0.3));
        if (!Number.isFinite(b)) b = 0;
      }
      // Freno de mano: las traseras frenan algo POR ENCIMA de su limite, para
      // que deslicen sin quedar bloqueadas del todo. Bloqueadas (el impulso
      // enorme de antes) el coche daba media vuelta y caia de 95 a 30 km/h:
      // un trompo, no un derrape.
      if (trasera && handbrake) {
        const limite = c.wheelFrictionSlip(i) * Math.abs(c.wheelSuspensionForce(i)) * dt;
        b = Math.min(HANDBRAKE_IMPULSO, limite * 1.35);
      }
      c.setWheelBrake(i, b);
      // Mientras se tira del freno de mano la trasera agarra menos de lado:
      // es lo que deja colgar la cola y sostener el derrape con el volante.
      if (trasera) c.setWheelSideFrictionStiffness(i, handbrake ? 0.5 : 0.72);
    }
  }

  /**
   * Control de estabilidad (ESC), como el de un carro moderno.
   *
   * El chasis esta afinado para derrapar (el tren trasero agarra menos), que
   * en la glorieta era la gracia. En una autopista con trafico, y con el
   * movil haciendo de volante, eso hacia que un volantazo o una frenada en
   * curva acabaran en trompo. El ESC compara el giro del coche con el que
   * pide el volante a esa velocidad y corrige el exceso. Se desconecta con el
   * freno de mano y un rato despues: el derrape sigue siendo posible, pero
   * solo cuando el jugador lo busca.
   *
   * Va ANTES de world.step().
   * @param {number} dt
   * @param {boolean} handbrake
   */
  estabilizar(dt, handbrake) {
    this._sinESC = handbrake ? 1.5 : Math.max(0, (this._sinESC ?? 0) - dt);
    if (this._sinESC > 0) {
      // En derrape no hay ESC, pero si un tope: pasados ~45 grados de
      // angulo el giro se frena. Sin el, cualquier derrape largo acababa en
      // trompo y nadie lo sostiene con un movil en la mano.
      const slip = Math.abs(this.yawSlipDeg);
      if (slip > 42) {
        const w = this.body.angvel();
        const k = Math.min(1, (slip - 42) * 0.6 * dt);
        this.body.setAngvel({ x: w.x, y: w.y * (1 - k), z: w.z }, true);
      }
      return;
    }
    const v = this.forwardSpeedKmh / 3.6;
    if (v < 6) return;
    // Volante + = derecha; girar a la derecha es yaw NEGATIVO (el coche mira a
    // +Z y su izquierda es +X). Se usa el angulo de rueda real, ya con tope.
    const delta = this._delta ?? 0;
    let ref = -v * Math.tan(delta) / this._batalla;
    const tope = 0.95 * 9.81 / v;                  // lo que permite la adherencia
    ref = clamp(ref, -tope, tope);
    const w = this.body.angvel();
    const exceso = w.y - ref;
    // Solo se corrige el exceso de giro (sobreviraje), no la falta.
    if (Math.abs(w.y) > Math.abs(ref) + 0.04 || Math.sign(w.y) !== Math.sign(ref)) {
      const k = Math.min(1, 7 * dt);
      this.body.setAngvel({ x: w.x, y: w.y - exceso * k, z: w.z }, true);
    }
  }

  /** Carga aerodinamica proporcional a v^2, aplicada por detras del centro. */
  applyAero(refN = 3200, refKmh = 200) {
    // LAS FUERZAS DE RAPIER NO SE BORRAN SOLAS: se acumulan paso tras paso hasta
    // que alguien las resetea. Llamar a esto en cada fotograma sumaba ~2,5 kN por
    // paso, mas de 150 kN por segundo de marcha, y el coche acababa aplastado
    // contra el asfalto con la suspension trasera tocando fondo.
    //
    // Y HAY QUE RESETEAR LAS DOS COSAS. addForceAtPoint se descompone dentro de
    // Rapier en una fuerza EN EL CENTRO DE MASAS mas un PAR igual a r x F.
    // resetForces() solo borra la primera mitad: el par seguia sumando ~350 N·m
    // por paso, 21.000 N·m por segundo, y a los 85 km/h el coche daba un mortal
    // hacia atras y se quedaba de pie sobre la cola con las ruedas al aire.
    // Medido: sano hasta 82 km/h, y a 85 despegaba hasta 2,09 m de altura.
    //
    // En la glorieta nunca se vio porque el umbral son 60 km/h y alli casi no se
    // mantienen; en una recta larga mata el coche en cinco segundos.
    this.body.resetForces(false);
    this.body.resetTorques(false);
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
      // La longitud se acota a [0, reposo]. En golpes fuertes Rapier devuelve
      // valores NEGATIVOS (hasta -0.06 medido): la rueda se dibuja por encima
      // de su anclaje, o sea METIDA en la carroceria.
      const raw = c.wheelSuspensionLength(i);
      const len = Number.isFinite(raw) ? clamp(raw, 0, this.suspensionRest) : this.suspensionRest;
      // Se guarda en ESPACIO DE CHASIS, no en mundo. Interpolar posiciones de
      // mundo hace que la recta corte el arco cuando el coche gira deprisa: en
      // un vuelco la rueda se despegaba ~4 cm de su sitio.
      n.wheels[i].pos.set(conn.x, conn.y - len, conn.z);
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

    // UNA sola pose de chasis interpolada. Todo lo demas —carroceria y las
    // cuatro ruedas— se construye a partir de ella, asi que no pueden
    // separarse por violento que sea el golpe: van solidarias al mismo cuerpo.
    const bq = this._q.slerpQuaternions(p.quat, n.quat, a);
    const bpos = this._v2.lerpVectors(p.pos, n.pos, a);

    this.bodyRoot.quaternion.copy(bq);
    // El origen del cuerpo rigido esta en el plano de contacto; el del modelo,
    // groundOffset mas arriba. Ese desplazamiento es SOLIDARIO AL COCHE: va en
    // su eje Y LOCAL. Sumandolo en Y de mundo, al volcar el coche la carroceria
    // se separaba de las ruedas hasta 32 cm — parecia que se desarmaba.
    this.bodyRoot.position.copy(bpos)
      .add(this._v3.set(0, this.groundOffset, 0).applyQuaternion(bq));

    for (let i = 0; i < 4; i++) {
      const v = this.visual[i];
      const pw = p.wheels[i], nw = n.wheels[i];
      // Las posiciones estan en espacio de chasis: se interpolan ahi y se
      // llevan a mundo con la MISMA pose que la carroceria.
      v.steerG.position.lerpVectors(pw.pos, nw.pos, a).applyQuaternion(bq).add(bpos);
      v.steerG.quaternion.copy(bq).multiply(
        this._q2.setFromAxisAngle(this._up, pw.steer + (nw.steer - pw.steer) * a));
      v.spinG.rotation.x = -(pw.spin + (nw.spin - pw.spin) * a);
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
