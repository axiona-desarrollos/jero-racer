/* ==========================================================================
   JERO RACER · La flota
   --------------------------------------------------------------------------
   El parque automotor de una autopista antioquena: carros particulares,
   taxis amarillos, camionetas, buses intermunicipales, camiones de carga y
   tractomulas. Cada tipo es una funcion que modela la carroceria con el
   taller (modelado.js) y declara sus medidas, sus ruedas y su paleta.

   MEDIDAS REALES
   Las cotas salen de fichas tecnicas de vehiculos comunes en Colombia
   (largo, ancho, alto, batalla, rodado). No por fidelidad de catalogo: el
   jugador juzga los huecos por el TAMANO de lo que tiene delante, y un sedan
   de 5 m o una tractomula de 12 m le harian calcular mal cada adelantamiento.

   El origen de cada modelo esta en el suelo, en el centro de su planta, y el
   vehiculo mira a +Z con +X a su izquierda.
   ========================================================================== */

import * as THREE from 'three';
import {
  Constructor, M, conMat, REGION, uvDe, cuerpoLoft, habitaculoLoft,
  interpolar, matrizDe, fijarDetalle,
  panelEnSuperficie, pasoDeRueda,
} from './modelado.js';

const calca = (region, base = M.blanco) => conMat(base, { uv: uvDe(region) });
const LUZ_AMBAR = { c: 0xffa21a, r: 0.3, m: 0.0, l: 5 };
const LETRERO = (region) => ({ c: 0xffffff, r: 0.4, m: 0.0, l: 5, uv: uvDe(region) });

// ----------------------------------------------------------- utilidades
/** Ruedas de un eje: lista para el sistema de instancias. */
function eje(z, via, r, ancho, camion = false, gemela = 0) {
  const out = [];
  for (const s of [1, -1]) {
    out.push({ x: s * via, z, r, ancho, camion });
    if (gemela) out.push({ x: s * (via - gemela), z, r, ancho, camion });
  }
  return out;
}

/**
 * Faldon bajo de un vehiculo pesado: cajas entre los huecos de las ruedas.
 * Los pesados se modelan con la carroceria ALTA y este faldon debajo, porque
 * sin cortes booleanos es la unica forma de que se vean las ruedas.
 */
function faldon(c, zIni, zFin, huecos, x, y0, y1, mat, grosor = 0.06) {
  const cortes = [...huecos].sort((a, b) => a[0] - b[0]);
  let z = zIni;
  const tramos = [];
  for (const [a, b] of cortes) {
    if (a > z) tramos.push([z, a]);
    z = Math.max(z, b);
  }
  if (zFin > z) tramos.push([z, zFin]);
  for (const [a, b] of tramos) {
    for (const s of [1, -1]) c.caja(grosor, y1 - y0, b - a, s * x, (y0 + y1) / 2, (a + b) / 2, mat);
  }
}

// ---------------------------------------------------------- turismos
/**
 * Clasifica un triangulo del habitaculo: techo, parabrisas, luneta, ventanas
 * laterales con sus pilares, o pintura.
 */
function claseHabitaculo(def) {
  const v = def.ventana;
  // Donde empieza y acaba el techo: primera y ultima estacion a altura maxima.
  const yMax = Math.max(...def.cabina.map(e => e.yr));
  const enTecho = def.cabina.filter(e => e.yr > yMax - 0.025).map(e => e.z);
  const zTechoF = Math.max(...enTecho), zTechoR = Math.min(...enTecho);
  return (cx, cy, cz, nx) => {
    const e = interpolar(def.cabina, cz);
    const alto = e.yr - e.yc;
    const lateral = Math.abs(nx) > 0.45;
    // El parabrisas se decide por POSICION y no por la normal: uno inclinado
    // a 30 grados tiene la normal mas vertical que horizontal y pasaba por techo.
    if (!lateral && cz > zTechoF + 0.03) {
      return Math.abs(cx) < e.wr - (v.pilarA ?? 0.06) ? M.vidrio : (v.matPilarA ?? M.pintura);
    }
    if (!lateral && cz < zTechoR - 0.03) {
      if (v.lunetaMinY && cy < v.lunetaMinY) return M.pintura;
      if (v.lunetaPartida && Math.abs(cx) < 0.03) return M.pintura;
      return Math.abs(cx) < e.wr - (v.pilarC ?? 0.09) ? M.vidrio : M.pintura;
    }
    if (!lateral) return def.techo ?? M.pintura;
    {
      const yv = e.yc + Math.min(v.yInf, alto * 0.25);
      const yTop = e.yr - Math.min(v.margenTecho, alto * 0.3);
      if (cy > yv && cy < yTop && cz < v.zIni && cz > v.zFin) {
        for (const zb of v.pilaresB ?? []) if (Math.abs(cz - zb) < 0.05) return M.plastico;
        return M.vidrio;
      }
    }
    return M.pintura;
  };
}

/**
 * Turismo generico: carroceria baja + habitaculo + luces + detalles.
 * @param {object} def descripcion del modelo (ver los tipos de abajo)
 */
function turismo(def) {
  const c = new Constructor();
  // interpolar() recorre las estaciones de menor a mayor z.
  def.cabina = [...def.cabina].sort((a, b) => a.z - b.z);
  const est = def.cuerpo;
  const zF = est[est.length - 1].z, zR = est[0].z;

  // --- carroceria -------------------------------------------------------
  const [cuerpo, tapaR, tapaF] = cuerpoLoft(est, 44, 36);
  c.agregar(cuerpo, (cx, cy, cz, nx, ny) => {
    if (ny < -0.55) return M.plastico;
    if (def.revestimiento && cy < def.revestimiento && Math.abs(nx) > 0.3) return M.plastico;
    if (cy < (def.yZocalo ?? 0) && Math.abs(nx) > 0.45) return M.plastico;
    return M.pintura;
  });
  c.agregar(tapaR, M.pintura);
  c.agregar(tapaF, M.pintura);

  // --- habitaculo -------------------------------------------------------
  const v = def.ventana;
  const zsExtra = [v.zIni, v.zFin, ...(v.pilaresB ?? []).flatMap(z => [z - 0.05, z + 0.05])];
  const hab = habitaculoLoft(def.cabina, 30, { yInf: v.yInf, margenTecho: v.margenTecho, zsExtra });
  c.agregar(hab, claseHabitaculo(def));

  // --- ruedas y pasos ---------------------------------------------------
  const r = def.ruedas;
  const ruedas = [...eje(r.ejes[0], r.via, r.r, r.ancho), ...eje(r.ejes[1], r.via, r.r, r.ancho)];
  for (const z of r.ejes) {
    for (const s of [1, -1]) {
      const x = s * (r.via + r.ancho / 2 - 0.06);
      pasoDeRueda(c, x, z, r.r, def.matPaso ?? M.guardafango,
        { holgura: 0.014, ancho: def.anchoPaso ?? 0.06, fondo: 0.1 });
    }
  }

  // --- luces delanteras -------------------------------------------------
  const fl = def.faros;
  for (const s of [1, -1]) {
    panelEnSuperficie(c, est, 1, s * fl.x, fl.y, fl.w, fl.h, M.faro);
    // Marco oscuro del grupo optico, apenas mayor y detras del faro.
    panelEnSuperficie(c, est, 1, s * fl.x, fl.y, fl.w + 0.016, fl.h + 0.016, M.plasticoS, 0.04);
    panelEnSuperficie(c, est, 1, s * (fl.x + fl.w / 2 + 0.035), fl.y - 0.01, 0.07, fl.h * 0.6,
      s > 0 ? M.intIzq : M.intDer);
  }
  // Parrilla, placa y toma baja en el frontal.
  const parr = def.parrilla;
  c.panel(parr.w, parr.h, 0.05, 0.04, 0, parr.y, zF, M.plastico);
  if (parr.cromo) c.panel(parr.w, 0.022, 0.06, 0.01, 0, parr.y + parr.h / 2 - 0.01, zF + 0.005, M.cromo);
  c.cajaConCalca(0.33, 0.105, 0.025, 0, def.placaF, zF + 0.008, '+z', calca(REGION.placa), M.plastico);
  if (def.tomaBaja) c.panel(def.tomaBaja.w, def.tomaBaja.h, 0.05, 0.03, 0, def.tomaBaja.y, zF - 0.01, M.plastico);

  // --- luces traseras ---------------------------------------------------
  const pl = def.pilotos;
  for (const s of [1, -1]) {
    panelEnSuperficie(c, est, -1, s * pl.x, pl.y, pl.w, pl.h, M.piloto);
    panelEnSuperficie(c, est, -1, s * (pl.x + pl.w / 2 - 0.04), pl.y - pl.h / 2 - 0.03, 0.08, 0.045,
      s > 0 ? M.intIzq : M.intDer);
  }
  c.cajaConCalca(0.33, 0.11, 0.025, 0, def.placaR, zR - 0.008, '-z', calca(REGION.placa2), M.plastico);
  // Faldon trasero oscuro.
  c.panel(def.ancho * 0.72, 0.1, 0.05, 0.03, 0, def.faldonR ?? 0.42, zR + 0.01, M.plastico, [0, Math.PI, 0]);

  // --- espejos ----------------------------------------------------------
  // Espejos: se anclan al pie del habitaculo, que es donde van atornillados.
  const es = def.espejos;
  const ec = interpolar(def.cabina, es.z);
  for (const s of [1, -1]) {
    const xw = ec.wb;
    const y = ec.yc + 0.07;
    c.caja(0.09, 0.025, 0.05, s * (xw + 0.04), y, es.z, M.plastico);
    c.panel(0.15, 0.09, 0.075, 0.035, s * (xw + 0.12), y + 0.035, es.z - 0.02, M.pintura, [0, s * 0.18, 0]);
    c.panel(0.13, 0.075, 0.01, 0.03, s * (xw + 0.12), y + 0.035, es.z - 0.06, M.vidrio, [0, Math.PI + s * 0.18, 0]);
  }

  if (def.extras) def.extras(c, def);

  return { c, ruedas, largo: zF - zR, ancho: def.ancho, alto: def.alto };
}

