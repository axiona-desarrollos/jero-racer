/* Descarga reproducible de los modelos de Khronos (CC-BY-4.0 / CC0-1.0).
   Los .glb no van al repositorio: se traen con `npm run models`. */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models';
const MODELOS = [
  { nombre: 'CarConcept', archivo: 'CarConcept.glb', destino: 'public/models', licencia: 'CC-BY-4.0' },
];

for (const m of MODELOS) {
  const dir = join(RAIZ, m.destino);
  await mkdir(dir, { recursive: true });
  const salida = join(dir, m.archivo);
  try { await access(salida); console.log(`  ya está  ${m.archivo}`); continue; } catch { /* falta */ }
  const url = `${BASE}/${m.nombre}/glTF-Binary/${m.archivo}`;
  process.stdout.write(`  bajando  ${m.archivo} … `);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} en ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(salida, buf);
  console.log(`${(buf.length / 1048576).toFixed(2)} MB · ${m.licencia}`);
}
console.log('\nModelos de Khronos glTF-Sample-Assets. Atribución requerida para CC-BY-4.0.');
