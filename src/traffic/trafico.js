/* ==========================================================================
   HIGHWAY RACER · Trafico
   --------------------------------------------------------------------------
   Vehiculos que circulan en el mismo sentido y mas despacio que el jugador.
   Son el unico obstaculo del juego: la partida acaba al tocar uno.

   POOL FIJO, NUNCA `new` EN CALIENTE
   Se crean N vehiculos al arrancar y se reciclan. Crear y destruir cuerpos de
   Rapier a 200 km/h genera basura constante y provoca tirones justo cuando mas
   se nota. Un vehiculo que se queda atras no se destruye: se teletransporta
   delante con carril y velocidad nuevos.

   DOS SISTEMAS DE COLISION, A PROPOSITO
   La FISICA de Rapier existe para el TACTO: el coche rebota, se descoloca y
   trompea contra el que ha golpeado. La DETECCION del choque, en cambio, es una
   prueba SAT propia en el plano XZ. Separarlas no es duplicar: la fisica de un
   vehiculo de raycast tiene contactos de rueda, de suelo y de quitamiedos, y
   distinguir ahi "he tocado trafico" es fragil. La prueba geometrica es
   deterministica, no depende de la version del motor y se puede probar sin
   levantar un mundo fisico.
   ========================================================================== */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VIA, carrilX } from '../world/autopista.js';

const KMH = 1 / 3.6;

/** Ajustes de dificultad. */
export const TRAFICO = Object.freeze({
  cantidad: 44,
  /** Metros por delante del jugador donde aparecen. */
  distanciaAparicion: 900,
  /** Metros por detras a partir de los cuales se reciclan. */
  distanciaReciclado: 180,
  /** Hueco minimo que se respeta entre dos vehiculos del mismo carril. */
  huecoMinimo: 34,
  velocidadMin: 55 * KMH,
  velocidadMax: 115 * KMH,
  /** Probabilidad por segundo de que uno cambie de carril. */
  probCambioCarril: 0.035,
  proporcionCamiones: 0.22,
});

/**
 * Holgura que se suma a las cajas al comprobar el choque, en metros.
 * Rapier resuelve los contactos hasta dejar penetracion cero, asi que sin
 * holgura solo contaria el fotograma exacto del impacto.
 */
const MARGEN_CHOQUE = 0.25;

/**
 * Donde se guardan los vehiculos dados de baja.
 *
 * Esta lejos en X y no solo en Y, y el motivo no es estetico: la prueba de
 * choque es en PLANTA (XZ) e ignora la altura, asi que un vehiculo aparcado
 * justo debajo del origen seguia solapando con el coche y disparaba un choque
 * en el metro cero. Enterrarlo no basta; hay que sacarlo del tablero.
 */
const APARCADERO = Object.freeze({ x: 100000, y: -900, z: 0 });

const COLORES = [
  0xd94f4f, 0x4f7fd9, 0xe0e3e8, 0x2f333a, 0xd9b24f,
  0x4fd98f, 0xa04fd9, 0xd97f4f, 0x9aa3ad, 0x3a5a78,
];

/** Silueta de turismo, normalizada a 1 m de largo y centrada en el origen. */
function geometriaCoche() {
  const cuerpo = new THREE.BoxGeometry(1, 0.44, 1);
  cuerpo.translate(0, 0.22, 0);
  const techo = new THREE.BoxGeometry(0.86, 0.34, 0.52);
  techo.translate(0, 0.61, -0.04);
  return mergeGeometries([cuerpo, techo]);
}

/** Silueta de camion: cabina corta y caja alta. */
function geometriaCamion() {
  const caja = new THREE.BoxGeometry(1, 0.72, 0.74);
  caja.translate(0, 0.62, -0.13);
  const cabina = new THREE.BoxGeometry(0.96, 0.5, 0.26);
  cabina.translate(0, 0.42, 0.37);
  return mergeGeometries([caja, cabina]);
}

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

