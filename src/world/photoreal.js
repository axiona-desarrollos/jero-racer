/* ==========================================================================
   HIGHWAY RACER · Medellín fotorrealista
   --------------------------------------------------------------------------
   Google Photorealistic 3D Tiles sobre la Glorieta Pilsen (Itagüí), con la
   geometria real de OpenStreetMap como calzada conducible.

   DECISION DE ARQUITECTURA: LA FOTOGRAMETRIA ES SOLO VISUAL.
   Sacar colision de una malla fotogrametrica es caro y fragil: son millones
   de triangulos que entran y salen por streaming, sin topologia limpia y sin
   distinguir asfalto de acera o de arbol. El coche rodaria sobre ruido.
   En su lugar, la colision se construye a partir del trazado REAL de la
   glorieta en OSM — 21 nodos, 71,5 m de diametro, 3 carriles — y la ciudad
   fotorrealista se dibuja alrededor.

   DONDE ESTA EL SUELO: LA TRAMPA DE LA ALTURA ELIPSOIDAL
   ReorientationPlugin con height=0 no pone el ORIGEN en el suelo: lo pone en
   la superficie del ELIPSOIDE WGS84. Itagui esta a ~1.612 m sobre el, asi que
   el asfalto aparecia a y=+1612 mientras el resto del motor (reaparicion,
   sombras, particulas) daba por hecho y~0. Medido, no supuesto: ver
   anclarEnElSuelo(), que baja el globo entero hasta dejar el asfalto en y=0.

   POR QUE NO VALE UN SOLO RAYO EN EL CENTRO
   El centro de una glorieta lleva arboles o un monumento, y la fotogrametria
   congela coches sobre la calzada. Un rayo suelto devuelve la copa del arbol.
   Se muestrea el EJE del trazado en circulo y se toma la MEDIANA.

   COSTE
   Cada arranque abre UNA sesion de la Map Tiles API. Google da 1.000 gratis
   al mes y despues cobra. Para grabar video sobra; para publicar el juego,
   no. Por eso convive con la glorieta procedural, que es gratis e ilimitada.
   ========================================================================== */

import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import {
  GoogleCloudAuthPlugin, ReorientationPlugin,
  TilesFadePlugin, TileCompressionPlugin,
} from '3d-tiles-renderer/plugins';

const GOOGLE_ROOT = 'https://tile.googleapis.com/v1/3dtiles/root.json';

/** Radio medio de la Tierra para pasar lat/lon a metros locales. */
const R_TIERRA = 6378137.0;

/**
 * Calidad de la fotogrametria.
 *
 * `errorTarget` son los pixeles de error que se toleran antes de pedir el
 * siguiente nivel de detalle: cuanto menor, mas nitido y mas se descarga.
 * `useRecommendedSettings` lo deja en 20, que es el ajuste MAS FLOJO — por
 * encima incluso del 16 por defecto de la libreria — y sirve para sobrevolar
 * una ciudad, no para conducir dentro de ella.
 *
 * DONDE ESTA EL LIMITE, MEDIDO EN ESTA MAQUINA (1280x720, misma camara):
 *    20 -> 32 fps ·  518 llamadas ·  147 teselas
 *    16 -> 31 fps ·  628 llamadas ·  202 teselas
 *    12 -> 21 fps ·  832 llamadas ·  304 teselas
 *    10 -> 20 fps ·  972 llamadas ·  374 teselas
 *     6 -> 11 fps · 1924 llamadas ·  850 teselas
 * El coste NO son los triangulos (533k a 1M, poco para esta GPU) sino las
 * LLAMADAS DE DIBUJO: cada tesela es una, y con 6 se pasa de 1.900. Se fija 12,
 * que duplica el detalle de 20 y deja margen de sobra. Bajar mas exige antes
 * agrupar teselas en lotes (BatchedTilesPlugin), no subir la GPU.
 */
export const CALIDAD_POR_DEFECTO = Object.freeze({
  errorTarget: 12,
  anisotropia: 16,
});

/** Pasa un punto lat/lon a metros en el plano local centrado en `origen`. */
export function latLonAMetros(lat, lon, origen) {
  const dLat = THREE.MathUtils.degToRad(lat - origen.lat);
  const dLon = THREE.MathUtils.degToRad(lon - origen.lon);
  const cos = Math.cos(THREE.MathUtils.degToRad(origen.lat));
  return {
    // +X este, +Z sur. En Three.js miramos a -Z, asi que el norte queda a -Z.
    x: dLon * cos * R_TIERRA,
    z: -dLat * R_TIERRA,
  };
}

