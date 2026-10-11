/* ==========================================================================
   HIGHWAY RACER · Audio del tren motriz
   --------------------------------------------------------------------------
   Todo sintetizado con Web Audio. Ni un archivo de sonido.

   COMO SUENA UN V8 DE VERDAD
   Un cuatro tiempos de 8 cilindros da 4 explosiones por vuelta de cigueñal:
       f0 = rpm / 60 * 4        (760 rpm -> 50,7 Hz · 7500 rpm -> 500 Hz)
   El caracter no esta en f0 sino en sus ARMONICOS. Por eso la fuente es una
   PeriodicWave con el reparto de armonicos de un V8 de cruz, no una sierra.

   RESONADORES
   Un resonador de escape es fisicamente un filtro de banda: deja pasar unas
   frecuencias y ahoga otras, SIN seguir al regimen. Por eso son tres peaking
   a frecuencia FIJA. Si se movieran con las rpm sonaria a sintetizador.

   CARGA, NO ACELERADOR
   El parametro que hace creible un motor es la CARGA, no la posicion del
   pedal: a 6000 rpm con el pie levantado hay vueltas altas y carga cero, y
   suena completamente distinto. Es el mismo 'Load' del C++.
   ========================================================================== */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Reparto de armonicos. El 2º y el 4º marcados dan el burbujeo del V8. */
