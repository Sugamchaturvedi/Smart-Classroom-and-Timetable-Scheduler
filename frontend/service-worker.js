/* Network-first service worker for Smart Classroom & Timetable Scheduler.
   Ensures fresh app shell & scripts while providing offline resilience.
   API endpoints (/api/) are NEVER cached by the service worker to prevent
   stale authentication or directory race conditions. */

const CACHE_NAME = "smart-scheduler-cache-v2";
const APP_SHELL = ["./", "./index.html", "./style.css", "./script.js", "./manifest.json"];

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
  // Never intercept non-GET or dynamic backend API calls
  if (event.request.method !== "GET" || event.request.url.includes("/api/")) {
    return;
  }

  // Network-first strategy for app shell resources:
  // Always fetch fresh HTML/CSS/JS when online; fallback to cache if offline.
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200 && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
