import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Vite busca index.html y .env.local en su directorio de trabajo, no junto al
// archivo de configuracion. Arrancado desde la carpeta padre (por ejemplo con
// `npm --prefix highway-racer run dev`) no encontraba .env.local y la clave de
// Google llegaba vacia al navegador: la escena fotorrealista caia al respaldo
// procedural sin un solo error en consola. Anclarlo aqui lo hace indiferente a
// desde donde se lance.
const AQUI = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: AQUI,
  envDir: AQUI,
  base: './',
  server: { port: 8150, open: false },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,   // el GLB nunca en base64
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
});
