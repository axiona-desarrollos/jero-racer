/* ==========================================================================
   JERO RACER · Frases del parche
   --------------------------------------------------------------------------
   Los avisos de pantalla hablan como se habla en Medellin. Cada lista se
   recorre al azar sin repetir la ultima, para que dos rozones seguidos no
   digan lo mismo.
   ========================================================================== */

export const FRASES = Object.freeze({
  rozon: ['¡ROZÓN!', '¡UY, POR UN PELO!', '¡CASI, MIJO!', '¡QUÉ SUSTO, PARCE!', '¡NI LO VIO VENIR!',
    '¡QUÉ NIVEL!', '¡FINO, PAPÁ!', '¡ESO ES TODO!', '¡QUÉ PULSO!'],
  combo3: ['¡SE PRENDIÓ ESTE PARCHE!', '¡ESTÁ ENCENDIDO!', '¡QUÉ CHIMBA DE MANEJO!'],
  combo5: ['¡ESTO ES UNA CHIMBA!', '¡NIVEL DIOS, PARCE!', '¡ÉPICO, MIJO!'],
  velocidad: { 150: '¡A TODA MÁQUINA!', 200: '¡A MIL, PARCERO!', 240: '¡ESTO VUELA, MIJO!' },
  persecucion: ['¡LLEGÓ LA TOMBA!', '¡SE PRENDIÓ EL BOLOLÓ!', '¡ÁBRASE QUE LLEGÓ LA LEY!',
    '¡NO DÉ PAPAYA!', '¡CORRA QUE LO COGEN!'],
  megafono: ['¡ORÍLLESE A LA DERECHA!', '¡DETENGA EL VEHÍCULO!', '¡POLICÍA NACIONAL, DETÉNGASE!',
    '¡APAGUE ESE CARRO, MIJO!', '¡BÁJESE CON LAS MANOS ARRIBA!'],
  ejercito: ['¡LLEGÓ EL EJÉRCITO!', '¡SE METIÓ EL EJÉRCITO!'],
  helicoptero: ['¡LLEGÓ EL PÁJARO!', '¡LO ESTÁN VIENDO DESDE ARRIBA!'],
  golpe: ['¡TOTAZO!', '¡QUÉ ESTALLIDO!', '¡LO BOLEARON!', '¡AY, MI CARRITO!', '¡SE LO TOTEARON!', '¡PUM, QUÉ GOLPE!'],
  tiroteo: ['¡PLOMO, PARCE!', '¡AGÁCHESE, MIJO!', '¡NOS ESTÁN DANDO BALA!'],
  escape: ['¡SE LES VOLÓ!', '¡NI LO HUELEN!', '¡QUÉ VERRAQUERA!', '¡ADIÓS, TOMBOS!', '¡LOS DEJÓ CON EL CRESPO HECHO!'],
  record: ['¡USTED ES UNA CHIMBA!', '¡NUEVO RÉCORD, PARCE!'],
  choque: ['¡Qué boleta, parce!', '¡Ay, Nojoda!', '¡Uy, qué estrellón!', '¡Se lo totió, mijo!',
    '¡Le faltó calle!', '¡Eso le pasa por dar papaya!'],
  detenido: ['«¿Usted no sabe quién soy yo?»', '¡Pa\' la UPJ, mijo!', '¡Se le acabó la fiesta!', '¡Lo cogió la tomba!'],
});

const ultima = new Map();

/** Una frase al azar de la lista, sin repetir la anterior. */
export function una(lista) {
  if (lista.length === 1) return lista[0];
  let i;
  do { i = Math.floor(Math.random() * lista.length); } while (i === ultima.get(lista));
  ultima.set(lista, i);
  return lista[i];
}
