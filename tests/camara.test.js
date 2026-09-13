/* ==========================================================================
   Pruebas del sistema de camara.

   No comprueban "se ve bonito" — eso no es comprobable aqui. Comprueban los
   contratos que, si se rompen, producen los fallos concretos que el diseno
   existe para evitar: teletransportes al cambiar de modo, dependencia del
   framerate, y una camara que tumba el bucle de render por un nombre mal
   escrito.
   ========================================================================== */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DirectorCamara } from '../src/camera/director.js';
import {
  modosPorDefecto, modoPersecucion, modoCabina,
  modoCinematografico, modoCenital,
} from '../src/camera/modos.js';

/** Coche de mentira: solo lo que los modos consultan. */
function cocheEn(x = 0, y = 0, z = 0, yaw = 0) {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  o.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return o;
}

function ctxDe(cuerpo, { velocidadKmh = 0, derrapeGrados = 0 } = {}) {
  return { cuerpo, velocidadKmh, derrapeGrados, tiempo: 0 };
}

const nuevaCamara = () => new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 600);

describe('DirectorCamara · contrato', () => {
  it('no se construye sin modos', () => {
    expect(() => new DirectorCamara(nuevaCamara(), [])).toThrow();
    expect(() => new DirectorCamara(nuevaCamara(), null)).toThrow();
  });

  it('cicla y vuelve al principio', () => {
    const d = new DirectorCamara(nuevaCamara(), modosPorDefecto());
    const n = d.modos.length;
    const primero = d.modo.nombre;
    for (let i = 0; i < n; i++) d.siguiente();
    expect(d.modo.nombre).toBe(primero);
  });

  it('anterior es la inversa de siguiente', () => {
    const d = new DirectorCamara(nuevaCamara(), modosPorDefecto());
    d.siguiente(); d.siguiente();
    const antes = d.modo.nombre;
    d.siguiente(); d.anterior();
    expect(d.modo.nombre).toBe(antes);
  });

  it('un nombre desconocido no cambia nada ni lanza', () => {
    const d = new DirectorCamara(nuevaCamara(), modosPorDefecto());
    const antes = d.modo.nombre;
    expect(d.seleccionar('no-existe')).toBe(false);
    expect(d.seleccionar(99)).toBe(false);
    expect(d.seleccionar(-1)).toBe(false);
    expect(d.modo.nombre).toBe(antes);
  });

  it('seleccionar el modo ya activo no reinicia la transicion', () => {
    const d = new DirectorCamara(nuevaCamara(), modosPorDefecto());
    expect(d.seleccionar(0)).toBe(false);
    expect(d.cruce).toBe(0);
  });
});

describe('DirectorCamara · continuidad', () => {
  it('fijar coloca la camara exactamente en la pose del modo', () => {
    const cam = nuevaCamara();
    const coche = cocheEn(10, 0, -5);
    const d = new DirectorCamara(cam, [modoPersecucion()]);
    const ctx = ctxDe(coche);
    d.fijar(ctx);
    const esperada = modoPersecucion().calcular(ctx).pos;
    expect(cam.position.distanceTo(esperada)).toBeLessThan(1e-6);
  });

  it('cambiar a un modo pegado NO teletransporta la camara', () => {
    const cam = nuevaCamara();
    const coche = cocheEn();
    const d = new DirectorCamara(cam, [modoPersecucion(), modoCabina()]);
    const ctx = ctxDe(coche);
    d.fijar(ctx);
    const origen = cam.position.clone();

    // La cabina esta dentro del coche: sin transicion el salto seria completo.
    const destino = modoCabina().calcular(ctx).pos.clone();
    const saltoCompleto = origen.distanceTo(destino);
    expect(saltoCompleto).toBeGreaterThan(3);

    d.seleccionar('cabina');
    d.actualizar(ctx, 1 / 60);
    const recorrido = origen.distanceTo(cam.position);
    expect(recorrido).toBeGreaterThan(0);
    expect(recorrido).toBeLessThan(saltoCompleto * 0.5);
  });

  it('la transicion termina y entonces el modo pegado si va clavado', () => {
    const cam = nuevaCamara();
    const coche = cocheEn();
    const d = new DirectorCamara(cam, [modoPersecucion(), modoCabina()]);
    const ctx = ctxDe(coche);
    d.fijar(ctx);
    d.seleccionar('cabina');
    for (let i = 0; i < 180; i++) d.actualizar(ctx, 1 / 60);
    expect(d.cruce).toBe(0);
    const destino = modoCabina().calcular(ctx).pos;
    expect(cam.position.distanceTo(destino)).toBeLessThan(0.02);
  });

  // La ley de suavizado `1 - k^dt` es exactamente independiente del framerate
  // SOLO con el objetivo quieto. Con el objetivo en movimiento entra un error de
  // muestreo que no es del suavizado sino de que a 30 Hz el coche salta 1 m
  // entre fotograma y fotograma. Se comprueban las dos cosas por separado para
  // que un fallo diga cual de las dos se rompio.
  it('con el objetivo quieto converge al mismo sitio a cualquier framerate', () => {
    const converger = (pasos, dt) => {
      const coche = cocheEn(0, 0, 0);
      const cam = nuevaCamara();
      const d = new DirectorCamara(cam, [modoPersecucion()]);
      const ctx = ctxDe(coche);
      d.fijar(ctx);
      coche.position.set(0, 0, 40);       // salto instantaneo: hay que alcanzarlo
      coche.updateMatrixWorld();
      for (let i = 0; i < pasos; i++) d.actualizar(ctx, dt);
      return cam.position.clone();
    };
    const a = converger(240, 1 / 240);
    const b = converger(120, 1 / 120);
    const c = converger(30, 1 / 30);
    expect(a.distanceTo(b)).toBeLessThan(1e-3);
    expect(a.distanceTo(c)).toBeLessThan(1e-3);
  });

  it('con el objetivo en marcha el desfase no pasa de un fotograma de recorrido', () => {
    const VEL = 30;   // m/s
    const correr = (pasos, dt) => {
      const coche = cocheEn(0, 0, 0);
      const cam = nuevaCamara();
      const d = new DirectorCamara(cam, [modoPersecucion()]);
      const ctx = ctxDe(coche);
      d.fijar(ctx);
      for (let i = 0; i < pasos; i++) {
        coche.position.z += VEL * dt;
        coche.updateMatrixWorld();
        d.actualizar(ctx, dt);
      }
      return cam.position.clone();
    };
    const rapido = correr(120, 1 / 120);
    const lento = correr(30, 1 / 30);
    const recorridoPorFotograma = VEL / 30;
    expect(rapido.distanceTo(lento)).toBeLessThan(recorridoPorFotograma);
  });
});

