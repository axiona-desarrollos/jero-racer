/* ==========================================================================
   JERO RACER · Normalizar un modelo descargado
   --------------------------------------------------------------------------
   Un modelo de Sketchfab viene como lo dejo su autor: a la escala que quiso,
   mirando a donde quiso, con el origen donde quiso y con las ruedas colgando
   de nodos con el nombre que quiso (o sin nodo propio). El juego necesita
   justo lo contrario, y siempre igual:

     · mira a +Z, +Y arriba, +X a su izquierda
     · origen en el suelo, en el centro de la planta
     · largo exacto en metros (el jugador calcula los huecos por el tamaño)
     · cuatro nodos WheelFrontL / WheelFrontR / WheelRearL / WheelRearR,
       cada uno con su rueda dentro y su centro en el buje

   Vehicle lee de esos cuatro nodos la posicion del buje y el radio, asi que
   esto es lo que separa "un modelo bonito" de "un carro que se conduce".

   SE HACE AL CARGAR, NO AL COMPILAR, A PROPOSITO: aqui hay Box3 y attach(),
   que resuelven en tres lineas lo que en el formato glTF son transformadas
   anidadas a mano. Cuesta unos milisegundos una vez por partida.
   ========================================================================== */

import * as THREE from 'three';

const NOMBRE_RUEDA = /wheel|rueda|tire|tyre|rim|llanta|neum|hjul|rad\b|колес|轮/i;
const NOMBRE_FRENO = /brake|caliper|disc|rotor|pinza|freno/i;
const NOMBRE_PILOTO = /tail|rear.?light|stop|brake.?light|piloto|luz.?tras|lamp.?r/i;

const _caja = new THREE.Box3();
const _v = new THREE.Vector3();

/** Caja envolvente de un objeto en el espacio de `raiz`. */
function cajaLocal(obj, raiz) {
  const b = new THREE.Box3().setFromObject(obj);
  raiz.updateMatrixWorld(true);
  return b.applyMatrix4(new THREE.Matrix4().copy(raiz.matrixWorld).invert());
}

/**
 * Deja el modelo en el sistema del juego y le separa las ruedas.
 *
 * @param {THREE.Object3D} escena  lo que devolvio GLTFLoader
 * @param {{largo:number, giro?:number}} ficha
 * @returns {{raiz:THREE.Group, medidas:object, ruedas:string[], pilotos:THREE.Material[]}}
 */
export function normalizarCarro(escena, ficha) {
  const raiz = new THREE.Group();
  raiz.name = 'Carro_' + (ficha.id ?? 'x');

  // 1. ORIENTAR. El giro va en un nodo intermedio y se hornea enseguida con
  //    updateMatrixWorld: a partir de aqui todo se mide ya mirando a +Z.
  const orientado = new THREE.Group();
  orientado.rotation.y = (ficha.giro ?? 0) * Math.PI / 2;
  orientado.add(escena);
  raiz.add(orientado);
  raiz.updateMatrixWorld(true);

  // 2. ESCALAR al largo de la ficha. El largo manda sobre el ancho: un modelo
  //    bien hecho conserva las proporciones y uno mal hecho es preferible que
  //    falle en el ancho, que no se juzga de un vistazo.
  _caja.setFromObject(raiz);
  const bruto = _caja.getSize(new THREE.Vector3());
  const escala = ficha.largo / Math.max(0.001, bruto.z);
  orientado.scale.setScalar(escala);
  raiz.updateMatrixWorld(true);

  // 3. CENTRAR: x y z al centro de la planta, y al suelo.
  _caja.setFromObject(raiz);
  const centro = _caja.getCenter(new THREE.Vector3());
  orientado.position.set(-centro.x, -_caja.min.y, -centro.z);
  raiz.updateMatrixWorld(true);

  _caja.setFromObject(raiz);
  const tam = _caja.getSize(new THREE.Vector3());

  // 4. RUEDAS.
  const ruedas = separarRuedas(raiz, tam);

  // 5. PILOTOS: materiales que se pueden encender al frenar.
  const pilotos = buscarPilotos(raiz, tam);

  raiz.updateMatrixWorld(true);
  const medidas = {
    largo: +tam.z.toFixed(3), ancho: +tam.x.toFixed(3), alto: +tam.y.toFixed(3),
    escala: +escala.toFixed(5),
    ruedas: ruedas.map(r => ({
      nombre: r.nombre,
      x: +r.centro.x.toFixed(3), y: +r.centro.y.toFixed(3), z: +r.centro.z.toFixed(3),
      radio: +r.radio.toFixed(3), piezas: r.piezas,
    })),
    pilotos: pilotos.length,
  };
  return { raiz, medidas, ruedas, pilotos: pilotos.map(p => p.material) };
}

