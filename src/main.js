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

import { SteeringModel, PedalModel } from './vehicle/steering.js';
import { Powertrain } from './vehicle/powertrain.js';
import { Vehicle } from './vehicle/vehicle.js';
import { buildRoundabout, buildLighting, GEO } from './world/roundabout.js';
import {
  CiudadFotorrealista, construirCalzadaOSM, radioEjeOSM,
  muestrearRelieve, suavizarRelieve, alturaEnRelieve,
} from './world/photoreal.js';
import { instalarCielo, alinearSol } from './world/cielo.js';
import { DirectorCamara } from './camera/director.js';
import { modosPorDefecto } from './camera/modos.js';
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
// Diagnostico: la clave NUNCA se expone, solo si llego y cuanto mide. Sin esto,
// "Vite no cargo .env.local" y "Google rechazo la clave" se ven exactamente
// igual desde fuera: la escena cae al respaldo procedural y no dice por que.
if (typeof window !== 'undefined') {
  window.__HR_ENV = { escena: ESCENA, claveLongitud: CLAVE_TILES.length };
}
const SPAWN = new THREE.Vector3(0, 0.06, GEO.islandR + 4.5);
const $ = s => document.querySelector(s);
const boot = t => { const e = $('#boot'); if (e) e.textContent = t; };

// ALCANCE DE LA CAMARA: los 600 m valian para una glorieta de 71 m envuelta en
// niebla. En Medellin fotorrealista ese plano lejano dejaba FUERA del frustum
// todos los volumenes de las teselas de Google — que son de escala planetaria —
// y el arbol no refinaba nunca: 0 teselas visibles y un suelo fantasma a −19 km.
// Medido: subiendo solo este valor, inFrustum pasa de 0 a 91 y visible de 0 a 33.
const LEJOS = ESCENA === 'pilsen' ? 20000 : 600;

const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance',
  // 0,1 m de cerca y 20 km de lejos son 200.000:1: un buffer de profundidad
  // normal no da para eso y el z-fighting se come la ciudad. Solo se paga en
  // la escena que lo necesita.
  logarithmicDepthBuffer: ESCENA === 'pilsen',
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e14);
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, LEJOS);

function resize() {
  // UNA VENTANA DE ALTURA CERO ENVENENA TODO EL MOTOR. Pasa al minimizar, y en
  // paneles embebidos que se ocultan sin descargar la pagina. Sin la guarda:
  // aspect = 0/0 = NaN -> matriz de proyeccion NaN -> TODOS los tests de frustum
  // fallan -> el renderer de teselas no marca ninguna en uso -> la cache
  // descarga Medellin entera y no vuelve sola aunque se restaure la ventana.
  const ancho = Math.max(1, innerWidth);
  const alto = Math.max(1, innerHeight);
  renderer.setSize(ancho, alto, false);
  camera.aspect = ancho / alto;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

const input = new Input();
const steering = new SteeringModel();
const throttleM = new PedalModel();
const brakeM = new PedalModel();
const engine = new Powertrain();
const audio = new EngineAudio();

let vehicle, loop, hud, sun, fx, director, ciudad = null, paused = false;
let interfazVisible = true;
/** Contexto que se le pasa al director; se reutiliza para no asignar por frame. */
const ctxCamara = { cuerpo: null, velocidadKmh: 0, derrapeGrados: 0, tiempo: 0 };
let tiempoVolcado = 0;
const TIEMPO_VUELCO = 2.5;   // segundos boca arriba antes de reponer
let tel = null;
// El sol persigue al coche para que su sombra siempre este dentro del encuadre
// de la shadow map, pero su DIRECCION la manda la escena: en Medellin la fija
// el cielo atmosferico, y si aqui se dejara el offset fijo de antes la sombra
// del coche apuntaria a un sol distinto del que se ve pintado arriba.
const DIR_SOL = new THREE.Vector3(28, 38, 18).normalize();
const DIST_SOL = 50;

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

  let spawn = null;
  if (ESCENA === 'pilsen' && CLAVE_TILES) {
    spawn = await montarMedellin(world);
    if (!spawn) {
      boot('Las teselas no llegaron. Revisa la clave y la facturación.');
      await new Promise(r => setTimeout(r, 2600));
    }
  } else if (ESCENA === 'pilsen') {
    boot('Falta VITE_GOOGLE_3D_TILES_KEY en .env.local — usando la glorieta procedural');
    await new Promise(r => setTimeout(r, 2200));
  }
  // Un fallo de red o de clave no puede dejar el juego sin suelo: siempre hay
  // glorieta procedural debajo.
  if (!spawn) {
    boot('Construyendo la glorieta…');
    buildRoundabout(scene, RAPIER, world);
    spawn = SPAWN.clone();
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

  director = new DirectorCamara(camera, modosPorDefecto());
  ctxCamara.cuerpo = vehicle.bodyRoot;
  vehicle.render(1);
  director.fijar(ctxCamara);

  loop = new FixedLoop({
    step: STEP, maxSteps: 6, maxFrame: 0.1,
    fixed: dt => { if (!paused) simular(dt, world); },
    render: (alpha, dt) => { if (ciudad) ciudad.update(); presentar(alpha, dt); },
  });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) loop.resync(); });

  window.HR = { vehicle, scene, camera, renderer, world, RAPIER, steering, engine, input, loop, audio, fx, ciudad, director,
    reiniciar, get telemetria() { return tel; },
    /** Pinta un cuadro suelto con el bucle parado (inspeccion visual). */
    pintar: () => renderer.render(scene, camera) };

  loop.start();
}

