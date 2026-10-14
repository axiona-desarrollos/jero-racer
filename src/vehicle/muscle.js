/* ==========================================================================
   JERO RACER · FURIA GT — el muscle car del jugador
   --------------------------------------------------------------------------
   Un cupe fastback de motor delantero y traccion trasera: capo largo, cintura
   alta, hombros marcados sobre las ruedas traseras, luneta tendida hasta el
   baul y tres barras verticales en cada piloto.

   POR QUE MODELADO Y NO DESCARGADO
   Lo mismo que el trafico (ver modelado.js): los modelos realistas de marca
   no se pueden publicar. Este no copia ninguna marca — toma el lenguaje del
   muscle car americano, que no es de nadie — y ademas se puede pintar,
   encender y romper desde el codigo, que es lo que el juego necesita.

   DIFERENCIA CON EL TRAFICO
   El trafico comparte UNA malla y UN material por tipo porque hay 56 en via.
   Aqui hay uno solo y siempre en primer plano, asi que se gasta donde se ve:
     · geometria a detalle alto (biseles, tacos de dibujo, tuercas, pinzas)
     · pintura metalizada con escarcha de aluminio y laca de verdad
     · vidrios TRANSPARENTES en malla aparte, con interior modelado detras
   El motor y la caja ya eran los de un V8 de 5.0 (ver powertrain.js): este es
   el carro que les corresponde.

   EJES (los de todo el juego): mira a +Z, +Y arriba, +X es su IZQUIERDA.
   El origen esta en el suelo, en el centro de la planta.
   ========================================================================== */

import * as THREE from 'three';
import {
  Constructor, M, conMat, REGION, uvDe, atlasCalcas,
  cuerpoLoft, habitaculoLoft, interpolar, anchoEn, matrizDe, rectRedondeado,
  fijarDetalle, pasoDeRueda, marcoEnSuperficie,
} from '../traffic/modelado.js';

const calca = (region, base = M.blanco) => conMat(base, { uv: uvDe(region) });

// ------------------------------------------------------------------ cotas
/**
 * Ficha del carro. No son solo cotas de dibujo: de aqui salen la caja del
 * chasis, la prueba de choque y la masa, asi que tocar una cambia como se
 * conduce.
 */
export const FURIA = Object.freeze({
  id: 'furia',
  nombre: 'FURIA GT',
  lema: 'V8 5.0 · tracción trasera',
  largo: 4.84, ancho: 1.96, alto: 1.385,
  batalla: 2.72, via: 0.830, radioRueda: 0.35,
  masa: 1760,
  grados: 36,
  // Caja en planta para la prueba de choque contra el trafico. Un pelo mas
  // corta que la carroceria: el jugador juzga el hueco por lo que VE, y una
  // caja exacta hace que un "pasa rozando" limpio cuente como choque.
  caja: { largo: 4.62, ancho: 1.90 },
  // Pintura de fabrica: rojo brasa con franjas negras.
  tinte1: 0xb2140f, tinte2: 0x0e1014,
});

/** Pinturas que el jugador puede elegir desde el menu. */
export const PINTURAS = Object.freeze([
  { nombre: 'ROJO BRASA', t1: 0xb2140f, t2: 0x0e1014 },
  { nombre: 'NEGRO NOCHE', t1: 0x0d0f13, t2: 0xb8b9bd },
  { nombre: 'AMARILLO AXIONA', t1: 0xe8b40c, t2: 0x0e1014 },
  { nombre: 'VERDE NEÓN', t1: 0x00c89a, t2: 0x0a0e14 },
  { nombre: 'AZUL MEDELLÍN', t1: 0x12408f, t2: 0xe6e8ec },
  { nombre: 'BLANCO PERLA', t1: 0xe9eaec, t2: 0x16181c },
]);

// --------------------------------------------------------------- materiales
/**
 * Codigos de luz (componente w de aMat):
 *   1 faro · 2 piloto · 3 intermitente izq · 4 intermitente der
 *   5 emisivo puro · 6 reversa · 7 luz diurna
 */
const MAT = Object.freeze({
  pintura:     { c: 0xffffff, t: 1, r: 0.21, m: 0.42, k: 1 },
  franja:      { c: 0xffffff, t: 2, r: 0.26, m: 0.22, k: 1 },
  junta:       { c: 0x04060a, r: 0.95, m: 0.0, k: 0 },
  negroMate:   { c: 0x0c0e11, r: 0.80, m: 0.04 },
  negroBrillo: { c: 0x0a0c0f, r: 0.22, m: 0.25, k: 0.8 },
  carbono:     { c: 0x17191d, r: 0.33, m: 0.45, k: 0.9 },
  caucho:      { c: 0x121212, r: 0.94, m: 0.0 },
  rin:         { c: 0x303439, r: 0.30, m: 0.95 },
  rinPulido:   { c: 0xd2d6db, r: 0.14, m: 1.0 },
  cromo:       { c: 0xf4f5f7, r: 0.07, m: 1.0 },
  disco:       { c: 0x6e7277, r: 0.33, m: 0.90 },
  pinza:       { c: 0xc01b12, r: 0.30, m: 0.25, k: 0.6 },
  faroLente:   { c: 0xc9d4e2, r: 0.05, m: 0.10, k: 1 },
  faro:        { c: 0xf3f6ff, r: 0.05, m: 0.0, l: 1, k: 0.5 },
  diurna:      { c: 0xf0f6ff, r: 0.05, m: 0.0, l: 7, k: 0.5 },
  piloto:      { c: 0x4a0604, r: 0.18, m: 0.10, l: 2, k: 0.5 },
  intIzq:      { c: 0x7e3c04, r: 0.20, m: 0.10, l: 3, k: 0.4 },
  intDer:      { c: 0x7e3c04, r: 0.20, m: 0.10, l: 4, k: 0.4 },
  reversa:     { c: 0xdfe4ea, r: 0.12, m: 0.10, l: 6, k: 0.4 },
  cuero:       { c: 0x14161a, r: 0.72, m: 0.0 },
  cueroRojo:   { c: 0x4a1012, r: 0.68, m: 0.0 },
  tablero:     { c: 0x0b0d10, r: 0.85, m: 0.0 },
  alcantara:   { c: 0x1b1e23, r: 0.92, m: 0.0 },
  aguja:       { c: 0xff3a1f, r: 0.40, m: 0.0, l: 5 },
  pantalla:    { c: 0x0a2a33, r: 0.15, m: 0.10 },
});

