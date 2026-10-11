/* ==========================================================================
   JERO RACER · Publicidad de la flota
   --------------------------------------------------------------------------
   Rotulos de camiones, tractomulas y buses, dibujados en el atlas de
   calcomanias (modelado.js). Cada funcion recibe el contexto 2D y la region
   en pixeles donde pintar.

   Lo que mas ve el jugador de un camion es la PUERTA DE ATRAS: se maneja
   detras de ellos y se les adelanta. Por eso cada marca tiene rotulo lateral
   y rotulo trasero.

   Las letras chinas usan las fuentes CJK del sistema (PingFang en iPhone y
   Mac, Microsoft YaHei en Windows, Noto en Android).
   ========================================================================== */

const CJK = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC","Hiragino Sans GB","Heiti SC",sans-serif';
const TITULO = '"Russo One","Arial Black",Arial,sans-serif';
const TEXTO = 'Rajdhani,"Arial Narrow",Arial,sans-serif';

const caja = r => ({ x: r[0], y: r[1], w: r[2] - r[0], h: r[3] - r[1] });

/** Reduce el tamano de letra hasta que el texto quepa en `ancho`. */
function ajustar(g, texto, ancho, tam, familia, peso = 'bold') {
  let t = tam;
  do { g.font = `${peso} ${t}px ${familia}`; t -= 2; } while (g.measureText(texto).width > ancho && t > 8);
  return t + 2;
}

/** Nota musical al estilo de la marca de videos: cian y fucsia desplazados. */
function notaTikTok(g, x, y, tam) {
  g.save();
  g.font = `bold ${tam}px Arial, sans-serif`;
  g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillStyle = '#25f4ee'; g.fillText('♪', x - tam * 0.05, y - tam * 0.04);
  g.fillStyle = '#fe2c55'; g.fillText('♪', x + tam * 0.05, y + tam * 0.04);
  g.fillStyle = '#ffffff'; g.fillText('♪', x, y);
  g.restore();
}

/** Marca de Axiona: cuadro oscuro con una "A" de chevron neon. */
function logoAxiona(g, x, y, s) {
  g.save();
  g.fillStyle = '#0a0e14';
  const r = s * 0.18;
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + s - r, y); g.quadraticCurveTo(x + s, y, x + s, y + r);
  g.lineTo(x + s, y + s - r); g.quadraticCurveTo(x + s, y + s, x + s - r, y + s);
  g.lineTo(x + r, y + s); g.quadraticCurveTo(x, y + s, x, y + s - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.fill();
  g.strokeStyle = '#00f0c0'; g.lineWidth = s * 0.11; g.lineJoin = 'round'; g.lineCap = 'round';
  g.shadowColor = '#00f0c0'; g.shadowBlur = s * 0.12;
  g.beginPath();
  g.moveTo(x + s * 0.24, y + s * 0.78); g.lineTo(x + s * 0.5, y + s * 0.22); g.lineTo(x + s * 0.76, y + s * 0.78);
  g.moveTo(x + s * 0.36, y + s * 0.58); g.lineTo(x + s * 0.64, y + s * 0.58);
  g.stroke();
  g.restore();
}

