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
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { SteeringModel, PedalModel, DIRECCION_ANALOGICA } from './vehicle/steering.js';
import { Powertrain, cajaSeis } from './vehicle/powertrain.js';
import { Vehicle } from './vehicle/vehicle.js';
import { cargarCarro, descubrirCarros, CARROS, fichaCarro, PINTURAS } from './vehicle/catalogo.js';
import { buildRoundabout, buildLighting, GEO } from './world/roundabout.js';
import {
  CiudadFotorrealista, construirCalzadaOSM, radioEjeOSM,
  muestrearRelieve, suavizarRelieve, alturaEnRelieve,
} from './world/photoreal.js';
import { instalarCielo, alinearSol } from './world/cielo.js';
import { Autopista } from './world/autopista.js';
import { Paisaje } from './world/paisaje.js';
import { Fotomultas, camarasEntre } from './world/fotomultas.js';
import { Trafico } from './traffic/trafico.js';
import { Persecucion, PERSECUCION } from './game/persecucion.js';
import { FRASES, una } from './ui/frases.js';
import { Carrera, ESTADO, VENTANA_COMBO } from './game/carrera.js';
import { DirectorCamara } from './camera/director.js';
import { modosPorDefecto } from './camera/modos.js';
import { FixedLoop } from './core/loop.js';
import { Input } from './core/input.js';
import { ControlTactil } from './core/tactil.js';
import { elegirCalidad, esMovil, esIOS, EscalaDinamica } from './core/calidad.js';
import { Hud } from './ui/hud.js';
import { Interfaz } from './ui/interfaz.js';
import { EngineAudio } from './audio/engine.js';
import { Narrador } from './audio/narrador.js';
import { VehicleFX } from './vfx/vehicle-fx.js';
import { ParticleSystem } from './vfx/particles.js';
import { Postproceso } from './vfx/postproceso.js';
import { Sala, codigoNuevo, normalizarCodigo, HAY_NUBE } from './net/sala.js';
import { Remotos } from './net/remotos.js';

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
/** ¿Abierta como app instalada (icono en la pantalla de inicio)? */
const INSTALADA = matchMedia('(display-mode: fullscreen)').matches
  || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let avisoInstalar = null;

// APP INSTALABLE. El service worker guarda el juego en el telefono: sin el,
// la app instalada es un acceso directo que no abre si la red falla. Solo en
// la version publicada; en desarrollo cachearia el codigo que se esta editando.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(e => console.warn('[sw]', e)));
}
// Android avisa cuando se puede instalar; se guarda para el boton del menu.
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  avisoInstalar = e;
  const b = document.querySelector('#oInstalar');
  if (b) b.hidden = false;
});
addEventListener('appinstalled', () => {
  avisoInstalar = null;
  const b = document.querySelector('#oInstalar');
  if (b) b.hidden = true;
});
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
  post?.redimensionar(ancho, alto, Math.min(devicePixelRatio, pixelRatio));
}
addEventListener('resize', resize);

// ------------------------------------------------------------ preferencias
const PREFS_CLAVE = 'jr.prefs';
const prefs = (() => {
  const base = {
    sonido: true, voz: true, direccion: 'inclinar', camara: 'persecucion',
    carro: '', pintura: 0, apodo: '',   // '' = el primero del catalogo
  };
  try { return { ...base, ...JSON.parse(localStorage.getItem(PREFS_CLAVE) ?? '{}') }; } catch { return base; }
})();
function guardarPrefs() { try { localStorage.setItem(PREFS_CLAVE, JSON.stringify(prefs)); } catch { /* privado */ } }

const input = new Input();
const steeringTeclas = new SteeringModel();
// El telefono inclinado y el stick del mando tienen su propia direccion (ver
// DIRECCION_ANALOGICA). Se cambia de una a otra conservando el volante donde
// estaba, para que no pegue un salto si se mezclan teclado y mando.
const steeringAnalogico = new SteeringModel(DIRECCION_ANALOGICA);
let steering = steeringTeclas;
const throttleM = new PedalModel();
const brakeM = new PedalModel();
const engine = new Powertrain();
const audio = new EngineAudio();
audio.enabled = prefs.sonido;
const narrador = new Narrador(audio);
narrador.activo = prefs.voz;
/** Cuantas partidas han terminado en esta sesion (la cuna de TikTok va cada tres). */
let finales = 0;

/** 'Jero', 'Takamura' o 'Axiona' si el vehiculo lleva su publicidad. */
function marcaDe(id = '') {
  return /Jero/.test(id) ? 'Jero' : /Takamura/.test(id) ? 'Takamura' : /Axiona/.test(id) ? 'Axiona' : null;
}

