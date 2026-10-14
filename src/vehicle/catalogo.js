/* ==========================================================================
   JERO RACER · Catálogo de carros del jugador
   --------------------------------------------------------------------------
   Varios carros, y el juego no tiene que saber en que se diferencian: todos
   entregan la MISMA forma —un objeto con los cuatro nodos de rueda, su caja
   de choque y su ficha de chasis— y Vehicle se encarga del resto.

   TRES ORIGENES
     concept    el GLB de Khronos, que ya trae las ruedas en su nodo
     furia      modelado en codigo: pesa CERO bytes de descarga
     Sketchfab  los de vehicle/carros.js. Llegan como los dejo su autor y
                vehicle/normalizar.js los orienta, escala y les separa las
                ruedas al cargar. Solo se ofrecen si scripts/preparar-carro.mjs
                los dejo en public/models (lo dice models/carros.json): un
                carro que no se bajo en el equipo que compila no sale en el
                menu, en vez de dar un 404 a mitad de partida.
   ========================================================================== */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { afinarTexturas } from '../core/texturas.js';
import { construirFuria, FURIA, PINTURAS } from './muscle.js';
import { CARROS as DE_SKETCHFAB, credito } from './carros.js';
import { normalizarCarro, encenderPilotos } from './normalizar.js';

export { PINTURAS };

const PROPIOS = [
  { id: 'concept', nombre: 'CONCEPT', lema: 'prototipo de carbono', pintable: false },
  { id: 'furia', nombre: 'FURIA GT', lema: 'fastback modelado en código', pintable: true },
];

/**
 * Lo que ve el menu. El orden es el del boton CARRO, y el primero es el de
 * salida. No se congela: descubrirCarros() le mete delante los de Sketchfab
 * que esten publicados, y quien lo importo ve la lista ya completa.
 */
export const CARROS = [...PROPIOS];

/** Archivos de cada carro de Sketchfab publicado (models/carros.json). */
let publicados = {};

/**
 * Pregunta que carros de Sketchfab trae esta compilacion. Se llama una vez,
 * antes de leer CARROS. Si el manifiesto no esta (nadie corrio el
 * importador) el juego sigue con los dos de siempre, sin error.
 * @returns {Promise<string[]>} lineas de credito que exige la licencia CC BY
 */
export async function descubrirCarros() {
  try {
    const r = await fetch(import.meta.env.BASE_URL + 'models/carros.json', { cache: 'no-cache' });
    if (r.ok) publicados = (await r.json()).carros ?? {};
  } catch { /* sin manifiesto: solo los propios */ }
  const nuevos = DE_SKETCHFAB.filter(f => publicados[f.id]).map(f => ({
    id: f.id, nombre: f.nombre, lema: f.lema, pintable: false, sketchfab: f,
  }));
  CARROS.splice(0, CARROS.length, ...nuevos, ...PROPIOS);
  return nuevos.map(c => credito(c.sketchfab));
}

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
  const f = fichaCarro(id);
  if (f.sketchfab) {
    try {
      return await cargarSketchfab(f.sketchfab, CAL, boot);
    } catch (e) {
      // Un modelo que no se deja montar no puede dejar al jugador sin juego.
      console.error('[coche]', f.nombre, 'no se pudo montar:', e);
      boot(`El ${f.nombre} no arrancó. Sale el FURIA GT.`, 0.5);
      return cargarFuria(CAL, boot);
    }
  }
  return f.id === 'concept' ? cargarConcept(CAL, boot) : cargarFuria(CAL, boot);
}

const cargador = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/**
 * LA TRANSMISION OBLIGA A PINTAR LA ESCENA DOS VECES: three renderiza todo lo
 * opaco a una textura para refractarlo a traves del cristal. En movil eso es
 * medio presupuesto de fotograma por un parabrisas. Se sustituye por cristal
 * transparente clasico, que a la vista es casi igual.
 */
function prepararMallas(escena, CAL) {
  escena.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
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
}

// -------------------------------------------------------------- SKETCHFAB
async function cargarSketchfab(f, CAL, boot) {
  const archivos = publicados[f.id];
  const archivo = CAL.nombre === 'alta' ? archivos.escritorio : archivos.movil;
  boot(`Descargando el ${f.nombre}…`, 0.32);
  const gltf = await cargador.loadAsync(import.meta.env.BASE_URL + 'models/' + archivo, (e) => {
    if (e.total) boot(`Descargando el ${f.nombre}… ${Math.round(e.loaded / e.total * 100)} %`, 0.32 + 0.58 * (e.loaded / e.total));
  });
  boot('Montando las ruedas…', 0.92);
  const { raiz, medidas, ruedas, pilotos } = normalizarCarro(gltf.scene, f);
  console.info('[coche]', f.nombre, JSON.stringify(medidas));
  if (ruedas.length !== 4) throw new Error('no se encontraron las cuatro ruedas');
  prepararMallas(raiz, CAL);

  // Los carros de los demas son clones de este: si compartieran los
  // materiales de los pilotos, se encenderian cada vez que UNO frena.
  const plantilla = raiz.clone(true);
  const propios = new Map();
  plantilla.traverse(o => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material)
      ? o.material.map(m => pilotos.includes(m) ? copia(propios, m) : m)
      : pilotos.includes(o.material) ? copia(propios, o.material) : o.material;
  });

  const { largo, ancho } = medidas;
  // El escape sale bajo el paragolpes salvo que la ficha diga donde esta.
  const k = ancho / 1.95;
  const escapes = f.escapes ?? { x: [-0.42 * k, -0.28 * k, 0.28 * k, 0.42 * k], y: 0.30, z: -largo / 2 + 0.08 };
  return {
    id: f.id,
    nombre: f.nombre,
    objeto: raiz,
    plantilla,
    afinar: (maxAniso) => afinarTexturas(raiz, maxAniso),
    opts: {
      mass: f.masa,
      maxSteerAngle: THREE.MathUtils.degToRad(f.grados),
      agarre: f.agarre,
      medidaExacta: true,
      // La caja del CarConcept, con la que se afino la fisica, escalada al
      // ancho y al largo de cada uno. La altura no se toca: subirla hace al
      // carro volcar en las curvas.
      chasis: { hx: ancho * 0.46, hy: 0.40, hz: largo * 0.45, cy: 0.74 },
      escapes,
    },
    caja: { largo, ancho },
    pintar: () => 'DE FÁBRICA',
    luces: ({ freno = 0 }) => encenderPilotos(pilotos, freno),
  };
}

function copia(memo, m) {
  if (!memo.has(m)) memo.set(m, m.clone());
  return memo.get(m);
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
  // El de movil esta simplificado a 98.000 triangulos y con texturas de 1024.
  const archivo = CAL.nombre === 'alta' ? 'CarConcept.glb' : 'CarConcept-movil.glb';
  const gltf = await cargador.loadAsync(import.meta.env.BASE_URL + 'models/' + archivo, (e) => {
    if (e.total) boot(`Descargando el prototipo… ${Math.round(e.loaded / e.total * 100)} %`, 0.32 + 0.58 * (e.loaded / e.total));
  });
  boot('Preparando el motor…', 0.93);
  prepararMallas(gltf.scene, CAL);
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
