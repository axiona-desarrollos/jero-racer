/* ==========================================================================
   JERO RACER · Sala en línea
   --------------------------------------------------------------------------
   La autopista compartida: varios jugadores corriendo a la vez, viendose
   entre si y con los puntos de todos en vivo.

   POR QUE SUPABASE REALTIME Y NO UN SERVIDOR PROPIO
   Netlify solo sirve archivos; no puede mantener una conexion abierta. Axiona
   ya paga Supabase Pro, que trae un servicio de canales en vivo (WebSocket)
   sin nada que administrar. La clave `anon` va en el JavaScript a proposito:
   es publica por diseño, y este canal no toca ninguna tabla.

   DOS COSAS POR CANAL, Y SON DISTINTAS
     presencia  quien esta en la sala: apodo, carro, color, puntos. Cambia
                poco y el servidor guarda el estado, asi que quien entra
                tarde ve a todos sin esperar.
     difusion   la pose del coche, diez veces por segundo. No se guarda: si
                se pierde un paquete da igual, el siguiente llega en 100 ms.

   NO HAY ARBITRO, Y ESTA BIEN ASI. Cada quien simula su propia partida y
   anuncia donde esta. Los demas no chocan con uno (ver remotos.js): a 10 Hz
   y con 120 ms de retardo, un choque entre jugadores seria siempre injusto
   para alguno de los dos. Pasar rozando SI puntua, que es lo divertido.

   EN DESARROLLO, SIN SUPABASE. Si no hay claves, la sala funciona entre
   pestañas del mismo navegador con BroadcastChannel. Sirve para probar todo
   el juego en linea en este PC sin tocar la nube.
   ========================================================================== */

const URL_SUPA = import.meta.env.VITE_SUPABASE_URL ?? '';
const CLAVE_SUPA = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/** ¿Hay nube configurada? Si no, la sala es solo local (pestañas). */
export const HAY_NUBE = !!(URL_SUPA && CLAVE_SUPA);

/** Envíos por segundo de la pose. Más que esto no mejora: el ojo no lo ve
 *  y Supabase limita los mensajes por cliente. */
export const HZ = 10;

const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sin I, O, 0, 1: se confunden al dictarlas

export function codigoNuevo(n = 4) {
  let s = '';
  for (let i = 0; i < n; i++) s += LETRAS[Math.floor(Math.random() * LETRAS.length)];
  return s;
}