/**
 * Monta Medellin fotorrealista y devuelve el punto de aparicion del coche,
 * o null si las teselas no llegaron (clave mala, sin facturacion, sin red).
 *
 * El orden importa: primero se MIDE donde esta el asfalto de verdad y se ancla
 * el globo a esa altura, y solo despues se crean los colisionadores. Al reves
 * el coche aparece flotando o enterrado — o, como pasaba antes, a 19 km bajo
 * tierra sobre la malla del globo sin refinar.
 */
async function montarMedellin(world) {
  boot('Cargando la Glorieta Pilsen…');
  const pista = await fetch(import.meta.env.BASE_URL + 'data/glorieta-pilsen.json')
    .then(r => r.json());

  boot('Conectando con Google Photorealistic 3D Tiles…');
  ciudad = new CiudadFotorrealista(scene, camera, renderer, pista, CLAVE_TILES);
  ciudad.onAtribucion = txt => { const e = $('#atrib'); if (e) e.textContent = txt; };
  ciudad.onProgreso = s => boot(
    `Descargando Medellín… ${s.visible} teselas en pantalla, ${s.downloading} en vuelo`);

  const radio = radioEjeOSM(pista);
  const medida = await ciudad.anclarEnElSuelo(radio);
  if (!medida) {
    console.error('[medellin] sin geometria. Errores de carga:', ciudad.errores.slice(0, 5));
    ciudad.dispose();
    ciudad = null;
    return null;
  }
  console.info('[medellin] asfalto anclado', medida);

  // El suelo de colision se MIDE sobre la fotogrametria: la glorieta real tiene
  // 2,76 m de desnivel y ni un disco plano ni un plano inclinado la aproximan.
  boot('Midiendo el relieve real de la glorieta…');
  await new Promise(r => setTimeout(r, 32));   // que el texto llegue a pintarse
  const t0 = performance.now();
  const crudo = muestrearRelieve(ciudad, { lado: 150, celdas: 128 });
  const relieve = { ...crudo, alturas: suavizarRelieve(crudo.alturas, crudo.n, 2) };
  console.info('[medellin] relieve', {
    muestras: crudo.n * crudo.n,
    huecosSinTapar: crudo.huecos,
    ms: Math.round(performance.now() - t0),
  });

  const calz = construirCalzadaOSM(scene, RAPIER, world, pista, relieve, medida.alturaSuelo);

  // Cielo real en lugar del vacio negro, y de paso el entorno que refleja el
  // coche deja de ser un estudio de interior y pasa a ser el cielo de encima.
  const cielo = instalarCielo(renderer, scene);
  DIR_SOL.copy(cielo.direccionSol);
  alinearSol(sun, cielo.direccionSol, { distancia: DIST_SOL });
  scene.fog = null;

  boot('');
  // Aparecer en la calzada, no en la isleta, y a la altura que de verdad va a
  // sostener el heightfield en ESE punto — no a la media de la glorieta.
  const ySpawn = alturaEnRelieve(relieve, 0, calz.radioEje);
  return new THREE.Vector3(0, ySpawn + 0.30, calz.radioEje);
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
  if (input.justPressed('camera')) { director.siguiente(); hud.avisarCamara(director.etiqueta); }
  if (input.justPressed('pause')) paused = !paused;
  if (input.justPressed('mute')) audio.setEnabled(!audio.enabled);
  if (input.justPressed('hud')) alternarInterfaz();

  if (tel) {
    fx.update(tel, dt);
    audio.update(tel, dt);
  }

  ctxCamara.cuerpo = vehicle.bodyRoot;
  ctxCamara.velocidadKmh = vehicle.speedKmh;
  ctxCamara.derrapeGrados = tel ? tel.slip : 0;
  director.actualizar(ctxCamara, dt);

  const b = vehicle.bodyRoot.position;
  sun.position.copy(b).addScaledVector(DIR_SOL, DIST_SOL);
  sun.target.position.copy(b);
  sun.target.updateMatrixWorld();

  renderer.render(scene, camera);
  if (tel) hud.update(tel, dt, { fps: loop.fps, steps: loop.lastSteps, dropped: loop.dropped });
}

/**
 * Oculta o muestra la interfaz para grabar.
 *
 * OJO: la barra de atribucion NO se toca. Mostrar la procedencia de las teselas
 * es una condicion de la licencia de Google, no un adorno del HUD.
 */
function alternarInterfaz() {
  interfazVisible = !interfazVisible;
  for (const sel of ['#hud', '#help', '#brand']) {
    const el = $(sel);
    if (el) el.style.display = interfazVisible ? '' : 'none';
  }
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
  // Sin esto la camara viaja desde donde se quedo el coche accidentado hasta la
  // reaparicion, barriendo media ciudad delante del jugador.
  if (director) {
    vehicle.render(1);
    ctxCamara.cuerpo = vehicle.bodyRoot;
    ctxCamara.velocidadKmh = 0;
    ctxCamara.derrapeGrados = 0;
    director.fijar(ctxCamara);
  }
}

main().catch(e => {
  console.error(e);
  boot('Fallo al arrancar: ' + e.message);
});