/**
 * Espera al siguiente frame, pero sin quedarse colgada si no hay frames.
 * En una pestaña de fondo el navegador CONGELA requestAnimationFrame: un
 * `await new Promise(r => requestAnimationFrame(r))` no vuelve nunca y la
 * carga se queda muerta hasta que el usuario mira la pestaña. Con la carrera
 * contra un temporizador, en segundo plano sigue avanzando a ~10 Hz.
 */
function esperarFrame() {
  return new Promise(resolver => {
    const id = setTimeout(resolver, 100);
    requestAnimationFrame(() => { clearTimeout(id); resolver(); });
  });
}

/** Radio medio del trazado OSM en metros: el eje por donde se conduce. */
export function radioEjeOSM(pista) {
  const o = pista.center;
  const radios = pista.geometry.map(p => {
    const m = latLonAMetros(p.lat, p.lon, o);
    return Math.hypot(m.x, m.z);
  });
  return radios.reduce((a, b) => a + b, 0) / radios.length;
}

export class CiudadFotorrealista {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} pista  glorieta-pilsen.json ya cargado
   * @param {string} apiKey clave de Google Maps Platform
   */
  constructor(scene, camera, renderer, pista, apiKey, calidad = CALIDAD_POR_DEFECTO) {
    calidad = { ...CALIDAD_POR_DEFECTO, ...calidad };
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.pista = pista;
    this.listo = false;
    this.alturaSuelo = null;
    this.elevacion = null;
    this.planitud = null;
    this.atribucion = '';
    this.onProgreso = null;
    this.onAtribucion = null;

    const { lat, lon } = pista.center;

    const tiles = this.tiles = new TilesRenderer(GOOGLE_ROOT);
    tiles.registerPlugin(new GoogleCloudAuthPlugin({
      apiToken: apiKey,
      autoRefreshToken: true,
      useRecommendedSettings: true,
    }));
    // Ancla el globo entero para que este punto quede en el origen con Y arriba.
    // OJO: lat y lon van en RADIANES — confirmado leyendo la fuente del paquete.
    // `up` solo actua de respaldo cuando NO hay lat/lon, asi que aqui sobra.
    this.reorientacion = new ReorientationPlugin({
      lat: THREE.MathUtils.degToRad(lat),
      lon: THREE.MathUtils.degToRad(lon),
      height: 0,
      recenter: true,
    });
    tiles.registerPlugin(this.reorientacion);
    // Fundido entre niveles de detalle: sin esto se ve el "pop" de las teselas.
    tiles.registerPlugin(new TilesFadePlugin({ fadeDuration: 320 }));
    // Comprime los atributos en GPU: baja mucho la memoria de video.
    tiles.registerPlugin(new TileCompressionPlugin());

    // Un fallo de clave, de cuota o de facturacion hacia que el renderer se
    // quedase mudo: cero peticiones, cero teselas y ningun error. Sin esto no
    // hay forma de distinguir "sin red" de "clave mal restringida".
    this.errores = [];
    tiles.addEventListener('load-error', e => {
      const msg = `${e.error?.message ?? e.error ?? 'desconocido'} @ ${e.url ?? ''}`;
      this.errores.push(msg);
      if (this.errores.length <= 3) console.error('[medellin] fallo de tesela:', msg);
    });
    tiles.addEventListener('load-tile-set', () => console.info('[medellin] tileset raiz cargado'));

    // --- CALIDAD: los dos diales que hacian que la ciudad pareciera pintada --
    //
    // 1. errorTarget es el error admisible en PIXELES de pantalla antes de
    //    bajar un nivel de detalle. `useRecommendedSettings` lo deja en 20, que
    //    es el ajuste MAS FLOJO de todos — por encima incluso del 16 por defecto
    //    de la libreria. A ras de calle eso convierte el asfalto en una mancha.
    //    Se baja despues de registrar el plugin, que es quien lo sube.
    tiles.errorTarget = calidad.errorTarget;

    // 2. Sin filtrado anisotropico, una calzada mirada casi de canto se deshace:
    //    la GPU muestrea el mipmap por el eje corto y promedia medio metro de
    //    asfalto en un texel. Medido aqui: 0 de 105 texturas lo tenian. Y la
    //    anisotropia NO hace nada sin mipmaps, que venian desactivados, asi que
    //    hay que activar las dos cosas o no se nota ninguna.
    const anisotropia = Math.min(calidad.anisotropia, renderer.capabilities.getMaxAnisotropy());
    this._afinarTexturas = raiz => {
      raiz.traverse(o => {
        const m = o.material;
        if (!m) return;
        for (const clave of ['map', 'normalMap', 'emissiveMap']) {
          const t = m[clave];
          if (!t || t.__afinada) continue;
          t.generateMipmaps = true;
          t.minFilter = THREE.LinearMipmapLinearFilter;
          t.anisotropy = anisotropia;
          t.needsUpdate = true;
          t.__afinada = true;
        }
      });
    };
    tiles.addEventListener('load-model', ({ scene: malla }) => {
      if (malla) this._afinarTexturas(malla);
    });

    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);
    tiles.group.name = 'medellin';
    scene.add(tiles.group);

    this._rayo = new THREE.Raycaster();
    this._abajo = new THREE.Vector3(0, -1, 0);
    this._desde = new THREE.Vector3();
  }

  /** Llamar cada frame ANTES de renderizar. */
  update() {
    this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
    this.camera.updateMatrixWorld();
    this.tiles.update();

    // Google exige mostrar la atribucion de las fuentes de las teselas visibles.
    const a = this.tiles.getAttributions?.() ?? [];
    const txt = a.map(x => x.value).join(' · ');
    if (txt && txt !== this.atribucion) {
      this.atribucion = txt;
      if (this.onAtribucion) this.onAtribucion(txt);
    }
  }

  get cargando() { return this.tiles.stats?.downloading ?? 0; }
  get parseando() { return this.tiles.stats?.parsing ?? 0; }

  /**
   * Deja correr el streaming, mirando donde este la camara, hasta que el arbol
   * de teselas deje de moverse. No basta con "no queda nada descargando": entre
   * dos peticiones hay frames con la cola vacia, asi que se exige que la calma
   * se repita varios frames seguidos.
   * @returns {Promise<boolean>} true si se estabilizo, false si expiro el plazo
   */
  async esperarStreaming({ ms = 15000, minVisibles = 8, framesQuietos = 5 } = {}) {
    const t0 = performance.now();
    let quietos = 0;
    while (performance.now() - t0 < ms) {
      this.update();
      this.renderer.render(this.scene, this.camera);
      const s = this.tiles.stats;
      const calmado = s.downloading === 0 && s.queued === 0 && s.parsing === 0
        && s.visible >= minVisibles;
      quietos = calmado ? quietos + 1 : 0;
      if (quietos >= framesQuietos) return true;
      if (this.onProgreso) this.onProgreso(s);
      await esperarFrame();
    }
    return false;
  }

  /**
   * Altura del asfalto muestreando el EJE de la calzada en circulo.
   * Devuelve la mediana y la dispersion, o null si aun no hay geometria.
   * @param {number} radio radio del eje del trazado, en metros
   */
  sondearCalzada(radio, { n = 16, desdeY = 3000 } = {}) {
    const alturas = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this._desde.set(Math.cos(a) * radio, desdeY, Math.sin(a) * radio);
      this._rayo.set(this._desde, this._abajo);
      const hits = this._rayo.intersectObject(this.tiles.group, true);
      if (hits.length) alturas.push(hits[0].point.y);
    }
    if (alturas.length < 3) return null;
    alturas.sort((a, b) => a - b);
    const m = alturas.length >> 1;
    return {
      mediana: alturas.length % 2 ? alturas[m] : (alturas[m - 1] + alturas[m]) / 2,
      min: alturas[0],
      max: alturas[alturas.length - 1],
      n: alturas.length,
      muestras: alturas,
    };
  }

  /**
   * Baja el globo hasta que el asfalto de la glorieta queda en y≈0.
   * Tres pases, porque no se puede medir fino lo que todavia no ha refinado:
   *   1. vista de pajaro     -> altura aproximada (dice donde hay que mirar)
   *   2. camara a esa altura -> el detalle sube al maximo -> medida buena
   *   3. re-anclado y verificacion sobre la geometria ya fina
   * @returns {Promise<object|null>} medidas, o null si las teselas no llegaron
   */
  async anclarEnElSuelo(radioCalzada) {
    const { lat, lon } = this.pista.center;
    const latR = THREE.MathUtils.degToRad(lat);
    const lonR = THREE.MathUtils.degToRad(lon);

    // --- pase 1: donde cae el terreno, a grandes rasgos ---------------------
    this.camera.position.set(0, 9000, 1400);
    this.camera.lookAt(0, 0, 0);
    await this.esperarStreaming({ ms: 20000, minVisibles: 4 });
    const aprox = this.sondearCalzada(radioCalzada, { n: 8, desdeY: 30000 });
    if (!aprox) return null;

    // --- pase 2: bajar ahi para que el nivel de detalle sea el bueno --------
    this.camera.position.set(0, aprox.mediana + 240, radioCalzada + 300);
    this.camera.lookAt(0, aprox.mediana, 0);
    await this.esperarStreaming({ ms: 25000, minVisibles: 20 });
    const fino = this.sondearCalzada(radioCalzada, { n: 24, desdeY: aprox.mediana + 2000 });
    if (!fino) return null;

    // --- re-anclado: el asfalto pasa a y≈0 ----------------------------------
    this.reorientacion.transformLatLonHeightToOrigin(latR, lonR, fino.mediana);

    // --- pase 3: comprobar sobre la geometria ya fina -----------------------
    this.camera.position.set(0, 40, radioCalzada + 55);
    this.camera.lookAt(0, 0, 0);
    await this.esperarStreaming({ ms: 25000, minVisibles: 20 });
    const ver = this.sondearCalzada(radioCalzada, { n: 24, desdeY: 900 });

    this.elevacion = fino.mediana;
    this.alturaSuelo = ver ? ver.mediana : 0;
    this.planitud = ver ? ver.max - ver.min : null;
    this.listo = true;
    return {
      elevacion: this.elevacion,
      alturaSuelo: this.alturaSuelo,
      planitud: this.planitud,
      muestras: ver ? ver.n : 0,
      perfil: ver ? ver.muestras.map(v => +v.toFixed(2)) : [],
    };
  }

  dispose() {
    this.scene.remove(this.tiles.group);
    this.tiles.dispose();
  }
}

