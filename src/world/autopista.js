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
export const anchoTotal = () => anchoCalzada() + VIA.anchoArcen * 2;

/**
 * Centro del carril `i` en X. El carril 0 es el de mas a la izquierda mirando
 * hacia +Z, que es la direccion de marcha.
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
function texturaFirme() {
  const W = 1024, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  const total = anchoTotal();
  const aPx = m => (m / total) * W;          // metros -> pixeles a lo ancho

  g.fillStyle = '#2b2d31';
  g.fillRect(0, 0, W, H);

  // Grano del asfalto: sin esto la calzada es un plano plano y a 200 km/h no
  // se percibe velocidad ninguna porque no hay nada que se mueva en la textura.
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);

  // Arcenes, un punto mas oscuros que la calzada.
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillRect(0, 0, aPx(VIA.anchoArcen), H);
  g.fillRect(W - aPx(VIA.anchoArcen), 0, aPx(VIA.anchoArcen), H);

  const xCalzada = aPx(VIA.anchoArcen);
  const anchoCarrilPx = aPx(VIA.anchoCarril);

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
  t.anisotropy = 16;
  return t;
}

export class Autopista {
  /**
   * @param {THREE.Scene} scene
   * @param {object} RAPIER
   * @param {object} world
   * @param {THREE.WebGLRenderer} [renderer] para ajustar la anisotropia real
   */
  constructor(scene, RAPIER, world, renderer = null) {
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
    const tex = texturaFirme();
    if (renderer) tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.repeat.set(1, L / TRAMO);
    const matFirme = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.92, metalness: 0.0,
    });
    const geoFirme = new THREE.PlaneGeometry(total, L);
    geoFirme.rotateX(-Math.PI / 2);

    const matMuro = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.7, metalness: 0.15 });
    const geoMuro = new THREE.BoxGeometry(0.8, VIA.alturaQuitamiedos * 2, L);

    this.segmentos = [];
    for (let i = 0; i < VIA.segmentos; i++) {
      const s = new THREE.Group();
      const firme = new THREE.Mesh(geoFirme, matFirme);
      firme.receiveShadow = true;
      s.add(firme);
      for (const lado of [-1, 1]) {
        const m = new THREE.Mesh(geoMuro, matMuro);
        m.position.set(lado * xMuro, VIA.alturaQuitamiedos, 0);
        m.castShadow = true; m.receiveShadow = true;
        s.add(m);
      }
      s.position.z = i * L;
      this.grupo.add(s);
      this.segmentos.push(s);
    }

    // Postes de referencia: el ojo necesita algo cercano que pase rapido para
    // leer velocidad. El asfalto solo no basta.
    const geoPoste = new THREE.BoxGeometry(0.16, 1.15, 0.16);
    const matPoste = new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.8 });
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
      for (const lado of [-1, 1]) {
        this._pos.set(lado * (xMuro + 0.9), 0.58, zp);
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
