import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Powertrain, POWERTRAIN_DEFAULTS, sampleTorqueCurve } from '../src/vehicle/powertrain.js';

const DT = 1 / 60;
const CPP = resolve(__dirname, '../Source/HighwayRacer/Vehicle/HRVehiclePawn.cpp');

/** rad/s del eje para una velocidad dada, con un radio de rueda dado. */
const radsFor = (kmh, r = 0.524) => (kmh / 3.6) / r;

describe('paridad con el C++ (ConfigureEngine / ConfigureTransmission)', () => {
  const src = readFileSync(CPP, 'utf8');
  const val = re => { const m = src.match(re); return m ? parseFloat(m[1]) : undefined; };

  const PARES = [
    ['MaxTorque', /Engine\.MaxTorque\s*=\s*([\d.]+)f/, 'maxTorque'],
    ['MaxRPM', /Engine\.MaxRPM\s*=\s*([\d.]+)f/, 'maxRPM'],
    ['EngineIdleRPM', /Engine\.EngineIdleRPM\s*=\s*([\d.]+)f/, 'idleRPM'],
    ['ChangeUpRPM', /Trans\.ChangeUpRPM\s*=\s*([\d.]+)f/, 'changeUpRPM'],
    ['ChangeDownRPM', /Trans\.ChangeDownRPM\s*=\s*([\d.]+)f/, 'changeDownRPM'],
    ['GearChangeTime', /Trans\.GearChangeTime\s*=\s*([\d.]+)f/, 'gearChangeTime'],
    ['TransmissionEfficiency', /Trans\.TransmissionEfficiency\s*=\s*([\d.]+)f/, 'efficiency'],
    ['FinalDriveRatio', /kFinalDriveRatio\s*=\s*([\d.]+)f/, 'finalRatio'],
  ];

  for (const [nombre, re, js] of PARES) {
    it(`${nombre} (C++) === ${js} (JS)`, () => {
      const v = val(re);
      expect(v, `no encontre ${nombre} en el .cpp`).toBeDefined();
      expect(POWERTRAIN_DEFAULTS[js]).toBe(v);
    });
  }

  it('las 10 relaciones del 10R80 coinciden una a una', () => {
    const m = src.match(/ForwardGearRatios\s*=\s*\{([^}]+)\}/);
    expect(m, 'no encontre ForwardGearRatios').toBeTruthy();
    const cpp = m[1].match(/[\d.]+/g).map(Number);
    expect(cpp).toHaveLength(10);
    expect([...POWERTRAIN_DEFAULTS.gears]).toEqual(cpp);
  });

  it('la curva de par del C++ tiene los mismos 9 puntos', () => {
    // Acotado a ConfigureEngine: ConfigureSteeringAndDiff tambien usa AddKey
    // para la curva de direccion, y sin acotar salen 11 puntos.
    const cuerpo = src.slice(
      src.indexOf('void AHRVehiclePawn::ConfigureEngine'),
      src.indexOf('void AHRVehiclePawn::ConfigureTransmission'));
    expect(cuerpo.length, 'no encontre ConfigureEngine').toBeGreaterThan(100);
    const pts = [...cuerpo.matchAll(/Curve->AddKey\(([\d.]+)f,\s*([\d.]+)f\)/g)]
      .map(m => [parseFloat(m[1]), parseFloat(m[2])]);
    expect(pts).toHaveLength(9);
    // sampleTorqueCurve debe pasar exactamente por cada punto del C++
    for (const [rpm, v] of pts) expect(sampleTorqueCurve(rpm)).toBeCloseTo(v, 9);
  });
});

describe('curva de par', () => {
  it('el maximo esta a 4900 rpm', () => {
    expect(sampleTorqueCurve(4900)).toBe(1);
    expect(sampleTorqueCurve(4000)).toBeLessThan(1);
    expect(sampleTorqueCurve(6000)).toBeLessThan(1);
  });
  it('meseta ancha de V8 atmosferico entre 3500 y 5800', () => {
    for (const r of [3500, 4200, 4900, 5400, 5800]) {
      expect(sampleTorqueCurve(r)).toBeGreaterThan(0.93);
    }
  });
  it('cae contra el limitador', () => {
    expect(sampleTorqueCurve(7500)).toBeLessThan(sampleTorqueCurve(7250));
  });
  it('se satura fuera de rango en vez de extrapolar', () => {
    expect(sampleTorqueCurve(0)).toBe(0.40);
    expect(sampleTorqueCurve(99999)).toBe(0.55);
  });
});

