/* ==========================================================================
   JERO RACER · Los otros jugadores en la vía
   --------------------------------------------------------------------------
   Pinta y mueve los carros de los demas a partir de las poses que llegan por
   la sala (ver sala.js).

   INTERPOLACION CON RETARDO, QUE ES LO ÚNICO QUE FUNCIONA
   Las poses llegan diez veces por segundo y la pantalla pinta sesenta o mas.
   Si se colocara el carro en la ultima pose recibida, iria a saltos de 100 ms
   — a 200 km/h eso son saltos de cinco metros y medio. En vez de eso se
   dibuja el pasado: se retrasa 130 ms y se interpola ENTRE las dos poses que
   envuelven ese instante. El carro va suave siempre, al precio de ir un pelo
   atrasado, que nadie nota porque no se choca con el.

   NO HAY COLISION ENTRE JUGADORES, Y ES A PROPOSITO. Con 130 ms de retardo
   cada uno ve al otro en un sitio distinto: un choque siempre seria injusto
   para alguno. Lo que SI cuenta es pasar rozando — que es lo divertido y lo
   que se graba — y eso se mide con margen de sobra.

   TODOS LOS REMOTOS COMPARTEN LA GEOMETRIA del carro local: un clone() de
   tres.js copia los nodos pero apunta a las mismas mallas y materiales. Ocho
   jugadores cuestan ocho llamadas de dibujo, no ocho modelos en memoria. A
   cambio, en la via todos llevan el mismo carro; se distinguen por el color
   del rotulo y del halo del piso, que es lo que de verdad se lee a 200 km/h.
   ========================================================================== */

import * as THREE from 'three';

/** Segundos de retraso con que se dibuja a los demas. */
const RETARDO = 0.130;
/** Mas de esto sin noticias y el carro se desvanece. */
const PACIENCIA = 2.5;
/** Hueco lateral por debajo del cual pasar al lado cuenta como rozon. */
const HUECO_ROZON = 1.35;
/** Segundos entre dos rozones puntuables con el mismo jugador. */
const ESPERA_ROZON = 1.2;

const _v = new THREE.Vector3();

export class Remotos {
  /**
   * @param {THREE.Scene} escena
   * @param {THREE.Object3D} plantilla copia del carro del jugador SIN riguear
   * @param {{largo:number, ancho:number}} caja
   */
  constructor(escena, plantilla, caja) {
    this.escena = escena;
    this.plantilla = plantilla;
    this.caja = caja;
    /** @type {Map<string, object>} */
    this.vivos = new Map();
    this.eventos = [];
    this._halo = textoHalo();
  }

  /** Crea el carro de un jugador que acaba de aparecer. */
  #nacer(j) {
    const grupo = new THREE.Group();
    grupo.name = 'remoto_' + j.id;

    const cuerpo = this.plantilla.clone(true);
    cuerpo.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    grupo.add(cuerpo);

    // Halo en el piso con el color del jugador: es lo que permite seguirle la
    // pista entre el trafico cuando todos llevan el mismo carro.
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(this.caja.ancho * 2.1, this.caja.largo * 1.35),
      new THREE.MeshBasicMaterial({
        map: this._halo, color: j.color, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.03;
    halo.renderOrder = 1;
    grupo.add(halo);

    const rotulo = new Rotulo(j);
    rotulo.sprite.position.set(0, 2.05, 0);
    grupo.add(rotulo.sprite);

    // Las ruedas del clon giran solas: el Vehicle solo rigea el carro propio.
    const ruedas = ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR']
      .map(n => cuerpo.getObjectByName(n)).filter(Boolean);
    const radio = ruedas.length
      ? new THREE.Box3().setFromObject(ruedas[0]).getSize(_v).y / 2 || 0.34
      : 0.34;

    this.escena.add(grupo);
    const r = { j, grupo, halo, rotulo, ruedas, radio, giro: 0, ultimoRozon: -9, vivo: true };
    this.vivos.set(j.id, r);
    return r;
  }

  #morir(id) {
    const r = this.vivos.get(id);
    if (!r) return;
    this.escena.remove(r.grupo);
    r.halo.geometry.dispose();
    r.halo.material.dispose();
    r.rotulo.dispose();
    this.vivos.delete(id);
  }

