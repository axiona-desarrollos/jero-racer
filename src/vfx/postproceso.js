/* ==========================================================================
   JERO RACER · Postproceso
   --------------------------------------------------------------------------
   Lo que separa un render de tres.js "correcto" de algo que parezca un juego
   de verdad no es mas poligonos: es lo que pasa DESPUES de pintar la escena.

     OCLUSION AMBIENTAL (GTAO)  mete sombra en los rincones que la luz del
       cielo no alcanza — bajo el coche, dentro de los pasos de rueda, en la
       junta de la calzada con la berma. Sin ella todo flota.
     RESPLANDOR (bloom)         los faros, el sol, los letreros LED y las
       chispas dejan de ser pixeles claros y pasan a tener halo, que es lo
       que el ojo lee como "esto brilla de verdad".
     VELOCIDAD                  desenfoque radial + aberracion cromatica que
       crecen con los km/h. Es el efecto mas barato y el que mas sensacion de
       velocidad da: a 240 km/h la autopista tiene que dar miedo.
     GRADO DE COLOR             contraste, saturacion y viñeta. El render
       crudo de tres.js sale plano y lavado; esto le da el contraste de una
       pelicula.

   TODO ESTO CUESTA RELLENO DE PANTALLA, que es justo lo que no sobra en un
   movil. Por eso la cadena se arma por niveles:
     alta  -> GTAO + resplandor + velocidad + grado, con MSAA x4
     media -> resplandor pequeño + velocidad + grado
     baja  -> NADA: se pinta directo a la pantalla, como antes
   Y `?post=0` en la URL la apaga entera para comparar.

   EL TONO SE APLICA AL FINAL, NO AL PRINCIPIO. Al pintar a un destino
   intermedio tres.js NO aplica tone mapping (solo lo hace contra el lienzo),
   asi que la cadena trabaja en luz lineal sin recortar y el OutputPass hace
   el ACES al final. Si se hiciera al reves, el resplandor se alimentaria de
   colores ya recortados a 1,0 y no habria nada que hacer brillar.
   ========================================================================== */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

/**
 * Velocidad, aberracion, viñeta y grado en UNA sola pasada.
 *
 * Van juntos a proposito: cada pasada extra lee y escribe la pantalla
 * entera, y a 1600x900 con densidad 2 eso son 11 millones de pixeles de ida
 * y vuelta. Cuatro efectos en un shader cuestan una lectura; en cuatro
 * pasadas, cuatro.
 */
