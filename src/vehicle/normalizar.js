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

// Lo que delata una rueda en el nombre de la malla, de su nodo o de su
// material. Cada palabra tiene que EMPEZAR palabra: si no, "Trim" pasa por
// llanta y "SteeringWheel" por rueda. "rim" y "rad" ademas tienen que acabar
// ahi, o casan "Primer" y "Radiator". Van tambien en frances y aleman, que
// es como nombran sus materiales muchos autores de Sketchfab (pneu, jante).
const NOMBRE_RUEDA = /(?<![a-z])(wheel|rueda|tire|tyre|llanta|neum|hjul|pneu|jante|felge|reifen)|(?<![a-z])(rim|rad)(?![a-z])|колес|轮/i;
const NOMBRE_FRENO = /brake|caliper|disc|rotor|pinza|freno/i;
const NOMBRE_PILOTO = /tail|rear.?light|stop|brake.?light|piloto|luz.?tras|lamp.?r|(?<![a-z])red(?![a-z])|feu/i;

const _caja = new THREE.Box3();
const _v = new THREE.Vector3();

/** Caja envolvente de un objeto en el espacio de `raiz`. */
function cajaLocal(obj, raiz) {
  const b = new THREE.Box3().setFromObject(obj, true);
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
  _caja.setFromObject(raiz, true);
  const bruto = _caja.getSize(new THREE.Vector3());
  const escala = ficha.largo / Math.max(0.001, bruto.z);
  orientado.scale.setScalar(escala);
  raiz.updateMatrixWorld(true);

  // 3. CENTRAR: x y z al centro de la planta, y al suelo.
  _caja.setFromObject(raiz, true);
  const centro = _caja.getCenter(new THREE.Vector3());
  orientado.position.set(-centro.x, -_caja.min.y, -centro.z);
  raiz.updateMatrixWorld(true);

  _caja.setFromObject(raiz, true);
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
      radio: +r.radio.toFixed(3), piezas: r.piezas, giro: +THREE.MathUtils.radToDeg(r.giro).toFixed(1),
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
 * los puso ("Wheel_FL", "rueda.001", un material "Tire"). Si eso no da cuatro
 * grupos, por GEOMETRIA: piezas de la mitad de abajo, hacia los costados, que
 * miden mas o menos lo mismo de alto que de largo — es decir, redondas.
 * Despues, lo que cabe dentro de cada rueda (disco, tuercas, el centro de la
 * llanta) se va con ella aunque se llame Object_42: si no, giraria la goma y
 * la llanta se quedaria quieta.
 */
function separarRuedas(raiz, tam) {
  partirEjes(raiz, tam);

  const mallas = [];
  raiz.traverse(o => {
    if (o.isMesh) mallas.push(o);
    // Si el autor ya llamo a un nodo como los que se van a crear, Vehicle
    // encontraria primero el suyo (vacio tras mover las piezas) y la rueda
    // no giraria. Se le cambia el nombre al original.
    else if (/^Wheel(Front|Rear)[LR]$/.test(o.name)) o.name += '_original';
  });

  const piezas = mallas.map(o => {
    const caja = cajaLocal(o, raiz);
    const nombres = [o.name, o.parent?.name ?? '', ...[].concat(o.material).map(m => m?.name ?? '')];
    return {
      o, caja,
      centro: caja.getCenter(new THREE.Vector3()),
      tam: caja.getSize(new THREE.Vector3()),
      nombrado: nombres.some(n => NOMBRE_RUEDA.test(n) || NOMBRE_FRENO.test(n)),
    };
  });

  // El nombre solo vale abajo y hacia un costado: un material "rim" que el
  // autor uso tambien en los marcos de las ventanas no puede hacer rueda.
  const porNombre = piezas.filter(p => p.nombrado && p.centro.y < tam.y * 0.6 && Math.abs(p.centro.x) > tam.x * 0.15);
  let grupos = agrupar(porNombre, tam);
  if (grupos.length !== 4) {
    const redondas = piezas.filter(p => esRueda(p, tam));
    grupos = agrupar(redondas, tam);
  }
  if (grupos.length !== 4) return [];

  const usadas = new Set(grupos.flatMap(g => g.piezas2));
  for (const p of piezas) {
    if (usadas.has(p)) continue;
    const g = grupos.find(g => cabeDentro(p.caja, g.caja, 0.03));
    if (g) g.piezas2.push(p);
  }

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
    g.piezas = g.piezas2.length;
    const nodo = new THREE.Group();
    nodo.name = g.nombre;
    nodo.position.copy(g.centro);
    // Muchos autores dejan las delanteras giradas, que en la foto queda bien.
    // El nodo se gira lo mismo y Vehicle deshace ese giro de fabrica (como
    // hace con el CarConcept); si no, iria torcida toda la partida.
    g.giro = giroDeFabrica(g.piezas2, raiz, g.centro);
    nodo.rotation.y = g.giro;
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

/**
 * Cuanto esta girada una rueda en Y, en radianes. Vista desde arriba, una
 * rueda es un rectangulo: ancho de neumatico por diametro. Se prueba a
 * enderezarla de medio en medio grado y se queda el giro con el que menos
 * ancho ocupa; derecha, su ancho es el del neumatico y no mas.
 * x·cos(a) − z·sin(a) es la x del punto tras girarlo −a en Y.
 */
function giroDeFabrica(piezas, raiz, centro) {
  const xs = [], zs = [];
  const v = new THREE.Vector3();
  for (const { o } of piezas) {
    const pos = o.geometry.getAttribute('position');
    const paso = Math.max(1, Math.floor(pos.count / 3000));
    for (let i = 0; i < pos.count; i += paso) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      xs.push(v.x - centro.x); zs.push(v.z - centro.z);
    }
  }
  const ancho = (a) => {
    const c = Math.cos(a), s = Math.sin(a);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i] * c - zs[i] * s;
      if (x < min) min = x;
      if (x > max) max = x;
    }
    return max - min;
  };
  let mejor = 0, menor = ancho(0);
  for (let g = -35; g <= 35; g += 0.5) {
    const a = THREE.MathUtils.degToRad(g);
    const w = ancho(a);
    if (w < menor - 1e-4) { menor = w; mejor = a; }
  }
  // Menos de grado y medio es ruido de la malla, no una rueda girada.
  // Girar los puntos -a la endereza, luego venia girada +a: el mismo signo
  // que una rotation.y de three.
  return Math.abs(mejor) < THREE.MathUtils.degToRad(1.5) ? 0 : mejor;
}