// ------------------------------------------------------------- sedan
function sedan() {
  return turismo({
    ancho: 1.77, alto: 1.45,
    cuerpo: [
      { z: -2.24, w: 0.74, yb: 0.40, yt: 0.86, na: 3.0, nb: 2.6 },
      { z: -2.16, w: 0.83, yb: 0.33, yt: 0.95, na: 3.6, nb: 3.2 },
      { z: -1.95, w: 0.862, yb: 0.29, yt: 0.99, na: 4.5, nb: 3.8 },
      { z: -1.30, w: 0.872, yb: 0.27, yt: 0.99, na: 5.0, nb: 4.0 },
      { z: 0.30, w: 0.872, yb: 0.27, yt: 0.97, na: 5.0, nb: 4.0 },
      { z: 1.10, w: 0.866, yb: 0.28, yt: 0.89, na: 4.6, nb: 4.0 },
      { z: 1.85, w: 0.846, yb: 0.30, yt: 0.80, na: 4.0, nb: 3.6 },
      { z: 2.14, w: 0.79, yb: 0.33, yt: 0.73, na: 3.4, nb: 3.0 },
      { z: 2.24, w: 0.68, yb: 0.38, yt: 0.66, na: 2.8, nb: 2.6 },
    ],
    cabina: [
      { z: 1.04, yc: 0.83, yr: 0.85, wb: 0.79, wr: 0.74 },
      { z: 0.64, yc: 0.86, yr: 1.10, wb: 0.80, wr: 0.71 },
      { z: 0.24, yc: 0.88, yr: 1.36, wb: 0.80, wr: 0.68 },
      { z: 0.05, yc: 0.88, yr: 1.43, wb: 0.80, wr: 0.67 },
      { z: -0.82, yc: 0.88, yr: 1.43, wb: 0.80, wr: 0.66 },
      { z: -1.10, yc: 0.89, yr: 1.35, wb: 0.80, wr: 0.67 },
      { z: -1.50, yc: 0.90, yr: 1.10, wb: 0.79, wr: 0.70 },
      { z: -1.74, yc: 0.91, yr: 0.93, wb: 0.78, wr: 0.74 },
    ],
    ventana: { yInf: 0.045, margenTecho: 0.075, zIni: 1.04, zFin: -1.02, pilaresB: [-0.30] },
    ruedas: { r: 0.315, ancho: 0.21, via: 0.775, ejes: [1.36, -1.32] },
    faros: { x: 0.56, y: 0.69, w: 0.30, h: 0.095 },
    pilotos: { x: 0.60, y: 0.86, w: 0.32, h: 0.095 },
    parrilla: { w: 0.62, h: 0.12, y: 0.57, cromo: true },
    tomaBaja: { w: 0.9, h: 0.07, y: 0.405 },
    placaF: 0.475, placaR: 0.63, faldonR: 0.43,
    espejos: { z: 0.84, y: 0.98 },
    yZocalo: 0.31,
  });
}

// ---------------------------------------------------------- hatchback
function hatchback({ taxi = false } = {}) {
  return turismo({
    ancho: 1.70, alto: 1.50,
    cuerpo: [
      { z: -1.98, w: 0.74, yb: 0.38, yt: 0.95, na: 3.2, nb: 2.8 },
      { z: -1.91, w: 0.81, yb: 0.32, yt: 1.00, na: 3.8, nb: 3.4 },
      { z: -1.70, w: 0.835, yb: 0.29, yt: 1.01, na: 4.6, nb: 3.8 },
      { z: 0.20, w: 0.84, yb: 0.28, yt: 0.98, na: 5.0, nb: 4.0 },
      { z: 0.95, w: 0.835, yb: 0.29, yt: 0.90, na: 4.6, nb: 4.0 },
      { z: 1.62, w: 0.815, yb: 0.31, yt: 0.81, na: 4.0, nb: 3.6 },
      { z: 1.89, w: 0.76, yb: 0.34, yt: 0.74, na: 3.4, nb: 3.0 },
      { z: 1.98, w: 0.65, yb: 0.39, yt: 0.68, na: 2.8, nb: 2.6 },
    ],
    cabina: [
      { z: 0.93, yc: 0.85, yr: 0.87, wb: 0.77, wr: 0.72 },
      { z: 0.52, yc: 0.87, yr: 1.13, wb: 0.775, wr: 0.69 },
      { z: 0.13, yc: 0.89, yr: 1.40, wb: 0.775, wr: 0.66 },
      { z: -0.05, yc: 0.89, yr: 1.47, wb: 0.775, wr: 0.65 },
      { z: -1.42, yc: 0.91, yr: 1.46, wb: 0.775, wr: 0.64 },
      { z: -1.70, yc: 0.92, yr: 1.38, wb: 0.77, wr: 0.65 },
      { z: -1.86, yc: 0.93, yr: 1.10, wb: 0.765, wr: 0.68 },
      { z: -1.93, yc: 0.94, yr: 0.97, wb: 0.755, wr: 0.70 },
    ],
    ventana: { yInf: 0.045, margenTecho: 0.075, zIni: 0.93, zFin: -1.62, pilaresB: [-0.40], pilarC: 0.07 },
    ruedas: { r: 0.30, ancho: 0.195, via: 0.745, ejes: [1.24, -1.22] },
    faros: { x: 0.53, y: 0.71, w: 0.27, h: 0.10 },
    pilotos: { x: 0.64, y: 0.93, w: 0.14, h: 0.20 },
    parrilla: { w: 0.52, h: 0.10, y: 0.585, cromo: !taxi },
    tomaBaja: { w: 0.82, h: 0.07, y: 0.415 },
    placaF: 0.485, placaR: 0.66, faldonR: 0.44,
    espejos: { z: 0.74, y: 0.99 },
    yZocalo: 0.31,
    extras: (c) => {
      // Aleron de techo de los hatchback modernos.
      c.panel(1.08, 0.035, 0.16, 0.015, 0, 1.455, -1.66, M.pintura, [-0.12, 0, 0]);
      if (taxi) {
        // Copete de techo con TAXI iluminado por delante y por detras.
        c.cajaConCalca(0.56, 0.15, 0.17, 0, 1.545, -0.55, ['+z', '-z'], LETRERO(REGION.taxi),
          { c: 0xf6f4ea, r: 0.5, m: 0.0 });
        c.caja(0.6, 0.03, 0.2, 0, 1.465, -0.55, M.plastico);
      }
    },
  });
}