/**
 * Muestrea la fotogrametria en rejilla regular y devuelve un mapa de alturas.
 *
 * POR QUE NO VALE UN DISCO PLANO
 * Medido sobre la glorieta real: el anillo de calzada va de −1,25 m a +1,51 m,
 * 2,76 m de desnivel. Ajustando el mejor plano inclinado posible (1,61° de
 * pendiente) todavia quedan 0,43 m de residuo RMS y 1,10 m de error maximo.
 * O sea que la glorieta no es plana NI inclinada: tiene bombeo y ramales. Con
 * un disco el coche flotaria un metro en un lado y se hundiria en el otro.
 *
 * COSTE: 0,061 ms por rayo medido en esta maquina; 129×129 = 16.641 rayos ≈ 1 s.
 * Se paga una vez, en la pantalla de carga.
 *
 * @returns {{alturas:Float32Array, n:number, paso:number, huecos:number}}
 */
export function muestrearRelieve(ciudad, { lado = 150, celdas = 128, desdeY = 900 } = {}) {
  const n = celdas + 1;
  const alturas = new Float32Array(n * n);
  const valido = new Uint8Array(n * n);
  const paso = lado / celdas;
  let huecos = 0;

  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = -lado / 2 + ix * paso;
      const z = -lado / 2 + iz * paso;
      ciudad._desde.set(x, desdeY, z);
      ciudad._rayo.set(ciudad._desde, ciudad._abajo);
      const hits = ciudad._rayo.intersectObject(ciudad.tiles.group, true);
      const k = iz * n + ix;
      if (hits.length) { alturas[k] = hits[0].point.y; valido[k] = 1; }
      else huecos++;
    }
  }

  // --- tapar huecos: media de los vecinos validos, por difusion ------------
  // Sin esto un agujero entre teselas deja un pozo de varios metros por el que
  // el coche se cae.
  for (let pase = 0; pase < 8 && huecos > 0; pase++) {
    const antes = valido.slice();
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const k = iz * n + ix;
        if (antes[k]) continue;
        let suma = 0, cuenta = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const jz = iz + dz, jx = ix + dx;
            if (jz < 0 || jz >= n || jx < 0 || jx >= n) continue;
            const j = jz * n + jx;
            if (antes[j]) { suma += alturas[j]; cuenta++; }
          }
        }
        if (cuenta) { alturas[k] = suma / cuenta; valido[k] = 1; huecos--; }
      }
    }
  }

  return { alturas, n, paso, huecos };
}

