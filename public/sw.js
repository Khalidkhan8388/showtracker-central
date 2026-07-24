// Braintape service worker.
// - Accepts Web Share Target POSTs (text, url, images, audio) and stashes them
//   in IndexedDB so the /share page can turn them into notes on the main thread.
// - Runtime caches static assets for fast reloads.

const CACHE = 'braintape-v2';
const DB_NAME = 'braintape-share';
const STORE = 'inbox';

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function putShare(rec) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Share Target intake — POST /share with multipart form.
  if (req.method === 'POST' && url.pathname === '/share') {
    event.respondWith((async () => {
      try {
        const form = await req.formData();
        const files = [];
        const collect = (key) => {
          for (const val of form.getAll(key)) {
            if (val instanceof File && val.size > 0) {
              files.push(val); // keep as File for later arrayBuffer
            }
          }
        };
        collect('files');
        collect('image');
        collect('audio');
        collect('video');

        const fileRecords = await Promise.all(
          files.map(async (f) => ({
            name: f.name || 'shared',
            type: f.type || 'application/octet-stream',
            buf: await f.arrayBuffer(),
          })),
        );

        await putShare({
          ts: Date.now(),
          url: String(form.get('url') || ''),
          text: String(form.get('text') || ''),
          title: String(form.get('title') || ''),
          files: fileRecords,
        });
      } catch (err) {
        // swallow — the /share page will show "nothing to save" if inbox empty
      }
      return Response.redirect('/share?pending=1', 303);
    })());
    return;
  }

  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Runtime cache for hashed/static assets — stale-while-revalidate.
  const isAsset = /\.(?:js|mjs|css|woff2?|png|jpg|jpeg|webp|svg|ico|json|txt)$/i.test(url.pathname);
  if (isAsset) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      const network = fetch(req)
        .then((r) => {
          if (r && r.ok) cache.put(req, r.clone()).catch(() => {});
          return r;
        })
        .catch(() => null);
      return hit || (await network) || Response.error();
    })());
    return;
  }

  // Navigations: network with cache fallback (keeps the app openable offline
  // after a first visit, without ever serving a stale HTML shell online).
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const r = await fetch(req);
        if (r && r.ok) {
          const cache = await caches.open(CACHE);
          cache.put(req, r.clone()).catch(() => {});
        }
        return r;
      } catch {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(req);
        return hit || Response.error();
      }
    })());
  }
});
