/* ==========================================================================
   HIGHWAY RACER · Modos de camara
   --------------------------------------------------------------------------
   Cada modo es una ESTRATEGIA pura: recibe el estado del coche y devuelve la
   pose que querria tener la camara. Ninguno mueve la camara ni guarda
   suavizados propios — de eso se encarga el director, que es quien sabe si
   estamos en mitad de una transicion entre modos.

   Esa separacion es la que permite anadir un modo nuevo sin tocar el bucle de
   render, y la que hace que cambiar de camara nunca de un tiron: el director
   interpola SIEMPRE desde donde estaba la camara, venga del modo que venga.

   POR QUE LA RIGIDEZ VIAJA DENTRO DE LA POSE
   Una camara de cabina tiene que ir clavada al casco y una cinematografica
   tiene que arrastrarse por detras. Si el suavizado fuera un ajuste global, o
   la cabina tiembla o la cinematografica se vuelve rigida. Cada modo declara
   cuanto quiere que le persigan.
   ========================================================================== */

import * as THREE from 'three';

/**
 * @typedef {object} ContextoCamara
 * @property {THREE.Object3D} cuerpo        raiz visual del vehiculo
 * @property {number} velocidadKmh
 * @property {number} derrapeGrados         angulo de derrape con signo
 * @property {number} tiempo                segundos acumulados de sesion
 */

/**
 * @typedef {object} PoseCamara
 * @property {THREE.Vector3} pos            donde deberia estar la camara
 * @property {THREE.Vector3} mira           a donde deberia apuntar
 * @property {number} fov                   grados
 * @property {THREE.Vector3} [arriba]       vector arriba; por defecto +Y
 * @property {number} [kPos]                constante de suavizado de posicion
 * @property {number} [kMira]               constante de suavizado de mirada
 */

/**
 * Las constantes k son la base de `1 - k^dt`: MENOR k = camara mas pegada.
 * Se expresan asi, y no como "velocidad", porque es la unica forma de que el
 * suavizado no dependa de los fotogramas por segundo de la maquina.
 */
const PEGADO = 0.0;        // sin suavizado: la pose se aplica tal cual

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** Fraccion normalizada de velocidad, 0 parado y 1 a 260 km/h. */
const tVel = ctx => clamp(ctx.velocidadKmh / 260, 0, 1);

/** Crea una pose reutilizable: evita asignar vectores en cada fotograma. */
function poseReutilizable() {
  return { pos: new THREE.Vector3(), mira: new THREE.Vector3(), fov: 58 };
}

/**
 * Persecucion clasica. Es la camara de juego y conserva exactamente el tacto
 * que ya tenia: el brazo se estira con la velocidad para dar sensacion de
 * aceleracion, y la mirada va mas suave que la posicion para que el encuadre
 * no vibre en los volantazos.
 */
export function modoPersecucion() {
  const pose = poseReutilizable();
  const off = new THREE.Vector3();
  const frente = new THREE.Vector3();
  pose.ancla = new THREE.Vector3();
  return {
    nombre: 'persecucion',
    etiqueta: 'PERSECUCIÓN',
    /** @param {ContextoCamara} ctx @returns {PoseCamara} */
    calcular(ctx) {
      const t = tVel(ctx);
      const b = ctx.cuerpo;
      off.set(0, lerp(2.35, 2.15, t), -lerp(5.9, 6.6, t)).applyQuaternion(b.quaternion);
      pose.pos.copy(b.position).add(off);
      // Mira por DELANTE del coche: en un juego de trafico lo que importa es
      // la via que viene, no el techo del propio coche.
      frente.set(0, 0, lerp(4.5, 9, t)).applyQuaternion(b.quaternion);
      frente.y = 0;
      pose.mira.copy(b.position).add(frente); pose.mira.y = b.position.y + 0.95;
      pose.fov = lerp(60, 76, t);
      pose.kPos = 0.004;
      pose.kMira = 0.002;
      pose.ancla.copy(b.position);
      return pose;
    },
  };
}

/** Cabina. Va clavada: cualquier suavizado aqui se siente como mareo. */
export function modoCabina() {
  const pose = poseReutilizable();
  const off = new THREE.Vector3();
  const frente = new THREE.Vector3();
  pose.ancla = new THREE.Vector3();
  return {
    nombre: 'cabina',
    etiqueta: 'CABINA',
    /** @param {ContextoCamara} ctx @returns {PoseCamara} */
    calcular(ctx) {
      const b = ctx.cuerpo;
      off.set(0.38, 1.02, 0.15).applyQuaternion(b.quaternion);
      pose.pos.copy(b.position).add(off);
      frente.set(0, 0.95, 8).applyQuaternion(b.quaternion);
      pose.mira.copy(b.position).add(frente);
      pose.fov = 72;
      pose.ancla.copy(b.position);
      pose.kPos = PEGADO;
      pose.kMira = PEGADO;
      return pose;
    },
  };
}

/**
 * Capo. La camara mas honesta para juzgar la conduccion: sin carroceria por
 * delante se ve exactamente donde estan las ruedas delanteras.
 */