// --------------------------------------------------------------- SUV
function suv({ extras: masExtras = null, revestimiento = 0.60 } = {}) {
  return turismo({
    ancho: 1.86, alto: 1.75,
    cuerpo: [
      { z: -2.31, w: 0.80, yb: 0.50, yt: 1.02, na: 3.2, nb: 2.8 },
      { z: -2.24, w: 0.885, yb: 0.44, yt: 1.10, na: 4.0, nb: 3.4 },
      { z: -2.00, w: 0.915, yb: 0.40, yt: 1.13, na: 5.0, nb: 4.0 },
      { z: 0.30, w: 0.92, yb: 0.39, yt: 1.12, na: 5.4, nb: 4.2 },
      { z: 1.20, w: 0.915, yb: 0.40, yt: 1.06, na: 5.0, nb: 4.0 },
      { z: 2.00, w: 0.895, yb: 0.42, yt: 1.00, na: 4.4, nb: 3.6 },
      { z: 2.24, w: 0.84, yb: 0.46, yt: 0.94, na: 3.6, nb: 3.0 },
      { z: 2.31, w: 0.74, yb: 0.52, yt: 0.88, na: 3.0, nb: 2.6 },
    ],
    cabina: [
      { z: 1.14, yc: 0.99, yr: 1.01, wb: 0.85, wr: 0.80 },
      { z: 0.72, yc: 1.03, yr: 1.33, wb: 0.86, wr: 0.77 },
      { z: 0.32, yc: 1.05, yr: 1.67, wb: 0.86, wr: 0.75 },
      { z: 0.16, yc: 1.05, yr: 1.73, wb: 0.86, wr: 0.75 },
      { z: -1.98, yc: 1.07, yr: 1.72, wb: 0.86, wr: 0.75 },
      { z: -2.14, yc: 1.08, yr: 1.62, wb: 0.86, wr: 0.76 },
      { z: -2.24, yc: 1.09, yr: 1.15, wb: 0.85, wr: 0.78 },
    ],
    ventana: {
      yInf: 0.05, margenTecho: 0.08, zIni: 1.14, zFin: -1.95, pilaresB: [-0.22, -1.25],
      lunetaMinY: 1.30, pilarC: 0.1,
    },
    ruedas: { r: 0.36, ancho: 0.235, via: 0.80, ejes: [1.42, -1.40] },
    faros: { x: 0.58, y: 0.86, w: 0.32, h: 0.10 },
    pilotos: { x: 0.70, y: 1.02, w: 0.16, h: 0.18 },
    parrilla: { w: 0.78, h: 0.20, y: 0.72, cromo: true },
    tomaBaja: { w: 1.05, h: 0.09, y: 0.55 },
    placaF: 0.59, placaR: 0.74, faldonR: 0.55,
    espejos: { z: 0.88, y: 1.13 },
    revestimiento,
    matPaso: M.plastico, anchoPaso: 0.075,
    extras: (c) => {
      if (!masExtras) {
        for (const s of [1, -1]) {
          c.cilindroZ(0.018, 1.95, s * 0.60, 1.775, -0.92, M.aluminio, 8);
          for (const z of [0.0, -1.85]) c.caja(0.04, 0.05, 0.08, s * 0.60, 1.75, z, M.plastico);
        }
      }
      // Tercer stop sobre la luneta.
      c.panel(0.32, 0.035, 0.03, 0.01, 0, 1.69, -2.155, M.piloto, [0, Math.PI, 0]);
      masExtras?.(c);
    },
  });
}

// ------------------------------------------------------------ pickup
function pickup({ extras: masExtras = null } = {}) {
  return turismo({
    ancho: 1.86, alto: 1.82,
    cuerpo: [
      { z: -2.65, w: 0.84, yb: 0.54, yt: 1.03, na: 5.0, nb: 3.0 },
      { z: -2.59, w: 0.905, yb: 0.50, yt: 1.075, na: 7.0, nb: 4.0 },
      { z: -0.72, w: 0.92, yb: 0.48, yt: 1.085, na: 7.0, nb: 4.5 },
      { z: 0.40, w: 0.92, yb: 0.47, yt: 1.10, na: 5.4, nb: 4.2 },
      { z: 1.35, w: 0.915, yb: 0.48, yt: 1.06, na: 5.0, nb: 4.0 },
      { z: 2.30, w: 0.895, yb: 0.50, yt: 0.99, na: 4.4, nb: 3.6 },
      { z: 2.58, w: 0.84, yb: 0.54, yt: 0.93, na: 3.6, nb: 3.0 },
      { z: 2.65, w: 0.74, yb: 0.59, yt: 0.87, na: 3.0, nb: 2.6 },
    ],
    cabina: [
      { z: 1.30, yc: 0.99, yr: 1.01, wb: 0.85, wr: 0.80 },
      { z: 0.86, yc: 1.03, yr: 1.35, wb: 0.86, wr: 0.77 },
      { z: 0.46, yc: 1.05, yr: 1.75, wb: 0.86, wr: 0.75 },
      { z: 0.30, yc: 1.05, yr: 1.81, wb: 0.86, wr: 0.75 },
      { z: -0.62, yc: 1.05, yr: 1.80, wb: 0.86, wr: 0.75 },
      { z: -0.70, yc: 1.05, yr: 1.12, wb: 0.86, wr: 0.78 },
    ],
    ventana: {
      yInf: 0.05, margenTecho: 0.08, zIni: 1.30, zFin: -0.52, pilaresB: [-0.10],
      lunetaMinY: 1.40, pilarC: 0.22,
    },
    ruedas: { r: 0.375, ancho: 0.245, via: 0.80, ejes: [1.70, -1.62] },
    faros: { x: 0.60, y: 0.88, w: 0.30, h: 0.11 },
    pilotos: { x: 0.80, y: 0.88, w: 0.10, h: 0.26 },
    parrilla: { w: 0.86, h: 0.24, y: 0.73, cromo: true },
    tomaBaja: { w: 1.1, h: 0.1, y: 0.60 },
    placaF: 0.60, placaR: 0.72, faldonR: 0.58,
    espejos: { z: 1.04, y: 1.15 },
    revestimiento: 0.62,
    extras: (c) => {
      // Platon: fondo oscuro sobre la carroceria (parece hueco visto desde
      // la camara de persecucion) y pasamanos encima de las paredes.
      c.caja(1.66, 0.01, 1.78, 0, 1.084, -1.66, M.plastico);
      for (const s of [1, -1]) c.caja(0.07, 0.025, 1.92, s * 0.875, 1.09, -1.66, M.plasticoS);
      c.caja(1.74, 0.025, 0.07, 0, 1.09, -2.6, M.plasticoS);
      // Parachoques trasero de acero.
      c.caja(1.7, 0.13, 0.14, 0, 0.55, -2.68, M.acero);
      masExtras?.(c);
    },
  });
}