let vehicle, loop, hud, sun, fx, director, ciudad = null, tactil = null, escala = null, post = null;
/** El carro elegido, ya construido o descargado (ver vehicle/catalogo.js). */
let carro = null;
/** Sala en linea, si el jugador entro a una. */
let sala = null;
let remotos = null;
/** Segundos desde que arranco el juego: reloj de los rozones entre jugadores. */
let tReloj = 0;
/** Caja en planta del carro para la prueba de choque contra el trafico. */
let cajaJugador = { largo: 4.45, ancho: 1.95 };
let autopista = null, paisaje = null, trafico = null, carrera = null, persecucion = null, fotomultas = null;
/** Posicion del paso anterior, para saber que camaras se cruzaron. */
let zFoto = null;
let humoNegro = null;
/** Avisos que solo salen una vez por partida (velocidades, dano). */
const yaDicho = new Set();
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

// Solo en desarrollo: acceso desde la consola para montar escenas de prueba
// (una patrulla detras de un camion, el coche antes de una camara...).
if (import.meta.env.DEV) {
  window.__jr = {
    get vehicle() { return vehicle; }, get trafico() { return trafico; }, get persecucion() { return persecucion; },
    get carrera() { return carrera; }, get fotomultas() { return fotomultas; }, get estado() { return estado; }, get fx() { return fx; }, ui, narrador, audio,
  };
}

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
    // Rotulos de camiones y vallas se dibujan con estas fuentes: sin esperar,
    // la primera partida los pintaria con la de respaldo.
    await Promise.race([
      Promise.all([document.fonts.load('64px "Russo One"'), document.fonts.load('bold 64px Rajdhani')]),
      new Promise(r => setTimeout(r, 2500)),
    ]).catch(() => {});
    boot('Tendiendo la autopista…', 0.14);
    await new Promise(r => setTimeout(r, 16));
    autopista = new Autopista(scene, RAPIER, world, renderer, { firme: CAL.firme });
    boot('Sembrando el valle…', 0.2);
    await new Promise(r => setTimeout(r, 16));
    paisaje = new Paisaje(scene, CAL);
    fotomultas = new Fotomultas(scene);
    boot('Llenando la vía de tráfico…', 0.26);
    await new Promise(r => setTimeout(r, 16));
    trafico = new Trafico(scene, RAPIER, world, { fisico: CAL.pinturaLaca, sombras: CAL.nombre === 'alta' });
    persecucion = new Persecucion(scene, trafico.material);
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

  // Los carros de Sketchfab solo existen si esta compilacion los trae. Un
  // carro guardado que ya no esta (o ninguno) pasa al primero del catalogo.
  const creditos = await descubrirCarros();
  if (creditos.length) $('#mCreditosCarros').textContent = ' · ' + creditos.join(' · ');
  if (!CARROS.some(c => c.id === prefs.carro)) prefs.carro = CARROS[0].id;
  carro = await cargarCarro(prefs.carro, CAL, boot);
  // El CarConcept llega con texturas sin afinar; el FURIA no tiene ninguna.
  const afinadas = carro.afinar?.(renderer.capabilities.getMaxAnisotropy()) ?? 0;
  console.info('[coche]', carro.nombre, '· texturas afinadas:', afinadas, '· calidad', CAL.nombre);
  carro.pintar(prefs.pintura);
  cajaJugador = carro.caja;
  scene.add(carro.objeto);

  vehicle = new Vehicle(RAPIER, world, carro.objeto, { spawn, ...carro.opts });
  // Caja de seis cambios a la medida de la rueda de ESTE carro (el radio solo
  // se conoce cuando Vehicle mide el modelo) y el par de su motor.
  Object.assign(engine, cajaSeis({ radioRueda: vehicle.wheelRadius, velocidadMaxKmh: carro.velocidadMax ?? 255 }),
    { maxTorque: carro.parMax ?? 700 });
  engine.reset();
  SPAWN.copy(spawn);
  fx = new VehicleFX(scene, vehicle);
  // La plantilla se saca ANTES de que Vehicle desarme las ruedas para
  // riguearlas: despues, el clon saldria sin ruedas.
  if (carro.plantilla) remotos = new Remotos(scene, carro.plantilla, cajaJugador);
  // Humo negro de las patrullas estrelladas: mas espeso y alto que el de las
  // llantas, que salia dentro de la carroceria y la propia patrulla lo tapaba.
  humoNegro = new ParticleSystem(220, { size: 1.4, sizeGrow: 1.4, drag: 0.975, gravity: 1.0, opacity: 0.6, soft: 0.5 });
  scene.add(humoNegro.points);

  hud = new Hud($('#hud'));
  $('#hud').hidden = !PARAMS.has('telemetria');

  if (TACTIL) {
    tactil = new ControlTactil($('#tactil'), { modo: prefs.direccion });
    input.tactil = tactil;
  }
  escala = new EscalaDinamica(renderer, pixelRatio, (nueva) => { pixelRatio = nueva; resize(); }, CAL.pixelMin);

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

  post = new Postproceso(renderer, scene, camera, CAL);
  post.redimensionar(Math.max(1, innerWidth), Math.max(1, innerHeight), pixelRatio);
  console.info('[postproceso]', post.activo ? CAL.nombre : 'apagado');

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
    vehicle, scene, camera, renderer, world, RAPIER, get steering() { return steering; }, engine, input, loop, audio, fx, ciudad,
    director, autopista, trafico, carrera, paisaje, tactil, CAL, persecucion,
    reiniciar, empezar, get estado() { return estado; }, get telemetria() { return tel; },
    get post() { return post; },
    pintar: () => post.render(1 / 60, {}),
  };

  ui.ocultarCarga();
  irAlMenu();
  // Invitacion por enlace: se abre la pantalla de sala con el codigo puesto.
  const invitado = normalizarCodigo(PARAMS.get('sala') ?? '');
  if (invitado.length >= 3) {
    ui.ocultarMenu();
    ui.mostrarLinea(true, { apodo: prefs.apodo || '', codigo: invitado, nube: HAY_NUBE });
    refrescarSala();
  }
  loop.start();
}

