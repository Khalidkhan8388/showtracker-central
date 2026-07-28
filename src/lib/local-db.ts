import Dexie, { type Table } from "dexie";

export const LOCAL_UID = "local";

export type LocalTask = {
  id: string;
  text: string;
  done: boolean;
  pinned?: boolean;
  pending?: boolean;
  reminder_at?: string | null;
};

export type WatchStatus = "watchlist" | "watching" | "watched" | "dropped";

export type LocalMediaEpisode = {
  season_number: number;
  episode_number: number;
  name: string;
  overview: string;
  air_date: string | null;
  runtime: number | null;
  still_path: string | null;
};

export type LocalMediaSeason = {
  season_number: number;
  name: string;
  episode_count: number;
  air_date: string | null;
  poster_path: string | null;
  episodes: LocalMediaEpisode[];
};

export type LocalMedia = {
  type: "movie" | "tv";
  tmdb_id: number;
  imdb_id: string | null;
  title: string;
  tagline: string | null;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string | null;
  last_air_date?: string | null;
  runtime: number | null;
  genres: string[];
  vote_average: number | null;
  homepage: string | null;
  number_of_seasons?: number;
  number_of_episodes?: number;
  seasons?: LocalMediaSeason[];
  watch_status: WatchStatus | null;
  watched_at: string | null;
  // Set of "S{season}E{ep}" identifiers watched (tv only)
  watched_episodes: string[];
};

export type LocalYouTube = {
  video_id: string;
  canonical_url: string;
  title: string | null;
  channel_name: string | null;
  channel_url: string | null;
  channel_id: string | null;
  thumbnail_url: string | null;
  description: string | null;
  published_at: string | null;
  duration_seconds: number | null;
  view_count: number | null;
  keywords: string[];
  captions_available: boolean;
};

export type LocalInstagram = {
  shortcode: string;
  kind: "post" | "reel" | "tv";
  canonical_url: string;
  username: string | null;
  display_name: string | null;
  caption: string | null;
  like_count: number | null;
  comment_count: number | null;
  posted_at: string | null;
  is_video: boolean;
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
  audio_paths?: string[] | null;
  key_points?: string[] | null;
  error: string | null;
  deleted_at: string | null;
  media?: LocalMedia | null;
  youtube?: LocalYouTube | null;
  reminder_at?: string | null;
  reminders?: string[];
  hidden_episode_reminders?: string[];
  ocr_text?: string | null;
  ocr_hidden?: boolean;
  reminder_suggestion_dismissed?: boolean;
  action_suggestion_dismissed?: boolean;
  reminder_titles?: Record<string, string>;
  /** Contextual reminders — fire based on behavior rather than a fixed time.
   *  Supported ids: "next-open" (fires on next app open during active hours). */
  contextual_reminders?: string[];
  /** Metadata for contextual reminders (title + creation time), keyed by id above. */
  contextual_meta?: Record<string, { title: string; created_at: string }>;




};


export type MetaRow = { key: string; value: string };

export type LocalBlob = {
  path: string;      // local path (primary key)
  blob: Blob;        // raw bytes
  size: number;      // bytes
  contentType: string;
  cachedAt: number;  // epoch ms — for LRU eviction
};

export type LocalCollection = {
  id: string;
  title: string;
  note_ids: string[];
  created_at: string;
  updated_at: string;
};

class BraintapeDB extends Dexie {
  notes!: Table<LocalNote, string>;
  meta!: Table<MetaRow, string>;
  photos!: Table<LocalBlob, string>;
  audios!: Table<LocalBlob, string>;
  collections!: Table<LocalCollection, string>;

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
    // v5: collections — group notes together (many-to-many).
    this.version(5).stores({
      notes: "id, user_id, created_at, updated_at, pinned, heading, deleted_at",
      meta: "key",
      photos: "path, cachedAt, size",
      audios: "path, cachedAt, size",
      collections: "id, title, created_at, updated_at",
    });
    // v6: add optional `media` payload on notes (movies / TV shows via TMDB).
    // No new index — schema string only changes if we add one, so keep identical.
    this.version(6).stores({
      notes: "id, user_id, created_at, updated_at, pinned, heading, deleted_at",
      meta: "key",
      photos: "path, cachedAt, size",
      audios: "path, cachedAt, size",
      collections: "id, title, created_at, updated_at",
    });
    // v7: add reminder_at + hidden_episode_reminders. Same schema string; index unchanged.
    this.version(7).stores({
      notes: "id, user_id, created_at, updated_at, pinned, heading, deleted_at",
      meta: "key",
      photos: "path, cachedAt, size",
      audios: "path, cachedAt, size",
      collections: "id, title, created_at, updated_at",
    });
    // v8: add audio_paths (multi-clip voice notes) + key_points. No new index.
    this.version(8).stores({
      notes: "id, user_id, created_at, updated_at, pinned, heading, deleted_at",
      meta: "key",
      photos: "path, cachedAt, size",
      audios: "path, cachedAt, size",
      collections: "id, title, created_at, updated_at",
    });
    // v9: add ocr_text (OCR result for image notes). No new index.
    this.version(9).stores({
      notes: "id, user_id, created_at, updated_at, pinned, heading, deleted_at",
      meta: "key",
      photos: "path, cachedAt, size",
      audios: "path, cachedAt, size",
      collections: "id, title, created_at, updated_at",
    });
    // v10: multiple reminders per note (reminders: string[]). No new index.
    this.version(10).stores({
      notes: "id, user_id, created_at, updated_at, pinned, heading, deleted_at",
      meta: "key",
      photos: "path, cachedAt, size",
      audios: "path, cachedAt, size",
      collections: "id, title, created_at, updated_at",
    }).upgrade(async (tx) => {
      await tx.table("notes").toCollection().modify((n: any) => {
        if (!Array.isArray(n.reminders)) {
          n.reminders = n.reminder_at ? [n.reminder_at] : [];
        }
      });
    });
    // v11: optional YouTube payload on link notes. No new index.
    this.version(11).stores({
      notes: "id, user_id, created_at, updated_at, pinned, heading, deleted_at",
      meta: "key",
      photos: "path, cachedAt, size",
      audios: "path, cachedAt, size",
      collections: "id, title, created_at, updated_at",
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