/**
 * Encuentra las cuatro ruedas y las mete cada una en su nodo con el nombre
 * que espera Vehicle.
 *
 * ESTRATEGIA EN DOS PASOS. Primero por NOMBRE, que es fiable cuando el autor
 * los puso ("Wheel_FL", "rueda.001", "Tire"). Si eso no da cuatro grupos, por
 * GEOMETRIA: piezas de la mitad de abajo, hacia los costados, que miden mas
 * o menos lo mismo de alto que de largo — es decir, redondas.
 */
function separarRuedas(raiz, tam) {
  const mallas = [];
  raiz.traverse(o => { if (o.isMesh) mallas.push(o); });

  const piezas = mallas.map(o => {
    const caja = cajaLocal(o, raiz);
    return {
      o, caja,
      centro: caja.getCenter(new THREE.Vector3()),
      tam: caja.getSize(new THREE.Vector3()),
      nombrado: NOMBRE_RUEDA.test(o.name) || NOMBRE_FRENO.test(o.name)
        || NOMBRE_RUEDA.test(o.parent?.name ?? '') || NOMBRE_FRENO.test(o.parent?.name ?? ''),
    };
  });

  const porNombre = piezas.filter(p => p.nombrado);
  let grupos = agrupar(porNombre, tam);
  if (grupos.length !== 4) {
    const redondas = piezas.filter(p => esRueda(p, tam));
    grupos = agrupar(redondas, tam);
  }
  if (grupos.length !== 4) return [];

  // Bautizar: +X es la IZQUIERDA del coche, +Z su frente.
  grupos.sort((a, b) => b.centro.z - a.centro.z);
  const [f1, f2, r1, r2] = grupos;
  const nombrar = (a, b, pre) => {
    const [izq, der] = a.centro.x >= b.centro.x ? [a, b] : [b, a];
    izq.nombre = pre + 'L';
    der.nombre = pre + 'R';
  };
  nombrar(f1, f2, 'WheelFront');
  nombrar(r1, r2, 'WheelRear');

  for (const g of grupos) {
    const nodo = new THREE.Group();
    nodo.name = g.nombre;
    nodo.position.copy(g.centro);
    raiz.add(nodo);
    raiz.updateMatrixWorld(true);
    // attach() conserva la posicion en el mundo: la rueda no se mueve ni un
    // milimetro, solo cambia de quien cuelga.
    for (const p of g.piezas2) nodo.attach(p.o);
    // Si la pieza es la pinza del freno, se marca para que no gire con la
    // rueda (Vehicle la cuelga del buje).
    for (const p of g.piezas2) {
      if (NOMBRE_FRENO.test(p.o.name) && !NOMBRE_RUEDA.test(p.o.name)) p.o.name = g.nombre + 'BrakePad';
    }
  }
  return grupos;
}

/** ¿Esta pieza parece una rueda? Redonda, abajo y hacia un costado. */
function esRueda(p, tam) {
  const { centro: c, tam: s } = p;
  if (c.y > tam.y * 0.50) return false;                 // va en la mitad de abajo
  if (Math.abs(c.x) < tam.x * 0.17) return false;       // no en el eje del coche
  if (Math.abs(c.z) < tam.z * 0.14) return false;       // no en el centro del costado
  if (s.y > tam.y * 0.62 || s.z > tam.z * 0.26) return false;
  // Redonda: alto y largo parecidos, y el eje (x) mas corto que los dos.
  const prop = s.y > 0 ? s.z / s.y : 0;
  return prop > 0.45 && prop < 2.2 && s.x < Math.max(s.y, s.z) * 1.3;
}

