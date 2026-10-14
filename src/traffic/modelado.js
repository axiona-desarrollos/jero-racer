/* ==========================================================================
   JERO RACER · Taller de modelado de vehiculos
   --------------------------------------------------------------------------
   Los vehiculos del trafico se MODELAN EN CODIGO, no se descargan. Se busco
   primero material libre y realista: lo que es CC0 y se baja sin cuenta es de
   estilo caricatura, y lo realista exige registrarse o tiene licencia que no
   permite publicarlo. Modelarlos aqui da tres cosas a la vez: licencia propia,
   pocos triangulos para que el movil aguante 50 vehiculos, y control total
   sobre luces de freno e intermitentes.

   UNA SOLA LLAMADA DE DIBUJO POR TIPO DE VEHICULO
   Cada tipo es UNA geometria con todo dentro — carroceria, vidrios, faros,
   placa, plasticos — y UN material. Lo que distingue la pintura del vidrio o
   del cromo no son materiales distintos sino atributos por vertice:
     aBase  color fijo de la pieza (vidrio, caucho, cromo, placa...)
     aMat   (tinte, rugosidad, metalico, luz)
            tinte 0 = usa aBase · 1 = pintura principal · 2 = pintura secundaria
            luz   0 nada · 1 faro · 2 piloto · 3 intermitente izq · 4 der · 5 letrero
     aCapa  laca (clearcoat) de la pieza
   y atributos POR INSTANCIA:
     aTinte1, aTinte2  los colores de esa unidad concreta
     aEstado           (freno, intermitente izq, intermitente der)
   El shader estandar de three se parchea en onBeforeCompile para leerlos. Asi
   50 vehiculos de 9 tipos cuestan 9 llamadas, no 50 x 20 piezas.

   CONVENCION DE EJES (la de todo el juego): el vehiculo mira a +Z, +Y arriba,
   y +X es su IZQUIERDA. El origen esta en el suelo, en el centro de la planta.
   ========================================================================== */

import * as THREE from 'three';
import * as PUB from './publicidad.js';

// ------------------------------------------------------------ nivel de detalle
/**
 * Nivel de detalle con el que se modela. 1 = cerca. Menor que 1 = version
 * para lejos: secciones mas gruesas, sin biseles y sin las piezas pequenas
 * (espejos, placas, tuercas), que a 300 m ocupan menos de un pixel y solo
 * cuestan vertices. Con 56 vehiculos en via la diferencia es de millones de
 * triangulos por fotograma contando la pasada de sombras.
 */
let DETALLE = 1;
export const fijarDetalle = d => { DETALLE = d; };
export const detalle = () => DETALLE;
const _caja = new THREE.Box3();
const _tam = new THREE.Vector3();

// ------------------------------------------------------------- materiales
/**
 * Descriptor de material de una pieza.
 * @typedef {{c?:number, t?:number, r?:number, m?:number, l?:number, k?:number, uv?:number[]}} Mat
 */
export const M = Object.freeze({
  pintura:   { c: 0xffffff, t: 1, r: 0.36, m: 0.12, k: 1 },
  pintura2:  { c: 0xffffff, t: 2, r: 0.42, m: 0.10, k: 0.7 },
  vidrio:    { c: 0x0c1218, r: 0.04, m: 0.35, k: 1 },
  plastico:  { c: 0x16181b, r: 0.72, m: 0.0 },
  plasticoS: { c: 0x23262b, r: 0.55, m: 0.05 },
  caucho:    { c: 0x141414, r: 0.93, m: 0.0 },
  rin:       { c: 0xc4c8ce, r: 0.26, m: 1.0 },
  rinOscuro: { c: 0x3b3e43, r: 0.35, m: 0.9 },
  acero:     { c: 0xd9dbde, r: 0.42, m: 0.85 },
  cromo:     { c: 0xf2f2f2, r: 0.10, m: 1.0 },
  faro:      { c: 0xd9e0ea, r: 0.06, m: 0.6, l: 1, k: 0.6 },
  piloto:    { c: 0x3d0303, r: 0.22, m: 0.1, l: 2, k: 0.25 },
  intIzq:    { c: 0x7a3d06, r: 0.25, m: 0.1, l: 3, k: 0.25 },
  intDer:    { c: 0x7a3d06, r: 0.25, m: 0.1, l: 4, k: 0.25 },
  blanco:    { c: 0xeeeeea, r: 0.5, m: 0.05 },
  aluminio:  { c: 0xc9ccd0, r: 0.38, m: 0.75 },
  interior:  { c: 0x0b0c0e, r: 0.9, m: 0.0 },
  guardafango: { c: 0x101113, r: 0.85, m: 0.0 },
});

/** Copia un material con cambios. */
export const conMat = (base, cambios) => ({ ...base, ...cambios });

// ------------------------------------------------------------ atlas de calcas
/**
 * Atlas de calcomanias, generado en un canvas: placas, letrero de taxi y los
 * rotulos de buses y camiones. La esquina (0,0)-(32,32) es blanca y es donde
 * apunta toda pieza sin calca, para que el mismo material sirva para todo.
 */
