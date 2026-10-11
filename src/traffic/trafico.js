/* ==========================================================================
   JERO RACER · Trafico
   --------------------------------------------------------------------------
   Vehiculos que circulan en el mismo sentido y mas despacio que el jugador.
   Son el unico obstaculo del juego: la partida acaba al tocar uno.

   POOL FIJO, NUNCA \`new\` EN CALIENTE
   Se crean N vehiculos al arrancar y se reciclan. Crear y destruir cuerpos de
   Rapier a 200 km/h genera basura constante y provoca tirones justo cuando mas
   se nota. Un vehiculo que se queda atras no se destruye: se teletransporta
   delante con carril, color y velocidad nuevos.

   CONDUCTORES, NO DECORADO
   Antes cada vehiculo iba a velocidad constante y uno rapido atravesaba al
   lento del mismo carril. Ahora cada conductor sigue al de delante con el
   Modelo del Conductor Inteligente (IDM, Treiber 2000): frena con luz de
   freno cuando se le acerca a alguien, y si va retenido busca un hueco en el
   carril de al lado, pone la direccional y cambia. La direccional NO es
   adorno: es el aviso que permite al jugador anticipar el cambio y que el
   juego sea justo. Tambien ven al jugador: nadie lo embiste por detras ni se
   le mete encima de golpe.

   DOS SISTEMAS DE COLISION, A PROPOSITO
   La FISICA de Rapier existe para el TACTO: el coche rebota y trompea contra
   el que ha golpeado. La DETECCION del choque es una prueba SAT propia en el
   plano XZ: deterministica y comprobable sin levantar un mundo fisico.

   SIMULAR Y PINTAR SON DOS PASOS
   actualizar() avanza a paso fijo (60 Hz); presentar() coloca las mallas
   interpolando entre los dos ultimos pasos. Sin esto, en una pantalla de
   144 Hz el trafico avanzaba a saltos mientras el coche del jugador iba suave.
   ========================================================================== */

import * as THREE from 'three';
import { VIA, carrilX } from '../world/autopista.js';
import { TIPOS, fabricar } from './flota.js';
import { materialFlota, geometriaRueda, prepararInstancias } from './modelado.js';

const KMH = 1 / 3.6;

/** Ajustes de dificultad. */
export const TRAFICO = Object.freeze({
  cantidad: 72,
  /** Vehiculos activos al empezar; suben con la distancia hasta `cantidad`. */
  activosIniciales: 40,
  activosPorKm: 5,
  /** Metros por delante del jugador donde aparecen. Mas lejos el trafico se
   *  acumula donde no se ve: a 200 km/h el jugador lo adelanta todo y la
   *  densidad util es la de los primeros 400 m. */
  distanciaAparicion: 460,
  /** Metros por detras a partir de los cuales se reciclan. */
  distanciaReciclado: 120,
  /** Hueco minimo al colocar un vehiculo junto a otro del mismo carril. */
  huecoMinimo: 34,
  /** Probabilidad por segundo de un cambio de carril sin motivo. */
  probCambioLibre: 0.012,
});

/** Mas alla de esta distancia se pinta la version ligera del vehiculo. */
const DISTANCIA_LOD = 190;
const DETALLE_LEJOS = 0.4;

/** Parametros del IDM. */
const IDM = Object.freeze({
  aLigero: 1.5, aPesado: 0.7,   // aceleracion maxima, m/s2
  b: 2.6,                        // deceleracion comoda, m/s2
  s0: 5.5,                       // hueco minimo parado, m
  T: 1.25,                       // tiempo de seguridad, s
});

const DURACION_SENAL = 1.35;     // segundos de direccional antes de moverse
const DURACION_CAMBIO = 2.9;     // segundos que tarda en cruzar al otro carril

/**
 * Holgura que se suma a las cajas al comprobar el choque, en metros.
 * Rapier resuelve los contactos hasta dejar penetracion cero, asi que sin
 * holgura solo contaria el fotograma exacto del impacto.
 */
const MARGEN_CHOQUE = 0.25;

