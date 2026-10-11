/* ==========================================================================
   JERO RACER · Partida
   --------------------------------------------------------------------------
   Lleva la distancia, los puntos, los rozones y los records. Es el unico
   sitio donde se decide que la partida ha terminado.

   POR QUE PUNTOS Y NO SOLO KILOMETROS
   Contar solo distancia premia ir despacio y con cuidado: el que va a 80
   km/h llega igual de lejos que el que va a 220, solo que mas tarde. Un
   juego de trafico vive del riesgo, asi que los puntos se multiplican con la
   velocidad y cada ROZON — pasar a menos de un metro de otro vehiculo — da
   un bono que crece si se encadenan. Ir rapido y fino es lo que da marca.

   LA DISTANCIA SE ACUMULA, NO SE RESTA DE LA POSICION
   distancia = z - zInicial falla con la marcha atras (se podria ir y venir
   por el mismo tramo) y con los trompos. Solo suma el avance POSITIVO de cada
   paso, y en un number de JS (f64): Rapier guarda posiciones en f32 y a
   100 km el marcador empezaria a saltar.
   ========================================================================== */

const CLAVE_RECORD = 'hr.record.km';
const CLAVE_PUNTOS = 'jr.record.puntos';

/** @enum {string} */
export const ESTADO = Object.freeze({
  RODANDO: 'rodando',
  CHOCADO: 'chocado',
});

/** Segundos que se queda la pantalla de choque antes de admitir reinicio. */
const ESPERA_TRAS_CHOQUE = 1.1;
/** Segundos para encadenar el siguiente rozon. */
export const VENTANA_COMBO = 4.0;
export const COMBO_MAX = 5;

/**
 * Lee un record guardado. Nunca lanza: en ventana privada o con el
 * almacenamiento bloqueado, localStorage tira excepcion al tocarlo y eso no
 * puede tumbar el arranque del juego.
 */
function leer(clave) {
  try {
    const v = parseFloat(localStorage.getItem(clave) ?? '0');
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

function guardar(clave, valor) {
  try { localStorage.setItem(clave, String(valor)); return true; } catch { return false; }
}

export const leerRecord = () => leer(CLAVE_RECORD);

/** Multiplicador de puntos por velocidad: nada regala ir de paseo. */
export function multiplicadorVelocidad(kmh) {
  if (kmh < 60) return 0.4;
  return 1 + (kmh - 60) / 70;
}

export class Carrera {
  constructor() {
    this.record = leer(CLAVE_RECORD);           // metros
    this.recordPuntos = leer(CLAVE_PUNTOS);
    this.reiniciar(0);
  }

  /**
   * Marcas contra las que se celebra. Se congelan al empezar la tirada porque
   * los records suben en vivo: sin esto el cartel de RECORD NUEVO saldria
   * encendido desde el primer metro de la primera partida.
   */
  get marcaABatir() { return this._marca; }

  /** @param {number} z posicion actual del coche en la via */
  reiniciar(z) {
    this.estado = ESTADO.RODANDO;
    this._marca = this.record;
    this._marcaPuntos = this.recordPuntos;
    this.metros = 0;
    this.puntos = 0;
    this.zAnterior = z;
    this.tiempo = 0;
    this.esperaChoque = 0;
    this.recordBatido = false;
    this.metrosAlChocar = 0;
    this.choqueCon = null;
    this.velocidadAlChocar = 0;
    this.velocidadMax = 0;
    this.rozones = 0;
    this.combo = 0;
    this.tCombo = 0;
    this.mejorCombo = 0;
    /** Ultimo bono, para que la interfaz lo anuncie. */
    this.ultimoBono = null;
  }

  get km() { return this.metros / 1000; }
  get recordKm() { return this.record / 1000; }
  get puedeReiniciar() { return this.estado === ESTADO.RODANDO || this.esperaChoque <= 0; }
  get multiplicador() { return this.combo > 0 ? this.combo : 1; }

  /**
   * Suma un rozon. Devuelve el bono para anunciarlo.
   * @param {{pesado:boolean, hueco:number}} ev
   */
  rozon(ev) {
    if (this.estado !== ESTADO.RODANDO) return null;
    this.combo = this.tCombo > 0 ? Math.min(COMBO_MAX, this.combo + 1) : 1;
    this.tCombo = VENTANA_COMBO;
    this.mejorCombo = Math.max(this.mejorCombo, this.combo);
    this.rozones++;
    // Mas cerca, mas puntos; a un pesado, un poco mas.
    const finura = 1 + Math.max(0, 0.95 - ev.hueco) * 0.8;
    const base = (ev.pesado ? 200 : 150) * finura;
    const bono = Math.round(base * this.combo / 10) * 10;
    this.puntos += bono;
    this.ultimoBono = { bono, combo: this.combo, pesado: ev.pesado, t: this.tiempo };
    return this.ultimoBono;
  }

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
    if (avance > 0) {
      this.metros += avance;
      this.puntos += avance * multiplicadorVelocidad(velocidadKmh);
    }
    this.velocidadMax = Math.max(this.velocidadMax, velocidadKmh);

    if (this.tCombo > 0) {
      this.tCombo -= dt;
      if (this.tCombo <= 0) { this.tCombo = 0; this.combo = 0; }
    }

    // Los records se guardan en cuanto se superan, no al chocar: si el
    // jugador cierra la pestana a mitad de una tirada buena, ya esta salvada.
    if (this.metros > this.record) {
      this.record = this.metros;
      guardar(CLAVE_RECORD, Math.round(this.record));
    }
    if (this.puntos > this.recordPuntos) {
      this.recordPuntos = this.puntos;
      guardar(CLAVE_PUNTOS, Math.round(this.recordPuntos));
      // Solo se CELEBRA si habia algo que batir.
      if (this._marcaPuntos > 0 && this.puntos > this._marcaPuntos) this.recordBatido = true;
    }

    if (choque) {
      this.estado = ESTADO.CHOCADO;
      this.esperaChoque = ESPERA_TRAS_CHOQUE;
      this.metrosAlChocar = this.metros;
      this.choqueCon = choque.tipo?.nombre ?? (choque.esCamion ? 'camión' : 'vehículo');
      this.velocidadAlChocar = velocidadKmh;
      this.combo = 0;
      this.tCombo = 0;
      return true;
    }
    return false;
  }
}
