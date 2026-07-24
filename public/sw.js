// Braintape service worker.
// - Accepts Web Share Target POSTs (text, url, images, audio) and stashes them
//   in IndexedDB so the /share page can turn them into notes on the main thread.
// - Runtime caches static assets for fast reloads.

const CACHE = 'braintape-v6';
const DB_NAME = 'braintape-share';
const STORE = 'inbox';
const APP_SHELL = ['/', '/home', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/favicon.ico'];

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function readShareMode() {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction('settings', 'readonly');
      const req = tx.objectStore('settings').get('share-mode');
      req.onsuccess = () => resolve(req.result === 'open' ? 'open' : 'silent');
      req.onerror = () => resolve('silent');
    });
  } catch { return 'silent'; }
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
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(APP_SHELL.map((u) => cache.add(u).catch(() => {})));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/home';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if (new URL(c.url).origin === self.location.origin) {
        try { await c.focus(); return; } catch {}
      }
    }
    try { await self.clients.openWindow(target); } catch {}
  })());
});




self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Share Target intake — POST /share with multipart form.
  // Stash the payload in IndexedDB, notify any open Braintape client so it
  // can drain silently in the background, then respond with a tiny
  // self-closing confirmation page instead of opening the full app UI.
  if (req.method === 'POST' && url.pathname === '/share') {
    event.respondWith((async () => {
      let ok = false;
      try {
        const form = await req.formData();
        const files = [];
        const collect = (key) => {
          for (const val of form.getAll(key)) {
            if (val instanceof File && val.size > 0) files.push(val);
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
        ok = true;
      } catch (err) {
        ok = false;
      }

      // Nudge any open Braintape client to drain the inbox in background.
      let hasClient = false;
      try {
        const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of wins) {
          if (new URL(c.url).origin === self.location.origin) {
            hasClient = true;
            c.postMessage({ type: 'braintape-share-received' });
          }
        }
      } catch {}

      // Read user preference: 'open' = navigate to /share for review, 'silent' = background notification.
      const mode = ok ? await readShareMode() : 'silent';
      if (mode === 'open') {
        return Response.redirect('/share', 303);
      }

      // Background status via a native notification (no app UI shift).
      try {
        if (self.registration && self.registration.showNotification && self.Notification && self.Notification.permission === 'granted') {
          await self.registration.showNotification(
            ok ? 'Saved to Braintape' : 'Nothing to save',
            {
              body: ok ? 'Tap to open your brain.' : 'The share had no text, link, image or audio.',
              icon: '/icon-192.png',
              badge: '/icon-192.png',
              tag: 'braintape-share',
              silent: true,
              data: { url: '/home' },
            },
          );
        }
      } catch {}

      // Tiny self-closing confirmation page (no iframe boot — the app will
      // drain the inbox next time it opens, and if it's already open the
      // postMessage above already triggered a lock-guarded drain).
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saved to Braintape</title><style>
        html,body{margin:0;height:100%;background:#fff;color:#000;font:500 15px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased}
        .wrap{height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px}
        .dot{width:44px;height:44px;border-radius:50%;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px}
        @media (prefers-color-scheme: dark){html,body{background:#000;color:#fff}.dot{background:#fff;color:#000}}
      </style></head><body><div class="wrap"><div class="dot">${ok ? '✓' : '!'}</div><div>${ok ? 'Saved to Braintape' : 'Nothing to save'}</div></div>
      <script>
        setTimeout(function(){
          try{ window.close(); }catch(e){}
          try{ if(history.length>1) history.back(); }catch(e){}
        }, 350);
      </script>
      </body></html>`;

      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
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
        if (hit) return hit;
        // Last-resort offline fallback: any cached shell HTML.
        const shell = (await cache.match('/home')) || (await cache.match('/'));
        return shell || Response.error();
      }
    })());
  }
});