// --------------------------------------------------------------- van
function van() {
  return turismo({
    ancho: 1.98, alto: 2.45,
    cuerpo: [
      { z: -2.70, w: 0.92, yb: 0.44, yt: 1.05, na: 6, nb: 3 },
      { z: -2.62, w: 0.97, yb: 0.40, yt: 1.08, na: 8, nb: 4 },
      { z: 1.40, w: 0.98, yb: 0.40, yt: 1.08, na: 8, nb: 4 },
      { z: 2.20, w: 0.96, yb: 0.42, yt: 0.98, na: 5, nb: 3.8 },
      { z: 2.62, w: 0.90, yb: 0.46, yt: 0.90, na: 3.6, nb: 3.0 },
      { z: 2.70, w: 0.80, yb: 0.50, yt: 0.84, na: 3.0, nb: 2.6 },
    ],
    cabina: [
      { z: 2.12, yc: 0.94, yr: 0.97, wb: 0.94, wr: 0.90 },
      { z: 1.56, yc: 1.03, yr: 1.62, wb: 0.95, wr: 0.90 },
      { z: 1.16, yc: 1.04, yr: 2.30, wb: 0.96, wr: 0.92 },
      { z: 0.96, yc: 1.04, yr: 2.43, wb: 0.96, wr: 0.92 },
      { z: -2.55, yc: 1.05, yr: 2.43, wb: 0.96, wr: 0.92 },
      { z: -2.65, yc: 1.05, yr: 2.36, wb: 0.96, wr: 0.93 },
      { z: -2.69, yc: 1.05, yr: 1.10, wb: 0.96, wr: 0.94 },
    ],
    ventana: {
      yInf: 0.06, margenTecho: 0.75, zIni: 2.12, zFin: 0.95, pilaresB: [],
      lunetaMinY: 1.62, lunetaPartida: true, pilarC: 0.12,
    },
    ruedas: { r: 0.34, ancho: 0.225, via: 0.865, ejes: [1.82, -1.72] },
    faros: { x: 0.63, y: 0.86, w: 0.30, h: 0.12 },
    pilotos: { x: 0.86, y: 1.05, w: 0.08, h: 0.36 },
    parrilla: { w: 0.9, h: 0.2, y: 0.70, cromo: false },
    tomaBaja: { w: 1.2, h: 0.1, y: 0.56 },
    placaF: 0.58, placaR: 0.62, faldonR: 0.52,
    espejos: { z: 1.6, y: 1.32 },
    yZocalo: 0.50,
    extras: (c) => {
      // Riel de la puerta corrediza: delata una van a primera vista.
      c.caja(0.02, 0.03, 1.6, -0.985, 1.95, -0.9, M.plastico);
      c.caja(0.02, 0.025, 1.6, -0.988, 1.04, -0.9, M.plastico);
    },
  });
}

// --------------------------------------------------------------- bus
/** @param {{anuncio?:number[], largoAnuncio?:number}} o anuncio del costado trasero */
function bus({ anuncio = REGION.pubBus, largoAnuncio = 5.0 } = {}) {
  const c = new Constructor();
  const L = 12.0, W = 1.27;
  const zF = L / 2, zR = -L / 2;
  const yBajo = 1.0;                    // borde inferior de la carroceria alta
  const ejeD = 4.05, ejeT = -2.9, r = 0.52;

  const est = [
    { z: zR, w: W - 0.06, yb: yBajo, yt: 3.32, na: 8, nb: 10 },
    { z: zR + 0.08, w: W - 0.01, yb: yBajo, yt: 3.39, na: 10, nb: 12 },
    { z: zF - 0.20, w: W, yb: yBajo, yt: 3.42, na: 10, nb: 12 },
    { z: zF - 0.06, w: W - 0.03, yb: yBajo, yt: 3.36, na: 9, nb: 10 },
    { z: zF, w: W - 0.08, yb: yBajo, yt: 3.24, na: 7, nb: 8 },
  ];
  // Ventanas: banda lateral con parales cada 1,45 m.
  const vIni = 4.55, vFin = -5.35, paso = 1.45, ancho = 0.11;
  const cortes = [];
  for (let z = vIni; z > vFin; z -= paso) cortes.push(z, z - ancho);
  const [cuerpo, tR, tF] = cuerpoLoft(est, 24, 48);
  c.agregar(cuerpo, (cx, cy, cz, nx, ny) => {
    if (ny < -0.55) return M.plastico;
    if (ny > 0.8) return M.blanco;
    return M.pintura;
  });
  // Ventanas: una banda de vidrio por fuera de la carroceria y los parales
  // encima. Por clasificacion de triangulos salian en diente de sierra.
  for (const s of [1, -1]) {
    c.caja(0.012, 1.06, vIni - vFin, s * (W + 0.004), 2.48, (vIni + vFin) / 2, M.vidrio);
    for (const z of cortes.filter((_, i) => i % 2 === 0)) {
      c.caja(0.016, 1.08, ancho, s * (W + 0.006), 2.48, z - ancho / 2, M.plasticoS);
    }
    c.caja(0.016, 0.05, vIni - vFin + 0.1, s * (W + 0.006), 3.03, (vIni + vFin) / 2, M.plasticoS);
  }
  c.agregar(tR, M.pintura);
  c.agregar(tF, M.pintura);

  // Faldon bajo con los huecos de las ruedas, y el fondo oscuro del hueco.
  const huecos = [[ejeD - r - 0.12, ejeD + r + 0.12], [ejeT - r - 0.12, ejeT + r + 0.12]];
  faldon(c, zR + 0.06, zF - 0.06, huecos, W - 0.03, 0.42, yBajo + 0.02, M.pintura);
  c.caja(2.2, 0.62, L - 0.2, 0, 0.71, 0, M.guardafango);
  for (const z of [ejeD, ejeT]) for (const s of [1, -1]) {
    pasoDeRueda(c, s * (W - 0.015), z, r, M.plastico, { holgura: 0.06, ancho: 0.07, fondo: 0.05 });
  }

  // Franjas de la flota en la mitad delantera y anuncio en la trasera, como
  // los buses intermunicipales que llevan publicidad pintada.
  for (const s of [1, -1]) {
    c.cajaConCalca(0.01, 0.78, 5.4, s * (W + 0.004), 1.42, 2.6, s > 0 ? '+x' : '-x',
      calca(REGION.franjasBus), M.pintura);
    c.cajaConCalca(0.012, 0.8, largoAnuncio, s * (W + 0.005), 1.42, -2.95, s > 0 ? '+x' : '-x',
      calca(anuncio), M.plastico);
  }

  // Frontal: parabrisas grande algo inclinado, letrero de destino, luces.
  c.panel(2.34, 1.42, 0.04, 0.12, 0, 2.38, zF + 0.012, M.vidrio, [-0.06, 0, 0]);
  c.cajaConCalca(1.7, 0.24, 0.04, 0, 3.17, zF - 0.01, '+z', LETRERO(REGION.destino), M.plastico);
  c.panel(2.42, 0.32, 0.12, 0.06, 0, 0.62, zF + 0.04, M.plastico);
  c.cajaConCalca(0.33, 0.105, 0.025, 0, 0.66, zF + 0.11, '+z', calca(REGION.placa), M.plastico);
  for (const s of [1, -1]) {
    c.panel(0.38, 0.16, 0.05, 0.05, s * 0.86, 1.0, zF + 0.01, M.faro);
    c.panel(0.1, 0.1, 0.05, 0.03, s * 1.14, 1.0, zF + 0.005, s > 0 ? M.intIzq : M.intDer);
    // Espejos de "orejas de conejo".
    c.caja(0.05, 0.05, 0.62, s * 1.12, 3.0, zF + 0.28, M.plastico, [0, s * 0.35, 0]);
    c.panel(0.16, 0.36, 0.06, 0.04, s * 1.26, 2.72, zF + 0.52, M.plastico);
  }
  // Puerta delantera derecha (lado −X) acristalada.
  c.caja(0.012, 2.1, 1.0, -(W + 0.006), 2.0, zF - 0.9, M.vidrio);
  c.caja(0.014, 0.05, 1.04, -(W + 0.008), 2.0, zF - 0.9, M.plastico);

  // Trasera: rejilla del motor, pilotos verticales, luneta, placa.
  c.panel(1.6, 0.5, 0.05, 0.04, 0, 1.3, zR - 0.01, M.plastico, [0, Math.PI, 0]);
  c.panel(1.9, 0.75, 0.04, 0.1, 0, 2.62, zR - 0.012, M.vidrio, [0, Math.PI, 0]);
  c.cajaConCalca(0.33, 0.11, 0.025, 0, 0.78, zR - 0.02, '-z', calca(REGION.placa2), M.plastico);
  for (const s of [1, -1]) {
    c.panel(0.16, 0.5, 0.05, 0.05, s * 1.08, 1.3, zR - 0.01, M.piloto, [0, Math.PI, 0]);
    c.panel(0.16, 0.14, 0.05, 0.04, s * 1.08, 0.9, zR - 0.01, s > 0 ? M.intIzq : M.intDer, [0, Math.PI, 0]);
  }
  c.panel(2.44, 0.3, 0.12, 0.06, 0, 0.6, zR - 0.04, M.plastico, [0, Math.PI, 0]);
  // Aire acondicionado en el techo.
  c.panel(1.7, 2.6, 0.18, 0.25, 0, 3.47, 1.4, M.blanco, [-Math.PI / 2, 0, 0]);
  // Luces de galibo ambar arriba del parabrisas.
  for (let i = -2; i <= 2; i++) c.caja(0.08, 0.04, 0.04, i * 0.3, 3.36, zF - 0.02, LUZ_AMBAR);

  const ruedas = [...eje(ejeD, 1.03, r, 0.29, true), ...eje(ejeT, 1.03, r, 0.27, true, 0.30)];
  return { c, ruedas, largo: L, ancho: 2 * W, alto: 3.45 };
}

