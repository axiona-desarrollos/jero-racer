/* ==========================================================================
   JERO RACER · Controles tactiles e inclinacion
   --------------------------------------------------------------------------
   En el movil se conduce como con un volante: se gira el telefono. Los
   pulgares quedan libres para el gas (derecha) y el freno (izquierda).

   COMO SE MIDE EL GIRO DEL TELEFONO
   No se usa `gamma` ni `beta` a pelo. Esos angulos de Euler cambian de
   significado segun el telefono este en vertical o en horizontal, y cerca de
   la vertical se degeneran (bloqueo de cardan): el volante pegaba saltos.
   En su lugar se reconstruye el vector "arriba" del mundo en coordenadas del
   telefono a partir de beta y gamma, se lleva a coordenadas de PANTALLA con
   el angulo de orientacion, y el angulo de ese vector en el plano de la
   pantalla es exactamente el giro de volante. Funciona en horizontal, en
   vertical y con el telefono recostado hacia atras, que es como se sostiene
   de verdad para jugar.

     arriba_dispositivo = (−cos b · sin g,  sin b,  cos b · cos g)

   iPhone exige pedir permiso (DeviceOrientationEvent.requestPermission) y
   SOLO dentro de un gesto del usuario: por eso se pide al tocar JUGAR.
   ========================================================================== */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const GRAD = Math.PI / 180;

/** Giro del telefono como volante, en grados. */
export class Inclinacion {
  constructor({ topeGrados = 24, zonaMuerta = 1.6 } = {}) {
    this.tope = topeGrados;
    this.zonaMuerta = zonaMuerta;
    this.crudo = 0;          // grados sin calibrar
    this.cero = 0;           // calibracion
    this.suave = 0;
    this.eventos = 0;
    this.activa = false;
    this.ultimoEvento = 0;
    this._alEvento = (e) => this.#evento(e);
  }

  /** ¿El navegador expone el sensor? */
  static existe() {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  }

  /** ¿Hace falta pedir permiso (iOS 13+)? */
  static pidePermiso() {
    return Inclinacion.existe() && typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  /**
   * Pide permiso si hace falta. LLAMAR DIRECTAMENTE DESDE UN CLICK: en iOS,
   * cualquier await previo hace que el gesto caduque y el permiso se niega
   * sin preguntar.
   * @returns {Promise<boolean>}
   */
  pedirPermiso() {
    if (!Inclinacion.existe()) return Promise.resolve(false);
    if (!Inclinacion.pidePermiso()) return Promise.resolve(true);
    return DeviceOrientationEvent.requestPermission()
      .then(r => r === 'granted')
      .catch(() => false);
  }

  iniciar() {
    if (this.activa) return;
    this.activa = true;
    addEventListener('deviceorientation', this._alEvento);
  }

  detener() {
    this.activa = false;
    removeEventListener('deviceorientation', this._alEvento);
  }

  /** ¿Llegan datos de verdad? Algunos navegadores de escritorio emiten nulls. */
  get disponible() {
    return this.eventos > 2 && performance.now() - this.ultimoEvento < 1500;
  }

  #angulo() {
    const o = (screen.orientation && typeof screen.orientation.angle === 'number')
      ? screen.orientation.angle
      : (typeof window.orientation === 'number' ? window.orientation : 0);
    return ((o % 360) + 360) % 360;
  }

  #evento(e) {
    if (e.beta == null || e.gamma == null) return;
    const b = e.beta * GRAD, g = e.gamma * GRAD;
    // Arriba del mundo en coordenadas del telefono.
    const ux = -Math.cos(b) * Math.sin(g);
    const uy = Math.sin(b);
    // A coordenadas de pantalla segun como este girada la pantalla.
    const t = this.#angulo() * GRAD;
    const sx = ux * Math.cos(t) - uy * Math.sin(t);
    const sy = ux * Math.sin(t) + uy * Math.cos(t);
    // Telefono casi plano: la proyeccion es diminuta y el angulo es ruido.
    if (sx * sx + sy * sy < 0.04) return;
    this.crudo = Math.atan2(-sx, sy) / GRAD;
    this.eventos++;
    this.ultimoEvento = performance.now();
  }

  /** La posicion actual pasa a ser "volante recto". */
  calibrar() {
    // Solo se calibra si el telefono esta razonablemente derecho: si alguien
    // pulsa JUGAR con el telefono torcido 40 grados, centrar ahi lo dejaria
    // conduciendo torcido toda la partida.
    this.cero = Math.abs(this.crudo) < 25 ? this.crudo : 0;
    this.suave = 0;
  }

  /**
   * @param {number} dt segundos
   * @returns {number} -1 izquierda … +1 derecha
   */
  valor(dt) {
    let a = this.crudo - this.cero;
    if (a > 180) a -= 360; else if (a < -180) a += 360;
    const signo = Math.sign(a);
    const m = Math.max(0, Math.abs(a) - this.zonaMuerta) / (this.tope - this.zonaMuerta);
    // Curva suave en el centro: correcciones finas sin perder el tope.
    const objetivo = signo * Math.pow(clamp(m, 0, 1), 1.25);
    this.suave += (objetivo - this.suave) * (1 - Math.exp(-dt / 0.05));
    return clamp(this.suave, -1, 1);
  }
}

