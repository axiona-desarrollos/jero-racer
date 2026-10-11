/* ==========================================================================
   HIGHWAY RACER · Director de camara
   --------------------------------------------------------------------------
   Unico dueno de la camara. Los modos proponen una pose; aqui se decide con
   que suavizado se llega a ella y como se cruza de un modo a otro.

   POR QUE HAY UNA SOLA CAPA DE SUAVIZADO
   La version anterior calculaba la pose Y la suavizaba dentro del mismo
   `if (cockpit)`. Consecuencia: al cambiar de camara la posicion saltaba de
   golpe, porque el estado suavizado pertenecia a la rama, no a la camara. Aqui
   el estado vive en el director y sobrevive al cambio de modo, asi que cambiar
   de camara es SIEMPRE un barrido continuo, incluso hacia un modo rigido como
   la cabina.

   TRANSICIONES
   Durante `DURACION_CRUCE` segundos tras un cambio se ignora la rigidez que
   pide el modo y se usa una curva suave comun. Sin esto, saltar a cabina
   (rigidez maxima) teletransportaria la camara dentro del coche.
   ========================================================================== */

import * as THREE from 'three';

/** @typedef {import('./modos.js').ContextoCamara} ContextoCamara */
/** @typedef {import('./modos.js').PoseCamara} PoseCamara */

const DURACION_CRUCE = 0.55;

/** Temporales del modulo: la camara se aplica cada frame y no puede asignar. */
const _vista = new THREE.Vector3();
const _alterno = new THREE.Vector3();

/** Suavizado independiente del framerate: `k` es la fraccion que QUEDA en 1 s. */
const factor = (k, dt) => (k <= 0 ? 1 : 1 - Math.pow(k, dt));
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Curva suave en los dos extremos: arranca y termina sin tiron. */
const suavePaso = t => t * t * (3 - 2 * t);

export class DirectorCamara {
  /**
   * @param {THREE.PerspectiveCamera} camara
   * @param {Array<{nombre:string, etiqueta:string, calcular:Function, reiniciar?:Function}>} modos
   */
  constructor(camara, modos) {
    if (!modos || modos.length === 0) {
      throw new Error('DirectorCamara necesita al menos un modo');
    }
    this.camara = camara;
    this.modos = modos;
    this.indice = 0;
    this.tiempo = 0;
    this.cruce = 0;

    this._pos = new THREE.Vector3();
    this._mira = new THREE.Vector3();
    this._arriba = new THREE.Vector3(0, 1, 0);
    this._arribaDestino = new THREE.Vector3(0, 1, 0);
    this._fov = camara.fov;
    this._iniciado = false;
    this._anclaPrev = new THREE.Vector3();
    this._hayAncla = false;
    this._delta = new THREE.Vector3();
    this.sacudida = 0;
    this._ruido = new THREE.Vector3();
  }

  /**
   * Sacude la camara (choques). Decae sola.
   * @param {number} fuerza metros de amplitud inicial
   */
  sacudir(fuerza) { this.sacudida = Math.max(this.sacudida, fuerza); }

  /** @returns {{nombre:string, etiqueta:string, calcular:Function, reiniciar?:Function}} */
  get modo() { return this.modos[this.indice]; }
  get etiqueta() { return this.modo.etiqueta; }

  /** Salta al siguiente modo del ciclo. */
  siguiente() { this.seleccionar((this.indice + 1) % this.modos.length); }

  /** Salta al anterior. */
  anterior() {
    this.seleccionar((this.indice - 1 + this.modos.length) % this.modos.length);
  }

  /**
   * Selecciona un modo por indice o por nombre. Un nombre desconocido se
   * ignora en vez de romper: la camara nunca debe tumbar el bucle de render.
   * @param {number|string} cual
   * @returns {boolean} si hubo cambio
   */
  seleccionar(cual) {
    const i = typeof cual === 'string'
      ? this.modos.findIndex(m => m.nombre === cual)
      : cual;
    if (i < 0 || i >= this.modos.length || i === this.indice) return false;
    this.indice = i;
    this.cruce = DURACION_CRUCE;
    if (this.modo.reiniciar) this.modo.reiniciar();
    return true;
  }

