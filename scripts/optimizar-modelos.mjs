/* Optimiza el deportivo para la web: compresion meshopt y una version
   simplificada para movil. Se ejecuta tras `npm run models`.

   POR QUE: el GLB original pesa 11,8 MB y tiene 213.000 triangulos (solo los
   limpiaparabrisas son 24.000). En un movil con datos eso era medio minuto de
   descarga, y luego el doble de triangulos contando la pasada de sombras.

     public/models/CarConcept.glb        -> escritorio: misma geometria, comprimida
     public/models/CarConcept-movil.glb  -> movil: simplificada y comprimida
   Los nombres de nodo se conservan: vehicle.js busca las ruedas por nombre. */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, quantize, meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat, rename, access, mkdir } from 'node:fs/promises';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(RAIZ, 'public/models');
// El original vive fuera de public/: si no, Vite lo copiaria a la web (11,8 MB).
const ORIGINAL = join(RAIZ, 'modelos/CarConcept.original.glb');
const ENTRADA = join(DIR, 'CarConcept.glb');

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

// Se guarda el original una sola vez: optimizar sobre algo ya optimizado
// degradaria en cada pasada.
await mkdir(dirname(ORIGINAL), { recursive: true });
try { await access(ORIGINAL); } catch { await rename(ENTRADA, ORIGINAL); }

const triangulos = doc => {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const i = p.getIndices(); n += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3;
  }
  return n;
};

// Texturas a WebP: el PNG de 2048 de la carroceria pesaba 1,5 MB por si solo.
for (const [salida, proporcion, lado] of [[ENTRADA, 1, 2048], [join(DIR, 'CarConcept-movil.glb'), 0.32, 1024]]) {
  const doc = await io.read(ORIGINAL);
  const pasos = [dedup(), prune({ keepLeaves: true }), weld()];
  if (proporcion < 1) pasos.push(simplify({ simplifier: MeshoptSimplifier, ratio: proporcion, error: 0.0008 }));
  pasos.push(textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 88, resize: [lado, lado] }));
  pasos.push(quantize(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await doc.transform(...pasos);
  await io.write(salida, doc);
  const mb = (await stat(salida)).size / 1048576;
  console.log(`${salida.split(/[\/]/).pop()}: ${Math.round(triangulos(doc))} triangulos, ${mb.toFixed(2)} MB`);
}
