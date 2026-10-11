/* ==========================================================================
   JERO RACER · Sonido del motor
   --------------------------------------------------------------------------
   Todo sintetizado con Web Audio. Ni un archivo de sonido.

   POR QUE SE REHIZO
   La version anterior sumaba un silbido de turbo entre 1,5 y 12 kHz, ruido de
   admision siseante y un filtro que se abria hasta 6,5 kHz. Junto sonaba a
   turbina de avion: mucho agudo y nada de pecho. Un coche de carreras con
   escape grueso suena al reves: GRAVE, con pulsos, ronco al cargar y con
   petardeos al soltar el acelerador.

   DE DONDE SALE EL RONQUIDO
   El escape no es un tono: es un tren de PULSOS de presion, uno por
   explosion. En un V8 de ciguenal en cruz cada bancada descarga a intervalos
   desiguales, y eso mete componentes a la frecuencia de giro del ciguenal y a
   sus primeros multiplos ("el burbujeo"). Por eso la onda base no se afina a
   la frecuencia de encendido sino a la de GIRO (rpm/60), con el 4o armonico
   (el encendido) como el mas fuerte y los inferiores presentes:
       760 rpm -> 12,7 Hz de giro, 51 Hz de encendido
       7500 rpm -> 125 Hz de giro, 500 Hz de encendido
   Los armonicos van en fase coseno: asi la onda sale picuda, como un pulso
   de escape, y no redonda como un tono.

   Despues: saturacion suave (la aspereza), filtro paso bajo que se abre con
   la carga pero no pasa de ~3 kHz, refuerzo de graves y resonadores fijos
   como los de un silenciador de competicion.

   PETARDEO ("tas tas tas")
   Al levantar el pie con el motor alto de vueltas entra combustible sin
   quemar en el escape caliente y explota a rafagas. Se sintetiza cada
   petardo como un golpe corto de ruido saturado mas un "pum" grave, y se
   programan rafagas con intervalos irregulares que se van espaciando.
   ========================================================================== */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Onda del ciguenal: fundamental = giro, encendido en el 4o armonico. */
function ondaCiguenal(ctx) {
  // Los multiplos altos (8 a 32) no son adorno: en ralenti caen entre 100 y
  // 400 Hz, que es lo unico que reproduce el altavoz de un telefono. Sin
  // ellos el motor en el movil sonaba mudo.
  const amp = {
    1: 0.30, 2: 0.60, 3: 0.26, 4: 1.0, 5: 0.18, 6: 0.40, 7: 0.14, 8: 0.66,
    9: 0.12, 10: 0.30, 11: 0.09, 12: 0.42, 13: 0.07, 14: 0.18, 15: 0.06, 16: 0.30,
    18: 0.12, 20: 0.16, 22: 0.06, 24: 0.12, 28: 0.07, 32: 0.08,
  };
  const n = 33;
  const real = new Float32Array(n), imag = new Float32Array(n);
  for (const h in amp) real[+h] = amp[h];
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

/** Curva de saturacion tipo valvula: redondea los picos y anade armonicos. */
function curvaSaturacion(k, n = 2048) {
  const c = new Float32Array(n);
  const t = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / t;
  }
  return c;
}

function noiseBuffer(ctx, seconds = 2) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;   // ruido marron: mas cuerpo
    d[i] = last * 3.2;
  }
  return b;
}

function ruidoBlanco(ctx, seconds = 0.25) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

export class EngineAudio {
  constructor({ maxRPM = 7500, idleRPM = 760 } = {}) {
    this.maxRPM = maxRPM;
    this.idleRPM = idleRPM;
    this.ctx = null;
    this.ready = false;
    this.enabled = true;

    // estado suavizado
    this.rpm = idleRPM;
    this.load = 0;
    this.slip = 0;
    this._lastGear = 1;
    this._lastThrottle = 0;
    this._petardeoHasta = 0;
    /** Reloj forzado (solo para renderizar offline); null = el del contexto. */
    this.reloj = null;
  }

  get ahora() { return this.reloj ?? this.ctx.currentTime; }

  /**
   * El navegador exige un gesto del usuario para arrancar el audio.
   * @param {BaseAudioContext} [ctxExterno] p.ej. un OfflineAudioContext para
   *        grabar una muestra del sonido.
   */
  async start(ctxExterno = null) {
    if (this.ctx) { if (this.ctx.state === 'suspended' && !ctxExterno) await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!ctxExterno && !AC) return;
    const ctx = this.ctx = ctxExterno ?? new AC();

    const master = this.master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);

