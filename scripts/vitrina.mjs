/* Hoja de contactos con las fotos de los candidatos de Sketchfab. */
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const UIDS = process.argv.slice(3);
const SALIDA = process.argv[2];
const CELDA_W = 640, CELDA_H = 380, COLS = 2;

const fichas = [];
for (const uid of UIDS) {
  const m = await (await fetch(`https://api.sketchfab.com/v3/models/${uid}`)).json();
  const imgs = (m.thumbnails?.images ?? []).sort((a, b) => b.width - a.width);
  const url = imgs[0]?.url;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  fichas.push({ nombre: m.name, autor: m.user?.displayName, caras: m.faceCount, lic: m.license?.label, buf });
  console.log(`${m.name} · ${m.user?.displayName} · ${m.faceCount} caras · ${m.license?.label}`);
}

const filas = Math.ceil(fichas.length / COLS);
const lienzo = sharp({ create: { width: CELDA_W * COLS, height: CELDA_H * filas, channels: 3, background: '#0a0e14' } });
const capas = [];
for (let i = 0; i < fichas.length; i++) {
  const f = fichas[i];
  const img = await sharp(f.buf).resize(CELDA_W - 16, CELDA_H - 54, { fit: 'cover' }).toBuffer();
  const x = (i % COLS) * CELDA_W + 8, y = Math.floor(i / COLS) * CELDA_H + 8;
  capas.push({ input: img, left: x, top: y });
  const texto = `<svg width="${CELDA_W - 16}" height="40"><rect width="100%" height="100%" fill="#0a0e14"/>
    <text x="4" y="18" font-family="Arial" font-size="17" font-weight="bold" fill="#00f0c0">${i + 1}. ${f.nombre.replace(/&/g, '&amp;').slice(0, 42)}</text>
    <text x="4" y="35" font-family="Arial" font-size="13" fill="#9aa6b2">${(f.autor ?? '').replace(/&/g, '&amp;').slice(0, 28)} · ${Math.round(f.caras / 1000)}k caras · ${f.lic}</text></svg>`;
  capas.push({ input: Buffer.from(texto), left: x, top: y + CELDA_H - 46 });
}
writeFileSync(SALIDA, await lienzo.composite(capas).png().toBuffer());
console.log('→', SALIDA);