export function modoCapo() {
  const pose = poseReutilizable();
  const off = new THREE.Vector3();
  const frente = new THREE.Vector3();
  pose.ancla = new THREE.Vector3();
  return {
    nombre: 'capo',
    etiqueta: 'CAPÓ',
    /** @param {ContextoCamara} ctx @returns {PoseCamara} */
    calcular(ctx) {
      const b = ctx.cuerpo;
      off.set(0, 0.92, 1.35).applyQuaternion(b.quaternion);
      pose.pos.copy(b.position).add(off);
      frente.set(0, 0.85, 14).applyQuaternion(b.quaternion);
      pose.mira.copy(b.position).add(frente);
      pose.fov = lerp(64, 74, tVel(ctx));
      pose.kPos = PEGADO;
      pose.kMira = 0.0008;
      pose.ancla.copy(b.position);
      return pose;
    },
  };
}

/**
 * Cinematografica: baja, de lente larga y con retraso deliberado.
 *
 * Los tres rasgos son los que separan una toma de juego de una de pelicula.
 * El angulo bajo hace grande al coche, la lente larga (fov 38) comprime la
 * ciudad detras en vez de estirarla, y el retraso alto hace que la camara
 * llegue tarde a los giros, que es justo lo que hace un operador humano.
 *
 * Ademas se descentra hacia el LADO CONTRARIO al derrape: cuando la cola se va,
 * el coche se abre en el encuadre en lugar de salirse por el borde.
 */
export function modoCinematografico() {
  const pose = poseReutilizable();
  const off = new THREE.Vector3();
  let lateral = 0;
  return {
    nombre: 'cine',
    etiqueta: 'CINE',
    reiniciar() { lateral = 0; },
    /** @param {ContextoCamara} ctx @returns {PoseCamara} */
    calcular(ctx) {
      const b = ctx.cuerpo;
      const t = tVel(ctx);
      const objetivoLateral = clamp(-ctx.derrapeGrados / 45, -1, 1) * 3.4;
      lateral = lerp(lateral, objetivoLateral, 0.06);
      off.set(lateral, 1.28, -lerp(8.5, 11.0, t)).applyQuaternion(b.quaternion);
      pose.pos.copy(b.position).add(off);
      pose.mira.copy(b.position); pose.mira.y += 0.75;
      pose.fov = lerp(38, 44, t);
      pose.kPos = 0.02;      // llega tarde a proposito
      pose.kMira = 0.004;
      return pose;
    },
  };
}

/**
 * Orbita lenta. Es la toma de presentacion: ensena el coche y, sobre todo, la
 * ciudad fotografiada que hay detras. La altura oscila despacio para que el
 * plano nunca se quede quieto del todo.
 */
export function modoOrbita({ radio = 11.5, vueltasPorMinuto = 3.2 } = {}) {
  const pose = poseReutilizable();
  return {
    nombre: 'orbita',
    etiqueta: 'ÓRBITA',
    /** @param {ContextoCamara} ctx @returns {PoseCamara} */
    calcular(ctx) {
      const b = ctx.cuerpo;
      const a = ctx.tiempo * (vueltasPorMinuto / 60) * Math.PI * 2;
      const altura = 3.1 + Math.sin(ctx.tiempo * 0.31) * 1.15;
      pose.pos.set(
        b.position.x + Math.cos(a) * radio,
        b.position.y + altura,
        b.position.z + Math.sin(a) * radio,
      );
      pose.mira.copy(b.position); pose.mira.y += 0.55;
      pose.fov = 45;
      pose.kPos = 0.05;
      pose.kMira = 0.02;
      return pose;
    },
  };
}

/**
 * Cenital. Es la unica camara donde se LEE la trazada: desde arriba se ve el
 * angulo del coche contra su direccion de avance, que es la definicion misma
 * del derrape.
 *
 * El vector arriba se fija al NORTE del mundo, no al morro del coche. Si se
 * atara al coche, la ciudad giraria bajo el vehiculo y seria imposible juzgar
 * la trazada: lo que tiene que rotar es el coche, no el mundo.
 */
export function modoCenital({ altura = 24 } = {}) {
  const pose = poseReutilizable();
  const arriba = new THREE.Vector3(0, 0, -1);   // el norte es −Z en este mundo
  return {
    nombre: 'cenital',
    etiqueta: 'CENITAL',
    /** @param {ContextoCamara} ctx @returns {PoseCamara} */
    calcular(ctx) {
      const b = ctx.cuerpo;
      const t = tVel(ctx);
      pose.pos.copy(b.position); pose.pos.y += lerp(altura, altura * 1.5, t);
      pose.mira.copy(b.position);
      pose.fov = 50;
      pose.arriba = arriba;
      pose.kPos = 0.004;
      pose.kMira = 0.004;
      return pose;
    },
  };
}

/** Orden de ciclado con la tecla C. Juego primero, cine despues. */
export function modosPorDefecto() {
  return [
    modoPersecucion(),
    modoCabina(),
    modoCapo(),
    modoCinematografico(),
    modoOrbita(),
    modoCenital(),
  ];
}
