/* ==========================================================================
   JERO RACER · Interfaz del jugador
   --------------------------------------------------------------------------
   Menu, cuenta atras, marcador, avisos de rozon, pausa y fin de partida.
   El panel de telemetria (hud.js) sigue existiendo para desarrollo, pero ya
   no es lo que ve el jugador: rpm, angulo de derrape y barras de
   deslizamiento son informacion de ingeniero, no de juego.

   El DOM es estatico (index.html) y aqui solo se reescriben textos cuando
   cambian, y como mucho 15 veces por segundo: tocar el DOM en cada
   fotograma a 144 Hz obliga al navegador a recalcular estilos sin motivo.
   ========================================================================== */

const $ = s => document.querySelector(s);
const fmt = n => Math.round(n).toLocaleString('es-CO');

export class Interfaz {
  constructor() {
    this.n = {
      boot: $('#boot'), bootMsg: $('#bootMsg'), bootBarra: $('#bootBarra'),
      juego: $('#juego'), menu: $('#menu'), pausa: $('#pausa'), fin: $('#fin'), cuenta: $('#cuenta'),
      puntos: $('#hPuntos'), km: $('#hKm'), record: $('#hRecord'), vel: $('#hVel'),
      rpm: $('#hRpm'), marcha: $('#hMarcha'), combo: $('#hCombo'), comboN: $('#hComboN'), comboT: $('#hComboT'),
      avisos: $('#avisos'), mRecord: $('#mRecord'), mAyuda: $('#mAyuda'),
      oSonido: $('#oSonido'), oDireccion: $('#oDireccion'), oCamara: $('#oCamara'),
      bSonido: $('#bSonido'),
      persecucion: $('#hPersecucion'), danio: $('#hDanio'), danioB: $('#hDanioB'),
      persSub: $('#hPersecucion small'),
    };
    this._ult = {};
    this._acc = 0;
    this.on = {};
    const enlazar = (sel, ev) => $(sel)?.addEventListener('click', (e) => { e.preventDefault(); this.on[ev]?.(e); });
    enlazar('#bJugar', 'jugar');
    enlazar('#bContinuar', 'continuar');
    enlazar('#bReiniciarP', 'reiniciar');
    enlazar('#bOtra', 'reiniciar');
    enlazar('#bMenuP', 'menu');
    enlazar('#bMenuF', 'menu');
    enlazar('#bCompartir', 'compartir');
    enlazar('#bPausa', 'pausa');
    enlazar('#bCamara', 'camara');
    enlazar('#bSonido', 'sonido');
    enlazar('#oSonido', 'sonido');
    enlazar('#oDireccion', 'direccion');
    enlazar('#oCamara', 'camara');
    enlazar('#oInstalar', 'instalar');
  }

  // ----------------------------------------------------------- arranque
  progreso(texto, fraccion) {
    if (texto != null) this.n.bootMsg.textContent = texto;
    if (fraccion != null) this.n.bootBarra.style.width = `${Math.round(fraccion * 100)}%`;
  }
  ocultarCarga() { this.n.boot.hidden = true; }

  // ---------------------------------------------------------------- menu
  mostrarMenu({ recordPuntos, recordKm, movil, modoDireccion, sonido, camara }) {
    this.n.menu.hidden = false;
    this.n.juego.hidden = true;
    this.n.mRecord.innerHTML = recordPuntos > 0
      ? `RÉCORD <b>${fmt(recordPuntos)}</b> PTS · <b>${recordKm.toFixed(2)}</b> KM`
      : 'Rompe tu primer récord';
    this.n.mAyuda.innerHTML = movil
      ? (modoDireccion === 'inclinar'
        ? '<b>Inclina el teléfono</b> como un timón para girar. <b>GAS</b> a la derecha, <b>FRENO</b> a la izquierda y <b>F. MANO</b> para derrapar. Pasa rozando los carros para sumar <b>combos</b>. Por encima de <b>170 km/h</b> te persigue la Policía.'
        : '<b>◀ ▶</b> para girar, <b>GAS</b> y <b>FRENO</b> a la derecha, <b>F. MANO</b> para derrapar. Pasa rozando los carros para sumar <b>combos</b>. Por encima de <b>170 km/h</b> te persigue la Policía.')
      : '<b>W / ↑</b> acelerar · <b>S / ↓</b> frenar · <b>A D / ← →</b> girar · <b>ESPACIO</b> freno de mano · <b>C</b> cámara · <b>ESC</b> pausa · <b>M</b> sonido. Pasa rozando los carros para sumar <b>combos</b>. Por encima de <b>170 km/h</b> te persigue la Policía; baja de 170 para que te dejen. También con control de consola.';
    this.n.oDireccion.hidden = !movil;
    this.opciones({ modoDireccion, sonido, camara });
  }

