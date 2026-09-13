/* ==========================================================================
   HIGHWAY RACER · Marcador de distancia
   --------------------------------------------------------------------------
   Distancia, record y el cartel de choque. Va aparte del HUD de telemetria
   porque responde a otra pregunta: el HUD dice como va el coche, esto dice como
   va la PARTIDA, y son cosas que el jugador mira en momentos distintos.

   El DOM se construye una vez y despues solo se reescriben los nodos de texto
   cuyo valor ha cambiado. Tocar textContent en cada fotograma a 144 Hz obliga
   al navegador a recalcular estilo y es un coste real, no teorico.
   ========================================================================== */

import { ESTADO } from '../game/carrera.js';

const el = (tag, cls, padre) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (padre) padre.appendChild(e);
  return e;
};

export class Marcador {
  /** @param {HTMLElement} raiz */
  constructor(raiz) {
    this.raiz = raiz;
    raiz.textContent = '';
    raiz.className = 'marcador';

    const dist = el('div', 'dist', raiz);
    this.nKm = el('span', 'km', dist);
    el('i', null, dist).textContent = 'km';

    const rec = el('div', 'rec', raiz);
    el('span', null, rec).textContent = 'RÉCORD';
    this.nRecord = el('b', null, rec);

    this.nAviso = el('div', 'nuevo', raiz);

    this.cartel = el('div', 'cartel');
    this.cartel.hidden = true;
    document.body.appendChild(this.cartel);
    this.nCartelTitulo = el('div', 'titulo', this.cartel);
    this.nCartelDetalle = el('div', 'detalle', this.cartel);
    this.nCartelPie = el('div', 'pie', this.cartel);

    this._ultKm = null;
    this._ultRecord = null;
    this._ultEstado = null;
    this._ultAviso = null;
  }

  /** @param {import('../game/carrera.js').Carrera} carrera */
  actualizar(carrera) {
    const km = carrera.km.toFixed(2);
    if (km !== this._ultKm) { this.nKm.textContent = km; this._ultKm = km; }

    const rec = carrera.recordKm.toFixed(2) + ' km';
    if (rec !== this._ultRecord) { this.nRecord.textContent = rec; this._ultRecord = rec; }

    const aviso = carrera.recordBatido ? '¡RÉCORD NUEVO!' : '';
    if (aviso !== this._ultAviso) { this.nAviso.textContent = aviso; this._ultAviso = aviso; }

    if (carrera.estado !== this._ultEstado) {
      this._ultEstado = carrera.estado;
      const chocado = carrera.estado === ESTADO.CHOCADO;
      this.cartel.hidden = !chocado;
      if (chocado) {
        this.nCartelTitulo.textContent = carrera.recordBatido ? 'RÉCORD' : 'CHOCASTE';
        this.nCartelDetalle.textContent =
          `${(carrera.metrosAlChocar / 1000).toFixed(2)} km · contra un ${carrera.choqueCon} a ${Math.round(carrera.velocidadAlChocar)} km/h`;
        this.nCartelPie.textContent = 'R para volver a empezar';
      }
    }
  }
}