// 2048: la mitad derecha y la de abajo son de publicidad, que tiene que
// leerse a la distancia de un adelantamiento.
const ATLAS = 2048;
export const REGION = Object.freeze({
  blanco:     [0, 0, 32, 32],
  placa:      [40, 0, 296, 128],
  placa2:     [300, 0, 556, 128],
  taxi:       [560, 0, 816, 64],
  taxiLado:   [560, 68, 816, 128],
  rotuloA:    [0, 136, 1024, 392],
  rotuloB:    [0, 400, 1024, 656],
  franjasBus: [0, 664, 1024, 792],
  franjasBus2:[0, 800, 1024, 928],
  parrilla:   [820, 0, 1024, 128],
  destino:    [0, 936, 512, 1000],
  destino2:   [516, 936, 1024, 1000],
  // Publicidad (publicidad.js)
  pubAxionasoft:  [1024, 0, 2048, 256],
  pubTakamura:    [1024, 256, 2048, 512],
  pubJero:        [1024, 512, 2048, 768],
  pubBus:         [1024, 768, 2048, 928],
  mulaAxionasoft: [0, 1024, 2048, 1408],
  mulaJero:       [0, 1408, 2048, 1792],
  trasAxionasoft: [0, 1792, 512, 2048],
  trasTakamura:   [512, 1792, 1024, 2048],
  trasJero:       [1024, 1792, 1536, 2048],
  trasRacer:      [1536, 1792, 2048, 2048],
  // Persecucion y mas publicidad (reusan huecos del atlas que ya no se usaban)
  policiaLado:    [0, 136, 1024, 238],
  ejercitoLado:   [0, 400, 1024, 500],
  pubBusTakamura: [0, 800, 800, 928],
  pubBusAxiona:   [0, 238, 1024, 392],
});

let atlasCache = null;

