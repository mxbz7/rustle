"use strict";
const CACHE = "rustle-shell-v45";
const SHELL = ["./", "./index.html", "./style.css", "./app.js", "./nostr.bundle.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"];
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(path => cache.add(new Request(path, { cache: "reload" })).catch(() => null)));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("rustle-") && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request, { cache: "no-cache" });
      if (response && response.ok && response.type !== "opaque") {
        const copy = response.clone();
        await cache.put(request, copy).catch(() => {});
      }
      return response;
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        const shell = await cache.match("./index.html");
        if (shell) return shell;
      }
      return new Response("Offline and this resource is not cached.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  })());
});
