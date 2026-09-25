/* Minimal cache-first service worker so the Scheduler keeps working offline
   once it has been opened once over http(s). Not used at all when the app
   is opened directly as a file:// page — browsers only allow service
   workers on http/https origins, so run it via a local server to try this
   (e.g. `python -m http.server` in this folder, then open localhost). */

const CACHE_NAME = "smart-scheduler-cache-v1";
const APP_SHELL = ["./index.html", "./style.css", "./script.js", "./manifest.json"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
          return response;
        })
        .catch(() => cached);
    })
  );
});