/**
 * Pedales y botones en pantalla. Multitactil: cada dedo se sigue por su
 * pointerId, asi se puede acelerar y girar con botones a la vez.
 */
export class ControlTactil {
  /**
   * @param {HTMLElement} raiz contenedor donde se dibujan los controles
   * @param {{modo?:'inclinar'|'botones', onPausa?:Function}} o
   */
  constructor(raiz, o = {}) {
    this.raiz = raiz;
    this.modo = o.modo ?? 'inclinar';
    this.inclinacion = new Inclinacion();
    this.pulsado = { gas: false, freno: false, izq: false, der: false };
    this.dedos = new Map();
    this.visible = false;
    this.#construir();
    this.setModo(this.modo);
  }

  #construir() {
    const r = this.raiz;
    r.classList.add('tactil');
    r.innerHTML = `
      <button class="t-boton t-izq" data-b="izq" aria-label="Girar a la izquierda"><span>◀</span></button>
      <button class="t-boton t-der" data-b="der" aria-label="Girar a la derecha"><span>▶</span></button>
      <button class="t-boton t-freno" data-b="freno" aria-label="Frenar"><i></i><span>FRENO</span></button>
      <button class="t-boton t-gas" data-b="gas" aria-label="Acelerar"><i></i><span>GAS</span></button>`;
    const soltar = (e) => {
      const b = this.dedos.get(e.pointerId);
      if (!b) return;
      this.dedos.delete(e.pointerId);
      // Otro dedo puede seguir sobre el mismo boton.
      let sigue = false;
      for (const otro of this.dedos.values()) if (otro === b) sigue = true;
      if (!sigue) {
        this.pulsado[b] = false;
        r.querySelector(`[data-b="${b}"]`)?.classList.remove('activo');
      }
    };
    for (const el of r.querySelectorAll('[data-b]')) {
      const b = el.dataset.b;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch { /* sin captura en algunos navegadores */ }
        this.dedos.set(e.pointerId, b);
        this.pulsado[b] = true;
        el.classList.add('activo');
        if (navigator.vibrate) navigator.vibrate(8);
      });
      el.addEventListener('pointerup', soltar);
      el.addEventListener('pointercancel', soltar);
      el.addEventListener('lostpointercapture', soltar);
      el.addEventListener('contextmenu', e => e.preventDefault());
    }
  }

  /** @param {'inclinar'|'botones'} modo */
  setModo(modo) {
    this.modo = modo;
    this.raiz.dataset.modo = modo;
    if (modo === 'inclinar') this.inclinacion.iniciar();
    else this.inclinacion.detener();
  }

  mostrar(si) {
    this.visible = si;
    this.raiz.hidden = !si;
    if (!si) {
      for (const k in this.pulsado) this.pulsado[k] = false;
      this.dedos.clear();
      for (const el of this.raiz.querySelectorAll('.activo')) el.classList.remove('activo');
    }
  }

  /**
   * @param {number} dt segundos
   * @returns {{throttle:number, brake:number, steer:number, analog:boolean, activo:boolean}}
   */
  muestrear(dt) {
    const p = this.pulsado;
    let steer = 0, analog = false;
    if (this.modo === 'inclinar' && this.inclinacion.disponible) {
      steer = this.inclinacion.valor(dt);
      analog = true;
    } else {
      steer = (p.der ? 1 : 0) - (p.izq ? 1 : 0);
    }
    return {
      throttle: p.gas ? 1 : 0,
      brake: p.freno ? 1 : 0,
      steer,
      analog,
      activo: this.visible,
    };
  }
}