function v8Wave(ctx) {
  const n = 24;
  const real = new Float32Array(n), imag = new Float32Array(n);
  const amp = [0, 1.0, 0.82, 0.45, 0.62, 0.28, 0.34, 0.18, 0.22,
    0.12, 0.15, 0.08, 0.10, 0.06, 0.07, 0.04, 0.05,
    0.03, 0.035, 0.02, 0.025, 0.015, 0.018, 0.01];
  for (let i = 1; i < n; i++) imag[i] = amp[i] ?? 0;
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
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

export class EngineAudio {
  constructor({ maxRPM = 7500, idleRPM = 760, cylinders = 8 } = {}) {
    this.maxRPM = maxRPM;
    this.idleRPM = idleRPM;
    this.firingPerRev = cylinders / 2;
    this.ctx = null;
    this.ready = false;
    this.enabled = true;

    // estado suavizado
    this.rpm = idleRPM;
    this.load = 0;
    this.boost = 0;
    this.slip = 0;
    this._lastGear = 1;
    this._lastThrottle = 0;
  }

  /** El navegador exige un gesto del usuario para arrancar el audio. */
  async start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    const master = this.master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);

    // limitador de seguridad: nada de picos que revienten los cascos
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -8; lim.knee.value = 6; lim.ratio.value = 12;
    lim.attack.value = 0.003; lim.release.value = 0.12;
    lim.connect(master);
    this.bus = lim;

    // ---------------------------------------------------------------- MOTOR
    const wave = v8Wave(ctx);
    this.osc = ctx.createOscillator();
    this.osc.setPeriodicWave(wave);
    this.osc.frequency.value = this.#firing(this.idleRPM);

    // Una octava por debajo, desafinada: da el grave de cruz del V8 y evita
    // que suene a un solo oscilador limpio.
    this.oscSub = ctx.createOscillator();
    this.oscSub.setPeriodicWave(wave);
    this.oscSub.frequency.value = this.#firing(this.idleRPM) * 0.5;
    this.oscSub.detune.value = 9;

    this.gOsc = ctx.createGain(); this.gOsc.gain.value = 0.55;
    this.gSub = ctx.createGain(); this.gSub.gain.value = 0.40;

    // Brillo por carga: a pleno gas se abre, en retencion se cierra.
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 700;
    this.tone.Q.value = 0.8;

    // --- RESONADORES DE ESCAPE: frecuencia FIJA, no siguen al regimen ------
    const resSpec = [[92, 7.5, 2.2], [225, 5.0, 1.6], [430, 3.5, 1.1]];
    this.res = resSpec.map(([f, g, q]) => {
      const b = ctx.createBiquadFilter();
      b.type = 'peaking'; b.frequency.value = f; b.gain.value = g; b.Q.value = q;
      return b;
    });

    this.osc.connect(this.gOsc); this.oscSub.connect(this.gSub);
    this.gOsc.connect(this.tone); this.gSub.connect(this.tone);
    let chain = this.tone;
    for (const r of this.res) { chain.connect(r); chain = r; }
    this.engineOut = ctx.createGain(); this.engineOut.gain.value = 0.85;
    chain.connect(this.engineOut); this.engineOut.connect(lim);

    this.osc.start(); this.oscSub.start();

    // ------------------------------------------------- ADMISION / TURBULENCIA
    this.noiseBuf = noiseBuffer(ctx);
    this.intake = ctx.createBufferSource();
    this.intake.buffer = this.noiseBuf; this.intake.loop = true;
    this.intakeBp = ctx.createBiquadFilter();
    this.intakeBp.type = 'bandpass'; this.intakeBp.frequency.value = 500; this.intakeBp.Q.value = 1.1;
    this.gIntake = ctx.createGain(); this.gIntake.gain.value = 0;
    this.intake.connect(this.intakeBp); this.intakeBp.connect(this.gIntake);
    this.gIntake.connect(lim);
    this.intake.start();

    // ------------------------------------------------------------ TURBO
    // Silbido de soplante: sube de tono y de volumen con la presion.
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.turbo.frequency.value = 1800;
    this.turboHarm = ctx.createOscillator();
    this.turboHarm.type = 'triangle';
    this.turboHarm.frequency.value = 3600;
    this.gTurbo = ctx.createGain(); this.gTurbo.gain.value = 0;
    this.gTurboH = ctx.createGain(); this.gTurboH.gain.value = 0;
    const turboHp = ctx.createBiquadFilter();
    turboHp.type = 'highpass'; turboHp.frequency.value = 900;
    this.turbo.connect(this.gTurbo); this.turboHarm.connect(this.gTurboH);
    this.gTurbo.connect(turboHp); this.gTurboH.connect(turboHp);
    turboHp.connect(lim);
    this.turbo.start(); this.turboHarm.start();

    // ------------------------------------------------------------ NEUMATICOS
    this.tyre = ctx.createBufferSource();
    this.tyre.buffer = this.noiseBuf; this.tyre.loop = true;
    const tyreBp = ctx.createBiquadFilter();
    tyreBp.type = 'bandpass'; tyreBp.frequency.value = 1150; tyreBp.Q.value = 4.2;
    this.gTyre = ctx.createGain(); this.gTyre.gain.value = 0;
    this.tyre.connect(tyreBp); tyreBp.connect(this.gTyre); this.gTyre.connect(lim);
    this.tyre.start();

    // ------------------------------------------------------------ VIENTO
    this.wind = ctx.createBufferSource();
    this.wind.buffer = this.noiseBuf; this.wind.loop = true;
    const windBp = ctx.createBiquadFilter();
    windBp.type = 'bandpass'; windBp.frequency.value = 620; windBp.Q.value = 0.7;
    this.gWind = ctx.createGain(); this.gWind.gain.value = 0;
    this.wind.connect(windBp); windBp.connect(this.gWind); this.gWind.connect(lim);
    this.wind.start();

    // subida suave para no dar un golpe al arrancar
    master.gain.setTargetAtTime(this.enabled ? 0.9 : 0, ctx.currentTime, 0.25);
    this.ready = true;
  }

  #firing(rpm) { return (rpm / 60) * this.firingPerRev; }

  /**
   * @param {object} t telemetria: rpm, load, normalizedRPM, gear, throttle,
   *                   rpmDeltaPerSec, onLimiter, slipRear, speedKmh, shifting
   */
  update(t, dt) {
    if (!this.ready || !this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const k = (target, cur, up, down) => {
      const rate = target > cur ? up : down;
      return cur + (target - cur) * (1 - Math.pow(1 - rate, dt * 60));
    };

    // Suavizado ASIMETRICO: subir de vueltas es inmediato, bajar tiene la
    // inercia del cigueñal. Empujar la telemetria cruda produce zipper noise.
    this.rpm = k(t.rpm, this.rpm, 0.55, 0.16);
    this.load = k(t.load ?? 0, this.load, 0.35, 0.12);
    this.slip = k(t.slipRear ?? 0, this.slip, 0.30, 0.06);

    const nrpm = clamp((this.rpm - this.idleRPM) / (this.maxRPM - this.idleRPM), 0, 1);
    const f0 = this.#firing(this.rpm);

    this.osc.frequency.setTargetAtTime(f0, now, 0.012);
    this.oscSub.frequency.setTargetAtTime(f0 * 0.5, now, 0.012);

    // Brillo: con carga se abre hasta 6,5 kHz; en retencion se cierra a 900 Hz.
    const cut = 700 + nrpm * 2600 + this.load * 3200;
    this.tone.frequency.setTargetAtTime(cut, now, 0.03);

    this.gOsc.gain.setTargetAtTime(0.30 + this.load * 0.34, now, 0.03);
    this.gSub.gain.setTargetAtTime(0.34 + this.load * 0.18, now, 0.03);

    // Admision: silba con las vueltas y con el gas abierto.
    this.intakeBp.frequency.setTargetAtTime(380 + nrpm * 1500, now, 0.04);
    this.gIntake.gain.setTargetAtTime(0.05 + this.load * nrpm * 0.20, now, 0.04);

    // ------------------------------------------------------------- TURBO
    // La soplante tarda en subir y baja deprisa al cerrar mariposa.
    const objetivoBoost = clamp(this.load * (0.25 + nrpm * 1.15), 0, 1);
    this.boost = k(objetivoBoost, this.boost, 0.045, 0.22);
    this.turbo.frequency.setTargetAtTime(1500 + this.boost * 5200 + nrpm * 900, now, 0.05);
    this.turboHarm.frequency.setTargetAtTime(3000 + this.boost * 9000, now, 0.05);
    this.gTurbo.gain.setTargetAtTime(this.boost * this.boost * 0.055, now, 0.05);
    this.gTurboH.gain.setTargetAtTime(this.boost * this.boost * 0.022, now, 0.05);

    // Valvula de descarga: al soltar gas con presion, el aire comprimido sale
    // de golpe. Es el "pssh" con silbido que hace un turbo de verdad.
    const soltoGas = this._lastThrottle > 0.45 && (t.throttle ?? 0) < 0.18;
    if (soltoGas && this.boost > 0.22) this.blowOff(this.boost);
    this._lastThrottle = t.throttle ?? 0;

    // --------------------------------------------------------- CORTE Y CAMBIO
    if (t.gear !== this._lastGear) {
      if (t.gear > this._lastGear && this.load > 0.3) this.shiftCut();
      this._lastGear = t.gear;
    }

    // ------------------------------------------------------ RUEDA Y VIENTO
    // Ataca rapido y suelta lento: asi el chirrido no parpadea al entrar y
    // salir del umbral.
    this.gTyre.gain.setTargetAtTime(Math.pow(this.slip, 1.4) * 0.22, now, 0.05);
    const v = Math.max(0, (t.speedKmh ?? 0) - 35) / 220;
    this.gWind.gain.setTargetAtTime(clamp(v, 0, 1) * 0.085, now, 0.12);

    // Limitador: chisporroteo seco contra el corte.
    if (t.onLimiter && Math.random() < 0.35) this.#burst(1600, 0.035, 0.05, 4);
  }

  /** Corte de inyeccion del cambio: el motor calla 90 ms y da un golpe seco. */
  shiftCut() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    this.engineOut.gain.cancelScheduledValues(now);
    this.engineOut.gain.setValueAtTime(0.85, now);
    this.engineOut.gain.linearRampToValueAtTime(0.12, now + 0.012);
    this.engineOut.gain.setValueAtTime(0.12, now + 0.085);
    this.engineOut.gain.linearRampToValueAtTime(0.85, now + 0.16);
    this.#burst(900, 0.09, 0.10, 2.2);     // golpe de escape
  }

  /** Valvula de descarga del turbo. */
  blowOff(fuerza = 1) {
    if (!this.ready) return;
    const f = clamp(fuerza, 0, 1);
    this.#burst(2400, 0.055 * f, 0.20 + 0.12 * f, 1.5);   // el "pssh"
    // …y el silbido de aire que se escapa, cayendo de tono
    const ctx = this.ctx, now = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(3800 + 2600 * f, now);
    o.frequency.exponentialRampToValueAtTime(900, now + 0.22 + 0.1 * f);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.05 * f, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.26 + 0.12 * f);
    o.connect(g); g.connect(this.bus);
    o.start(now); o.stop(now + 0.45);
    this.boost *= 0.15;
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
    this.engineOut.gain.setTargetAtTime(0.85, now, 0.15);
  }

  /** Pausa real del audio (pestana oculta, menu de pausa). */
  suspender() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  reanudar() { if (this.ctx && this.ctx.state === 'suspended' && this.enabled) this.ctx.resume(); }

  setEnabled(on) {
    this.enabled = on;
    if (this.ready) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.08);
  }
}
