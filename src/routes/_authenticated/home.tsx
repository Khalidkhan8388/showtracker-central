import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Recorder } from "@/components/Recorder";
import { LogOut, CheckCircle2, Loader2, AlertCircle, Mic, Circle, Trash2, X, Check, ChevronRight, Pin, Link2, Image as ImageIcon, Search, Sparkles, Settings, AudioLines, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useServerFn } from "@tanstack/react-start";
import { toggleTask, deleteNotes, deleteTasks, pinNote } from "@/lib/notes.functions";
import { Markdown } from "@/components/Markdown";

export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({
    meta: [
      { title: "Home — Braintape" },
      { name: "description", content: "Your voice-first second brain." },
    ],
  }),
  component: Home,
});

type Note = {
  id: string;
  status: "recording" | "uploaded" | "transcribing" | "processing" | "ready" | "failed";
  heading: string | null;
  summary: string | null;
  tasks: Array<{ id: string; text: string; done: boolean; pinned?: boolean; pending?: boolean }> | null;
  duration_seconds: number | null;
  created_at: string;
  pinned: boolean;
  image_paths: string[] | null;
  source_url: string | null;
  transcript: string | null;
};

type TaskKey = string; // `${noteId}::${taskId}`

function Home() {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());
  const [selectedTasks, setSelectedTasks] = useState<Set<TaskKey>>(new Set());
  const toggleFn = useServerFn(toggleTask);
  const delNotesFn = useServerFn(deleteNotes);
  const delTasksFn = useServerFn(deleteTasks);
  const pinNoteFn = useServerFn(pinNote);
  const navigate = useNavigate();

  const noteSelectMode = selectedNotes.size > 0;
  const taskSelectMode = selectedTasks.size > 0;

  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const onScroll = () => setCollapsed(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);


  async function onToggle(noteId: string, taskId: string) {
    setNotes((prev) =>
      prev
        ? prev.map((n) =>
            n.id === noteId
              ? { ...n, tasks: (n.tasks ?? []).map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)) }
              : n,
          )
        : prev,
    );
    try {
      await toggleFn({ data: { noteId, taskId } });
    } catch {
      load();
    }
  }

  // Sign only images we haven't signed yet — cache is keyed by storage path so
  // task/pin updates don't churn signed URLs.
  const signedCacheRef = useRef<Map<string, string>>(new Map());
  const signInFlightRef = useRef<Set<string>>(new Set());
  const signThumbsFor = useCallback((rows: Note[]) => {
    const toSign: Array<{ id: string; path: string }> = [];
    for (const n of rows) {
      const p = Array.isArray(n.image_paths) ? n.image_paths[0] : null;
      if (!p) continue;
      const cached = signedCacheRef.current.get(p);
      if (cached) {
        setThumbs((cur) => (cur[n.id] === cached ? cur : { ...cur, [n.id]: cached }));
        continue;
      }
      if (signInFlightRef.current.has(p)) continue;
      signInFlightRef.current.add(p);
      toSign.push({ id: n.id, path: p });
    }
    if (toSign.length === 0) return;
    Promise.all(
      toSign.map(async ({ id, path }) => {
        const { data: s } = await supabase.storage
          .from("voice-notes")
          .createSignedUrl(path, 3600);
        return { id, path, url: s?.signedUrl ?? "" };
      }),
    ).then((pairs) => {
      setThumbs((cur) => {
        const next = { ...cur };
        for (const { id, path, url } of pairs) {
          signInFlightRef.current.delete(path);
          if (url) {
            signedCacheRef.current.set(path, url);
            next[id] = url;
          }
        }
        return next;
      });
    });
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("voice_notes")
      .select("id,status,heading,summary,tasks,duration_seconds,created_at,pinned,image_paths,source_url,transcript")
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as Note[];
    setNotes(rows);
    signThumbsFor(rows);
  }, [signThumbsFor]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("voice_notes_home")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "voice_notes" },
        (payload) => {
          const event = payload.eventType;
          if (event === "INSERT") {
            const row = payload.new as Note;
            setNotes((prev) => (prev ? [row, ...prev.filter((n) => n.id !== row.id)] : [row]));
            signThumbsFor([row]);
          } else if (event === "UPDATE") {
            const row = payload.new as Note;
            setNotes((prev) => (prev ? prev.map((n) => (n.id === row.id ? row : n)) : prev));
            signThumbsFor([row]);
          } else if (event === "DELETE") {
            const oldRow = payload.old as { id?: string };
            if (oldRow?.id) {
              setNotes((prev) => (prev ? prev.filter((n) => n.id !== oldRow.id) : prev));
            }
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, signThumbsFor]);

  async function signOut() {
    await supabase.auth.signOut();
  }

  function toggleNoteSel(id: string) {
    setSelectedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleTaskSel(key: TaskKey) {
    setSelectedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function confirmDeleteNotes() {
    const ids = Array.from(selectedNotes);
    if (ids.length === 0) return;
    setNotes((prev) => (prev ? prev.filter((n) => !selectedNotes.has(n.id)) : prev));
    setSelectedNotes(new Set());
    try {
      await delNotesFn({ data: { noteIds: ids } });
    } catch {
      load();
    }
  }

  async function confirmDeleteTasks() {
    const items = Array.from(selectedTasks).map((k) => {
      const [noteId, taskId] = k.split("::");
      return { noteId, taskId };
    });
    if (items.length === 0) return;
    const keys = new Set(selectedTasks);
    setNotes((prev) =>
      prev
        ? prev.map((n) => ({
            ...n,
            tasks: (n.tasks ?? []).filter((t) => !keys.has(`${n.id}::${t.id}`)),
          }))
        : prev,
    );
    setSelectedTasks(new Set());
    try {
      await delTasksFn({ data: { tasks: items } });
    } catch {
      load();
    }
  }

  async function togglePinSelected() {
    const ids = Array.from(selectedNotes);
    if (ids.length === 0 || !notes) return;
    // If any selected is unpinned, pin all; otherwise unpin all.
    const anyUnpinned = notes.some((n) => selectedNotes.has(n.id) && !n.pinned);
    const nextPinned = anyUnpinned;
    setNotes((prev) =>
      prev ? prev.map((n) => (selectedNotes.has(n.id) ? { ...n, pinned: nextPinned } : n)) : prev,
    );
    setSelectedNotes(new Set());
    try {
      await Promise.all(ids.map((noteId) => pinNoteFn({ data: { noteId, pinned: nextPinned } })));
    } catch {
      load();
    }
  }

  const selectMode = noteSelectMode || taskSelectMode;

  // Memoized derivations — only recompute when notes actually change.
  const derived = useMemo(() => {
    if (!notes) return null;
    const displayNotes = notes.filter((n) => n.heading !== "__custom__");
    const [latest, ...rest] = displayNotes;
    const pinnedRest = rest.filter((n) => n.pinned);
    const unpinnedRest = rest.filter((n) => !n.pinned);
    const stripIds = new Set<string>();
    const strip: Note[] = [];
    for (const n of [...pinnedRest, ...unpinnedRest.slice(0, 5)]) {
      if (!stripIds.has(n.id)) {
        stripIds.add(n.id);
        strip.push(n);
      }
    }
    const grid = unpinnedRest.slice(5);

    const allTasksRaw = notes.flatMap((n) =>
      (n.tasks ?? []).map((t) => ({
        ...t,
        noteId: n.id,
        noteHeading: n.heading === "__custom__" ? null : n.heading,
      })),
    );
    const suggested = allTasksRaw.filter((t) => t.pending);
    const allTasks = allTasksRaw.filter((t) => !t.pending);
    const pinnedT = allTasks.filter((t) => t.pinned && !t.done);
    const openT = allTasks.filter((t) => !t.pinned && !t.done);
    const doneT = allTasks.filter((t) => t.done);
    const visible = [...pinnedT, ...openT, ...doneT].slice(0, 3);

    return {
      displayNotes,
      latest,
      strip,
      grid,
      suggested,
      allTasks,
      visible,
      doneCount: doneT.length,
      hasAnyContent: displayNotes.length > 0 || allTasks.length > 0,
    };
  }, [notes]);


  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-white">
      {/* Space-style minimal header */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3">
          <h1 className="font-serif text-[32px] leading-none tracking-tight text-foreground">
            Braintape
          </h1>
          <button
            onClick={signOut}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground/70 active:opacity-60"
            aria-label="Settings"
          >
            <Settings className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <section className="flex-1 px-5 pb-32 pt-1">
        {notes === null ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !derived || !derived.hasAnyContent ? (
          <div className="rounded-[28px] bg-[#EFECE4] px-6 py-14 text-center">
            <p className="font-serif text-[22px] leading-snug text-foreground">
              Your second brain is quiet.
            </p>
            <p className="mt-2 text-[13px] text-foreground/60">Tap the mic and start talking.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {derived.latest && (
              <NoteCard
                note={derived.latest}
                variant="hero"
                thumbUrl={thumbs[derived.latest.id]}
                selected={selectedNotes.has(derived.latest.id)}
                selectMode={noteSelectMode}
                onOpen={() => navigate({ to: "/notes/$id", params: { id: derived.latest.id } })}
                onLongPress={() => toggleNoteSel(derived.latest.id)}
                onToggleSel={() => toggleNoteSel(derived.latest.id)}
              />
            )}

            {derived.suggested.length > 0 && (
              <Link
                to="/tasks/review"
                className="flex items-center justify-between rounded-full bg-foreground px-5 py-3 active:opacity-80"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-background" />
                  <span className="text-[14px] font-medium text-background">
                    {derived.suggested.length} suggested task{derived.suggested.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ChevronRight className="h-4 w-4 text-background/70" />
              </Link>
            )}

            {derived.strip.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {derived.strip.slice(0, 4).map((n) => (
                  <NoteCard
                    key={n.id}
                    note={n}
                    variant="masonry"
                    thumbUrl={thumbs[n.id]}
                    selected={selectedNotes.has(n.id)}
                    selectMode={noteSelectMode}
                    onOpen={() => navigate({ to: "/notes/$id", params: { id: n.id } })}
                    onLongPress={() => toggleNoteSel(n.id)}
                    onToggleSel={() => toggleNoteSel(n.id)}
                  />
                ))}
              </div>
            )}

            {(derived.visible.length > 0 || derived.allTasks.length > 0) && (
              <div className="space-y-2">
                <Link
                  to="/tasks"
                  className="flex items-center justify-between px-1 py-1 active:opacity-60"
                >
                  <span className="text-[17px] font-semibold text-foreground">Upcoming</span>
                  <div className="flex items-center gap-1 text-foreground/40">
                    <span className="text-[13px] tabular-nums">{derived.doneCount}/{derived.allTasks.length}</span>
                    <ChevronRight className="h-4 w-4" strokeWidth={2} />
                  </div>
                </Link>
                {derived.visible.length === 0 ? (
                  <Link
                    to="/tasks"
                    className="block rounded-2xl bg-[#1c1c1e] py-3 text-center text-[14px] text-white/70 active:opacity-70"
                  >
                    + Add a task
                  </Link>
                ) : (
                  <ul className="space-y-1.5">
                    {derived.visible.map((t) => {
                      const key: TaskKey = `${t.noteId}::${t.id}`;
                      const isSel = selectedTasks.has(key);
                      return (
                        <li key={key}>
                          <TaskRow
                            selectMode={taskSelectMode}
                            selected={isSel}
                            done={t.done}
                            pinned={Boolean(t.pinned)}
                            text={t.text}
                            noteHeading={t.noteHeading}
                            noteId={t.noteId}
                            onToggleDone={() => onToggle(t.noteId, t.id)}
                            onLongPress={() => toggleTaskSel(key)}
                            onSelectTap={() => toggleTaskSel(key)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {derived.grid.length > 0 && (
              <div className="space-y-3">
                <h2 className="px-1 text-[17px] font-semibold text-foreground">Memory</h2>
                <div className="grid grid-cols-2 gap-3">
                  {derived.grid.map((n) => (
                    <NoteCard
                      key={n.id}
                      note={n}
                      variant="masonry"
                      thumbUrl={thumbs[n.id]}
                      selected={selectedNotes.has(n.id)}
                      selectMode={noteSelectMode}
                      onOpen={() => navigate({ to: "/notes/$id", params: { id: n.id } })}
                      onLongPress={() => toggleNoteSel(n.id)}
                      onToggleSel={() => toggleNoteSel(n.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>




      {selectMode ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-10 z-40 flex justify-center gap-2 px-5">
          <button
            onClick={() => {
              setSelectedNotes(new Set());
              setSelectedTasks(new Set());
            }}
            aria-label="Cancel selection"
            className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-foreground/80 text-background shadow-lg ring-1 ring-black/10 backdrop-blur-xl backdrop-saturate-150"
          >
            <X className="h-4 w-4" />
          </button>
          {noteSelectMode && (
            <button
              onClick={togglePinSelected}
              className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-foreground/85 px-4 py-2 text-xs font-semibold text-background shadow-lg ring-1 ring-black/10 backdrop-blur-xl backdrop-saturate-150"
            >
              <Pin className="h-3.5 w-3.5" />
              Pin
            </button>
          )}
          <button
            onClick={noteSelectMode ? confirmDeleteNotes : confirmDeleteTasks}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-destructive/85 px-4 py-2 text-xs font-semibold text-destructive-foreground shadow-lg ring-1 ring-destructive/20 backdrop-blur-xl backdrop-saturate-150"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      ) : (
        <Recorder onNoteReady={load} />
      )}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 px-1 text-[13px] font-normal uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}


function useLongPress(onLongPress: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggered = useRef(false);
  const start = () => {
    triggered.current = false;
    timer.current = setTimeout(() => {
      triggered.current = true;
      onLongPress();
    }, ms);
  };
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    handlers: {
      onPointerDown: start,
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
    wasLongPress: () => triggered.current,
  };
}

const NoteCard = memo(function NoteCard({
  note,
  variant,
  fullWidth,
  thumbUrl,
  selected,
  selectMode,
  onOpen,
  onLongPress,
  onToggleSel,
}: {
  note: Note;
  variant: "wide" | "square" | "hero" | "masonry";
  fullWidth?: boolean;
  thumbUrl?: string;
  selected: boolean;
  selectMode: boolean;
  onOpen: () => void;
  onLongPress: () => void;
  onToggleSel: () => void;
}) {
  const lp = useLongPress(onLongPress);
  const handleClick = (e: React.MouseEvent) => {
    if (lp.wasLongPress()) {
      e.preventDefault();
      return;
    }
    if (selectMode) {
      e.preventDefault();
      onToggleSel();
      return;
    }
    onOpen();
  };

  const imageCount = Array.isArray(note.image_paths) ? note.image_paths.length : 0;
  const hasImage = imageCount > 0 && !!thumbUrl;
  const isVoice = note.duration_seconds != null;
  // A "text note" is user-authored (has transcript/body) and not a voice recording.
  // Text notes may optionally include a source_url or images; still render as text.
  const isText = !isVoice && note.transcript != null;
  const isLink = !!note.source_url && !isText;
  const linkHost = (() => {
    if (!note.source_url) return null;
    try { return new URL(note.source_url).hostname.replace(/^www\./, ""); } catch { return null; }
  })();

  // MyMind-style soft tinted palette for text notes — deterministic per note
  const mymindTints = [
    "#FFF4E0", // cream
    "#E8F1E4", // sage
    "#E4EEF7", // sky
    "#F3E8F0", // blush
    "#F6EFE1", // sand
    "#EAEBF6", // lilac
    "#FBE9E2", // peach
  ];
  const tintIdx = (() => {
    let h = 0;
    for (let i = 0; i < note.id.length; i++) h = (h * 31 + note.id.charCodeAt(i)) >>> 0;
    return h % mymindTints.length;
  })();
  const textTint = mymindTints[tintIdx];

  const isHero = variant === "hero";
  const isMasonry = variant === "masonry";
  const isWideLike = variant === "wide" || isHero;
  const isSquareLike = variant === "square" || isMasonry;

  // Voice-only masonry tiles get a dark treatment; other non-text/non-image tiles get a soft tint.
  const isDarkVoice = isMasonry && isVoice && !hasImage && !isLink;
  const useTint = isMasonry && !isText && !hasImage && !isDarkVoice;
  const tintBg = useTint ? mymindTints[tintIdx] : undefined;

  const base = isText
    ? "relative block overflow-hidden rounded-[28px] p-4 transition-all " +
      (selected ? "ring-2 ring-foreground" : "")
    : isHero
      ? "relative block overflow-hidden rounded-[28px] p-6 transition-all " +
        (selected ? "ring-2 ring-foreground" : "")
      : isDarkVoice
        ? "relative block overflow-hidden rounded-[24px] p-4 transition-all text-white " +
          (selected ? "ring-2 ring-foreground" : "")
        : useTint
          ? "relative block overflow-hidden rounded-[24px] p-4 transition-all " +
            (selected ? "ring-2 ring-foreground" : "")
          : "relative block overflow-hidden rounded-[24px] border border-border/60 p-3 transition-colors " +
            (selected
              ? "border-foreground bg-muted shadow-sm"
              : "bg-card hover:bg-muted/50");

  let sizing: string;
  if (isHero) {
    sizing = "";
  } else if (variant === "wide") {
    sizing = isText ? "p-5" : "p-4";
  } else if (isMasonry) {
    sizing = hasImage && !isLink
      ? "flex aspect-[4/5] w-full flex-col gap-2"
      : "flex aspect-square w-full flex-col gap-3";
  } else if (fullWidth) {
    sizing = "flex aspect-square w-full flex-col gap-3";
  } else {
    sizing = "flex aspect-square w-40 shrink-0 flex-col gap-3";
  }

  const textNoteStyle: React.CSSProperties | undefined = isText
    ? { backgroundColor: "#ffffff" }
    : isHero
      ? { backgroundColor: "#EFECE4" }
      : isDarkVoice
        ? { backgroundColor: "#1c1c1e" }
        : tintBg
          ? { backgroundColor: tintBg }
          : undefined;


  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      {...lp.handlers}
      style={textNoteStyle}
      className={`${base} ${sizing} cursor-pointer select-none`}
    >
      {/* Image-forward tile: image fills the card as background (only when not a link) */}
      {isSquareLike && hasImage && !isLink && (
        <>
          <img
            src={thumbUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          {imageCount > 1 && (
            <div className="absolute left-2 top-2 z-10 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
              +{imageCount - 1}
            </div>
          )}
        </>
      )}

      {selectMode && (
        <div className="absolute right-2 top-2 z-10">
          {selected ? (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground ring-2 ring-background">
              <Check className="h-3 w-3 text-background" strokeWidth={3} />
            </div>
          ) : (
            <div className="h-5 w-5 rounded-full bg-background ring-2 ring-background shadow-sm border border-muted-foreground/40" />
          )}
        </div>
      )}
      {note.pinned && !selectMode && (
        <div className="absolute right-2 top-2 z-10 text-muted-foreground">
          <Pin className="h-3.5 w-3.5 fill-foreground text-foreground" />
        </div>
      )}
      {isWideLike ? (
        <div className="flex items-start gap-4">
          {!isLink && hasImage && (
            <img
              src={thumbUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className={
                isHero
                  ? "h-24 w-24 shrink-0 rounded-2xl object-cover ring-1 ring-border"
                  : "h-16 w-16 shrink-0 rounded-xl object-cover ring-1 ring-border"
              }
            />
          )}
          <div className="min-w-0 flex-1">
            {isHero ? (
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Latest
                </span>
                {isLink && linkHost && (
                  <span className="inline-block rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background">
                    {linkHost}
                  </span>
                )}
              </div>
            ) : (
              isLink && linkHost && (
                <div className="mb-1.5">
                  <span className="inline-block rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background">
                    {linkHost}
                  </span>
                </div>
              )
            )}
            <div className="flex items-center gap-2 pr-6">
              <h3
                className={
                  isHero
                    ? "font-serif text-[24px] font-normal leading-[1.15] tracking-tight text-foreground line-clamp-3"
                    : "truncate text-sm font-semibold"
                }
              >
                {note.heading ?? (note.status === "failed" ? "Failed to process" : "Processing…")}
              </h3>
            </div>
            {note.summary && (
              <p className={`${isHero ? "mt-2 text-[13px]" : "mt-1 text-xs"} line-clamp-2 text-muted-foreground`}>{note.summary}</p>
            )}
            <div className={`${isHero ? "mt-3" : "mt-2"} flex items-center gap-3 text-[11px] text-muted-foreground`}>
              <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
              {note.duration_seconds != null && <span>{formatDur(note.duration_seconds)}</span>}
              {note.tasks && note.tasks.length > 0 && (
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {note.tasks.filter((t) => t.done).length}/{note.tasks.length}
                </span>
              )}
              {imageCount > 0 && !isLink && (
                <span className="flex items-center gap-1"><ImageIcon className="h-3 w-3" />{imageCount}</span>
              )}
            </div>
          </div>
        </div>
      ) : isText ? (
        <>
          <div className="relative z-10 flex items-start gap-1.5 pr-5">
            <h3 className="font-serif text-[15px] leading-snug font-medium tracking-tight break-words line-clamp-2 text-foreground">
              {note.heading ?? (note.status === "failed" ? "Failed" : "Processing…")}
            </h3>
          </div>
          {hasImage && (
            <div className="relative z-10 -mx-1 overflow-hidden rounded-xl ring-1 ring-black/[0.06]">
              <img src={thumbUrl} alt="" loading="lazy" decoding="async" className="h-24 w-full object-cover" />
              {imageCount > 1 && (
                <div className="absolute right-1.5 top-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                  +{imageCount - 1}
                </div>
              )}
            </div>
          )}
          {note.transcript && (
            <div className="relative z-10 overflow-hidden text-foreground/70 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]" style={{ maxHeight: hasImage ? "9rem" : "16rem" }}>
              <Markdown className="!text-[12px] !leading-snug [&_h1]:!text-[14px] [&_h1]:!mt-0 [&_h1]:!mb-1 [&_h2]:!text-[13px] [&_h2]:!mt-1 [&_h2]:!mb-1 [&_h3]:!text-[12px] [&_h3]:!mt-1 [&_h3]:!mb-0.5 [&_p]:!my-1 [&_ul]:!my-1 [&_ol]:!my-1 [&_img]:!my-1 [&_img]:!rounded-lg [&_img]:!max-h-24 [&_img]:!w-auto [&_pre]:hidden [&_hr]:hidden">
                {note.transcript}
              </Markdown>
            </div>
          )}

        </>
      ) : (
        <>
          {isDarkVoice && (
            <div className="relative z-10 flex items-center gap-2 text-white/90">
              <AudioLines className="h-5 w-5" strokeWidth={1.75} />
              {note.duration_seconds != null && (
                <span className="text-[13px] font-medium tabular-nums">{formatDur(note.duration_seconds)}</span>
              )}
            </div>
          )}
          {isLink && linkHost && (
            <div className="relative z-10">
              <span className="inline-block rounded bg-foreground px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-background max-w-full truncate">
                {linkHost}
              </span>
            </div>
          )}
          <div className="relative z-10 flex items-start gap-1.5 pr-5">
            <h3
              className={`text-[13px] font-medium leading-snug break-words line-clamp-3 ${
                hasImage && !isLink ? "text-white drop-shadow" : isDarkVoice ? "text-white" : ""
              }`}
            >
              {note.heading ?? (note.status === "failed" ? "Failed" : "Processing…")}
            </h3>
          </div>

          <div
            className={`relative z-10 mt-auto flex items-center gap-2 text-[10px] ${
              hasImage && !isLink ? "text-white/85" : isDarkVoice ? "text-white/50" : "text-muted-foreground"
            }`}
          >
            <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
            {note.tasks && note.tasks.length > 0 && (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {note.tasks.filter((t) => t.done).length}/{note.tasks.length}
              </span>
            )}
            {!isDarkVoice && note.duration_seconds != null && (
              <span className="tabular-nums">{formatDur(note.duration_seconds)}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
});

const TaskRow = memo(function TaskRow({
  selectMode,
  selected,
  done,
  pinned,
  text,
  noteHeading,
  noteId,
  onToggleDone,
  onLongPress,
  onSelectTap,
}: {
  selectMode: boolean;
  selected: boolean;
  done: boolean;
  pinned?: boolean;
  text: string;
  noteHeading: string | null;
  noteId: string;
  onToggleDone: () => void;
  onLongPress: () => void;
  onSelectTap: () => void;
}) {
  const lp = useLongPress(onLongPress);
  return (
    <div
      {...lp.handlers}
      onClick={(e) => {
        if (lp.wasLongPress()) {
          e.preventDefault();
          return;
        }
        if (selectMode) onSelectTap();
      }}
      className={`flex items-start gap-3 px-4 py-3 select-none transition-colors ${
        selected ? "bg-muted" : "active:bg-muted"
      }`}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (selectMode) {
            onSelectTap();
            return;
          }
          onToggleDone();
        }}
        aria-label={done ? "Mark as not done" : "Mark as done"}
        className="mt-0.5 shrink-0"
      >
        {done ? (
          <CheckCircle2 className="h-5 w-5 text-primary" />
        ) : (
          <Circle className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`text-[17px] leading-tight ${
            done ? "text-muted-foreground line-through" : "text-foreground"
          }`}
        >
          {pinned && <Pin className="mr-1 inline h-3.5 w-3.5 -translate-y-0.5 fill-primary text-primary" />}
          {text}
        </p>
        {noteHeading && (
          selectMode ? (
            <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
              {noteHeading}
            </span>
          ) : (
            <Link
              to="/notes/$id"
              params={{ id: noteId }}
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 block truncate text-[13px] text-muted-foreground active:underline"
            >
              {noteHeading}
            </Link>
          )
        )}
      </div>
    </div>
  );
});


function StatusIcon({ status }: { status: Note["status"] }) {
  if (status === "ready") return <CheckCircle2 className="h-3.5 w-3.5 text-foreground" />;
  if (status === "failed") return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
  return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />;
}

function formatDur(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
