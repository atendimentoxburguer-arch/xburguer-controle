const CACHE_NAME='xburguer-consumo-v1';
const CORE=[
  '/xburguer-controle/manifest.webmanifest',
  '/xburguer-controle/CONTROLE%20DE%20CONSUMO/login.html',
  '/xburguer-controle/CONTROLE%20DE%20CONSUMO/style.css',
  '/xburguer-controle/icons/xburguer-rounded-192.png',
  '/xburguer-controle/icons/xburguer-rounded-512.png'
];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await Promise.allSettled(CORE.map(async url=>{
      try{
        const res=await fetch(url,{cache:'reload'});
        if(res.ok)await cache.put(url,res.clone());
      }catch{}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(n=>n.startsWith('xburguer-consumo-')&&n!==CACHE_NAME).map(n=>caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  const url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    try{
      const res=await fetch(req,{cache:'no-store'});
      if(res.ok){
        const cache=await caches.open(CACHE_NAME);
        cache.put(req,res.clone()).catch(()=>{});
      }
      return res;
    }catch{
      return (await caches.match(req,{ignoreSearch:true})) || (await caches.match('/xburguer-controle/CONTROLE%20DE%20CONSUMO/login.html')) || new Response('Sem conexão.',{status:503});
    }
  })());
});
