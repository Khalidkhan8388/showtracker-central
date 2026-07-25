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
  const cleanTitle = (title || "").trim();
  if (cleanTitle) {
    const map = { ...(n?.reminder_titles ?? {}) };
    map[iso] = cleanTitle;
    await patchLocalNote(noteId, { reminder_titles: map });
  }
  // Mirror the reminder as a trackable task so completion can be checked off.
  const fresh = await db.notes.get(noteId);
  if (fresh) {
    const tasks = fresh.tasks ?? [];
    if (!tasks.some((t) => t.reminder_at === iso)) {
      const text =
        cleanTitle ||
        (fresh.reminder_titles && fresh.reminder_titles[iso]) ||
        fresh.heading ||
        "Reminder";
      const newTask = {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        text,
        done: false,
        reminder_at: iso,
      };
      await patchLocalNote(noteId, { tasks: [...tasks, newTask] });
    }
  }
}


export async function removeNoteReminder(noteId: string, iso: string) {
  const n = await db.notes.get(noteId);
  if (!n) return;
  const current = getNoteReminders(n).filter((x) => x !== iso);
  await writeReminders(noteId, current);
  // Drop the mirrored task if it hasn't been completed yet.
  const tasks = (n.tasks ?? []).filter((t) => !(t.reminder_at === iso && !t.done));
  if (tasks.length !== (n.tasks ?? []).length) {
    await patchLocalNote(noteId, { tasks });
  }
}

export async function clearNoteReminders(noteId: string) {
  const n = await db.notes.get(noteId);
  const tasks = (n?.tasks ?? []).filter((t) => !(t.reminder_at && !t.done));
  await patchLocalNote(noteId, { reminders: [], reminder_at: null, tasks });
}

/** Legacy single-set (used by suggestion chip / hero) — appends. */
export async function setNoteReminder(noteId: string, iso: string | null) {
  if (iso == null) return clearNoteReminders(noteId);
  return addNoteReminder(noteId, iso);
}

// ---- contextual reminders (behavior-based, no fixed time) ----------------

/** Add a contextual reminder like "next-open" — fires on next app open in active hours. */
export async function addContextualReminder(noteId: string, id: string, title: string) {
  const n = await db.notes.get(noteId);
  const list = Array.from(new Set([...(n?.contextual_reminders ?? []), id]));
  const meta = { ...(n?.contextual_meta ?? {}) };
  meta[id] = { title: (title || "Reminder").trim(), created_at: new Date().toISOString() };
  await patchLocalNote(noteId, {
    contextual_reminders: list,
    contextual_meta: meta,
    reminder_suggestion_dismissed: false,
  });
}

export async function removeContextualReminder(noteId: string, id: string) {
  const n = await db.notes.get(noteId);
  if (!n) return;
  const list = (n.contextual_reminders ?? []).filter((x) => x !== id);
  const meta = { ...(n.contextual_meta ?? {}) };
  delete meta[id];
  await patchLocalNote(noteId, { contextual_reminders: list, contextual_meta: meta });
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

/** Fire pending contextual reminders that are due based on user activity. */
async function fireContextualReminders(now: Date) {
  const { getActivityProfile } = await import("./activity");
  const profile = getActivityProfile();
  const h = now.getHours();
  const [wakeStart, wakeEnd] = profile.wakeWindow;
  // Only fire during the user's active window.
  if (h < Math.max(8, wakeStart) || h >= wakeEnd) return;

  const notes = (await db.notes.toArray()).filter(
    (n) => !n.deleted_at && (n.contextual_reminders?.length ?? 0) > 0,
  );
  for (const n of notes) {
    for (const id of n.contextual_reminders ?? []) {
      if (id !== "next-open") continue;
      const key = `ctx:${n.id}:${id}`;
      if (shown.has(key)) continue;
      const meta = n.contextual_meta?.[id];
      const title = meta?.title || n.heading || "Reminder";
      try {
        const reg = await navigator.serviceWorker?.ready;
        if (reg) {
          await reg.showNotification(title, {
            body: "You opened the app — here's what you saved.",
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            tag: key,
            data: { noteId: n.id },
          });
        } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(title, { body: "You opened the app — here's what you saved.", icon: "/icon-192.png", tag: key });
        }
        shown.add(key);
        persistShown();
      } catch {}
      // Auto-consume so it doesn't nag on every future open.
      await removeContextualReminder(n.id, id);
    }
  }
}

let started = false;
export function startReminderScheduler() {
  if (started || typeof window === "undefined") return;
  started = true;
  loadShown();
  // Record this app open for the behavioral profile.
  void import("./activity").then((m) => m.recordActivityPing());
  const tick = async () => {
    try {
      const notes = (await db.notes.toArray()).filter((n) => !n.deleted_at);
      const now = new Date();
      const rs = deriveReminders(notes, now);
      for (const r of rs) {
        const due = new Date(r.when).getTime() <= now.getTime();
        if (due) void fireNotification(r);
      }
      void fireContextualReminders(now);
    } catch {}
  };
  void tick();
  setInterval(tick, 60_000); // every minute
}

