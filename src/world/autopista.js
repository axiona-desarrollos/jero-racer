/* ==========================================================================
   HIGHWAY RACER · Autopista infinita
   --------------------------------------------------------------------------
   Una calzada recta de varios carriles que no se acaba nunca. El coche avanza
   por +Z y la pista se recicla por delante.

   POR QUE LA COLISION NO SE RECICLA Y EL DIBUJO SI
   Son dos problemas distintos y se resuelven distinto. La FISICA usa tres
   colisionadores estaticos gigantes (suelo y dos quitamiedos) que cubren toda
   la tirada: crearlos una vez sale gratis, y mover colisionadores cada frame
   es justo lo que provoca que un vehiculo de raycast se enganche en las
   costuras. El DIBUJO si se recicla, porque ahi el coste es real: una cinta de
   200 km en una sola malla obligaria a coordenadas de textura de seis cifras y
   la precision en coma flotante convertiria las lineas del carril en zigzag.

   PRECISION EN COMA FLOTANTE
   Rapier trabaja en f32. A 100 km del origen quedan ~8 mm de resolucion, que
   para conducir sobra; a 500 km ya son ~4 cm y empieza a notarse. LARGO_MUNDO
   esta puesto muy por encima de cualquier partida razonable, y la distancia se
   lleva aparte en f64 (un number de JS) para que el marcador nunca mienta.
   ========================================================================== */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Geometria de la calzada. Todo lo demas se deriva de aqui. */
export const VIA = Object.freeze({
  carriles: 6,
  anchoCarril: 3.6,
  anchoArcen: 2.8,
  largoSegmento: 200,
  segmentos: 14,          // 2,8 km de asfalto dibujado por delante y por detras
  alturaQuitamiedos: 0.75,
  largoMundo: 400000,     // 400 km de colisionador; ver nota de precision arriba
});

export const anchoCalzada = () => VIA.carriles * VIA.anchoCarril;
const APARCAR = 100000;
export const anchoTotal = () => anchoCalzada() + VIA.anchoArcen * 2;

/**
 * Centro del carril `i` en X. El carril 0 es el de mas a la DERECHA del
 * conductor: mirando hacia +Z (la direccion de marcha) la izquierda es +X, y
 * el carril 0 esta en la X mas negativa. El carril rapido es el de indice alto.
 */
export function carrilX(i) {
  const w = anchoCalzada();
  return -w / 2 + VIA.anchoCarril * (i + 0.5);
}

/**
 * Textura del firme, generada en un canvas.
 *
 * Se dibuja la SECCION COMPLETA de la via — asfalto, arcenes, lineas continuas
 * del borde y discontinuas entre carriles — en una sola imagen que se repite a
 * lo largo. Asi toda la calzada es UN material y UNA llamada de dibujo por
 * segmento, en vez de una malla por cada raya pintada.
 *
 * La altura de la textura representa TRAMO metros reales, y de ahi sale el
 * repeat: si no cuadran, las rayas discontinuas salen de longitudes distintas
 * en cada segmento y se ve el truco.
 */
const TRAMO = 12;          // metros de via que representa la textura a lo alto
const RAYA = 3;            // metros de raya pintada

/**
 * Ruido de valor con interpolacion suave.
 *
 * NO es un capricho frente a Math.random() por pixel. Un ruido blanco puro
 * tiene detalle a la frecuencia mas alta posible, que es justo la que el
 * muestreo no puede reproducir: de cerca se ve como grano de television — eso
 * es lo que se lee como "pixelado" — y de lejos los mipmaps lo promedian a un
 * gris plano, asi que ni siquiera aporta a distancia. Un ruido con correlacion
 * espacial da piedra de arido de verdad y sobrevive al filtrado.
 */
function ruidoValor(x, y, escala) {
  const xi = Math.floor(x / escala), yi = Math.floor(y / escala);
  const tx = (x / escala) - xi, ty = (y / escala) - yi;
  const hash = (a, b) => {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const suave = t => t * t * (3 - 2 * t);
  const sx = suave(tx), sy = suave(ty);
  const a = hash(xi, yi), b = hash(xi + 1, yi);
  const c2 = hash(xi, yi + 1), d2 = hash(xi + 1, yi + 1);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c2 * (1 - sx) + d2 * sx) * sy;
}