    // limitador de seguridad: nada de picos que revienten los cascos
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -10; lim.knee.value = 8; lim.ratio.value = 10;
    lim.attack.value = 0.002; lim.release.value = 0.15;
    lim.connect(master);
    this.bus = lim;
    // Los petardos van por su propio canal, con un limitador que solo frena
    // los picos de verdad. Por el del motor salian aplastados contra el
    // ronquido y no se distinguian: tienen que ESTALLAR por encima.
    const limPetardos = ctx.createDynamicsCompressor();
    limPetardos.threshold.value = -3; limPetardos.knee.value = 2; limPetardos.ratio.value = 20;
    limPetardos.attack.value = 0.001; limPetardos.release.value = 0.08;
    this.busPetardos = ctx.createGain(); this.busPetardos.gain.value = 0.7;
    this.busPetardos.connect(limPetardos); limPetardos.connect(master);

    // ---------------------------------------------------------------- MOTOR
    this.osc = ctx.createOscillator();
    this.osc.setPeriodicWave(ondaCiguenal(ctx));
    this.osc.frequency.value = this.idleRPM / 60;

    // Vaiven minimo de regimen: un motor real nunca gira perfectamente fijo,
    // y un tono clavado delata al sintetizador.
    const vaiven = ctx.createOscillator();
    vaiven.frequency.value = 5.3;
    const gVaiven = ctx.createGain(); gVaiven.gain.value = 6;     // cents
    vaiven.connect(gVaiven); gVaiven.connect(this.osc.detune);
    vaiven.start();

    this.pre = ctx.createGain(); this.pre.gain.value = 0.8;
    const sat = ctx.createWaveShaper();
    sat.curve = curvaSaturacion(2.4);
    sat.oversample = '2x';

    this.tono = ctx.createBiquadFilter();
    this.tono.type = 'lowpass'; this.tono.frequency.value = 680; this.tono.Q.value = 0.7;

    // Cuerpo: graves arriba, el "honk" medio abajo, y dos resonadores fijos
    // de silenciador deportivo. Fijos: si siguieran al regimen sonaria a sinte.
    // Fuera lo subsonico: en ralenti los dos primeros multiplos caen en 13 y
    // 25 Hz, que nadie oye y que se comian el margen del limitador.
    const subsonico = ctx.createBiquadFilter();
    subsonico.type = 'highpass'; subsonico.frequency.value = 42; subsonico.Q.value = 0.7;
    const graves = ctx.createBiquadFilter();
    graves.type = 'peaking'; graves.frequency.value = 120; graves.gain.value = 4; graves.Q.value = 0.8;
    const res1 = ctx.createBiquadFilter();
    res1.type = 'peaking'; res1.frequency.value = 95; res1.gain.value = 5; res1.Q.value = 1.2;
    const res2 = ctx.createBiquadFilter();
    res2.type = 'peaking'; res2.frequency.value = 240; res2.gain.value = 3.5; res2.Q.value = 1.0;
    const sinHonk = ctx.createBiquadFilter();
    sinHonk.type = 'peaking'; sinHonk.frequency.value = 680; sinHonk.gain.value = -4; sinHonk.Q.value = 1.1;

    this.gMotor = ctx.createGain(); this.gMotor.gain.value = 0.5;
    this.engineOut = ctx.createGain(); this.engineOut.gain.value = 0.9;
    this.osc.connect(this.pre); this.pre.connect(sat); sat.connect(this.tono);
    this.tono.connect(subsonico); subsonico.connect(graves); graves.connect(res1); res1.connect(res2); res2.connect(sinHonk);
    sinHonk.connect(this.gMotor); this.gMotor.connect(this.engineOut); this.engineOut.connect(lim);
    this.osc.start();

