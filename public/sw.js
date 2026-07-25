// Braintape service worker.
// - Accepts Web Share Target POSTs (text, url, images, audio) and stashes them
//   in IndexedDB so the app can turn them into notes silently.
// - Runtime caches static assets for fast reloads.

const CACHE = 'braintape-v8';
const DB_NAME = 'braintape-share';
const DB_VERSION = 3;
const STORE = 'inbox';
const SETTINGS = 'settings';
const RECENT_PREFIX = 'recent-share:';
const DEDUPE_WINDOW_MS = 2 * 60 * 1000;
const APP_SHELL = ['/', '/home', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/favicon.ico'];

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function normalizePart(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashText(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return hex(digest);
}

async function shareFingerprint(rec) {
  const fileParts = [];
  for (const f of rec.files || []) {
    let digest = `${f.name}:${f.type}:${f.buf?.byteLength || 0}`;
    try {
      digest = `${digest}:${hex(await crypto.subtle.digest('SHA-256', f.buf))}`;
    } catch {}
    fileParts.push(digest);
  }
  return hashText([
    normalizePart(rec.url),
    normalizePart(rec.text),
    normalizePart(rec.title),
    fileParts.join('|'),
  ].join('\n'));
}

async function putShare(rec) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, SETTINGS], 'readwrite');
    const inbox = tx.objectStore(STORE);
    const settings = tx.objectStore(SETTINGS);
    const key = `${RECENT_PREFIX}${rec.fingerprint}`;
    let added = false;

    const recent = settings.get(key);
    recent.onsuccess = () => {
      const last = Number(recent.result || 0);
      if (last && Date.now() - last < DEDUPE_WINDOW_MS) return;
      added = true;
      settings.put(Date.now(), key);
      inbox.add(rec);
    };
    recent.onerror = () => {
      added = true;
      settings.put(Date.now(), key);
      inbox.add(rec);
    };
    tx.oncomplete = () => resolve({ added });
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
  // can drain silently in the background, then respond with a tiny self-closing
  // page so the full app UI is not opened for every share.
  const isShareSink = url.pathname === '/share-sink' || url.pathname === '/share-sink/' || url.pathname === '/share' || url.pathname === '/share/';
  if (isShareSink && (req.method === 'POST' || req.method === 'GET')) {
    event.respondWith((async () => {
      let ok = false;
      let added = false;
      let hadPayload = false;
      if (req.method === 'POST') {
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

        const rec = {
          ts: Date.now(),
          url: String(form.get('url') || ''),
          text: String(form.get('text') || ''),
          title: String(form.get('title') || ''),
          files: fileRecords,
        };
        hadPayload = !!(rec.url.trim() || rec.text.trim() || rec.title.trim() || rec.files.length > 0);
        if (!hadPayload) throw new Error('empty share');

        rec.fingerprint = await shareFingerprint(rec);
        const saved = await putShare(rec);
        added = !!saved.added;
        ok = true;
      } catch (err) {
        ok = false;
      }
      } // end POST branch

      // Nudge any open Braintape client to drain the inbox in background.
      let hasClient = false;
      try {
        const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of wins) {
          if (new URL(c.url).origin === self.location.origin) {
            hasClient = true;
            if (added) c.postMessage({ type: 'braintape-share-received' });
          }
        }
      } catch {}

      // Background status via a native notification. This is the assurance that
      // the entry was captured; it is not a prompt to open the app.
      try {
        if (req.method === 'POST' && self.registration?.showNotification && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const title = ok ? (added ? 'Saved in Braintape' : 'Already saved') : 'Nothing to save';
          const body = ok
            ? (added ? 'Your entry was saved in the background.' : 'This share was already captured.')
            : 'The share had no text, link, image, or audio.';
          await self.registration.showNotification(
            title,
            {
              body,
              icon: '/icon-192.png',
              badge: '/icon-192.png',
              tag: 'braintape-share',
              silent: true,
              data: { url: '/home' },
            },
          );
        }
      } catch {}

      // Tiny self-closing blank page. Avoid booting the app UI; the notification
      // above gives the user save status.
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Braintape</title><style>
        html,body{margin:0;height:100%;background:transparent;color:transparent}
      </style></head><body><noscript>${ok ? 'Saved in Braintape' : 'Nothing to save'}</noscript>
      <script>
        setTimeout(function(){
          try{ window.close(); }catch(e){}
          try{ if(history.length>1) history.back(); }catch(e){}
        }, 80);
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