/** @returns {THREE.CanvasTexture} */
export function atlasCalcas() {
  if (atlasCache) return atlasCache;
  const c = document.createElement('canvas');
  c.width = c.height = ATLAS;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, ATLAS, ATLAS);

  const rect = (r) => ({ x: r[0], y: r[1], w: r[2] - r[0], h: r[3] - r[1] });

  // Placa colombiana: amarilla, letras negras, ciudad abajo.
  const placa = (r, texto, ciudad) => {
    const p = rect(r);
    g.fillStyle = '#f3c614';
    g.fillRect(p.x, p.y, p.w, p.h);
    g.strokeStyle = '#111'; g.lineWidth = 6;
    g.strokeRect(p.x + 5, p.y + 5, p.w - 10, p.h - 10);
    g.fillStyle = '#111';
    g.font = 'bold 66px "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(texto, p.x + p.w / 2, p.y + p.h * 0.44);
    g.font = 'bold 20px Arial, sans-serif';
    g.fillText(ciudad, p.x + p.w / 2, p.y + p.h * 0.84);
  };
  placa(REGION.placa, 'JRO 777', 'MEDELLÍN');
  placa(REGION.placa2, 'AXN 204', 'SABANETA');

  // Letrero de taxi: caja blanca con TAXI en negro.
  for (const [r, txt] of [[REGION.taxi, 'TAXI'], [REGION.taxiLado, 'SERVICIO PÚBLICO']]) {
    const p = rect(r);
    g.fillStyle = '#f6f4ea'; g.fillRect(p.x, p.y, p.w, p.h);
    g.fillStyle = '#121212';
    g.font = `bold ${r === REGION.taxi ? 50 : 28}px Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, p.x + p.w / 2, p.y + p.h / 2 + 2);
  }

  // Franjas de bus intermunicipal: el colorido clasico de las flotas.
  const franjas = (r, colores) => {
    const p = rect(r);
    g.fillStyle = '#ffffff'; g.fillRect(p.x, p.y, p.w, p.h);
    colores.forEach((col, i) => {
      g.fillStyle = col;
      const y0 = p.y + p.h * (0.18 + i * 0.2);
      g.beginPath();
      g.moveTo(p.x, y0 + 18);
      g.bezierCurveTo(p.x + p.w * 0.4, y0 - 30, p.x + p.w * 0.6, y0 + 60, p.x + p.w, y0);
      g.lineTo(p.x + p.w, y0 + p.h * 0.12);
      g.bezierCurveTo(p.x + p.w * 0.6, y0 + 72, p.x + p.w * 0.4, y0 - 18, p.x, y0 + 18 + p.h * 0.12);
      g.closePath(); g.fill();
    });
  };
  franjas(REGION.franjasBus, ['#e8402a', '#f3c614', '#1d6fd1']);
  PUB.franjaPolicia(g, REGION.policiaLado);
  PUB.franjaEjercito(g, REGION.ejercitoLado);
  PUB.busTakamura(g, REGION.pubBusTakamura);
  PUB.axionaTikTok(g, REGION.pubBusAxiona);

  // Parrilla cromada de tractomula: barras horizontales.
  {
    const p = rect(REGION.parrilla);
    g.fillStyle = '#2a2d31'; g.fillRect(p.x, p.y, p.w, p.h);
    for (let y = p.y + 6; y < p.y + p.h; y += 12) {
      const grd = g.createLinearGradient(0, y, 0, y + 7);
      grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, '#8a8f96');
      g.fillStyle = grd; g.fillRect(p.x + 6, y, p.w - 12, 7);
    }
  }

  // Letrero de destino de bus: LED ambar sobre negro. Brilla solo lo que tiene
  // color, porque el material lo hace emisivo en proporcion al texel.
  for (const [r, txt] of [[REGION.destino, 'MEDELLÍN ⇄ BOGOTÁ'], [REGION.destino2, 'RIONEGRO · AEROPUERTO']]) {
    const p = rect(r);
    g.fillStyle = '#050505'; g.fillRect(p.x, p.y, p.w, p.h);
    g.fillStyle = '#ffb21e';
    g.font = 'bold 36px "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, p.x + p.w / 2, p.y + p.h / 2 + 2);
  }

  PUB.lateralAxionasoft(g, REGION.pubAxionasoft);
  PUB.lateralTakamura(g, REGION.pubTakamura);
  PUB.lateralJero(g, REGION.pubJero);
  PUB.busPublicidad(g, REGION.pubBus);
  PUB.mulaAxionasoft(g, REGION.mulaAxionasoft);
  PUB.mulaJero(g, REGION.mulaJero);
  PUB.traseraAxionasoft(g, REGION.trasAxionasoft);
  PUB.traseraTakamura(g, REGION.trasTakamura);
  PUB.traseraJero(g, REGION.trasJero);
  PUB.traseraRacer(g, REGION.trasRacer);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  atlasCache = t;
  return t;
}

/** Centro del texel blanco del atlas en coordenadas UV. */
const UV_BLANCO = [16 / ATLAS, 1 - 16 / ATLAS];

/** Pasa un rectangulo en pixeles del atlas a [u0, v0, u1, v1] (v hacia arriba). */
export function uvDe(region) {
  return [region[0] / ATLAS, 1 - region[3] / ATLAS, region[2] / ATLAS, 1 - region[1] / ATLAS];
}

// --------------------------------------------------------------- constructor
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _col = new THREE.Color();
const _m3 = new THREE.Matrix3();

/**
 * Acumula piezas con sus atributos y produce una sola BufferGeometry.
 * Todo se guarda sin indexar: los bordes entre materiales tienen que ser
 * nitidos, y un vertice compartido mezclaria el vidrio con la pintura.
 */
export class Constructor {
  constructor() {
    this.pos = []; this.nor = []; this.uv = [];
    this.base = []; this.mat = []; this.capa = [];
  }

  /**
   * @param {THREE.BufferGeometry} geo
   * @param {Mat | ((cx:number,cy:number,cz:number,nx:number,ny:number,nz:number)=>Mat)} material
   *        un material fijo, o una funcion que lo elige por triangulo
   * @param {THREE.Matrix4} [matriz] transformacion a aplicar
   */
  agregar(geo, material, matriz = null) {
    if (DETALLE < 1) {
      geo.computeBoundingBox();
      _caja.copy(geo.boundingBox).getSize(_tam);
      if (Math.max(_tam.x, _tam.y, _tam.z) < 0.3) return this;
    }
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (matriz) g.applyMatrix4(matriz);

    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    const U = g.getAttribute('uv');
    const C = g.getAttribute('centro');
    const fija = typeof material !== 'function' ? material : null;

    for (let i = 0; i < P.count; i += 3) {
      let m = fija;
      if (!m) {
        _a.fromBufferAttribute(P, i); _b.fromBufferAttribute(P, i + 1); _c.fromBufferAttribute(P, i + 2);
        let cx = (_a.x + _b.x + _c.x) / 3, cy = (_a.y + _b.y + _c.y) / 3, cz = (_a.z + _b.z + _c.z) / 3;
        if (C) { cx = C.getX(i); cy = C.getY(i); cz = C.getZ(i); }
        // Normal geometrica del triangulo: la de los vertices viene suavizada y
        // en una arista no dice hacia donde mira la cara.
        _b.sub(_a); _c.sub(_a); _n.crossVectors(_b, _c).normalize();
        m = material(cx, cy, cz, _n.x, _n.y, _n.z);
        // Devolver null descarta el triangulo. Asi una misma malla se puede
        // repartir entre dos constructores (la carroceria opaca y el vidrio
        // transparente del coche del jugador van en geometrias distintas).
        if (!m) continue;
      }
      _col.setHex(m.c ?? 0xffffff, THREE.SRGBColorSpace);
      const uvr = m.uv;
      for (let k = 0; k < 3; k++) {
        _p.fromBufferAttribute(P, i + k);
        _n.fromBufferAttribute(N, i + k);
        this.pos.push(_p.x, _p.y, _p.z);
        this.nor.push(_n.x, _n.y, _n.z);
        if (uvr && U) {
          const u = U.getX(i + k), v = U.getY(i + k);
          this.uv.push(uvr[0] + (uvr[2] - uvr[0]) * u, uvr[1] + (uvr[3] - uvr[1]) * v);
        } else {
          this.uv.push(UV_BLANCO[0], UV_BLANCO[1]);
        }
        this.base.push(_col.r, _col.g, _col.b);
        this.mat.push(m.t ?? 0, m.r ?? 0.5, m.m ?? 0, m.l ?? 0);
        this.capa.push(m.k ?? 0);
      }
    }
    g.dispose();
    return this;
  }

  /** Atajo: caja con esquinas vivas. Posicion = centro. */
  caja(sx, sy, sz, x, y, z, material, rot = null) {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    return this.agregar(geo, material, matrizDe(x, y, z, rot));
  }

  /**
   * Caja con calca en las caras indicadas. Las demas usan `resto`.
   * @param {string|string[]} caras '+x' '-x' '+y' '-y' '+z' '-z'
   */
  cajaConCalca(sx, sy, sz, x, y, z, caras, calca, resto, rot = null) {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    // BoxGeometry agrupa las caras en orden +x,-x,+y,-y,+z,-z, dos triangulos
    // por cara tras quitar el indice.
    const orden = ['+x', '-x', '+y', '-y', '+z', '-z'];
    const conCalca = new Set([].concat(caras).map(c => orden.indexOf(c)));
    let tri = 0;
    return this.agregar(geo, () => (conCalca.has(Math.floor(tri++ / 2)) ? calca : resto),
      matrizDe(x, y, z, rot));
  }

  /** Cilindro a lo largo de X (ejes, tubos laterales). */
  cilindroX(radio, largo, x, y, z, material, segmentos = 12) {
    const geo = new THREE.CylinderGeometry(radio, radio, largo, segmentos);
    geo.rotateZ(Math.PI / 2);
    return this.agregar(geo, material, matrizDe(x, y, z));
  }

  /** Cilindro vertical (tubos de escape, mastiles). */
  cilindroY(radio, alto, x, y, z, material, segmentos = 12) {
    const geo = new THREE.CylinderGeometry(radio, radio, alto, segmentos);
    return this.agregar(geo, material, matrizDe(x, y, z));
  }

  /** Cilindro a lo largo de Z (barras de techo, depositos). */
  cilindroZ(radio, largo, x, y, z, material, segmentos = 12) {
    const geo = new THREE.CylinderGeometry(radio, radio, largo, segmentos);
    geo.rotateX(Math.PI / 2);
    return this.agregar(geo, material, matrizDe(x, y, z));
  }

  /**
   * Panel redondeado plano y extruido (faros, pilotos, parrillas, espejos).
   * Se construye en el plano XY mirando a +Z y luego se orienta con `rot`.
   */
  panel(ancho, alto, grosor, radio, x, y, z, material, rot = null) {
    const geo = new THREE.ExtrudeGeometry(rectRedondeado(ancho, alto, radio), {
      depth: grosor, bevelEnabled: DETALLE >= 1, bevelThickness: Math.min(0.012, grosor * 0.4),
      bevelSize: Math.min(0.012, radio * 0.5), bevelSegments: 1, curveSegments: DETALLE >= 1 ? 3 : 1,
    });
    geo.translate(0, 0, -grosor / 2);
    return this.agregar(geo, material, matrizDe(x, y, z, rot));
  }

  /** @returns {THREE.BufferGeometry} */
  construir() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aBase', new THREE.Float32BufferAttribute(this.base, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 4));
    g.setAttribute('aCapa', new THREE.Float32BufferAttribute(this.capa, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** Matriz de traslacion + rotacion euler opcional [rx, ry, rz]. */
export function matrizDe(x, y, z, rot = null) {
  const m = new THREE.Matrix4();
  // Orden YXZ: primero se inclina la pieza sobre su propio eje y luego se
  // gira en planta. Es el orden natural para pegar algo a una carroceria.
  if (rot) m.makeRotationFromEuler(new THREE.Euler(rot[0] ?? 0, rot[1] ?? 0, rot[2] ?? 0, 'YXZ'));
  m.setPosition(x, y, z);
  return m;
}

export function rectRedondeado(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// -------------------------------------------------------------------- loft
const suave = t => t * t * (3 - 2 * t);

/**
 * Interpola una tabla de estaciones [{z, ...valores}] en `z`. Interpolacion
 * suave (smoothstep) entre estaciones: con interpolacion lineal se ven
 * aristas en cada estacion al reflejar el cielo, que es justo lo que delata
 * a un modelo hecho a mano.
 */
export function interpolar(estaciones, z) {
  if (z <= estaciones[0].z) return { ...estaciones[0], z };
  const ult = estaciones[estaciones.length - 1];
  if (z >= ult.z) return { ...ult, z };
  for (let i = 0; i < estaciones.length - 1; i++) {
    const a = estaciones[i], b = estaciones[i + 1];
    if (z >= a.z && z <= b.z) {
      const t = suave((z - a.z) / (b.z - a.z));
      const r = { z };
      for (const k in a) if (k !== 'z') r[k] = a[k] + (b[k] - a[k]) * t;
      return r;
    }
  }
  return { ...ult, z };
}

/**
 * Seccion de carroceria: superelipse con exponentes distintos arriba y abajo.
 * n alto = mas cuadrada. Devuelve `puntos` pares (x, y) en sentido antihorario
 * empezando abajo en el centro.
 */
export function seccionSuperelipse(s, puntos) {
  const out = [];
  const yc = (s.yb + s.yt) / 2;
  const hy = (s.yt - s.yb) / 2;
  for (let i = 0; i < puntos; i++) {
    const t = -Math.PI / 2 + (i / puntos) * Math.PI * 2;
    const c = Math.cos(t), sn = Math.sin(t);
    const n = sn >= 0 ? s.na : s.nb;
    const x = s.w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const y = yc + hy * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n);
    out.push(x, y);
  }
  return out;
}

/**
 * Une secciones a lo largo de Z en una malla indexada, con tapas.
 * @param {number[][]} secciones arrays planos [x0,y0,x1,y1,...] con el mismo numero de puntos
 * @param {number[]} zs posicion de cada seccion
 * @param {{cerrado?:boolean, tapas?:boolean}} o
 */
export function loft(secciones, zs, { cerrado = true, tapas = true } = {}) {
  const n = secciones[0].length / 2;
  const pos = [];
  const idx = [];
  for (let s = 0; s < secciones.length; s++) {
    const sec = secciones[s];
    for (let i = 0; i < n; i++) pos.push(sec[i * 2], sec[i * 2 + 1], zs[s]);
  }
  const lados = cerrado ? n : n - 1;
  for (let s = 0; s < secciones.length - 1; s++) {
    for (let i = 0; i < lados; i++) {
      const a = s * n + i, b = s * n + ((i + 1) % n);
      const c = (s + 1) * n + i, d = (s + 1) * n + ((i + 1) % n);
      // Orden para que las normales salgan hacia fuera con puntos antihorarios.
      idx.push(a, b, c, b, d, c);
    }
  }
  const indexada = new THREE.BufferGeometry();
  indexada.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  indexada.setIndex(idx);
  indexada.computeVertexNormals();
  // Se desindexa aqui para poder anotar el CENTRO DEL CUADRO al que pertenece
  // cada triangulo. Clasificar por el centro del triangulo produce dientes de
  // sierra: las dos mitades de un cuadro caen a lados distintos de cualquier
  // umbral de altura. Con el centro del cuadro el borde sigue la arista.
  const cuerpo = indexada.toNonIndexed();
  indexada.dispose();
  {
    const P = cuerpo.getAttribute('position');
    const centro = new Float32Array(P.count * 3);
    for (let t = 0; t < P.count / 3; t += 2) {
      let x = 0, y = 0, z = 0;
      // Los dos triangulos del cuadro comparten 4 vertices distintos: a,b,c,d.
      for (let k = 0; k < 6; k++) { x += P.getX(t * 3 + k); y += P.getY(t * 3 + k); z += P.getZ(t * 3 + k); }
      for (let k = 0; k < 6; k++) {
        centro[(t * 3 + k) * 3] = x / 6;
        centro[(t * 3 + k) * 3 + 1] = y / 6;
        centro[(t * 3 + k) * 3 + 2] = z / 6;
      }
    }
    cuerpo.setAttribute('centro', new THREE.BufferAttribute(centro, 3));
  }

  if (!tapas || !cerrado) return [cuerpo];

  const tapa = (sec, z, haciaZ) => {
    const contorno = [];
    for (let i = 0; i < n; i++) contorno.push(new THREE.Vector2(sec[i * 2], sec[i * 2 + 1]));
    const tris = THREE.ShapeUtils.triangulateShape(contorno, []);
    const p = [], nn = [];
    for (const t of tris) {
      const orden = haciaZ > 0 ? t : [t[0], t[2], t[1]];
      for (const k of orden) { p.push(contorno[k].x, contorno[k].y, z); nn.push(0, 0, haciaZ); }
    }
    // triangulateShape devuelve el orden segun el sentido del contorno; se
    // corrige comprobando la normal del primer triangulo.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
    if (p.length >= 9) {
      _a.set(p[0], p[1], p[2]); _b.set(p[3], p[4], p[5]); _c.set(p[6], p[7], p[8]);
      _b.sub(_a); _c.sub(_a); _n.crossVectors(_b, _c);
      if (_n.z * haciaZ < 0) {
        for (let i = 0; i < p.length; i += 9) {
          for (let k = 0; k < 3; k++) { const tmp = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = tmp; }
        }
        g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      }
    }
    return g;
  };
  return [cuerpo, tapa(secciones[0], zs[0], -1), tapa(secciones[secciones.length - 1], zs[zs.length - 1], 1)];
}

/**
 * Carroceria baja (todo lo que hay por debajo de la linea de cintura).
 * @param {Array<{z:number,w:number,yb:number,yt:number,na:number,nb:number}>} estaciones
 * @param {number} pasos secciones a lo largo
 * @param {number} puntos puntos por seccion
 */
export function cuerpoLoft(estaciones, pasos = 34, puntos = 32, zsExtra = []) {
  pasos = Math.max(8, Math.round(pasos * DETALLE));
  puntos = Math.max(14, Math.round(puntos * Math.sqrt(DETALLE) / 2) * 2);
  const z0 = estaciones[0].z, z1 = estaciones[estaciones.length - 1].z;
  const lista = new Set();
  for (let i = 0; i <= pasos; i++) {
    // Mas secciones cerca de los extremos, donde la forma cambia deprisa.
    const u = i / pasos;
    const t = 0.5 - 0.5 * Math.cos(u * Math.PI);
    lista.add(+(z0 + (z1 - z0) * (u * 0.45 + t * 0.55)).toFixed(4));
  }
  // Secciones forzadas: bordes de ventanilla o de pilar que tienen que caer
  // en una arista para salir rectos.
  for (const z of zsExtra) if (z > z0 && z < z1) lista.add(+z.toFixed(4));
  const zs = [...lista].sort((a, b) => a - b);
  const secs = zs.map(z => seccionSuperelipse(interpolar(estaciones, z), puntos));
  return loft(secs, zs);
}

/**
 * Ancho de la carroceria en (z, y): resuelve la superelipse. Sirve para pegar
 * faros, espejos y pasos de rueda a la superficie en vez de a ojo.
 */
export function anchoEn(estaciones, z, y) {
  const s = interpolar(estaciones, z);
  const yc = (s.yb + s.yt) / 2, hy = (s.yt - s.yb) / 2;
  const v = Math.min(1, Math.abs((y - yc) / hy));
  const n = y >= yc ? s.na : s.nb;
  return s.w * Math.pow(Math.max(0, 1 - Math.pow(v, n)), 1 / n);
}

// ------------------------------------------------ piezas pegadas a la chapa
const _sN = new THREE.Vector3();
const _sM = new THREE.Matrix4();
const _sO = new THREE.Vector3(0, 0, 0);
const _sArriba = new THREE.Vector3(0, 1, 0);

/**
 * Z de la superficie de la carroceria en el morro (+1) o la cola (-1) para
 * un punto (x, y). Se busca desde el extremo hacia dentro hasta encontrar la
 * primera seccion que contiene el punto.
 */
export function zSuperficie(est, x, y, extremo) {
  const zFin = extremo > 0 ? est[est.length - 1].z : est[0].z;
  for (let d = 0; d < 1.5; d += 0.004) {
    const z = zFin - extremo * d;
    const s = interpolar(est, z);
    if (y < s.yb || y > s.yt) continue;
    if (anchoEn(est, z, y) >= Math.abs(x)) return z;
  }
  return zFin - extremo * 1.5;
}

/**
 * Panel pegado a la superficie del morro o la cola, orientado segun la
 * normal real en ese punto (faros, pilotos, intermitentes).
 */
export function marcoEnSuperficie(est, extremo, x, y, salida = new THREE.Matrix4()) {
  const z = zSuperficie(est, x, y, extremo);
  const h = 0.04;
  const dzdx = (zSuperficie(est, x + h, y, extremo) - zSuperficie(est, x - h, y, extremo)) / (2 * h);
  const dzdy = (zSuperficie(est, x, y + h, extremo) - zSuperficie(est, x, y - h, extremo)) / (2 * h);
  // Normal hacia fuera: en el morro (-dz/dx, -dz/dy, 1), en la cola el opuesto en z.
  _sN.set(-dzdx * extremo, -dzdy * extremo, extremo).normalize();
  // Se acota la inclinacion: en una esquina muy redonda la normal se va casi
  // de lado y la pieza quedaria de canto.
  _sN.y = Math.max(-0.5, Math.min(0.5, _sN.y));
  _sN.normalize();
  salida.lookAt(_sN, _sO, _sArriba);
  salida.setPosition(x, y, z);
  return salida;
}

export function panelEnSuperficie(c, est, extremo, x, y, ancho, alto, mat, grosor = 0.05) {
  marcoEnSuperficie(est, extremo, x, y, _sM);
  const fino = DETALLE >= 1;
  const geo = new THREE.ExtrudeGeometry(rectRedondeado(ancho, alto, Math.min(ancho, alto) * 0.35), {
    depth: grosor, bevelEnabled: fino, bevelThickness: 0.008, bevelSize: 0.008,
    bevelSegments: 1, curveSegments: fino ? 3 : 1,
  });
  geo.translate(0, 0, -grosor / 2);
  c.agregar(geo, mat, _sM);
}

/**
 * Pase de rueda: arco extruido alrededor de la parte de arriba del neumatico.
 * Es lo que hace que una rueda parezca metida en la carroceria y no pegada.
 */
export function pasoDeRueda(c, x, z, rRueda, mat, { holgura = 0.02, ancho = 0.07, fondo = 0.07 } = {}) {
  const ri = rRueda + holgura, re = ri + ancho;
  const s = new THREE.Shape();
  const a0 = -0.22, a1 = Math.PI + 0.22;
  const N = DETALLE >= 1 ? 12 : 6;
  for (let i = 0; i <= N; i++) {
    const a = a0 + (a1 - a0) * (i / N);
    const px = Math.cos(a) * re, py = Math.sin(a) * re;
    if (i === 0) s.moveTo(px, py); else s.lineTo(px, py);
  }
  for (let i = N; i >= 0; i--) {
    const a = a0 + (a1 - a0) * (i / N);
    s.lineTo(Math.cos(a) * ri, Math.sin(a) * ri);
  }
  const geo = new THREE.ExtrudeGeometry(s, { depth: fondo, bevelEnabled: false, curveSegments: 4 });
  geo.translate(0, 0, -fondo / 2);
  geo.rotateY(Math.PI / 2);   // el arco pasa al plano YZ, extruido en X
  c.agregar(geo, mat, matrizDe(x, rRueda, z));
}

/**
 * Habitaculo: trapecio con techo redondeado a lo largo de Z, abierto por
 * abajo (se apoya en la carroceria). Los puntos del perfil se colocan en las
 * alturas exactas de la ventanilla para que el borde vidrio/pintura caiga en
 * una arista de la malla y salga nitido.
 *
 * @param {Array<{z:number, yc:number, yr:number, wb:number, wr:number}>} est
 *   yc cintura, yr techo, wb medio ancho en cintura, wr en techo
 * @param {object} ventana {yInf, margenTecho, xPilar}
 */
export function habitaculoLoft(est, pasos, ventana) {
  pasos = Math.max(6, Math.round(pasos * DETALLE));
  const secs = [], zs = [];
  const z0 = est[0].z, z1 = est[est.length - 1].z;
  // Se fuerza una seccion en cada estacion: ahi caen los pilares.
  const zsSet = new Set();
  for (let i = 0; i <= pasos; i++) zsSet.add(+(z0 + (z1 - z0) * (i / pasos)).toFixed(4));
  for (const e of est) zsSet.add(+e.z.toFixed(4));
  for (const z of ventana.zsExtra ?? []) zsSet.add(+z.toFixed(4));
  const lista = [...zsSet].sort((a, b) => a - b);

  for (const z of lista) {
    const e = interpolar(est, z);
    const alto = Math.max(0.001, e.yr - e.yc);
    const yv = e.yc + Math.min(ventana.yInf, alto * 0.25);
    const yTop = e.yr - Math.min(ventana.margenTecho, alto * 0.3);
    const lerpW = y => e.wb + (e.wr - e.wb) * ((y - e.yc) / alto);
    const pts = [];
    // lado izquierdo (+X) subiendo, techo, lado derecho bajando
    const lado = (sgn) => {
      const p = [
        [lerpW(e.yc), e.yc], [lerpW(yv), yv], [lerpW(yTop), yTop],
      ];
      return sgn > 0 ? p.map(([x, y]) => [x, y]) : p.map(([x, y]) => [-x, y]).reverse();
    };
    const izq = lado(1);
    // techo: arco de superelipse entre los dos lados
    const techo = [];
    const N = DETALLE >= 1 ? 8 : 4;
    for (let i = 1; i < N; i++) {
      const t = i / N;               // 0 = lado izq, 1 = lado der
      const x = e.wr * Math.cos(t * Math.PI) * 0.999;
      const curv = Math.pow(Math.sin(t * Math.PI), 0.35);
      const y = yTop + (e.yr - yTop) * curv;
      // El pilar del parabrisas cae en |x| = wr - xPilar: se inserta exacto.
      techo.push([x * (1 - 0.06 * (1 - curv)), y]);
    }
    const der = lado(-1);
    for (const [x, y] of izq) pts.push(x, y);
    for (const [x, y] of techo) pts.push(x, y);
    for (const [x, y] of der) pts.push(x, y);
    secs.push(pts);
    zs.push(z);
  }
  return loft(secs, zs, { cerrado: false, tapas: false })[0];
}

// --------------------------------------------------------------- ruedas
/**
 * Rueda de turismo: neumatico de revolucion con flanco redondeado y rin de
 * aleacion de cinco radios. Mira hacia +X (la cara del rin hacia fuera de un
 * lado izquierdo); el lado derecho se gira 180 grados al instanciarla.
 * Radio y ancho 1: se escala por instancia.
 */
export function geometriaRueda({ radios = 5, rin = M.rin, camion = false } = {}) {
  const c = new Constructor();
  // Perfil del neumatico en (r, x) girado sobre el eje X.
  const perfil = [];
  const ri = camion ? 0.62 : 0.66, re = 1.0, w = 0.5;
  const N = 7;
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI / 2 + (i / N) * Math.PI;
    const r = ri + (re - ri) * (0.55 + 0.45 * Math.cos(a));
    perfil.push(new THREE.Vector2(r, w * 0.95 * Math.sin(a)));
  }
  const tire = new THREE.LatheGeometry(perfil, 18);
  // Lathe gira alrededor de Y: el perfil (r, y) -> se rota para que el eje sea X.
  tire.rotateZ(Math.PI / 2);
  c.agregar(tire, M.caucho);

  // Cara del rin: disco con un cubo central, rebajado respecto al flanco.
  const caraX = w * 0.28;
  const disco = new THREE.CylinderGeometry(ri, ri, 0.06, 18);
  disco.rotateZ(Math.PI / 2);
  c.agregar(disco, camion ? M.acero : M.rinOscuro, matrizDe(caraX - 0.12, 0, 0));
  const cubo = new THREE.CylinderGeometry(ri * 0.26, ri * 0.3, 0.12, 10);
  cubo.rotateZ(Math.PI / 2);
  c.agregar(cubo, camion ? M.acero : rin, matrizDe(caraX, 0, 0));
  if (camion) {
    // Rin de acero con tuercas: anillo exterior y ocho tuercas cromadas.
    const anillo = new THREE.TorusGeometry(ri * 0.82, 0.05, 4, 18);
    anillo.rotateY(Math.PI / 2);
    c.agregar(anillo, M.acero, matrizDe(caraX - 0.02, 0, 0));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      c.cilindroX(0.035, 0.08, caraX + 0.02, Math.cos(a) * ri * 0.42, Math.sin(a) * ri * 0.42, M.cromo, 6);
    }
  } else {
    for (let i = 0; i < radios; i++) {
      const a = (i / radios) * Math.PI * 2;
      const largo = ri * 0.74;
      for (const d of [-0.075, 0.075]) {
        const radio = new THREE.BoxGeometry(0.07, largo, 0.075);
        radio.translate(0, ri * 0.25 + largo / 2, d * (0.4 + 0.6 * 0.5));
        radio.rotateX(a);
        c.agregar(radio, rin, matrizDe(caraX - 0.01, 0, 0));
      }
    }
    const aro = new THREE.TorusGeometry(ri * 0.97, 0.035, 4, 18);
    aro.rotateY(Math.PI / 2);
    c.agregar(aro, rin, matrizDe(caraX - 0.02, 0, 0));
  }
  return c.construir();
}

// ------------------------------------------------------------ el material
/**
 * Material unico de la flota.
 * @param {{fisico?:boolean}} o fisico=false en calidad baja: sin laca, que en
 *        movil es la parte cara del shader.
 */
export function materialFlota({ fisico = true } = {}) {
  const Base = fisico ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const mat = new Base({
    color: 0xffffff, roughness: 0.5, metalness: 0.0,
    map: atlasCalcas(),
    ...(fisico ? { clearcoat: 1.0, clearcoatRoughness: 0.07 } : {}),
  });
  mat.userData.uniformes = {
    uFaros: { value: 0.55 },
    uTiempo: { value: 0 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, mat.userData.uniformes);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aBase;
        attribute vec4 aMat;
        attribute float aCapa;
        attribute vec3 aTinte1;
        attribute vec3 aTinte2;
        attribute vec3 aEstado;
        varying vec3 vBase;
        varying vec4 vMat;
        varying float vCapa;
        varying vec3 vTinte1;
        varying vec3 vTinte2;
        varying vec3 vEstado;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vBase = aBase; vMat = aMat; vCapa = aCapa;
        vTinte1 = aTinte1; vTinte2 = aTinte2; vEstado = aEstado;`);

    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uFaros;
        varying vec3 vBase;
        varying vec4 vMat;
        varying float vCapa;
        varying vec3 vTinte1;
        varying vec3 vTinte2;
        varying vec3 vEstado;
        float esCodigo(float v, float k) { return 1.0 - step(0.5, abs(v - k)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 colorPieza = vBase;
        colorPieza = mix(colorPieza, vTinte1, esCodigo(vMat.x, 1.0));
        colorPieza = mix(colorPieza, vTinte2, esCodigo(vMat.x, 2.0));
        diffuseColor.rgb *= colorPieza;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = vMat.y;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = vMat.z;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float luz = vMat.w;
        totalEmissiveRadiance += vec3(1.0, 0.96, 0.88) * uFaros * esCodigo(luz, 1.0);
        totalEmissiveRadiance += vec3(1.0, 0.012, 0.004) * (0.30 + 1.25 * vEstado.x) * esCodigo(luz, 2.0);
        totalEmissiveRadiance += vec3(1.0, 0.36, 0.0) * 1.5 * vEstado.y * esCodigo(luz, 3.0);
        totalEmissiveRadiance += vec3(1.0, 0.36, 0.0) * 1.5 * vEstado.z * esCodigo(luz, 4.0);
        totalEmissiveRadiance += diffuseColor.rgb * 1.5 * esCodigo(luz, 5.0);
        // Barra de luces de persecucion: roja con vEstado.y, azul con vEstado.z.
        totalEmissiveRadiance += vec3(1.0, 0.03, 0.03) * (0.12 + 2.6 * vEstado.y) * esCodigo(luz, 6.0);
        totalEmissiveRadiance += vec3(0.08, 0.28, 1.0) * (0.12 + 3.0 * vEstado.z) * esCodigo(luz, 7.0);`);
    if (fisico) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat *= vCapa;
        #endif`);
    }
  };
  // Sin esto three reutiliza el programa de otro material con el mismo
  // shader de base y los atributos propios no existirian.
  mat.customProgramCacheKey = () => 'flota-' + (fisico ? 'f' : 's');
  return mat;
}

/**
 * Atributos por instancia que el material necesita.
 * @param {THREE.InstancedMesh} malla
 */
export function prepararInstancias(malla) {
  const n = malla.count;
  const g = malla.geometry;
  const mk = (nombre, relleno) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(relleno), 3);
    a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(nombre, a);
    return a;
  };
  return {
    tinte1: mk('aTinte1', 0.8),
    tinte2: mk('aTinte2', 0.9),
    estado: mk('aEstado', 0),
  };
}

/** Normal transformada sin asignar (para quien tenga que reorientar piezas). */
export function rotarNormal(n, m4) {
  _m3.getNormalMatrix(m4);
  return n.applyMatrix3(_m3).normalize();
}
