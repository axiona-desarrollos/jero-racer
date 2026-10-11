/* ==========================================================================
   JERO RACER · Arranque y orquestacion
   --------------------------------------------------------------------------
   Aqui solo se cablea. La simulacion vive en src/vehicle, el escenario en
   src/world, el trafico en src/traffic, el bucle en src/core y la
   presentacion en src/ui.

   ESTADOS DE LA PARTIDA
     menu   -> el coche quieto en la via, camara orbitando, trafico pasando
     cuenta -> 3, 2, 1, ¡YA!: la fisica corre pero no se acelera
     juego  -> se conduce y puntua
     pausa  -> la simulacion se detiene y el audio se suspende
     fin    -> tras el choque: camara lenta y luego el resumen
   ========================================================================== */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
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
import { Autopista } from './world/autopista.js';
import { Paisaje } from './world/paisaje.js';
import { Trafico } from './traffic/trafico.js';
import { Carrera, ESTADO, VENTANA_COMBO } from './game/carrera.js';
import { afinarTexturas } from './core/texturas.js';
import { DirectorCamara } from './camera/director.js';
import { modosPorDefecto } from './camera/modos.js';
import { FixedLoop } from './core/loop.js';
import { Input } from './core/input.js';
import { ControlTactil } from './core/tactil.js';
import { elegirCalidad, esMovil, esIOS, EscalaDinamica } from './core/calidad.js';
import { Hud } from './ui/hud.js';
import { Interfaz } from './ui/interfaz.js';
import { EngineAudio } from './audio/engine.js';
import { VehicleFX } from './vfx/vehicle-fx.js';

const STEP = 1 / 60;
const PARAMS = new URLSearchParams(location.search);

// ?escena=pilsen  -> Medellin fotorrealista sobre la Glorieta Pilsen
// ?escena=glorieta -> glorieta procedural
// (por defecto)   -> autopista infinita con trafico
const ESCENA = PARAMS.get('escena') ?? 'autopista';
const CLAVE_TILES = import.meta.env.VITE_GOOGLE_3D_TILES_KEY ?? '';
if (typeof window !== 'undefined') {
  window.__HR_ENV = { escena: ESCENA, claveLongitud: CLAVE_TILES.length };
}
const CAL = elegirCalidad();
const MOVIL = esMovil();
// Pedales en pantalla solo en telefonos y tabletas: un portatil con pantalla
// tactil tiene teclado, y los pedales le taparian media autopista.
const TACTIL = MOVIL;
const SPAWN = new THREE.Vector3(0, 0.06, GEO.islandR + 4.5);
const $ = s => document.querySelector(s);

const ui = new Interfaz();
const boot = (t, f) => ui.progreso(t, f);

// Alcance de la camara: en Medellin hace falta escala planetaria para que el
// arbol de teselas refine; en la autopista basta con llegar a las montanas.
const LEJOS = ESCENA === 'pilsen' ? 20000 : ESCENA === 'autopista' ? 2400 : 600;

const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance',
  logarithmicDepthBuffer: ESCENA === 'pilsen',
});
let pixelRatio = Math.min(devicePixelRatio, CAL.pixelMax);
renderer.setPixelRatio(pixelRatio);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e14);
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, LEJOS);

function resize() {
  // Una ventana de altura cero envenena el motor: aspect NaN, frustum NaN.
  const ancho = Math.max(1, innerWidth);
  const alto = Math.max(1, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, pixelRatio));
  renderer.setSize(ancho, alto, false);
  camera.aspect = ancho / alto;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ------------------------------------------------------------ preferencias
const PREFS_CLAVE = 'jr.prefs';
const prefs = (() => {
  const base = { sonido: true, direccion: 'inclinar', camara: 'persecucion' };
  try { return { ...base, ...JSON.parse(localStorage.getItem(PREFS_CLAVE) ?? '{}') }; } catch { return base; }
})();
function guardarPrefs() { try { localStorage.setItem(PREFS_CLAVE, JSON.stringify(prefs)); } catch { /* privado */ } }