export class Trafico {
  constructor(scene, RAPIER, world, ajustes = {}) {
    this.cfg = { ...TRAFICO, ...ajustes };
    this.RAPIER = RAPIER;
    this.world = world;
    this.semilla = 1;

    const nCamiones = Math.round(this.cfg.cantidad * this.cfg.proporcionCamiones);
    const nCoches = this.cfg.cantidad - nCamiones;

    const matCoche = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.25 });
    const matCamion = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.15 });
    this.mallaCoches = new THREE.InstancedMesh(geometriaCoche(), matCoche, Math.max(1, nCoches));
    this.mallaCamiones = new THREE.InstancedMesh(geometriaCamion(), matCamion, Math.max(1, nCamiones));
    for (const m of [this.mallaCoches, this.mallaCamiones]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.receiveShadow = true;
      // Van repartidos por kilometros de via: el culling por caja envolvente
      // los haria desaparecer a todos a la vez al girar la camara.
      m.frustumCulled = false;
      scene.add(m);
    }

    this.vehiculos = [];
    this._m4 = new THREE.Matrix4();
    this._v3 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._esc = new THREE.Vector3();
    this._color = new THREE.Color();

    for (let i = 0; i < this.cfg.cantidad; i++) {
      const esCamion = i < nCamiones;
      const largo = esCamion ? 9.5 + this.#azar() * 3.5 : 4.2 + this.#azar() * 0.9;
      const ancho = esCamion ? 2.5 : 1.8 + this.#azar() * 0.15;
      const alto = esCamion ? 3.6 : 1.45;

      const cuerpo = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(APARCADERO.x, APARCADERO.y, APARCADERO.z));
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(ancho / 2, alto / 2, largo / 2)
          .setTranslation(0, alto / 2, 0),
        cuerpo);

      this.vehiculos.push({
        cuerpo, largo, ancho, alto, esCamion,
        indice: esCamion ? i : i - nCamiones,
        carril: 0, x: 0, z: 0, velocidad: 0,
        xObjetivo: 0, vivo: false,
        color: COLORES[Math.floor(this.#azar() * COLORES.length)],
      });
    }

    this._pintarColores();
  }

  /**
   * Generador congruencial propio.
   * Math.random no permite repetir una partida; con semilla si se puede
   * reproducir exactamente un choque para depurarlo.
   */
  #azar() {
    this.semilla = (this.semilla * 1664525 + 1013904223) % 4294967296;
    return this.semilla / 4294967296;
  }

  _pintarColores() {
    for (const v of this.vehiculos) {
      const malla = v.esCamion ? this.mallaCamiones : this.mallaCoches;
      this._color.setHex(v.esCamion ? 0xe8eaed : v.color);
      malla.setColorAt(v.indice, this._color);
    }
    if (this.mallaCoches.instanceColor) this.mallaCoches.instanceColor.needsUpdate = true;
    if (this.mallaCamiones.instanceColor) this.mallaCamiones.instanceColor.needsUpdate = true;
  }

  /** Coloca todos los vehiculos por delante del jugador. */
  reiniciar(zJugador) {
    for (const v of this.vehiculos) v.vivo = false;
    for (const v of this.vehiculos) {
      this.#reubicar(v, zJugador, zJugador + 120 + this.#azar() * this.cfg.distanciaAparicion);
    }
    // INMEDIATO, no diferido: setNextKinematicTranslation aplica en el paso
    // siguiente, y ese fotograma de margen dejaba a los 44 vehiculos todavia en
    // el aparcadero mientras el juego ya los daba por colocados.
    this.#volcarMatrices(true);
  }

  /** Busca un hueco libre en algun carril y planta ahi el vehiculo. */
  #reubicar(v, zJugador, zDeseada) {
    for (let intento = 0; intento < 12; intento++) {
      const carril = Math.floor(this.#azar() * VIA.carriles);
      const z = zDeseada + (this.#azar() - 0.5) * 120;
      let libre = true;
      for (const o of this.vehiculos) {
        if (o === v || !o.vivo || o.carril !== carril) continue;
        if (Math.abs(o.z - z) < this.cfg.huecoMinimo + (o.largo + v.largo) / 2) { libre = false; break; }
      }
      if (!libre) continue;

      // El carril de la izquierda es el rapido, como en una autopista real.
      const fraccion = 1 - carril / Math.max(1, VIA.carriles - 1);
      const base = this.cfg.velocidadMin
        + (this.cfg.velocidadMax - this.cfg.velocidadMin) * (0.35 + 0.65 * fraccion);
      v.carril = carril;
      v.x = carrilX(carril);
      v.xObjetivo = v.x;
      v.z = z;
      v.velocidad = v.esCamion ? base * 0.8 : base * (0.92 + this.#azar() * 0.16);
      v.vivo = true;
      return true;
    }
    v.vivo = false;
    return false;
  }

  /**
   * @param {number} dt segundos
   * @param {number} zJugador
   */
  actualizar(dt, zJugador) {
    const cfg = this.cfg;
    for (const v of this.vehiculos) {
      if (!v.vivo) {
        this.#reubicar(v, zJugador, zJugador + cfg.distanciaAparicion);
        continue;
      }
      v.z += v.velocidad * dt;

      // Cambios de carril ocasionales: sin esto el trafico es un decorado y el
      // jugador memoriza los huecos.
      if (this.#azar() < cfg.probCambioCarril * dt * 60) {
        const dir = this.#azar() < 0.5 ? -1 : 1;
        const destino = v.carril + dir;
        if (destino >= 0 && destino < VIA.carriles && !v.esCamion && this.#carrilLibre(v, destino)) {
          v.carril = destino;
          v.xObjetivo = carrilX(destino);
        }
      }
      // El desplazamiento lateral es gradual: un salto instantaneo de carril es
      // imposible de esquivar y se siente injusto.
      v.x += (v.xObjetivo - v.x) * Math.min(1, dt * 1.8);

      const relativo = v.z - zJugador;
      if (relativo < -cfg.distanciaReciclado || relativo > cfg.distanciaAparicion * 2.2) {
        this.#reubicar(v, zJugador, zJugador + cfg.distanciaAparicion);
      }
    }
    this.#volcarMatrices();
  }

  #carrilLibre(v, carril) {
    for (const o of this.vehiculos) {
      if (o === v || !o.vivo || o.carril !== carril) continue;
      if (Math.abs(o.z - v.z) < this.cfg.huecoMinimo) return false;
    }
    return true;
  }

  #volcarMatrices(inmediato = false) {
    for (const v of this.vehiculos) {
      const malla = v.esCamion ? this.mallaCamiones : this.mallaCoches;
      if (!v.vivo) {
        // AQUI VIVIA UN MURO INVISIBLE. Antes solo se ocultaba la MALLA y el
        // cuerpo fisico se quedaba donde estuviera — justo delante del jugador,
        // porque un vehiculo se da de baja al reciclarlo, que es cuando acaba de
        // pasar a su lado. Resultado: un colisionador inamovible que no se ve,
        // que aplastaba el coche contra el suelo hasta hundirle la suspension, y
        // que choqueCon() ni miraba porque descarta a los que no estan vivos.
        // El cuerpo TIENE que irse del tablero con la malla.
        v.cuerpo.setNextKinematicTranslation(APARCADERO);
        if (inmediato) v.cuerpo.setTranslation(APARCADERO, false);
        this._esc.set(0.0001, 0.0001, 0.0001);
        this._v3.set(APARCADERO.x, APARCADERO.y, APARCADERO.z);
      } else {
        this._esc.set(v.ancho, v.alto / (v.esCamion ? 1.34 : 0.95), v.largo);
        this._v3.set(v.x, 0, v.z);
        v.cuerpo.setNextKinematicTranslation({ x: v.x, y: 0, z: v.z });
        if (inmediato) v.cuerpo.setTranslation({ x: v.x, y: 0, z: v.z }, false);
      }
      this._m4.compose(this._v3, this._q, this._esc);
      malla.setMatrixAt(v.indice, this._m4);
    }
    this.mallaCoches.instanceMatrix.needsUpdate = true;
    this.mallaCamiones.instanceMatrix.needsUpdate = true;
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
      // verdad. setNextKinematicTranslation aplica en el paso siguiente, asi que
      // las dos difieren ~0,35 m a velocidad de autopista — y ese desfase bastaba
      // para que el SAT no solapara NUNCA: medido, el hueco minimo de toda una
      // tirada era 0,34 m mientras Rapier reportaba contacto real.
      const fp = v.cuerpo.translation();
      // Descarte barato antes del SAT: a 200 km/h la mayoria esta lejisimos.
      if (Math.abs(fp.z - jugador.z) > 25 || Math.abs(fp.x - jugador.x) > 8) continue;
      // El margen convierte "rozar" en choque. Rapier resuelve el contacto hasta
      // dejar penetracion cero, asi que sin margen solo cuenta el fotograma
      // exacto del impacto y se escapan los roces laterales.
      if (solapanXZ(jugador, {
        x: fp.x, z: fp.z, yaw: 0,
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