// ---------------------------------------------------- camion de carga
/**
 * @param {{lateral?:number[], trasera?:number[]}} o regiones del atlas con la
 *        publicidad del costado y de la puerta de atras
 */
function camion({ lateral = REGION.pubAxionasoft, trasera = REGION.trasAxionasoft } = {}) {
  const c = new Constructor();
  const L = 8.3;
  const zF = L / 2, zR = -L / 2;
  const r = 0.45, ejeD = zF - 1.05, ejeT = zR + 2.55;

  // Cabina adelantada (cab-over), estilo NPR/NKR.
  const zC0 = zF - 1.75;
  const est = [
    { z: zC0, w: 0.98, yb: 0.92, yt: 2.62, na: 7, nb: 6 },
    { z: zF - 0.30, w: 1.0, yb: 0.92, yt: 2.66, na: 7, nb: 6 },
    { z: zF - 0.08, w: 0.97, yb: 0.92, yt: 2.56, na: 5, nb: 5 },
    { z: zF, w: 0.90, yb: 0.95, yt: 2.42, na: 4, nb: 4 },
  ];
  const [cab, cR, cF] = cuerpoLoft(est, 14, 40);
  c.agregar(cab, (cx, cy, cz, nx, ny) => {
    if (ny < -0.5) return M.plastico;
    if (Math.abs(nx) > 0.6 && cy > 1.75 && cy < 2.45 && cz > zF - 1.15 && cz < zF - 0.28) return M.vidrio;
    return M.pintura;
  });
  c.agregar(cR, M.plastico);
  c.agregar(cF, M.pintura);
  c.panel(1.86, 0.78, 0.04, 0.08, 0, 2.06, zF + 0.012, M.vidrio, [-0.1, 0, 0]);
  c.panel(1.5, 0.28, 0.05, 0.04, 0, 1.32, zF + 0.01, M.plastico);
  c.cajaConCalca(0.33, 0.105, 0.025, 0, 0.68, zF + 0.1, '+z', calca(REGION.placa), M.plastico);
  c.panel(2.0, 0.26, 0.14, 0.05, 0, 0.72, zF + 0.04, M.plasticoS);
  for (const s of [1, -1]) {
    c.panel(0.34, 0.15, 0.05, 0.04, s * 0.7, 1.05, zF + 0.01, M.faro);
    c.panel(0.12, 0.12, 0.05, 0.03, s * 0.95, 1.05, zF + 0.0, s > 0 ? M.intIzq : M.intDer);
    c.caja(0.04, 0.04, 0.5, s * 1.1, 2.2, zF - 0.4, M.plastico, [0, s * 0.4, 0]);
    c.panel(0.14, 0.34, 0.06, 0.03, s * 1.2, 2.05, zF - 0.2, M.plastico);
    // Escalon de acceso a la cabina.
    c.caja(0.24, 0.05, 0.4, s * 0.92, 0.62, zF - 0.85, M.aluminio);
  }
  // Pasos de rueda delanteros (guardabarros negros).
  for (const s of [1, -1]) pasoDeRueda(c, s * 0.99, ejeD, r, M.plastico, { holgura: 0.04, ancho: 0.09, fondo: 0.24 });

  // Chasis.
  for (const s of [1, -1]) c.caja(0.16, 0.24, L - 0.6, s * 0.45, 0.78, -0.1, M.plastico);

  // Furgon de carga.
  const fz0 = zR + 0.02, fz1 = zC0 - 0.12, fw = 2.44, fy0 = 1.06, fy1 = 3.46;
  const fl = fz1 - fz0, fzc = (fz0 + fz1) / 2;
  c.caja(fw, fy1 - fy0, fl, 0, (fy0 + fy1) / 2, fzc, M.pintura2);
  for (const s of [1, -1]) {
    // Rotulo a 4:1 como su region del atlas: estirado se leeria deformado.
    const alto = 1.62, largo = Math.min(fl - 0.4, alto * 4);
    c.cajaConCalca(0.012, alto, largo, s * (fw / 2 + 0.006), 2.28, fzc, s > 0 ? '+x' : '-x',
      calca(lateral), M.pintura2);
    // Postes de esquina y largueros de aluminio.
    for (const z of [fz0, fz1]) c.caja(0.07, fy1 - fy0, 0.07, s * (fw / 2), (fy0 + fy1) / 2, z, M.aluminio);
    c.caja(0.06, 0.08, fl, s * (fw / 2), fy0 + 0.04, fzc, M.aluminio);
    c.caja(0.06, 0.06, fl, s * (fw / 2), fy1 - 0.03, fzc, M.aluminio);
    // Defensas laterales entre ejes.
    c.caja(0.04, 0.1, ejeD - ejeT - 2 * r - 0.5, s * 1.13, 0.68, (ejeD + ejeT) / 2, M.aluminio);
  }
  // Puertas traseras: rotulo, dos hojas, bisagras y barras de cierre. El
  // rotulo de atras es lo que mas se ve: se maneja detras del camion.
  c.cajaConCalca(2.2, 1.1, 0.012, 0, 2.62, fz0 - 0.008, '-z', calca(trasera), M.pintura2);
  c.caja(0.012, fy1 - fy0 - 0.1, 0.02, 0, (fy0 + fy1) / 2, fz0 - 0.016, M.plastico);
  for (const x of [-0.6, 0.6]) c.cilindroY(0.022, fy1 - fy0 - 0.2, x, (fy0 + fy1) / 2, fz0 - 0.03, M.acero, 6);
  // Barra antiempotramiento y pilotos.
  c.caja(2.2, 0.12, 0.1, 0, 0.56, zR + 0.1, M.acero);
  for (const s of [1, -1]) {
    c.panel(0.26, 0.12, 0.05, 0.03, s * 0.9, 0.86, zR + 0.0, M.piloto, [0, Math.PI, 0]);
    c.panel(0.1, 0.12, 0.05, 0.03, s * 0.66, 0.86, zR + 0.0, s > 0 ? M.intIzq : M.intDer, [0, Math.PI, 0]);
  }
  c.cajaConCalca(0.33, 0.11, 0.025, 0, 0.86, zR - 0.01, '-z', calca(REGION.placa2), M.plastico);
  // Tanque de combustible.
  c.cilindroZ(0.25, 0.9, -0.85, 0.78, ejeT + 1.6, M.aluminio, 14);

  const ruedas = [...eje(ejeD, 0.86, r, 0.26, true), ...eje(ejeT, 0.86, r, 0.25, true, 0.27)];
  return { c, ruedas, largo: L, ancho: fw, alto: fy1 };
}

