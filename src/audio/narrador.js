/* ==========================================================================
   JERO RACER · Narrador
   --------------------------------------------------------------------------
   Cuatro personajes comentan la partida: el narrador paisa (como de partido
   de futbol), la dona chismosa (las fotomultas), el tombo del megafono y la
   ardilla. Los audios salen de scripts/guion-voz.mjs (npm run voces) y viven
   en public/voz/ con su manifiesto voz.json. Sin esa carpeta el juego
   funciona igual, solo que callado.

   UN SOLO CANAL, CON TURNOS
   Dos personajes a la vez no se entienden. Cada evento trae su prioridad:
     3  interrumpe a quien este hablando (fin de partida, fotomultas);
     2  espera su turno, como mucho unos segundos;
     1  si alguien esta hablando, no se dice (rozones, golpes, megafono).
   Mientras alguien habla, el motor y los efectos bajan (EngineAudio.agachar).
   ========================================================================== */

const CONCURRENCIA = 6;

export class Narrador {
  /** @param {import('./engine.js').EngineAudio} audio */
  constructor(audio) {
    this.audio = audio;
    this.activo = true;
    this.manifiesto = null;
    this.buffers = new Map();
    this.ultimaVez = new Map();
    this.ultimoIndice = new Map();
    this.primerasDichas = new Set();
    this.actual = null;
    this.pendiente = null;
  }

  /** Descarga y decodifica las frases. Necesita el AudioContext ya creado. */
  cargar(base = './voz/') {
    this._carga ??= (async () => {
      const ctx = this.audio.ctx;
      if (!ctx) { this._carga = null; return; }
      try {
        const r = await fetch(base + 'voz.json');
        if (!r.ok) return;
        this.manifiesto = await r.json();
      } catch { return; }
      const archivos = Object.values(this.manifiesto.eventos).flatMap(e => e.lineas.map(l => l.archivo));
      let i = 0;
      const obrero = async () => {
        while (i < archivos.length) {
          const a = archivos[i++];
          try {
            const datos = await (await fetch(base + a)).arrayBuffer();
            this.buffers.set(a, await ctx.decodeAudioData(datos));
          } catch { /* una frase que no carga simplemente no se dice */ }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCIA }, obrero));
    })();
    return this._carga;
  }

  /** Nueva tirada: las frases "primera" vuelven a salir primero. */
  reiniciar() {
    this.callar();
    this.primerasDichas.clear();
    this.ultimaVez.clear();
  }

  callar() {
    this.pendiente = null;
    const a = this.actual;
    this.actual = null;
    if (a) {
      try {
        a.g.gain.setTargetAtTime(0, this.audio.ctx.currentTime, 0.03);
        a.src.stop(this.audio.ctx.currentTime + 0.15);
      } catch { /* ya habia terminado */ }
    }
    this.audio.agachar?.(false);
  }

  /**
   * Comenta un evento del guion.
   * @param {string} clave evento de scripts/guion-voz.mjs
   * @returns {boolean} si lo va a decir
   */
  decir(clave) {
    if (!this.activo || !this.manifiesto || !this.audio.ready || !this.audio.enabled) return false;
    const ev = this.manifiesto.eventos[clave];
    if (!ev) return false;
    const ahora = this.audio.ctx.currentTime;
    if (ev.espera && ahora - (this.ultimaVez.get(clave) ?? -1e9) < ev.espera) return false;
    if (ev.prob < 1 && Math.random() > ev.prob) return false;
    if (this.actual && ev.prioridad <= 1) return false;

    const linea = this.#elegir(clave, ev);
    const buf = this.buffers.get(linea.archivo);
    if (!buf) return false;
    this.ultimaVez.set(clave, ahora);
    const pedido = { clave, prioridad: ev.prioridad, buf, limite: ahora + (ev.prioridad >= 3 ? 8 : 5) };

    if (!this.actual) { this.#sonar(pedido); return true; }
    if (pedido.prioridad >= 3 && this.actual.prioridad < 3) {
      this.callar();
      this.#sonar(pedido);
      return true;
    }
    if (!this.pendiente || pedido.prioridad >= this.pendiente.prioridad) this.pendiente = pedido;
    return true;
  }

  #elegir(clave, ev) {
    const n = ev.lineas.length;
    if (ev.primera && !this.primerasDichas.has(clave)) {
      this.primerasDichas.add(clave);
      this.ultimoIndice.set(clave, 0);
      return ev.lineas[0];
    }
    let i = Math.floor(Math.random() * n);
    if (n > 1 && i === this.ultimoIndice.get(clave)) i = (i + 1 + Math.floor(Math.random() * (n - 1))) % n;
    this.ultimoIndice.set(clave, i);
    return ev.lineas[i];
  }

  #sonar(p) {
    const ctx = this.audio.ctx;
    const src = ctx.createBufferSource();
    src.buffer = p.buf;
    const g = ctx.createGain();
    g.gain.value = 1.15;
    src.connect(g);
    g.connect(this.audio.master);
    const actual = { ...p, src, g };
    src.onended = () => {
      if (this.actual !== actual) return;
      this.actual = null;
      this.audio.agachar?.(false);
      this.#siguiente();
    };
    this.actual = actual;
    this.audio.agachar?.(true);
    src.start();
  }

  #siguiente() {
    const p = this.pendiente;
    this.pendiente = null;
    if (p && this.audio.ctx.currentTime <= p.limite) this.#sonar(p);
  }
}