const input = new Input();
const steering = new SteeringModel();
const throttleM = new PedalModel();
const brakeM = new PedalModel();
const engine = new Powertrain();
const audio = new EngineAudio();
audio.enabled = prefs.sonido;

let vehicle, loop, hud, sun, fx, director, ciudad = null, tactil = null, escala = null;
let autopista = null, paisaje = null, trafico = null, carrera = null;
let world = null;
/** @type {'carga'|'menu'|'cuenta'|'juego'|'pausa'|'fin'} */
let estado = 'carga';
let estadoAntesDePausa = 'juego';
let tCuenta = 0, ultimoNumero = null;
let tFin = 0, tLento = 0;
let avisoRecord = false;
let comprobarInclinacion = 0;
const pendientes = [];          // eventos de la fisica que la interfaz anuncia
const ctxCamara = { cuerpo: null, velocidadKmh: 0, derrapeGrados: 0, tiempo: 0 };
let tiempoVolcado = 0;
const TIEMPO_VUELCO = 2.5;
let tiempoAtascado = 0;
let tel = null;
const DIR_SOL = new THREE.Vector3(28, 38, 18).normalize();
const DIST_SOL = 50;
let wakeLock = null;

async function main() {
  boot('Iniciando motor de física…', 0.06);
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  world.integrationParameters.numSolverIterations = 8;

  sun = buildLighting(scene, renderer);
  sun.shadow.mapSize.set(CAL.sombraMapa, CAL.sombraMapa);
  renderer.shadowMap.type = CAL.sombraSuave ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  let spawn = null;
  if (ESCENA === 'autopista') {
    boot('Tendiendo la autopista…', 0.14);
    await new Promise(r => setTimeout(r, 16));
    autopista = new Autopista(scene, RAPIER, world, renderer, { firme: CAL.firme });
    boot('Sembrando el valle…', 0.2);
    await new Promise(r => setTimeout(r, 16));
    paisaje = new Paisaje(scene, CAL);
    boot('Llenando la vía de tráfico…', 0.26);
    await new Promise(r => setTimeout(r, 16));
    trafico = new Trafico(scene, RAPIER, world, { fisico: CAL.pinturaLaca, sombras: CAL.nombre === 'alta' });
    carrera = new Carrera();
    spawn = autopista.puntoDeSalida();
    const cielo = instalarCielo(renderer, scene, {
      elevacion: 34, azimut: 128, turbidez: 3.6,
      intensidadFondo: 0.30, intensidadEntorno: 0.65,
    });
    DIR_SOL.copy(cielo.direccionSol);
    alinearSol(sun, cielo.direccionSol, { distancia: DIST_SOL, intensidad: 3.6 });
    // El cielo ya ilumina de ambiente: la hemisferica a pleno sumaba un
    // segundo ambiente AZUL sobre todo lo horizontal.
    const hemi = scene.getObjectByName('hemisferica');
    if (hemi) { hemi.intensity = 0.18; hemi.color.setHex(0xdfe6ef); }
    scene.fog = new THREE.Fog(0xa7bccb, 380, 2100);
  } else if (ESCENA === 'pilsen' && CLAVE_TILES) {
    spawn = await montarMedellin(world);
    if (!spawn) {
      boot('Las teselas no llegaron. Revisa la clave y la facturación.');
      await new Promise(r => setTimeout(r, 2600));
    }
  } else if (ESCENA === 'pilsen') {
    boot('Falta VITE_GOOGLE_3D_TILES_KEY en .env.local — usando la glorieta procedural');
    await new Promise(r => setTimeout(r, 2200));
  }
  if (!spawn) {
    boot('Construyendo la glorieta…');
    buildRoundabout(scene, RAPIER, world);
    spawn = SPAWN.clone();
  }

  boot('Descargando el deportivo…', 0.32);
  const cargador = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  // El de movil esta simplificado a 98.000 triangulos y con texturas de 1024.
  const archivo = CAL.nombre === 'alta' ? 'CarConcept.glb' : 'CarConcept-movil.glb';
  const gltf = await cargador.loadAsync(import.meta.env.BASE_URL + 'models/' + archivo, (e) => {
    if (e.total) boot(`Descargando el deportivo… ${Math.round(e.loaded / e.total * 100)} %`, 0.32 + 0.58 * (e.loaded / e.total));
  });
  boot('Preparando el motor…', 0.93);
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    // LA TRANSMISION OBLIGA A PINTAR LA ESCENA DOS VECES: three renderiza
    // todo lo opaco a una textura para refractarlo a traves del cristal. En
    // movil eso es medio presupuesto de fotograma por un parabrisas. Se
    // sustituye por cristal transparente clasico, que a la vista es casi igual.
    for (const m of [].concat(o.material)) {
      if (!CAL.transmision && m.transmission > 0) {
        m.transmission = 0;
        m.transparent = true;
        m.opacity = 0.32;
        m.depthWrite = false;
        m.needsUpdate = true;
      }
      if (CAL.nombre !== 'alta' && m.iridescence > 0) { m.iridescence = 0; m.needsUpdate = true; }
    }
  });
  const afinadas = afinarTexturas(gltf.scene, renderer.capabilities.getMaxAnisotropy());
  console.info('[coche] texturas afinadas:', afinadas, '· calidad', CAL.nombre);
  scene.add(gltf.scene);

  vehicle = new Vehicle(RAPIER, world, gltf.scene, { spawn });
  SPAWN.copy(spawn);
  fx = new VehicleFX(scene, vehicle);

  hud = new Hud($('#hud'));
  $('#hud').hidden = !PARAMS.has('telemetria');

  if (TACTIL) {
    tactil = new ControlTactil($('#tactil'), { modo: prefs.direccion });
    input.tactil = tactil;
  }
  escala = new EscalaDinamica(renderer, pixelRatio, (nueva) => { pixelRatio = nueva; resize(); });

  resize();
  director = new DirectorCamara(camera, modosPorDefecto());
  director.seleccionar('orbita');
  ctxCamara.cuerpo = vehicle.bodyRoot;
  if (autopista) {
    trafico.reiniciar(spawn.z, spawn.x);
    carrera.reiniciar(spawn.z);
    paisaje.actualizar(spawn.z);
  }
  vehicle.render(1);
  director.fijar(ctxCamara);

  loop = new FixedLoop({
    step: STEP, maxSteps: 6, maxFrame: 0.1,
    fixed: dt => { if (estado !== 'pausa') simular(dt); },
    render: (alpha, dt) => { if (ciudad) ciudad.update(); presentar(alpha, dt); },
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (estado === 'juego' || estado === 'cuenta') pausar();
      audio.suspender();
    } else {
      loop.resync();
      if (estado !== 'pausa') audio.reanudar();
    }
  });

  conectarInterfaz();

  window.HR = {
    vehicle, scene, camera, renderer, world, RAPIER, steering, engine, input, loop, audio, fx, ciudad,
    director, autopista, trafico, carrera, paisaje, tactil, CAL,
    reiniciar, empezar, get estado() { return estado; }, get telemetria() { return tel; },
    pintar: () => renderer.render(scene, camera),
  };

  ui.ocultarCarga();
  irAlMenu();
  loop.start();
}

