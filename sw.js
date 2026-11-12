const CACHE="rustle-image-p2p-v13";
const ASSETS=["./","./index.html","./style.css","./app.js","./nostr.bundle.js","./manifest.webmanifest","./icon-192.png","./icon-512.png"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>Promise.all(ASSETS.map(a=>cache.add(a).catch(()=>{})))));self.skipWaiting()});
self.addEventListener("activate",event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key!==CACHE)await caches.delete(key);await self.clients.claim()})())});
self.addEventListener("fetch",event=>{
 const req=event.request;if(req.method!=="GET")return;
 const url=new URL(req.url);if(url.origin!==location.origin)return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE);try{const response=await fetch(req);if(response.ok)cache.put(req,response.clone());return response}catch(error){return (await cache.match(req))||(req.mode==="navigate"?await cache.match("./index.html"):Response.error())}})())
});