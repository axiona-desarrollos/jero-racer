/* ==========================================================================
   JERO RACER · Preparar los carros de Sketchfab para el juego
   --------------------------------------------------------------------------
     node scripts/preparar-carro.mjs              todos los de carros.js
     node scripts/preparar-carro.mjs mustang      solo uno
     node scripts/preparar-carro.mjs --forzar     rehace aunque ya esten

   DE DONDE SACA EL ARCHIVO, en este orden:
     1. modelos/<id>.glb, modelos/<id>/ (con su .gltf dentro) o un .zip en
        modelos/ cuyo nombre se parezca al del modelo. Es lo que deja el boton
        azul "Download 3D Model -> glTF" de Sketchfab, por ejemplo
        ford-mustang-shelby-gt500.zip: se deja tal cual en modelos/.
     2. la API de Sketchfab, si hay token en SKETCHFAB_TOKEN o en .env.modelos
        (SKETCHFAB_TOKEN=...). Sale de sketchfab.com/settings/password, abajo
        del todo, "API Token". Sin token Sketchfab responde 401 a cualquiera.

   QUE SALE
     public/models/<id>.glb        escritorio: texturas de 2048
     public/models/<id>-movil.glb  telefono: mas simplificado, texturas de 1024
     public/models/carros.json     los carros que el menu puede ofrecer
   Los originales se quedan en modelos/, que no se publica (pesan decenas de
   MB). Ni los .glb ni el manifiesto van al repositorio: dependen de que el
   modelo se haya bajado en ESTE equipo.

   SE SIMPLIFICA LO DENSO, NO TODO. En estos modelos los triangulos se van en
   las llantas y los neumaticos (el Mustang: 136.000 solo en gomas) y en el
   motor. La carroceria tiene pocos y grandes, y simplificarla deja los
   paneles ondulados: se probo y el M4 parecia abollado. Por eso se mide la
   densidad de cada malla (triangulos por metro cuadrado de su caja) y solo se
   recorta la que pasa del limite.

   QUE NO HACE: orientar, escalar ni separar las ruedas. Eso lo hace el juego
   al cargar (vehicle/normalizar.js), donde three lo resuelve con cajas
   envolventes en tres lineas. Por eso aqui no se fusionan mallas: si la
   rueda y la carroceria acabaran en la misma, ya no habria forma de girarla.
   ========================================================================== */

import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplifyPrimitive, getBounds, quantize, meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { CARROS } from '../src/vehicle/carros.js';

const RAIZ = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ORIGINALES = join(RAIZ, 'modelos');
const SALIDA = join(RAIZ, 'public', 'models');
const MANIFIESTO = join(SALIDA, 'carros.json');

// Triangulos por m² de caja a partir de los cuales una malla se simplifica.
// Un neumatico del Mustang trae 18.000/m²; su carroceria, 740.
const ESCRITORIO = { densidad: 5000, error: 0.003, lado: 2048 };
// El de movil: lo que aguanta un Android de gama media a 60 fps con la
// pasada de sombras, que pinta el carro dos veces.
const MOVIL = { densidad: 1000, error: 0.006, lado: 1024 };

const args = process.argv.slice(2);
const FORZAR = args.includes('--forzar');
const pedidos = args.filter(a => !a.startsWith('--'));
const lista = pedidos.length ? CARROS.filter(c => pedidos.includes(c.id)) : CARROS;
if (!lista.length) {
  console.error(`No hay ningun carro con ese id. Los que hay: ${CARROS.map(c => c.id).join(', ')}`);
  process.exit(1);
}