// ------------------------------------------------------------- interfaz
function conectarInterfaz() {
  // Safari de iPhone ignora user-scalable=no: un pellizco o doble toque en
  // medio de la partida hacia zoom y descuadraba los pedales.
  for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) {
    document.addEventListener(ev, e => e.preventDefault(), { passive: false });
  }

  // El navegador solo deja sonar audio tras un gesto. Cualquier toque o
  // tecla sirve; el boton JUGAR lo vuelve a intentar por si acaso.
  const arrancarAudio = () => { if (prefs.sonido) { audio.start(); narrador.cargar(); } };
  addEventListener('pointerdown', arrancarAudio);
  addEventListener('keydown', arrancarAudio);

  ui.on.jugar = () => {
    // TODO LO QUE EXIGE UN GESTO VA PRIMERO Y SIN AWAIT: el audio y el permiso
    // de inclinacion de iOS caducan si antes se espera a cualquier promesa.
    audio.start();
    narrador.cargar();
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
    if (prefs.sonido) { audio.start(); narrador.cargar(); } else narrador.callar();
    ui.opciones({ sonido: prefs.sonido });
  };
  ui.on.voz = () => {
    prefs.voz = !prefs.voz; guardarPrefs();
    narrador.activo = prefs.voz;
    if (!prefs.voz) narrador.callar();
    ui.opciones({ voz: prefs.voz });
  };
  // CAMBIAR DE CARRO RECARGA LA PAGINA, a proposito. El carro no es una malla
  // que se cambia: tiene cuerpo rigido, controlador de vehiculo y cuatro
  // suspensiones dentro del mundo de Rapier. Desmontar todo eso en caliente es
  // una fuente de fugas por un boton que se toca una vez. Recargar cuesta
  // menos de un segundo con el FURIA, que no descarga nada.
  ui.on.carro = () => {
    const i = CARROS.findIndex(c => c.id === prefs.carro);
    prefs.carro = CARROS[(i + 1) % CARROS.length].id;
    guardarPrefs();
    ui.opciones({ carro: fichaCarro(prefs.carro).nombre });
    location.reload();
  };
  ui.on.pintura = () => {
    prefs.pintura = (prefs.pintura + 1) % PINTURAS.length;
    guardarPrefs();
    ui.opciones({ pintura: carro.pintar(prefs.pintura) });
  };
  ui.on.linea = () => abrirLinea();
  ui.on.cerrarLinea = () => { ui.mostrarLinea(false); if (estado === 'menu') mostrarMenu(); };
  ui.on.codigoNuevo = () => ui.mostrarLinea(true, { codigo: codigoNuevo(), nube: HAY_NUBE });
  ui.on.entrarSala = () => entrarSala();
  ui.on.salirSala = () => salirSala();
  ui.on.invitar = () => invitarSala();
  ui.on.direccion = () => cambiarDireccion(prefs.direccion === 'inclinar' ? 'botones' : 'inclinar');
  ui.on.compartir = () => compartir();
  ui.on.instalar = () => {
    if (!avisoInstalar) return;
    avisoInstalar.prompt();
    avisoInstalar.userChoice.finally(() => { avisoInstalar = null; $('#oInstalar').hidden = true; });
  };
  // En iPhone no hay aviso de instalacion: se explica como hacerlo a mano.
  $('#mInstalarIOS').hidden = !(esIOS() && !INSTALADA);
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
    sonido: prefs.sonido, voz: prefs.voz,
    camara: etiquetaCamara(prefs.camara),
    carro: fichaCarro(prefs.carro).nombre,
    pintura: PINTURAS[prefs.pintura % PINTURAS.length].nombre,
    pintable: fichaCarro(prefs.carro).pintable,
    linea: sala?.dentro ? sala.codigo : 'NO',
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
  fraseFin = una(FRASES.choque);
  const marca = marcaDe(contra?.tipo?.id);
  narrador.decir(marca ? 'choque' + marca : 'choque');
  // Y cada tres partidas (y en la primera), la cuna de las cuentas de TikTok.
  if (!marca && finales++ % 3 === 0) narrador.decir('tiktok');
  estado = 'fin';
  input.conduccion = false;
  tLento = 1.1;
  tFin = 1.35;
  loop.escala = 0.28;
}

