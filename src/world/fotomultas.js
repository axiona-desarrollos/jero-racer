/* ==========================================================================
   JERO RACER · Fotomultas
   --------------------------------------------------------------------------
   Camaras de fotodeteccion al borde de la via, como las de Medellin, donde
   a 50 o a 70 km/h ya llega el recibo. Unas tienen su aviso unos metros
   antes (el limite y "deteccion electronica"); otras no tienen ninguno.
   Pasar por encima del limite dispara el flash y la partida lo anuncia.

   SITIO FIJO, INTERCALADO CON EL PAISAJE
   El paisaje pone porticos, vallas y puentes en huecos de 550 m que empiezan
   en z = 300. Las camaras van a mitad de hueco (z = 575 + 550 m), lejos de
   cualquier otra pieza, y nunca justo detras de un puente, que taparia el
   aviso. El calendario es una funcion pura de la posicion: la misma camara
   sale siempre en el mismo sitio y la partida puede preguntar cuales se
   cruzaron sin mirar la escena.
   ========================================================================== */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { anchoTotal } from './autopista.js';

export const FOTOMULTA = Object.freeze({
  hueco: 550,
  desfase: 575,
  /** Metros antes de la camara a los que esta su aviso. */
  aviso: 150,
});

// Un puesto por hueco del ciclo de 10 del paisaje; null = sin camara. El
// hueco 4 es el que sigue al puente.
const CICLO = [
  { oculta: false, limite: 70 }, null,
  { oculta: true, limite: 50 }, null, null,
  { oculta: false, limite: 50 }, null,
  { oculta: true, limite: 70 }, null, null,
];

/** La camara del hueco `m`, o null. */
export function camaraEn(m) {
  const c = CICLO[((m % CICLO.length) + CICLO.length) % CICLO.length];
  return c ? { m, z: m * FOTOMULTA.hueco + FOTOMULTA.desfase, ...c } : null;
}

/** Camaras cuyo punto de disparo queda en (z0, z1]. */
export function camarasEntre(z0, z1) {
  const out = [];
  if (!(z1 > z0)) return out;
  const { hueco, desfase } = FOTOMULTA;
  for (let m = Math.floor((z0 - desfase) / hueco); m * hueco + desfase <= z1; m++) {
    const c = camaraEn(m);
    if (c && c.z > z0) out.push(c);
  }
  return out;
}

function pintada(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const col = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g;
}

/**
 * Poste con brazo sobre el arcen, camara y flash mirando a los que llegan
 * (hacia −Z). Origen en la base del poste; el brazo sale hacia +X, la via.
 */
function geometriaCamara(brazo) {
  const p = [];
  const poste = new THREE.CylinderGeometry(0.11, 0.15, 7, 10);
  poste.translate(0, 3.5, 0);
  p.push(pintada(poste, 0x8e959c));
  // Franja reflectiva amarilla y negra, como las de los postes en la via.
  for (let i = 0; i < 4; i++) {
    const f = new THREE.CylinderGeometry(0.155, 0.155, 0.22, 10);
    f.translate(0, 1.2 + i * 0.22, 0);
    p.push(pintada(f, i % 2 ? 0x15171a : 0xf2c200));
  }
  const gabinete = new THREE.BoxGeometry(0.6, 0.95, 0.42);
  gabinete.translate(0, 0.48, 0.38);
  p.push(pintada(gabinete, 0xa7adb3));
  const b = new THREE.BoxGeometry(brazo, 0.14, 0.14);
  b.translate(brazo / 2, 6.75, 0);
  p.push(pintada(b, 0x8e959c));
  // Tirante del poste al brazo: de (0; 5,6) a (2; 6,75).
  const tirante = new THREE.BoxGeometry(2.3, 0.06, 0.06);
  tirante.rotateZ(Math.atan2(1.15, 2));
  tirante.translate(1.0, 6.18, 0);
  p.push(pintada(tirante, 0x8e959c));
  // Camara: carcasa blanca con visera y el frente negro del lente. Algo mas
  // grande que una de verdad: a 200 km/h tiene que leerse que es una camara.
  const carcasa = new THREE.BoxGeometry(0.62, 0.5, 1.1);
  carcasa.translate(brazo - 0.35, 6.4, 0);
  p.push(pintada(carcasa, 0xeef0f2));
  const visera = new THREE.BoxGeometry(0.7, 0.06, 0.5);
  visera.translate(brazo - 0.35, 6.68, -0.62);
  p.push(pintada(visera, 0xeef0f2));
  const frente = new THREE.BoxGeometry(0.46, 0.36, 0.04);
  frente.translate(brazo - 0.35, 6.4, -0.57);
  p.push(pintada(frente, 0x0b0d10));
  // Flash al lado de la camara.
  const flash = new THREE.BoxGeometry(0.46, 0.32, 0.26);
  flash.translate(brazo - 1.1, 6.42, -0.1);
  p.push(pintada(flash, 0x22252a));
  const lente = new THREE.BoxGeometry(0.36, 0.22, 0.03);
  lente.translate(brazo - 1.1, 6.42, -0.245);
  p.push(pintada(lente, 0xdfe6ee));
  return mergeGeometries(p);
}

