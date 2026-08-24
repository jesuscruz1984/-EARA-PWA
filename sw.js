const C='eara-online-v3';
const A=['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','handsfree.js'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(A)))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x))))])));
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.mode==='navigate'){
    e.respondWith(fetch(req).then(async r=>{
      let html=await r.text();
      if(!html.includes('handsfree.js')) html=html.replace('</body>','<script src="handsfree.js?v=3"></script></body>');
      return new Response(html,{status:r.status,statusText:r.statusText,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
    }).catch(()=>caches.match('index.html')));
    return;
  }
  e.respondWith(fetch(req).catch(()=>caches.match(req)));
});