/** Hueco lateral por debajo del cual pasar junto a un vehiculo cuenta como rozon. */
export const HUECO_ROZON = 0.95;

/**
 * Donde se guardan los vehiculos dados de baja: lejos en X y no solo en Y,
 * porque la prueba de choque es en PLANTA e ignora la altura. Un vehiculo
 * enterrado bajo el origen seguia "solapando" con el coche en el metro cero.
 */
const APARCADERO = Object.freeze({ x: 100000, y: -900, z: 0 });

/** Prueba SAT entre dos rectangulos orientados en XZ. */
export function solapanXZ(a, b) {
  const ejes = [
    { x: Math.cos(a.yaw), z: -Math.sin(a.yaw) },
    { x: Math.sin(a.yaw), z: Math.cos(a.yaw) },
    { x: Math.cos(b.yaw), z: -Math.sin(b.yaw) },
    { x: Math.sin(b.yaw), z: Math.cos(b.yaw) },
  ];
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const e of ejes) {
    const proy = (c) => {
      const ux = Math.cos(c.yaw), uz = -Math.sin(c.yaw);   // eje ancho
      const vx = Math.sin(c.yaw), vz = Math.cos(c.yaw);    // eje largo
      return Math.abs((ux * e.x + uz * e.z)) * c.ancho / 2
           + Math.abs((vx * e.x + vz * e.z)) * c.largo / 2;
    };
    const dist = Math.abs(dx * e.x + dz * e.z);
    if (dist > proy(a) + proy(b)) return false;   // eje separador encontrado
  }
  return true;
}

/**
 * Aceleracion del Modelo del Conductor Inteligente.
 * @param {number} v      velocidad propia, m/s
 * @param {number} v0     velocidad deseada, m/s
 * @param {number} hueco  distancia libre hasta el de delante, m (Infinity si no hay)
 * @param {number} dv     v - v_delante, m/s
 * @param {number} a      aceleracion maxima
 */
export function aceleracionIDM(v, v0, hueco, dv, a) {
  const libre = 1 - Math.pow(v / Math.max(0.1, v0), 4);
  if (!Number.isFinite(hueco)) return a * libre;
  const sEstrella = IDM.s0 + Math.max(0, v * IDM.T + (v * dv) / (2 * Math.sqrt(a * IDM.b)));
  const s = Math.max(0.5, hueco);
  return a * (libre - (sEstrella / s) * (sEstrella / s));
}