// ------------------------------------------------------------- interfaz
function conectarInterfaz() {
  // El navegador solo deja sonar audio tras un gesto. Cualquier toque o
  // tecla sirve; el boton JUGAR lo vuelve a intentar por si acaso.
  const arrancarAudio = () => { if (prefs.sonido) audio.start(); };
  addEventListener('pointerdown', arrancarAudio);
  addEventListener('keydown', arrancarAudio);

  ui.on.jugar = () => {
    // TODO LO QUE EXIGE UN GESTO VA PRIMERO Y SIN AWAIT: el audio y el permiso
    // de inclinacion de iOS caducan si antes se espera a cualquier promesa.
    audio.start();
    if (tactil && prefs.direccion === 'inclinar') {
      tactil.inclinacion.pedirPermiso().then(ok => {
        if (!ok) {
          cambiarDireccion('botones');
          ui.aviso('SIN INCLINACIÓN', 'usa los botones ◀ ▶', 'ambar');
        }
      });
    }
    pantallaCompleta();
    empezar();
  };
  ui.on.continuar = () => continuar();
  ui.on.reiniciar = () => { if (estado === 'fin' || estado === 'pausa') { ui.mostrarPausa(false); empezar(); } };
  ui.on.menu = () => irAlMenu();
  ui.on.pausa = () => { if (estado === 'juego' || estado === 'cuenta') pausar(); };
  // Camaras de juego: la orbita es la del menu, no se elige para conducir.
  const camarasJuego = director.modos.map(m => m.nombre).filter(n => n !== 'orbita');
  ui.on.camara = () => {
    const i = camarasJuego.indexOf(prefs.camara);
    prefs.camara = camarasJuego[(i + 1) % camarasJuego.length];
    guardarPrefs();
    ui.opciones({ camara: etiquetaCamara(prefs.camara) });
    // En el menu solo se elige; la camara del menu sigue orbitando.
    if (estado !== 'menu') {
      director.seleccionar(prefs.camara);
      ui.aviso(director.etiqueta, 'cámara');
    }
  };
  ui.on.sonido = () => {
    prefs.sonido = !prefs.sonido; guardarPrefs();
    audio.setEnabled(prefs.sonido);
    if (prefs.sonido) audio.start();
    ui.opciones({ sonido: prefs.sonido });
  };
  ui.on.direccion = () => cambiarDireccion(prefs.direccion === 'inclinar' ? 'botones' : 'inclinar');
  ui.on.compartir = () => compartir();
}

