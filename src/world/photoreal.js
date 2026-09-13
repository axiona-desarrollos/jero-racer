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
   fotorrealista se dibuja alrededor. El jugador ve Medellin de verdad y
   conduce sobre una superficie limpia y predecible.

   ALTURA DEL SUELO
   No se adivina: cuando las teselas cargan se lanza un rayo hacia abajo desde
   150 m sobre el centro de la glorieta y se toma el impacto real. Asi la
   calzada queda exactamente sobre el asfalto fotografiado.

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

export class CiudadFotorrealista {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} pista  glorieta-pilsen.json ya cargado
   * @param {string} apiKey clave de Google Maps Platform
   */
  constructor(scene, camera, renderer, pista, apiKey) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.pista = pista;
    this.listo = false;
    this.alturaSuelo = null;
    this.atribucion = '';

    const { lat, lon } = pista.center;

    const tiles = this.tiles = new TilesRenderer(GOOGLE_ROOT);
    tiles.registerPlugin(new GoogleCloudAuthPlugin({
      apiToken: apiKey,
      autoRefreshToken: true,
      useRecommendedSettings: true,
    }));
    // Ancla el globo entero para que este punto quede en el origen con Y arriba.
    // OJO: lat y lon van en RADIANES, no en grados.
    tiles.registerPlugin(new ReorientationPlugin({
      lat: THREE.MathUtils.degToRad(lat),
      lon: THREE.MathUtils.degToRad(lon),
      height: 0,
      up: '+y',
      recenter: true,
    }));
    // Fundido entre niveles de detalle: sin esto se ve el "pop" de las teselas.
    tiles.registerPlugin(new TilesFadePlugin({ fadeDuration: 320 }));
    // Comprime los atributos en GPU: baja mucho la memoria de video.
    tiles.registerPlugin(new TileCompressionPlugin());

    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);
    tiles.group.name = 'medellin';
    scene.add(tiles.group);

    this._esperandoSuelo = true;
    this._rayo = new THREE.Raycaster();
    this._abajo = new THREE.Vector3(0, -1, 0);
    this._desde = new THREE.Vector3(0, 150, 0);
  }

  /**
   * Busca la altura real del asfalto lanzando un rayo hacia abajo.
   * @returns {number|null} altura en metros, o null si aun no hay teselas
   */
  #sondearSuelo() {
    this._rayo.set(this._desde, this._abajo);
    this._rayo.firstHitOnly = true;
    const hits = this._rayo.intersectObject(this.tiles.group, true);
    return hits.length ? hits[0].point.y : null;
  }

  /** Llamar cada frame ANTES de renderizar. */
  update() {
    this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
    this.camera.updateMatrixWorld();
    this.tiles.update();

    if (this._esperandoSuelo) {
      const y = this.#sondearSuelo();
      if (y !== null) {
        this.alturaSuelo = y;
        this._esperandoSuelo = false;
        this.listo = true;
        if (this.onSuelo) this.onSuelo(y);
      }
    }

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

  dispose() {
    this.scene.remove(this.tiles.group);
    this.tiles.dispose();
  }
}

/**
 * Construye la calzada conducible a partir del trazado real de OSM.
 * Devuelve { grupo, colliders, radioInterior, radioExterior }.
 *
 * La glorieta de OSM es una polilinea cerrada de 21 nodos. Se saca su radio
 * medio real y se levanta un anillo de calzada del ancho que corresponde a
 * sus 3 carriles, mas el bordillo de la isleta.
 */
export function construirCalzadaOSM(scene, RAPIER, world, pista, alturaSuelo = 0) {
  const g = new THREE.Group();
  g.name = 'calzada-osm';
  g.position.y = alturaSuelo;
  scene.add(g);

  const origen = pista.center;
  const pts = pista.geometry.map(p => latLonAMetros(p.lat, p.lon, origen));
  const radios = pts.map(p => Math.hypot(p.x, p.z));
  const rEje = radios.reduce((a, b) => a + b, 0) / radios.length;

  // 3 carriles de 3,5 m: el eje del trazado OSM pasa por el centro de la
  // calzada, asi que el anillo va media anchura a cada lado.
  const anchoCalzada = (pista.lanes ?? 3) * 3.5;
  const rInt = Math.max(2, rEje - anchoCalzada / 2);
  const rExt = rEje + anchoCalzada / 2;

  // --- superficie conducible: invisible, solo colision ---------------------
  // Un cilindro fino cubre la glorieta entera incluidos los ramales cercanos.
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(0.25, rExt + 34)
      .setTranslation(0, alturaSuelo - 0.25, 0)
      .setFriction(1.0));

  // --- isleta central: si colisiona ---------------------------------------
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(0.07, rInt)
      .setTranslation(0, alturaSuelo + 0.07, 0)
      .setFriction(0.9));

  // Bordillo visible, discreto: la fotogrametria ya trae el suyo, este solo
  // marca donde esta el limite real de colision.
  const bordillo = new THREE.Mesh(
    new THREE.CylinderGeometry(rInt, rInt, 0.14, 72),
    new THREE.MeshStandardMaterial({ color: 0xd8d5cc, roughness: 0.85, transparent: true, opacity: 0.35 }));
  bordillo.position.y = 0.07;
  g.add(bordillo);

  return { grupo: g, radioEje: rEje, radioInterior: rInt, radioExterior: rExt, anchoCalzada };
}