  /** Coloca la camara sin transicion. Para reapariciones y arranque. */
  fijar(ctx) {
    const p = this.modo.calcular(ctx);
    this._pos.copy(p.pos);
    this._mira.copy(p.mira);
    this._arriba.copy(p.arriba ?? { x: 0, y: 1, z: 0 });
    this._arribaDestino.copy(this._arriba);
    this._fov = p.fov;
    this.cruce = 0;
    this._iniciado = true;
    this._hayAncla = !!p.ancla;
    if (p.ancla) this._anclaPrev.copy(p.ancla);
    this.sacudida = 0;
    this.#aplicar();
  }

  /**
   * @param {ContextoCamara} ctx  sin `tiempo`: lo lleva el director
   * @param {number} dt segundos
   */
  actualizar(ctx, dt) {
    this.tiempo += dt;
    ctx.tiempo = this.tiempo;

    const p = this.modo.calcular(ctx);
    if (!this._iniciado) { this.fijar(ctx); return; }

    // LA CAMARA VIAJA CON EL COCHE. Los modos que declaran un ancla (el
    // coche) arrastran la camara con la traslacion del coche ANTES de
    // suavizar. Asi el suavizado solo actua sobre el giro y el cambio de
    // encuadre, no sobre el avance: antes, a 200 km/h, la persecucion se
    // quedaba 6 m por detras de su sitio y el coche salia diminuto.
    if (p.ancla) {
      if (this._hayAncla) {
        this._delta.copy(p.ancla).sub(this._anclaPrev);
        // Un salto de mas de 30 m en un fotograma es una reaparicion, no
        // movimiento: no se arrastra.
        if (this._delta.lengthSq() < 900) { this._pos.add(this._delta); this._mira.add(this._delta); }
      }
      this._anclaPrev.copy(p.ancla);
      this._hayAncla = true;
    } else {
      this._hayAncla = false;
    }

    let fPos, fMira;
    if (this.cruce > 0) {
      // En transicion manda una curva comun, no la rigidez del modo: saltar a
      // un modo pegado teletransportaria la camara.
      this.cruce = Math.max(0, this.cruce - dt);
      const avance = 1 - this.cruce / DURACION_CRUCE;
      const g = suavePaso(clamp01(avance));
      fPos = fMira = clamp01(0.06 + g * 0.30);
    } else {
      fPos = factor(p.kPos ?? 0.0016, dt);
      fMira = factor(p.kMira ?? 0.0006, dt);
    }

    this._pos.lerp(p.pos, fPos);
    this._mira.lerp(p.mira, fMira);
    this._fov += (p.fov - this._fov) * fMira;

    // El vector arriba tambien se interpola: la cenital lo cambia a −Z y sin
    // suavizarlo la imagen daria una voltereta seca al entrar y al salir.
    this._arribaDestino.set(0, 1, 0);
    if (p.arriba) this._arribaDestino.copy(p.arriba);
    this._arriba.lerp(this._arribaDestino, Math.max(fPos, 0.05));
    if (this._arriba.lengthSq() < 1e-6) this._arriba.set(0, 1, 0);

    this.#aplicar();
  }

  #aplicar() {
    const c = this.camara;
    c.up.copy(this._arriba).normalize();

    // GUARDA CONTRA LA MATRIZ DEGENERADA: si el vector arriba queda paralelo a
    // la direccion de vista, lookAt no puede construir una base ortonormal y
    // devuelve una matriz rota — pantalla negra, o un NaN que se propaga al
    // resto del frame. El caso vive en la cenital, que mira recto hacia abajo.
    // Hoy no se dispara porque la posicion y el arriba interpolan a la vez,
    // pero eso es una casualidad del orden, no una garantia: quien toque los
    // tiempos de transicion se lo encuentra.
    _vista.copy(this._mira).sub(this._pos);
    if (_vista.lengthSq() > 1e-12) {
      _vista.normalize();
      if (Math.abs(_vista.dot(c.up)) > 0.9995) {
        _alterno.set(c.up.z, c.up.x, c.up.y);   // permutar da un eje no paralelo
        c.up.addScaledVector(_alterno, 0.02).normalize();
      }
    }

    c.position.copy(this._pos);
    if (this.sacudida > 0.001) {
      const a = this.sacudida;
      this._ruido.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a * 0.7, (Math.random() - 0.5) * a);
      c.position.add(this._ruido);
      this.sacudida *= 0.9;
    }
    c.lookAt(this._mira);
    if (Math.abs(c.fov - this._fov) > 0.01) {
      c.fov = this._fov;
      c.updateProjectionMatrix();
    }
  }
}