function cambiarDireccion(modo) {
  prefs.direccion = modo; guardarPrefs();
  if (tactil) tactil.setModo(modo);
  ui.opciones({ modoDireccion: modo });
  if (estado === 'menu') mostrarMenu();
}

function mostrarMenu() {
  ui.mostrarMenu({
    recordPuntos: carrera?.recordPuntos ?? 0,
    recordKm: carrera?.recordKm ?? 0,
    movil: TACTIL,
    modoDireccion: prefs.direccion,
    sonido: prefs.sonido,
    camara: etiquetaCamara(prefs.camara),
  });
}

function etiquetaCamara(nombre) {
  return director?.modos.find(m => m.nombre === nombre)?.etiqueta ?? 'PERSECUCIÓN';
}

function irAlMenu() {
  estado = 'menu';
  loop && (loop.escala = 1);
  ui.mostrarPausa(false);
  ui.ocultarFin();
  ui.cuenta(null);
  ui.mostrarJuego(false);
  if (tactil) tactil.mostrar(false);
  input.conduccion = false;
  reiniciar();
  director.seleccionar('orbita');
  director.fijar(ctxCamara);
  mostrarMenu();
  soltarPantalla();
}

/** Empieza (o reempieza) una tirada con cuenta atras. */
function empezar() {
  ui.ocultarMenu();
  ui.ocultarFin();
  ui.mostrarPausa(false);
  ui.mostrarJuego(true);
  if (tactil) tactil.mostrar(true);
  loop.escala = 1;
  reiniciar();
  if (!director.seleccionar(prefs.camara) && director.modo.nombre === 'orbita') director.seleccionar('persecucion');
  director.fijar(ctxCamara);
  estado = 'cuenta';
  tCuenta = 2.6;
  ultimoNumero = null;
  avisoRecord = false;
  input.conduccion = false;
  audio.reanudarMotor();
  mantenerPantalla();
}

function pausar() {
  estadoAntesDePausa = estado;
  estado = 'pausa';
  ui.mostrarPausa(true);
  if (tactil) tactil.mostrar(false);
  audio.suspender();
}