/** ¿La caja `a` cabe en la `b`, con un margen en metros? */
function cabeDentro(a, b, margen) {
  return a.min.x >= b.min.x - margen && a.min.y >= b.min.y - margen && a.min.z >= b.min.z - margen
    && a.max.x <= b.max.x + margen && a.max.y <= b.max.y + margen && a.max.z <= b.max.z + margen;
}

/** ¿Esta pieza parece una rueda? Redonda, abajo y hacia un costado. */
function esRueda(p, tam) {
  const { centro: c, tam: s } = p;
  if (c.y > tam.y * 0.50) return false;                 // va en la mitad de abajo
  if (Math.abs(c.x) < tam.x * 0.17) return false;       // no en el eje del coche
  if (Math.abs(c.z) < tam.z * 0.14) return false;       // no en el centro del costado
  // En un superdeportivo la rueda llega a ser tres cuartos de la altura del
  // coche (el Centenario: 0,74 m en 1,14 m).
  if (s.y > tam.y * 0.78 || s.z > tam.z * 0.26) return false;
  // Redonda: alto y largo parecidos, y el eje (x) mas corto que los dos.
  const prop = s.y > 0 ? s.z / s.y : 0;
  return prop > 0.45 && prop < 2.2 && s.x < Math.max(s.y, s.z) * 1.3;
}

/**
 * Hay autores que juntan en UNA malla la rueda izquierda y la derecha de un
 * eje, o las cuatro. Asi no hay forma de girar una sin la otra: se parte la
 * malla por el plano del medio (x = 0, y z = 0 si tambien lo cruza) y cada
 * trozo pasa a ser una malla propia con el mismo material.
 *
 * Solo se parte lo que, partido, son ruedas: un faldon o un parachoques que
 * cruzan de lado a lado se quedan enteros.
 */
function partirEjes(raiz, tam) {
  const mallas = [];
  raiz.traverse(o => {
    if (o.isMesh && !o.isSkinnedMesh && !Array.isArray(o.material) && !o.geometry.morphAttributes.position) mallas.push(o);
  });
  for (const o of mallas) {
    const caja = cajaLocal(o, raiz);
    if (caja.getCenter(_v).y > tam.y * 0.5) continue;
    const porX = caja.min.x < -tam.x * 0.15 && caja.max.x > tam.x * 0.15;
    const porZ = caja.min.z < -tam.z * 0.15 && caja.max.z > tam.z * 0.15;
    if (!porX && !porZ) continue;
    const trozos = partirMalla(o, raiz, porX, porZ);
    if (trozos.length < 2 || !trozos.every(t => esRueda(t, tam))) {
      for (const t of trozos) t.malla.geometry.dispose();
      continue;
    }
    for (const t of trozos) o.parent.add(t.malla);
    o.removeFromParent();
  }
}

/** Parte una malla en mitades (o cuartos) segun de que lado cae cada triangulo. */
function partirMalla(o, raiz, porX, porZ) {
  const g = o.geometry;
  const pos = g.getAttribute('position');
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  raiz.updateMatrixWorld(true);
  const m = new THREE.Matrix4().copy(raiz.matrixWorld).invert().multiply(o.matrixWorld);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const listas = new Map();
  for (let t = 0; t + 2 < n; t += 3) {
    const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(m);
    b.fromBufferAttribute(pos, i1).applyMatrix4(m);
    c.fromBufferAttribute(pos, i2).applyMatrix4(m);
    const clave = (porX && a.x + b.x + c.x > 0 ? 1 : 0) + (porZ && a.z + b.z + c.z > 0 ? 2 : 0);
    let l = listas.get(clave);
    if (!l) listas.set(clave, l = []);
    l.push(i0, i1, i2);
  }
  const trozos = [];
  for (const [clave, tris] of listas) {
    const malla = new THREE.Mesh(subGeometria(g, tris), o.material);
    malla.name = `${o.name}_${clave}`;
    malla.position.copy(o.position);
    malla.quaternion.copy(o.quaternion);
    malla.scale.copy(o.scale);
    o.parent.add(malla);
    const caja = cajaLocal(malla, raiz);
    malla.removeFromParent();
    trozos.push({ malla, caja, centro: caja.getCenter(new THREE.Vector3()), tam: caja.getSize(new THREE.Vector3()) });
  }
  return trozos;
}