// ---------------------------------------------------------------- axiona
export function lateralAxionasoft(g, r) {
  const p = caja(r);
  g.fillStyle = '#ffffff'; g.fillRect(p.x, p.y, p.w, p.h);
  // Barrido neon por debajo, de lado a lado.
  const grd = g.createLinearGradient(p.x, 0, p.x + p.w, 0);
  grd.addColorStop(0, '#00f0c0'); grd.addColorStop(0.55, '#00b3a4'); grd.addColorStop(1, '#0a0e14');
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(p.x, p.y + p.h * 0.80);
  g.bezierCurveTo(p.x + p.w * 0.4, p.y + p.h * 0.66, p.x + p.w * 0.7, p.y + p.h * 0.98, p.x + p.w, p.y + p.h * 0.72);
  g.lineTo(p.x + p.w, p.y + p.h); g.lineTo(p.x, p.y + p.h); g.closePath(); g.fill();
  const s = p.h * 0.56;
  logoAxiona(g, p.x + p.h * 0.12, p.y + p.h * 0.1, s);
  const x0 = p.x + p.h * 0.12 + s + p.h * 0.12;
  const ancho = p.x + p.w - x0 - p.h * 0.1;
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  const tam = ajustar(g, 'axionasoft.com', ancho, Math.round(p.h * 0.42), TITULO, '400');
  g.font = `400 ${tam}px ${TITULO}`;
  g.fillStyle = '#0a0e14';
  const w1 = g.measureText('axionasoft').width;
  g.fillText('axionasoft', x0, p.y + p.h * 0.48);
  g.fillStyle = '#00a88f';
  g.fillText('.com', x0 + w1, p.y + p.h * 0.48);
  g.fillStyle = '#2b3442';
  ajustar(g, 'SOFTWARE · INTELIGENCIA ARTIFICIAL · APPS · WEB', ancho, Math.round(p.h * 0.13), TEXTO, '700');
  g.fillText('SOFTWARE · INTELIGENCIA ARTIFICIAL · APPS · WEB', x0 + 4, p.y + p.h * 0.64);
}

export function mulaAxionasoft(g, r) {
  const p = caja(r);
  g.fillStyle = '#ffffff'; g.fillRect(p.x, p.y, p.w, p.h);
  const grd = g.createLinearGradient(p.x, 0, p.x + p.w, 0);
  grd.addColorStop(0, '#0a0e14'); grd.addColorStop(0.45, '#00b3a4'); grd.addColorStop(1, '#00f0c0');
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(p.x, p.y + p.h * 0.74);
  g.bezierCurveTo(p.x + p.w * 0.3, p.y + p.h * 0.94, p.x + p.w * 0.62, p.y + p.h * 0.6, p.x + p.w, p.y + p.h * 0.82);
  g.lineTo(p.x + p.w, p.y + p.h); g.lineTo(p.x, p.y + p.h); g.closePath(); g.fill();
  const s = p.h * 0.52;
  logoAxiona(g, p.x + p.h * 0.14, p.y + p.h * 0.1, s);
  const x0 = p.x + p.h * 0.14 + s + p.h * 0.14;
  const ancho = p.w * 0.62;
  const tam = ajustar(g, 'axionasoft.com', ancho, Math.round(p.h * 0.4), TITULO, '400');
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.font = `400 ${tam}px ${TITULO}`;
  g.fillStyle = '#0a0e14';
  const w1 = g.measureText('axionasoft').width;
  g.fillText('axionasoft', x0, p.y + p.h * 0.44);
  g.fillStyle = '#00a88f';
  g.fillText('.com', x0 + w1, p.y + p.h * 0.44);
  g.fillStyle = '#2b3442';
  ajustar(g, 'SOFTWARE QUE MUEVE A COLOMBIA', ancho, Math.round(p.h * 0.12), TEXTO, '700');
  g.fillText('SOFTWARE QUE MUEVE A COLOMBIA', x0 + 6, p.y + p.h * 0.6);
  // Columna derecha: servicios.
  g.textAlign = 'right';
  g.fillStyle = '#0a0e14';
  g.font = `700 ${Math.round(p.h * 0.085)}px ${TEXTO}`;
  ['APPS A LA MEDIDA', 'INTELIGENCIA ARTIFICIAL', 'PÁGINAS WEB'].forEach((l, i) => {
    g.fillText(l, p.x + p.w - p.h * 0.12, p.y + p.h * (0.2 + i * 0.12));
  });
}

