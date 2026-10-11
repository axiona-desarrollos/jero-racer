/* ==========================================================================
   HIGHWAY RACER · Entrada
   --------------------------------------------------------------------------
   Abstraccion sobre teclado y mando. El resto del juego nunca consulta teclas:
   pide ejes ya normalizados.

   Por que importa: FHRSteeringModel esta escrito para ejes ANALOGICOS — sus
   tres constantes de tiempo existen para suavizar una entrada continua. Con
   teclado binario se desaprovecha. Un mando conectado da el eje real y el
   modelo hace exactamente lo que fue disenado para hacer.

   Y resuelve el bug de las teclas pegadas: si la ventana pierde el foco con una
   tecla pulsada, el keyup se lo lleva otra ventana y el coche se quedaba
   acelerando solo al volver del alt-tab.
   ========================================================================== */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Zona muerta radial: evita la deriva del stick en reposo. */
function deadzone(v, dz = 0.12) {
  const a = Math.abs(v);
  if (a < dz) return 0;
  return Math.sign(v) * ((a - dz) / (1 - dz));
}

export const DEFAULT_BINDINGS = Object.freeze({
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  camera: ['KeyC'],
  respawn: ['KeyR'],
  pause: ['Escape', 'KeyP'],
  mute: ['KeyM'],
  hud: ['KeyH'],
  telemetria: ['KeyT'],
  aceptar: ['Enter', 'NumpadEnter'],
});

export class Input {
  constructor(target = window, bindings = DEFAULT_BINDINGS) {
    this.bindings = bindings;
    this.keys = Object.create(null);
    this.pressed = Object.create(null);   // flanco de subida, se consume
    this.gamepadIndex = null;
    this._target = target;
    /** Controles en pantalla (movil). Los pone main.js si hay pantalla tactil. */
    this.tactil = null;
    /** Mientras sea false no se acelera ni se gira: cuenta atras, menus. */
    this.conduccion = true;

    this._onDown = e => {
      // No robamos las teclas del navegador si el usuario esta en un input.
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (!this.keys[e.code]) this.pressed[e.code] = true;
      this.keys[e.code] = true;
      if (this.#isBound(e.code)) e.preventDefault();
    };
    this._onUp = e => { this.keys[e.code] = false; };
    this._clear = () => { for (const k in this.keys) this.keys[k] = false; };
    this._onVis = () => { if (document.hidden) this._clear(); };
    this._onPadConnect = e => { this.gamepadIndex = e.gamepad.index; };
    this._onPadDisconnect = e => {
      if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = null;
    };

    target.addEventListener('keydown', this._onDown);
    target.addEventListener('keyup', this._onUp);
    target.addEventListener('blur', this._clear);
    target.addEventListener('gamepadconnected', this._onPadConnect);
    target.addEventListener('gamepaddisconnected', this._onPadDisconnect);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onVis);
    }
  }

  #isBound(code) {
    for (const k in this.bindings) if (this.bindings[k].includes(code)) return true;
    return false;
  }

  #down(accion) {
    const codes = this.bindings[accion];
    if (!codes) return false;
    for (const c of codes) if (this.keys[c]) return true;
    return false;
  }

  /** Flanco de subida. Se consume al leerlo: no dispara dos veces. */
  justPressed(accion) {
    const codes = this.bindings[accion];
    if (!codes) return false;
    for (const c of codes) {
      if (this.pressed[c]) { this.pressed[c] = false; return true; }
    }
    return false;
  }

  #pad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (this.gamepadIndex != null && pads[this.gamepadIndex]) return pads[this.gamepadIndex];
    for (const p of pads) if (p && p.connected) { this.gamepadIndex = p.index; return p; }
    return null;
  }

  /**
   * @returns {{throttle:number, brake:number, steer:number, handbrake:boolean, analog:boolean}}
   *          steer: -1 izquierda … +1 derecha
   */
  sample(dt = 1 / 60) {
    const e = this.#leer(dt);
    // Freno de mano y no el pedal: con el pedal a mas de 0,5 y el coche parado
    // la caja engrana la marcha atras.
    if (!this.conduccion) { e.throttle = 0; e.steer = 0; e.brake = 0; e.handbrake = true; }
    return e;
  }

  #leer(dt) {
    const pad = this.#pad();

    // Mando: gatillos analogicos y stick izquierdo. Mapeo XInput estandar.
    if (pad) {
      const ejeX = deadzone(pad.axes[0] ?? 0);
      const gatilloDer = pad.buttons[7]?.value ?? 0;
      const gatilloIzq = pad.buttons[6]?.value ?? 0;
      const usaPad = Math.abs(ejeX) > 0 || gatilloDer > 0.02 || gatilloIzq > 0.02
        || pad.buttons[0]?.pressed;
      if (usaPad) {
        return {
          throttle: clamp(gatilloDer, 0, 1),
          brake: clamp(gatilloIzq, 0, 1),
          steer: clamp(ejeX, -1, 1),
          handbrake: !!pad.buttons[0]?.pressed,   // A / X
          analog: true,
        };
      }
    }

    const teclado = {
      throttle: this.#down('throttle') ? 1 : 0,
      brake: this.#down('brake') ? 1 : 0,
      steer: (this.#down('right') ? 1 : 0) - (this.#down('left') ? 1 : 0),
      handbrake: this.#down('handbrake'),
      analog: false,
    };
    // Los controles en pantalla se SUMAN al teclado en vez de sustituirlo: en
    // una tableta con teclado se puede usar cualquiera de los dos.
    if (this.tactil && this.tactil.visible) {
      const t = this.tactil.muestrear(dt);
      teclado.throttle = Math.max(teclado.throttle, t.throttle);
      teclado.brake = Math.max(teclado.brake, t.brake);
      teclado.handbrake = teclado.handbrake || !!t.handbrake;
      if (teclado.steer === 0) { teclado.steer = t.steer; teclado.analog = t.analog; }
    }
    return teclado;
  }

  /** Pulsacion simulada desde un boton en pantalla (pausa, camara...). */
  pulsar(accion) {
    const c = this.bindings[accion]?.[0];
    if (c) this.pressed[c] = true;
  }

  dispose() {
    const t = this._target;
    t.removeEventListener('keydown', this._onDown);
    t.removeEventListener('keyup', this._onUp);
    t.removeEventListener('blur', this._clear);
    t.removeEventListener('gamepadconnected', this._onPadConnect);
    t.removeEventListener('gamepaddisconnected', this._onPadDisconnect);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVis);
    }
  }
}
