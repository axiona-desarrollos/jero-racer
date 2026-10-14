/* JERO RACER · Service worker
   ---------------------------------------------------------------------------
   Sin service worker, la app instalada en el telefono es solo un acceso
   directo: si la red falla al abrirla, no abre. Este guarda el juego en el
   telefono la primera vez y desde entonces abre aunque no haya senal.

     - Paginas (navegacion): red primero, con la copia guardada de respaldo.
       Asi una version nueva entra en cuanto hay red.
     - Codigo, modelos, fuentes e imagenes: cache primero. Los .js llevan
       hash en el nombre, asi que nunca se sirve uno viejo con nombre nuevo.
     - models/carros.json (que carros hay): red primero, como las paginas.
       Si se quedara en cache, un carro publicado despues nunca saldria en el
       menu de quien ya tiene la app instalada. */

const VERSION = 'jero-v10';
const BASICOS = ['./', './index.html', './manifest.webmanifest', './icono-192.png', './icono-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(r => { const copia = r.clone(); caches.open(VERSION).then(c => c.put('./index.html', copia)); return r; })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./'))),
    );
    return;
  }

  if (url.pathname.endsWith('/models/carros.json')) {
    e.respondWith(
      fetch(req)
        .then(r => { if (r.ok) { const copia = r.clone(); caches.open(VERSION).then(c => c.put(req, copia)); } return r; })
        .catch(() => caches.match(req).then(r => r || Response.error())),
    );
    return;
  }

  const propio = url.origin === self.location.origin;
  const fuente = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!propio && !fuente) return;

  e.respondWith(
    caches.match(req).then(guardada => {
      if (guardada) return guardada;
      return fetch(req).then(r => {
        if (r.ok || r.type === 'opaque') {
          const copia = r.clone();
          caches.open(VERSION).then(c => c.put(req, copia));
        }
        return r;
      });
    }),
  );
});