export function traseraAxionasoft(g, r) {
  const p = caja(r);
  g.fillStyle = '#ffffff'; g.fillRect(p.x, p.y, p.w, p.h);
  g.fillStyle = '#0a0e14'; g.fillRect(p.x, p.y + p.h * 0.78, p.w, p.h * 0.22);
  logoAxiona(g, p.x + p.w / 2 - p.h * 0.2, p.y + p.h * 0.05, p.h * 0.4);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const tam = ajustar(g, 'axionasoft.com', p.w * 0.9, Math.round(p.h * 0.2), TITULO, '400');
  g.font = `400 ${tam}px ${TITULO}`;
  g.fillStyle = '#0a0e14';
  g.fillText('axionasoft.com', p.x + p.w / 2, p.y + p.h * 0.68);
  g.fillStyle = '#00f0c0';
  g.font = `700 ${Math.round(p.h * 0.11)}px ${TEXTO}`;
  g.fillText('¿NECESITA SOFTWARE? HABLEMOS', p.x + p.w / 2, p.y + p.h * 0.93);
}

// -------------------------------------------------------------- takamura
function fondoTakamura(g, p) {
  const grd = g.createLinearGradient(0, p.y, 0, p.y + p.h);
  grd.addColorStop(0, '#d61a26'); grd.addColorStop(1, '#a50f1a');
  g.fillStyle = grd; g.fillRect(p.x, p.y, p.w, p.h);
  g.strokeStyle = '#ffd23f'; g.lineWidth = Math.max(4, p.h * 0.025);
  g.strokeRect(p.x + p.h * 0.05, p.y + p.h * 0.05, p.w - p.h * 0.1, p.h - p.h * 0.1);
}

export function lateralTakamura(g, r) {
  const p = caja(r);
  fondoTakamura(g, p);
  // Caracteres chinos grandes en dorado con contorno oscuro.
  // El ancho de un caracter chino cambia mucho entre fuentes del sistema: se
  // ajusta para que nunca invada la columna de la derecha.
  g.textBaseline = 'middle'; g.textAlign = 'left';
  const tamCJK = ajustar(g, '高村物流', p.w * 0.5, Math.round(p.h * 0.62), CJK, '900');
  g.font = `900 ${tamCJK}px ${CJK}`;
  g.lineWidth = p.h * 0.03; g.strokeStyle = '#5a0006';
  g.strokeText('高村物流', p.x + p.h * 0.18, p.y + p.h * 0.5);
  g.fillStyle = '#ffd23f';
  g.fillText('高村物流', p.x + p.h * 0.18, p.y + p.h * 0.5);
  const xd = p.x + p.w * 0.6;
  notaTikTok(g, xd + p.h * 0.12, p.y + p.h * 0.33, Math.round(p.h * 0.3));
  g.textAlign = 'left';
  g.fillStyle = '#ffffff';
  ajustar(g, 'SÍGUENOS EN TIKTOK', p.x + p.w - xd - p.h * 0.42, Math.round(p.h * 0.14), TEXTO, '700');
  g.fillText('SÍGUENOS EN TIKTOK', xd + p.h * 0.3, p.y + p.h * 0.33);
  const tam = ajustar(g, '@TAKAMURA.0', p.x + p.w - xd - p.h * 0.12, Math.round(p.h * 0.26), TITULO, '400');
  g.font = `400 ${tam}px ${TITULO}`;
  g.fillStyle = '#ffffff';
  g.fillText('@TAKAMURA.0', xd, p.y + p.h * 0.66);
}

export function traseraTakamura(g, r) {
  const p = caja(r);
  fondoTakamura(g, p);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  ajustar(g, '高村', p.w * 0.6, Math.round(p.h * 0.36), CJK, '900');
  g.fillStyle = '#ffd23f';
  g.fillText('高村', p.x + p.w / 2, p.y + p.h * 0.32);
  notaTikTok(g, p.x + p.w * 0.14, p.y + p.h * 0.72, Math.round(p.h * 0.24));
  const tam = ajustar(g, '@TAKAMURA.0', p.w * 0.72, Math.round(p.h * 0.2), TITULO, '400');
  g.font = `400 ${tam}px ${TITULO}`;
  g.fillStyle = '#ffffff';
  g.fillText('@TAKAMURA.0', p.x + p.w * 0.56, p.y + p.h * 0.72);
}

