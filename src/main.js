/* ==========================================================================
   HIGHWAY RACER · Arranque y orquestacion
   --------------------------------------------------------------------------
   Aqui solo se cablea. La simulacion vive en src/vehicle, el escenario en
   src/world, el bucle en src/core, la presentacion en src/ui.
   ========================================================================== */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { SteeringModel, PedalModel, clamp, lerp } from './vehicle/steering.js';
import { Powertrain } from './vehicle/powertrain.js';
import { Vehicle } from './vehicle/vehicle.js';
import { buildRoundabout, buildLighting, GEO } from './world/roundabout.js';
import { CiudadFotorrealista, construirCalzadaOSM } from './world/photoreal.js';
import { FixedLoop } from './core/loop.js';
import { Input } from './core/input.js';
import { Hud } from './ui/hud.js';
import { EngineAudio } from './audio/engine.js';
import { VehicleFX } from './vfx/vehicle-fx.js';

const STEP = 1 / 60;

// ?escena=pilsen  -> Medellin fotorrealista sobre la Glorieta Pilsen
// (por defecto)   -> glorieta procedural, gratis e ilimitada
const ESCENA = new URLSearchParams(location.search).get('escena') ?? 'proc';
const CLAVE_TILES = import.meta.env.VITE_GOOGLE_3D_TILES_KEY ?? '';
const SPAWN = new THREE.Vector3(0, 0.06, GEO.islandR + 4.5);
const $ = s => document.querySelector(s);
const boot = t => { const e = $('#boot'); if (e) e.textContent = t; };

const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e14);
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 600);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

const input = new Input();
const steering = new SteeringModel();
const throttleM = new PedalModel();
const brakeM = new PedalModel();
const engine = new Powertrain();
const audio = new EngineAudio();

let vehicle, loop, hud, sun, fx, ciudad = null, cockpit = false, paused = false;
let tiempoVolcado = 0;
const TIEMPO_VUELCO = 2.5;   // segundos boca arriba antes de reponer
let tel = null;
const camPos = new THREE.Vector3(0, 4, -10);
const camAim = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

async function main() {
  boot('Iniciando motor de física…');
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  // Una sola fuente de verdad del paso. world.step() no acepta dt: integra con
  // world.timestep. Coincidia con STEP por casualidad del valor por defecto.
  world.timestep = STEP;
  world.integrationParameters.numSolverIterations = 8;

  sun = buildLighting(scene, renderer);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  let spawn = SPAWN;
  if (ESCENA === 'pilsen' && CLAVE_TILES) {
    spawn = await montarMedellin(world);
  } else {
    if (ESCENA === 'pilsen') {
      boot('Falta VITE_GOOGLE_3D_TILES_KEY en .env.local — usando la glorieta procedural');
      await new Promise(r => setTimeout(r, 2200));
    }
    boot('Construyendo la glorieta…');
    buildRoundabout(scene, RAPIER, world);
  }

  boot('Cargando CarConcept…');
  const gltf = await new GLTFLoader().loadAsync(
    import.meta.env.BASE_URL + 'models/CarConcept.glb');
  gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(gltf.scene);

  vehicle = new Vehicle(RAPIER, world, gltf.scene, { spawn });
  SPAWN.copy(spawn);
  fx = new VehicleFX(scene, vehicle);

  // El navegador exige un gesto del usuario para dejar sonar audio.
  const arrancarAudio = () => { audio.start(); };
  addEventListener('pointerdown', arrancarAudio, { once: true });
  addEventListener('keydown', arrancarAudio, { once: true });

  $('#boot').style.display = 'none';
  hud = new Hud($('#hud'));
  resize();

  loop = new FixedLoop({
    step: STEP, maxSteps: 6, maxFrame: 0.1,
    fixed: dt => { if (!paused) simular(dt, world); },
    render: (alpha, dt) => { if (ciudad) ciudad.update(); presentar(alpha, dt); },
  });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) loop.resync(); });

  window.HR = { vehicle, scene, camera, renderer, world, RAPIER, steering, engine, input, loop, audio, fx, ciudad,
    reiniciar, get telemetria() { return tel; },
    /** Pinta un cuadro suelto con el bucle parado (inspeccion visual). */
    pintar: () => renderer.render(scene, camera) };

  loop.start();
}

/**
 * Monta Medellin fotorrealista y devuelve el punto de aparicion del coche.
 * Espera a que las teselas den una altura de suelo REAL antes de construir
 * los colisionadores: adivinarla deja el coche flotando o enterrado.
 */
async function montarMedellin(world) {
  boot('Cargando la Glorieta Pilsen…');
  const pista = await fetch(import.meta.env.BASE_URL + 'data/glorieta-pilsen.json')
    .then(r => r.json());

  boot('Conectando con Google Photorealistic 3D Tiles…');
  ciudad = new CiudadFotorrealista(scene, camera, renderer, pista, CLAVE_TILES);
  ciudad.onAtribucion = txt => { const e = $('#atrib'); if (e) e.textContent = txt; };

  // La camara tiene que estar donde estara el coche o las teselas de esa zona
  // no se piden: el streaming es por error de pantalla, no por proximidad.
  camera.position.set(0, 60, 90);
  camera.lookAt(0, 0, 0);

  const t0 = performance.now();
  while (!ciudad.listo) {
    ciudad.update();
    renderer.render(scene, camera);
    boot(`Descargando Medellín… ${ciudad.cargando} teselas`);
    await new Promise(r => requestAnimationFrame(r));
    if (performance.now() - t0 > 30000) {
      boot('Las teselas tardan demasiado. Revisa la clave y la facturación.');
      await new Promise(r => setTimeout(r, 3000));
      break;
    }
  }

  const y = ciudad.alturaSuelo ?? 0;
  const calz = construirCalzadaOSM(scene, RAPIER, world, pista, y);
  // El sol del escenario procedural estorba aqui: la fotogrametria ya viene
  // con su iluminacion horneada. Se baja a relleno suave.
  sun.intensity = 0.55;
  scene.fog = null;
  scene.background = new THREE.Color(0x0a0e14);

  boot('');
  // Aparecer en la calzada, no en la isleta.
  return new THREE.Vector3(0, y + 0.30, calz.radioEje);
}

