// Doctor Pay: cached startup, background refresh. No access to payroll storage.
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = 'doctor-pay-startup:' + SCOPE.href + ':';
const CACHE = CACHE_PREFIX + 'v1';
const ENTRY = new URL('index.html', SCOPE).href;
const ASSETS = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png'].map(path => new URL(path, SCOPE).href);
const ASSET_SET = new Set(ASSETS);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([ENTRY, ...ASSETS].map(url => new Request(url, {cache: 'reload'})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function readCache(key) {
  try { return await (await caches.open(CACHE)).match(key); }
  catch (_) { return undefined; }
}
async function refresh(request, key, html = false) {
  try {
    const response = await fetch(request, {cache: 'no-cache'});
    const type = response.headers.get('content-type') || '';
    if (!response.ok || response.status !== 200 || response.redirected || (html && !type.toLowerCase().includes('text/html'))) return undefined;
    // A failed cache write must not prevent displaying the fetched page.
    try { await (await caches.open(CACHE)).put(key, response.clone()); } catch (_) {}
    return response;
  } catch (_) { return undefined; }
}
function offlinePage() {
  return new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ドクターペイ</title><body style="background:#f6f8fb;color:#192d42;font:16px system-ui;padding:24px"><p>接続できませんでした。通信を確認し、再度開いてください。</p></body></html>', {status: 503, headers: {'Content-Type': 'text/html; charset=utf-8'}});
}
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== SCOPE.origin) return;
  const isEntry = request.mode === 'navigate' && (url.pathname === SCOPE.pathname || url.pathname === new URL(ENTRY).pathname);
  if (isEntry) {
    const cached = readCache(ENTRY);
    const latest = refresh(request, ENTRY, true);
    // Keep the worker alive for the refresh, but do not block cached startup.
    event.waitUntil(latest.then(() => undefined));
    const forceRefresh = url.searchParams.get('refresh') === '1';
    event.respondWith((async () => {
      if (forceRefresh) return (await latest) || (await cached) || offlinePage();
      return (await cached) || (await latest) || offlinePage();
    })());
    return;
  }
  if (ASSET_SET.has(url.href)) {
    event.respondWith((async () => (await readCache(url.href)) || fetch(request))());
  }
});