const ShaderVelocidad = {
  name: 'Velocidad',
  uniforms: {
    tDiffuse: { value: null },
    uVel: { value: 0 },            // 0..1, cuanta velocidad se siente
    uAberracion: { value: 0 },
    uVineta: { value: 0.32 },
    uContraste: { value: 1.06 },
    uSaturacion: { value: 1.10 },
    uCentro: { value: new THREE.Vector2(0.5, 0.5) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uVel;
    uniform float uAberracion;
    uniform float uVineta;
    uniform float uContraste;
    uniform float uSaturacion;
    uniform vec2 uCentro;
    varying vec2 vUv;

    void main() {
      vec2 d = vUv - uCentro;
      float r = length(d);

      // El desenfoque NO toca el centro de la pantalla: ahi es donde el
      // jugador mira para esquivar, y emborronarlo es injusto. Crece solo
      // hacia los bordes, que es ademas como funciona la vision periferica.
      float fuerza = uVel * smoothstep(0.10, 0.80, r);
      float ab = uAberracion * r * r;

      vec3 col = vec3(0.0);
      const int N = 8;
      for (int i = 0; i < N; i++) {
        float t = float(i) / float(N - 1);
        vec2 uv = vUv - d * fuerza * 0.17 * t;
        col.r += texture2D(tDiffuse, uv + d * ab).r;
        col.g += texture2D(tDiffuse, uv).g;
        col.b += texture2D(tDiffuse, uv - d * ab).b;
      }
      col /= float(N);

      col *= 1.0 - uVineta * smoothstep(0.34, 1.05, r);
      col = (col - 0.5) * uContraste + 0.5;
      float gris = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(gris), col, uSaturacion);

      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }`,
};

/** Ajustes de cada nivel. */
const NIVELES = {
  alta: { ao: true, resplandor: 0.42, muestras: 4, umbral: 0.86 },
  media: { ao: false, resplandor: 0.30, muestras: 0, umbral: 0.90 },
  baja: null,
};

export class Postproceso {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera
   * @param {{nombre:string}} CAL nivel de calidad
   */
  constructor(renderer, scene, camera, CAL) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const forzado = new URLSearchParams(location.search).get('post');
    const nivel = forzado === '0' ? null : NIVELES[forzado && NIVELES[forzado] !== undefined ? forzado : CAL.nombre];
    this.nivel = nivel;
    this.activo = !!nivel;
    this.vel = 0;
    if (!this.activo) return;

    const { width: w, height: h } = renderer.getDrawingBufferSize(new THREE.Vector2());
    // MSAA en el destino intermedio: resuelve los bordes de geometria, que es
    // lo que mas canta. Al pintar por composer, el `antialias:true` del
    // lienzo deja de tener efecto y sin esto todo sale con dientes de sierra.
    const destino = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, samples: nivel.muestras,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    this.composer = new EffectComposer(renderer, destino);

    this.composer.addPass(new RenderPass(scene, camera));

    if (nivel.ao) {
      this.gtao = new GTAOPass(scene, camera, w, h);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.75;
      // Radio corto: la oclusion que importa es la de contacto (el coche con
      // el asfalto, la rueda con su paso). Uno largo oscurece la via entera.
      this.gtao.updateGtaoMaterial({ radius: 0.28, distanceExponent: 1.0, thickness: 1.0, scale: 1.0, samples: 12 });
      this.composer.addPass(this.gtao);
    }

    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), nivel.resplandor, 0.62, nivel.umbral);
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());

    this.velocidad = new ShaderPass(ShaderVelocidad);
    this.composer.addPass(this.velocidad);
  }

  /** @param {number} ancho px del lienzo (sin densidad) */
  redimensionar(ancho, alto, densidad) {
    if (!this.activo) return;
    this.composer.setPixelRatio(densidad);
    this.composer.setSize(ancho, alto);
  }

  /**
   * @param {number} dt
   * @param {{kmh:number, derrape:number, persecucion:boolean}} estado
   */
  render(dt, estado = {}) {
    if (!this.activo) { this.renderer.render(this.scene, this.camera); return; }

    // La sensacion de velocidad no es lineal con los km/h: por debajo de 90
    // no se desenfoca nada, y de ahi arriba sube rapido. El derrape suma
    // porque atravesado se ve pasar el mundo de lado.
    const kmh = Math.abs(estado.kmh ?? 0);
    const objetivo = Math.min(1, Math.max(0, (kmh - 90) / 150) + Math.min(0.35, Math.abs(estado.derrape ?? 0) / 90));
    // Suavizado independiente de los fotogramas por segundo.
    this.vel += (objetivo - this.vel) * (1 - Math.pow(0.02, Math.min(dt, 0.1)));

    const u = this.velocidad.uniforms;
    u.uVel.value = this.vel;
    u.uAberracion.value = this.vel * 0.010;
    u.uVineta.value = 0.30 + this.vel * 0.18;
    // En persecucion se cierra el color: mas contraste y menos saturacion,
    // como el "modo peligro" de cualquier juego de carreras.
    const pers = estado.persecucion ? 1 : 0;
    u.uContraste.value = 1.06 + this.vel * 0.05 + pers * 0.06;
    u.uSaturacion.value = 1.10 + this.vel * 0.06 - pers * 0.10;

    this.composer.render(dt);
  }

  dispose() {
    if (!this.activo) return;
    this.composer.dispose();
  }
}
