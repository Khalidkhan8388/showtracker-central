// Client-side reader for the Web Share Target inbox the service worker fills.
// Keep this dependency-free (raw IndexedDB) so it can't drift from sw.js.

const DB_NAME = "braintape-share";
const STORE = "inbox";

export type SharedFile = { name: string; type: string; buf: ArrayBuffer };
export type SharedItem = {
  id: number;
  ts: number;
  url: string;
  text: string;
  title: string;
  files: SharedFile[];
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function drainSharedItems(): Promise<SharedItem[]> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return [];
  }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = (req.result as SharedItem[]) ?? [];
      store.clear();
      tx.oncomplete = () => resolve(items);
      tx.onerror = () => resolve(items);
    };
    req.onerror = () => resolve([]);
  });
}
