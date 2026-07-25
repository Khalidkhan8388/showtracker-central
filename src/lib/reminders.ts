// Reminders: derive upcoming reminders from local notes + media episodes,
// plus scheduling helpers for local Web Notifications.

import { useLiveQuery } from "dexie-react-hooks";
import { db, type LocalNote, type LocalMedia } from "./local-db";
import { epKey, poster, toggleEpisodeWatched, setWatchStatus } from "./media";
import { patchLocalNote } from "./sync-engine";

export type EpisodeReminder = {
  kind: "episode";
  id: string; // stable dismissal key: `${noteId}:${epKey}`
  noteId: string;
  when: string; // ISO air_date
  overdue: boolean;
  seriesTitle: string;
  posterUrl: string | null;
  season: number;
  episode: number;
  epName: string;
  epKey: string; // S{n}E{n}
};

export type MovieReminder = {
  kind: "movie";
  id: string;
  noteId: string;
  when: string;
  overdue: boolean;
  title: string;
  posterUrl: string | null;
};

export type NoteReminder = {
  kind: "note";
  id: string; // `${noteId}:${iso}`
  noteId: string;
  when: string;
  overdue: boolean;
  title: string;
  summary: string | null;
  taskCount: number;
};

export type Reminder = EpisodeReminder | MovieReminder | NoteReminder;

/** Read a note's reminders as a sorted, deduped array (merges legacy reminder_at). */
export function getNoteReminders(n: { reminders?: string[] | null; reminder_at?: string | null }): string[] {
  const set = new Set<string>();
  for (const r of n.reminders ?? []) if (r) set.add(r);
  if (n.reminder_at) set.add(n.reminder_at);
  return Array.from(set).sort();
}


const DAY = 24 * 60 * 60 * 1000;

function nextUnwatchedEpisode(media: LocalMedia): { season: number; episode: number; name: string; airDate: string } | null {
  if (media.type !== "tv" || !media.seasons?.length) return null;
  const watched = new Set(media.watched_episodes);
  for (const s of media.seasons) {
    if (s.season_number === 0) continue; // skip specials
    for (const ep of s.episodes) {
      const k = epKey(s.season_number, ep.episode_number);
      if (watched.has(k)) continue;
      if (!ep.air_date) return null;
      return {
        season: s.season_number,
        episode: ep.episode_number,
        name: ep.name || `Episode ${ep.episode_number}`,
        airDate: ep.air_date,
      };
    }
  }
  return null;
}

export function deriveReminders(notes: LocalNote[], now: Date = new Date()): Reminder[] {
  const out: Reminder[] = [];
  const nowMs = now.getTime();
  const soonMs = nowMs + DAY; // upcoming within 24h
  const pastMs = nowMs - 30 * DAY; // recently released, still relevant

  for (const n of notes) {
    if (n.deleted_at) continue;
    const hidden = new Set(n.hidden_episode_reminders ?? []);

    // Media reminders (auto)
    if (n.media) {
      const m = n.media;
      if (m.watch_status !== "dropped" && m.watch_status !== "watched") {
        if (m.type === "tv") {
          const ep = nextUnwatchedEpisode(m);
          if (ep && !hidden.has(ep.airDate + ":" + epKey(ep.season, ep.episode))) {
            const t = new Date(ep.airDate).getTime();
            if (!isNaN(t) && t >= pastMs && t <= soonMs) {
              out.push({
                kind: "episode",
                id: `${n.id}:${epKey(ep.season, ep.episode)}`,
                noteId: n.id,
                when: ep.airDate,
                overdue: t <= nowMs,
                seriesTitle: m.title,
                posterUrl: poster(m.poster_path, "w342"),
                season: ep.season,
                episode: ep.episode,
                epName: ep.name,
                epKey: epKey(ep.season, ep.episode),
              });
            }
          }
        } else if (m.type === "movie" && m.release_date) {
          const t = new Date(m.release_date).getTime();
          const key = `release:${m.release_date}`;
          if (!hidden.has(key) && !isNaN(t) && t >= pastMs && t <= soonMs) {
            out.push({
              kind: "movie",
              id: `${n.id}:${key}`,
              noteId: n.id,
              when: m.release_date,
              overdue: t <= nowMs,
              title: m.title,
              posterUrl: poster(m.poster_path, "w342"),
            });
          }
        }
      }
    }

    // User-set note reminders (multi)
    const isos = getNoteReminders(n);
    for (const iso of isos) {
      const t = new Date(iso).getTime();
      if (!isNaN(t) && t <= nowMs + 7 * DAY) {
        out.push({
          kind: "note",
          id: `${n.id}:${iso}`,
          noteId: n.id,
          when: iso,
          overdue: t <= nowMs,
          title: (n.reminder_titles && n.reminder_titles[iso]) || n.heading || "Reminder",
          summary: n.summary,
          taskCount: (n.tasks ?? []).length,
        });
      }
    }
  }

  // Overdue first, then soonest.
  out.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return new Date(a.when).getTime() - new Date(b.when).getTime();
  });
  return out;
}

