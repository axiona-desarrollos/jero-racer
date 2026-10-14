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
      oSonido: $('#oSonido'), oVoz: $('#oVoz'), oDireccion: $('#oDireccion'), oCamara: $('#oCamara'),
      oCarro: $('#oCarro'), oPintura: $('#oPintura'), oLinea: $('#oLinea'),
      linea: $('#linea'), sApodo: $('#sApodo'), sCodigo: $('#sCodigo'),
      sEstado: $('#sEstado'), sLista: $('#sLista'), sAyuda: $('#sAyuda'),
      bEntrarSala: $('#bEntrarSala'),
      hSala: $('#hSala'), hSalaCod: $('#hSalaCod'), hSalaJ: $('#hSalaJ'),
      bSonido: $('#bSonido'),
      persecucion: $('#hPersecucion'), danio: $('#hDanio'), danioB: $('#hDanioB'),
      persSub: $('#hPersecucion small'),
      multas: $('#hMultas'), multasW: $('#hMultasW'), flash: $('#flash'),
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
    enlazar('#oVoz', 'voz');
    enlazar('#oDireccion', 'direccion');
    enlazar('#oCamara', 'camara');
    enlazar('#oCarro', 'carro');
    enlazar('#oPintura', 'pintura');
    enlazar('#oInstalar', 'instalar');
    enlazar('#oLinea', 'linea');
    enlazar('#bEntrarSala', 'entrarSala');
    enlazar('#bSalirSala', 'salirSala');
    enlazar('#bCodigoNuevo', 'codigoNuevo');
    enlazar('#bCompartirSala', 'invitar');
    enlazar('#bCerrarLinea', 'cerrarLinea');
    // El codigo se escribe siempre en mayusculas y sin signos.
    this.n.sCodigo?.addEventListener('input', () => {
      const i = this.n.sCodigo;
      i.value = i.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    });
  }

  // ----------------------------------------------------------- arranque
  progreso(texto, fraccion) {
    if (texto != null) this.n.bootMsg.textContent = texto;
    if (fraccion != null) this.n.bootBarra.style.width = `${Math.round(fraccion * 100)}%`;
  }
  ocultarCarga() { this.n.boot.hidden = true; }

  // ---------------------------------------------------------------- menu
  mostrarMenu({ recordPuntos, recordKm, movil, modoDireccion, sonido, voz, camara, carro, pintura, pintable, linea }) {
    this.n.menu.hidden = false;
    this.n.juego.hidden = true;
    this.n.mRecord.innerHTML = recordPuntos > 0
      ? `RÉCORD <b>${fmt(recordPuntos)}</b> PTS · <b>${recordKm.toFixed(2)}</b> KM`
      : 'Rompe tu primer récord';
    this.n.mAyuda.innerHTML = movil
      ? (modoDireccion === 'inclinar'
        ? '<b>Inclina el teléfono</b> como un timón para girar. <b>GAS</b> a la derecha, <b>FRENO</b> a la izquierda y <b>F. MANO</b> para derrapar. Pasa rozando los carros para sumar <b>combos</b>. Por encima de <b>170 km/h</b> te persigue la Policía. Ojo con las <b>fotomultas</b>: a 50 y 70 km/h ya te cogen.'
        : '<b>◀ ▶</b> para girar, <b>GAS</b> y <b>FRENO</b> a la derecha, <b>F. MANO</b> para derrapar. Pasa rozando los carros para sumar <b>combos</b>. Por encima de <b>170 km/h</b> te persigue la Policía. Ojo con las <b>fotomultas</b>.')
      : '<b>W / ↑</b> acelerar · <b>S / ↓</b> frenar · <b>A D / ← →</b> girar · <b>ESPACIO</b> freno de mano · <b>C</b> cámara · <b>ESC</b> pausa · <b>M</b> sonido. Pasa rozando los carros para sumar <b>combos</b>. Por encima de <b>170 km/h</b> te persigue la Policía; baja de 170 para que te dejen. Ojo con las <b>fotomultas</b>: a 50 y 70 km/h ya te cogen. También con control de consola.';
    this.n.oDireccion.hidden = !movil;
    this.opciones({ modoDireccion, sonido, voz, camara, carro, pintura, pintable, linea });
  }

  opciones({ modoDireccion, sonido, voz, camara, carro, pintura, pintable, linea }) {
    if (linea != null) this.n.oLinea.querySelector('span').textContent = linea;
    if (carro) this.n.oCarro.querySelector('span').textContent = carro;
    if (pintura) this.n.oPintura.querySelector('span').textContent = pintura;
    if (pintable != null) this.n.oPintura.hidden = !pintable;
    if (voz != null) this.n.oVoz.querySelector('span').textContent = voz ? 'SÍ' : 'NO';
    if (sonido != null) {
      this.n.oSonido.querySelector('span').textContent = sonido ? 'SÍ' : 'NO';
      this.n.bSonido.style.opacity = sonido ? '1' : '0.45';
    }
    if (modoDireccion) this.n.oDireccion.querySelector('span').textContent = modoDireccion === 'inclinar' ? 'INCLINAR' : 'BOTONES';
    if (camara) this.n.oCamara.querySelector('span').textContent = camara;
  }

  ocultarMenu() { this.n.menu.hidden = true; }

  // -------------------------------------------------------------- en línea
  mostrarLinea(si, { apodo, codigo, nube } = {}) {
    this.n.linea.hidden = !si;
    if (!si) return;
    if (apodo != null) this.n.sApodo.value = apodo;
    if (codigo != null) this.n.sCodigo.value = codigo;
    this.n.sAyuda.innerHTML = nube
      ? 'El código <b>es</b> la sala: quien lo escriba entra contigo. Dáselo por WhatsApp.'
      : 'Sin servidor configurado: por ahora la sala solo conecta <b>pestañas de este mismo navegador</b>. Abre otra pestaña con el mismo código para probar.';
  }

  /** @param {'fuera'|'entrando'|'dentro'|'error'} estado */
  salaEstado(estado, texto) {
    this.n.sEstado.textContent = texto ?? '';
    this.n.sEstado.classList.toggle('ok', estado === 'dentro');
    this.n.bEntrarSala.textContent = estado === 'dentro' ? 'SEGUIR JUGANDO' : estado === 'entrando' ? 'ENTRANDO…' : 'ENTRAR A LA SALA';
    this.n.bEntrarSala.disabled = estado === 'entrando';
  }

  /** Lista de la pantalla de sala. */
  salaLista(tabla) {
    const n = this.n.sLista;
    n.innerHTML = '';
    if (!tabla.length) { n.innerHTML = '<div class="vacio">Nadie más por ahora.</div>'; return; }
    for (const j of tabla) {
      const d = document.createElement('div');
      d.className = 'j';
      d.innerHTML = `<i style="background:#${(j.color ?? 0xffffff).toString(16).padStart(6, '0')}"></i>`;
      const s = document.createElement('span');
      s.textContent = j.apodo + (j.yo ? ' (tú)' : '');
      d.appendChild(s);
      n.appendChild(d);
    }
  }

  /** Marcador compacto de la sala durante la partida. */
  salaHud(codigo, tabla) {
    const n = this.n.hSala;
    if (!codigo) { n.hidden = true; return; }
    n.hidden = false;
    this.#texto('hSalaCod', codigo);
    const clave = tabla.map(j => `${j.apodo}:${j.puntos}`).join('|');
    if (clave === this._ultSala) return;
    this._ultSala = clave;
    const caja = this.n.hSalaJ;
    caja.innerHTML = '';
    for (const j of tabla.slice(0, 5)) {
      const d = document.createElement('div');
      d.className = 'j' + (j.yo ? ' yo' : '');
      d.innerHTML = `<i style="background:#${(j.color ?? 0xffffff).toString(16).padStart(6, '0')}"></i>`;
      const s = document.createElement('span');
      s.textContent = j.apodo;
      const b = document.createElement('b');
      b.textContent = fmt(j.puntos);
      d.append(s, b);
      caja.appendChild(d);
    }
  }

  get apodo() { return this.n.sApodo.value.trim(); }
  get codigo() { return this.n.sCodigo.value.trim(); }

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
    this.n.multasW.hidden = !(d.multas > 0);
    if (d.multas > 0) this.#texto('multas', String(d.multas));
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

  /**
   * Aviso flotante en el centro (rozon, record...).
   * @param {number} ms cuanto dura; los de frase larga necesitan mas para leerse
   */
  aviso(titulo, sub = '', clase = '', ms = 1200) {
    const a = document.createElement('div');
    a.className = 'aviso ' + clase;
    a.textContent = titulo;
    if (sub) { const s = document.createElement('small'); s.textContent = sub; a.appendChild(s); }
    if (ms !== 1200) a.style.animationDuration = `${(ms - 50) / 1000}s`;
    this.n.avisos.appendChild(a);
    while (this.n.avisos.children.length > 3) this.n.avisos.firstChild.remove();
    setTimeout(() => a.remove(), ms);
  }

  /** Fogonazo blanco de la fotomulta sobre toda la pantalla. */
  flash() {
    const el = this.n.flash;
    el.classList.remove('on');
    void el.offsetWidth;            // reinicia la animacion si ya estaba puesta
    el.classList.add('on');
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
    $('#fMultas').textContent = String(r.fotomultas ?? 0);
    $('#fRecord').innerHTML = `RÉCORD <b>${fmt(r.recordPuntos)}</b> PTS · <b>${r.recordKm.toFixed(2)}</b> KM`;
  }
  ocultarFin() { this.n.fin.hidden = true; }
}
