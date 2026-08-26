const CACHE='agent-1.0-v2';
const ASSETS=['./','./index.html','./app.js','./manifest.webmanifest'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;if(r.mode==='navigate'){e.respondWith(fetch(r,{cache:'no-store'}).catch(()=>caches.match('./index.html')));return}e.respondWith(fetch(r,{cache:'no-store'}).catch(()=>caches.match(r)))});