export function useReminders(): Reminder[] {
  const notes = useLiveQuery(async () => (await db.notes.toArray()).filter((n) => !n.deleted_at), []);
  return notes ? deriveReminders(notes) : [];
}

// ---- actions ----
async function writeReminders(noteId: string, isos: string[]) {
  const uniq = Array.from(new Set(isos.filter(Boolean))).sort();
  await patchLocalNote(noteId, {
    reminders: uniq,
    reminder_at: uniq[0] ?? null,
    reminder_suggestion_dismissed: false,
  });
}

export async function addNoteReminder(noteId: string, iso: string, title?: string) {
  const n = await db.notes.get(noteId);
  const current = n ? getNoteReminders(n) : [];
  await writeReminders(noteId, [...current, iso]);
  if (title && title.trim()) {
    const map = { ...(n?.reminder_titles ?? {}) };
    map[iso] = title.trim();
    await patchLocalNote(noteId, { reminder_titles: map });
  }
}


export async function removeNoteReminder(noteId: string, iso: string) {
  const n = await db.notes.get(noteId);
  if (!n) return;
  const current = getNoteReminders(n).filter((x) => x !== iso);
  await writeReminders(noteId, current);
}

export async function clearNoteReminders(noteId: string) {
  await patchLocalNote(noteId, { reminders: [], reminder_at: null });
}

/** Legacy single-set (used by suggestion chip / hero) — appends. */
export async function setNoteReminder(noteId: string, iso: string | null) {
  if (iso == null) return clearNoteReminders(noteId);
  return addNoteReminder(noteId, iso);
}

export async function dismissEpisodeReminder(noteId: string, key: string) {

  const n = await db.notes.get(noteId);
  if (!n) return;
  const next = Array.from(new Set([...(n.hidden_episode_reminders ?? []), key]));
  await patchLocalNote(noteId, { hidden_episode_reminders: next });
}

export async function markEpisodeWatchedAndClear(noteId: string, season: number, episode: number) {
  await toggleEpisodeWatched(noteId, season, episode, true);
}

export async function markMovieWatched(noteId: string) {
  await setWatchStatus(noteId, "watched");
}

// ---- notifications ----
const shown = new Set<string>();
const SHOWN_KEY = "braintape.reminders.shown";
function loadShown() {
  try {
    const raw = localStorage.getItem(SHOWN_KEY);
    if (raw) JSON.parse(raw).forEach((k: string) => shown.add(k));
  } catch {}
}
function persistShown() {
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify(Array.from(shown).slice(-200)));
  } catch {}
}

async function fireNotification(r: Reminder) {
  const key = `${r.id}@${r.when}`;
  if (shown.has(key)) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const title =
    r.kind === "episode"
      ? `${r.seriesTitle} · S${r.season}E${r.episode}`
      : r.kind === "movie"
        ? `${r.title} out today`
        : r.title;
  const body =
    r.kind === "episode"
      ? r.epName
      : r.kind === "movie"
        ? "New movie released"
        : r.summary || "Reminder";
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg) {
      await reg.showNotification(title, {
        body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: r.id,
        data: { noteId: r.noteId },
      });
    } else {
      new Notification(title, { body, icon: "/icon-192.png", tag: r.id });
    }
    shown.add(key);
    persistShown();
  } catch {}
}

let started = false;
export function startReminderScheduler() {
  if (started || typeof window === "undefined") return;
  started = true;
  loadShown();
  const tick = async () => {
    try {
      const notes = (await db.notes.toArray()).filter((n) => !n.deleted_at);
      const now = new Date();
      const rs = deriveReminders(notes, now);
      for (const r of rs) {
        const due = new Date(r.when).getTime() <= now.getTime();
        if (due) void fireNotification(r);
      }
    } catch {}
  };
  void tick();
  setInterval(tick, 60_000); // every minute
}