/**
 * Mediana 5×5 sobre el mapa de alturas.
 *
 * La fotogrametria congela lo que hubiera en la calle el dia del vuelo: coches
 * aparcados, un bus, una farola. Sin filtrar, cada uno de esos queda convertido
 * en un bloque de hormigon invisible contra el que el coche se estrella. Un
 * coche ocupa ~2 celdas de las 25 de la ventana, un bus ~5: la mediana los
 * ignora y deja el asfalto. Un edificio ocupa la ventana entera y SI sobrevive,
 * que es justo lo que se quiere — contra un edificio hay que chocar.
 */
export function suavizarRelieve(alturas, n, radio = 2) {
  const salida = new Float32Array(alturas.length);
  const ventana = [];
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      ventana.length = 0;
      for (let dz = -radio; dz <= radio; dz++) {
        for (let dx = -radio; dx <= radio; dx++) {
          const jz = iz + dz, jx = ix + dx;
          if (jz < 0 || jz >= n || jx < 0 || jx >= n) continue;
          ventana.push(alturas[jz * n + jx]);
        }
      }
      ventana.sort((a, b) => a - b);
      salida[iz * n + ix] = ventana[ventana.length >> 1];
    }
  }
  return salida;
}

/**
 * Altura del relieve en un punto cualquiera, interpolada bilinealmente.
 * Es la MISMA superficie que ve la fisica, asi que sirve para posar el coche
 * exactamente donde lo va a sostener el heightfield.
 */
