/* ==========================================================================
   HIGHWAY RACER · Glorieta — prueba de conduccion
   --------------------------------------------------------------------------
   Primer entregable: el coche rodando. Sin humo, sin marcas, sin audio.
   El objetivo es unico — sentir si la direccion va bien encaminada.
   ========================================================================== */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { SteeringModel, PedalModel, clamp, lerp } from './steering.js';
import { Powertrain } from './powertrain.js';
import { Vehicle } from './vehicle.js';
import { buildRoundabout, buildLighting, GEO } from './scene.js';

const $ = s => document.querySelector(s);
const setMsg = t => { const e = $('#boot'); if (e) e.textContent = t; };

// --------------------------------------------------------------- renderer
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e14);
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 600);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ------------------------------------------------------------------ mandos
const keys = Object.create(null);
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyR') vehicle?.respawn(new THREE.Vector3(0, 0.06, GEO.islandR + 4.5));
  if (e.code === 'KeyC') cockpit = !cockpit;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });

const axis = () => ({
  throttle: (keys.KeyW || keys.ArrowUp) ? 1 : 0,
  brake:    (keys.KeyS || keys.ArrowDown) ? 1 : 0,
  steer:    ((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0),
  hand:     !!keys.Space,
});

// ------------------------------------------------------------------- estado
const steering = new SteeringModel();
const throttleM = new PedalModel();
const brakeM    = new PedalModel();
const engine    = new Powertrain();
let vehicle = null, cockpit = false;

// --------------------------------------------------------------------- boot
async function boot() {
  setMsg('Iniciando motor de fisica…');
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.integrationParameters.numSolverIterations = 8;

  setMsg('Construyendo la glorieta…');
  const sun = buildLighting(scene, renderer);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  buildRoundabout(scene, RAPIER, world);

  setMsg('Cargando CarConcept…');
  const gltf = await new GLTFLoader().loadAsync('../modelos/CarConcept.glb');
  gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(gltf.scene);

  vehicle = new Vehicle(RAPIER, world, gltf.scene, {
    spawn: new THREE.Vector3(0, 0.06, GEO.islandR + 4.5),
  });

  $('#boot').style.display = 'none';
  $('#hud').style.display = 'block';
  resize();

  // Consola de trabajo: HR.vehicle, HR.steering, HR.engine, HR.scene…
  window.HR = { vehicle, scene, camera, world, RAPIER, steering, engine, THREE };

  // ------------------------------------------------------------- bucle
  const STEP = 1 / 60;
  let acc = 0, last = performance.now(), fps = 60;
  const camPos = new THREE.Vector3(0, 4, -10);
  const camAim = new THREE.Vector3();

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    fps = lerp(fps, 1 / Math.max(dt, 1e-4), 0.06);

    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 4) {
      tick(STEP, world);
      acc -= STEP;
      steps++;
    }
    updateCamera(dt, camPos, camAim);
    sun.position.set(vehicle.bodyRoot.position.x + 28, 38, vehicle.bodyRoot.position.z + 18);
    sun.target.position.copy(vehicle.bodyRoot.position);
    sun.target.updateMatrixWorld();

    renderer.render(scene, camera);
    hud(fps);
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------- fisica
function tick(dt, world) {
  const a = axis();
  const speed = vehicle.forwardSpeedKmh;
  const slip = vehicle.yawSlipDeg;

  // 1. El volante: la cadena exacta del C++.
  const steer = steering.update(a.steer, speed, slip, dt);
  vehicle.setSteerForVisual(steering.rawCurrent);

  // 2. Pedales suavizados.
  const th = throttleM.update(a.throttle, dt);
  const br = brakeM.update(a.brake, dt);

  // 3. Motor y caja a partir del giro real de las ruedas motrices.
  const wheelRads = Math.abs(vehicle.speedKmh / 3.6) / vehicle.wheelRadius;
  const out = engine.update(th, wheelRads, dt);

  vehicle.drive(steer, out.torque ?? 0, br, a.hand);
  vehicle.applyAero();
  vehicle.sync(dt);
  world.step();

  last_tel = {
    speed: Math.abs(speed), rpm: out.rpm, gear: engine.gearLabel,
    steer: steering.rawCurrent, authority: steering.lastAuthority,
    slip, th, br, hand: a.hand, ...vehicle.slipRatios(),
  };
}

// ------------------------------------------------------------------- camara
function updateCamera(dt, camPos, camAim) {
  const b = vehicle.bodyRoot;
  const speed = vehicle.speedKmh;
  const t = clamp(speed / 260, 0, 1);

  if (cockpit) {
    const off = new THREE.Vector3(0.38, 1.02, 0.15).applyQuaternion(b.quaternion);
    camera.position.copy(b.position).add(off);
    const look = new THREE.Vector3(0, 0.95, 8).applyQuaternion(b.quaternion).add(b.position);
    camera.lookAt(look);
    camera.fov = 72;
    camera.updateProjectionMatrix();
    return;
  }

  // Brazo que se estira con la velocidad: da sensacion de aceleracion.
  const boom = lerp(6.2, 7.8, t);
  const want = new THREE.Vector3(0, 2.55, -boom).applyQuaternion(b.quaternion).add(b.position);
  camPos.lerp(want, 1 - Math.pow(0.0016, dt));          // retardo tipo CameraLag
  camAim.lerp(b.position.clone().setY(b.position.y + 0.9), 1 - Math.pow(0.0006, dt));
  camera.position.copy(camPos);
  camera.lookAt(camAim);

  const fov = lerp(58, 70, t);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

// ---------------------------------------------------------------------- hud
let last_tel = null;
function hud(fps) {
  if (!last_tel) return;
  const t = last_tel;
  const bar = (v, n = 14) => '█'.repeat(Math.round(clamp(v, 0, 1) * n)).padEnd(n, '·');
  $('#hud').innerHTML =
    `<div class="big">${t.speed.toFixed(0)}<i>km/h</i>` +
    `<span class="g">${t.gear}</span></div>` +
    `<div class="r"><span>rpm</span><b>${t.rpm.toFixed(0)}</b></div>` +
    `<div class="r"><span>volante</span><b>${(t.steer * 100).toFixed(0)}%</b></div>` +
    `<div class="r"><span>autoridad</span><b>${(t.authority * 100).toFixed(0)}%</b></div>` +
    `<div class="r hl"><span>ángulo de derrape</span><b>${t.slip.toFixed(1)}°</b></div>` +
    `<div class="r"><span>desliz. trasero</span><b class="m">${bar(t.rear)}</b></div>` +
    `<div class="r"><span>desliz. delantero</span><b class="m">${bar(t.front)}</b></div>` +
    `<div class="r"><span>acelerador</span><b class="m">${bar(t.th)}</b></div>` +
    `<div class="r"><span>freno</span><b class="m">${bar(t.br)}${t.hand ? ' MANO' : ''}</b></div>` +
    `<div class="r dim"><span>fps</span><b>${fps.toFixed(0)}</b></div>`;
}

boot().catch(e => {
  console.error(e);
  setMsg('Fallo al arrancar: ' + e.message);
});