// --------------------------------------------------------- tractomula
/**
 * Tractocamion de nariz larga con semirremolque: el rey de la autopista
 * colombiana. `contenedor` elige entre un contenedor corrugado y un furgon
 * liso con rotulo.
 */
/**
 * @param {object} o
 * @param {boolean} [o.contenedor] contenedor corrugado (sin rotulo) o furgon rotulado
 * @param {number[]} [o.lateral] region del atlas del costado
 * @param {number[]} [o.trasera] region del atlas de las puertas
 * @param {number} [o.proporcion] ancho/alto de la region lateral
 */
function tractomula({ contenedor = true, lateral = REGION.mulaAxionasoft, trasera = REGION.trasRacer, proporcion = 5.33 } = {}) {
  const c = new Constructor();
  const L = 17.6;
  const zF = L / 2, zR = -L / 2;
  const r = 0.51;

  // --- tracto --------------------------------------------------------------
  const zCapo0 = zF - 2.25;           // parallamas
  const capo = [
    { z: zCapo0 - 0.05, w: 0.62, yb: 1.05, yt: 2.0, na: 5, nb: 3 },
    { z: zF - 0.65, w: 0.60, yb: 1.05, yt: 1.86, na: 5, nb: 3 },
    { z: zF - 0.15, w: 0.56, yb: 1.08, yt: 1.80, na: 4, nb: 3 },
    { z: zF - 0.1, w: 0.52, yb: 1.12, yt: 1.76, na: 3.6, nb: 3 },
  ];
  const [capoG, , capoF] = cuerpoLoft(capo, 18, 32);
  c.agregar(capoG, (cx, cy, cz, nx, ny) => (ny < -0.4 ? M.plastico : M.pintura));
  c.agregar(capoF, M.cromo);
  // Parrilla cromada.
  c.cajaConCalca(1.02, 0.66, 0.06, 0, 1.43, zF - 0.06, '+z', calca(REGION.parrilla, M.cromo), M.cromo);
  c.panel(1.1, 0.74, 0.04, 0.05, 0, 1.43, zF - 0.09, M.cromo);
  // Guardabarros delanteros envolventes.
  const ejeD = zF - 1.25;
  for (const s of [1, -1]) {
    pasoDeRueda(c, s * 0.88, ejeD, r, M.pintura, { holgura: 0.06, ancho: 0.05, fondo: 0.46 });
    c.panel(0.2, 0.16, 0.06, 0.05, s * 0.88, 1.04, zF - 0.62, M.faro, [-0.5, 0, 0]);
    c.panel(0.08, 0.07, 0.05, 0.02, s * 1.04, 1.02, zF - 0.66, s > 0 ? M.intIzq : M.intDer, [-0.5, 0, 0]);
  }
  c.caja(2.44, 0.34, 0.24, 0, 0.66, zF - 0.1, M.cromo);
  c.cajaConCalca(0.33, 0.105, 0.025, 0, 0.66, zF + 0.03, '+z', calca(REGION.placa), M.plastico);

  // Cabina.
  const zCab0 = zCapo0 - 1.55;
  const cab = [
    { z: zCab0, w: 1.04, yb: 1.0, yt: 2.98, na: 8, nb: 6 },
    { z: zCapo0 - 0.15, w: 1.05, yb: 1.0, yt: 3.0, na: 8, nb: 6 },
    { z: zCapo0, w: 1.02, yb: 1.0, yt: 2.94, na: 7, nb: 6 },
  ];
  const [cabG, , cabF] = cuerpoLoft(cab, 10, 40);
  c.agregar(cabG, (cx, cy, cz, nx, ny) => {
    if (ny < -0.5) return M.plastico;
    if (Math.abs(nx) > 0.6 && cy > 2.02 && cy < 2.78 && cz > zCab0 + 0.35 && cz < zCapo0 - 0.22) return M.vidrio;
    return M.pintura;
  });
  c.agregar(cabF, M.pintura);
  for (const s of [1, -1]) c.panel(0.96, 0.7, 0.04, 0.06, s * 0.5, 2.44, zCapo0 + 0.02, M.vidrio, [-0.12, 0, 0]);
  c.caja(2.2, 0.06, 0.34, 0, 3.0, zCapo0 + 0.12, M.pintura, [0.25, 0, 0]);     // visera
  for (let i = -2; i <= 2; i++) c.caja(0.09, 0.05, 0.05, i * 0.32, 3.06, zCapo0 + 0.24, LUZ_AMBAR);
  for (const s of [1, -1]) {
    c.cilindroZ(0.05, 0.55, s * 0.55, 3.08, zCab0 + 0.7, M.cromo, 10);      // cornetas
    c.caja(0.05, 0.05, 0.62, s * 1.14, 2.38, zCapo0 - 0.1, M.cromo, [0, s * 0.3, 0]);
    c.panel(0.16, 0.42, 0.07, 0.04, s * 1.28, 2.3, zCapo0 + 0.15, M.cromo);
    c.cilindroZ(0.33, 1.25, s * 0.86, 0.78, zCab0 + 0.55, M.aluminio, 18);   // tanques
    c.caja(0.34, 0.04, 0.3, s * 1.08, 0.62, zCapo0 - 0.4, M.aluminio);          // escalon
  }

  // Dormitorio (sleeper), mas alto que la cabina.
  const zDor0 = zCab0 - 1.35;
  c.caja(2.12, 2.32, 1.35, 0, 2.16, zCab0 - 0.675, M.pintura);
  c.panel(2.1, 0.3, 1.33, 0.12, 0, 3.32, zCab0 - 0.675, M.pintura);
  for (const s of [1, -1]) c.caja(0.012, 0.3, 0.5, s * 1.066, 2.55, zCab0 - 0.6, M.vidrio);
  // Exostos verticales cromados entre cabina y dormitorio.
  for (const s of [1, -1]) {
    c.cilindroY(0.07, 2.85, s * 1.12, 2.55, zDor0 + 0.25, M.cromo, 12);
    c.cilindroY(0.095, 0.9, s * 1.12, 2.3, zDor0 + 0.25, M.aluminio, 12);
  }

  // Chasis del tracto y quinta rueda.
  for (const s of [1, -1]) c.caja(0.16, 0.28, zF - zDor0 + 0.6, s * 0.46, 0.85, (zF + zDor0) / 2 - 0.4, M.plastico);
  const ejeT1 = zDor0 - 0.85, ejeT2 = ejeT1 - 1.3;
  c.caja(1.2, 0.12, 1.2, 0, 1.08, (ejeT1 + ejeT2) / 2 + 0.2, M.plastico);
  for (const s of [1, -1]) {
    c.caja(0.6, 0.55, 0.02, s * 0.72, 0.42, ejeT2 - r - 0.15, M.guardafango);   // loderas
  }

  // --- remolque -----------------------------------------------------------
  const rz1 = zDor0 - 0.7;            // frente del remolque
  const rz0 = zR;
  const rw = 2.5, ry0 = 1.34, ry1 = 4.02;
  const rl = rz1 - rz0, rzc = (rz0 + rz1) / 2;
  c.caja(rw, ry1 - ry0, rl, 0, (ry0 + ry1) / 2, rzc, M.pintura2);
  // Larguero inferior, patas de apoyo y defensas laterales.
  c.caja(rw - 0.04, 0.22, rl, 0, ry0 - 0.1, rzc, M.plastico);
  for (const s of [1, -1]) {
    c.caja(0.09, 0.85, 0.09, s * 0.85, 0.82, rz1 - 1.6, M.acero);
    c.caja(0.03, 0.1, 5.5, s * 1.2, 0.72, rz1 - 5.2, M.aluminio);
  }
  if (contenedor) {
    // Corrugado del contenedor: costillas verticales a lo largo.
    for (let z = rz0 + 0.2; z < rz1 - 0.15; z += 0.3) {
      for (const s of [1, -1]) c.caja(0.03, ry1 - ry0 - 0.16, 0.12, s * (rw / 2 + 0.012), (ry0 + ry1) / 2, z, M.pintura2);
    }
    for (const s of [1, -1]) {
      c.caja(0.05, 0.1, rl, s * (rw / 2), ry1 - 0.05, rzc, M.pintura2);
      c.caja(0.05, 0.1, rl, s * (rw / 2), ry0 + 0.05, rzc, M.pintura2);
    }
    // Puertas: barras de cierre verticales.
    for (const x of [-0.85, -0.4, 0.4, 0.85]) c.cilindroY(0.025, ry1 - ry0 - 0.2, x, (ry0 + ry1) / 2, rz0 - 0.03, M.acero, 6);
    c.caja(0.02, ry1 - ry0 - 0.1, 0.02, 0, (ry0 + ry1) / 2, rz0 - 0.01, M.plastico);
  } else {
    for (const s of [1, -1]) {
      const alto = 2.1, largo = Math.min(rl - 1.0, alto * proporcion);
      c.cajaConCalca(0.012, alto, largo, s * (rw / 2 + 0.006), (ry0 + ry1) / 2, rzc, s > 0 ? '+x' : '-x',
        calca(lateral), M.pintura2);
      c.caja(0.06, 0.08, rl, s * (rw / 2), ry1 - 0.04, rzc, M.aluminio);
      c.caja(0.06, 0.08, rl, s * (rw / 2), ry0 + 0.04, rzc, M.aluminio);
      for (const z of [rz0, rz1]) c.caja(0.07, ry1 - ry0, 0.07, s * (rw / 2), (ry0 + ry1) / 2, z, M.aluminio);
    }
    c.cajaConCalca(2.3, 1.15, 0.012, 0, ry1 - 0.75, rz0 - 0.008, '-z', calca(trasera), M.pintura2);
    c.caja(0.012, ry1 - ry0 - 0.1, 0.02, 0, (ry0 + ry1) / 2, rz0 - 0.016, M.plastico);
  }
  // Trasera: barra, pilotos, placa, loderas.
  c.caja(2.3, 0.13, 0.12, 0, 0.62, rz0 + 0.25, M.acero);
  for (const s of [1, -1]) {
    c.panel(0.3, 0.13, 0.05, 0.04, s * 0.95, 1.12, rz0 - 0.005, M.piloto, [0, Math.PI, 0]);
    c.panel(0.12, 0.13, 0.05, 0.04, s * 0.68, 1.12, rz0 - 0.005, s > 0 ? M.intIzq : M.intDer, [0, Math.PI, 0]);
    c.caja(0.6, 0.55, 0.02, s * 0.75, 0.42, rz0 + 0.5, M.guardafango);
  }
  c.cajaConCalca(0.33, 0.11, 0.025, 0, 1.12, rz0 - 0.01, '-z', calca(REGION.placa2), M.plastico);
  // Luces de galibo a lo largo del remolque.
  for (let z = rz0 + 1.0; z < rz1; z += 2.4) {
    for (const s of [1, -1]) c.caja(0.03, 0.05, 0.06, s * (rw / 2 + 0.02), ry0 + 0.1, z, LUZ_AMBAR);
  }

  const ejesR = [rz0 + 1.25, rz0 + 2.55, rz0 + 3.85];
  const ruedas = [
    ...eje(ejeD, 1.0, r, 0.28, true),
    ...eje(ejeT1, 0.98, r, 0.26, true, 0.29),
    ...eje(ejeT2, 0.98, r, 0.26, true, 0.29),
    ...ejesR.flatMap(z => eje(z, 0.98, r, 0.26, true, 0.29)),
  ];
  return { c, ruedas, largo: L, ancho: rw, alto: ry1 };
}