function texturaFirme(W = 2048) {
  // 2048x1024 sobre 27,2 x 12 m son ~13 mm por texel a lo ancho y ~12 a lo
  // largo. Con los 1024x256 de antes eran 27 y 47 mm: de dos a cinco
  // centimetros por texel en la superficie que el jugador mira todo el rato.
  // En movil se genera a la mitad: el bucle de ruido por pixel tardaba casi
  // un segundo en un Android de gama media.
  const H = W / 2;
  const k = W / 2048;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  const total = anchoTotal();
  const aPx = m => (m / total) * W;          // metros -> pixeles a lo ancho

  g.fillStyle = '#3d3d3b';
  g.fillRect(0, 0, W, H);

  // Arido a dos escalas: la gruesa da las manchas de desgaste del firme, la
  // fina la piedra. Las dos con correlacion espacial, no ruido blanco.
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const grueso = (ruidoValor(x, y, 46 * k) - 0.5) * 15;
      const fino = (ruidoValor(x, y, Math.max(1.3, 2.6 * k)) - 0.5) * 26;
      const n = grueso + fino;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
  }
  g.putImageData(img, 0, 0);

  // Rodadas: dos franjas mas oscuras y pulidas por carril, donde pasan las
  // ruedas. Es lo que hace que una calzada parezca usada y no recien pintada.
  const xCal = aPx(VIA.anchoArcen);
  const wCarril = aPx(VIA.anchoCarril);
  g.fillStyle = 'rgba(0,0,0,0.13)';
  for (let i = 0; i < VIA.carriles; i++) {
    const centro = xCal + wCarril * (i + 0.5);
    for (const s of [-1, 1]) {
      g.fillRect(centro + s * aPx(0.82) - aPx(0.24), 0, aPx(0.48), H);
    }
  }

  // Arcenes, un punto mas oscuros que la calzada.
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillRect(0, 0, aPx(VIA.anchoArcen), H);
  g.fillRect(W - aPx(VIA.anchoArcen), 0, aPx(VIA.anchoArcen), H);

  const xCalzada = xCal;
  const anchoCarrilPx = wCarril;

  // Lineas continuas del borde de calzada.
  g.fillStyle = '#e9e6dd';
  const grosor = Math.max(2, aPx(0.15));
  g.fillRect(xCalzada - grosor / 2, 0, grosor, H);
  g.fillRect(xCalzada + anchoCarrilPx * VIA.carriles - grosor / 2, 0, grosor, H);

  // Discontinuas entre carriles.
  const altoRaya = (RAYA / TRAMO) * H;
  for (let i = 1; i < VIA.carriles; i++) {
    const x = xCalzada + anchoCarrilPx * i - grosor / 2;
    g.fillRect(x, 0, grosor, altoRaya);
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Pinta toda una geometria de un color (para fundir piezas en una malla). */
function pintada(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g;
}

/**
 * Todo lo que acompana a un tramo de via, fundido en UNA geometria: defensa
 * metalica con postes a la derecha, barrera New Jersey de concreto en el
 * separador de la izquierda y postes de alumbrado. Una llamada de dibujo por
 * tramo en vez de cientos de piezas sueltas.
 */
function geometriaVestido(L) {
  const partes = [];
  const borde = anchoTotal() / 2;

  // Barrera New Jersey (izquierda, +X): perfil de concreto extruido.
  const nj = new THREE.Shape();
  const p = [[0.30, 0], [0.28, 0.08], [0.16, 0.33], [0.10, 0.82], [-0.10, 0.82], [-0.16, 0.33], [-0.28, 0.08], [-0.30, 0]];
  nj.moveTo(p[0][0], p[0][1]);
  for (const [x, y] of p.slice(1)) nj.lineTo(x, y);
  const geoNJ = new THREE.ExtrudeGeometry(nj, { depth: L, bevelEnabled: false });
  geoNJ.translate(borde + 0.4, 0, -L / 2);
  partes.push(pintada(geoNJ, 0xb3b0a7));

  // Defensa metalica (derecha, −X): banda de doble onda sobre postes.
  const xDef = -(borde + 0.35);
  for (const [y, dx, h] of [[0.62, 0, 0.13], [0.78, 0, 0.13], [0.70, 0.03, 0.05]]) {
    const b = new THREE.BoxGeometry(0.05, h, L);
    b.translate(xDef + dx, y, 0);
    partes.push(pintada(b, 0xaab1b8));
  }
  for (let z = -L / 2 + 1; z < L / 2; z += 2) {
    const poste = new THREE.BoxGeometry(0.09, 0.78, 0.14);
    poste.translate(xDef - 0.12, 0.39, z);
    partes.push(pintada(poste, 0x7f868d));
  }

  // Alumbrado en el separador cada 50 m: poste, brazo y luminaria.
  for (let z = -L / 2 + 25; z < L / 2; z += 50) {
    const xp = borde + 1.8;
    const poste = new THREE.CylinderGeometry(0.08, 0.13, 10, 8);
    poste.translate(xp, 5, z);
    partes.push(pintada(poste, 0x8b929a));
    const brazo = new THREE.BoxGeometry(2.6, 0.08, 0.08);
    brazo.translate(xp - 1.25, 9.85, z);
    partes.push(pintada(brazo, 0x8b929a));
    const lum = new THREE.BoxGeometry(0.7, 0.14, 0.28);
    lum.translate(xp - 2.55, 9.78, z);
    partes.push(pintada(lum, 0x5c6168));
  }
  return mergeGeometries(partes);
}

export class Autopista {
  /**
   * @param {THREE.Scene} scene
   * @param {object} RAPIER
   * @param {object} world
   * @param {THREE.WebGLRenderer} [renderer] para ajustar la anisotropia real
   */
  constructor(scene, RAPIER, world, renderer = null, { firme = 2048 } = {}) {
    this.scene = scene;
    this.grupo = new THREE.Group();
    this.grupo.name = 'autopista';
    scene.add(this.grupo);

    const total = anchoTotal();
    const L = VIA.largoSegmento;

    // --- colision: tres piezas para toda la partida, creadas una sola vez ---
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(total / 2 + 40, 0.5, VIA.largoMundo / 2)
        .setTranslation(0, -0.5, 0)
        .setFriction(1.0));

    const xMuro = total / 2 + 0.4;
    for (const s of [-1, 1]) {
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.4, VIA.alturaQuitamiedos, VIA.largoMundo / 2)
          .setTranslation(s * xMuro, VIA.alturaQuitamiedos, 0)
          .setFriction(0.4)
          .setRestitution(0.1));
    }

    // --- dibujo: cinta reciclable -------------------------------------------
    const tex = texturaFirme(firme);
    tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 16;
    tex.repeat.set(1, L / TRAMO);
    const matFirme = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.88, metalness: 0.0,
    });
    const geoFirme = new THREE.PlaneGeometry(total, L);
    geoFirme.rotateX(-Math.PI / 2);

    const matVestido = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.25 });
    const geoVestido = geometriaVestido(L);

    this.segmentos = [];
    for (let i = 0; i < VIA.segmentos; i++) {
      const s = new THREE.Group();
      const firme = new THREE.Mesh(geoFirme, matFirme);
      firme.receiveShadow = true;
      s.add(firme);
      const vestido = new THREE.Mesh(geoVestido, matVestido);
      vestido.castShadow = true; vestido.receiveShadow = true;
      s.add(vestido);
      s.position.z = i * L;
      this.grupo.add(s);
      this.segmentos.push(s);
    }

    // Postes de referencia: el ojo necesita algo cercano que pase rapido para
    // leer velocidad. El asfalto solo no basta.
    const geoPoste = new THREE.BoxGeometry(0.12, 1.0, 0.12);
    const matPoste = new THREE.MeshStandardMaterial({ color: 0xe8ebee, roughness: 0.6 });
    const separacion = 25;
    this.postesPorLado = Math.ceil((VIA.segmentos * L) / separacion);
    this.postes = new THREE.InstancedMesh(geoPoste, matPoste, this.postesPorLado * 2);
    this.postes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.postes.castShadow = true;
    this.grupo.add(this.postes);
    this._separacionPostes = separacion;
    this._mat4 = new THREE.Matrix4();
    this._pos = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._esc = new THREE.Vector3(1, 1, 1);

    this.largoTotal = VIA.segmentos * L;
    this.actualizar(0);
  }

  /**
   * Recicla la cinta alrededor del coche.
   *
   * Se mantiene un tercio del asfalto POR DETRAS: si se recicla justo al pasar,
   * el retrovisor y las camaras que miran hacia atras se quedan mirando el
   * vacio, y con la camara cine —que va por detras— se veria el borde.
   * @param {number} z posicion del coche a lo largo de la via
   */
  actualizar(z) {
    const L = VIA.largoSegmento;
    const base = Math.floor(z / L) - Math.floor(VIA.segmentos / 3);
    for (let i = 0; i < this.segmentos.length; i++) {
      this.segmentos[i].position.z = (base + i) * L;
    }

    const sep = this._separacionPostes;
    const zIni = base * L;
    const xMuro = anchoTotal() / 2 + 0.4;
    let n = 0;
    for (let i = 0; i < this.postesPorLado; i++) {
      const zp = Math.ceil(zIni / sep) * sep + i * sep;
      // Se dejan en la derecha, tras la defensa: el separador ya tiene la
      // barrera y los postes de luz como referencia.
      for (const lado of [-1, 1]) {
        if (lado > 0) { this._pos.set(APARCAR, -50, 0); } else { this._pos.set(lado * (xMuro + 0.9), 0.5, zp); }
        this._mat4.compose(this._pos, this._q, this._esc);
        this.postes.setMatrixAt(n++, this._mat4);
      }
    }
    this.postes.instanceMatrix.needsUpdate = true;
  }

  /** Punto de aparicion: carril central, mirando hacia +Z. */
  puntoDeSalida() {
    const centro = Math.floor(VIA.carriles / 2);
    return new THREE.Vector3(carrilX(centro), 0.40, 0);
  }
}