/**
 * Junta las piezas en cuatro montones por cercania en planta. El radio de
 * agrupacion sale del propio coche: un cuarto de la batalla aproximada.
 */
function agrupar(piezas, tam) {
  if (piezas.length < 4) return [];
  const radio = Math.max(0.18, tam.z * 0.09);
  const grupos = [];
  for (const p of piezas) {
    let g = grupos.find(g => Math.hypot(g.centro.x - p.centro.x, g.centro.z - p.centro.z) < radio);
    if (!g) { g = { piezas2: [], centro: p.centro.clone(), caja: new THREE.Box3() }; grupos.push(g); }
    g.piezas2.push(p);
    g.caja.union(p.caja);
    g.caja.getCenter(g.centro);
  }
  const buenos = grupos.filter(g => g.caja.getSize(_v).y > tam.y * 0.14);
  if (buenos.length < 4) return [];
  // Los cuatro mas lejos del centro en planta: si sobran grupos (un escape,
  // un faldon), los que mandan son los de las esquinas.
  buenos.sort((a, b) => esquina(b, tam) - esquina(a, tam));
  const cuatro = buenos.slice(0, 4);
  for (const g of cuatro) {
    const s = g.caja.getSize(new THREE.Vector3());
    g.radio = Math.max(s.y, s.z) / 2;
    g.centro.y = g.caja.min.y + g.radio;     // el buje esta a un radio del suelo
    g.piezas = g.piezas2.length;
  }
  // Tienen que quedar dos a cada lado y dos delante y dos detras.
  const izq = cuatro.filter(g => g.centro.x > 0).length;
  const delante = cuatro.filter(g => g.centro.z > 0).length;
  if (izq !== 2 || delante !== 2) return [];
  return cuatro;
}

const esquina = (g, tam) => Math.abs(g.centro.x) / tam.x + Math.abs(g.centro.z) / tam.z;

/**
 * Materiales de los pilotos traseros, para poder encenderlos al frenar.
 * Por nombre cuando lo hay, y si no por color: rojo dominante y en el tercio
 * de atras. Es una heuristica, y por eso devuelve lista: si se equivoca de
 * pieza se nota poco, y si acierta el coche frena como uno de verdad.
 */
function buscarPilotos(raiz, tam) {
  const out = [];
  const vistos = new Set();
  raiz.traverse(o => {
    if (!o.isMesh) return;
    const caja = cajaLocal(o, raiz);
    const c = caja.getCenter(new THREE.Vector3());
    if (c.z > -tam.z * 0.26) return;
    for (const m of [].concat(o.material)) {
      if (!m || vistos.has(m.uuid)) continue;
      const col = m.color ?? new THREE.Color(1, 1, 1);
      const rojo = col.r > 0.14 && col.r > col.g * 2.2 && col.r > col.b * 2.2;
      if (!rojo && !NOMBRE_PILOTO.test(m.name ?? '') && !NOMBRE_PILOTO.test(o.name)) continue;
      vistos.add(m.uuid);
      out.push({ material: m, malla: o });
    }
  });
  return out;
}

/**
 * Enciende o apaga los pilotos. Se guarda el emisivo de fabrica la primera
 * vez para poder volver a el.
 * @param {THREE.Material[]} materiales
 * @param {number} intensidad 0 apagado · 1 a fondo
 */
export function encenderPilotos(materiales, intensidad) {
  for (const m of materiales) {
    if (!m.userData.emisivoBase) {
      m.userData.emisivoBase = (m.emissive ?? new THREE.Color(0, 0, 0)).clone();
      m.userData.intensidadBase = m.emissiveIntensity ?? 1;
    }
    if (!m.emissive) continue;
    m.emissive.copy(m.userData.emisivoBase).lerp(ROJO_FRENO, intensidad);
    m.emissiveIntensity = m.userData.intensidadBase + intensidad * 2.2;
  }
}
const ROJO_FRENO = new THREE.Color(1.0, 0.045, 0.02);
