/* Fotos del juego desde el Chrome del sistema, para poder mirar el resultado
   sin abrir el navegador a mano.

     node scripts/foto.mjs <url> <salida.png> [ancho] [alto] [js...]

   El JS extra se evalua antes de la foto: sirve para encuadrar la camara o
   prender las luces (window.ver(...), window.luces(...)).

   OJO CON LA GPU: sin --use-angle=d3d11 Chrome cae a SwiftShader y el juego
   va a 2 fps, asi que la foto sale antes de que termine de pintar. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import puppeteer from 'puppeteer-core';

const [url, salida, ancho = '1600', alto = '900', ...js] = process.argv.slice(2);
if (!url || !salida) {
  console.error('uso: node scripts/foto.mjs <url> <salida.png> [ancho] [alto] [js...]');
  process.exit(1);
}

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const ejecutable = CHROMES.find(p => existsSync(p));
if (!ejecutable) { console.error('No encuentro Chrome ni Edge'); process.exit(1); }

const navegador = await puppeteer.launch({
  executablePath: ejecutable,
  headless: 'new',
  args: [
    '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist',
    '--enable-unsafe-webgpu', '--no-sandbox', '--hide-scrollbars',
    `--window-size=${ancho},${alto}`,
  ],
});
const pagina = await navegador.newPage();
await pagina.setViewport({ width: +ancho, height: +alto, deviceScaleFactor: 1 });
const errores = [];
pagina.on('console', m => { if (m.type() === 'error') errores.push(m.text()); else console.log('  ·', m.text()); });
pagina.on('pageerror', e => errores.push(String(e)));

await pagina.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
try {
  await pagina.waitForFunction('window.LISTO === true || window.HR !== undefined', { timeout: 60000 });
} catch {
  console.warn('  (la escena no avisó de que estaba lista; se fotografía igual)');
}
for (const linea of js) await pagina.evaluate(linea);
// Dos segundos de margen: los shaders se compilan en el primer fotograma y
// una foto inmediata sale a medio pintar.
await new Promise(r => setTimeout(r, 2500));

mkdirSync(dirname(salida), { recursive: true });
const png = await pagina.screenshot({ type: 'png' });
writeFileSync(salida, png);
await navegador.close();

if (errores.length) { console.error('\nERRORES:'); for (const e of errores.slice(0, 10)) console.error('  ✗', e); }
console.log('→', salida);
process.exit(errores.length ? 1 : 0);