/**
 * Modela un tipo con el nivel de detalle pedido.
 *
 * La version de lejos lleva las ruedas HORNEADAS en la carroceria como
 * cilindros simples: asi no hace falta instanciar ruedas giratorias para
 * vehiculos que estan a 300 m, donde un giro de rin no se distingue.
 * @param {object} tipo entrada de TIPOS
 * @param {number} nivel 1 = cerca, <1 = lejos
 */
export function fabricar(tipo, nivel = 1) {
  fijarDetalle(nivel);
  try {
    const m = tipo.crear();
    if (nivel < 1) {
      for (const w of m.ruedas) {
        const g = new THREE.CylinderGeometry(w.r, w.r, w.ancho * 0.9, 10);
        g.rotateZ(Math.PI / 2);
        m.c.agregar(g, M.caucho, matrizDe(w.x, w.r, w.z));
      }
    }
    return { geometria: m.c.construir(), ruedas: m.ruedas, largo: m.largo, ancho: m.ancho, alto: m.alto };
  } finally {
    fijarDetalle(1);
  }
}

// ------------------------------------------------- persecucion
const LUZ_ROJA = { c: 0x5a0a0a, r: 0.2, m: 0.1, l: 6, k: 0.4 };
const LUZ_AZUL = { c: 0x0a1a5a, r: 0.2, m: 0.1, l: 7, k: 0.4 };

/** Barra de luces de techo: mitad roja (+X) y mitad azul (−X). */
function barraDeLuces(c, y, z, ancho = 1.25) {
  c.caja(ancho, 0.07, 0.32, 0, y, z, M.plastico);
  c.caja(ancho / 2 - 0.04, 0.1, 0.26, ancho / 4, y + 0.08, z, LUZ_ROJA);
  c.caja(ancho / 2 - 0.04, 0.1, 0.26, -ancho / 4, y + 0.08, z, LUZ_AZUL);
  c.caja(0.07, 0.11, 0.27, 0, y + 0.08, z, M.blanco);
}

