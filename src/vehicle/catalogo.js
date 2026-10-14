/* ==========================================================================
   JERO RACER · Catálogo de carros del jugador
   --------------------------------------------------------------------------
   Dos carros, y el juego no tiene que saber en que se diferencian: los dos
   entregan la MISMA forma —un objeto con los cuatro nodos de rueda, su caja
   de choque y su ficha de chasis— y Vehicle se encarga del resto.

   EL FURIA ES EL DE SALIDA, Y NO POR GUSTO. Esta modelado en codigo, asi que
   pesa CERO bytes de descarga: en un telefono con datos de Claro, el juego
   arranca sin esperar los 2,9 MB del CarConcept. Quien quiera el prototipo
   lo elige en el menu y ahi si se baja.
   ========================================================================== */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { afinarTexturas } from '../core/texturas.js';
import { construirFuria, FURIA, PINTURAS } from './muscle.js';

export { PINTURAS };

/** Lo que ve el menu. El orden es el del boton CARRO. */
export const CARROS = Object.freeze([
  { id: 'concept', nombre: 'CONCEPT', lema: 'prototipo de carbono', pintable: false },
  { id: 'furia', nombre: 'FURIA GT', lema: 'fastback modelado en código', pintable: true },
]);

export const CARRO_POR_DEFECTO = 'concept';

export function fichaCarro(id) {
  return CARROS.find(c => c.id === id) ?? CARROS[0];
}

/**
 * @typedef {object} CarroListo
 * @property {string} id
 * @property {string} nombre
 * @property {THREE.Object3D} objeto      para añadir a la escena y pasar a Vehicle
 * @property {object} opts                mass, maxSteerAngle, chasis, escapes
 * @property {{largo:number, ancho:number}} caja  para la prueba de choque
 * @property {(i:number)=>string} pintar  cambia la pintura (devuelve su nombre)
 * @property {(e:object)=>void} luces     freno, direccionales, reversa, faros
 */

/**
 * @param {string} id
 * @param {object} CAL nivel de calidad (ver core/calidad.js)
 * @param {(texto:string, fraccion?:number)=>void} boot
 * @returns {Promise<CarroListo>}
 */
export async function cargarCarro(id, CAL, boot = () => {}) {
  return id === 'concept' ? cargarConcept(CAL, boot) : cargarFuria(CAL, boot);
}

// ------------------------------------------------------------------ FURIA
function cargarFuria(CAL, boot) {
  boot('Sacando el FURIA GT del taller…', 0.5);
  // En gama baja se cae el dibujo de los neumaticos y la escarcha de la
  // pintura: son lo caro y lo que menos se nota en una pantalla de 5".
  const alta = CAL.nombre === 'alta';
  const { objeto, material } = construirFuria({
    detalle: alta ? 1 : CAL.nombre === 'media' ? 0.85 : 0.6,
    escarcha: CAL.pinturaLaca,
  });
  const u = material.userData.uniformes;
  boot('Calentando el V8…', 0.95);
  return {
    id: 'furia',
    nombre: FURIA.nombre,
    objeto,
    // Copia intacta para los carros de los demas jugadores (net/remotos.js).
    plantilla: objeto.clone(true),
    opts: {
      mass: FURIA.masa,
      maxSteerAngle: THREE.MathUtils.degToRad(FURIA.grados),
      chasis: { hx: 0.90, hy: 0.40, hz: FURIA.largo * 0.45, cy: 0.74 },
      escapes: { x: [-0.46, -0.30, 0.30, 0.46], y: 0.345, z: -2.42 },
    },
    caja: FURIA.caja,
    pintar(i) {
      const p = PINTURAS[((i % PINTURAS.length) + PINTURAS.length) % PINTURAS.length];
      u.uTinte1.value.setHex(p.t1);
      u.uTinte2.value.setHex(p.t2);
      return p.nombre;
    },
    luces({ freno = 0, izq = 0, der = 0, reversa = 0, faros = null }) {
      u.uEstado.value.set(freno, izq, der, reversa);
      if (faros != null) u.uFaros.value = faros;
    },
  };
}

// ---------------------------------------------------------------- CONCEPT
async function cargarConcept(CAL, boot) {
  boot('Descargando el prototipo…', 0.32);
  const cargador = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  // El de movil esta simplificado a 98.000 triangulos y con texturas de 1024.
  const archivo = CAL.nombre === 'alta' ? 'CarConcept.glb' : 'CarConcept-movil.glb';
  const gltf = await cargador.loadAsync(import.meta.env.BASE_URL + 'models/' + archivo, (e) => {
    if (e.total) boot(`Descargando el prototipo… ${Math.round(e.loaded / e.total * 100)} %`, 0.32 + 0.58 * (e.loaded / e.total));
  });
  boot('Preparando el motor…', 0.93);
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    // LA TRANSMISION OBLIGA A PINTAR LA ESCENA DOS VECES: three renderiza
    // todo lo opaco a una textura para refractarlo a traves del cristal. En
    // movil eso es medio presupuesto de fotograma por un parabrisas. Se
    // sustituye por cristal transparente clasico, que a la vista es casi igual.
    for (const m of [].concat(o.material)) {
      if (!CAL.transmision && m.transmission > 0) {
        m.transmission = 0;
        m.transparent = true;
        m.opacity = 0.32;
        m.depthWrite = false;
        m.needsUpdate = true;
      }
      if (CAL.nombre !== 'alta' && m.iridescence > 0) { m.iridescence = 0; m.needsUpdate = true; }
    }
  });
  return {
    id: 'concept',
    nombre: 'CONCEPT',
    objeto: gltf.scene,
    plantilla: gltf.scene.clone(true),
    // Lo que afina texturas necesita la anisotropia del renderer: lo hace
    // quien lo monta, porque aqui no se tiene el renderer a mano.
    afinar: (maxAniso) => afinarTexturas(gltf.scene, maxAniso),
    opts: { mass: 1780, maxSteerAngle: THREE.MathUtils.degToRad(38) },
    caja: { largo: 4.45, ancho: 1.95 },
    pintar: () => 'DE FÁBRICA',
    luces: () => {},
  };
}
