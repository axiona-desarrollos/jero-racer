import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SteeringModel, PedalModel, STEERING_DEFAULTS, PEDAL_DEFAULTS,
  interpConstantTo, mappedRangeClamped,
} from '../src/vehicle/steering.js';

const DT = 1 / 60;
const CPP = resolve(__dirname, '../Source/HighwayRacer/Vehicle/HRSteeringModel.h');

/** Extrae `float Nombre = 1.23f;` del header de Unreal. */
function cppFloats(path) {
  const src = readFileSync(path, 'utf8');
  const out = {};
  for (const m of src.matchAll(/^\s*float\s+(\w+)\s*=\s*(-?[\d.]+)f?\s*;/gm)) {
    out[m[1]] = parseFloat(m[2]);
  }
  return out;
}

describe('paridad con el C++ (las constantes viven en dos lenguajes)', () => {
  const cpp = cppFloats(CPP);

  const PARES = [
    ['FullAuthorityKmh', 'fullAuthorityKmh'],
    ['MinAuthorityKmh', 'minAuthorityKmh'],
    ['MinAuthority', 'minAuthority'],
    ['TurnInRate', 'turnInRate'],
    ['ReturnRate', 'returnRate'],
    ['CounterSteerRate', 'counterSteerRate'],
    ['OutputExpo', 'outputExpo'],
  ];

  it('el header de Unreal se pudo leer y tiene las constantes', () => {
    expect(Object.keys(cpp).length).toBeGreaterThan(5);
  });

  for (const [nombreCpp, nombreJs] of PARES) {
    it(`${nombreCpp} (C++) === ${nombreJs} (JS)`, () => {
      expect(cpp[nombreCpp], `falta ${nombreCpp} en ${CPP}`).toBeDefined();
      expect(STEERING_DEFAULTS[nombreJs]).toBe(cpp[nombreCpp]);
    });
  }

  for (const [nombreCpp, nombreJs] of [['PressRate', 'pressRate'], ['ReleaseRate', 'releaseRate']]) {
    it(`${nombreCpp} (C++) === ${nombreJs} (JS)`, () => {
      expect(PEDAL_DEFAULTS[nombreJs]).toBe(cpp[nombreCpp]);
    });
  }
});

describe('interpConstantTo', () => {
  it('llega exactamente al objetivo, no se queda corto como el exponencial', () => {
    let v = 0;
    for (let i = 0; i < 200; i++) v = interpConstantTo(v, 1, DT, 2.1);
    expect(v).toBe(1);
  });
  it('avanza a velocidad constante', () => {
    expect(interpConstantTo(0, 1, DT, 6)).toBeCloseTo(0.1, 6);
  });
  it('no sobrepasa el objetivo', () => {
    expect(interpConstantTo(0.99, 1, DT, 100)).toBe(1);
  });
});

describe('mappedRangeClamped', () => {
  it('recorta por debajo y por encima del rango', () => {
    expect(mappedRangeClamped(40, 250, 1, 0.26, 0)).toBe(1);
    expect(mappedRangeClamped(40, 250, 1, 0.26, 999)).toBeCloseTo(0.26, 9);
  });
  it('interpola en el medio', () => {
    expect(mappedRangeClamped(40, 250, 1, 0.26, 145)).toBeCloseTo(0.63, 6);
  });
});

describe('SteeringModel · autoridad por velocidad', () => {
  it('autoridad total por debajo de 40 km/h', () => {
    const s = new SteeringModel();
    s.update(1, 10, 0, DT);
    expect(s.lastAuthority).toBe(1);
  });
  it('autoridad minima a 250 km/h o mas', () => {
    const s = new SteeringModel();
    s.update(1, 300, 0, DT);
    expect(s.lastAuthority).toBeCloseTo(0.26, 9);
  });
  it('el tope alcanzable a alta velocidad es menor que a baja', () => {
    const lento = new SteeringModel(), rapido = new SteeringModel();
    for (let i = 0; i < 300; i++) { lento.update(1, 10, 0, DT); rapido.update(1, 300, 0, DT); }
    expect(rapido.rawCurrent).toBeLessThan(lento.rawCurrent);
    expect(rapido.rawCurrent).toBeCloseTo(0.26, 3);
  });
});

describe('SteeringModel · convencion de signo', () => {
  it('entrada positiva da salida positiva (ambas = derecha)', () => {
    const s = new SteeringModel();
    let out = 0;
    for (let i = 0; i < 60; i++) out = s.update(1, 50, 0, DT);
    expect(out).toBeGreaterThan(0);
  });
  it('es simetrica: izquierda es el espejo exacto de derecha', () => {
    const d = new SteeringModel(), i = new SteeringModel();
    let od = 0, oi = 0;
    for (let k = 0; k < 60; k++) { od = d.update(1, 50, 0, DT); oi = i.update(-1, 50, 0, DT); }
    expect(od).toBeCloseTo(-oi, 12);
  });
});

