/* ==========================================================================
   HIGHWAY RACER · Bucle de paso fijo
   --------------------------------------------------------------------------
   Patron "Fix Your Timestep": la fisica avanza siempre en pasos identicos y el
   render interpola entre los dos ultimos. Dos cosas que la version anterior no
   hacia y se notaban:

   1. SIN INTERPOLACION, a 144 Hz el 58% de los frames no ejecutan ningun paso:
      el coche se congela y luego salta 16,7 ms de golpe (0,46 m a 100 km/h).
   2. SIN VALVULA DE ESCAPE, si el frame tarda mas que el presupuesto de pasos
      el acumulador crece sin limite y el retardo de entrada se hace permanente
      y creciente. Mas vale camara lenta que un coche que responde con un
      segundo de retraso.
   ========================================================================== */

export class FixedLoop {
  /**
   * @param {object} o
   * @param {number} o.step      paso de fisica en segundos (p.ej. 1/60)
   * @param {number} o.maxSteps  presupuesto de pasos por frame
   * @param {number} o.maxFrame  tope de dt por frame, en segundos
   * @param {(dt:number)=>void} o.fixed   simulacion
   * @param {(alpha:number, dt:number)=>void} o.render  presentacion
   */
  constructor({ step = 1 / 60, maxSteps = 6, maxFrame = 0.1, fixed, render }) {
    this.step = step;
    this.maxSteps = maxSteps;
    this.maxFrame = maxFrame;
    this.fixed = fixed;
    this.render = render;

    this.acc = 0;
    /** Escala de tiempo de la simulacion: < 1 es camara lenta (choques). */
    this.escala = 1;
    this.running = false;
    this.fps = 60;
    this.lastSteps = 0;
    this.dropped = 0;          // veces que se descarto deuda temporal
    this._last = 0;
    this._raf = null;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this.acc = 0;
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    if (this._raf != null) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  /** Tras una pausa larga (pestaña oculta) hay que soltar el tiempo acumulado. */
  resync() {
    this._last = performance.now();
    this.acc = 0;
  }

  _tick(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);

    const raw = (now - this._last) / 1000;
    this._last = now;
    const dt = Math.min(Math.max(raw, 0), this.maxFrame);

    // Suavizado independiente del framerate — el mismo criterio que la camara.
    // Con un alpha fijo por frame el indicador miente distinto en cada maquina.
    if (dt > 0) this.fps += (1 / dt - this.fps) * (1 - Math.pow(0.03, dt));

    this.acc += dt * this.escala;
    let steps = 0;
    while (this.acc >= this.step && steps < this.maxSteps) {
      this.fixed(this.step);
      this.acc -= this.step;
      steps++;
    }
    // Valvula de escape: si agotamos el presupuesto, tiramos la deuda restante.
    if (steps === this.maxSteps && this.acc > this.step) {
      this.acc = 0;
      this.dropped++;
    }
    this.lastSteps = steps;

    this.render(this.acc / this.step, dt);
  }
}