describe('Modos', () => {
  it('la cenital mira desde arriba y fija el norte del mundo como arriba', () => {
    const coche = cocheEn(4, 1, -2);
    const p = modoCenital().calcular(ctxDe(coche));
    expect(p.pos.y).toBeGreaterThan(coche.position.y + 10);
    expect(p.mira.distanceTo(coche.position)).toBeLessThan(1e-6);
    // el norte es −Z en este proyecto
    expect(p.arriba.z).toBeCloseTo(-1, 5);
    expect(p.arriba.y).toBeCloseTo(0, 5);
  });

  it('la cinematografica se descentra al lado CONTRARIO al derrape', () => {
    const coche = cocheEn();
    const modo = modoCinematografico();
    // Muchos fotogramas: el descentrado esta suavizado y no salta en uno solo.
    let derecha = null;
    for (let i = 0; i < 200; i++) derecha = modo.calcular(ctxDe(coche, { derrapeGrados: 40 })).pos.clone();
    const modo2 = modoCinematografico();
    let izquierda = null;
    for (let i = 0; i < 200; i++) izquierda = modo2.calcular(ctxDe(coche, { derrapeGrados: -40 })).pos.clone();
    expect(Math.sign(derecha.x)).toBe(-Math.sign(izquierda.x));
    expect(Math.abs(derecha.x)).toBeGreaterThan(1);
  });

  it('la persecucion estira el brazo y abre el angulo con la velocidad', () => {
    const coche = cocheEn();
    const modo = modoPersecucion();
    const parado = modo.calcular(ctxDe(coche, { velocidadKmh: 0 }));
    const dParado = parado.pos.distanceTo(coche.position);
    const fovParado = parado.fov;
    const lanzado = modo.calcular(ctxDe(coche, { velocidadKmh: 260 }));
    expect(lanzado.pos.distanceTo(coche.position)).toBeGreaterThan(dParado);
    expect(lanzado.fov).toBeGreaterThan(fovParado);
  });

  it('todos los modos devuelven una pose finita y un fov usable', () => {
    const coche = cocheEn(12, 3, -7, 1.1);
    for (const m of modosPorDefecto()) {
      for (const v of [0, 120, 260]) {
        const p = m.calcular(ctxDe(coche, { velocidadKmh: v, derrapeGrados: 25, tiempo: 3.7 }));
        for (const c of ['x', 'y', 'z']) {
          expect(Number.isFinite(p.pos[c]), `${m.nombre}.pos.${c}`).toBe(true);
          expect(Number.isFinite(p.mira[c]), `${m.nombre}.mira.${c}`).toBe(true);
        }
        expect(p.fov, m.nombre).toBeGreaterThan(10);
        expect(p.fov, m.nombre).toBeLessThan(120);
      }
    }
  });

  it('ningun modo coloca la camara encima del punto al que mira', () => {
    const coche = cocheEn();
    for (const m of modosPorDefecto()) {
      const p = m.calcular(ctxDe(coche, { velocidadKmh: 60 }));
      expect(p.pos.distanceTo(p.mira), m.nombre).toBeGreaterThan(0.2);
    }
  });
});

describe('DirectorCamara · robustez', () => {
  it('no produce una matriz degenerada aunque el arriba sea paralelo a la vista', () => {
    const cam = nuevaCamara();
    const coche = cocheEn();
    // Modo hostil a proposito: mira recto hacia abajo Y pide arriba = +Y, que es
    // exactamente el caso que rompe lookAt.
    const suicida = {
      nombre: 'suicida', etiqueta: 'X',
      calcular(ctx) {
        return {
          pos: new THREE.Vector3(ctx.cuerpo.position.x, ctx.cuerpo.position.y + 20, ctx.cuerpo.position.z),
          mira: ctx.cuerpo.position.clone(),
          fov: 50,
          arriba: new THREE.Vector3(0, 1, 0),
          kPos: 0, kMira: 0,
        };
      },
    };
    const d = new DirectorCamara(cam, [suicida]);
    const ctx = ctxDe(coche);
    d.fijar(ctx);
    for (let i = 0; i < 30; i++) d.actualizar(ctx, 1 / 60);
    const e = cam.matrixWorld.elements;
    expect(e.every(Number.isFinite)).toBe(true);
    expect(Math.abs(cam.matrixWorld.determinant())).toBeGreaterThan(1e-3);
  });
});
