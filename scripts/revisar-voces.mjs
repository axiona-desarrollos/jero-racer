// Antes de compilar la version publica: las voces de borrador (edge-tts) no
// se publican. Sin public/voz el juego funciona igual, solo que sin narrador.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ruta = join(resolve(fileURLToPath(new URL('..', import.meta.url))), 'public', 'voz', 'voz.json');
if (existsSync(ruta)) {
  const { origen } = JSON.parse(readFileSync(ruta, 'utf8'));
  if (origen !== 'azure' && process.argv.includes('--permitir-borrador')) {
    // Decision de Santiago (11-oct-2026): publicar ya con las de prueba y
    // cambiarlas por las de Azure cuando haya tarjeta para abrir la cuenta.
    console.warn('AVISO: se publican las voces de BORRADOR. Cambiarlas por las de Azure con npm run voces.');
  } else if (origen !== 'azure') {
    console.error('public/voz tiene voces de BORRADOR: no se pueden publicar.\n'
      + 'Genera las definitivas con "npm run voces" (clave de Azure en .env.voz) o borra public/voz.');
    process.exit(1);
  }
}
