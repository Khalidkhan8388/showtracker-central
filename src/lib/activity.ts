// Lightweight behavioral profile: tracks when the user actively opens the app
// so smart reminders can prefer times they're likely to be free & attentive.
//
// Everything stays in localStorage — no network, no sync.

const KEY = "braintape.activity.v1";
const MAX_SAMPLES = 500;

type Ping = { t: number }; // epoch ms

type Store = { pings: Ping[] };

function load(): Store {
  if (typeof window === "undefined") return { pings: [] };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { pings: [] };
    const s = JSON.parse(raw) as Store;
    if (!s || !Array.isArray(s.pings)) return { pings: [] };
    return s;
  } catch {
    return { pings: [] };
  }
}

function save(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

/**
 * Record an app-open ping. Throttled to once per 30 minutes so a chatty
 * session doesn't over-weight one hour of the day.
 */
export function recordActivityPing() {
  if (typeof window === "undefined") return;
  const s = load();
  const now = Date.now();
  const last = s.pings[s.pings.length - 1]?.t ?? 0;
  if (now - last < 30 * 60 * 1000) return;
  s.pings.push({ t: now });
  if (s.pings.length > MAX_SAMPLES) s.pings.splice(0, s.pings.length - MAX_SAMPLES);
  save(s);
}

export type ActivityProfile = {
  /** Hours (0-23) the user is typically active, sorted ascending. */
  activeHours: number[];
  /** True when the user regularly opens the app on Sat/Sun. */
  activeWeekends: boolean;
  /** Best guess wake window [startHour, endHour] — used when we have no data. */
  wakeWindow: [number, number];
  /** Preferred hour for morning-style reminders (default 9). */
  morningHour: number;
  /** Preferred hour for evening-style reminders (default 20 / 8pm). */
  eveningHour: number;
  sampleCount: number;
};

const DEFAULT_PROFILE: ActivityProfile = {
  activeHours: [8, 9, 10, 12, 13, 17, 18, 19, 20, 21],
  activeWeekends: false,
  wakeWindow: [8, 22],
  morningHour: 9,
  eveningHour: 20,
  sampleCount: 0,
};

export function getActivityProfile(): ActivityProfile {
  const { pings } = load();
  if (pings.length < 5) return { ...DEFAULT_PROFILE, sampleCount: pings.length };

  const hours = new Array(24).fill(0) as number[];
  let weekend = 0;
  let weekday = 0;
  for (const p of pings) {
    const d = new Date(p.t);
    hours[d.getHours()] += 1;
    const dow = d.getDay();
    if (dow === 0 || dow === 6) weekend += 1;
    else weekday += 1;
  }

  const total = pings.length;
  const threshold = Math.max(1, total * 0.04);
  const active: number[] = [];
  for (let h = 0; h < 24; h++) if (hours[h] >= threshold) active.push(h);

  const wakeStart = active.length ? Math.min(...active) : 8;
  const wakeEnd = active.length ? Math.max(...active) + 1 : 22;

  // Pick strongest morning (5-11) and evening (17-22) hours if they exist.
  let morningHour = 9;
  let morningBest = 0;
  for (let h = 5; h <= 11; h++) if (hours[h] > morningBest) { morningBest = hours[h]; morningHour = h; }
  let eveningHour = 20;
  let eveningBest = 0;
  for (let h = 17; h <= 22; h++) if (hours[h] > eveningBest) { eveningBest = hours[h]; eveningHour = h; }

  return {
    activeHours: active,
    activeWeekends: weekend >= Math.max(2, weekday * 0.2),
    wakeWindow: [Math.min(wakeStart, 10), Math.max(wakeEnd, 20)],
    morningHour,
    eveningHour,
    sampleCount: total,
  };
}

/** Pick the next Date that lands inside the user's active window. */
export function nextActiveSlot(
  from: Date,
  profile: ActivityProfile,
  opts: { avoidWeekends?: boolean; preferHour?: number } = {},
): Date {
  const d = new Date(from);
  d.setSeconds(0, 0);
  const [wakeStart, wakeEnd] = profile.wakeWindow;
  const avoidWeekends = opts.avoidWeekends ?? !profile.activeWeekends;

  // If preferHour is set, aim for that specific hour today (or later).
  if (opts.preferHour != null) {
    const target = new Date(d);
    target.setHours(opts.preferHour, 0, 0, 0);
    if (target.getTime() <= d.getTime() + 5 * 60 * 1000) {
      target.setDate(target.getDate() + 1);
    }
    return bumpFromForbidden(target, wakeStart, wakeEnd, avoidWeekends, profile.morningHour);
  }

  // Otherwise: next moment inside the wake window.
  if (d.getHours() < wakeStart) {
    d.setHours(wakeStart, 0, 0, 0);
  } else if (d.getHours() >= wakeEnd) {
    d.setDate(d.getDate() + 1);
    d.setHours(wakeStart, 0, 0, 0);
  } else {
    // Round up to the next 15-minute mark for a natural-feeling time.
    const m = d.getMinutes();
    d.setMinutes(m + (15 - (m % 15)) % 15 || 15, 0, 0);
  }
  return bumpFromForbidden(d, wakeStart, wakeEnd, avoidWeekends, profile.morningHour);
}

function bumpFromForbidden(d: Date, wakeStart: number, wakeEnd: number, avoidWeekends: boolean, morningHour: number): Date {
  const out = new Date(d);
  for (let i = 0; i < 8; i++) {
    const dow = out.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const h = out.getHours();
    const nightly = h < wakeStart || h >= wakeEnd;
    if (!nightly && !(avoidWeekends && isWeekend)) return out;
    if (nightly) {
      if (h >= wakeEnd) {
        out.setDate(out.getDate() + 1);
        out.setHours(wakeStart, 0, 0, 0);
      } else {
        out.setHours(wakeStart, 0, 0, 0);
      }
    }
    if (avoidWeekends && (out.getDay() === 0 || out.getDay() === 6)) {
      // Jump to Monday morning.
      while (out.getDay() === 0 || out.getDay() === 6) {
        out.setDate(out.getDate() + 1);
      }
      out.setHours(morningHour, 0, 0, 0);
    }
  }
  return out;
}

/** Return a short English summary of the profile for an AI prompt. */
export function describeProfile(p: ActivityProfile): string {
  const active = p.activeHours.length
    ? p.activeHours.map((h) => `${h}:00`).join(", ")
    : "unknown";
  return [
    `Active hours (24h): ${active}.`,
    `Wake window: ${p.wakeWindow[0]}:00 – ${p.wakeWindow[1]}:00.`,
    `Weekends: ${p.activeWeekends ? "active" : "quiet"}.`,
    `Preferred morning hour: ${p.morningHour}. Preferred evening hour: ${p.eveningHour}.`,
    `Samples observed: ${p.sampleCount}.`,
  ].join(" ");
}