/**
 * Geometria nueva con solo los vertices que usan esos triangulos. Compartir
 * los atributos con la original seria mas barato, pero la caja envolvente se
 * mide sobre TODOS los vertices del atributo y la rueda mediria el eje entero.
 */
function subGeometria(g, tris) {
  const mapa = new Map();
  const viejos = [];
  const indice = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i++) {
    let k = mapa.get(tris[i]);
    if (k === undefined) { k = viejos.length; viejos.push(tris[i]); mapa.set(tris[i], k); }
    indice[i] = k;
  }
  const out = new THREE.BufferGeometry();
  for (const [nombre, at] of Object.entries(g.attributes)) {
    const k = at.itemSize;
    const fuente = at.isInterleavedBufferAttribute ? at.data.array : at.array;
    const paso = at.isInterleavedBufferAttribute ? at.data.stride : k;
    const desde = at.isInterleavedBufferAttribute ? at.offset : 0;
    const arr = new fuente.constructor(viejos.length * k);
    for (let i = 0; i < viejos.length; i++) {
      for (let j = 0; j < k; j++) arr[i * k + j] = fuente[viejos[i] * paso + desde + j];
    }
    out.setAttribute(nombre, new THREE.BufferAttribute(arr, k, at.normalized));
  }
  out.setIndex(new THREE.BufferAttribute(viejos.length > 65535 ? indice : new Uint16Array(indice), 1));
  return out;
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
    // La ALTURA es el diametro aunque la rueda venga girada; el largo no:
    // una delantera con la direccion puesta mide mas de lo que es.
    g.radio = s.y / 2;
    g.centro.y = g.caja.min.y + g.radio;     // el buje esta a un radio del suelo
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
 *
 * LO QUE NUNCA PUEDE PASAR es encender un material que tambien usa la
 * carroceria: muchos modelos de Sketchfab pintan medio coche con un solo
 * material y un atlas de texturas, y al frenar se ponia rojo entero. Por eso
 * un material solo cuenta si TODAS sus mallas son pequeñas y estan atras.
 */
function buscarPilotos(raiz, tam) {
  const usos = new Map();   // material -> {material, atras, pequeno, nombre}
  raiz.traverse(o => {
    if (!o.isMesh) return;
    const caja = cajaLocal(o, raiz);
    const c = caja.getCenter(new THREE.Vector3());
    const s = caja.getSize(new THREE.Vector3());
    // Mitad de atras, con margen: la tercera luz de freno va en el techo o el
    // aleron, bastante por delante de la cola. De ancho no se limita: hay
    // pilotos de lado a lado (el Centenario).
    const atras = c.z < -tam.z * 0.15;
    const pequeno = s.y < tam.y * 0.35 && s.z < tam.z * 0.2;
    for (const m of [].concat(o.material)) {
      if (!m) continue;
      const u = usos.get(m) ?? { material: m, atras: true, pequeno: true, nombre: false };
      u.atras &&= atras;
      u.pequeno &&= pequeno;
      u.nombre ||= NOMBRE_PILOTO.test(m.name ?? '') || NOMBRE_PILOTO.test(o.name);
      usos.set(m, u);
    }
  });
  const out = [];
  for (const u of usos.values()) {
    if (!u.atras || !u.pequeno) continue;
    const col = u.material.color ?? new THREE.Color(1, 1, 1);
    const rojo = col.r > 0.14 && col.r > col.g * 2.2 && col.r > col.b * 2.2;
    if (rojo || u.nombre) out.push({ material: u.material });
  }
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
      m.userData.opacidadBase = m.opacity;
    }
    if (!m.emissive) continue;
    m.emissive.copy(m.userData.emisivoBase).lerp(ROJO_FRENO, intensidad);
    // Poco y rojo oscuro A PROPOSITO: el mapeo de tonos (ACES) lava un rojo
    // intenso a naranja. Se comparo en el Mustang y el M4: con +1,1 los
    // pilotos salian salmon; con esto salen rojo freno.
    m.emissiveIntensity = m.userData.intensidadBase + intensidad * 0.3;
    // Si el piloto es la mica (el Mustang: 18 % opaca), el brillo se ve a
    // traves de ella y casi no se nota. Encendida, la mica se vuelve solida,
    // que es como se ve un piloto de verdad al frenar.
    if (m.transparent && m.userData.opacidadBase < 0.85) {
      m.opacity = m.userData.opacidadBase + (0.85 - m.userData.opacidadBase) * intensidad;
    }
  }
}
const ROJO_FRENO = new THREE.Color(0.6, 0, 0);
