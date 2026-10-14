/* ==========================================================================
   Pruebas del normalizador de carros descargados.

   Un modelo de Sketchfab llega con nombres como "Object_42", a cualquier
   escala y con medio coche pintado por un solo material. Estas pruebas montan
   un carro de cajas y cilindros asi de anonimo y comprueban lo que el juego
   necesita: largo exacto, en el suelo, cuatro ruedas bien bautizadas y unos
   pilotos que no encienden la carroceria entera.
   ========================================================================== */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { normalizarCarro } from '../src/vehicle/normalizar.js';

/** Un carro de juguete a escala de centimetros, como exportan muchos. */
function carroAnonimo({ pilotoCompartido = false } = {}) {
  const raiz = new THREE.Group();
  raiz.scale.setScalar(100);   // el autor trabajo en centimetros
  const pintura = new THREE.MeshStandardMaterial({ color: 0x2255aa, name: 'Object_mat_0' });
  const goma = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const rojo = new THREE.MeshStandardMaterial({ color: 0xcc0000 });
  let n = 0;
  const malla = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = 'Object_' + (n++);
    m.position.set(x, y, z);
    raiz.add(m);
    return m;
  };
  // Carroceria de 4.6 x 1.9 x 1.0 m, por encima de las ruedas.
  malla(new THREE.BoxGeometry(0.019, 0.010, 0.046), pintura, 0, 0.0075, 0);
  // Ruedas: cilindros con el eje en X, radio 0.34 m.
  const rueda = new THREE.CylinderGeometry(0.0034, 0.0034, 0.0024, 24).rotateZ(Math.PI / 2);
  for (const [x, z] of [[0.0082, 0.0145], [-0.0082, 0.0145], [0.0082, -0.0145], [-0.0082, -0.0145]]) {
    malla(rueda, goma, x, 0.0034, z);
  }
  // Pilotos traseros pequeños y rojos.
  const piloto = new THREE.BoxGeometry(0.004, 0.001, 0.0005);
  malla(piloto, rojo, 0.006, 0.010, -0.0232);
  malla(piloto, rojo, -0.006, 0.010, -0.0232);
  // Un material compartido con la carroceria NO puede contar como piloto.
  if (pilotoCompartido) malla(piloto, pintura, 0, 0.011, -0.0232);
  return { raiz, pintura, rojo };
}

describe('normalizarCarro', () => {
  it('lo escala al largo de la ficha y lo pone en el suelo', () => {
    const { raiz } = carroAnonimo();
    const { medidas } = normalizarCarro(raiz, { id: 'x', largo: 4.8 });
    expect(medidas.largo).toBeCloseTo(4.8, 2);
    const caja = new THREE.Box3().setFromObject(raiz.parent.parent);
    expect(caja.min.y).toBeCloseTo(0, 3);
    expect((caja.min.z + caja.max.z) / 2).toBeCloseTo(0, 3);
  });

  it('encuentra las cuatro ruedas por su forma aunque se llamen Object_N', () => {
    const { raiz } = carroAnonimo();
    const { medidas, raiz: carro } = normalizarCarro(raiz, { id: 'x', largo: 4.8 });
    const nombres = medidas.ruedas.map(r => r.nombre).sort();
    expect(nombres).toEqual(['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR']);
    // +X es la izquierda del coche y +Z su frente.
    const fl = medidas.ruedas.find(r => r.nombre === 'WheelFrontL');
    expect(fl.x).toBeGreaterThan(0);
    expect(fl.z).toBeGreaterThan(0);
    // Cada nodo tiene su rueda dentro, para que Vehicle la pueda girar.
    for (const n of nombres) expect(carro.getObjectByName(n).children.length).toBe(1);
    // El buje queda a un radio del suelo.
    for (const r of medidas.ruedas) expect(r.y).toBeCloseTo(r.radio, 2);
  });

  it('gira el modelo los cuartos de vuelta que diga la ficha', () => {
    const { raiz } = carroAnonimo();
    const { medidas } = normalizarCarro(raiz, { id: 'x', largo: 4.8, giro: 1 });
    // Mirando de lado, el "largo" del modelo pasa a ser su ancho original.
    expect(medidas.largo).toBeCloseTo(4.8, 2);
    expect(medidas.ancho).toBeGreaterThan(medidas.largo);
  });

  it('enciende los pilotos rojos y nunca un material de la carroceria', () => {
    const { raiz, pintura, rojo } = carroAnonimo({ pilotoCompartido: true });
    const { pilotos } = normalizarCarro(raiz, { id: 'x', largo: 4.8 });
    expect(pilotos).toContain(rojo);
    expect(pilotos).not.toContain(pintura);
  });
});
