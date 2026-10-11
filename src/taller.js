/* Sala de exhibicion de la flota. Solo para desarrollo: no entra en la
   compilacion publica (vite.config solo compila index.html). */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TIPOS, TIPOS_PERSECUCION, fabricar } from './traffic/flota.js';
import { materialFlota, geometriaRueda, prepararInstancias } from './traffic/modelado.js';
import { instalarCielo, alinearSol } from './world/cielo.js';

// Las calcomanias se dibujan con estas fuentes: hay que esperarlas.
await Promise.race([
  Promise.all([document.fonts.load('64px "Russo One"'), document.fonts.load('bold 64px Rajdhani')]),
  new Promise(r => setTimeout(r, 3000)),
]);
const canvas = document.querySelector('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
const controls = new OrbitControls(camera, canvas);

const cielo = instalarCielo(renderer, scene, { elevacion: 34, azimut: 128, turbidez: 3.6, intensidadFondo: 0.3, intensidadEntorno: 0.65 });
const sol = new THREE.DirectionalLight(0xfff4e2, 3.6);
sol.castShadow = true;
sol.shadow.mapSize.set(4096, 4096);
Object.assign(sol.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 200 });
sol.shadow.bias = -0.0004;
scene.add(sol, sol.target);
alinearSol(sol, cielo.direccionSol, { distancia: 80, intensidad: 3.6 });

const suelo = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.9 }));
suelo.rotation.x = -Math.PI / 2;
suelo.receiveShadow = true;
scene.add(suelo);

const mat = materialFlota({ fisico: !new URLSearchParams(location.search).has('simple') });
const geoAuto = geometriaRueda();
const geoCamion = geometriaRueda({ camion: true });
const ruedasAuto = [], ruedasCamion = [];
let x = 0;
const filas = [];
for (const tipo of [...TIPOS, ...Object.values(TIPOS_PERSECUCION)]) {
  const t0 = performance.now();
  const m = fabricar(tipo, new URLSearchParams(location.search).has('lejos') ? 0.35 : 1);
  const ms = performance.now() - t0;
  const malla = new THREE.InstancedMesh(m.geometria, mat, 1);
  const inst = prepararInstancias(malla);
  const col = new THREE.Color(tipo.paleta[0]);
  inst.tinte1.setXYZ(0, col.r, col.g, col.b);
  const col2 = new THREE.Color((tipo.paleta2 ?? [0xeeeeee])[0]);
  inst.tinte2.setXYZ(0, col2.r, col2.g, col2.b);
  inst.estado.setXYZ(0, 1, 1, 1);
  malla.castShadow = malla.receiveShadow = true;
  const pos = new THREE.Vector3(x + m.ancho / 2, 0, 0);
  malla.setMatrixAt(0, new THREE.Matrix4().makeTranslation(pos.x, 0, 0));
  scene.add(malla);
  for (const w of m.ruedas) (w.camion ? ruedasCamion : ruedasAuto).push({ ...w, cx: pos.x });
  malla.userData.id = tipo.id;
  filas.push({ id: tipo.id, malla, x: pos.x, largo: m.largo, ancho: m.ancho, alto: m.alto,
    tris: m.geometria.getAttribute('position').count / 3, ms: Math.round(ms) });
  x += m.ancho + 2.2;
}
for (const [lista, geo] of [[ruedasAuto, geoAuto], [ruedasCamion, geoCamion]]) {
  const im = new THREE.InstancedMesh(geo, mat, lista.length);
  const inst = prepararInstancias(im);
  im.castShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  lista.forEach((w, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), w.x < 0 ? Math.PI : 0);
    s.set(w.ancho, w.r, w.r);
    p.set(w.cx + w.x, w.r, w.z);
    im.setMatrixAt(i, m4.compose(p, q, s));
    inst.tinte1.setXYZ(i, 0.8, 0.8, 0.8);
  });
  scene.add(im);
}
console.table(filas);
window.FILAS = filas;
const centro = x / 2;
camera.position.set(centro, 6, 22);
controls.target.set(centro, 1, 0);
sol.target.position.set(centro, 0, 0);
sol.position.copy(cielo.direccionSol).multiplyScalar(80).add(sol.target.position);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

/** Encuadra un vehiculo: vista 3/4 delantera o trasera. */
window.ver = (id, lado = 'frente', dist = 1) => {
  const f = filas.find(f => f.id === id);
  const d = Math.max(f.largo, 4) * 0.9 * dist;
  const zs = lado === 'frente' ? 1 : -1;
  camera.position.set(f.x + d * 0.42, f.alto * 0.9 + 0.7, zs * (f.largo / 2 + d * 0.95));
  controls.target.set(f.x, f.alto * 0.42, zs * f.largo * 0.08);
  controls.update();
};
/** Deja solo un vehiculo a la vista (para mirar sus costados). */
window.solo = (id) => {
  for (const f of filas) f.malla.visible = !id || f.id === id;
  scene.traverse(o => { if (o.isInstancedMesh && !o.userData.id) o.visible = !id; });
};
/** Vista de costado (lado +1 izquierdo, -1 derecho). */
window.lado = (id, s = 1, k = 1) => {
  window.solo(id);
  const f = filas.find(f => f.id === id);
  const d = Math.max(f.largo, 4) * 0.95 * k;
  camera.position.set(f.x + s * d, f.alto * 0.7 + 0.4, -f.largo * 0.12);
  controls.target.set(f.x, f.alto * 0.5, 0);
  controls.update();
};
window.foto = async (n) => {
  renderer.render(scene, camera);
  const d = canvas.toDataURL('image/jpeg', 0.88);
  return fetch('http://localhost:8199/?n=' + n, { method: 'POST', body: d }).then(r => r.text());
};