/** Aviso: limite de velocidad y "deteccion electronica" en un mismo tablero. */
function texturaAviso(limite) {
  const W = 360, H = 540;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#f5f5f0'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#15171a'; g.lineWidth = 10; g.strokeRect(5, 5, W - 10, H - 10);
  const cx = W / 2, cy = 150, r = 122;
  g.fillStyle = '#d0121b'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, r * 0.78, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#111111'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 136px "Arial Black", Arial, sans-serif';
  g.fillText(String(limite), cx, cy + 6);
  // Banda azul con la camara y el texto.
  g.fillStyle = '#0b4ea2'; g.fillRect(22, 296, W - 44, 222);
  g.fillStyle = '#ffffff';
  const ky = 352;
  g.fillRect(cx - 46, ky - 26, 92, 56);
  g.fillRect(cx - 20, ky - 38, 40, 14);
  g.fillStyle = '#0b4ea2'; g.beginPath(); g.arc(cx, ky + 2, 18, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, ky + 2, 10, 0, Math.PI * 2); g.fill();
  for (const [t, y] of [['DETECCIÓN', 432], ['ELECTRÓNICA', 482]]) {
    let tam = 46;
    do { g.font = `bold ${tam}px "Arial Narrow", Arial, sans-serif`; tam--; } while (g.measureText(t).width > W - 70 && tam > 20);
    g.fillText(t, cx, y);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function texturaDestello() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(235,245,255,0.85)');
  grd.addColorStop(0.5, 'rgba(200,225,255,0.25)');
  grd.addColorStop(1, 'rgba(200,225,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export class Fotomultas {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.grupo = new THREE.Group();
    this.grupo.name = 'fotomultas';
    scene.add(this.grupo);
    const borde = anchoTotal() / 2;
    this.xPoste = -(borde + 1.7);          // a la derecha, tras la defensa
    const brazo = 4.3;

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 });
    const geoCamara = geometriaCamara(brazo);
    const matDestello = new THREE.SpriteMaterial({
      map: texturaDestello(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    const matLed = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    const geoLed = new THREE.SphereGeometry(0.045, 6, 4);
    this.camaras = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(geoCamara, mat);
      m.castShadow = true;
      g.add(m);
      // Piloto rojo de "grabando".
      const led = new THREE.Mesh(geoLed, matLed);
      led.position.set(brazo - 0.14, 6.56, -0.58);
      g.add(led);
      const destello = new THREE.Sprite(matDestello.clone());
      destello.position.set(brazo - 1.1, 6.42, -0.45);
      destello.visible = false;
      g.add(destello);
      g.position.x = this.xPoste;
      g.visible = false;
      g.userData = { m: null, destello, led, t: 0 };
      this.grupo.add(g);
      this.camaras.push(g);
    }

    // Avisos: tablero sobre dos postes, algo girado hacia la via.
    const matPoste = new THREE.MeshStandardMaterial({ color: 0x8e959c, roughness: 0.5, metalness: 0.4 });
    const geoPoste = new THREE.CylinderGeometry(0.05, 0.05, 4.9, 8).translate(0, 2.45, 0);
    const geoDorso = new THREE.BoxGeometry(1.84, 2.76, 0.05);
    const matDorso = new THREE.MeshStandardMaterial({ color: 0x6b7178, roughness: 0.6 });
    this.texturas = { 50: texturaAviso(50), 70: texturaAviso(70) };
    this.avisos = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      for (const x of [-0.55, 0.55]) {
        const p = new THREE.Mesh(geoPoste, matPoste);
        p.position.x = x;
        g.add(p);
      }
      const dorso = new THREE.Mesh(geoDorso, matDorso);
      dorso.position.set(0, 3.6, 0.04);
      g.add(dorso);
      const matTablero = new THREE.MeshStandardMaterial({ map: this.texturas[50], roughness: 0.45, emissive: 0xffffff, emissiveMap: this.texturas[50], emissiveIntensity: 0.12 });
      const tablero = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.7), matTablero);
      tablero.position.set(0, 3.6, 0);
      tablero.rotation.y = Math.PI;      // de cara al que llega por −Z
      g.add(tablero);
      g.position.x = -(borde + 1.0);
      g.rotation.y = -0.3;
      g.visible = false;
      g.userData = { m: null, mat: matTablero };
      this.grupo.add(g);
      this.avisos.push(g);
    }
    this.reloj = 0;
  }

  /** Coloca las camaras y avisos que caen cerca de `z`. */
  actualizar(z) {
    const { hueco, desfase } = FOTOMULTA;
    const m0 = Math.floor((z - 150 - desfase) / hueco);
    const visibles = [];
    for (let m = m0; m <= m0 + 4; m++) {
      const c = camaraEn(m);
      if (c) visibles.push(c);
    }
    // Las que ya estaban en su sitio no se tocan (podrian estar destellando).
    const libres = this.camaras.filter(g => !visibles.some(c => c.m === g.userData.m));
    for (const c of visibles) {
      if (this.camaras.some(g => g.userData.m === c.m)) continue;
      const g = libres.shift();
      if (!g) break;
      g.userData.m = c.m;
      g.userData.t = 0;
      g.position.z = c.z;
      g.visible = true;
    }
    for (const g of libres) { g.visible = false; g.userData.m = null; }

    const conAviso = visibles.filter(c => !c.oculta);
    const avisosLibres = this.avisos.filter(g => !conAviso.some(c => c.m === g.userData.m));
    for (const c of conAviso) {
      if (this.avisos.some(g => g.userData.m === c.m)) continue;
      const g = avisosLibres.shift();
      if (!g) break;
      g.userData.m = c.m;
      g.position.z = c.z - FOTOMULTA.aviso;
      g.visible = true;
      const t = this.texturas[c.limite];
      g.userData.mat.map = t; g.userData.mat.emissiveMap = t; g.userData.mat.needsUpdate = true;
    }
    for (const g of avisosLibres) { g.visible = false; g.userData.m = null; }
  }

  /** Doble destello de la camara `c` (la que acaba de coger al jugador). */
  disparar(c) {
    const g = this.camaras.find(g => g.userData.m === c.m);
    if (g) g.userData.t = 0.42;
  }

  /** @param {number} dt segundos reales */
  presentar(dt) {
    this.reloj += dt;
    const led = (this.reloj % 1.2) < 0.6;
    for (const g of this.camaras) {
      if (!g.visible) continue;
      g.userData.led.visible = led;
      const d = g.userData.destello;
      const t = g.userData.t;
      if (t <= 0) { d.visible = false; continue; }
      g.userData.t = Math.max(0, t - dt);
      // Dos fogonazos seguidos, como el flash de una camara de transito.
      const fase = 0.42 - t;
      const k = fase < 0.08 ? 1 - fase / 0.08 : fase > 0.16 && fase < 0.3 ? 1 - (fase - 0.16) / 0.14 : 0;
      d.visible = k > 0;
      d.material.opacity = k;
      d.scale.setScalar(4 + 6 * k);
    }
  }
}
