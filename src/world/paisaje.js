/* ==========================================================================
   JERO RACER · Paisaje
   --------------------------------------------------------------------------
   Todo lo que hay fuera del asfalto: el terreno, las montanas del Valle de
   Aburra, los arboles, los porticos de senalizacion y los puentes.

   Antes la autopista corria sobre el vacio: a los lados del quitamiedos no
   habia nada y el horizonte era una linea recta contra el cielo. Ademas de
   feo eso mata la sensacion de velocidad, que el ojo lee en lo que pasa por
   los lados y no en el asfalto.

   TODO SE RECICLA, NADA SE CREA EN MARCHA
   La via es infinita y el paisaje tambien, asi que cada pieza vive en una
   ventana alrededor del jugador y se recoloca al avanzar:
     - terreno y montanas se desplazan en multiplos EXACTOS de su periodo,
       para que el salto sea invisible (el dibujo es periodico);
     - arboles por tramos de 400 m generados con una semilla por tramo: el
       mismo tramo sale siempre igual, y volver atras no lo cambia;
     - porticos y puentes: unas pocas copias que saltan hacia delante.
   ========================================================================== */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { anchoTotal } from './autopista.js';

const TRAMO_ARBOLES = 400;

/** Hash entero -> [0,1). Deterministico: el mismo tramo, los mismos arboles. */
function hash(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ------------------------------------------------------------------ texturas
function texturaPasto(tam = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = tam;
  const g = c.getContext('2d');
  g.fillStyle = '#4c6e2e';
  g.fillRect(0, 0, tam, tam);
  // Manchas grandes de tono (pasto seco, pasto tierno) y brizna fina.
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * tam, y = Math.random() * tam, r = 10 + Math.random() * 60;
    const tonos = ['rgba(92,120,52,0.25)', 'rgba(58,88,34,0.28)', 'rgba(120,128,70,0.18)', 'rgba(40,70,30,0.22)'];
    g.fillStyle = tonos[i % tonos.length];
    for (const dx of [-tam, 0, tam]) for (const dy of [-tam, 0, tam]) {
      g.beginPath(); g.arc(x + dx, y + dy, r, 0, Math.PI * 2); g.fill();
    }
  }
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * tam, y = Math.random() * tam;
    const l = 40 + Math.random() * 60;
    g.fillStyle = `hsla(${78 + Math.random() * 30}, 45%, ${l * 0.5}%, 0.35)`;
    g.fillRect(x, y, 1.2, 2.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Atlas de arboles: tres siluetas dibujadas en un canvas (frondoso, alto y
 * ciprés). Se usan en cruces de dos planos: a la distancia a la que se ven
 * desde la via dan mucho mas aspecto de arbol que una esfera facetada.
 */
function atlasArboles() {
  const W = 768, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);

  const copa = (cx, cy, rx, ry, n, tonos) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.pow(Math.random(), 0.6);
      const x = cx + Math.cos(a) * rx * d;
      const y = cy + Math.sin(a) * ry * d;
      const r = 7 + Math.random() * 13;
      // Luz desde arriba a la izquierda: abajo y a la derecha, mas oscuro.
      const luz = 0.55 + 0.45 * (1 - ((y - (cy - ry)) / (2 * ry))) - 0.15 * ((x - cx) / rx);
      const t = tonos[Math.floor(Math.random() * tonos.length)];
      g.fillStyle = `rgb(${Math.round(t[0] * luz)},${Math.round(t[1] * luz)},${Math.round(t[2] * luz)})`;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  };
  const tronco = (cx, y0, y1, w) => {
    g.fillStyle = '#4a3626';
    g.beginPath();
    g.moveTo(cx - w, y1); g.lineTo(cx - w * 0.45, y0); g.lineTo(cx + w * 0.45, y0); g.lineTo(cx + w, y1);
    g.closePath(); g.fill();
  };
  const verdes = [[70, 112, 44], [58, 98, 38], [86, 124, 52], [48, 86, 34]];

  // 1. Frondoso (tipo guayacan / samán): copa ancha.
  tronco(128, 150, 256, 11);
  copa(128, 112, 100, 72, 520, verdes);
  // 2. Alto y ralo (tipo eucalipto).
  tronco(384, 90, 256, 8);
  copa(384, 90, 58, 82, 380, [[84, 116, 70], [70, 102, 60], [96, 128, 78]]);
  // 3. Ciprés: conico y oscuro.
  tronco(640, 210, 256, 7);
  for (let i = 0; i < 520; i++) {
    const t = Math.random();
    const y = 18 + t * 200;
    const ancho = 8 + t * 58;
    const x = 640 + (Math.random() - 0.5) * 2 * ancho;
    const luz = 0.6 + 0.4 * (1 - t) - 0.12 * ((x - 640) / 60);
    g.fillStyle = `rgb(${Math.round(40 * luz)},${Math.round(78 * luz)},${Math.round(40 * luz)})`;
    g.beginPath(); g.arc(x, y, 5 + Math.random() * 7, 0, Math.PI * 2); g.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Letrero verde de autopista con hasta tres lineas. */
function texturaLetrero(lineas, { ancho = 1024, alto = 384, fondo = '#0b6b3a', flecha = null } = {}) {
  const c = document.createElement('canvas');
  c.width = ancho; c.height = alto;
  const g = c.getContext('2d');
  g.fillStyle = fondo;
  g.fillRect(0, 0, ancho, alto);
  g.strokeStyle = '#f1f1ea'; g.lineWidth = 12;
  g.strokeRect(14, 14, ancho - 28, alto - 28);
  g.fillStyle = '#f4f4ee';
  g.textBaseline = 'middle';
  const n = lineas.length;
  lineas.forEach((l, i) => {
    const y = alto * ((i + 0.5) / n) + (n === 1 ? 0 : (i - (n - 1) / 2) * -6);
    g.font = `bold ${Math.round(alto / (n + 0.9))}px "Arial Narrow", Arial, sans-serif`;
    g.textAlign = 'left';
    g.fillText(l[0], 54, y);
    if (l[1]) { g.textAlign = 'right'; g.fillText(l[1], ancho - 54, y); }
  });
  if (flecha) {
    g.save();
    g.translate(ancho - 110, alto / 2);
    g.rotate(flecha);
    g.fillStyle = '#f4f4ee';
    g.beginPath();
    g.moveTo(0, -70); g.lineTo(46, -14); g.lineTo(16, -14); g.lineTo(16, 70);
    g.lineTo(-16, 70); g.lineTo(-16, -14); g.lineTo(-46, -14); g.closePath(); g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------- montanas
/**
 * Cordillera: una pared de terreno a un lado de la via con un perfil de
 * crestas periodico. Periodo P: si se desplaza P metros se ve identica.
 */
function cordillera({ lado, distancia, profundidad, alturaMin, alturaMax, P, largo, semilla, colorBase, colorCima }) {
  const segZ = Math.round(largo / 25), filas = 7;
  const pos = [], col = [], idx = [];
  const armonicos = [1, 2, 3, 5, 8, 13].map((k, i) => ({
    k, amp: 1 / Math.pow(k, 0.85), fase: hash(semilla, i) * Math.PI * 2,
  }));
  const norm = armonicos.reduce((a, h) => a + h.amp, 0);
  const altura = z => {
    let s = 0;
    for (const h of armonicos) s += h.amp * Math.sin((z / P) * Math.PI * 2 * h.k + h.fase);
    const u = 0.5 + 0.5 * (s / norm);
    return alturaMin + (alturaMax - alturaMin) * Math.pow(u, 1.3);
  };
  const cb = new THREE.Color(colorBase), cc = new THREE.Color(colorCima), tmp = new THREE.Color();
  for (let i = 0; i <= segZ; i++) {
    const z = -largo / 2 + (i / segZ) * largo;
    const h = altura(z);
    for (let j = 0; j <= filas; j++) {
      const v = j / filas;
      // La ladera se aleja al subir: perfil concavo, como una montana de verdad.
      const x = lado * (distancia + profundidad * Math.pow(v, 1.6));
      const y = -6 + (h + 6) * Math.pow(v, 0.85);
      pos.push(x, y, z);
      tmp.copy(cb).lerp(cc, Math.pow(v, 1.4));
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  const fila = filas + 1;
  for (let i = 0; i < segZ; i++) {
    for (let j = 0; j < filas; j++) {
      const a = i * fila + j, b = a + 1, c = a + fila, d = c + 1;
      if (lado > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- piezas
/** Geometria de un portico de senales que cruza toda la via. */
function geometriaPortico(luz) {
  const partes = [];
  const acero = new THREE.Color(0x8d949c);
  const pintar = (geo, color) => {
    const n = geo.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  };
  for (const s of [1, -1]) {
    const col = new THREE.CylinderGeometry(0.28, 0.32, 9.2, 12);
    col.translate(s * luz / 2, 4.6, 0);
    partes.push(pintar(col, acero));
    const base = new THREE.BoxGeometry(1.2, 0.6, 1.2);
    base.translate(s * luz / 2, 0.3, 0);
    partes.push(pintar(base, new THREE.Color(0xb8b6ae)));
  }
  // Cercha: dos cordones y diagonales.
  for (const y of [7.6, 9.0]) {
    for (const z of [-0.45, 0.45]) {
      const c = new THREE.BoxGeometry(luz + 0.8, 0.14, 0.14);
      c.translate(0, y, z);
      partes.push(pintar(c, acero));
    }
  }
  for (let x = -luz / 2; x < luz / 2; x += 1.6) {
    const d = new THREE.BoxGeometry(0.08, 1.6, 0.08);
    d.rotateZ(0.7);
    d.translate(x + 0.8, 8.3, 0.45);
    partes.push(pintar(d, acero));
    const d2 = d.clone(); d2.translate(0, 0, -0.9);
    partes.push(d2);
  }
  return mergeGeometries(partes.map(p => p.index ? p.toNonIndexed() : p));
}

/** Puente de concreto que cruza la autopista. */
function geometriaPuente(luz) {
  const partes = [];
  const concreto = new THREE.Color(0xb9b5ab), oscuro = new THREE.Color(0x77736b), baranda = new THREE.Color(0x9aa0a6);
  const pintar = (geo, color) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  const tablero = new THREE.BoxGeometry(luz + 60, 1.3, 11);
  tablero.translate(0, 7.4, 0);
  partes.push(pintar(tablero, concreto));
  const viga = new THREE.BoxGeometry(luz + 60, 0.5, 9.5);
  viga.translate(0, 6.5, 0);
  partes.push(pintar(viga, oscuro));
  for (const z of [-5.2, 5.2]) {
    const b = new THREE.BoxGeometry(luz + 60, 1.0, 0.25);
    b.translate(0, 8.55, z);
    partes.push(pintar(b, baranda));
  }
  // Pilas: en los dos bordes y en el separador.
  for (const x of [-luz / 2 - 1.6, luz / 2 + 1.6]) {
    for (const z of [-3, 3]) {
      const p = new THREE.CylinderGeometry(0.7, 0.8, 6.4, 14);
      p.translate(x, 3.2, z);
      partes.push(pintar(p, concreto));
    }
    const cab = new THREE.BoxGeometry(2.2, 0.8, 9);
    cab.translate(x, 6.1, 0);
    partes.push(pintar(cab, concreto));
  }
  return mergeGeometries(partes);
}

export class Paisaje {
  /**
   * @param {THREE.Scene} scene
   * @param {{arbolesPorTramo:number}} calidad
   */
  constructor(scene, calidad) {
    this.scene = scene;
    this.grupo = new THREE.Group();
    this.grupo.name = 'paisaje';
    scene.add(this.grupo);
    const borde = anchoTotal() / 2;
    this.borde = borde;

    // --- terreno ------------------------------------------------------------
    const pasto = texturaPasto();
    this.periodoTerreno = 40;
    pasto.repeat.set(4000 / this.periodoTerreno, 4000 / this.periodoTerreno);
    pasto.anisotropy = 8;
    this.terreno = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ map: pasto }));
    this.terreno.position.y = -0.06;
    this.terreno.receiveShadow = true;
    this.grupo.add(this.terreno);

    // Berma de gravilla junto al quitamiedos derecho.
    // (El separador de la izquierda lo dibuja la propia autopista.)

    // --- montanas -----------------------------------------------------------
    this.periodoMontes = 2400;
    const matMonte = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.montes = new THREE.Group();
    const capas = [
      { distancia: 150, profundidad: 140, alturaMin: 8, alturaMax: 48, colorBase: 0x4e7432, colorCima: 0x5d8238 },
      { distancia: 520, profundidad: 420, alturaMin: 50, alturaMax: 190, colorBase: 0x3f6a2e, colorCima: 0x557a3c },
      { distancia: 1250, profundidad: 600, alturaMin: 180, alturaMax: 470, colorBase: 0x3b5f37, colorCima: 0x5f7f5a },
    ];
    let semilla = 11;
    for (const c of capas) {
      for (const lado of [1, -1]) {
        const g = cordillera({ ...c, lado, P: this.periodoMontes, largo: this.periodoMontes * 3, semilla: semilla++ });
        const m = new THREE.Mesh(g, matMonte);
        this.montes.add(m);
      }
    }
    this.grupo.add(this.montes);

    // --- arboles ------------------------------------------------------------
    const atlas = atlasArboles();
    this.porTramo = calidad.arbolesPorTramo ?? 30;
    this.tramos = 9;
    // Cara simple y planos duplicados en vez de DoubleSide: con DoubleSide
    // three invierte la normal de la cara trasera y medio arbol salia negro.
    const matArbol = new THREE.MeshLambertMaterial({ map: atlas, alphaTest: 0.5 });
    this.arboles = [];
    for (let variante = 0; variante < 3; variante++) {
      const geo = this.#geometriaArbol(variante);
      const malla = new THREE.InstancedMesh(geo, matArbol, this.porTramo * this.tramos);
      malla.frustumCulled = false;
      malla.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.grupo.add(malla);
      this.arboles.push(malla);
    }
    this._tramoBase = null;

    // --- porticos y puentes ---------------------------------------------------
    const matPieza = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.15 });
    const luzPortico = anchoTotal() + 1.6;
    const geoPortico = geometriaPortico(luzPortico);
    this.letreros = [
      [texturaLetrero([['Medellín', '18 km'], ['Rionegro', '36 km']]), texturaLetrero([['Aeropuerto JMC']], { flecha: 0.6 })],
      [texturaLetrero([['Sabaneta', '7 km'], ['Envigado', '11 km']]), texturaLetrero([['Bogotá']], { flecha: 0 })],
      [texturaLetrero([['JERO RACER']], { fondo: '#101820' }), texturaLetrero([['Velocidad', 'máx 80'], ['Use cinturón', '']], { fondo: '#0b4f8a' })],
    ];
    this.porticos = [];
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const estructura = new THREE.Mesh(geoPortico, matPieza);
      estructura.castShadow = true;
      g.add(estructura);
      const paneles = [];
      for (const x of [-luzPortico * 0.22, luzPortico * 0.2]) {
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.0, emissive: 0xffffff, emissiveIntensity: 0.12 });
        const p = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 3.2), mat);
        p.position.set(x, 8.3, -0.62);
        p.rotation.y = Math.PI;      // mira hacia el conductor (que viene desde −Z)
        g.add(p);
        const dorso = new THREE.Mesh(new THREE.BoxGeometry(8.8, 3.4, 0.12), new THREE.MeshStandardMaterial({ color: 0x5b6168, roughness: 0.6 }));
        dorso.position.set(x, 8.3, -0.52);
        g.add(dorso);
        paneles.push(mat);
      }
      g.userData.paneles = paneles;
      this.grupo.add(g);
      this.porticos.push(g);
    }
    this.cadaPortico = 1700;

    const geoPuente = geometriaPuente(anchoTotal() + 12);
    this.puentes = [];
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(geoPuente, matPieza);
      m.castShadow = true; m.receiveShadow = true;
      this.grupo.add(m);
      this.puentes.push(m);
    }
    this.cadaPuente = 2900;

    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this.actualizar(0);
  }

  /** Dos planos cruzados con la silueta `variante` del atlas. Base en y=0. */
  #geometriaArbol(variante) {
    const u0 = variante / 3, u1 = (variante + 1) / 3;
    const planos = [];
    for (const rot of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const p = new THREE.PlaneGeometry(1, 1);
      const uv = p.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * (u1 - u0));
      p.translate(0, 0.5, 0);
      p.rotateY(rot);
      planos.push(p);
    }
    const g = mergeGeometries(planos);
    // Normales hacia arriba: asi el sol ilumina el arbol igual lo mire uno
    // de frente o de canto, en vez de encenderse y apagarse al pasar.
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    return g;
  }

  /** Recoloca los arboles de la ventana de tramos alrededor de `z`. */
  #plantar(tramoBase) {
    const cuenta = [0, 0, 0];
    for (let t = 0; t < this.tramos; t++) {
      const tramo = tramoBase + t;
      for (let i = 0; i < this.porTramo; i++) {
        const r = k => hash(tramo * 131 + k, i * 7 + 3);
        const lado = r(1) < 0.5 ? -1 : 1;
        // Mas densos cerca de la via, cada vez mas sueltos hacia fuera.
        const dist = this.borde + 5 + Math.pow(r(2), 1.7) * 150 + (lado > 0 ? 4 : 0);
        const z = tramo * TRAMO_ARBOLES + r(3) * TRAMO_ARBOLES;
        const variante = r(4) < 0.5 ? 0 : r(4) < 0.78 ? 1 : 2;
        const alto = (variante === 1 ? 14 : variante === 2 ? 11 : 9) * (0.7 + r(5) * 0.7);
        const ancho = alto * (variante === 0 ? 1.15 : variante === 1 ? 0.62 : 0.5);
        this._q.setFromAxisAngle(this._v.set(0, 1, 0), r(6) * Math.PI);
        this._m4.compose(this._v.set(lado * dist, -0.1, z), this._q, this._s.set(ancho, alto, ancho));
        const malla = this.arboles[variante];
        const k = cuenta[variante]++;
        malla.setMatrixAt(k, this._m4);
        const tono = 0.82 + r(7) * 0.3;
        malla.setColorAt(k, this._c.setRGB(tono, tono * (0.96 + r(8) * 0.08), tono * 0.92));
      }
    }
    this.arboles.forEach((m, i) => {
      m.count = cuenta[i];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }

  /** @param {number} z posicion del jugador a lo largo de la via */
  actualizar(z) {
    const pT = this.periodoTerreno;
    this.terreno.position.z = Math.round(z / pT) * pT;
    this.montes.position.z = Math.round(z / this.periodoMontes) * this.periodoMontes;

    const base = Math.floor(z / TRAMO_ARBOLES) - 2;
    if (base !== this._tramoBase) {
      this._tramoBase = base;
      this.#plantar(base);
    }

    // Porticos: el proximo por delante y el anterior por detras.
    const iP = Math.floor(z / this.cadaPortico);
    this.porticos.forEach((g, k) => {
      const n = iP + k;
      const zp = n * this.cadaPortico + 900;
      if (g.position.z !== zp) {
        g.position.set(0, 0, zp);
        const juego = this.letreros[((n % this.letreros.length) + this.letreros.length) % this.letreros.length];
        g.userData.paneles.forEach((m, j) => { m.map = juego[j]; m.emissiveMap = juego[j]; m.needsUpdate = true; });
      }
    });
    const iB = Math.floor(z / this.cadaPuente);
    this.puentes.forEach((m, k) => {
      const zb = (iB + k) * this.cadaPuente + 1500;
      if (m.position.z !== zb) m.position.set(0, 0, zb);
    });
  }
}