function continuar() {
  if (estado !== 'pausa') return;
  estado = estadoAntesDePausa;
  ui.mostrarPausa(false);
  if (tactil) tactil.mostrar(true);
  loop.resync();
  audio.reanudar();
}

function alChocar(contra, p) {
  const f = Math.min(1, (carrera.velocidadAlChocar ?? 0) / 160);
  // Chispas en el punto de impacto: entre el coche y el vehiculo golpeado.
  if (contra && p && fx?.chispas) {
    const x = (p.x + contra.x) / 2, z = p.z + Math.sign(contra.z - p.z) * Math.min(2.2, Math.abs(contra.z - p.z) / 2);
    const n = 30 + Math.round(f * 50);
    for (let i = 0; i < n; i++) {
      fx.chispas.emit(x + (Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 0.7, z,
        (Math.random() - 0.5) * 9, 1.5 + Math.random() * 4.5, (Math.random() - 0.3) * 10,
        0.35 + Math.random() * 0.6, 0.05 + Math.random() * 0.05, 2.4, 1.2, 0.3);
    }
  }
  audio.choque(0.4 + f * 0.6);
  director.sacudir(0.25 + f * 0.6);
  if (navigator.vibrate) navigator.vibrate([0, 220, 60, 90]);
  estado = 'fin';
  input.conduccion = false;
  tLento = 1.1;
  tFin = 1.35;
  loop.escala = 0.28;
}

async function compartir() {
  const pts = Math.round(carrera?.puntos ?? 0).toLocaleString('es-CO');
  const texto = `Hice ${pts} puntos en JERO RACER esquivando tractomulas a ${Math.round(carrera?.velocidadMax ?? 0)} km/h. ¿Me ganas?`;
  const url = 'https://jeroracer.axionasoft.com';
  try {
    if (navigator.share) { await navigator.share({ title: 'JERO RACER', text: texto, url }); return; }
    await navigator.clipboard.writeText(`${texto} ${url}`);
    ui.aviso('ENLACE COPIADO', 'pégalo donde quieras');
  } catch { /* el usuario cancelo */ }
}

/** Android: pantalla completa y horizontal. iOS no lo permite en Safari. */
function pantallaCompleta() {
  if (!MOVIL || esIOS()) return;
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
    .catch(() => {});
}

/** Que la pantalla no se apague mientras se juega con el sensor. */
function mantenerPantalla() {
  if (!navigator.wakeLock || wakeLock) return;
  navigator.wakeLock.request('screen').then(w => { wakeLock = w; w.addEventListener?.('release', () => { wakeLock = null; }); }).catch(() => {});
}
function soltarPantalla() { wakeLock?.release?.().catch(() => {}); wakeLock = null; }

/**
 * Monta Medellin fotorrealista y devuelve el punto de aparicion del coche,
 * o null si las teselas no llegaron (clave mala, sin facturacion, sin red).
 */
async function montarMedellin(world) {
  boot('Cargando la Glorieta Pilsen…');
  const pista = await fetch(import.meta.env.BASE_URL + 'data/glorieta-pilsen.json').then(r => r.json());

  boot('Conectando con Google Photorealistic 3D Tiles…');
  ciudad = new CiudadFotorrealista(scene, camera, renderer, pista, CLAVE_TILES);
  $('#atribBar').hidden = false;
  ciudad.onAtribucion = txt => { const e = $('#atrib'); if (e) e.textContent = txt; };
  ciudad.onProgreso = s => boot(`Descargando Medellín… ${s.visible} teselas en pantalla, ${s.downloading} en vuelo`);

  const radio = radioEjeOSM(pista);
  const medida = await ciudad.anclarEnElSuelo(radio);
  if (!medida) {
    console.error('[medellin] sin geometria. Errores de carga:', ciudad.errores.slice(0, 5));
    ciudad.dispose();
    ciudad = null;
    return null;
  }
  boot('Midiendo el relieve real de la glorieta…');
  await new Promise(r => setTimeout(r, 32));
  const crudo = muestrearRelieve(ciudad, { lado: 150, celdas: 128 });
  const relieve = { ...crudo, alturas: suavizarRelieve(crudo.alturas, crudo.n, 2) };
  const calz = construirCalzadaOSM(scene, RAPIER, world, pista, relieve, medida.alturaSuelo);
  const cielo = instalarCielo(renderer, scene);
  DIR_SOL.copy(cielo.direccionSol);
  alinearSol(sun, cielo.direccionSol, { distancia: DIST_SOL });
  scene.fog = null;
  const ySpawn = alturaEnRelieve(relieve, 0, calz.radioEje);
  return new THREE.Vector3(0, ySpawn + 0.30, calz.radioEje);
}

// ------------------------------------------------------------------ fisica
// Caja del coche en planta para la prueba de choque: medidas del chasis de
// CarConcept en espacio local del vehiculo.
const CAJA_JUGADOR = Object.freeze({ largo: 4.45, ancho: 1.95 });

function simular(dt) {
  const a = input.sample(dt);
  if (carrera && carrera.estado === ESTADO.CHOCADO) {
    a.throttle = 0;
    a.brake = Math.max(a.brake, 0.35);
    a.steer = 0;
  }
  const fwdKmh = vehicle.forwardSpeedKmh;
  const slip = vehicle.yawSlipDeg;

  // --- marcha atras: se engrana casi parado, como una caja real ----------
  let acelerar = a.throttle, frenar = a.brake;
  if (engine.gear > 0 && fwdKmh < 1.5 && a.brake > 0.5) engine.engageReverse(fwdKmh);
  else if (engine.gear < 0 && fwdKmh > -1.5 && a.throttle > 0.5) engine.engageForward(fwdKmh);
  if (engine.gear < 0) { acelerar = a.brake; frenar = a.throttle; }

  const steer = steering.update(a.steer, fwdKmh, slip, dt);
  const th = throttleM.update(acelerar, dt);
  const br = brakeM.update(frenar, dt);
  const out = engine.update(th, vehicle.driveWheelRads, dt);

  vehicle.setControls(steer, out.torque, br, a.handbrake);
  vehicle.applyAero();
  vehicle.stepControls(dt);
  world.step();
  vehicle.capture();

  if (autopista) actualizarAutopista(dt, fwdKmh);

  const slips = vehicle.slipRatios();
  tel = {
    speed: Math.abs(fwdKmh), rpm: out.rpm, gear: engine.gearLabel,
    steer: steering.rawCurrent, authority: steering.lastAuthority, slip,
    throttle: th, brake: br, handbrake: a.handbrake, analog: a.analog,
    front: slips.front, rear: slips.rear, airborne: slips.airborne,
    upsideDown: vehicle.isUpsideDown,
    gearNum: engine.gear, normalizedRPM: engine.normalizedRPM,
    load: out.load, rpmDeltaPerSec: out.rpmDeltaPerSec,
    onLimiter: out.onLimiter, shifting: out.shifting,
    slipRear: slips.rear, speedKmh: Math.abs(fwdKmh),
  };

  if (vehicle.body.translation().y < -20) { reiniciar(); return; }

  // ATASCADO: de morro contra la defensa, con gas y sin avanzar. En un juego
  // de trafico nadie quiere maniobrar marcha atras; se le devuelve al carril.
  if (autopista && estado === 'juego' && a.throttle > 0.5 && Math.abs(fwdKmh) < 4) {
    tiempoAtascado += dt;
    if (tiempoAtascado > 1.4) { reubicarEnCarril(); return; }
  } else {
    tiempoAtascado = 0;
  }
  if (tel.upsideDown && vehicle.speedKmh < 8) {
    tiempoVolcado += dt;
    tel.recuperandoEn = Math.max(0, TIEMPO_VUELCO - tiempoVolcado);
    if (tiempoVolcado >= TIEMPO_VUELCO && estado !== 'fin') reiniciar();
  } else {
    tiempoVolcado = 0;
  }
}

/**
 * Avanza la via, el trafico y la partida. Va DESPUES de world.step(): la
 * deteccion de choque mira la posicion con la que el coche quedo tras
 * resolver la fisica; al reves se cuelan atravesamientos a alta velocidad.
 */
function actualizarAutopista(dt, fwdKmh) {
  const p = vehicle.body.translation();
  autopista.actualizar(p.z);
  paisaje.actualizar(p.z);
  trafico.actualizar(dt, { x: p.x, z: p.z, velocidad: Math.max(0, fwdKmh / 3.6) });

  for (const ev of trafico.eventos) pendientes.push(ev);
  if (estado !== 'juego') return;

  const q = vehicle.body.rotation();
  const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
  const choque = carrera.estado === ESTADO.RODANDO
    ? trafico.choqueCon({ x: p.x, z: p.z, yaw, largo: CAJA_JUGADOR.largo, ancho: CAJA_JUGADOR.ancho })
    : null;
  for (const ev of trafico.eventos) if (ev.rozon) ev.bono = carrera.rozon(ev);
  const termino = carrera.actualizar(dt, p.z, choque, vehicle.speedKmh);
  trafico.fijarDificultad(carrera.km);
  if (termino) alChocar(choque, p);
}

// --------------------------------------------------------------- presentar
function presentar(alpha, dt) {
  vehicle.render(alpha);
  if (trafico) trafico.presentar(alpha);
  escala?.medir(dt);

  // --- teclado de interfaz ---------------------------------------------------
  if (input.justPressed('telemetria')) $('#hud').hidden = !$('#hud').hidden;
  if (input.justPressed('mute')) ui.on.sonido();
  if (input.justPressed('camera')) ui.on.camara();
  if (input.justPressed('hud')) { const j = $('#juego'); if (estado !== 'menu') j.hidden = !j.hidden; }
  const aceptar = input.justPressed('aceptar');
  const pausaTecla = input.justPressed('pause');
  const reinicioTecla = input.justPressed('respawn');
  if (estado === 'menu' && aceptar) ui.on.jugar();
  else if ((estado === 'juego' || estado === 'cuenta') && pausaTecla) pausar();
  else if (estado === 'pausa' && (pausaTecla || aceptar)) continuar();
  else if (estado === 'fin' && (aceptar || reinicioTecla) && tFin <= 0 && carrera.puedeReiniciar) empezar();
  else if ((estado === 'juego' || estado === 'cuenta') && reinicioTecla) empezar();

  // --- cuenta atras ---------------------------------------------------------
  if (estado === 'cuenta') {
    tCuenta -= dt;
    const n = tCuenta > 1.8 ? '3' : tCuenta > 1.0 ? '2' : tCuenta > 0.2 ? '1' : '¡YA!';
    if (n !== ultimoNumero) {
      ultimoNumero = n;
      ui.cuenta(n);
      audio.pitido(n === '¡YA!');
    }
    if (tCuenta <= 0.2) {
      estado = 'juego';
      input.conduccion = true;
      tactil?.inclinacion.calibrar();
      comprobarInclinacion = 1.6;
      setTimeout(() => { if (ultimoNumero === '¡YA!') ui.cuenta(null); }, 800);
    }
  }
  // Si el telefono no da datos de inclinacion, se pasa a botones solo.
  if (comprobarInclinacion > 0 && estado === 'juego') {
    comprobarInclinacion -= dt;
    if (comprobarInclinacion <= 0 && tactil && prefs.direccion === 'inclinar' && !tactil.inclinacion.disponible) {
      cambiarDireccion('botones');
      ui.aviso('SIN SENSOR', 'usa los botones ◀ ▶', 'ambar');
    }
  }

  // --- choque: camara lenta y resumen ------------------------------------------
  if (estado === 'fin') {
    if (tLento > 0) {
      tLento -= dt;
      loop.escala = tLento > 0 ? 0.28 + (1 - Math.min(1, tLento / 1.1)) * 0.5 : 1;
    }
    if (tFin > 0) {
      tFin -= dt;
      if (tFin <= 0) {
        if (tactil) tactil.mostrar(false);
        ui.mostrarFin({
          recordBatido: carrera.recordBatido,
          contra: articulo(carrera.choqueCon),
          velocidadChoque: carrera.velocidadAlChocar,
          puntos: carrera.puntos, km: carrera.km,
          rozones: carrera.rozones, mejorCombo: carrera.mejorCombo,
          velMax: carrera.velocidadMax,
          recordPuntos: carrera.recordPuntos, recordKm: carrera.recordKm,
        });
      }
    }
  }

  // --- eventos de la fisica: sonido de paso y bonos ------------------------------
  while (pendientes.length) {
    const ev = pendientes.shift();
    const cerca = Math.max(0, (3 - ev.hueco) / 3);
    audio.paso(ev.lado, cerca * Math.min(1, Math.abs(ev.relativa) / 30), ev.pesado);
    if (ev.bono) {
      audio.bono(ev.bono.combo);
      if (navigator.vibrate) navigator.vibrate(18);
      ui.aviso(ev.bono.combo > 1 ? `¡ROZÓN x${ev.bono.combo}!` : '¡ROZÓN!', `+${ev.bono.bono} · ${ev.tipo.nombre}`);
    }
  }
  if (carrera && carrera.recordBatido && !avisoRecord && estado === 'juego') {
    avisoRecord = true;
    ui.aviso('¡NUEVO RÉCORD!', 'sigue así', 'ambar');
  }

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
  if (tel && !$('#hud').hidden) hud.update(tel, dt, { fps: loop.fps, steps: loop.lastSteps, dropped: loop.dropped });
  if (carrera && (estado === 'juego' || estado === 'cuenta' || estado === 'fin') && tel) {
    ui.actualizar({
      puntos: carrera.puntos, km: carrera.km,
      record: Math.max(carrera.recordPuntos, carrera.puntos),
      vel: tel.speed, marcha: String(tel.gear), rpm01: engine.normalizedRPM ?? 0,
      combo: carrera.combo, combo01: carrera.tCombo / VENTANA_COMBO,
    }, dt);
  }
}

/** "un camión", "una tractomula", "un taxi"... */
function articulo(nombre) {
  if (!nombre) return 'un vehículo';
  const fem = /^(camioneta|tractomula|van|buseta)/.test(nombre);
  return `${fem ? 'una' : 'un'} ${nombre}`;
}

/** Devuelve el coche al carril mas cercano mirando hacia delante, sin tocar la partida. */
function reubicarEnCarril() {
  tiempoAtascado = 0;
  const p = vehicle.body.translation();
  const base = autopista.puntoDeSalida();
  let mejor = base.x, d = Infinity;
  for (let i = 0; i < 6; i++) {
    const x = base.x + (i - 3) * 3.6;
    if (Math.abs(x - p.x) < d) { d = Math.abs(x - p.x); mejor = x; }
  }
  vehicle.respawn(new THREE.Vector3(mejor, base.y, p.z + 2), 0);
  steering.reset(); throttleM.reset(); brakeM.reset();
  ui.aviso('DE VUELTA AL CARRIL', '', 'ambar');
}

/** Reinicia TODO el estado, no solo el cuerpo rigido. */
function reiniciar() {
  // En la autopista no se vuelve al kilometro cero: se sigue en el mismo
  // tramo y lo que se pone a cero es la partida.
  if (autopista) {
    const z = vehicle.body.translation().z;
    SPAWN.copy(autopista.puntoDeSalida());
    SPAWN.z = z + 12;
    autopista.actualizar(SPAWN.z);
    paisaje.actualizar(SPAWN.z);
    trafico.reiniciar(SPAWN.z, SPAWN.x);
    carrera.reiniciar(SPAWN.z);
  }
  vehicle.respawn(SPAWN, 0);
  tiempoVolcado = 0;
  if (fx) fx.clear();
  steering.reset();
  throttleM.reset();
  brakeM.reset();
  engine.reset();
  pendientes.length = 0;
  if (loop) loop.resync();
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
