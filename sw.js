// Primero intenta la red (para tener siempre la última versión) y, si no hay señal
// o tarda más de 3 segundos, usa la copia guardada para que la app abra sin internet.
const CACHE = 'mosh-moah-v7';
const ARCHIVOS = ['./', './index.html', './app.js', './manifest.json', './icono.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function desdeRed(req) {
  return fetch(req, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
    return r;
  });
}
function desdeCache(req) {
  return caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  e.respondWith(new Promise(resolver => {
    let listo = false;
    const fin = r => { if (!listo && r) { listo = true; resolver(r); } };
    const espera = setTimeout(() => desdeCache(req).then(fin), 3000);
    desdeRed(req).then(r => { clearTimeout(espera); fin(r); })
      .catch(() => { clearTimeout(espera); desdeCache(req).then(r => { if (r) fin(r); else resolver(Response.error()); }); });
  }));
});