/** Lo detuvo la Policia o el Ejercito: dano al 100 %. */
function alDetener() {
  audio.golpe(1);
  director.sacudir(0.35);
  if (navigator.vibrate) navigator.vibrate([0, 300, 80, 300]);
  fraseFin = una(FRASES.detenido);
  narrador.decir('detenido');
  if (finales++ % 3 === 0) narrador.decir('tiktok');
  estado = 'fin';
  input.conduccion = false;
  tLento = 1.1;
  tFin = 1.5;
  loop.escala = 0.35;
}
let fraseFin = '';

async function compartir() {
  const pts = Math.round(carrera?.puntos ?? 0).toLocaleString('es-CO');
  const n = carrera?.fotomultas ?? 0;
  const multas = n ? ` y me cogieron ${n} fotomulta${n > 1 ? 's' : ''} 📸` : '';
  const texto = `Hice ${pts} puntos en JERO RACER esquivando tractomulas y a la tomba a ${Math.round(carrera?.velocidadMax ?? 0)} km/h${multas}. ¿Me ganas? Síguenos en TikTok: @jerofernandez222, @esteban.takamura y @axiona.softwareia`;
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
  // Instalada ya abre a pantalla completa: pedirla otra vez falla en algunos
  // Android. Solo se fija la orientacion.
  if (INSTALADA) { screen.orientation?.lock?.('landscape').catch(() => {}); return; }
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

  const modelo = a.analog ? steeringAnalogico : steeringTeclas;
  if (modelo !== steering) { modelo.current = steering.current; steering = modelo; }
  const steer = steering.update(a.steer, fwdKmh, slip, dt);
  const th = throttleM.update(acelerar, dt);
  const br = brakeM.update(frenar, dt);
  const out = engine.update(th, vehicle.driveWheelRads, dt);

  // Con el carro muy golpeado el motor rinde menos: asi se nota el dano.
  const cojera = carrera ? 1 - 0.4 * Math.max(0, (carrera.danio - 55) / 45) : 1;
  vehicle.setControls(steer, out.torque * cojera, br, a.handbrake);
  vehicle.estabilizar(dt, a.handbrake);
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
  fotomultas.actualizar(p.z);
  trafico.actualizar(dt, { x: p.x, z: p.z, velocidad: Math.max(0, fwdKmh / 3.6) });

  for (const ev of trafico.eventos) pendientes.push(ev);

  const q = vehicle.body.rotation();
  const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
  const enJuego = estado === 'juego' && carrera.estado === ESTADO.RODANDO;
  persecucion.actualizar(dt, {
    x: p.x, z: p.z, velocidad: Math.max(0, fwdKmh / 3.6), kmh: fwdKmh, yaw,
    largo: cajaJugador.largo, ancho: cajaJugador.ancho,
  }, trafico, enJuego);
  carrera.enPersecucion = persecucion.activa;
  for (const ev of persecucion.eventos) {
    // Lo fisico se aplica aqui, dentro del paso; lo de la interfaz, al pintar.
    if (ev.tipo === 'golpe' && enJuego) {
      const m = vehicle.mass;
      // Contra una estrellada, ademas del empujon, el frenazo del totazo.
      vehicle.body.applyImpulse({ x: ev.lado * m * (1.0 + ev.fuerza * 0.045), y: 0, z: -m * (ev.frenazo ?? 0) }, true);
      const w = vehicle.body.angvel();
      vehicle.body.setAngvel({ x: w.x, y: w.y + ev.lado * 0.35, z: w.z }, true);
      if (carrera.danar(ev.fuerza, ev.militar ? 'el Ejército' : 'la Policía')) alDetener();
    } else if (ev.tipo === 'disparo' && ev.acierta && enJuego) {
      if (carrera.danar(PERSECUCION.danoBala, ev.militar ? 'el Ejército' : 'la Policía')) alDetener();
    } else if (ev.tipo === 'fin') {
      ev.bono = carrera.bonoEscape(ev.duracion);
    } else if (ev.tipo === 'estrellada' && enJuego) {
      ev.bono = carrera.derribo(ev.militar);
    }
    pendientes.push({ persecucion: ev });
  }
  persecucion.eventos.length = 0;
  const zFotoAntes = zFoto;
  zFoto = p.z;
  if (estado !== 'juego') return;

  const choque = carrera.estado === ESTADO.RODANDO
    ? trafico.choqueCon({ x: p.x, z: p.z, yaw, largo: cajaJugador.largo, ancho: cajaJugador.ancho })
    : null;
  for (const ev of trafico.eventos) if (ev.rozon) ev.bono = carrera.rozon(ev);
  const termino = carrera.actualizar(dt, p.z, choque, vehicle.speedKmh);
  trafico.fijarDificultad(carrera.km);
  if (termino) alChocar(choque, p);
  else if (zFotoAntes != null && carrera.estado === ESTADO.RODANDO) revisarFotomultas(zFotoAntes, p.z, Math.abs(fwdKmh));
}