// ------------------------------------------------------------------ jero
function fondoJero(g, p) {
  g.fillStyle = '#0b0b12'; g.fillRect(p.x, p.y, p.w, p.h);
  // Lineas de velocidad cian y fucsia.
  for (let i = 0; i < 9; i++) {
    const y = p.y + p.h * (0.12 + i * 0.1);
    const largo = p.w * (0.15 + ((i * 37) % 23) / 60);
    g.fillStyle = i % 2 ? 'rgba(37,244,238,0.22)' : 'rgba(254,44,85,0.22)';
    g.fillRect(p.x + p.w - largo, y, largo, Math.max(3, p.h * 0.018));
  }
}

export function lateralJero(g, r) {
  const p = caja(r);
  fondoJero(g, p);
  notaTikTok(g, p.x + p.h * 0.42, p.y + p.h * 0.5, Math.round(p.h * 0.62));
  const x0 = p.x + p.h * 0.85;
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = '#25f4ee';
  g.font = `700 ${Math.round(p.h * 0.15)}px ${TEXTO}`;
  g.fillText('¡SÍGUEME EN TIKTOK!', x0, p.y + p.h * 0.32);
  const tam = ajustar(g, '@jerofernandez222', p.x + p.w - x0 - p.h * 0.1, Math.round(p.h * 0.3), TITULO, '400');
  g.font = `400 ${tam}px ${TITULO}`;
  g.fillStyle = '#fe2c55'; g.fillText('@jerofernandez222', x0 + 3, p.y + p.h * 0.66 + 3);
  g.fillStyle = '#ffffff'; g.fillText('@jerofernandez222', x0, p.y + p.h * 0.66);
  g.fillStyle = '#9aa3b2';
  g.font = `700 ${Math.round(p.h * 0.1)}px ${TEXTO}`;
  g.fillText('JERO RACER · jeroracer.axionasoft.com', x0, p.y + p.h * 0.85);
}

export function mulaJero(g, r) {
  const p = caja(r);
  fondoJero(g, p);
  // Bandera de cuadros de carreras a la izquierda.
  const c = p.h * 0.1;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 10; j++) {
    g.fillStyle = (i + j) % 2 ? '#ffffff' : '#0b0b12';
    g.fillRect(p.x + p.h * 0.06 + i * c, p.y + j * c, c, c);
  }
  const x0 = p.x + p.h * 0.6;
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  let tam = ajustar(g, 'JERO RACER', p.w * 0.5, Math.round(p.h * 0.36), TITULO, '400');
  g.font = `400 ${tam}px ${TITULO}`;
  g.fillStyle = '#ffffff'; g.fillText('JERO', x0, p.y + p.h * 0.42);
  const wj = g.measureText('JERO ').width;
  g.fillStyle = '#00f0c0'; g.fillText('RACER', x0 + wj, p.y + p.h * 0.42);
  notaTikTok(g, x0 + p.h * 0.16, p.y + p.h * 0.7, Math.round(p.h * 0.32));
  tam = ajustar(g, '@jerofernandez222', p.w * 0.58, Math.round(p.h * 0.3), TITULO, '400');
  g.font = `400 ${tam}px ${TITULO}`;
  g.fillStyle = '#fe2c55'; g.fillText('@jerofernandez222', x0 + p.h * 0.4 + 4, p.y + p.h * 0.8 + 4);
  g.fillStyle = '#ffffff'; g.fillText('@jerofernandez222', x0 + p.h * 0.4, p.y + p.h * 0.8);
  g.textAlign = 'right';
  g.fillStyle = '#25f4ee';
  g.font = `700 ${Math.round(p.h * 0.17)}px ${TEXTO}`;
  g.fillText('¡SÍGUEME EN TIKTOK!', p.x + p.w - p.h * 0.15, p.y + p.h * 0.32);
  g.fillStyle = '#ffffff';
  g.font = `700 ${Math.round(p.h * 0.12)}px ${TEXTO}`;
  g.fillText('juega gratis: jeroracer.axionasoft.com', p.x + p.w - p.h * 0.15, p.y + p.h * 0.48);
}

