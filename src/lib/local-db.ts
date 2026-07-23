import Dexie, { type Table } from "dexie";

export const LOCAL_UID = "local";

export type LocalTask = {
  id: string;
  text: string;
  done: boolean;
  pinned?: boolean;
  pending?: boolean;
};

export type LocalNote = {
  id: string;
  user_id: string;
  status: "recording" | "uploaded" | "transcribing" | "processing" | "ready" | "failed";
  heading: string | null;
  summary: string | null;
  transcript: string | null;
  tasks: LocalTask[];
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
  pinned: boolean;
  image_paths: string[];
  source_url: string | null;
  tags: string[];
  audio_path: string | null;
  error: string | null;
  deleted_at: string | null;
};

export type MetaRow = { key: string; value: string };

export type LocalBlob = {
  path: string;      // local path (primary key)
  blob: Blob;        // raw bytes
  size: number;      // bytes
  contentType: string;
  cachedAt: number;  // epoch ms — for LRU eviction
};

class BraintapeDB extends Dexie {
  notes!: Table<LocalNote, string>;
  meta!: Table<MetaRow, string>;
  photos!: Table<LocalBlob, string>;
  audios!: Table<LocalBlob, string>;

  constructor() {
    super("braintape");
    this.version(1).stores({
      notes: "id, user_id, created_at, updated_at, pinned, heading",
      meta: "key",
    });
    this.version(2).stores({
      notes: "id, user_id, created_at, updated_at, pinned, heading",
      meta: "key",
      photos: "path, cachedAt, size",
    });
    this.version(3).stores({
      notes: "id, user_id, created_at, updated_at, pinned, heading, deleted_at",
      meta: "key",
      photos: "path, cachedAt, size",
    });
    // v4: local audio blobs (fully local audio storage — no cloud).
    this.version(4).stores({
      notes: "id, user_id, created_at, updated_at, pinned, heading, deleted_at",
      meta: "key",
      photos: "path, cachedAt, size",
      audios: "path, cachedAt, size",
    });
  }
}


export const db = new BraintapeDB();

export function newNote(patch: Partial<LocalNote> = {}): LocalNote {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    user_id: LOCAL_UID,
    status: "ready",
    heading: null,
    summary: null,
    transcript: null,
    tasks: [],
    duration_seconds: null,
    created_at: now,
    updated_at: now,
    pinned: false,
    image_paths: [],
    source_url: null,
    tags: [],
    audio_path: null,
    error: null,
    deleted_at: null,
    ...patch,
  };
}