describe('SteeringModel · las tres constantes de tiempo', () => {
  const avanza = (s, raw, n, v = 50) => { let o = 0; for (let i = 0; i < n; i++) o = s.update(raw, v, 0, DT); return o; };

  it('soltar es mas rapido que meter volante', () => {
    const a = new SteeringModel(); avanza(a, 1, 30);
    const antesDeSoltar = a.rawCurrent;
    a.update(0, 50, 0, DT);
    const caida = antesDeSoltar - a.rawCurrent;

    const b = new SteeringModel();
    const subida = b.update(1, 50, 0, DT);
    expect(caida).toBeGreaterThan(subida);
  });

  it('el contravolante es la constante mas rapida de las tres', () => {
    const s = new SteeringModel();
    avanza(s, 1, 60);                       // volante a la derecha
    const desde = s.rawCurrent;
    s.update(-1, 50, 0, DT);                // cruzar el centro
    const paso = desde - s.rawCurrent;
    expect(paso).toBeCloseTo(STEERING_DEFAULTS.counterSteerRate * DT, 6);
  });

  it('vuelve al centro al soltar', () => {
    const s = new SteeringModel();
    avanza(s, 1, 60);
    avanza(s, 0, 300);
    expect(s.rawCurrent).toBe(0);
  });
});

describe('SteeringModel · expo', () => {
  it('la salida es menor que la entrada cruda en el rango medio', () => {
    const s = new SteeringModel();
    let out = 0;
    for (let i = 0; i < 15; i++) out = s.update(1, 50, 0, DT);
    expect(Math.abs(out)).toBeLessThan(Math.abs(s.rawCurrent));
  });
  it('en el tope, entrada y salida coinciden', () => {
    const s = new SteeringModel();
    let out = 0;
    for (let i = 0; i < 300; i++) out = s.update(1, 10, 0, DT);
    expect(out).toBeCloseTo(1, 9);
  });
});

describe('SteeringModel · robustez', () => {
  it('dt = 0 no rompe ni devuelve NaN', () => {
    const s = new SteeringModel();
    expect(Number.isFinite(s.update(1, 50, 0, 0))).toBe(true);
  });
  it('yawSlip NaN no contamina el estado', () => {
    const s = new SteeringModel({ counterSteerAssist: 0.4 });
    s.update(1, 50, NaN, DT);
    expect(Number.isFinite(s.rawCurrent)).toBe(true);
  });
  it('entradas fuera de rango se recortan', () => {
    const s = new SteeringModel();
    for (let i = 0; i < 300; i++) s.update(99, 10, 0, DT);
    expect(s.rawCurrent).toBeLessThanOrEqual(1);
  });
  it('reset deja el modelo como nuevo', () => {
    const s = new SteeringModel();
    for (let i = 0; i < 60; i++) s.update(1, 200, 0, DT);
    s.reset();
    expect(s.rawCurrent).toBe(0);
    expect(s.lastAuthority).toBe(1);
  });
});

describe('SteeringModel · asistencia de contravolante', () => {
  it('desactivada por defecto', () => {
    expect(STEERING_DEFAULTS.counterSteerAssist).toBe(0);
  });
  it('con el coche cruzado, empuja el volante hacia el lado del derrape', () => {
    const sin = new SteeringModel({ counterSteerAssist: 0 });
    const con = new SteeringModel({ counterSteerAssist: 0.5 });
    for (let i = 0; i < 30; i++) { sin.update(0, 80, 25, DT); con.update(0, 80, 25, DT); }
    // slip +25 = cola a la derecha -> el volante debe irse a la derecha (+)
    expect(con.rawCurrent).toBeGreaterThan(sin.rawCurrent);
  });
});

describe('PedalModel', () => {
  it('soltar es mas rapido que pisar', () => {
    expect(PEDAL_DEFAULTS.releaseRate).toBeGreaterThan(PEDAL_DEFAULTS.pressRate);
  });
  it('llega a 1 y se queda', () => {
    const p = new PedalModel();
    for (let i = 0; i < 200; i++) p.update(1, DT);
    expect(p.value).toBe(1);
  });
  it('nunca sale de 0..1', () => {
    const p = new PedalModel();
    for (let i = 0; i < 50; i++) p.update(5, DT);
    expect(p.value).toBeLessThanOrEqual(1);
    for (let i = 0; i < 200; i++) p.update(-5, DT);
    expect(p.value).toBeGreaterThanOrEqual(0);
  });
});