export function traseraJero(g, r) {
  const p = caja(r);
  fondoJero(g, p);
  notaTikTok(g, p.x + p.w / 2, p.y + p.h * 0.3, Math.round(p.h * 0.4));
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillStyle = '#25f4ee';
  g.font = `700 ${Math.round(p.h * 0.11)}px ${TEXTO}`;
  g.fillText('SÍGUEME EN TIKTOK', p.x + p.w / 2, p.y + p.h * 0.62);
  const tam = ajustar(g, '@jerofernandez222', p.w * 0.92, Math.round(p.h * 0.18), TITULO, '400');
  g.font = `400 ${tam}px ${TITULO}`;
  g.fillStyle = '#ffffff';
  g.fillText('@jerofernandez222', p.x + p.w / 2, p.y + p.h * 0.84);
}

export function traseraRacer(g, r) {
  const p = caja(r);
  g.fillStyle = '#f2f2ee'; g.fillRect(p.x, p.y, p.w, p.h);
  g.fillStyle = '#0a0e14'; g.fillRect(p.x, p.y, p.w, p.h * 0.18);
  g.fillStyle = '#ffb21e';
  g.font = `700 ${Math.round(p.h * 0.12)}px ${TEXTO}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('¿CÓMO MANEJO?', p.x + p.w / 2, p.y + p.h * 0.09);
  g.fillStyle = '#0a0e14';
  const tam = ajustar(g, 'JERO RACER', p.w * 0.9, Math.round(p.h * 0.26), TITULO, '400');
  g.font = `400 ${tam}px ${TITULO}`;
  g.fillText('JERO RACER', p.x + p.w / 2, p.y + p.h * 0.45);
  g.fillStyle = '#00a88f';
  g.font = `700 ${Math.round(p.h * 0.12)}px ${TEXTO}`;
  g.fillText('jeroracer.axionasoft.com', p.x + p.w / 2, p.y + p.h * 0.7);
  g.fillStyle = '#d61a26';
  g.font = `700 ${Math.round(p.h * 0.1)}px ${TEXTO}`;
  g.fillText('VEHÍCULO LARGO · NO ADELANTE POR LA DERECHA', p.x + p.w / 2, p.y + p.h * 0.88);
}

/** Banda de anuncio en el costado del bus. */
export function busPublicidad(g, r) {
  const p = caja(r);
  fondoJero(g, p);
  notaTikTok(g, p.x + p.h * 0.45, p.y + p.h * 0.5, Math.round(p.h * 0.7));
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillStyle = '#25f4ee';
  g.font = `700 ${Math.round(p.h * 0.26)}px ${TEXTO}`;
  g.fillText('SÍGUEME', p.x + p.h * 0.9, p.y + p.h * 0.32);
  const x0 = p.x + p.h * 0.9;
  const tam = ajustar(g, '@jerofernandez222', p.x + p.w - x0 - p.h * 0.2, Math.round(p.h * 0.42), TITULO, '400');
  g.font = `400 ${tam}px ${TITULO}`;
  g.fillStyle = '#ffffff';
  g.fillText('@jerofernandez222', x0, p.y + p.h * 0.7);
}

// ----------------------------------------------------- persecucion
/** Franja de puertas de la Policia Nacional: verde, POLICIA y el 123. */
export function franjaPolicia(g, r) {
  const p = caja(r);
  g.fillStyle = '#00843d'; g.fillRect(p.x, p.y, p.w, p.h);
  g.fillStyle = '#ffffff';
  g.fillRect(p.x, p.y + p.h * 0.06, p.w, p.h * 0.06);
  g.fillRect(p.x, p.y + p.h * 0.88, p.w, p.h * 0.06);
  g.textBaseline = 'middle'; g.textAlign = 'left';
  g.font = `400 ${Math.round(p.h * 0.62)}px ${TITULO}`;
  g.fillText('POLICÍA', p.x + p.h * 0.6, p.y + p.h * 0.52);
  g.textAlign = 'right';
  g.font = `700 ${Math.round(p.h * 0.5)}px ${TEXTO}`;
  g.fillText('NACIONAL · 123', p.x + p.w - p.h * 0.6, p.y + p.h * 0.53);
}

/** Rotulo del Ejercito Nacional en verde oliva. */
export function franjaEjercito(g, r) {
  const p = caja(r);
  g.fillStyle = '#4a5130'; g.fillRect(p.x, p.y, p.w, p.h);
  g.fillStyle = '#f2e9c9';
  g.textBaseline = 'middle'; g.textAlign = 'center';
  g.font = `400 ${Math.round(p.h * 0.6)}px ${TITULO}`;
  g.fillText('EJÉRCITO NACIONAL', p.x + p.w / 2, p.y + p.h * 0.52);
}

/** Anuncio de Takamura para el costado del bus. */
export function busTakamura(g, r) {
  const p = caja(r);
  fondoTakamura(g, p);
  g.textBaseline = 'middle'; g.textAlign = 'left';
  const tamCJK = ajustar(g, '高村', p.w * 0.22, Math.round(p.h * 0.7), CJK, '900');
  g.font = `900 ${tamCJK}px ${CJK}`;
  g.fillStyle = '#ffd23f';
  g.fillText('高村', p.x + p.h * 0.25, p.y + p.h * 0.52);
  notaTikTok(g, p.x + p.w * 0.33, p.y + p.h * 0.5, Math.round(p.h * 0.55));
  const x0 = p.x + p.w * 0.4;
  g.fillStyle = '#ffffff';
  ajustar(g, 'SÍGUENOS EN TIKTOK', p.x + p.w - x0 - p.h * 0.2, Math.round(p.h * 0.22), TEXTO, '700');
  g.fillText('SÍGUENOS EN TIKTOK', x0, p.y + p.h * 0.3);
  const tam = ajustar(g, '@TAKAMURA.0', p.x + p.w - x0 - p.h * 0.2, Math.round(p.h * 0.42), TITULO, '400');
  g.font = `400 ${tam}px ${TITULO}`;
  g.fillText('@TAKAMURA.0', x0, p.y + p.h * 0.68);
}

/**
 * Pancarta larga para colgar en los puentes: las dos cuentas de TikTok.
 * Se dibuja en su propio canvas (no en el atlas): es muy alargada.
 */
export function pancartaPuente(g, r) {
  const p = caja(r);
  g.fillStyle = '#0b0b12'; g.fillRect(p.x, p.y, p.w, p.h);
  const mitad = p.x + p.w / 2;
  // Mitad roja de Takamura a la derecha.
  const grd = g.createLinearGradient(mitad, 0, p.x + p.w, 0);
  grd.addColorStop(0, '#a50f1a'); grd.addColorStop(1, '#d61a26');
  g.fillStyle = grd; g.fillRect(mitad, p.y, p.w / 2, p.h);
  g.textBaseline = 'middle'; g.textAlign = 'center';
  notaTikTok(g, p.x + p.h * 0.7, p.y + p.h * 0.5, Math.round(p.h * 0.8));
  let tam = ajustar(g, 'SÍGUEME EN TIKTOK @jerofernandez222', p.w * 0.42, Math.round(p.h * 0.6), TITULO, '400');
  g.font = `400 ${tam}px ${TITULO}`;
  g.fillStyle = '#ffffff';
  g.fillText('SÍGUEME EN TIKTOK @jerofernandez222', p.x + p.w * 0.27, p.y + p.h * 0.54);
  notaTikTok(g, mitad + p.h * 0.7, p.y + p.h * 0.5, Math.round(p.h * 0.8));
  tam = ajustar(g, '高村 · @TAKAMURA.0', p.w * 0.38, Math.round(p.h * 0.6), `${TITULO},${CJK}`, '400');
  g.font = `400 ${tam}px ${TITULO},${CJK}`;
  g.fillStyle = '#ffd23f';
  g.fillText('高村 · @TAKAMURA.0', mitad + p.w * 0.27, p.y + p.h * 0.54);
}
