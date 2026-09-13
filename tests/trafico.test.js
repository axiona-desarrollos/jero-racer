/* ==========================================================================
   Pruebas de la deteccion de choque.

   Todas nacen de fallos reales encontrados conduciendo, no de imaginar casos:
   el SAT que no solapaba nunca por medir contra la posicion equivocada, y el
   falso positivo en el metro cero por ignorar la altura.
   ========================================================================== */

import { describe, it, expect } from 'vitest';
import { solapanXZ } from '../src/traffic/trafico.js';
import { VIA, carrilX, anchoCalzada, anchoTotal } from '../src/world/autopista.js';

const caja = (x, z, largo = 4.4, ancho = 1.9, yaw = 0) => ({ x, z, largo, ancho, yaw });

describe('solapanXZ', () => {
  it('dos cajas identicas solapan', () => {
    expect(solapanXZ(caja(0, 0), caja(0, 0))).toBe(true);
  });

  it('separa y junta correctamente a lo largo', () => {
    expect(solapanXZ(caja(0, 0), caja(0, 4.0))).toBe(true);
    expect(solapanXZ(caja(0, 0), caja(0, 4.5))).toBe(false);
  });

  it('separa y junta correctamente a lo ancho', () => {
    expect(solapanXZ(caja(0, 0), caja(1.5, 0))).toBe(true);
    expect(solapanXZ(caja(0, 0), caja(2.1, 0))).toBe(false);
  });

  it('tiene en cuenta el giro: de lado ocupa mas a lo ancho', () => {
    // Un coche cruzado ocupa su LARGO en el eje X.
    const cruzado = caja(0, 0, 4.4, 1.9, Math.PI / 2);
    expect(solapanXZ(cruzado, caja(2.5, 0))).toBe(true);
    expect(solapanXZ(caja(0, 0), caja(2.5, 0))).toBe(false);
  });

  it('es simetrica', () => {
    const a = caja(0, 0), b = caja(1.2, 2.0, 12.5, 2.5, 0.3);
    expect(solapanXZ(a, b)).toBe(solapanXZ(b, a));
  });

  it('un camion a media via no toca a quien va por el arcen contrario', () => {
    const camion = caja(carrilX(0), 100, 12.5, 2.5);
    const jugador = caja(carrilX(VIA.carriles - 1), 100);
    expect(solapanXZ(jugador, camion)).toBe(false);
  });

  // EL CASO REAL, con las cifras medidas en el impacto que se escapaba.
  // Hacian falta las DOS correcciones y este test lo demuestra:
  //   - Rapier resuelve el contacto hasta penetracion cero, asi que en el
  //     fotograma del choque las cajas estan 3 cm SEPARADAS: sin holgura no
  //     hay solape que detectar por mucho que se mire la posicion correcta.
  //   - Y contra la posicion logica el hueco es 0,37 m, doce veces mayor:
  //     taparlo exigiria una holgura de 0,74 m, que empezaria a marcar choques
  //     en carriles contiguos.
  const HOLGURA = 0.25;
  const inflar = (c, m) => ({ ...c, largo: c.largo + m, ancho: c.ancho + m });

  it('sin holgura no se detecta el choque aunque se mire la posicion fisica', () => {
    const jugador = caja(1.8, 505.7, 3.92, 1.8);
    const camionFisico = caja(1.97, 513.98, 12.5, 2.5);
    expect(solapanXZ(jugador, camionFisico)).toBe(false);
  });

  it('con holgura y posicion fisica SI se detecta', () => {
    const jugador = caja(1.8, 505.7, 3.92, 1.8);
    const camionFisico = caja(1.97, 513.98, 12.5, 2.5);
    expect(solapanXZ(jugador, inflar(camionFisico, HOLGURA))).toBe(true);
  });

  it('con holgura pero posicion LOGICA se sigue escapando', () => {
    const jugador = caja(1.8, 505.7, 3.92, 1.8);
    const camionLogico = caja(1.97, 514.32, 12.5, 2.5);
    expect(solapanXZ(jugador, inflar(camionLogico, HOLGURA))).toBe(false);
  });

  it('la holgura no llega a marcar un vehiculo del carril de al lado', () => {
    const jugador = caja(carrilX(2), 0, 3.92, 1.8);
    const vecino = caja(carrilX(3), 0, 4.4, 1.9);
    expect(solapanXZ(jugador, inflar(vecino, HOLGURA))).toBe(false);
  });

  // El falso positivo del metro cero: la prueba es en PLANTA y no mira la
  // altura, asi que un vehiculo aparcado bajo el origen seguia "solapando".
  // Por eso el aparcadero esta lejos en X y no solo enterrado en Y.
  it('un vehiculo aparcado lejos en X no puede solapar con nadie en la via', () => {
    const jugador = caja(carrilX(3), 0);
    const aparcado = caja(100000, 0, 12.5, 2.5);
    expect(solapanXZ(jugador, aparcado)).toBe(false);
  });
});

describe('Geometria de la via', () => {
  it('los carriles quedan dentro de la calzada y no se pisan', () => {
    const w = anchoCalzada();
    for (let i = 0; i < VIA.carriles; i++) {
      const x = carrilX(i);
      expect(Math.abs(x) + VIA.anchoCarril / 2).toBeLessThanOrEqual(w / 2 + 1e-9);
      if (i > 0) {
        expect(+(x - carrilX(i - 1)).toFixed(6)).toBe(VIA.anchoCarril);
      }
    }
  });

  it('los carriles estan centrados en la via', () => {
    const primero = carrilX(0), ultimo = carrilX(VIA.carriles - 1);
    expect(primero + ultimo).toBeCloseTo(0, 9);
  });

  it('el ancho total incluye los dos arcenes', () => {
    expect(anchoTotal()).toBeCloseTo(anchoCalzada() + VIA.anchoArcen * 2, 9);
  });

  it('caben dos camiones a la par sin tocarse', () => {
    const a = caja(carrilX(0), 0, 12.5, 2.5);
    const b = caja(carrilX(1), 0, 12.5, 2.5);
    expect(solapanXZ(a, b)).toBe(false);
  });
});