/** Camaras cruzadas en este paso: por encima del limite, multa. */
function revisarFotomultas(z0, z1, kmh) {
  for (const c of camarasEntre(z0, z1)) {
    if (kmh > c.limite) {
      fotomultas.disparar(c);
      pendientes.push({ fotomulta: { ...c, kmh, n: carrera.fotomulta() } });
    } else if (!c.oculta) {
      pendientes.push({ fotomulta: { ...c, kmh, salvada: carrera.salvada() } });
    }
  }
}

// --------------------------------------------------------------- presentar
function presentar(alpha, dt) {
  vehicle.render(alpha);
  if (trafico) trafico.presentar(alpha);
  if (persecucion) persecucion.presentar(alpha, dt);
  if (fotomultas) fotomultas.presentar(dt);
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
      if (n === '¡YA!') narrador.decir('arranque');
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
          motivo: carrera.motivo, frase: fraseFin,
          recordBatido: carrera.recordBatido,
          contra: carrera.motivo === 'detenido' ? carrera.choqueCon : articulo(carrera.choqueCon),
          velocidadChoque: carrera.velocidadAlChocar,
          puntos: carrera.puntos, km: carrera.km,
          rozones: carrera.rozones, mejorCombo: carrera.mejorCombo,
          velMax: carrera.velocidadMax, fotomultas: carrera.fotomultas,
          recordPuntos: carrera.recordPuntos, recordKm: carrera.recordKm,
        });
      }
    }
  }

  // --- eventos de la fisica: sonido de paso y bonos ------------------------------
  while (pendientes.length) {
    const ev = pendientes.shift();
    if (ev.persecucion) { avisoPersecucion(ev.persecucion); continue; }
    if (ev.fotomulta) { avisoFotomulta(ev.fotomulta); continue; }
    const cerca = Math.max(0, (3 - ev.hueco) / 3);
    audio.paso(ev.lado, cerca * Math.min(1, Math.abs(ev.relativa) / 30), ev.pesado);
    const marca = estado === 'juego' && cerca > 0.3 ? marcaDe(ev.tipo?.id) : null;
    if (marca) narrador.decir('rozon' + marca);
    if (ev.bono) {
      const k = ev.bono.combo;
      narrador.decir(k >= 5 ? 'combo5' : k >= 3 ? 'combo3' : 'rozon');
      audio.bono(ev.bono.combo);
      if (navigator.vibrate) navigator.vibrate(18);
      const c = ev.bono.combo;
      const titulo = c >= 5 ? una(FRASES.combo5) : c >= 3 ? una(FRASES.combo3) : una(FRASES.rozon);
      ui.aviso(titulo, `+${ev.bono.bono}${c > 1 ? ` · combo x${c}` : ''} · ${ev.tipo.nombre}`);
    }
  }
  if (carrera && carrera.recordBatido && !avisoRecord && estado === 'juego') {
    avisoRecord = true;
    ui.aviso(una(FRASES.record), 'sigue así', 'ambar');
    narrador.decir('record');
  }
  if (carrera && estado === 'juego' && tel) {
    for (const v of [150, 200, 240]) {
      if (tel.speed >= v && !yaDicho.has('v' + v)) { yaDicho.add('v' + v); ui.aviso(FRASES.velocidad[v], `${v} km/h`, 'ambar'); narrador.decir('velocidad' + v); }
    }
    if (carrera.danio >= 50 && !yaDicho.has('d50')) { yaDicho.add('d50'); ui.aviso('¡ESO VA A SALIR CARO, MIJO!', 'daño 50 %', 'rojo'); narrador.decir('danio50'); }
    if (carrera.danio >= 80 && !yaDicho.has('d80')) { yaDicho.add('d80'); ui.aviso('¡EL CARRO YA NO DA MÁS!', 'un golpe más y lo detienen', 'rojo'); narrador.decir('danio80'); }
  }
  sonidoPersecucion();
  humoDeDanio(dt);
  humoDePatrullas(dt);

  if (tel) {
    fx.update(tel, dt);
    humoNegro.update(dt);
    audio.update(tel, dt);
    lucesDelCarro(tel);
  }
  tickLinea(dt);

  ctxCamara.cuerpo = vehicle.bodyRoot;
  ctxCamara.velocidadKmh = vehicle.speedKmh;
  ctxCamara.derrapeGrados = tel ? tel.slip : 0;
  director.actualizar(ctxCamara, dt);

  const b = vehicle.bodyRoot.position;
  sun.position.copy(b).addScaledVector(DIR_SOL, DIST_SOL);
  sun.target.position.copy(b);
  sun.target.updateMatrixWorld();

  post.render(dt, {
    kmh: tel ? tel.speed : 0,
    derrape: tel ? tel.slip : 0,
    persecucion: !!(persecucion?.activa && estado === 'juego'),
  });
  if (tel && !$('#hud').hidden) hud.update(tel, dt, { fps: loop.fps, steps: loop.lastSteps, dropped: loop.dropped });
  if (carrera && (estado === 'juego' || estado === 'cuenta' || estado === 'fin') && tel) {
    ui.actualizar({
      puntos: carrera.puntos, km: carrera.km,
      record: Math.max(carrera.recordPuntos, carrera.puntos),
      vel: tel.speed, marcha: String(tel.gear), rpm01: engine.normalizedRPM ?? 0,
      combo: carrera.combo, combo01: carrera.tCombo / VENTANA_COMBO,
      persecucion: persecucion?.activa && estado === 'juego', danio: carrera.danio,
      distanciaPatrulla: persecucion?.activa ? persecucion.cercana.distancia : Infinity,
      multas: carrera.fotomultas,
    }, dt);
  }
}