function leerEnv(ruta) {
  if (!existsSync(ruta)) return {};
  const env = {};
  for (const l of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
const TOKEN = process.env.SKETCHFAB_TOKEN || leerEnv(join(RAIZ, '.env.modelos')).SKETCHFAB_TOKEN || '';

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

mkdirSync(ORIGINALES, { recursive: true });
mkdirSync(SALIDA, { recursive: true });
const manifiesto = existsSync(MANIFIESTO) ? JSON.parse(readFileSync(MANIFIESTO, 'utf8')) : { carros: {} };

const fallos = [];
for (const c of lista) {
  console.log(`\n${c.nombre} (${c.id}) · ${c.autor} · ${c.licencia}`);
  try {
    const escritorio = join(SALIDA, `${c.id}.glb`);
    const movil = join(SALIDA, `${c.id}-movil.glb`);
    if (!FORZAR && existsSync(escritorio) && existsSync(movil) && manifiesto.carros[c.id]) {
      console.log('  ya esta preparado (--forzar para rehacerlo)');
      continue;
    }
    const fuente = await conseguir(c);
    console.log(`  original  ${fuente.replace(RAIZ + sep, '')}`);
    const a = await optimizar(fuente, escritorio, c, ESCRITORIO);
    const b = await optimizar(fuente, movil, c, MOVIL);
    manifiesto.carros[c.id] = {
      escritorio: `${c.id}.glb`, movil: `${c.id}-movil.glb`,
      triangulos: [a.triangulos, b.triangulos], mb: [a.mb, b.mb],
    };
    escribirLicencia(c);
  } catch (e) {
    fallos.push(c.id);
    console.error(`  NO SE PUDO: ${e.message}`);
  }
}

manifiesto.generado = new Date().toISOString();
// Solo se ofrecen los que de verdad estan en disco: si alguien borra un .glb,
// el menu no debe ofrecer un carro que da 404.
for (const id of Object.keys(manifiesto.carros)) {
  const m = manifiesto.carros[id];
  if (!existsSync(join(SALIDA, m.escritorio)) || !existsSync(join(SALIDA, m.movil))) delete manifiesto.carros[id];
}
writeFileSync(MANIFIESTO, JSON.stringify(manifiesto, null, 1) + '\n');
console.log(`\nEn el menu: ${Object.keys(manifiesto.carros).join(', ') || 'ninguno'}`);
if (fallos.length) {
  console.error(`Faltan: ${fallos.join(', ')}`);
  process.exit(1);
}

// ------------------------------------------------------------- conseguirlo

/** Devuelve la ruta de un .glb o .gltf listo para leer. */
async function conseguir(c) {
  const local = buscarLocal(c);
  if (local) return local;
  if (!TOKEN) {
    throw new Error(`no esta en modelos/ y no hay SKETCHFAB_TOKEN.\n`
      + `    Bajalo a mano (Download 3D Model -> glTF) de ${c.fuente}\n`
      + `    y deja el .zip en modelos/, o pon el token en .env.modelos.`);
  }
  return descargar(c);
}

/** Palabras del nombre del modelo en Sketchfab, sacadas de su direccion. */
function huella(c) {
  const slug = c.fuente.split('/').pop().replace(/-[0-9a-f]{32}$/, '');
  return slug.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buscarLocal(c) {
  const glb = join(ORIGINALES, `${c.id}.glb`);
  if (existsSync(glb)) return glb;
  const carpeta = join(ORIGINALES, c.id);
  if (existsSync(carpeta)) {
    const gltf = buscarGltf(carpeta);
    if (gltf) return gltf;
  }
  // Un .zip con el nombre del id o con el del modelo en Sketchfab.
  const h = huella(c);
  for (const f of readdirSync(ORIGINALES)) {
    if (!/\.zip$/i.test(f)) continue;
    const plano = f.toLowerCase().replace(/\.zip$/, '').replace(/[^a-z0-9]/g, '');
    if (plano === c.id || plano.includes(h) || (h.includes(plano) && plano.length > 8)) {
      console.log(`  descomprimiendo ${f}`);
      descomprimir(readFileSync(join(ORIGINALES, f)), carpeta);
      const gltf = buscarGltf(carpeta);
      if (!gltf) throw new Error(`${f} no trae ningun .gltf ni .glb`);
      return gltf;
    }
  }
  return null;
}

function buscarGltf(dir) {
  for (const f of readdirSync(dir)) {
    const ruta = join(dir, f);
    if (statSync(ruta).isDirectory()) {
      const dentro = buscarGltf(ruta);
      if (dentro) return dentro;
    } else if (/\.(gltf|glb)$/i.test(f)) {
      return ruta;
    }
  }
  return null;
}

async function descargar(c) {
  process.stdout.write('  pidiendo el enlace a Sketchfab … ');
  const r = await fetch(`https://api.sketchfab.com/v3/models/${c.uid}/download`, {
    headers: { Authorization: `Token ${TOKEN}` },
  });
  if (r.status === 401 || r.status === 403) throw new Error(`Sketchfab rechazo el token (${r.status})`);
  if (!r.ok) throw new Error(`Sketchfab respondio ${r.status} ${r.statusText}`);
  const enlaces = await r.json();
  // El .glb es un solo archivo y ya viene empaquetado; el glTF llega en zip.
  const [tipo, opcion] = enlaces.glb ? ['glb', enlaces.glb] : ['zip', enlaces.gltf];
  if (!opcion?.url) throw new Error('Sketchfab no ofrece descarga glTF de este modelo');
  console.log(`${tipo}, ${(opcion.size / 1048576).toFixed(1)} MB`);
  // El enlace es de Amazon S3 y ya va firmado: NO se le manda el token.
  const d = await fetch(opcion.url);
  if (!d.ok) throw new Error(`la descarga fallo: ${d.status}`);
  const buf = Buffer.from(await d.arrayBuffer());
  if (tipo === 'glb') {
    const ruta = join(ORIGINALES, `${c.id}.glb`);
    writeFileSync(ruta, buf);
    return ruta;
  }
  writeFileSync(join(ORIGINALES, `${c.id}.zip`), buf);
  const carpeta = join(ORIGINALES, c.id);
  descomprimir(buf, carpeta);
  const gltf = buscarGltf(carpeta);
  if (!gltf) throw new Error('el zip de Sketchfab no trae .gltf');
  return gltf;
}

/**
 * Lector de zip minimo: lo justo para lo que entrega Sketchfab (stored o
 * deflate, sin zip64). Se escribe aqui para no meter una dependencia mas por
 * cuarenta lineas.
 */
function descomprimir(zip, destino) {
  let fin = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('el archivo no es un zip');
  const total = zip.readUInt16LE(fin + 10);
  let p = zip.readUInt32LE(fin + 16);
  const base = resolve(destino);
  for (let k = 0; k < total; k++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('el zip esta dañado');
    const metodo = zip.readUInt16LE(p + 10);
    const comprimido = zip.readUInt32LE(p + 20);
    const lNombre = zip.readUInt16LE(p + 28);
    const lExtra = zip.readUInt16LE(p + 30);
    const lComentario = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const nombre = zip.toString('utf8', p + 46, p + 46 + lNombre);
    p += 46 + lNombre + lExtra + lComentario;
    if (nombre.endsWith('/')) continue;
    if (comprimido === 0xffffffff || local === 0xffffffff) throw new Error('zip de mas de 4 GB (zip64): descomprimelo a mano en modelos/<id>/');
    // Nada de "../": un zip no escribe fuera de su carpeta.
    const ruta = resolve(base, nombre);
    if (!ruta.startsWith(base + sep)) throw new Error(`ruta sospechosa en el zip: ${nombre}`);
    const ini = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const datos = zip.subarray(ini, ini + comprimido);
    let plano;
    if (metodo === 0) plano = datos;
    else if (metodo === 8) plano = inflateRawSync(datos);
    else throw new Error(`metodo de compresion ${metodo} no soportado en ${nombre}`);
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, plano);
  }
}

// ---------------------------------------------------------------- optimizar

function contarTriangulos(doc) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) {
    for (const p of m.listPrimitives()) {
      if (p.getMode() !== 4) continue;   // solo TRIANGLES; lineas y puntos no cuentan
      const i = p.getIndices();
      n += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3;
    }
  }
  return Math.round(n);
}