/** Patrulla de la Policia Nacional: camioneta blanca con franja verde. */
function patrulla() {
  return suv({
    revestimiento: 0.5,
    extras: (c) => {
      barraDeLuces(c, 1.76, -0.35);
      // Franja de puertas con POLICIA y el 123, a los dos lados.
      for (const s of [1, -1]) {
        c.cajaConCalca(0.012, 0.32, 3.3, s * 0.928, 0.86, -0.1, s > 0 ? '+x' : '-x', calca(REGION.policiaLado), M.pintura);
      }
      c.cajaConCalca(1.3, 0.16, 0.012, 0, 0.92, -2.3, '-z', calca(REGION.policiaLado), M.pintura);
      // Defensa delantera negra con dos destellos.
      c.caja(1.5, 0.08, 0.06, 0, 0.62, 2.36, M.plastico);
      c.caja(0.06, 0.32, 0.06, 0.55, 0.5, 2.36, M.plastico);
      c.caja(0.06, 0.32, 0.06, -0.55, 0.5, 2.36, M.plastico);
      c.caja(0.16, 0.06, 0.04, 0.3, 0.66, 2.39, LUZ_ROJA);
      c.caja(0.16, 0.06, 0.04, -0.3, 0.66, 2.39, LUZ_AZUL);
    },
  });
}

/** Camioneta del Ejercito Nacional: verde oliva, defensa y luces. */
function militar() {
  return pickup({
    extras: (c) => {
      barraDeLuces(c, 1.84, 0.0, 1.1);
      for (const s of [1, -1]) {
        c.cajaConCalca(0.012, 0.3, 3.2, s * 0.928, 0.86, -0.2, s > 0 ? '+x' : '-x', calca(REGION.ejercitoLado), M.pintura);
      }
      // Defensa de tubos y antena.
      c.caja(1.7, 0.1, 0.1, 0, 0.66, 2.72, M.plastico);
      for (const x of [-0.5, 0.5]) c.caja(0.08, 0.5, 0.08, x, 0.82, 2.72, M.plastico);
      c.caja(1.1, 0.08, 0.08, 0, 1.06, 2.72, M.plastico);
      c.cilindroY(0.012, 1.4, -0.8, 1.8, -2.4, M.plastico, 5);
      // Lona sobre el platon.
      c.caja(1.7, 0.55, 1.85, 0, 1.36, -1.66, M.pintura2);
    },
  });
}

// ------------------------------------------------------------ catalogo
const BLANCO = 0xedeeec, PLATA = 0xb7bbc1, GRIS = 0x5e636a, NEGRO = 0x141619;
const ROJO = 0x9c1b1d, AZUL = 0x1d3c6c, VINO = 0x581521, BEIGE = 0xbcab8c;
const VERDE = 0x2d4c3c, CELESTE = 0x86a8c8, NARANJA = 0xd4621c;

/** Paleta ponderada: los colores repetidos salen mas, como en la calle. */
const PALETA_PARTICULAR = [
  BLANCO, BLANCO, BLANCO, PLATA, PLATA, PLATA, GRIS, GRIS, NEGRO, NEGRO,
  ROJO, AZUL, VINO, BEIGE, VERDE, CELESTE, NARANJA,
];

/**
 * Tipos de vehiculo. `peso` es la frecuencia relativa en la via; `pesado`
 * marca los que van por la derecha, mas despacio y casi no cambian de carril.
 */
export const TIPOS = [
  { id: 'sedan', nombre: 'sedán', crear: sedan, peso: 18, paleta: PALETA_PARTICULAR },
  { id: 'hatch', nombre: 'carro', crear: () => hatchback(), peso: 15, paleta: PALETA_PARTICULAR },
  { id: 'taxi', nombre: 'taxi', crear: () => hatchback({ taxi: true }), peso: 11, paleta: [0xf2bd06] },
  { id: 'suv', nombre: 'camioneta', crear: suv, peso: 15, paleta: PALETA_PARTICULAR },
  { id: 'pickup', nombre: 'camioneta platón', crear: pickup, peso: 7, paleta: [BLANCO, PLATA, GRIS, NEGRO, ROJO, AZUL] },
  { id: 'van', nombre: 'van', crear: van, peso: 6, paleta: [BLANCO, BLANCO, PLATA, AZUL] },
  {
    id: 'bus', nombre: 'bus', crear: () => bus(), peso: 5, pesado: true,
    paleta: [BLANCO, 0xe8e1cc, 0x1b4f93, 0x0c6b48, 0xb01d24],
  },
  {
    id: 'busAxiona', nombre: 'bus', crear: () => bus({ anuncio: REGION.pubBusAxiona, largoAnuncio: 5.0 }),
    peso: 4, pesado: true, paleta: [BLANCO, 0x1b4f93, 0x0c6b48],
  },
  {
    id: 'busTakamura', nombre: 'bus', crear: () => bus({ anuncio: REGION.pubBusTakamura, largoAnuncio: 5.0 }),
    peso: 4, pesado: true, paleta: [BLANCO, 0xe8e1cc, 0xb01d24],
  },
  // Camiones con publicidad: axionasoft.com, Takamura (rojo, letras chinas)
  // y el TikTok de Jero.
  {
    id: 'camionAxiona', nombre: 'camión', peso: 4, pesado: true,
    crear: () => camion({ lateral: REGION.pubAxionasoft, trasera: REGION.trasAxionasoft }),
    paleta: [BLANCO, BLANCO, 0x1b2a3a, AZUL], paleta2: [0xf2f2f0],
  },
  {
    id: 'camionTakamura', nombre: 'camión', peso: 5, pesado: true,
    crear: () => camion({ lateral: REGION.pubTakamura, trasera: REGION.trasTakamura }),
    paleta: [0xb3101b, BLANCO], paleta2: [0xb3101b],
  },
  {
    id: 'camionJero', nombre: 'camión', peso: 5, pesado: true,
    crear: () => camion({ lateral: REGION.pubJero, trasera: REGION.trasJero }),
    paleta: [NEGRO, BLANCO, 0x2b2b38], paleta2: [0x15151c],
  },
  {
    id: 'mulaC', nombre: 'tractomula', crear: () => tractomula({ contenedor: true }), peso: 5, pesado: true,
    paleta: [ROJO, AZUL, BLANCO, NEGRO, 0x1f6b45, NARANJA, 0x6b6f75],
    paleta2: [0xc65a1a, 0x1e4e8e, 0x9a2a20, 0x2e6d4a, 0x8a8f96, 0x6a1c22, 0xd8b24a],
  },
  {
    id: 'mulaAxiona', nombre: 'tractomula', peso: 3, pesado: true,
    crear: () => tractomula({ contenedor: false, lateral: REGION.mulaAxionasoft, trasera: REGION.trasAxionasoft }),
    paleta: [BLANCO, AZUL, NEGRO, 0x1f6b45], paleta2: [0xf2f2f0],
  },
  {
    id: 'mulaJero', nombre: 'tractomula', peso: 4, pesado: true,
    crear: () => tractomula({ contenedor: false, lateral: REGION.mulaJero, trasera: REGION.trasJero }),
    paleta: [NEGRO, ROJO, BLANCO], paleta2: [0x15151c],
  },
  {
    id: 'mulaTakamura', nombre: 'tractomula', peso: 4, pesado: true,
    crear: () => tractomula({ contenedor: false, lateral: REGION.pubTakamura, trasera: REGION.trasTakamura, proporcion: 4 }),
    paleta: [0xb3101b, NEGRO], paleta2: [0xb3101b],
  },
];

/** Vehiculos de la persecucion. No circulan en el trafico normal. */
export const TIPOS_PERSECUCION = {
  patrulla: { id: 'patrulla', nombre: 'patrulla', crear: patrulla, paleta: [0xf4f5f3] },
  militar: { id: 'militar', nombre: 'Ejército', crear: militar, paleta: [0x4a5130], paleta2: [0x5a6140] },
};