// ------------------------------------------------------------- en línea
function abrirLinea() {
  ui.ocultarMenu();
  ui.mostrarLinea(true, {
    apodo: prefs.apodo || '',
    codigo: sala?.codigo || codigoNuevo(),
    nube: HAY_NUBE,
  });
  refrescarSala();
}

async function entrarSala() {
  if (sala?.dentro) { ui.mostrarLinea(false); if (estado === 'menu') mostrarMenu(); return; }
  const apodo = ui.apodo || 'JERO';
  const codigo = normalizarCodigo(ui.codigo);
  if (codigo.length < 3) { ui.salaEstado('fuera', 'El código necesita al menos 3 letras.'); return; }
  prefs.apodo = apodo;
  guardarPrefs();
  sala?.salir();
  sala = new Sala({ codigo, apodo, carro: prefs.carro });
  sala.on.cambio = () => refrescarSala();
  sala.on.aviso = (txt) => ui.aviso(txt.toUpperCase(), 'sala ' + sala.codigo, '', 1800);
  await sala.entrar();
  if (sala.estado === 'dentro') ui.aviso('ESTÁS EN LA SALA', sala.codigo, '', 1800);
}

function salirSala() {
  sala?.salir();
  sala = null;
  refrescarSala();
  if (estado === 'menu') mostrarMenu();
}

function refrescarSala() {
  const e = sala?.estado ?? 'fuera';
  const textos = {
    fuera: HAY_NUBE ? '' : 'Sin servidor: por ahora solo entre pestañas de este navegador.',
    entrando: 'Conectando con la sala…',
    dentro: `En la sala ${sala?.codigo} · ${sala?.cuantos} ${sala?.cuantos === 1 ? 'jugador' : 'jugadores'}`,
    error: 'No se pudo entrar: ' + (sala?.error ?? 'revisa la conexión'),
  };
  ui.salaEstado(e, textos[e]);
  ui.salaLista(sala?.dentro ? sala.tabla() : []);
}

async function invitarSala() {
  const codigo = normalizarCodigo(ui.codigo) || sala?.codigo;
  if (!codigo) return;
  const url = `${location.origin}${location.pathname}?sala=${codigo}`;
  const texto = `Entra a mi sala de JERO RACER. Código: ${codigo}`;
  try {
    if (navigator.share) { await navigator.share({ title: 'JERO RACER', text: texto, url }); return; }
    await navigator.clipboard.writeText(`${texto} ${url}`);
    ui.salaEstado(sala?.estado ?? 'fuera', 'Enlace copiado: pégalo en WhatsApp.');
  } catch { /* el usuario cancelo */ }
}

/** Anuncia donde voy, mueve a los demás y reparte los rozones entre jugadores. */
function tickLinea(dt) {
  if (!sala) return;
  tReloj += dt;
  const b = vehicle.bodyRoot;
  const yaw = Math.atan2(2 * (b.quaternion.w * b.quaternion.y + b.quaternion.x * b.quaternion.z),
    1 - 2 * (b.quaternion.y * b.quaternion.y + b.quaternion.z * b.quaternion.z));
  sala.publicar({
    x: b.position.x, y: b.position.y, z: b.position.z, yaw,
    kmh: tel ? tel.speed : 0, freno: tel ? tel.brake > 0.06 || tel.handbrake : false,
    puntos: carrera?.puntos ?? 0, km: carrera?.km ?? 0,
    jugando: estado === 'juego',
  }, dt);
  sala.limpiar();

  if (remotos) {
    remotos.actualizar(sala, dt, { x: b.position.x, z: b.position.z, yaw, tiempo: tReloj });
    for (const ev of remotos.eventos) {
      if (estado !== 'juego' || carrera?.estado !== ESTADO.RODANDO) continue;
      const bono = carrera.rozon({ hueco: ev.hueco, pesado: false });
      if (!bono) continue;
      audio.bono(bono.combo);
      if (navigator.vibrate) navigator.vibrate(18);
      ui.aviso('¡LE PASÓ RASPANDO!', `+${bono.bono} · ${ev.apodo}`, '', 1400);
    }
  }
  ui.salaHud(sala.dentro ? sala.codigo : null, sala.tabla());
}