/**
 * Material del coche del jugador. Misma idea que materialFlota —atributos por
 * vertice en vez de materiales distintos— con dos cosas que solo valen la
 * pena en el carro que siempre esta en pantalla:
 *
 *   ESCARCHA. La pintura metalizada real no es un color con brillo: son
 *   escamas de aluminio de 20 micras suspendidas en la base. Se simulan
 *   bajando la rugosidad en motas aleatorias FIJAS AL MODELO, para que
 *   chispeen al girar el coche y no se queden pegadas a la pantalla. Sin
 *   esto la carroceria parece plastico pintado.
 *
 *   ESTADO POR UNIFORME. Como hay un solo coche no hacen falta atributos de
 *   instancia: freno, direccionales y reversa entran por uniforme.
 */
export function materialHeroe({ escarcha = true } = {}) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.4, metalness: 0.0,
    map: atlasCalcas(),
    clearcoat: 1.0, clearcoatRoughness: 0.035,
  });
  mat.userData.uniformes = {
    uTinte1: { value: new THREE.Color(FURIA.tinte1) },
    uTinte2: { value: new THREE.Color(FURIA.tinte2) },
    // (freno, intermitente izq, intermitente der, reversa)
    uEstado: { value: new THREE.Vector4(0, 0, 0, 0) },
    uFaros: { value: 0.7 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, mat.userData.uniformes);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aBase;
        attribute vec4 aMat;
        attribute float aCapa;
        varying vec3 vBase;
        varying vec4 vMat;
        varying float vCapa;
        varying vec3 vLocal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vBase = aBase; vMat = aMat; vCapa = aCapa; vLocal = transformed;`);

    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uTinte1;
        uniform vec3 uTinte2;
        uniform vec4 uEstado;
        uniform float uFaros;
        varying vec3 vBase;
        varying vec4 vMat;
        varying float vCapa;
        varying vec3 vLocal;
        float esCodigo(float v, float k) { return 1.0 - step(0.5, abs(v - k)); }
        float ruido13(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float esPintura = esCodigo(vMat.x, 1.0) + esCodigo(vMat.x, 2.0);
        vec3 colorPieza = vBase;
        colorPieza = mix(colorPieza, uTinte1, esCodigo(vMat.x, 1.0));
        colorPieza = mix(colorPieza, uTinte2, esCodigo(vMat.x, 2.0));
        diffuseColor.rgb *= colorPieza;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = vMat.y;${escarcha ? `
        float escama = smoothstep(0.981, 0.999, ruido13(floor(vLocal * 1600.0))) * esPintura;
        roughnessFactor = mix(roughnessFactor, 0.045, escama);` : ''}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = vMat.z;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float luz = vMat.w;
        totalEmissiveRadiance += vec3(1.0, 0.97, 0.90) * uFaros * 2.4 * esCodigo(luz, 1.0);
        totalEmissiveRadiance += vec3(1.0, 0.05, 0.02) * (0.35 + 2.6 * uEstado.x) * esCodigo(luz, 2.0);
        totalEmissiveRadiance += vec3(1.0, 0.34, 0.0) * 2.2 * uEstado.y * esCodigo(luz, 3.0);
        totalEmissiveRadiance += vec3(1.0, 0.34, 0.0) * 2.2 * uEstado.z * esCodigo(luz, 4.0);
        totalEmissiveRadiance += diffuseColor.rgb * 1.6 * esCodigo(luz, 5.0);
        totalEmissiveRadiance += vec3(0.95, 0.97, 1.0) * 2.8 * uEstado.w * esCodigo(luz, 6.0);
        totalEmissiveRadiance += vec3(0.86, 0.93, 1.0) * 1.5 * esCodigo(luz, 7.0);`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        material.clearcoat *= vCapa;`);
  };
  // Sin esto three reutiliza el programa de otro material fisico y los
  // atributos propios no existirian.
  mat.customProgramCacheKey = () => 'furia-' + (escarcha ? 'e' : 'p');
  return mat;
}

/** Vidrios del coche del jugador: malla aparte para poder ser transparente. */
export function materialVidrio() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x151c24, roughness: 0.03, metalness: 0.0,
    transparent: true, opacity: 0.62, depthWrite: false,
    side: THREE.DoubleSide, clearcoat: 1.0, clearcoatRoughness: 0.02,
  });
}

// ------------------------------------------------------------------ chapa
const CUERPO = [
  { z: -2.46, w: 0.860, yb: 0.420, yt: 1.000, na: 3.6, nb: 2.8 },
  { z: -2.36, w: 0.930, yb: 0.330, yt: 1.062, na: 4.6, nb: 3.4 },
  { z: -2.10, w: 0.968, yb: 0.252, yt: 1.092, na: 6.4, nb: 4.4 },
  { z: -1.62, w: 0.982, yb: 0.228, yt: 1.094, na: 7.6, nb: 5.2 },
  { z: -1.36, w: 0.985, yb: 0.224, yt: 1.090, na: 8.0, nb: 5.4 },
  { z: -0.96, w: 0.946, yb: 0.218, yt: 1.074, na: 7.8, nb: 5.6 },
  { z: -0.10, w: 0.928, yb: 0.215, yt: 1.050, na: 7.6, nb: 5.4 },
  { z:  0.74, w: 0.938, yb: 0.218, yt: 1.016, na: 7.6, nb: 5.2 },
  { z:  1.18, w: 0.962, yb: 0.224, yt: 0.972, na: 7.2, nb: 4.8 },
  { z:  1.36, w: 0.970, yb: 0.230, yt: 0.948, na: 6.8, nb: 4.6 },
  { z:  1.92, w: 0.952, yb: 0.238, yt: 0.906, na: 5.8, nb: 4.0 },
  { z:  2.24, w: 0.938, yb: 0.248, yt: 0.882, na: 5.2, nb: 3.6 },
  { z:  2.40, w: 0.902, yb: 0.260, yt: 0.842, na: 4.4, nb: 3.1 },
  { z:  2.46, w: 0.830, yb: 0.284, yt: 0.792, na: 3.5, nb: 2.7 },
];

/**
 * Moldura: cinta fina pegada al costado que sigue el ancho REAL del cuerpo.
 * Es la linea de caracter del costado. Sin ella la chapa es una superficie
 * continua sin nada que corte la luz, y el coche se ve de jabon por muy bien
 * proporcionado que este.
 */
function moldura(c, est, z0, z1, y0, y1, grosor, alto, mat, pasos = 26) {
  for (let i = 0; i < pasos; i++) {
    const za = z0 + (z1 - z0) * (i / pasos);
    const zb = z0 + (z1 - z0) * ((i + 1) / pasos);
    const zm = (za + zb) / 2;
    const y = y0 + (y1 - y0) * ((zm - z0) / (z1 - z0));
    const w = anchoEn(est, zm, y);
    if (!(w > 0.2)) continue;
    for (const s of [1, -1]) c.caja(grosor, alto, zb - za + 0.004, s * (w - grosor * 0.25), y, zm, mat);
  }
}

const CABINA = [
  { z: -1.98, yc: 1.075, yr: 1.095, wb: 0.845, wr: 0.700 },
  { z: -1.70, yc: 1.082, yr: 1.185, wb: 0.875, wr: 0.755 },
  { z: -1.30, yc: 1.085, yr: 1.285, wb: 0.895, wr: 0.785 },
  { z: -0.85, yc: 1.078, yr: 1.355, wb: 0.900, wr: 0.795 },
  { z: -0.45, yc: 1.068, yr: 1.382, wb: 0.900, wr: 0.795 },
  { z:  0.00, yc: 1.055, yr: 1.385, wb: 0.896, wr: 0.790 },
  { z:  0.38, yc: 1.040, yr: 1.372, wb: 0.888, wr: 0.772 },
  { z:  0.72, yc: 1.022, yr: 1.270, wb: 0.878, wr: 0.700 },
  { z:  1.02, yc: 1.000, yr: 1.105, wb: 0.862, wr: 0.620 },
  { z:  1.20, yc: 0.985, yr: 1.000, wb: 0.850, wr: 0.700 },
];

const VENTANA = {
  yInf: 0.050, margenTecho: 0.075, zIni: 1.00, zFin: -1.14,
  pilarA: 0.080, pilarC: 0.215, lunetaMinY: 1.135,
};

/** Franjas Le Mans: dos bandas por el eje, con su separacion en medio. */
const enFranja = (cx) => { const s = Math.abs(cx); return s > 0.035 && s < 0.175; };

const cerca = (v, k, t) => Math.abs(v - k) < t;

// ----------------------------------------------- piezas dentro de un marco
/**
 * Un MARCO es la terna (punto, normal) de la chapa en un sitio del morro o
 * de la cola. Pegar cada luz por separado con panelEnSuperficie las dispersa:
 * una pieza a una altura que el morro ya no alcanza se desliza hacia atras y
 * acaba sobre el capo. Tomando UN marco por grupo optico y colocando sus
 * piezas dentro, todas quedan en el mismo plano, como una pieza real.
 *
 * Dentro del marco: +dz hacia fuera del coche, +dy hacia arriba. En el morro
 * +dx va a la izquierda del coche; en la cola, a la derecha (el marco mira al
 * otro lado). Por eso los lados usan `s` y `-s` segun el extremo.
 */
const _marco = new THREE.Matrix4();

function piezaEnMarco(c, marco, ancho, alto, grosor, dx, dy, dz, mat) {
  const geo = new THREE.ExtrudeGeometry(rectRedondeado(ancho, alto, Math.min(ancho, alto) * 0.3), {
    depth: grosor, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006,
    bevelSegments: 1, curveSegments: 3,
  });
  geo.translate(0, 0, -grosor / 2);
  c.agregar(geo, mat, _marco.copy(marco).multiply(matrizDe(dx, dy, dz)));
}

/** Placa de matricula pegada a un marco, con su calca mirando hacia fuera. */
function placaEnMarco(c, marco, dx, dy, dz, region) {
  const geo = new THREE.BoxGeometry(0.33, 0.105, 0.03);
  let tri = 0;
  // BoxGeometry agrupa +x,-x,+y,-y,+z,-z; el 4 es +z, que aqui mira afuera.
  c.agregar(geo, () => (Math.floor(tri++ / 2) === 4 ? calca(region) : MAT.negroMate),
    _marco.copy(marco).multiply(matrizDe(dx, dy, dz)));
}


/**
 * ¿El punto cae sobre una junta de chapa? Las lineas de corte del capo, las
 * puertas y el baul son lo que distingue una carroceria de un bloque de
 * plastico, y salen gratis: se pintan de negro los cuadros que las cruzan.
 */
function enJunta(cx, cy, cz, nx, ny) {
  const ax = Math.abs(cx);
  const arriba = ny > 0.30;
  const lado = Math.abs(nx) > 0.45;
  if (arriba && cz > 1.14 && cz < 2.30) {
    if (cerca(cz, 1.185, 0.018)) return true;                  // borde trasero del capó
    if (cerca(ax, 0.735, 0.015) && cz > 1.20) return true;     // costados contra las aletas
  }
  if (lado && cy > 0.27 && cy < 1.09) {
    if (cerca(cz, 0.985, 0.016)) return true;                  // puerta: borde delantero
    if (cerca(cz, -0.790, 0.016)) return true;                 // puerta: borde trasero
  }
  if (arriba && cerca(cz, -1.995, 0.018) && ax < 0.80) return true;   // baúl
  if (lado && cx > 0) {                                        // tapa de la gasolina
    const d = Math.hypot(cz + 1.58, (cy - 0.90) * 1.15);
    if (d > 0.078 && d < 0.095) return true;
  }
  return false;
}

/** Clasifica cada cuadro de la carroceria baja. */
function claseCuerpo(cx, cy, cz, nx, ny) {
  if (ny < -0.60) return MAT.negroMate;                            // bajos
  if (enJunta(cx, cy, cz, nx, ny)) return MAT.junta;
  if (cy < 0.285 && Math.abs(nx) > 0.40) return MAT.negroMate;     // faldón lateral
  if (ny > 0.45 && enFranja(cx)) return MAT.franja;
  return MAT.pintura;
}

/**
 * Clasifica cada cuadro del habitaculo. La MISMA malla se recorre dos veces:
 * una para la chapa (devuelve null donde hay vidrio) y otra para el vidrio
 * (null donde hay chapa). Asi el parabrisas puede ser transparente de verdad
 * sin que la chapa lo sea.
 */
function claseCabina(soloVidrio) {
  const yMax = Math.max(...CABINA.map(e => e.yr));
  const enTecho = CABINA.filter(e => e.yr > yMax - 0.025).map(e => e.z);
  const zTechoF = Math.max(...enTecho), zTechoR = Math.min(...enTecho);
  const v = VENTANA;

  return (cx, cy, cz, nx) => {
    const e = interpolar(CABINA, cz);
    const alto = e.yr - e.yc;
    const lateral = Math.abs(nx) > 0.45;
    let esVidrio = false;
    if (!lateral && cz > zTechoF + 0.03) {
      // El parabrisas se decide por POSICION, no por la normal: uno tendido
      // a 30 grados tiene la normal mas vertical que horizontal.
      esVidrio = Math.abs(cx) < e.wr - v.pilarA;
    } else if (!lateral && cz < zTechoR - 0.03) {
      esVidrio = cy >= v.lunetaMinY && Math.abs(cx) < e.wr - v.pilarC;
    } else if (lateral) {
      const yv = e.yc + Math.min(v.yInf, alto * 0.25);
      const yTop = e.yr - Math.min(v.margenTecho, alto * 0.3);
      esVidrio = cy > yv && cy < yTop && cz < v.zIni && cz > v.zFin;
    }
    if (soloVidrio) return esVidrio ? MAT.negroBrillo : null;
    if (esVidrio) return null;
    if (!lateral && cz < zTechoF && cz > zTechoR && enFranja(cx)) return MAT.franja;
    return MAT.pintura;
  };
}

// ------------------------------------------------------------------ rueda
/**
 * Rueda del jugador: neumatico de perfil bajo con tacos de dibujo y rin de
 * cinco radios dobles con labio pulido. Mira hacia +X (la cara de fuera del
 * lado izquierdo del coche).
 *
 * OJO CON EL RADIO: Vehicle mide el radio de la rueda con la CAJA de este
 * nodo. Si un taco sobresale del radio nominal, la fisica cree que la rueda
 * es mas grande, levanta el buje y el neumatico queda flotando. Por eso la
 * banda de rodadura se hunde 1 cm y los tacos la devuelven justo al radio.
 */
function ruedaFuria(radio, ancho, { tacos = true } = {}) {
  const c = new Constructor();
  const w = ancho / 2;
  const rBanda = radio - 0.011;
  const rLlanta = radio * 0.715;             // donde acaba el caucho y empieza el rin

  // PERFIL BAJO DE VERDAD: la banda de rodadura se mantiene al radio pleno
  // en el 74 % central del ancho y solo cae en el hombro. Un perfil de
  // revolucion redondeado (el del trafico) encoge la rueda un 20 % a la
  // vista y el coche parece un juguete con ruedas pequenas.
  const perfil = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const t = i / N;                       // 0..1 de un flanco al otro
    const u = Math.abs(t * 2 - 1);         // 0 en el centro, 1 en el borde
    const caida = Math.pow(Math.max(0, (u - 0.74) / 0.26), 1.7);
    const r = rBanda - (rBanda - rLlanta) * caida;
    perfil.push(new THREE.Vector2(r, (t * 2 - 1) * w));
  }
  const neumatico = new THREE.LatheGeometry(perfil, 30);
  neumatico.rotateZ(Math.PI / 2);
  c.agregar(neumatico, MAT.caucho);

  // Tacos en V. A medio metro de la camara una banda lisa se ve de plastico.
  if (tacos) {
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      for (const d of [-0.30, 0.0, 0.30]) {
        const taco = new THREE.BoxGeometry(ancho * 0.22, 0.022, 0.052);
        taco.translate(d * ancho, rBanda, 0);
        taco.rotateX(a + d * 0.22);
        c.agregar(taco, MAT.caucho);
      }
    }
  }

  // Rin: labio pulido, plato en sombra, cinco radios dobles, tuercas.
  const labio = new THREE.TorusGeometry(rLlanta * 0.985, 0.028, 6, 26);
  labio.rotateY(Math.PI / 2);
  c.agregar(labio, MAT.rinPulido, matrizDe(w * 0.52, 0, 0));
  const plato = new THREE.CylinderGeometry(rLlanta * 0.97, rLlanta * 0.97, 0.035, 26);
  plato.rotateZ(Math.PI / 2);
  c.agregar(plato, MAT.rin, matrizDe(-w * 0.25, 0, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    for (const d of [-1, 1]) {
      const largo = rLlanta * 0.70;
      const radioG = new THREE.BoxGeometry(0.085, largo, 0.052);
      radioG.translate(0, rLlanta * 0.26 + largo / 2, d * 0.058);
      radioG.rotateX(a + d * 0.075);
      c.agregar(radioG, MAT.rin, matrizDe(w * 0.22, 0, 0));
    }
  }
  const cubo = new THREE.CylinderGeometry(rLlanta * 0.28, rLlanta * 0.30, 0.09, 14);
  cubo.rotateZ(Math.PI / 2);
  c.agregar(cubo, MAT.rin, matrizDe(w * 0.40, 0, 0));
  c.cilindroX(rLlanta * 0.16, 0.02, w * 0.47, 0, 0, MAT.pinza, 14);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    c.cilindroX(0.022, 0.03, w * 0.44, Math.cos(a) * rLlanta * 0.21, Math.sin(a) * rLlanta * 0.21, MAT.cromo, 6);
  }
  return c.construir();
}

/** Disco y pinza: van al buje, que NO gira con la rueda (como en un coche real). */
function frenoFuria(radio, ancho) {
  const c = new Constructor();
  const rD = radio * 0.655;
  const disco = new THREE.CylinderGeometry(rD, rD, 0.028, 26);
  disco.rotateZ(Math.PI / 2);
  c.agregar(disco, MAT.disco, matrizDe(-ancho * 0.08, 0, 0));
  const campana = new THREE.CylinderGeometry(rD * 0.42, rD * 0.42, 0.06, 16);
  campana.rotateZ(Math.PI / 2);
  c.agregar(campana, MAT.rin, matrizDe(-ancho * 0.02, 0, 0));
  // Pinza de seis pistones, detras y arriba del eje.
  c.caja(0.052, 0.16, 0.20, -ancho * 0.08, rD * 0.74, -rD * 0.42, MAT.pinza);
  c.caja(0.090, 0.11, 0.17, -ancho * 0.08, rD * 0.70, -rD * 0.40, MAT.pinza);
  return c.construir();
}

/** Volante: aro, tres radios y maza. Gira sobre su Z, que es la columna. */
function volanteFuria() {
  const c = new Constructor();
  const r = 0.175;
  const aro = new THREE.TorusGeometry(r, 0.023, 8, 26);
  c.agregar(aro, MAT.cuero);
  for (const a of [Math.PI, Math.PI / 3, -Math.PI / 3]) {
    const radio = new THREE.BoxGeometry(0.045, r, 0.022);
    radio.translate(0, r / 2, 0);
    radio.rotateZ(a);
    c.agregar(radio, MAT.negroBrillo);
  }
  const maza = new THREE.CylinderGeometry(0.052, 0.052, 0.05, 14);
  maza.rotateX(Math.PI / 2);
  c.agregar(maza, MAT.negroMate);
  // Marca de las doce, para que se vea cuanto se esta girando.
  c.caja(0.030, 0.045, 0.026, 0, r - 0.012, 0.004, MAT.aguja);
  return c.construir();
}

// ------------------------------------------------------------------ montaje
/**
 * Construye el FURIA GT listo para pasarselo a Vehicle.
 * @param {{detalle?:number, escarcha?:boolean}} o
 */
export function construirFuria({ detalle = 1, escarcha = true } = {}) {
  fijarDetalle(detalle);
  const c = new Constructor();      // chapa y todo lo opaco
  const g = new Constructor();      // vidrios
  const est = CUERPO;

  // --- carroceria ---------------------------------------------------------
  const [cuerpo, tapaR, tapaF] = cuerpoLoft(est, 72, 56);
  c.agregar(cuerpo, claseCuerpo);
  c.agregar(tapaR, (cx, cy) => (cy < 0.5 ? MAT.negroMate : MAT.pintura));
  c.agregar(tapaF, (cx, cy) => (cy < 0.5 ? MAT.negroMate : MAT.pintura));

  // --- habitaculo: la chapa a una malla, el vidrio a la otra ---------------
  const hab = habitaculoLoft(CABINA, 48, {
    yInf: VENTANA.yInf, margenTecho: VENTANA.margenTecho,
    zsExtra: [VENTANA.zIni, VENTANA.zFin],
  });
  c.agregar(hab, claseCabina(false));
  g.agregar(hab, claseCabina(true));

  // --- lineas de caracter del costado -------------------------------------
  // La alta nace sobre la rueda delantera y muere en el hombro trasero; la
  // baja recorre el faldon. Entre las dos es lo que le da relieve al costado.
  moldura(c, est, 1.30, -1.55, 0.905, 0.955, 0.022, 0.045, MAT.pintura);
  moldura(c, est, 1.10, -1.30, 0.555, 0.520, 0.018, 0.060, MAT.pintura);

  // --- pasos de rueda ------------------------------------------------------
  for (const z of [FURIA.batalla / 2, -FURIA.batalla / 2]) {
    for (const s of [1, -1]) {
      // Labio de la aleta: fino y pegado al neumatico. Con holgura grande se
      // ve el anillo suelto alrededor de la rueda, que es lo que delata un
      // paso de rueda pegado en vez de recortado en la chapa.
      pasoDeRueda(c, s * (FURIA.via + 0.075), z, FURIA.radioRueda, MAT.pintura,
        { holgura: 0.012, ancho: 0.034, fondo: 0.10 });
      // Pase interior oscuro: el hueco de la rueda no puede ser un agujero
      // al cielo cuando la camara va baja.
      pasoDeRueda(c, s * (FURIA.via - 0.07), z, FURIA.radioRueda, MAT.negroMate,
        { holgura: 0.010, ancho: 0.095, fondo: 0.30 });
    }
  }

  // --- morro: boca, grupos opticos y splitter -----------------------------
  const boca = marcoEnSuperficie(CUERPO, 1, 0, 0.615).clone();
  piezaEnMarco(c, boca, 1.16, 0.27, 0.11, 0, 0, -0.040, MAT.negroMate);
  for (let i = -6; i <= 6; i++) piezaEnMarco(c, boca, 0.022, 0.23, 0.05, i * 0.085, 0, 0.004, MAT.negroBrillo);
  piezaEnMarco(c, boca, 1.19, 0.028, 0.07, 0, 0.146, 0.014, MAT.carbono);
  placaEnMarco(c, boca, 0, -0.005, 0.030, REGION.placa);

  for (const s of [1, -1]) {
    const lampara = marcoEnSuperficie(CUERPO, 1, s * 0.615, 0.700).clone();
    piezaEnMarco(c, lampara, 0.50, 0.205, 0.08, 0, 0, -0.030, MAT.negroMate);
    piezaEnMarco(c, lampara, 0.455, 0.165, 0.05, 0, 0, 0.008, MAT.faroLente);
    for (let i = 0; i < 3; i++) {
      piezaEnMarco(c, lampara, 0.090, 0.110, 0.030, (i - 1) * 0.110, -0.014, 0.022, MAT.faro);
    }
    // Ceja diurna arriba y direccional en el canto de fuera.
    piezaEnMarco(c, lampara, 0.40, 0.026, 0.028, 0, 0.060, 0.024, MAT.diurna);
    piezaEnMarco(c, lampara, 0.065, 0.110, 0.030, s * 0.190, -0.014, 0.022, s > 0 ? MAT.intIzq : MAT.intDer);
  }

  // Toma baja que alimenta los frenos, y el splitter de carbono bajo ella.
  const bajo = marcoEnSuperficie(CUERPO, 1, 0, 0.370).clone();
  piezaEnMarco(c, bajo, 1.06, 0.095, 0.08, 0, 0, -0.030, MAT.negroBrillo);
  c.caja(1.78, 0.030, 0.34, 0, 0.258, 2.26, MAT.carbono);
  for (const s of [1, -1]) c.caja(0.030, 0.075, 0.30, s * 0.86, 0.300, 2.20, MAT.carbono);

  // --- capó: lomos de potencia y la toma de aire --------------------------
  // Van como piezas aparte porque el loft no puede levantar una joroba local
  // sin deformar la seccion entera. Y van SIGUIENDO la altura del capo: una
  // pieza recta sobre un capo que baja se despega por delante y se lee como
  // una aleta clavada en la chapa.
  for (const s of [1, -1]) {
    lomoDeCapo(c, s * 0.335, 1.30, 2.22, 0.30, 0.040);
  }
  // Toma de aire mirando adelante, sobre el lomo central.
  const yToma = interpolar(CUERPO, 1.90).yt;
  c.caja(0.50, 0.075, 0.42, 0, yToma + 0.030, 1.90, MAT.pintura, [-0.055, 0, 0]);
  c.caja(0.42, 0.048, 0.05, 0, yToma + 0.038, 2.105, MAT.negroMate);
  // Branquias de extraccion detras de las ruedas delanteras.
  for (const s of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const y = 0.845 - i * 0.045;
      c.caja(0.012, 0.028, 0.16, s * (anchoEn(CUERPO, 1.00, y) - 0.004), y, 1.00, MAT.negroBrillo);
    }
  }

  // --- costado: espejos, manijas, faldones ---------------------------------
  const ec = interpolar(CABINA, 0.95);
  for (const s of [1, -1]) {
    c.caja(0.07, 0.030, 0.045, s * (ec.wb + 0.035), ec.yc + 0.055, 0.93, MAT.negroMate);
    c.panel(0.165, 0.095, 0.085, 0.040, s * (ec.wb + 0.125), ec.yc + 0.075, 0.90, MAT.pintura, [0, s * 0.20, 0]);
    c.panel(0.140, 0.080, 0.012, 0.034, s * (ec.wb + 0.125), ec.yc + 0.075, 0.855, MAT.negroBrillo, [0, Math.PI + s * 0.20, 0]);
    const xm = anchoEn(est, 0.30, 0.955);
    c.caja(0.035, 0.040, 0.165, s * (xm - 0.012), 0.955, 0.30, MAT.negroBrillo);
    c.caja(0.022, 0.028, 0.125, s * (xm + 0.012), 0.955, 0.30, MAT.cromo);
    c.caja(0.045, 0.075, 1.85, s * (anchoEn(est, 0, 0.27) - 0.005), 0.252, -0.05, MAT.carbono);
  }

  // --- cola: pilotos de tres barras, difusor, escapes, alerón --------------
  // OJO: en la cola el marco mira a -Z, asi que su +dx va a la DERECHA del
  // coche. Lo de "mas afuera" en cada lado es por eso -s y no s.
  for (const s of [1, -1]) {
    const piloto = marcoEnSuperficie(CUERPO, -1, s * 0.545, 0.880).clone();
    piezaEnMarco(c, piloto, 0.52, 0.30, 0.08, 0, 0, -0.030, MAT.negroMate);
    for (let i = 0; i < 3; i++) {
      // La barra de mas afuera hace de direccional, como en los de verdad.
      const fuera = i === 2;
      piezaEnMarco(c, piloto, 0.125, 0.245, 0.045, -s * (i - 1) * 0.150, 0, 0.012,
        fuera ? (s > 0 ? MAT.intIzq : MAT.intDer) : MAT.piloto);
    }
  }
  const panelCola = marcoEnSuperficie(CUERPO, -1, 0, 0.880).clone();
  piezaEnMarco(c, panelCola, 0.76, 0.28, 0.05, 0, 0, -0.018, MAT.negroBrillo);
  placaEnMarco(c, panelCola, 0, 0, 0.022, REGION.placa2);
  const valance = marcoEnSuperficie(CUERPO, -1, 0, 0.560).clone();
  for (const s of [1, -1]) piezaEnMarco(c, valance, 0.17, 0.065, 0.04, s * 0.46, 0, 0.012, MAT.reversa);

  // Difusor con aletas y cuatro salidas de escape centrales: el V8 se oye y
  // tambien se ve.
  c.panel(1.52, 0.20, 0.05, 0.03, 0, 0.360, -2.30, MAT.carbono, [0.30, Math.PI, 0]);
  for (let i = -3; i <= 3; i++) c.caja(0.022, 0.175, 0.30, i * 0.21, 0.355, -2.28, MAT.carbono);
  for (const x of [-0.46, -0.30, 0.30, 0.46]) {
    c.cilindroZ(0.058, 0.20, x, 0.345, -2.35, MAT.cromo, 14);
    c.cilindroZ(0.044, 0.12, x, 0.345, -2.39, MAT.negroMate, 12);
  }
  // Alerón de pato: el labio del baúl levantado, con la tercera luz de freno.
  c.panel(1.46, 0.185, 0.050, 0.030, 0, 1.140, -2.04, MAT.pintura, [-Math.PI / 2 + 0.44, 0, 0]);
  c.caja(0.52, 0.022, 0.030, 0, 1.180, -2.01, MAT.piloto);

  // --- interior (se ve a traves del vidrio) --------------------------------
  const anclaVolante = interior(c);

  const geo = c.construir();
  const geoVidrio = g.construir();

  // --- montaje de nodos ----------------------------------------------------
  const objeto = new THREE.Group();
  objeto.name = 'FuriaGT';
  const material = materialHeroe({ escarcha });
  const vidrio = materialVidrio();

  const carroceria = new THREE.Mesh(geo, material);
  carroceria.name = 'FuriaCarroceria';
  carroceria.castShadow = true;
  carroceria.receiveShadow = true;
  objeto.add(carroceria);

  const cristales = new THREE.Mesh(geoVidrio, vidrio);
  cristales.name = 'FuriaVidrios';
  cristales.renderOrder = 2;
  objeto.add(cristales);

  const volante = new THREE.Mesh(volanteFuria(), material);
  anclaVolante.children[0].add(volante);
  objeto.add(anclaVolante);

  // Ruedas: Vehicle busca estos cuatro nombres, lee de ellos la posicion del
  // buje y el radio, y reparte sus hijos entre el grupo que gira con la
  // direccion y el que gira al rodar.
  const ruedaF = ruedaFuria(FURIA.radioRueda, 0.270, { tacos: detalle >= 1 });
  const ruedaR = ruedaFuria(FURIA.radioRueda, 0.320, { tacos: detalle >= 1 });
  const frenoF = frenoFuria(FURIA.radioRueda, 0.270);
  const frenoR = frenoFuria(FURIA.radioRueda, 0.320);
  const ejes = [
    ['WheelFrontL', 1, FURIA.batalla / 2, ruedaF, frenoF],
    ['WheelFrontR', -1, FURIA.batalla / 2, ruedaF, frenoF],
    ['WheelRearL', 1, -FURIA.batalla / 2, ruedaR, frenoR],
    ['WheelRearR', -1, -FURIA.batalla / 2, ruedaR, frenoR],
  ];
  for (const [nombre, lado, z, geoR, geoP] of ejes) {
    const buje = new THREE.Group();
    buje.name = nombre;
    buje.position.set(lado * FURIA.via, FURIA.radioRueda, z);
    const rueda = new THREE.Mesh(geoR, material);
    rueda.name = nombre + 'Tire';
    rueda.castShadow = true;
    // El lado derecho es el mismo rin girado: su cara de fuera mira a -X.
    if (lado < 0) rueda.rotation.y = Math.PI;
    buje.add(rueda);
    const freno = new THREE.Mesh(geoP, material);
    freno.name = nombre + 'BrakePad';
    if (lado < 0) freno.rotation.y = Math.PI;
    buje.add(freno);
    objeto.add(buje);
  }

  fijarDetalle(1);
  return { objeto, material, vidrio, ficha: FURIA };
}

/** Lomo del capó: cinta ancha que sigue la altura real de la chapa. */
function lomoDeCapo(c, x, z0, z1, ancho, alto, pasos = 14) {
  for (let i = 0; i < pasos; i++) {
    const za = z0 + (z1 - z0) * (i / pasos);
    const zb = z0 + (z1 - z0) * ((i + 1) / pasos);
    const zm = (za + zb) / 2;
    const y = interpolar(CUERPO, zm).yt;
    // Se afina en las puntas para que nazca y muera en la chapa.
    const t = Math.min(1, Math.min(zm - z0, z1 - zm) / 0.28);
    c.caja(ancho * (0.45 + 0.55 * t), alto, zb - za + 0.004, x, y - alto * 0.25, zm, MAT.pintura);
  }
}

/**
 * Asientos, tablero, consola y columna de direccion. Sin interior el vidrio
 * transparente enseña el vacio y el coche se ve hueco.
 * @returns {THREE.Group} la columna, con el nodo del volante dentro
 */
function interior(c) {
  c.caja(1.52, 0.04, 2.10, 0, 0.455, -0.25, MAT.alcantara);
  c.caja(1.52, 0.52, 0.05, 0, 0.720, -1.30, MAT.alcantara);
  c.caja(1.56, 0.17, 0.34, 0, 1.000, 0.735, MAT.tablero, [-0.22, 0, 0]);
  c.caja(1.50, 0.04, 0.30, 0, 0.925, 0.600, MAT.tablero);
  // Cuadro de instrumentos delante del conductor (en Colombia va a la
  // izquierda del coche, que en estos ejes es +X).
  c.panel(0.40, 0.17, 0.03, 0.03, 0.355, 1.035, 0.60, MAT.pantalla, [-0.30, 0, 0]);
  c.caja(0.26, 0.012, 0.012, 0.355, 1.045, 0.575, MAT.aguja);
  c.caja(0.34, 0.26, 0.90, 0, 0.600, 0.18, MAT.tablero);
  c.cilindroY(0.022, 0.17, 0, 0.805, 0.32, MAT.cromo, 8);
  c.panel(0.10, 0.10, 0.04, 0.03, 0, 0.895, 0.32, MAT.cuero);
  for (const s of [1, -1]) {
    const x = s * 0.375;
    c.caja(0.50, 0.12, 0.52, x, 0.545, -0.12, MAT.cueroRojo);
    c.caja(0.50, 0.62, 0.12, x, 0.855, -0.40, MAT.cueroRojo, [-0.20, 0, 0]);
    c.caja(0.26, 0.20, 0.10, x, 1.155, -0.47, MAT.cueroRojo, [-0.20, 0, 0]);
    for (const d of [1, -1]) c.caja(0.07, 0.52, 0.10, x + d * 0.215, 0.835, -0.385, MAT.cuero, [-0.20, 0, 0]);
  }
  // El nodo que gira tiene que colgar de uno YA inclinado: Vehicle.render
  // mueve el volante en su eje Z, y ese eje debe ser el de la columna.
  const columna = new THREE.Group();
  columna.name = 'ColumnaDireccion';
  columna.rotation.x = -0.42;
  columna.position.set(0.375, 0.945, 0.56);
  const volante = new THREE.Group();
  volante.name = 'InteriorSteeringWheel01';
  columna.add(volante);
  return columna;
}
