import { describe, it, expect } from 'vitest';
import { camaraEn, camarasEntre, FOTOMULTA } from '../src/world/fotomultas.js';

describe('calendario de fotomultas', () => {
  it('cada camara cae a mitad de un hueco del paisaje, nunca encima de un portico o un puente', () => {
    for (let m = -20; m < 60; m++) {
      const c = camaraEn(m);
      if (!c) continue;
      const desdePieza = (((c.z - 300) % 550) + 550) % 550;
      expect(desdePieza).toBe(275);
      expect([50, 70]).toContain(c.limite);
    }
  });

  it('ninguna va en el hueco que sigue al puente (su aviso quedaria detras del tablero)', () => {
    for (let m = 0; m < 40; m++) if (m % 10 === 4) expect(camaraEn(m)).toBeNull();
  });

  it('hay camaras con aviso y escondidas', () => {
    const cs = Array.from({ length: 10 }, (_, m) => camaraEn(m)).filter(Boolean);
    expect(cs.some(c => c.oculta)).toBe(true);
    expect(cs.some(c => !c.oculta)).toBe(true);
  });

  it('cuenta cada camara una sola vez aunque el paso sea pequeno', () => {
    const vistas = [];
    for (let z = 0; z < 12000; z += 0.93) vistas.push(...camarasEntre(z, z + 0.93));
    const ms = vistas.map(c => c.m);
    expect(new Set(ms).size).toBe(ms.length);
    const esperadas = [];
    for (let m = 0; m * FOTOMULTA.hueco + FOTOMULTA.desfase < 12000; m++) if (camaraEn(m)) esperadas.push(m);
    expect(ms).toEqual(esperadas);
  });

  it('un paso hacia atras o nulo no cruza nada', () => {
    expect(camarasEntre(600, 500)).toEqual([]);
    expect(camarasEntre(575, 575)).toEqual([]);
  });
});
