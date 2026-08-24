const C='eara-online-v21';
const A=['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','app.js','handsfree.js','robot-bg.svg'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(A)))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x))))])));
self.addEventListener('fetch',e=>{const req=e.request;if(req.mode==='navigate'){e.respondWith(fetch(req,{cache:'no-store'}).catch(()=>caches.match('index.html')));return}e.respondWith(fetch(req,{cache:'no-store'}).catch(()=>caches.match(req)))});