  /**
   * @param {import('./sala.js').Sala} sala
   * @param {number} dt
   * @param {{x:number, z:number, yaw:number, tiempo:number}} jugador
   */
  actualizar(sala, dt, jugador) {
    this.eventos.length = 0;
    const ahora = performance.now();
    const objetivo = ahora - RETARDO * 1000;

    for (const [id] of this.vivos) if (!sala.otros.has(id)) this.#morir(id);

    for (const j of sala.otros.values()) {
      if (!j.poses.length) continue;
      const r = this.vivos.get(j.id) ?? this.#nacer(j);
      const pose = interpolar(j.poses, objetivo);
      if (!pose) continue;

      const mudo = (ahora - j.visto) / 1000;
      const visible = mudo < PACIENCIA;
      r.grupo.visible = visible;
      if (!visible) continue;

      r.grupo.position.set(pose.x, pose.y, pose.z);
      r.grupo.rotation.y = pose.r;
      // Las ruedas ruedan con la velocidad que el otro anuncio.
      r.giro -= (pose.v / 3.6) / Math.max(0.1, r.radio) * dt;
      for (const w of r.ruedas) w.rotation.x = r.giro;
      r.halo.material.opacity = 0.55 * (1 - Math.max(0, (mudo - 1.2) / (PACIENCIA - 1.2)));
      r.rotulo.actualizar(j, pose.f);

      // --- rozon con otro jugador ------------------------------------------
      const dz = Math.abs(pose.z - jugador.z);
      const dx = Math.abs(pose.x - jugador.x);
      if (dz < this.caja.largo * 0.75 && dx < this.caja.ancho + HUECO_ROZON && dx > this.caja.ancho * 0.55
        && jugador.tiempo - r.ultimoRozon > ESPERA_ROZON) {
        r.ultimoRozon = jugador.tiempo;
        this.eventos.push({ tipo: 'rozon', id: j.id, apodo: j.apodo, hueco: dx - this.caja.ancho });
      }
    }
  }

  dispose() {
    for (const [id] of [...this.vivos]) this.#morir(id);
    this._halo?.dispose();
  }
}

/**
 * Pose en un instante dado, interpolando entre las dos que lo envuelven.
 * Si el instante va por delante de la ultima recibida (se perdio un paquete)
 * se prolonga el movimiento un poco en vez de congelar el carro.
 */
function interpolar(poses, t) {
  if (!poses.length) return null;
  const ult = poses[poses.length - 1];
  if (t >= ult.t) {
    const extra = Math.min(0.25, (t - ult.t) / 1000);
    const avance = (ult.v / 3.6) * extra;
    return { ...ult, x: ult.x + Math.sin(ult.r) * avance, z: ult.z + Math.cos(ult.r) * avance };
  }
  for (let i = poses.length - 1; i > 0; i--) {
    const b = poses[i], a = poses[i - 1];
    if (t >= a.t && t <= b.t) {
      const k = (t - a.t) / Math.max(1, b.t - a.t);
      return {
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        z: a.z + (b.z - a.z) * k,
        r: a.r + anguloCorto(b.r - a.r) * k,
        v: a.v + (b.v - a.v) * k,
        f: b.f,
      };
    }
  }
  return poses[0];
}

/** La diferencia de dos angulos por el camino corto: evita el latigazo en ±π. */
function anguloCorto(d) {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ------------------------------------------------------------------ rótulo
/** Apodo y puntos flotando sobre el carro. */
class Rotulo {
  constructor(j) {
    this.lienzo = document.createElement('canvas');
    this.lienzo.width = 512; this.lienzo.height = 128;
    this.tex = new THREE.CanvasTexture(this.lienzo);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.tex, transparent: true, depthTest: true, depthWrite: false,
      sizeAttenuation: true,
    }));
    this.sprite.scale.set(3.4, 0.85, 1);
    this.sprite.renderOrder = 3;
    this._ult = '';
    this.actualizar(j, 0);
  }

  actualizar(j, frenando) {
    const txt = `${j.apodo}|${Math.round(j.puntos ?? 0)}|${frenando}`;
    if (txt === this._ult) return;
    this._ult = txt;
    const g = this.lienzo.getContext('2d');
    const col = '#' + (j.color ?? 0x00f0c0).toString(16).padStart(6, '0');
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = 'rgba(6,10,16,0.72)';
    redondear(g, 6, 6, 500, 116, 26);
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = col;
    g.stroke();
    g.textAlign = 'center';
    g.fillStyle = col;
    g.font = 'bold 48px Rajdhani, Arial, sans-serif';
    g.fillText((j.apodo ?? '').toUpperCase(), 256, 56);
    g.fillStyle = '#e8eef5';
    g.font = 'bold 34px Rajdhani, Arial, sans-serif';
    g.fillText(`${Math.round(j.puntos ?? 0).toLocaleString('es-CO')} PTS`, 256, 100);
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.tex.dispose();
    this.sprite.material.dispose();
  }
}

function redondear(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Mancha ovalada degradada para el halo del piso. */
function textoHalo() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
