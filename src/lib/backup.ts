// Local backup: export/import all Dexie data as a single JSON file.
// Blobs are base64-encoded so the file is self-contained and portable.

import {
  db,
  type LocalNote,
  type LocalBlob,
  type MetaRow,
  type LocalCollection,
  type LocalCollectionEntry,
} from "./local-db";

const BACKUP_VERSION = 2;

type SerializedBlob = {
  path: string;
  size: number;
  contentType: string;
  cachedAt: number;
  base64: string;
};

type BackupFile = {
  app: "braintape";
  version: number;
  exportedAt: string;
  notes: LocalNote[];
  photos: SerializedBlob[];
  audios: SerializedBlob[];
  meta: MetaRow[];
  collections?: LocalCollection[];
  collectionEntries?: LocalCollectionEntry[];
};


function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function serializeBlob(row: LocalBlob): Promise<SerializedBlob> {
  const buf = new Uint8Array(await row.blob.arrayBuffer());
  return {
    path: row.path,
    size: row.size,
    contentType: row.contentType,
    cachedAt: row.cachedAt,
    base64: bytesToBase64(buf),
  };
}

function deserializeBlob(s: SerializedBlob): LocalBlob {
  const bytes = base64ToBytes(s.base64);
  return {
    path: s.path,
    size: s.size,
    contentType: s.contentType,
    cachedAt: s.cachedAt,
    blob: new Blob([bytes.buffer as ArrayBuffer], { type: s.contentType }),
  };
}

export async function exportAll(): Promise<Blob> {
  const [notes, photos, audios, meta, collections, collectionEntries] = await Promise.all([
    db.notes.toArray(),
    db.photos.toArray(),
    db.audios.toArray(),
    db.meta.toArray(),
    db.collections.toArray(),
    db.collectionEntries.toArray(),
  ]);
  const payload: BackupFile = {
    app: "braintape",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    notes,
    photos: await Promise.all(photos.map(serializeBlob)),
    audios: await Promise.all(audios.map(serializeBlob)),
    meta,
    collections,
    collectionEntries,
  };
  return new Blob([JSON.stringify(payload)], { type: "application/json" });
}


export async function downloadExport(): Promise<void> {
  const blob = await exportAll();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.href = url;
  a.download = `braintape-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type ImportMode = "merge" | "replace";

export type ImportSummary = {
  notes: number;
  photos: number;
  audios: number;
  meta: number;
};

export async function importFromFile(
  file: File,
  mode: ImportMode
): Promise<ImportSummary> {
  const text = await file.text();
  let parsed: BackupFile;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("File isn't valid JSON.");
  }
  if (!parsed || parsed.app !== "braintape" || typeof parsed.version !== "number") {
    throw new Error("Not a Braintape backup file.");
  }
  if (parsed.version > BACKUP_VERSION) {
    throw new Error("Backup was made by a newer version of the app.");
  }

  const notes = Array.isArray(parsed.notes) ? parsed.notes : [];
  const photos = (Array.isArray(parsed.photos) ? parsed.photos : []).map(deserializeBlob);
  const audios = (Array.isArray(parsed.audios) ? parsed.audios : []).map(deserializeBlob);
  const meta = Array.isArray(parsed.meta) ? parsed.meta : [];
  const collections = Array.isArray(parsed.collections) ? parsed.collections : [];
  const collectionEntries = Array.isArray(parsed.collectionEntries) ? parsed.collectionEntries : [];

  await db.transaction(
    "rw",
    [db.notes, db.photos, db.audios, db.meta, db.collections, db.collectionEntries],
    async () => {

      if (mode === "replace") {
        await Promise.all([
          db.notes.clear(),
          db.photos.clear(),
          db.audios.clear(),
          db.meta.clear(),
          db.collections.clear(),
          db.collectionEntries.clear(),
        ]);
      }
      if (notes.length) await db.notes.bulkPut(notes);
      if (photos.length) await db.photos.bulkPut(photos);
      if (audios.length) await db.audios.bulkPut(audios);
      if (meta.length) await db.meta.bulkPut(meta);
      if (collections.length) await db.collections.bulkPut(collections);
      if (collectionEntries.length) await db.collectionEntries.bulkPut(collectionEntries);
    },
  );

  return {
    notes: notes.length,
    photos: photos.length,
    audios: audios.length,
    meta: meta.length,
  };
}