describe('Powertrain · regimen', () => {
  it('arranca al ralenti en 1a', () => {
    const p = new Powertrain();
    expect(p.rpm).toBe(760);
    expect(p.gearLabel).toBe('1');
  });
  it('nunca baja del ralenti', () => {
    const p = new Powertrain();
    for (let i = 0; i < 120; i++) p.update(0, 0, DT);
    expect(p.rpm).toBeGreaterThanOrEqual(760);
  });
  it('el regimen sube con la velocidad de las ruedas', () => {
    const p = new Powertrain();
    p.update(1, radsFor(20), DT);
    const bajo = p.rpm;
    p.update(1, radsFor(60), DT);
    expect(p.rpm).toBeGreaterThan(bajo);
  });
});

describe('Powertrain · caja automatica', () => {
  it('sube de marcha al llegar a changeUpRPM', () => {
    const p = new Powertrain();
    for (let i = 0; i < 40 && p.gear === 1; i++) p.update(1, radsFor(85), DT);
    expect(p.gear).toBe(2);
  });

  it('CORTA el par en el tick del cambio (bug del pico del 57%)', () => {
    const p = new Powertrain();
    let torqueEnElCambio = null;
    for (let i = 0; i < 200; i++) {
      const marchaAntes = p.gear;
      const r = p.update(1, radsFor(85), DT);
      if (p.gear !== marchaAntes) { torqueEnElCambio = r.torque; break; }
    }
    expect(torqueEnElCambio, 'nunca cambio de marcha').not.toBeNull();
    expect(torqueEnElCambio).toBe(0);
  });

  it('sigue sin entregar par durante toda la ventana del cambio', () => {
    const p = new Powertrain();
    while (p.gear === 1) p.update(1, radsFor(85), DT);
    // El timer se decrementa DENTRO de update(), asi que hay que mirar el
    // resultado de cada tick, no el estado previo.
    let ticksSinPar = 0;
    for (let i = 0; i < 60; i++) {
      const r = p.update(1, radsFor(85), DT);
      if (r.torque !== 0) break;
      ticksSinPar++;
    }
    // 0.11 s a 60 Hz son ~6 ticks completos de corte.
    expect(ticksSinPar).toBeGreaterThanOrEqual(5);
    expect(ticksSinPar).toBeLessThanOrEqual(8);
  });

  it('baja de marcha al caer por debajo de changeDownRPM', () => {
    const p = new Powertrain();
    while (p.gear < 3) p.update(1, radsFor(140), DT);
    while (p.shiftTimer > 0) p.update(0, radsFor(140), DT);
    for (let i = 0; i < 60 && p.gear === 3; i++) p.update(0, radsFor(20), DT);
    expect(p.gear).toBeLessThan(3);
  });

  it('no pasa de la decima', () => {
    const p = new Powertrain();
    for (let i = 0; i < 5000; i++) p.update(1, radsFor(320), DT);
    expect(p.gear).toBeLessThanOrEqual(10);
  });
});

describe('Powertrain · limitador', () => {
  it('corta el par contra el limitador', () => {
    const p = new Powertrain({ automatic: false });
    const r = p.update(1, radsFor(400), DT);
    expect(p.onLimiter).toBe(true);
    expect(r.torque).toBe(0);
  });
});

describe('Powertrain · marcha atras', () => {
  it('engrana reversa solo casi parado', () => {
    const p = new Powertrain();
    expect(p.engageReverse(60)).toBe(false);
    expect(p.engageReverse(1)).toBe(true);
    expect(p.gearLabel).toBe('R');
  });
  it('el par en reversa es negativo', () => {
    const p = new Powertrain();
    p.engageReverse(0);
    p.shiftTimer = 0;
    const r = p.update(1, radsFor(5), DT);
    expect(r.torque).toBeLessThan(0);
  });
  it('vuelve a adelante casi parado', () => {
    const p = new Powertrain();
    p.engageReverse(0);
    expect(p.engageForward(1)).toBe(true);
    expect(p.gearLabel).toBe('1');
  });
});

describe('Powertrain · robustez', () => {
  it('rad/s NaN no contamina el regimen', () => {
    const p = new Powertrain();
    p.update(1, NaN, DT);
    expect(Number.isFinite(p.rpm)).toBe(true);
  });
  it('dt = 0 no rompe', () => {
    const p = new Powertrain();
    const r = p.update(1, radsFor(50), 0);
    expect(Number.isFinite(r.torque)).toBe(true);
  });
  it('reset vuelve al estado inicial', () => {
    const p = new Powertrain();
    for (let i = 0; i < 500; i++) p.update(1, radsFor(200), DT);
    p.reset();
    expect(p.gear).toBe(1);
    expect(p.rpm).toBe(760);
    expect(p.shiftTimer).toBe(0);
  });
});