// ------------------------------------------------------------------ fisica
function simular(dt, world) {
  const a = input.sample();
  const fwdKmh = vehicle.forwardSpeedKmh;
  const slip = vehicle.yawSlipDeg;

  // --- marcha atras: se engrana casi parado, como una caja real ----------
  let acelerar = a.throttle, frenar = a.brake;
  if (engine.gear > 0 && fwdKmh < 1.5 && a.brake > 0.5) engine.engageReverse(fwdKmh);
  else if (engine.gear < 0 && fwdKmh > -1.5 && a.throttle > 0.5) engine.engageForward(fwdKmh);
  if (engine.gear < 0) { acelerar = a.brake; frenar = a.throttle; }

  // --- volante: la cadena exacta del C++ ---------------------------------
  const steer = steering.update(a.steer, fwdKmh, slip, dt);
  const th = throttleM.update(acelerar, dt);
  const br = brakeM.update(frenar, dt);

  // El regimen sale del giro REAL del eje motriz: al quemar rueda sube.
  const out = engine.update(th, vehicle.driveWheelRads, dt);

  vehicle.setControls(steer, out.torque, br, a.handbrake);
  vehicle.applyAero();
  vehicle.stepControls(dt);
  world.step();
  vehicle.capture();

  // Todo el HUD describe UN solo instante: los deslizamientos se leen aqui,
  // junto al resto, no mezclados con valores del paso anterior.
  const slips = vehicle.slipRatios();
  tel = {
    speed: Math.abs(fwdKmh), rpm: out.rpm, gear: engine.gearLabel,
    steer: steering.rawCurrent, authority: steering.lastAuthority, slip,
    throttle: th, brake: br, handbrake: a.handbrake, analog: a.analog,
    front: slips.front, rear: slips.rear, airborne: slips.airborne,
    upsideDown: vehicle.isUpsideDown,
    // lo que consumen audio y efectos
    gearNum: engine.gear, normalizedRPM: engine.normalizedRPM,
    load: out.load, rpmDeltaPerSec: out.rpmDeltaPerSec,
    onLimiter: out.onLimiter, shifting: out.shifting,
    slipRear: slips.rear, speedKmh: Math.abs(fwdKmh),
  };

  // --- recuperacion automatica -------------------------------------------
  if (vehicle.body.translation().y < -20) { reiniciar(); return; }

  // Volcado: un coche boca arriba no se endereza solo. Se le da un margen
  // para que el jugador vea lo que ha pasado y luego se le devuelve a la via.
  if (tel.upsideDown && vehicle.speedKmh < 8) {
    tiempoVolcado += dt;
    tel.recuperandoEn = Math.max(0, TIEMPO_VUELCO - tiempoVolcado);
    if (tiempoVolcado >= TIEMPO_VUELCO) reiniciar();
  } else {
    tiempoVolcado = 0;
  }
}

// --------------------------------------------------------------- presentar
function presentar(alpha, dt) {
  vehicle.render(alpha);

  if (input.justPressed('respawn')) reiniciar();
  if (input.justPressed('camera')) cockpit = !cockpit;
  if (input.justPressed('pause')) paused = !paused;
  if (input.justPressed('mute')) audio.setEnabled(!audio.enabled);

  if (tel) {
    fx.update(tel, dt);
    audio.update(tel, dt);
  }

  actualizarCamara(dt);

  const b = vehicle.bodyRoot.position;
  sun.position.set(b.x + 28, 38, b.z + 18);
  sun.target.position.copy(b);
  sun.target.updateMatrixWorld();

  renderer.render(scene, camera);
  if (tel) hud.update(tel, dt, { fps: loop.fps, steps: loop.lastSteps, dropped: loop.dropped });
}

function actualizarCamara(dt) {
  const b = vehicle.bodyRoot;
  const t = clamp(vehicle.speedKmh / 260, 0, 1);

  if (cockpit) {
    tmpV.set(0.38, 1.02, 0.15).applyQuaternion(b.quaternion);
    camera.position.copy(b.position).add(tmpV);
    tmpV2.set(0, 0.95, 8).applyQuaternion(b.quaternion).add(b.position);
    camera.lookAt(tmpV2);
    if (camera.fov !== 72) { camera.fov = 72; camera.updateProjectionMatrix(); }
    return;
  }

  // El brazo se estira con la velocidad: da sensacion de aceleracion.
  const boom = lerp(6.2, 7.8, t);
  tmpV.set(0, 2.55, -boom).applyQuaternion(b.quaternion).add(b.position);
  camPos.lerp(tmpV, 1 - Math.pow(0.0016, dt));
  tmpV2.copy(b.position); tmpV2.y += 0.9;
  camAim.lerp(tmpV2, 1 - Math.pow(0.0006, dt));
  camera.position.copy(camPos);
  camera.lookAt(camAim);

  const fov = lerp(58, 70, t);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

/** Reinicia TODO el estado, no solo el cuerpo rigido. */
function reiniciar() {
  vehicle.respawn(SPAWN, 0);
  tiempoVolcado = 0;
  if (fx) fx.clear();
  steering.reset();
  throttleM.reset();
  brakeM.reset();
  engine.reset();
  if (loop) loop.resync();
}

main().catch(e => {
  console.error(e);
  boot('Fallo al arrancar: ' + e.message);
});