/** Textura de sombra de contacto: rectangulo de bordes muy difuminados. */
function texturaSombra() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const img = g.createImageData(s, s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = Math.abs(x / (s - 1) * 2 - 1), v = Math.abs(y / (s - 1) * 2 - 1);
      const d = Math.pow(Math.pow(u, 6) + Math.pow(v, 6), 1 / 6);
      const a = Math.max(0, Math.min(1, (1 - d) / 0.42));
      img.data[(y * s + x) * 4 + 3] = Math.round(255 * a * a);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export class Trafico {
  /**
   * @param {THREE.Scene} scene
   * @param {object} RAPIER
   * @param {object} world
   * @param {object} [ajustes] sobre TRAFICO, mas `fisico` (material con laca)
   *        y `sombras` (si los vehiculos cercanos proyectan sombra real)
   */
  constructor(scene, RAPIER, world, ajustes = {}) {
    this.cfg = { ...TRAFICO, ...ajustes };
    this.RAPIER = RAPIER;
    this.world = world;
    this.semilla = 1;
    this.tiempo = 0;
    this.distanciaLOD = ajustes.distanciaLOD ?? DISTANCIA_LOD;
    this.activos = this.cfg.activosIniciales;

    this.material = materialFlota({ fisico: ajustes.fisico ?? true });

    // --- reparto del pool por tipos, segun su frecuencia en la via ---------
    const pesoTotal = TIPOS.reduce((a, t) => a + t.peso, 0);
    const cupos = TIPOS.map(t => Math.max(1, Math.round(this.cfg.cantidad * t.peso / pesoTotal)));
    // El orden de alta se baraja: si los primeros N fueran todos sedanes, con
    // pocos activos al principio solo saldrian sedanes.
    const altas = [];
    TIPOS.forEach((t, i) => { for (let k = 0; k < cupos[i]; k++) altas.push(i); });
    for (let i = altas.length - 1; i > 0; i--) {
      const j = Math.floor(this.#azar() * (i + 1));
      [altas[i], altas[j]] = [altas[j], altas[i]];
    }

    // Dos versiones por tipo: la de cerca, con todo, y la de lejos, ligera y
    // con las ruedas horneadas. Cada vehiculo tiene hueco en las dos y se
    // dibuja en una u otra segun su distancia al jugador.
    const sombras = ajustes.sombras ?? true;
    const nueva = (geo, n, sombra) => {
      const malla = new THREE.InstancedMesh(geo, this.material, n);
      malla.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      malla.castShadow = sombra;
      malla.receiveShadow = true;
      // Van repartidos por kilometros de via: el culling por caja envolvente
      // los haria desaparecer a todos a la vez al girar la camara.
      malla.frustumCulled = false;
      scene.add(malla);
      return { malla, attrs: prepararInstancias(malla) };
    };
    this.modelos = TIPOS.map((tipo, i) => {
      const m = fabricar(tipo, 1);
      const lejos = fabricar(tipo, DETALLE_LEJOS);
      const cerca = nueva(m.geometria, cupos[i], sombras);
      const ligero = nueva(lejos.geometria, cupos[i], false);
      return {
        tipo, ...m, malla: cerca.malla, attrs: cerca.attrs,
        mallaLejos: ligero.malla, attrsLejos: ligero.attrs, usados: 0,
      };
    });

    // --- ruedas: dos mallas instanciadas para toda la flota ----------------
    const nRuedas = { auto: 0, camion: 0 };
    for (const id of altas) for (const w of this.modelos[id].ruedas) nRuedas[w.camion ? 'camion' : 'auto']++;
    this.ruedas = {};
    for (const [clave, geo] of [['auto', geometriaRueda()], ['camion', geometriaRueda({ camion: true })]]) {
      const malla = new THREE.InstancedMesh(geo, this.material, Math.max(1, nRuedas[clave]));
      malla.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      malla.castShadow = false;
      malla.frustumCulled = false;
      const attrs = prepararInstancias(malla);
      scene.add(malla);
      this.ruedas[clave] = { malla, attrs, usadas: 0 };
    }

    // --- sombras de contacto ------------------------------------------------
    // La sombra real del sol solo cubre unos metros alrededor del jugador; sin
    // esto los vehiculos lejanos parecen flotar sobre el asfalto.
    const geoSombra = new THREE.PlaneGeometry(1, 1);
    geoSombra.rotateX(-Math.PI / 2);
    this.sombras = new THREE.InstancedMesh(geoSombra, new THREE.MeshBasicMaterial({
      color: 0x000000, alphaMap: texturaSombra(), transparent: true, opacity: 0.62,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }), altas.length);
    this.sombras.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sombras.frustumCulled = false;
    this.sombras.renderOrder = 1;
    scene.add(this.sombras);

    // --- los vehiculos ------------------------------------------------------
    this.vehiculos = [];
    altas.forEach((idModelo, n) => {
      const mod = this.modelos[idModelo];
      const cuerpo = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(APARCADERO.x, APARCADERO.y, APARCADERO.z));
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(mod.ancho / 2, mod.alto / 2, mod.largo / 2)
          .setTranslation(0, mod.alto / 2, 0),
        cuerpo);
      const ruedas = mod.ruedas.map(w => ({ ...w, malla: this.ruedas[w.camion ? 'camion' : 'auto'] }));
      this.vehiculos.push({
        id: n, modelo: mod, tipo: mod.tipo, cuerpo, ruedas,
        indice: mod.usados++,
        largo: mod.largo, ancho: mod.ancho, alto: mod.alto,
        pesado: !!mod.tipo.pesado, esCamion: !!mod.tipo.pesado,
        carril: 0, carrilOrigen: -1, x: 0, z: 0, xPrev: 0, zPrev: 0,
        xOrigen: 0, xObjetivo: 0, tCambio: 1,
        velocidad: 0, v0: 0, freno: 0, yaw: 0, yawPrev: 0,
        senal: 0, tSenal: 0, proximaDecision: 0,
        distancia: 0, distanciaPrev: 0, relPrev: 0,
        tinte1: new THREE.Color(0xcccccc), tinte2: new THREE.Color(0xeeeeee), edad: 10,
        vivo: false,
      });
    });

    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._qr = new THREE.Quaternion();
    this._qs = new THREE.Quaternion();
    this._v3 = new THREE.Vector3();
    this._esc = new THREE.Vector3();
    this._col = new THREE.Color();
    this._eje = new THREE.Vector3(1, 0, 0);
    this._arriba = new THREE.Vector3(0, 1, 0);
    this._cero = new THREE.Vector3(0.0001, 0.0001, 0.0001);
    /** Rozones del ultimo paso (los consume la partida). */
    this.eventos = [];
    this.jugador = { x: 0, z: 0, velocidad: 0, ancho: 1.95, largo: 4.45 };
  }

  /**
   * Generador congruencial propio. Math.random no permite repetir una
   * partida; con semilla se puede reproducir exactamente un choque.
   */
  #azar() {
    this.semilla = (this.semilla * 1664525 + 1013904223) % 4294967296;
    return this.semilla / 4294967296;
  }

  /** Coloca los vehiculos activos por delante del jugador. */
  reiniciar(zJugador, xJugador = 0) {
    this.activos = this.cfg.activosIniciales;
    this.jugador.x = xJugador;
    this.jugador.z = zJugador;
    this.jugador.velocidad = 0;
    for (const v of this.vehiculos) v.vivo = false;
    for (const v of this.vehiculos) {
      if (v.id >= this.activos) continue;
      const cerca = this.#azar() < 0.3;
      this.#reubicar(v, zJugador, zJugador + (cerca ? 45 + this.#azar() * 160 : 120 + this.#azar() * this.cfg.distanciaAparicion));
    }
    this.eventos.length = 0;
    // INMEDIATO, no diferido: setNextKinematicTranslation aplica en el paso
    // siguiente, y ese fotograma de margen dejaba a los vehiculos todavia en
    // el aparcadero mientras el juego ya los daba por colocados.
    for (const v of this.vehiculos) { v.edad = 10; this.#colocarCuerpo(v, true); }
    this.presentar(1);
  }

  /** Sube la densidad con la distancia recorrida en la tirada. */
  fijarDificultad(km) {
    this.activos = Math.min(this.vehiculos.length,
      Math.round(this.cfg.activosIniciales + km * this.cfg.activosPorKm));
  }

  /**
   * Elige carril: los pesados van por la derecha, como manda la norma.
   * OJO: el carril 0 es el de la DERECHA del conductor (x negativa), porque
   * con el coche mirando a +Z su izquierda es +X.
   */
  #carrilAleatorio(v) {
    const n = VIA.carriles;
    if (v.pesado) return Math.floor(this.#azar() * this.#azar() * 3);
    return Math.floor(this.#azar() * n);
  }

  /** Velocidad deseada segun carril: el de la izquierda (indice alto) es el rapido. */
  #velocidadDeseada(v, carril) {
    const fraccion = carril / Math.max(1, VIA.carriles - 1);
    if (v.pesado) return (58 + 22 * this.#azar() + 8 * fraccion) * KMH;
    return (72 + 38 * fraccion + 14 * this.#azar()) * KMH;
  }

  /** Busca un hueco libre en algun carril y planta ahi el vehiculo. */
  #reubicar(v, zJugador, zDeseada) {
    for (let intento = 0; intento < 14; intento++) {
      const carril = this.#carrilAleatorio(v);
      const z = zDeseada + (this.#azar() - 0.5) * 120;
      // Nunca encima ni justo delante del jugador.
      if (z < zJugador + 40) continue;
      let libre = true;
      let lider = null, huecoLider = Infinity;
      for (const o of this.vehiculos) {
        if (o === v || !o.vivo || !this.#ocupa(o, carril)) continue;
        const d = o.z - z;
        if (Math.abs(d) < this.cfg.huecoMinimo + (o.largo + v.largo) / 2) { libre = false; break; }
        if (d > 0 && d < huecoLider) { huecoLider = d; lider = o; }
      }
      if (!libre) continue;

      v.carril = carril;
      v.carrilOrigen = -1;
      v.x = v.xPrev = v.xOrigen = v.xObjetivo = carrilX(carril);
      v.z = v.zPrev = z;
      v.v0 = this.#velocidadDeseada(v, carril);
      // Si aparece detras de alguien mas lento, ya viene a su velocidad: un
      // frenazo nada mas aparecer se ve como un error.
      v.velocidad = lider && huecoLider < 160 ? Math.min(v.v0, lider.velocidad) : v.v0;
      v.tCambio = 1;
      v.senal = 0; v.tSenal = 0; v.freno = 0;
      v.yaw = v.yawPrev = 0;
      v.proximaDecision = this.tiempo + 0.5 + this.#azar() * 1.5;
      v.edad = 0;
      v.relPrev = z - zJugador;
      v.vivo = true;
      this.#pintar(v);
      return true;
    }
    v.vivo = false;
    return false;
  }

  /** Color nuevo en cada reaparicion: el mismo carro no vuelve igual. */
  #pintar(v) {
    const t = v.tipo;
    v.tinte1.setHex(t.paleta[Math.floor(this.#azar() * t.paleta.length)]);
    const p2 = t.paleta2 ?? [0xeeeeee];
    v.tinte2.setHex(p2[Math.floor(this.#azar() * p2.length)]);
  }

  /** ¿Ocupa `o` el carril `c`? Durante un cambio ocupa los dos. */
  #ocupa(o, c) {
    return o.carril === c || (o.carrilOrigen === c && o.tCambio < 1);
  }

  /** El jugador ocupa un carril si su caja lo invade. */
  #jugadorEn(c) {
    return Math.abs(this.jugador.x - carrilX(c)) < VIA.anchoCarril / 2 + this.jugador.ancho / 2 - 0.15;
  }

  /**
   * Lider de `v` en el carril `c`: el primero por delante.
   * @returns {{hueco:number, vel:number}}
   */
  #lider(v, c) {
    let hueco = Infinity, vel = 0;
    for (const o of this.vehiculos) {
      if (o === v || !o.vivo || !this.#ocupa(o, c)) continue;
      const d = (o.z - o.largo / 2) - (v.z + v.largo / 2);
      if (o.z > v.z && d < hueco) { hueco = d; vel = o.velocidad; }
    }
    const j = this.jugador;
    if (this.#jugadorEn(c) && j.z > v.z) {
      const d = (j.z - j.largo / 2) - (v.z + v.largo / 2);
      if (d < hueco) { hueco = d; vel = Math.max(0, j.velocidad); }
    }
    return { hueco, vel };
  }

  /** ¿Hay hueco seguro en el carril `c` para que `v` se pase? */
  #huecoSeguro(v, c) {
    if (c < 0 || c >= VIA.carriles) return false;
    for (const o of this.vehiculos) {
      if (o === v || !o.vivo || !this.#ocupa(o, c)) continue;
      const d = o.z - v.z;
      const largos = (o.largo + v.largo) / 2;
      if (d >= 0) {
        if (d - largos < Math.max(14, v.velocidad * 0.9)) return false;
      } else {
        const cierre = Math.max(0, o.velocidad - v.velocidad);
        if (-d - largos < Math.max(12, o.velocidad * 0.8 + cierre * 2.2)) return false;
      }
    }
    // Nunca se le mete encima al jugador: ni por delante cerca ni por detras.
    if (this.#jugadorEn(c)) {
      const d = this.jugador.z - v.z;
      if (d > -25 && d < 45) return false;
    }
    return true;
  }

  /**
   * Un paso de simulacion.
   * @param {number} dt segundos
   * @param {{x:number, z:number, velocidad:number}} jugador velocidad en m/s
   */
  actualizar(dt, jugador) {
    const cfg = this.cfg;
    this.tiempo += dt;
    const j = this.jugador;
    j.x = jugador.x; j.z = jugador.z; j.velocidad = jugador.velocidad;
    this.eventos.length = 0;

    for (const v of this.vehiculos) {
      if (!v.vivo) {
        if (v.id < this.activos) this.#reubicar(v, j.z, j.z + cfg.distanciaAparicion + this.#azar() * 160);
        if (!v.vivo) { this.#colocarCuerpo(v); continue; }
        v.edad = 0;
      }
      v.xPrev = v.x; v.zPrev = v.z; v.yawPrev = v.yaw; v.distanciaPrev = v.distancia;
      v.edad += dt;

      // --- seguir al de delante (IDM) --------------------------------------
      const a = v.pesado ? IDM.aPesado : IDM.aLigero;
      let lider = this.#lider(v, v.carril);
      if (v.tCambio < 1 && v.carrilOrigen >= 0) {
        const otro = this.#lider(v, v.carrilOrigen);
        if (otro.hueco < lider.hueco) lider = otro;
      }
      let acc = aceleracionIDM(v.velocidad, v.v0, lider.hueco, v.velocidad - lider.vel, a);
      acc = Math.max(-9, Math.min(a, acc));
      v.velocidad = Math.max(0, v.velocidad + acc * dt);
      const frenoObjetivo = acc < -0.6 ? Math.min(1, -acc / 3) : 0;
      v.freno += (frenoObjetivo - v.freno) * Math.min(1, dt * (frenoObjetivo > v.freno ? 14 : 4));

      v.z += v.velocidad * dt;
      v.distancia += v.velocidad * dt;

      // --- cambiar de carril -----------------------------------------------
      if (v.tSenal > 0) {
        v.tSenal -= dt;
        if (v.tSenal <= 0) {
          const destino = v.carril + v.senal;
          if (this.#huecoSeguro(v, destino)) {
            v.carrilOrigen = v.carril;
            v.carril = destino;
            v.xOrigen = v.x;
            v.xObjetivo = carrilX(destino);
            v.tCambio = 0;
          } else {
            v.senal = 0;   // se arrepiente: el hueco se cerro
          }
        }
      } else if (v.tCambio >= 1 && this.tiempo >= v.proximaDecision) {
        v.proximaDecision = this.tiempo + 0.6 + this.#azar() * 0.8;
        const retenido = lider.hueco < 70 && v.velocidad < v.v0 * 0.9;
        const libre = this.#azar() < cfg.probCambioLibre * 1.0;
        if (retenido || libre) {
          // Se adelanta por la izquierda (+1); si no se puede, por la derecha.
          // Los pesados casi nunca cambian.
          const opciones = retenido ? [1, -1] : [this.#azar() < 0.5 ? -1 : 1];
          for (const dir of opciones) {
            if (v.pesado && this.#azar() > 0.25) break;
            const destino = v.carril + dir;
            if (!this.#huecoSeguro(v, destino)) continue;
            if (retenido) {
              const alli = this.#lider(v, destino);
              if (alli.hueco < lider.hueco + 20) continue;   // no gana nada
            }
            v.senal = dir;
            v.tSenal = DURACION_SENAL;
            break;
          }
        }
      }

      if (v.tCambio < 1) {
        v.tCambio = Math.min(1, v.tCambio + dt / DURACION_CAMBIO);
        const t = v.tCambio;
        const k = 0.5 - 0.5 * Math.cos(t * Math.PI);
        v.x = v.xOrigen + (v.xObjetivo - v.xOrigen) * k;
        // El morro apunta a donde va: un cambio de carril sin giro parece un
        // vehiculo deslizando de lado sobre hielo.
        const vx = (v.xObjetivo - v.xOrigen) * 0.5 * Math.PI * Math.sin(t * Math.PI) / DURACION_CAMBIO;
        v.yaw = Math.atan2(vx, Math.max(3, v.velocidad));
        if (v.tCambio >= 1) {
          v.carrilOrigen = -1;
          v.senal = 0;
          v.yaw = 0;
          // Al llegar al carril nuevo se adapta a su ritmo.
          v.v0 = v.v0 * 0.6 + this.#velocidadDeseada(v, v.carril) * 0.4;
        }
      }

      // --- rozones: el jugador acaba de pasar a su lado ----------------------
      const rel = v.z - j.z;
      if (v.relPrev > 0 && rel <= 0 && j.velocidad > 40 * KMH) {
        const hueco = Math.abs(v.x - j.x) - (v.ancho + j.ancho) / 2;
        // Todo paso a menos de 3 m suena; solo los de menos de un metro puntuan.
        if (hueco < 3.0 && hueco > -0.15) {
          this.eventos.push({
            tipo: v.tipo, hueco, pesado: v.pesado,
            rozon: hueco < HUECO_ROZON && j.velocidad > 60 * KMH,
            lado: Math.sign(v.x - j.x) || 1,
            relativa: j.velocidad - v.velocidad,
          });
        }
      }
      v.relPrev = rel;

      if (rel < -cfg.distanciaReciclado || rel > cfg.distanciaAparicion * 2.2) {
        v.vivo = false;
        if (v.id < this.activos) this.#reubicar(v, j.z, j.z + cfg.distanciaAparicion + this.#azar() * 160);
      }
      this.#colocarCuerpo(v);
    }
  }

  #colocarCuerpo(v, inmediato = false) {
    // Un vehiculo dado de baja se lleva su cuerpo fisico al aparcadero. Antes
    // solo se ocultaba la malla y el colisionador se quedaba en la via: un
    // muro invisible justo donde el jugador acababa de pasar.
    if (!v.vivo) {
      v.cuerpo.setNextKinematicTranslation(APARCADERO);
      if (inmediato) v.cuerpo.setTranslation(APARCADERO, false);
      return;
    }
    const p = { x: v.x, y: 0, z: v.z };
    const r = { x: 0, y: Math.sin(v.yaw / 2), z: 0, w: Math.cos(v.yaw / 2) };
    v.cuerpo.setNextKinematicTranslation(p);
    v.cuerpo.setNextKinematicRotation(r);
    if (inmediato) { v.cuerpo.setTranslation(p, false); v.cuerpo.setRotation(r, false); }
  }

  /**
   * Coloca las mallas, interpolando entre los dos ultimos pasos.
   * @param {number} alpha fraccion del paso actual, 0..1
   */
  presentar(alpha) {
    // INSTANCIAS COMPACTADAS: cada fotograma se escriben seguidas solo las que
    // se ven y `count` se ajusta a ese numero. Esconder una instancia
    // escalandola a cero NO ahorra nada: la GPU procesa igual sus vertices, y
    // con 360 ruedas y dos versiones de cada carroceria eso era casi un millon
    // de triangulos tirados por fotograma.
    const parpadeo = (this.tiempo % 0.72) < 0.38 ? 1 : 0;
    for (const m of this.modelos) { m.nCerca = 0; m.nLejos = 0; }
    for (const k in this.ruedas) this.ruedas[k].n = 0;
    let nSombras = 0;

    for (const v of this.vehiculos) {
      if (!v.vivo) continue;
      const m = v.modelo;
      const x = v.xPrev + (v.x - v.xPrev) * alpha;
      const z = v.zPrev + (v.z - v.zPrev) * alpha;
      const yaw = v.yawPrev + (v.yaw - v.yawPrev) * alpha;
      const dist = v.distanciaPrev + (v.distancia - v.distanciaPrev) * alpha;
      const cerca = Math.abs(z - this.jugador.z) < this.distanciaLOD;

      // Aparicion: crece en medio segundo. A 450 m un camion son 6 pixeles,
      // pero que salgan de la nada se nota; creciendo no.
      const k = v.edad >= 0.6 ? 1 : Math.max(0.02, v.edad / 0.6);
      this._q.setFromAxisAngle(this._arriba, yaw);
      this._m4.compose(this._v3.set(x, 0, z), this._q, this._esc.set(k, k, k));
      const malla = cerca ? m.malla : m.mallaLejos;
      const a = cerca ? m.attrs : m.attrsLejos;
      const slot = cerca ? m.nCerca++ : m.nLejos++;
      malla.setMatrixAt(slot, this._m4);
      a.tinte1.setXYZ(slot, v.tinte1.r, v.tinte1.g, v.tinte1.b);
      a.tinte2.setXYZ(slot, v.tinte2.r, v.tinte2.g, v.tinte2.b);
      // Luces: freno, y la direccional del lado al que va. senal +1 = hacia
      // +X, que es la izquierda del vehiculo.
      a.estado.setXYZ(slot, v.freno, v.senal > 0 ? parpadeo : 0, v.senal < 0 ? parpadeo : 0);

      // Sombra de contacto, algo mayor que la planta.
      this._m4.compose(this._v3.set(x, 0.02, z), this._q, this._esc.set(v.ancho * 1.22 * k, 1, v.largo * 1.08 * k));
      this.sombras.setMatrixAt(nSombras++, this._m4);

      if (!cerca) continue;   // la version de lejos lleva las ruedas horneadas
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (const w of v.ruedas) {
        const giro = dist / w.r;
        const lado = w.x < 0 ? -1 : 1;
        // Rueda del lado derecho: girada 180 grados para que el rin mire
        // fuera, y por eso su giro de rodadura va con el signo cambiado.
        this._qr.setFromAxisAngle(this._eje, lado > 0 ? giro : -giro);
        this._qs.setFromAxisAngle(this._arriba, yaw + (lado < 0 ? Math.PI : 0));
        this._qs.multiply(this._qr);
        this._v3.set(x + w.x * cy + w.z * sy, w.r, z - w.x * sy + w.z * cy);
        this._m4.compose(this._v3, this._qs, this._esc.set(w.ancho, w.r, w.r));
        const r = w.malla;
        r.malla.setMatrixAt(r.n++, this._m4);
      }
    }

    for (const m of this.modelos) {
      m.malla.count = m.nCerca;
      m.mallaLejos.count = m.nLejos;
      m.malla.instanceMatrix.needsUpdate = true;
      m.mallaLejos.instanceMatrix.needsUpdate = true;
      for (const a of [m.attrs, m.attrsLejos]) {
        a.tinte1.needsUpdate = true; a.tinte2.needsUpdate = true; a.estado.needsUpdate = true;
      }
    }
    for (const k in this.ruedas) {
      const r = this.ruedas[k];
      r.malla.count = r.n;
      r.malla.instanceMatrix.needsUpdate = true;
    }
    this.sombras.count = nSombras;
    this.sombras.instanceMatrix.needsUpdate = true;
  }

  /**
   * Primer vehiculo que solapa con el jugador, o null.
   * @param {{x:number,z:number,yaw:number,largo:number,ancho:number}} jugador
   */
  choqueCon(jugador, margen = MARGEN_CHOQUE) {
    for (const v of this.vehiculos) {
      if (!v.vivo) continue;
      // SE MIDE CONTRA LA POSICION FISICA, NO LA LOGICA. `v.z` es donde el
      // vehiculo estara; `cuerpo.translation()` es donde ESTUVO durante el paso
      // que acaba de resolverse, que es contra lo que el coche ha chocado de
      // verdad. Las dos difieren ~0,35 m a velocidad de autopista, y ese
      // desfase bastaba para que el SAT no solapara NUNCA.
      const fp = v.cuerpo.translation();
      if (Math.abs(fp.z - jugador.z) > 25 || Math.abs(fp.x - jugador.x) > 8) continue;
      if (solapanXZ(jugador, {
        x: fp.x, z: fp.z, yaw: v.yawPrev,
        largo: v.largo + margen, ancho: v.ancho + margen,
      })) return v;
    }
    return null;
  }

  /** Cuantos vehiculos ha dejado atras el jugador desde `zDesde`. */
  adelantados(zJugador, zDesde) {
    let n = 0;
    for (const v of this.vehiculos) if (v.vivo && v.z < zJugador && v.z > zDesde) n++;
    return n;
  }
}
