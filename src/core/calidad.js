/* ==========================================================================
   JERO RACER · Calidad grafica segun el dispositivo
   --------------------------------------------------------------------------
   El mismo juego tiene que ir fluido en un PC con grafica dedicada y en un
   Android de gama media. No hay una sola configuracion que sirva a los dos:
   lo que en el PC da nitidez (sombras de 4096, densidad de pixel 2, laca en
   la pintura) en el movil se come el presupuesto de fotograma entero.

   Se decide en dos tiempos:
     1. Al arrancar, por el tipo de dispositivo (puntero tactil + pantalla
        pequena = movil). Rapido y sin medir nada.
     2. En marcha, la ESCALA DINAMICA mide los fotogramas reales y baja o
        sube la densidad de pixel. Es lo que salva a un movil lento sin
        castigar a uno rapido.

   ?calidad=alta|media|baja en la URL fuerza un nivel (pruebas).
   ========================================================================== */

export const NIVELES = Object.freeze({
  alta: {
    nombre: 'alta', pixelMax: 2, pixelMin: 1, sombraMapa: 4096, sombraSuave: true,
    pinturaLaca: true, firme: 2048, transmision: true, arbolesPorTramo: 46,
  },
  // En movil la densidad de pixel manda en la nitidez mas que cualquier otra
  // cosa: a 1x en una pantalla de 3x todo se ve pixelado. Se pide 2x y la
  // escala dinamica baja si el telefono no llega, pero nunca de 1x.
  media: {
    nombre: 'media', pixelMax: 2, pixelMin: 1, sombraMapa: 1024, sombraSuave: false,
    pinturaLaca: true, firme: 2048, transmision: false, arbolesPorTramo: 30,
  },
  baja: {
    nombre: 'baja', pixelMax: 1.5, pixelMin: 0.9, sombraMapa: 1024, sombraSuave: false,
    pinturaLaca: false, firme: 1024, transmision: false, arbolesPorTramo: 18,
  },
});

/** ¿Es un telefono o tableta? Puntero grueso es la senal mas fiable. */
export function esMovil() {
  if (typeof window === 'undefined') return false;
  const grueso = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const ua = navigator.userAgent || '';
  const movilUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
    // iPadOS se presenta como Mac; se delata por tener pantalla tactil.
    || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return grueso || movilUA;
}

export function esIOS() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Nivel inicial. */
export function elegirCalidad() {
  const forzado = new URLSearchParams(location.search).get('calidad');
  if (forzado && NIVELES[forzado]) return NIVELES[forzado];
  if (!esMovil()) return NIVELES.alta;
  // Safari no expone la memoria y en iPhone informa pocos nucleos aunque sea
  // un A16: con el criterio de Android caia en "baja" y se veia pixelado.
  if (esIOS()) return NIVELES.media;
  // Solo los Android de verdad modestos van a gama baja.
  const memoria = navigator.deviceMemory ?? 4;
  const nucleos = navigator.hardwareConcurrency ?? 4;
  if (memoria <= 2 || nucleos <= 2) return NIVELES.baja;
  return NIVELES.media;
}

/**
 * Ajusta la densidad de pixel segun el tiempo REAL de fotograma.
 *
 * Mide una media movil del dt y actua con histeresis: baja rapido si va mal
 * (un tiron se nota enseguida) y sube despacio si va sobrado (subir y bajar
 * cada medio segundo se veria como un parpadeo de nitidez).
 */
export class EscalaDinamica {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} maximo densidad de pixel tope
   * @param {(nueva:number)=>void} alCambiar
   */
  constructor(renderer, maximo, alCambiar, minimo = 1) {
    this.renderer = renderer;
    this.maximo = maximo;
    // Por debajo de 1x la imagen se deshace: mejor unos fotogramas menos.
    this.minimo = Math.min(minimo, maximo);
    this.actual = maximo;
    this.alCambiar = alCambiar;
    this.media = 1 / 60;
    this.espera = 2.0;          // segundos de gracia al arrancar (compilacion de shaders)
    this.desdeCambio = 0;
  }

  /** @param {number} dt segundos reales del ultimo fotograma */
  medir(dt) {
    if (!(dt > 0) || dt > 0.25) return;   // pestana oculta, pausas: no cuentan
    this.media += (dt - this.media) * 0.05;
    this.desdeCambio += dt;
    if (this.espera > 0) { this.espera -= dt; return; }
    if (this.desdeCambio < 1.2) return;

    const fps = 1 / this.media;
    let nueva = this.actual;
    if (fps < 38) nueva = Math.max(this.minimo, this.actual - 0.15);
    else if (fps > 55 && this.desdeCambio > 4) nueva = Math.min(this.maximo, this.actual + 0.1);
    if (Math.abs(nueva - this.actual) > 1e-3) {
      this.actual = +nueva.toFixed(2);
      this.desdeCambio = 0;
      this.alCambiar(this.actual);
    }
  }
}
