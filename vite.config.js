import { defineConfig } from 'vite';

export default defineConfig({
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
