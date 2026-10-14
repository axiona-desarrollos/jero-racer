/* ==========================================================================
   JERO RACER · Fichas de los carros del jugador
   --------------------------------------------------------------------------
   Datos puros, sin three ni nada del navegador: este archivo lo leen LAS DOS
   PUNTAS — el juego para montar el coche, y scripts/preparar-carro.mjs en
   Node para normalizar el modelo descargado.

   DE DONDE SALEN LOS MODELOS
   De Sketchfab, con licencia Creative Commons Attribution (CC BY 4.0), que
   permite publicarlos citando al autor. El credito va en el menu y en el
   README; quitarlo incumple la licencia.

   LAS MARCAS SON DE SUS DUEÑOS. Ford, Lamborghini y BMW no patrocinan ni
   avalan este juego: son modelos hechos por aficionados y publicados por
   ellos con licencia libre.

   CAMPOS QUE HAY QUE AFINAR A MANO POR CADA MODELO
     giro     cuartos de vuelta para dejarlo mirando a +Z (el juego mira a +Z)
     largo    a cuanto se escala; manda sobre el tamaño del modelo original
     escapes  donde salen las llamaradas del petardeo, en metros del carro
              ya normalizado (origen en el suelo, centro de la planta). Se
              miden sobre las mallas del tubo de escape de cada modelo.
   El resto (radio de rueda, via, altura) lo mide vehicle/normalizar.js.
   ========================================================================== */

/**
 * @typedef {object} FichaCarro
 * @property {string} id         nombre del archivo en public/models
 * @property {string} nombre     como sale en el menu
 * @property {string} lema
 * @property {string} autor      obligatorio por la licencia CC BY
 * @property {string} perfil     pagina del autor
 * @property {string} fuente     pagina del modelo
 * @property {string} licencia
 * @property {string} uid        identificador en Sketchfab
 * @property {number} largo      metros, a lo que se escala
 * @property {number} giro       cuartos de vuelta en Y para mirar a +Z
 * @property {number} masa       kg
 * @property {number} grados     angulo maximo de direccion
 * @property {number} velocidadMax km/h en el corte de 6a (ver cajaSeis)
 * @property {number} parMax     Nm del motor de verdad
 * @property {{delante:number, detras:number}} agarre  friccion de cada eje
 * @property {{x:number[], y:number, z:number}} escapes salidas del escape
 */

// MOTOR Y CAJA. parMax es el par del motor real (GT500 5.2 con compresor
// 847 Nm, M4 CSL 650 Nm; al Centenario, 690 Nm a 8600 rpm, se le da mas par
// porque aqui todos cortan a 7500 y si no perderia su potencia de arriba).
// velocidadMax es la del corte en 6a: con el rozamiento del juego cada uno se
// queda un poco por debajo (medido en simulacion: 259, 267 y 240 km/h) y asi
// la 6a se usa entera. Ver powertrain.cajaSeis.
export const CARROS = [
  {
    id: 'mustang',
    nombre: 'MUSTANG GT500',
    lema: 'V8 5.2 · muscle car americano',
    autor: 'Jiaxing', perfil: 'https://sketchfab.com/saitoyang',
    fuente: 'https://sketchfab.com/3d-models/ford-mustang-shelby-gt500-0eaa7a16796540f29461ddae05ecdeb3',
    uid: '0eaa7a16796540f29461ddae05ecdeb3',
    licencia: 'CC BY 4.0',
    largo: 4.79, giro: 0, masa: 1830, grados: 36, velocidadMax: 280, parMax: 847,
    // Reparto de agarre: el muscle car es de trasera suelta.
    agarre: { delante: 1.95, detras: 1.52 },
    // Dos colas dobles, una en cada esquina del difusor.
    escapes: { x: [-0.68, -0.57, 0.57, 0.68], y: 0.31, z: -2.29 },
  },
  {
    id: 'centenario',
    nombre: 'CENTENARIO',
    lema: 'V12 6.5 · fibra de carbono',
    autor: 'SDC PERFORMANCE', perfil: 'https://sketchfab.com/3DRaptor',
    fuente: 'https://sketchfab.com/3d-models/lamborghini-centenario-lp-770-interior-sdc-d679af35b5694301a185c7454a700c73',
    uid: 'd679af35b5694301a185c7454a700c73',
    licencia: 'CC BY 4.0',
    largo: 4.92, giro: 0, masa: 1570, grados: 34, velocidadMax: 300, parMax: 780,
    // Motor central y tracción total: agarra mucho más y subvira poco.
    agarre: { delante: 2.15, detras: 2.05 },
    // Tres salidas en fila en el centro, como el de verdad.
    escapes: { x: [-0.16, 0, 0.16], y: 0.34, z: -2.37 },
  },
  {
    id: 'm4csl',
    nombre: 'M4 CSL',
    lema: '6 en línea biturbo · cupé alemán',
    autor: 'Black Snow', perfil: 'https://sketchfab.com/BlackSnow02',
    fuente: 'https://sketchfab.com/3d-models/bmw-m4-csl-2023-26d05968e63b4fc28205cbb9abb0ea41',
    uid: '26d05968e63b4fc28205cbb9abb0ea41',
    licencia: 'CC BY 4.0',
    largo: 4.80, giro: 0, masa: 1625, grados: 37, velocidadMax: 265, parMax: 650,
    agarre: { delante: 2.05, detras: 1.78 },
    // Cuatro salidas juntas en el centro del difusor, dos a cada lado.
    escapes: { x: [-0.33, -0.15, 0.15, 0.33], y: 0.34, z: -2.37 },
  },
];

export const POR_DEFECTO = 'mustang';

export function ficha(id) {
  return CARROS.find(c => c.id === id) ?? CARROS[0];
}

/** Línea de créditos que exige la licencia CC BY. */
export function credito(c) {
  return `${c.nombre}: modelo de ${c.autor} (${c.licencia})`;
}