    // ------------------------------------------------- ASPEREZA DEL ESCAPE
    // Ruido modulado a la frecuencia de encendido: el "rrrr" de un escape
    // libre a alta carga. Bajo y en banda media, nunca un siseo.
    this.noiseBuf = noiseBuffer(ctx);
    this.blanco = ruidoBlanco(ctx);
    const rasp = ctx.createBufferSource();
    rasp.buffer = this.noiseBuf; rasp.loop = true;
    this.raspBp = ctx.createBiquadFilter();
    this.raspBp.type = 'bandpass'; this.raspBp.frequency.value = 600; this.raspBp.Q.value = 1.0;
    this.gRasp = ctx.createGain(); this.gRasp.gain.value = 0;
    this.modRasp = ctx.createOscillator(); this.modRasp.type = 'square';
    this.modRasp.frequency.value = (this.idleRPM / 60) * 4;
    this.gModRasp = ctx.createGain(); this.gModRasp.gain.value = 0;
    this.modRasp.connect(this.gModRasp); this.gModRasp.connect(this.gRasp.gain);
    rasp.connect(this.raspBp); this.raspBp.connect(this.gRasp); this.gRasp.connect(this.engineOut);
    rasp.start(); this.modRasp.start();

    // ------------------------------------------------------------ NEUMATICOS
    this.tyre = ctx.createBufferSource();
    this.tyre.buffer = this.noiseBuf; this.tyre.loop = true;
    const tyreBp = ctx.createBiquadFilter();
    tyreBp.type = 'bandpass'; tyreBp.frequency.value = 1050; tyreBp.Q.value = 4.2;
    this.gTyre = ctx.createGain(); this.gTyre.gain.value = 0;
    this.tyre.connect(tyreBp); tyreBp.connect(this.gTyre); this.gTyre.connect(lim);
    this.tyre.start();

    // ------------------------------------------------------------ VIENTO
    // Paso bajo y discreto: antes era una banda en 620 Hz que se sumaba al
    // siseo general.
    this.wind = ctx.createBufferSource();
    this.wind.buffer = this.noiseBuf; this.wind.loop = true;
    const windLp = ctx.createBiquadFilter();
    windLp.type = 'lowpass'; windLp.frequency.value = 420; windLp.Q.value = 0.5;
    this.gWind = ctx.createGain(); this.gWind.gain.value = 0;
    this.wind.connect(windLp); windLp.connect(this.gWind); this.gWind.connect(lim);
    this.wind.start();

