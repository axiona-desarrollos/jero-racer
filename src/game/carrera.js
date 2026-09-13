/* ==========================================================================
   HIGHWAY RACER · Partida
   --------------------------------------------------------------------------
   Lleva la distancia recorrida, el record y el estado de la tirada. Es el unico
   sitio donde se decide que la partida ha terminado.

   LA DISTANCIA SE ACUMULA, NO SE RESTA DE LA POSICION
   Tentacion obvia: distancia = z - zInicial. Falla en dos sitios reales. Marcha
   atras: el jugador retrocede y el marcador baja, asi que puede ir y venir por
   el mismo tramo y no avanzar nunca — o peor, hacer trampas si se contara el
   valor absoluto. Y el trompo: al girar 180 grados el coche avanza en −Z y
   restaria kilometros. Aqui solo suma el avance POSITIVO de cada paso.

   Ademas se lleva en un number de JS (f64) y no en la posicion del cuerpo, que
   Rapier guarda en f32: a 100 km de distancia, f32 tiene 8 mm de resolucion y
   el marcador empezaria a saltar.
   ========================================================================== */

const CLAVE_RECORD = 'hr.record.km';

/** @enum {string} */
export const ESTADO = Object.freeze({
  RODANDO: 'rodando',
  CHOCADO: 'chocado',
});

/** Segundos que se queda la pantalla de choque antes de admitir reinicio. */
const ESPERA_TRAS_CHOQUE = 1.1;

/**
 * Lee el record guardado. Nunca lanza: en ventana privada o con el
 * almacenamiento bloqueado, localStorage tira excepcion al tocarlo y eso no
 * puede tumbar el arranque del juego.
 */
export function leerRecord() {
  try {
    const v = parseFloat(localStorage.getItem(CLAVE_RECORD) ?? '0');
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

function guardarRecord(km) {
  try {
    localStorage.setItem(CLAVE_RECORD, String(km));
    return true;
  } catch {
    return false;
  }
}

export class Carrera {
  constructor() {
    this.record = leerRecord();
    this.reiniciar(0);
  }

  /**
   * Marca contra la que se celebra. Se congela al empezar la tirada porque
   * `record` sube en vivo: sin esto, en cuanto el jugador avanza un metro ya
   * supera su propio record de hace un instante y el cartel de RECORD NUEVO
   * sale permanentemente encendido desde el primer metro de la primera partida.
   */
  get marcaABatir() { return this._marca; }

  /** @param {number} z posicion actual del coche en la via */
  reiniciar(z) {
    this.estado = ESTADO.RODANDO;
    this._marca = this.record;
    this.metros = 0;
    this.zAnterior = z;
    this.tiempo = 0;
    this.esperaChoque = 0;
    this.recordBatido = false;
    this.metrosAlChocar = 0;
    this.choqueCon = null;
    this.velocidadAlChocar = 0;
  }

  get km() { return this.metros / 1000; }
  get recordKm() { return this.record / 1000; }
  get puedeReiniciar() { return this.estado === ESTADO.RODANDO || this.esperaChoque <= 0; }

  /**
   * @param {number} dt segundos
   * @param {number} z posicion del coche en la via
   * @param {object|null} choque vehiculo golpeado, o null
   * @param {number} velocidadKmh
   * @returns {boolean} true si la partida acaba de terminar en este paso
   */
  actualizar(dt, z, choque, velocidadKmh) {
    if (this.estado === ESTADO.CHOCADO) {
      this.esperaChoque = Math.max(0, this.esperaChoque - dt);
      this.zAnterior = z;
      return false;
    }

    this.tiempo += dt;
    const avance = z - this.zAnterior;
    this.zAnterior = z;
    if (avance > 0) this.metros += avance;

    if (this.metros > this.record) {
      // El record se guarda en cuanto se supera, no al chocar: si el jugador
      // cierra la pestana a mitad de una tirada buena, la marca ya esta salvada.
      this.record = this.metros;
      guardarRecord(this.record);
      // Pero solo se CELEBRA si habia algo que batir. En la primera partida no
      // hay gesta ninguna en recorrer el primer metro.
      if (this._marca > 0 && this.metros > this._marca) this.recordBatido = true;
    }

    if (choque) {
      this.estado = ESTADO.CHOCADO;
      this.esperaChoque = ESPERA_TRAS_CHOQUE;
      this.metrosAlChocar = this.metros;
      this.choqueCon = choque.esCamion ? 'camión' : 'vehículo';
      this.velocidadAlChocar = velocidadKmh;
      return true;
    }
    return false;
  }
}
