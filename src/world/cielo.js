/* ==========================================================================
   HIGHWAY RACER · Cielo atmosferico
   --------------------------------------------------------------------------
   La escena fotorrealista pintaba el horizonte de negro (#0a0e14): sobre la
   ciudad fotografiada quedaba un vacio que delata al instante que aquello es
   un render. Aqui se genera un cielo de dispersion de Rayleigh/Mie y se usa
   como fondo Y como iluminacion de entorno.

   POR QUE NO SE ANADE LA MALLA DE CIELO A LA ESCENA
   El `Sky` de three.js es un ShaderMaterial propio con `depthWrite:false` pero
   SIN los chunks de profundidad logaritmica. En esta escena el renderer usa
   buffer logaritmico (hacen falta 20 km de alcance), asi que su test de
   profundidad quedaria desincronizado con el del resto de la escena y el cielo
   podria tapar edificios o desaparecer detras del terreno. En vez de parchear
   su shader, se cuece el cielo UNA vez a un mapa PMREM y se descarta la malla:
   sin geometria de cielo no hay test de profundidad que pueda fallar.

   EL REGALO: el mismo mapa sirve de `scene.environment`. Antes el coche
   reflejaba un RoomEnvironment — un estudio de interior — en mitad de una
   ciudad al aire libre. Ahora refleja el cielo que realmente tiene encima.
   ========================================================================== */

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

/**
 * Ajustes de un dia claro en el Valle de Aburra.
 *
 * El sol alto NO es capricho: la fotogrametria de Google se vuela cerca del
 * mediodia y trae sus sombras horneadas. Si aqui se pone un sol bajo, la sombra
 * del coche cae en una direccion y las del suelo fotografiado en otra, y el
 * ojo lo detecta al momento. Un sol alto deja sombras cortas y el desajuste
 * se vuelve inapreciable.
 *
 * `turbidez` 5 es la calima real del valle: a 2 el cielo sale de alta montana
 * y no pega con una ciudad a 1.600 m rodeada de industria.
 */
export const CIELO_MEDELLIN = Object.freeze({
  elevacion: 64,        // grados sobre el horizonte
  azimut: 285,          // grados desde el NORTE, en sentido horario
  turbidez: 5.0,
  rayleigh: 2.1,
  mieCoeficiente: 0.005,
  mieDireccional: 0.8,

  // LOS DOS NUMEROS QUE MAS IMPORTAN, Y NO SE ADIVINARON.
  // El shader de Sky emite radiancia calibrada para exposicion 0,5; aqui el
  // tone mapping ACES corre a 1,0 y no se puede bajar porque la fotogrametria
  // usa MeshBasicMaterial y tambien la afecta: oscurecerla arruinaria la
  // ciudad para arreglar el cielo. Se escala el fondo en su lugar.
  // Medido leyendo pixeles del cielo con readPixels:
  //   1,00 -> (228,237,243) saturacion 0,06  = blanco, no parece cielo
  //   0,30 -> (167,190,209) saturacion 0,20
  //   0,17 -> (129,156,180) saturacion 0,28  = azul con la calima del valle
  //   0,06 -> ( 57, 79,101) saturacion 0,44  = noche prematura
  intensidadFondo: 0.17,

  // Y el mismo cielo iluminando el coche lo lavaba: a intensidad 1 la carroceria
  // roja medía (149,119,115) — practicamente gris, saturacion 0,23. A 0,45 vuelve
  // a (113,75,75) con saturacion 0,34 y sigue reflejando el cielo de verdad.
  intensidadEntorno: 0.45,
});

/**
 * Direccion hacia el sol en coordenadas del mundo.
 *
 * OJO CON LOS EJES: en este proyecto +X es el este y el norte es −Z (ver
 * latLonAMetros en photoreal.js, que niega la latitud). Por eso no sirve
 * setFromSphericalCoords tal cual — su theta=0 apunta a +Z, que aqui es el SUR.
 * Se construye el vector a mano para que el azimut sea el de una brujula.
 */
export function direccionSolar(elevacionGrados, azimutGrados) {
  const el = THREE.MathUtils.degToRad(elevacionGrados);
  const az = THREE.MathUtils.degToRad(azimutGrados);
  return new THREE.Vector3(
    Math.cos(el) * Math.sin(az),    // este
    Math.sin(el),                   // arriba
    -Math.cos(el) * Math.cos(az),   // el norte es −Z
  );
}

/**
 * Cuece el cielo a un PMREM y lo instala como fondo y entorno de la escena.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {object} [ajustes] mezcla sobre CIELO_MEDELLIN
 * @returns {{direccionSol:THREE.Vector3, destino:THREE.WebGLRenderTarget, dispose:Function}}
 */
export function instalarCielo(renderer, scene, ajustes = {}) {
  const a = { ...CIELO_MEDELLIN, ...ajustes };
  const direccionSol = direccionSolar(a.elevacion, a.azimut);

  const sky = new Sky();
  // El shader solo depende de la DIRECCION, no de la distancia: la escala solo
  // tiene que dejar la camara del PMREM dentro de la esfera.
  sky.scale.setScalar(1000);
  const u = sky.material.uniforms;
  u.turbidity.value = a.turbidez;
  u.rayleigh.value = a.rayleigh;
  u.mieCoefficient.value = a.mieCoeficiente;
  u.mieDirectionalG.value = a.mieDireccional;
  u.sunPosition.value.copy(direccionSol);

  const escenaCielo = new THREE.Scene();
  escenaCielo.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  // El `far` tiene que pasar de la escala de la esfera o el cielo se recorta.
  const destino = pmrem.fromScene(escenaCielo, 0, 0.1, 5000);
  pmrem.dispose();
  sky.geometry.dispose();
  sky.material.dispose();

  scene.background = destino.texture;
  scene.environment = destino.texture;
  scene.backgroundIntensity = a.intensidadFondo;
  scene.environmentIntensity = a.intensidadEntorno;

  return {
    direccionSol,
    destino,
    dispose() {
      if (scene.background === destino.texture) scene.background = null;
      if (scene.environment === destino.texture) scene.environment = null;
      scene.backgroundIntensity = 1;
      scene.environmentIntensity = 1;
      destino.dispose();
    },
  };
}

/**
 * Alinea la luz direccional con el sol del cielo y la deja a una intensidad que
 * no reviente la fotogrametria.
 *
 * LA TRAMPA: las teselas de Google vienen con la luz YA horneada en la textura.
 * La direccional no esta ahi para iluminar la ciudad — eso seria iluminarla dos
 * veces y lavarla — sino para que el COCHE proyecte una sombra que lo pose en
 * el suelo. Por eso va floja y con la sombra encuadrada corta alrededor del
 * vehiculo, no abarcando media ciudad.
 */
export function alinearSol(sun, direccionSol, { distancia = 60, intensidad = 2.4 } = {}) {
  sun.intensity = intensidad;
  sun.color.setHex(0xfff4e2);
  sun.position.copy(direccionSol).multiplyScalar(distancia);
  sun.target.position.set(0, 0, 0);
  sun.target.updateMatrixWorld();
  return sun;
}
