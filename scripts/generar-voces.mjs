// Fabrica los audios del narrador (public/voz/) a partir de scripts/guion-voz.mjs.
//
//   npm run voces            voces definitivas con Azure Speech (licenciadas).
//                            Lee AZURE_SPEECH_KEY y AZURE_SPEECH_REGION de .env.voz
//   npm run voces:borrador   voces de prueba con edge-tts, solo para escuchar en
//                            desarrollo: build:web se niega a publicarlas.
//
// Cada personaje pasa ademas por su filtro de ffmpeg (megafono, ardilla...).
// Solo se regenera lo que cambio: cada linea guarda una huella de su texto,
// su personaje y su origen.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERSONAJES, EVENTOS } from './guion-voz.mjs';

const RAIZ = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SALIDA = join(RAIZ, 'public', 'voz');
const CRUDOS = join(RAIZ, 'node_modules', '.cache', 'voz');
const BORRADOR = process.argv.includes('--borrador');

function leerEnv(ruta) {
  if (!existsSync(ruta)) return {};
  const env = {};
  for (const l of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = leerEnv(join(RAIZ, '.env.voz'));
const origen = BORRADOR ? 'borrador' : 'azure';
if (!BORRADOR && !(env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION)) {
  console.error('Falta la clave de Azure. Crea .env.voz con:\n  AZURE_SPEECH_KEY=...\n  AZURE_SPEECH_REGION=eastus\n'
    + 'o usa "npm run voces:borrador" para voces de prueba (no se publican).');
  process.exit(1);
}

const xml = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

async function sintetizarAzure(texto, p, ruta) {
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="es-CO">`
    + `<voice name="${p.voz}"><prosody rate="${p.velocidad}" pitch="${p.tono}">${xml(texto)}</prosody></voice></speak>`;
  for (let intento = 1; ; intento++) {
    const r = await fetch(`https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
        'User-Agent': 'jero-racer-voces',
      },
      body: ssml,
    });
    if (r.ok) { writeFileSync(ruta, Buffer.from(await r.arrayBuffer())); return; }
    // 429: el plan gratis limita las peticiones por minuto; se espera y se reintenta.
    if (r.status === 429 && intento < 6) { await new Promise(res => setTimeout(res, 4000 * intento)); continue; }
    throw new Error(`Azure respondio ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
}

function sintetizarBorrador(texto, p, ruta) {
  const r = spawnSync('python', ['-I', '-m', 'edge_tts', '--voice', p.voz, `--rate=${p.velocidad}`, `--pitch=${p.tono}`,
    '--text', texto, '--write-media', ruta], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('edge-tts fallo: ' + (r.stderr || r.error));
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg fallo: ' + r.stderr);
}

function duracion(ruta) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', ruta], { encoding: 'utf8' });
  return Math.round(parseFloat(r.stdout) * 100) / 100;
}

// Sin silencio al principio ni al final (se mide en el audio limpio, antes del
// eco) y un colchon corto despues, para que la cola del eco no se corte.
const RECORTE = 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,'
  + 'silenceremove=start_periods=1:start_threshold=-50dB,areverse';

mkdirSync(SALIDA, { recursive: true });
mkdirSync(CRUDOS, { recursive: true });
const previo = existsSync(join(SALIDA, 'voz.json')) ? JSON.parse(readFileSync(join(SALIDA, 'voz.json'), 'utf8')) : null;
const huellasPrevias = new Map();
for (const ev of Object.values(previo?.eventos ?? {})) for (const l of ev.lineas) huellasPrevias.set(l.archivo, l.huella);

const manifiesto = { origen, generado: new Date().toISOString(), eventos: {} };
const usados = new Set(['voz.json']);
let nuevas = 0;
for (const [clave, ev] of Object.entries(EVENTOS)) {
  const lineas = [];
  for (const [i, [personaje, texto]] of ev.lineas.entries()) {
    const p = PERSONAJES[personaje];
    const archivo = `${clave}-${i + 1}.mp3`;
    const huella = createHash('sha1').update(JSON.stringify([origen, texto, p])).digest('hex').slice(0, 12);
    const destino = join(SALIDA, archivo);
    if (huellasPrevias.get(archivo) !== huella || !existsSync(destino)) {
      const crudo = join(CRUDOS, `${huella}.mp3`);
      if (!existsSync(crudo)) {
        if (BORRADOR) sintetizarBorrador(texto, p, crudo);
        else await sintetizarAzure(texto, p, crudo);
      }
      ffmpeg(['-i', crudo, '-af', `aresample=24000,${RECORTE},${p.filtro},apad=pad_dur=0.25,loudnorm=I=-15:TP=-1.5:LRA=9`,
        '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '48k', destino]);
      nuevas++;
      process.stdout.write('.');
    }
    usados.add(archivo);
    lineas.push({ archivo, texto, personaje, dur: duracion(destino), huella });
  }
  const { prioridad = 1, espera = 0, prob = 1, primera = false } = ev;
  manifiesto.eventos[clave] = { prioridad, espera, prob, primera, lineas };
}
// Fuera los audios de frases que ya no estan en el guion.
for (const f of readdirSync(SALIDA)) if (!usados.has(f)) rmSync(join(SALIDA, f));
writeFileSync(join(SALIDA, 'voz.json'), JSON.stringify(manifiesto, null, 1));
const total = Object.values(manifiesto.eventos).reduce((a, e) => a + e.lineas.length, 0);
console.log(`\n${total} frases (${nuevas} nuevas), origen: ${origen}`);
