import Dexie, { type Table } from "dexie";

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

export type LocalPhoto = {
  path: string;      // storage path (primary key)
  blob: Blob;        // raw bytes
  size: number;      // bytes
  contentType: string;
  cachedAt: number;  // epoch ms — for LRU eviction
};

class BraintapeDB extends Dexie {
  notes!: Table<LocalNote, string>;
  meta!: Table<MetaRow, string>;
  photos!: Table<LocalPhoto, string>;

  constructor() {
    super("braintape");
    this.version(1).stores({
      notes: "id, user_id, created_at, updated_at, pinned, heading",
      meta: "key",
    });
    // v2: add local photo blob cache so images load instantly and offline.
    this.version(2).stores({
      notes: "id, user_id, created_at, updated_at, pinned, heading",
      meta: "key",
      photos: "path, cachedAt, size",
    });
  }
}


export const db = new BraintapeDB();

export function normalizeRow(r: Record<string, unknown>): LocalNote {
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    status: (r.status as LocalNote["status"]) ?? "ready",
    heading: (r.heading as string | null) ?? null,
    summary: (r.summary as string | null) ?? null,
    transcript: (r.transcript as string | null) ?? null,
    tasks: Array.isArray(r.tasks) ? (r.tasks as LocalTask[]) : [],
    duration_seconds: (r.duration_seconds as number | null) ?? null,
    created_at: String(r.created_at ?? new Date().toISOString()),
    updated_at: String(r.updated_at ?? r.created_at ?? new Date().toISOString()),
    pinned: Boolean(r.pinned),
    image_paths: Array.isArray(r.image_paths) ? (r.image_paths as string[]) : [],
    source_url: (r.source_url as string | null) ?? null,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    audio_path: (r.audio_path as string | null) ?? null,
    error: (r.error as string | null) ?? null,
  };
}