export function alturaEnRelieve(relieve, x, z) {
  const { alturas, n, paso } = relieve;
  const lado = (n - 1) * paso;
  const fx = (x + lado / 2) / paso;
  const fz = (z + lado / 2) / paso;
  const ix = Math.max(0, Math.min(n - 2, Math.floor(fx)));
  const iz = Math.max(0, Math.min(n - 2, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - ix));
  const tz = Math.max(0, Math.min(1, fz - iz));
  const h00 = alturas[iz * n + ix], h10 = alturas[iz * n + ix + 1];
  const h01 = alturas[(iz + 1) * n + ix], h11 = alturas[(iz + 1) * n + ix + 1];
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}

/**
 * Construye la calzada conducible: el relieve REAL medido sobre la
 * fotogrametria como superficie de colision, mas el trazado de OSM como
 * referencia visual del limite de la isleta.
 *
 * El heightfield de Rapier se indexa por COLUMNAS (i recorre z, j recorre x),
 * asi que el orden no se adivina: se traspone aqui y se verifica lanzando rayos
 * contra el mundo fisico y comparandolos con la muestra visual.
 */
export function construirCalzadaOSM(scene, RAPIER, world, pista, relieve, alturaSuelo = 0) {
  const g = new THREE.Group();
  g.name = 'calzada-osm';
  scene.add(g);

  const rEje = radioEjeOSM(pista);
  const anchoCalzada = (pista.lanes ?? 3) * 3.5;
  const rInt = Math.max(2, rEje - anchoCalzada / 2);
  const rExt = rEje + anchoCalzada / 2;

  if (relieve) {
    const { alturas, n, paso } = relieve;
    const lado = (n - 1) * paso;
    // Rapier recorre el mapa en orden columna-mayor: heights[j*(nrows+1)+i]
    // con i sobre filas. Nuestra rejilla esta en fila-mayor sobre z.
    const rapierH = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) rapierH[ix * n + iz] = alturas[iz * n + ix];
    }
    world.createCollider(
      RAPIER.ColliderDesc.heightfield(n - 1, n - 1, rapierH,
        { x: lado, y: 1, z: lado })
        .setFriction(1.0));
  } else {
    // Respaldo plano por si el muestreo no encontro geometria.
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.25, rExt + 34)
        .setTranslation(0, alturaSuelo - 0.25, 0)
        .setFriction(1.0));
  }

  // Bordillo visible, discreto: la fotogrametria ya trae el suyo, este solo
  // marca donde esta el trazado real de OSM.
  const bordillo = new THREE.Mesh(
    new THREE.CylinderGeometry(rInt, rInt, 0.14, 72),
    new THREE.MeshStandardMaterial({ color: 0xd8d5cc, roughness: 0.85, transparent: true, opacity: 0.35 }));
  bordillo.position.y = alturaSuelo + 0.07;
  g.add(bordillo);

  return { grupo: g, radioEje: rEje, radioInterior: rInt, radioExterior: rExt, anchoCalzada };
}