    // subida suave para no dar un golpe al arrancar
    master.gain.setTargetAtTime(this.enabled ? 0.9 : 0, this.ahora, 0.25);
    this.ready = true;
  }

  /**
   * @param {object} t telemetria: rpm, load, normalizedRPM, gearNum, throttle,
   *                   onLimiter, slipRear, speedKmh
   */
  update(t, dt) {
    if (!this.ready || !this.ctx) return;
    const now = this.ahora;
    const k = (target, cur, up, down) => {
      const rate = target > cur ? up : down;
      return cur + (target - cur) * (1 - Math.pow(1 - rate, dt * 60));
    };

    // Suavizado ASIMETRICO: subir de vueltas es inmediato, bajar tiene la
    // inercia del ciguenal. Empujar la telemetria cruda produce zipper noise.
    this.rpm = k(t.rpm, this.rpm, 0.55, 0.16);
    this.load = k(t.load ?? 0, this.load, 0.35, 0.12);
    this.slip = k(t.slipRear ?? 0, this.slip, 0.30, 0.06);

    const nrpm = clamp((this.rpm - this.idleRPM) / (this.maxRPM - this.idleRPM), 0, 1);
    const giro = this.rpm / 60;
    this.osc.frequency.setTargetAtTime(giro, now, 0.012);
    this.modRasp.frequency.setTargetAtTime(giro * 4, now, 0.012);

    // Con carga el escape ruge: mas saturacion, mas brillo (con tope) y mas
    // volumen. En retencion queda el burbujeo grave.
    this.pre.gain.setTargetAtTime(0.9 + this.load * 0.9 + nrpm * 0.25, now, 0.03);
    this.tono.frequency.setTargetAtTime(680 + nrpm * 1400 + this.load * 800, now, 0.04);
    // En retencion el motor baja a un murmullo: es cuando se oyen los petardos.
    this.gMotor.gain.setTargetAtTime(0.22 + this.load * 0.36 + nrpm * 0.08, now, 0.05);

    const aspereza = 0.014 + this.load * (0.02 + nrpm * 0.07);
    this.gRasp.gain.setTargetAtTime(aspereza, now, 0.05);
    this.gModRasp.gain.setTargetAtTime(aspereza * 0.9, now, 0.05);
    this.raspBp.frequency.setTargetAtTime(520 + nrpm * 900, now, 0.05);

    // ------------------------------------------------------------ PETARDEO
    const acel = t.throttle ?? 0;
    const levanto = this._lastThrottle > 0.5 && acel < 0.18;
    if (levanto && this.rpm > 3000) {
      this.petardeo(0.45 + nrpm * 0.9, 0.55 + nrpm * 0.45);
    }
    // Rodando en retencion con el motor alto: algun petardo suelto.
    const rodando = (t.speedKmh ?? 0) > 40;
    if (rodando && acel < 0.05 && this.rpm > 3600 && now > this._petardeoHasta
        && Math.random() < dt * 1.4) {
      this.#petardo(now + 0.01, 0.35 + Math.random() * 0.3);
    }
    this._lastThrottle = acel;

    // --------------------------------------------------------- CAMBIO DE MARCHA
    const marcha = t.gearNum ?? 1;
    if (marcha !== this._lastGear) {
      if (marcha > this._lastGear && this._lastGear > 0 && this.load > 0.3) this.shiftCut();
      this._lastGear = marcha;
    }

    // ------------------------------------------------------ RUEDA Y VIENTO
    this.gTyre.gain.setTargetAtTime(Math.pow(this.slip, 1.4) * 0.16, now, 0.05);
    const v = Math.max(0, (t.speedKmh ?? 0) - 40) / 220;
    this.gWind.gain.setTargetAtTime(clamp(v, 0, 1) * 0.07, now, 0.15);

    // Limitador: tartamudeo con petardos cortos.
    if (t.onLimiter && Math.random() < 0.3) this.#petardo(now + 0.005, 0.35);
  }

  /**
   * Rafaga de petardos: "tas tas tas" con intervalos irregulares que se van
   * espaciando y apagando, como el escape que se vacia.
   * @param {number} duracion segundos
   * @param {number} fuerza 0..1
   */
  petardeo(duracion = 0.8, fuerza = 0.8) {
    if (!this.ready) return;
    const t0 = this.ahora;
    let t = t0 + 0.03;
    const fin = t0 + duracion;
    while (t < fin) {
      const avance = (t - t0) / duracion;
      const f = fuerza * (1 - avance * 0.7) * (0.6 + Math.random() * 0.4);
      this.#petardo(t, f);
      // A veces doble: "ta-tas".
      if (Math.random() < 0.25) this.#petardo(t + 0.022 + Math.random() * 0.02, f * 0.7);
      t += 0.045 + Math.random() * 0.09 + avance * 0.12;
    }
    this._petardeoHasta = fin;
  }

  /** Un petardo: chasquido de ruido saturado y un "pum" grave debajo. */
  #petardo(cuando, fuerza) {
    const ctx = this.ctx;
    const f = clamp(fuerza, 0, 1);
    // Chasquido
    const s = ctx.createBufferSource(); s.buffer = this.blanco;
    s.playbackRate.value = 0.7 + Math.random() * 0.6;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 280 + Math.random() * 420; bp.Q.value = 0.8;
    const sat = ctx.createWaveShaper(); sat.curve = this._curvaDura ?? (this._curvaDura = curvaSaturacion(6));
    const g = ctx.createGain();
    const d = 0.045 + Math.random() * 0.035;
    g.gain.setValueAtTime(0.0001, cuando);
    g.gain.exponentialRampToValueAtTime(0.85 * f, cuando + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, cuando + d);
    s.connect(bp); bp.connect(sat); sat.connect(g); g.connect(this.busPetardos);
    s.start(cuando, Math.random() * 0.15); s.stop(cuando + d + 0.02);
    // Pum
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(95 + Math.random() * 30, cuando);
    o.frequency.exponentialRampToValueAtTime(42, cuando + 0.07);
    const go = ctx.createGain();
    go.gain.setValueAtTime(0.0001, cuando);
    go.gain.exponentialRampToValueAtTime(0.7 * f, cuando + 0.004);
    go.gain.exponentialRampToValueAtTime(0.0001, cuando + 0.09);
    o.connect(go); go.connect(this.busPetardos);
    o.start(cuando); o.stop(cuando + 0.1);
  }

  /** Corte de inyeccion del cambio: el motor calla un instante y petardea. */
  shiftCut() {
    if (!this.ready) return;
    const now = this.ahora;
    this.engineOut.gain.cancelScheduledValues(now);
    this.engineOut.gain.setValueAtTime(0.9, now);
    this.engineOut.gain.linearRampToValueAtTime(0.15, now + 0.012);
    this.engineOut.gain.setValueAtTime(0.15, now + 0.08);
    this.engineOut.gain.linearRampToValueAtTime(0.9, now + 0.15);
    this.#petardo(now + 0.02, 0.85);
    if (Math.random() < 0.6) this.#petardo(now + 0.07, 0.55);
  }

  /** Ruido filtrado con envolvente: sirve para golpes, pssh y chisporroteo. */
  #burst(freq, vol, dur, q = 2) {
    const ctx = this.ctx, now = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.5;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    s.connect(bp); bp.connect(g); g.connect(this.bus);
    s.start(now); s.stop(now + dur + 0.05);
  }

  /**
   * Paso de un vehiculo junto al coche: un soplo de aire que barre de un
   * oido al otro. Es la mitad de la sensacion de velocidad en un juego de
   * trafico; sin el, adelantar a 200 km/h suena igual que ir solo.
   * @param {number} lado +1 el vehiculo queda a la izquierda, -1 a la derecha
   * @param {number} fuerza 0..1 (mas cerca y mas rapido, mas fuerte)
   * @param {boolean} pesado los camiones mueven mas aire y suenan mas grave
   */
  paso(lado, fuerza, pesado = false) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const f = clamp(fuerza, 0, 1);
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.9 + Math.random() * 0.3;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.9;
    const f0 = pesado ? 260 : 520, f1 = pesado ? 900 : 1900;
    bp.frequency.setValueAtTime(f0, now);
    bp.frequency.exponentialRampToValueAtTime(f1, now + 0.12);
    bp.frequency.exponentialRampToValueAtTime(f0 * 0.7, now + 0.42);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.02 + 0.16 * f * (pesado ? 1.3 : 1), now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.46);
    let salida = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(-lado * 0.75, now);
      p.pan.linearRampToValueAtTime(-lado * 0.15, now + 0.4);
      g.connect(p); salida = p;
    }
    s.connect(bp); bp.connect(g); salida.connect(this.bus);
    s.start(now); s.stop(now + 0.5);
  }

  /** Campanazo corto del bono de rozon: sube de tono con el combo. */
  bono(combo = 1) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const base = 660 * Math.pow(1.12246, Math.min(combo, 6) - 1);
    for (const [mult, retardo] of [[1, 0], [1.5, 0.06]]) {
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.value = base * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + retardo);
      g.gain.exponentialRampToValueAtTime(0.07, now + retardo + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + retardo + 0.22);
      o.connect(g); g.connect(this.bus);
      o.start(now + retardo); o.stop(now + retardo + 0.25);
    }
  }

  /** Pitido de la cuenta atras. El ultimo, mas agudo y largo. */
  pitido(final = false) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.value = final ? 1320 : 660;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    const g = ctx.createGain();
    const d = final ? 0.42 : 0.16;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
    g.gain.setValueAtTime(0.06, now + d * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, now + d);
    o.connect(lp); lp.connect(g); g.connect(this.bus);
    o.start(now); o.stop(now + d + 0.05);
  }

  /**
   * Choque: golpe grave, crujido de chapa y cristales. El motor se ahoga.
   * @param {number} fuerza 0..1
   */
  choque(fuerza = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const f = clamp(fuerza, 0.25, 1);
    // Golpe sordo: seno que cae de tono.
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, now);
    o.frequency.exponentialRampToValueAtTime(38, now + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.55 * f, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    o.connect(g); g.connect(this.bus);
    o.start(now); o.stop(now + 0.65);
    // Chapa: ruido grave y largo; cristal: ruido agudo y corto.
    this.#burst(420, 0.45 * f, 0.55, 0.8);
    this.#burst(1400, 0.22 * f, 0.30, 1.2);
    this.#burst(5200, 0.10 * f, 0.18, 3.0);
    // El motor se cala.
    this.engineOut.gain.cancelScheduledValues(now);
    this.engineOut.gain.setTargetAtTime(0.18, now, 0.08);
  }

  /** Devuelve el motor a su volumen tras reiniciar. */
  reanudarMotor() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    this.engineOut.gain.cancelScheduledValues(now);
    this.engineOut.gain.setTargetAtTime(0.9, now, 0.15);
  }

  /** Pausa real del audio (pestana oculta, menu de pausa). */
  suspender() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  reanudar() { if (this.ctx && this.ctx.state === 'suspended' && this.enabled) this.ctx.resume(); }

  setEnabled(on) {
    this.enabled = on;
    if (this.ready) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.08);
  }
}