async function optimizar(fuente, salida, ficha, { densidad, error, lado }) {
  const doc = await io.read(fuente);
  // gltf-transform avisa de cada UV fuera de [0,1] que no cuantiza: son
  // decenas de lineas por modelo que no piden hacer nada.
  doc.setLogger(new Logger(Logger.Verbosity.ERROR));
  const antes = contarTriangulos(doc);
  await doc.transform(dedup(), prune({ keepLeaves: true }), weld());
  simplificarDensas(doc, ficha, densidad, error);
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 86, resize: [lado, lado] }),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  await io.write(salida, doc);
  const despues = contarTriangulos(doc);
  const mb = +(statSync(salida).size / 1048576).toFixed(2);
  console.log(`  ${salida.split(sep).pop().padEnd(22)} ${String(antes).padStart(8)} -> ${String(despues).padStart(7)} triangulos · ${mb} MB`);
  return { triangulos: despues, mb };
}

/**
 * Simplifica cada malla cuya densidad pase de `densidad` triangulos por m²
 * de su caja, lo justo para quedar en ese limite. El simplificador respeta
 * un error maximo (relativo al tamaño de la malla): si con eso no llega, se
 * queda corto antes que deformar la pieza.
 */
function simplificarDensas(doc, ficha, densidad, error) {
  const escena = doc.getRoot().listScenes()[0];
  const total = getBounds(escena);
  // El modelo viene en las unidades de su autor: se pasa a metros con el
  // largo de la ficha, medido en el eje que sera el largo tras el giro.
  const eje = (ficha.giro ?? 0) % 2 ? 0 : 2;
  const k = ficha.largo / Math.max(1e-6, total.max[eje] - total.min[eje]);
  const vistas = new Set();
  escena.traverse(nodo => {
    const malla = nodo.getMesh();
    if (!malla || vistas.has(malla)) return;
    vistas.add(malla);
    const b = getBounds(nodo);
    const [x, y, z] = [0, 1, 2].map(i => (b.max[i] - b.min[i]) * k);
    const area = Math.max(1e-4, 2 * (x * y + y * z + z * x));
    const prims = malla.listPrimitives().filter(p => p.getMode() === 4);
    const tris = prims.reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
    if (tris / area <= densidad) return;
    const proporcion = Math.max(0.05, densidad * area / tris);
    for (const p of prims) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: proporcion, error });
  });
}

function escribirLicencia(c) {
  writeFileSync(join(ORIGINALES, `_${c.id}-LICENSE.md`), `# ${c.nombre}

Modelo «${c.fuente.split('/').pop().replace(/-[0-9a-f]{32}$/, '').replace(/-/g, ' ')}» de **${c.autor}** (${c.perfil}).

- Fuente: ${c.fuente}
- Licencia: ${c.licencia} — https://creativecommons.org/licenses/by/4.0/

Cambios hechos para JERO RACER: simplificado, texturas a WebP y compresion
meshopt (scripts/preparar-carro.mjs). La marca y el diseño del vehiculo son de
sus dueños, que no patrocinan ni avalan este juego.
`);
}