/**
 * Pilotos, direccionales y reversa del coche del jugador.
 * Las estacionarias se prenden al terminar la partida: es lo que hace
 * cualquiera tras un totazo, y remata bien el plano del final.
 */
function lucesDelCarro(t) {
  if (!carro) return;
  const parpadeo = (performance.now() / 420 | 0) % 2;
  const estacionarias = estado === 'fin' ? parpadeo : 0;
  carro.luces({
    freno: t.brake > 0.06 || t.handbrake ? 1 : 0,
    reversa: t.gearNum < 0 ? 1 : 0,
    izq: estacionarias, der: estacionarias,
  });
}

/** Avisos, sonido y efectos de cada evento de la persecucion. */
function avisoPersecucion(ev) {
  switch (ev.tipo) {
    case 'inicio':
      ui.aviso(una(FRASES.persecucion), 'baje de 170 km/h para que lo dejen', 'rojo');
      narrador.decir('persecucion');
      break;
    case 'fin':
      if (estado === 'juego') {
        ui.aviso(una(FRASES.escape), ev.bono ? `+${ev.bono} por la persecución` : 'lo dejaron', 'ambar');
        narrador.decir('escape');
      }
      break;
    case 'ejercito':
      ui.aviso(una(FRASES.ejercito), 'esto se puso serio, mijo', 'rojo');
      narrador.decir('ejercito');
      break;
    case 'helicoptero':
      ui.aviso(una(FRASES.helicoptero), 'helicóptero de la Policía', 'rojo');
      narrador.decir('helicoptero');
      break;
    case 'megafono':
      ui.aviso(una(FRASES.megafono), '📢 megáfono', 'rojo');
      narrador.decir('megafono');
      break;
    case 'tiroteo':
      ui.aviso(una(FRASES.tiroteo), '¡le están disparando!', 'rojo');
      narrador.decir('tiroteo');
      break;
    case 'estrellada': {
      const d = distanciaAlJugador(ev);
      audio.golpe(Math.max(0.2, 1 - d / 140) * Math.min(1, 0.5 + ev.fuerza / 30));
      if (d < 40) director.sacudir(0.05 + (40 - d) * 0.003);
      chispazo(ev, 34);
      if (estado === 'juego') {
        const titulo = ev.militar ? una(FRASES.estrelladaEjercito) : una(FRASES.estrellada);
        ui.aviso(titulo, `contra ${articulo(ev.contra)}${ev.bono ? ` · +${ev.bono}` : ''}`, 'ambar');
        narrador.decir(ev.militar ? 'estrelladaEjercito' : /tractomula|camión|bus/.test(ev.contra) ? 'estrelladaMula' : 'estrellada');
      }
      break;
    }
    case 'roce':
      if (distanciaAlJugador(ev) < 60) { audio.golpe(0.25); chispazo(ev, 10); }
      break;
    case 'golpe': {
      audio.golpe(ev.fuerza / 34);
      director.sacudir(0.1 + ev.fuerza * 0.008);
      if (navigator.vibrate) navigator.vibrate(60);
      for (let i = 0; i < 26; i++) {
        fx.chispas.emit(ev.x + (Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.6, ev.z + (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 8, 1 + Math.random() * 3, (Math.random() - 0.5) * 6,
          0.3 + Math.random() * 0.4, 0.05 + Math.random() * 0.04, 2.4, 1.2, 0.3);
      }
      ui.aviso(ev.chatarra ? '¡SE COMIÓ LA PATRULLA ESTRELLADA!' : una(FRASES.golpe), `daño ${Math.round(carrera.danio)} %`, 'rojo');
      narrador.decir('golpe');
      break;
    }
    case 'disparo': {
      audio.disparo(ev.distancia, -Math.sign(ev.boca.x - vehicle.body.translation().x));
      // Fogonazo en la boca del arma.
      for (let i = 0; i < 6; i++) {
        fx.llama.emit(ev.boca.x, ev.boca.y, ev.boca.z, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 3 + Math.random() * 4,
          0.04 + Math.random() * 0.03, 0.18 + Math.random() * 0.12, 2.2, 1.6, 0.5);
      }
      if (ev.acierta) {
        for (let i = 0; i < 8; i++) {
          fx.chispas.emit(ev.destino.x, ev.destino.y, ev.destino.z, (Math.random() - 0.5) * 6, Math.random() * 3, (Math.random() - 0.5) * 6,
            0.2 + Math.random() * 0.3, 0.04 + Math.random() * 0.03, 2.4, 1.4, 0.4);
        }
        director.sacudir(0.04);
      }
      break;
    }
  }
}

function distanciaAlJugador(ev) {
  const p = vehicle.body.translation();
  return Math.hypot(ev.x - p.x, ev.z - p.z);
}

function chispazo(ev, n) {
  for (let i = 0; i < n; i++) {
    fx.chispas.emit(ev.x + (Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 0.7, ev.z + (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 9, 1 + Math.random() * 4, (Math.random() - 0.3) * 8,
      0.3 + Math.random() * 0.5, 0.05 + Math.random() * 0.04, 2.4, 1.2, 0.3);
  }
}

/**
 * Avisos de las camaras. Primera: "te cogio". Desde la segunda: "te cogio
 * otra" con la frase de la plata. Las escondidas tienen su propio chiste.
 */
function avisoFotomulta(f) {
  if (f.salvada != null) {
    if (f.salvada) {
      ui.aviso('¡SE SALVÓ DE LA FOTOMULTA!', `pasó juicioso a ${Math.round(f.kmh)} km/h · +${f.salvada}`, 'ambar');
      narrador.decir('salvada');
    }
    return;
  }
  if (!f.n) return;
  ui.flash();
  audio.fotomulta(f.n);
  narrador.decir(f.oculta ? 'fotomultaOculta' : f.n === 1 ? 'fotomulta' : 'fotomultaOtra');
  if (navigator.vibrate) navigator.vibrate([0, 35, 70, 35]);
  let titulo, sub;
  if (f.oculta) {
    titulo = 'JUMMM… TE COGIÓ LA QUE NI AVISO TIENE';
    sub = yaDicho.has('multaOculta') ? una(FRASES.multaOculta) : FRASES.multaOculta[0];
    yaDicho.add('multaOculta');
  } else if (f.n === 1) {
    titulo = '¡TE COGIÓ LA FOTOMULTA!';
    sub = `ibas a ${Math.round(f.kmh)} km/h y el límite es ${f.limite}`;
  } else {
    titulo = '¡TE COGIÓ OTRA FOTOMULTA!';
    sub = yaDicho.has('multaOtra') ? una(FRASES.multaOtra) : FRASES.multaOtra[0];
    yaDicho.add('multaOtra');
  }
  if (f.n > 1) sub = `Van ${f.n}. ${sub}`;
  ui.aviso(titulo, sub, 'multa', 3400);
}

/** Humo de las unidades estrelladas. */
function humoDePatrullas(dt) {
  if (!persecucion || !humoNegro) return;
  for (const u of persecucion.unidades) {
    if (!u.activo || !u.chocada) continue;
    // Columna gruesa y oscura desde el capo: tiene que verse a 50 m.
    u.acumHumo += dt * 18;
    while (u.acumHumo >= 1) {
      u.acumHumo -= 1;
      const tono = 0.1 + Math.random() * 0.08;
      humoNegro.emit(u.x + (Math.random() - 0.5) * 0.8, 1.9, u.z + (Math.random() - 0.5) * 1.2,
        (Math.random() - 0.5) * 0.9, 2.2 + Math.random() * 1.4, (Math.random() - 0.5) * 0.9,
        1.7 + Math.random() * 1.0, 1.2 + Math.random() * 0.7, tono, tono, tono * 1.05);
    }
  }
}

/** Sirena y helicoptero segun lo cerca que esten. */
function sonidoPersecucion() {
  if (!persecucion || !audio.ready) return;
  const c = persecucion.cercana;
  const sirena = Number.isFinite(c.distancia) ? Math.max(0, 1 - c.distancia / 260) : 0;
  // +X es la izquierda del coche y, con la camara detras, la izquierda de la pantalla.
  audio.sirena(estado === 'pausa' ? 0 : sirena, -c.lado, c.distancia < 30);
  let heli = 0;
  if (persecucion.heliActivo) {
    const h = persecucion.heliPos, p = vehicle.body.translation();
    heli = Math.max(0, 1 - Math.hypot(h.x - p.x, h.y - p.y, h.z - p.z) / 180);
  }
  audio.helicoptero(heli);
}

/** Humo del capo cuando el carro esta muy golpeado. */
let acumHumoDanio = 0;
function humoDeDanio(dt) {
  if (!carrera || carrera.danio < 40 || !fx) return;
  const k = (carrera.danio - 40) / 60;
  acumHumoDanio += dt * (6 + k * 30);
  const b = vehicle.bodyRoot;
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(b.quaternion);
  while (acumHumoDanio >= 1) {
    acumHumoDanio -= 1;
    const tono = 0.62 - 0.48 * k;
    fx.humo.emit(b.position.x + fwd.x * 1.5 + (Math.random() - 0.5) * 0.6, b.position.y + 0.85, b.position.z + fwd.z * 1.5,
      -fwd.x * 2 + (Math.random() - 0.5), 1.2 + Math.random(), -fwd.z * 2 + (Math.random() - 0.5),
      0.9 + Math.random() * 0.8, 0.5 + k * 0.7, tono, tono, tono);
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
  steeringTeclas.reset(); steeringAnalogico.reset(); throttleM.reset(); brakeM.reset();
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
    persecucion.reiniciar();
    narrador.reiniciar();
    yaDicho.clear();
    zFoto = null;
  }
  vehicle.respawn(SPAWN, 0);
  tiempoVolcado = 0;
  if (fx) fx.clear();
  humoNegro?.clear();
  steeringTeclas.reset(); steeringAnalogico.reset();
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