export function normalizarCodigo(txt) {
  return (txt ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

/** Colores de los jugadores: se reparten por orden de llegada. */
export const COLORES = Object.freeze([
  0x00f0c0, 0xff3b30, 0xffc400, 0x3b82f6, 0xa855f7, 0xff7a00, 0x22c55e, 0xec4899,
]);

let idLocal = null;
/**
 * Identificador del jugador. Va en sessionStorage y NO en localStorage a
 * proposito: sobrevive a recargar la pagina (no se duplica uno mismo en la
 * lista) pero es distinto en cada pestaña, que es lo que permite probar la
 * sala con dos pestañas del mismo navegador.
 */
export function miId() {
  if (idLocal) return idLocal;
  const nuevo = () => (crypto.randomUUID?.() ?? String(Math.random())).replace(/-/g, '').slice(0, 8);
  try {
    idLocal = sessionStorage.getItem('jr.id');
    if (!idLocal) { idLocal = nuevo(); sessionStorage.setItem('jr.id', idLocal); }
  } catch { idLocal = nuevo(); }
  return idLocal;
}

export class Sala {
  /**
   * @param {{codigo:string, apodo:string, carro:string}} o
   */
  constructor({ codigo, apodo, carro }) {
    this.codigo = normalizarCodigo(codigo);
    this.yo = { id: miId(), apodo: (apodo || 'ANÓNIMO').slice(0, 14), carro, puntos: 0, km: 0, color: COLORES[0] };
    /** @type {Map<string, {id:string, apodo:string, carro:string, color:number, puntos:number, km:number, poses:object[], visto:number}>} */
    this.otros = new Map();
    this.estado = 'fuera';       // fuera | entrando | dentro | error
    this.error = null;
    this.nube = HAY_NUBE;
    this.on = { cambio: () => {}, aviso: () => {} };
    this._canal = null;
    this._cliente = null;
    this._bc = null;
    this._acc = 0;
    this._seq = 0;
  }

  get dentro() { return this.estado === 'dentro'; }
  get cuantos() { return this.otros.size + 1; }

  async entrar() {
    if (this.estado === 'entrando' || this.estado === 'dentro') return;
    this.estado = 'entrando';
    this.on.cambio(this);
    try {
      if (this.nube) await this.#entrarNube();
      else this.#entrarLocal();
      this.estado = 'dentro';
    } catch (e) {
      console.warn('[sala]', e);
      this.error = e?.message ?? String(e);
      this.estado = 'error';
    }
    this.on.cambio(this);
  }

  async #entrarNube() {
    const { RealtimeClient } = await import('@supabase/realtime-js');
    this._cliente = new RealtimeClient(URL_SUPA.replace(/^http/, 'ws') + '/realtime/v1', {
      params: { apikey: CLAVE_SUPA, eventsPerSecond: HZ + 5 },
    });
    this._canal = this._cliente.channel('jero:' + this.codigo, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.yo.id } },
    });

    this._canal.on('broadcast', { event: 'p' }, ({ payload }) => this.#recibirPose(payload));
    this._canal.on('presence', { event: 'sync' }, () => {
      const mapa = this._canal.presenceState();
      const vivos = new Set();
      for (const clave of Object.keys(mapa)) {
        const info = mapa[clave][0];
        if (!info || info.id === this.yo.id) continue;
        vivos.add(info.id);
        this.#verA(info);
      }
      for (const id of [...this.otros.keys()]) if (!vivos.has(id)) this.#seVa(id);
      this.on.cambio(this);
    });

    await new Promise((listo, falla) => {
      const reloj = setTimeout(() => falla(new Error('La sala no respondió. Revisa la conexión.')), 12000);
      this._canal.subscribe((st, err) => {
        if (st === 'SUBSCRIBED') { clearTimeout(reloj); listo(); }
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { clearTimeout(reloj); falla(err ?? new Error('No se pudo entrar a la sala')); }
      });
    });
    await this._canal.track(this.#miFicha());
  }

  /** Sin nube: entre pestañas del mismo navegador. Solo para desarrollo. */
  #entrarLocal() {
    this._bc = new BroadcastChannel('jero:' + this.codigo);
    this._bc.onmessage = (ev) => {
      const m = ev.data;
      if (!m || m.i === this.yo.id) return;
      if (m.t === 'p') this.#recibirPose(m);
      else if (m.t === 'hola') { this.#verA(m.ficha); this._bc.postMessage({ t: 'eco', i: this.yo.id, ficha: this.#miFicha() }); this.on.cambio(this); }
      else if (m.t === 'eco') { this.#verA(m.ficha); this.on.cambio(this); }
      else if (m.t === 'chao') { this.#seVa(m.i); this.on.cambio(this); }
    };
    this._bc.postMessage({ t: 'hola', i: this.yo.id, ficha: this.#miFicha() });
  }

  #miFicha() {
    return {
      id: this.yo.id, apodo: this.yo.apodo, carro: this.yo.carro,
      puntos: Math.round(this.yo.puntos), km: +this.yo.km.toFixed(2),
    };
  }

  #verA(ficha) {
    let j = this.otros.get(ficha.id);
    if (!j) {
      // El color se asigna por el identificador, no por orden de llegada: asi
      // el mismo jugador es del mismo color para todos los de la sala.
      let h = 0;
      for (const ch of ficha.id) h = (h * 31 + ch.charCodeAt(0)) | 0;
      j = { id: ficha.id, poses: [], color: COLORES[Math.abs(h) % COLORES.length], visto: performance.now() };
      this.otros.set(ficha.id, j);
      this.on.aviso(`${ficha.apodo} entró a la sala`);
    }
    j.apodo = ficha.apodo; j.carro = ficha.carro;
    j.puntos = ficha.puntos ?? j.puntos ?? 0;
    j.km = ficha.km ?? j.km ?? 0;
  }

  #seVa(id) {
    const j = this.otros.get(id);
    if (j) this.on.aviso(`${j.apodo} se fue`);
    this.otros.delete(id);
  }

  #recibirPose(p) {
    const j = this.otros.get(p.i);
    if (!j) return;
    j.visto = performance.now();
    j.puntos = p.p ?? j.puntos;
    j.km = p.k ?? j.km;
    j.vivo = p.e === 1;
    // Cola de poses con su marca de tiempo LOCAL: los relojes de dos
    // telefonos no coinciden, asi que la interpolacion usa el momento en que
    // llego el paquete, no el que trae dentro.
    j.poses.push({ t: j.visto, x: p.x, y: p.y, z: p.z, r: p.r, v: p.v, f: p.f });
    if (j.poses.length > 8) j.poses.shift();
  }

  /**
   * Anuncia donde va uno. Se llama en cada fotograma; dentro se recorta a HZ.
   * @param {{x,y,z,yaw,kmh,freno,puntos,km,jugando}} e
   */
  publicar(e, dt) {
    if (!this.dentro) return;
    this.yo.puntos = e.puntos ?? 0;
    this.yo.km = e.km ?? 0;
    this._acc += dt;
    if (this._acc < 1 / HZ) return;
    this._acc = 0;
    const r2 = v => Math.round(v * 100) / 100;
    const msg = {
      i: this.yo.id, x: r2(e.x), y: r2(e.y), z: r2(e.z), r: r2(e.yaw),
      v: Math.round(e.kmh), f: e.freno ? 1 : 0,
      p: Math.round(e.puntos ?? 0), k: r2(e.km ?? 0), e: e.jugando ? 1 : 0,
    };
    if (this.nube) this._canal?.send({ type: 'broadcast', event: 'p', payload: msg });
    else this._bc?.postMessage({ t: 'p', ...msg });
    // La presencia solo se refresca cada pocos segundos: es estado guardado y
    // mandarla a 10 Hz gastaria la cuota sin ganar nada.
    this._seq++;
    if (this.nube && this._seq % (HZ * 4) === 0) this._canal?.track(this.#miFicha());
  }

  salir() {
    if (this.nube) {
      try { this._canal?.untrack(); } catch { /* ya cerrado */ }
      try { this._cliente?.removeAllChannels(); this._cliente?.disconnect(); } catch { /* ya cerrado */ }
    } else {
      try { this._bc?.postMessage({ t: 'chao', i: this.yo.id }); this._bc?.close(); } catch { /* ya cerrado */ }
    }
    this._canal = this._cliente = this._bc = null;
    this.otros.clear();
    this.estado = 'fuera';
    this.on.cambio(this);
  }

  /** Quita a quien lleve mucho sin hablar (cerro la pestaña de golpe). */
  limpiar(ahora = performance.now()) {
    for (const [id, j] of this.otros) {
      if (ahora - j.visto > 15000) { this.#seVa(id); this.on.cambio(this); }
    }
  }

  /** Tabla de la sala ordenada por puntos, incluyendome. */
  tabla() {
    const fila = j => ({ id: j.id, apodo: j.apodo, puntos: Math.round(j.puntos ?? 0), km: j.km ?? 0, color: j.color, yo: j.id === this.yo.id });
    const t = [fila({ ...this.yo, color: 0xffffff }), ...[...this.otros.values()].map(fila)];
    return t.sort((a, b) => b.puntos - a.puntos);
  }
}