  opciones({ modoDireccion, sonido, camara }) {
    if (sonido != null) {
      this.n.oSonido.querySelector('span').textContent = sonido ? 'SÍ' : 'NO';
      this.n.bSonido.style.opacity = sonido ? '1' : '0.45';
    }
    if (modoDireccion) this.n.oDireccion.querySelector('span').textContent = modoDireccion === 'inclinar' ? 'INCLINAR' : 'BOTONES';
    if (camara) this.n.oCamara.querySelector('span').textContent = camara;
  }

  ocultarMenu() { this.n.menu.hidden = true; }

  // ------------------------------------------------------------- juego
  mostrarJuego(si) { this.n.juego.hidden = !si; }

  /** Cuenta atras: 3, 2, 1, YA. */
  cuenta(texto) {
    const c = this.n.cuenta;
    if (!texto) { c.hidden = true; c.textContent = ''; return; }
    c.hidden = false;
    c.innerHTML = '';
    const s = document.createElement('span');
    s.textContent = texto;
    if (texto === '¡YA!') s.className = 'ya';
    c.appendChild(s);
  }

  /**
   * @param {{puntos:number, km:number, record:number, vel:number, marcha:string,
   *          rpm01:number, combo:number, combo01:number}} d
   */
  actualizar(d, dt) {
    this._acc += dt;
    if (this._acc < 1 / 15) return;
    this._acc = 0;
    this.#texto('puntos', fmt(d.puntos));
    this.#texto('km', d.km.toFixed(2));
    this.#texto('record', fmt(d.record));
    this.#texto('vel', String(Math.round(d.vel)));
    this.#texto('marcha', d.marcha);
    this.n.rpm.style.width = `${Math.round(d.rpm01 * 100)}%`;
    this.n.persecucion.hidden = !d.persecucion;
    if (d.persecucion) {
      const dist = d.distanciaPatrulla;
      const txt = Number.isFinite(dist) ? (dist < 15 ? '¡LA TIENE ENCIMA!' : `PATRULLA A ${Math.round(dist)} m`) : 'baje de 170 km/h para que lo dejen';
      this.#texto('persSub', txt);
    }
    this.n.danio.hidden = !(d.danio > 0);
    if (d.danio > 0) {
      this.n.danioB.style.width = `${Math.round(d.danio)}%`;
      this.n.danio.classList.toggle('alto', d.danio >= 70);
    }
    const enCombo = d.combo > 1;
    this.n.combo.classList.toggle('on', enCombo);
    if (enCombo) {
      this.#texto('comboN', String(d.combo));
      this.n.comboT.style.transform = `scaleX(${d.combo01.toFixed(3)})`;
    }
  }

  #texto(clave, valor) {
    if (this._ult[clave] === valor) return;
    this._ult[clave] = valor;
    this.n[clave].textContent = valor;
  }

  /** Aviso flotante en el centro (rozon, record...). */
  aviso(titulo, sub = '', clase = '') {
    const a = document.createElement('div');
    a.className = 'aviso ' + clase;
    a.textContent = titulo;
    if (sub) { const s = document.createElement('small'); s.textContent = sub; a.appendChild(s); }
    this.n.avisos.appendChild(a);
    while (this.n.avisos.children.length > 3) this.n.avisos.firstChild.remove();
    setTimeout(() => a.remove(), 1200);
  }

  // ------------------------------------------------------------- pausa / fin
  mostrarPausa(si) { this.n.pausa.hidden = !si; }

  mostrarFin(r) {
    const f = this.n.fin;
    f.hidden = false;
    const detenido = r.motivo === 'detenido';
    f.classList.toggle('record', r.recordBatido && !detenido);
    f.classList.toggle('detenido', detenido);
    $('#fTitulo').textContent = detenido ? '¡TE DETUVIERON!' : r.recordBatido ? '¡NUEVO RÉCORD!' : 'CHOCASTE';
    $('#fDetalle').textContent = detenido
      ? `${r.frase} · ${r.contra.charAt(0).toUpperCase() + r.contra.slice(1)} lo detuvo`
      : `${r.frase} · Contra ${r.contra} a ${Math.round(r.velocidadChoque)} km/h`;
    $('#fPuntos').textContent = fmt(r.puntos);
    $('#fKm').textContent = r.km.toFixed(2);
    $('#fRozones').textContent = String(r.rozones);
    $('#fCombo').textContent = r.mejorCombo > 0 ? `x${r.mejorCombo}` : '—';
    $('#fVel').textContent = String(Math.round(r.velMax));
    $('#fRecord').innerHTML = `RÉCORD <b>${fmt(r.recordPuntos)}</b> PTS · <b>${r.recordKm.toFixed(2)}</b> KM`;
  }
  ocultarFin() { this.n.fin.hidden = true; }
}
