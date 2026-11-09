const CACHE = 'doctorpay-app-v5-3';
const FILES = ['./index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', event => {
 event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
 event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key=>key.startsWith('doctorpay-app-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
 const url=new URL(event.request.url);
 if (event.request.method!=='GET'||url.origin!==self.location.origin) return;
 if(url.pathname.endsWith('/index.html')||url.pathname.endsWith('/')){
   event.respondWith(fetch(event.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put('./index.html',copy)).catch(()=>{});}return r}).catch(()=>caches.match('./index.html')));
   return;
 }
 event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
