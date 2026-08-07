import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Sparkles,
  Mic,
  Film,
  Link as LinkIcon,
  CheckSquare,
  Bell,
  Moon,
  Sun,
  Laptop,
  ChevronRight,
  ChevronLeft,
  ArrowRight,
  Check,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
import { recordActivityPing } from "@/lib/activity";

export const ONBOARDING_KEY = "braintape.onboarded.v1";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Welcome — Braintape" },
      { name: "description", content: "Your second brain for notes, media, and links — all local, all yours." },
      { property: "og:title", content: "Welcome to Braintape" },
      { property: "og:description", content: "Capture voice, movies, and articles in one calm place." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OnboardingPage,
});

type Slide = {
  id: string;
  render: (ctx: SlideCtx) => ReactNode;
};

type SlideCtx = {
  goNext: () => void;
  goPrev: () => void;
  finish: () => void;
};

function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // If a returning user somehow lands here, bounce them straight to home.
  useEffect(() => {
    try {
      if (localStorage.getItem(ONBOARDING_KEY) === "done") {
        void navigate({ to: "/home", replace: true });
      }
    } catch {}
    recordActivityPing();
  }, [navigate]);

  const slides = useMemo<Slide[]>(
    () => [
      { id: "welcome", render: (c) => <WelcomeSlide {...c} /> },
      { id: "voice", render: (c) => <FeatureSlide
          {...c}
          icon={<Mic className="h-6 w-6" />}
          eyebrow="Capture"
          title="Speak your thoughts"
          body="Record a voice memo and Braintape transcribes it, writes a summary, and surfaces what matters from your ramble."
          bullets={["Auto transcript & summary", "Continue-recording append", "Waveform scrub + speed toggle"]}
        /> },
      { id: "media", render: (c) => <FeatureSlide
          {...c}
          icon={<Film className="h-6 w-6" />}
          eyebrow="Track"
          title="Movies, TV & cast"
          body="Paste a TMDB or IMDb link — or search inside the app — and get a rich card with episode tracker, cast, and watch status."
          bullets={["Episode-by-episode progress", "Watchlist / Watching / Watched", "Tap cast → filmography"]}
        /> },
      { id: "web", render: (c) => <FeatureSlide
          {...c}
          icon={<LinkIcon className="h-6 w-6" />}
          eyebrow="Clip"
          title="Web links & YouTube"
          body="Share any URL and Braintape distills it. YouTube videos get a compact card with channel, duration, and AI key points."
          bullets={["Reader view for articles", "YouTube summary + captions", "Photos ingest with OCR"]}
        /> },
      { id: "theme", render: (c) => <ThemeSlide {...c} /> },
      { id: "notify", render: (c) => <NotificationsSlide {...c} /> },
      { id: "ready", render: (c) => <ReadySlide {...c} /> },
    ],
    [],
  );

  const total = slides.length;
  const isLast = step === total - 1;

  const finish = () => {
    try { localStorage.setItem(ONBOARDING_KEY, "done"); } catch {}
    void navigate({ to: "/home", replace: true });
  };
  const goNext = () => (isLast ? finish() : setStep((s) => Math.min(total - 1, s + 1)));
  const goPrev = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="relative mx-auto flex h-[100dvh] w-full max-w-md flex-col overflow-hidden bg-background text-foreground">
      {/* Top bar */}
      <header className="flex items-center justify-between px-5 pt-6">
        <button
          onClick={goPrev}
          disabled={step === 0}
          aria-label="Back"
          className="grid h-9 w-9 place-items-center rounded-full text-foreground/70 disabled:opacity-0 active:bg-muted"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-1.5">
          {slides.map((s, i) => (
            <span
              key={s.id}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === step ? "w-6 bg-foreground" : i < step ? "w-1.5 bg-foreground/60" : "w-1.5 bg-foreground/20"
              }`}
            />
          ))}
        </div>
        <button
          onClick={finish}
          className="text-[13px] font-medium text-foreground/60 active:opacity-60"
        >
          {isLast ? "" : "Skip"}
        </button>
      </header>

      {/* Slide body */}
      <main className="flex flex-1 flex-col overflow-hidden px-6 pb-6 pt-4">
        <div key={slides[step].id} className="flex flex-1 flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
          {slides[step].render({ goNext, goPrev, finish })}
        </div>
      </main>

      {/* Footer CTA */}
      <footer className="border-t border-border/50 bg-background/95 px-6 pb-8 pt-4 backdrop-blur-xl">
        <button
          onClick={goNext}
          className="group flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-foreground text-[15px] font-semibold text-background transition-transform active:scale-[0.98]"
        >
          {isLast ? "Open Braintape" : "Continue"}
          <ArrowRight className="h-4 w-4 transition-transform group-active:translate-x-0.5" />
        </button>
      </footer>
    </div>
  );
}

/* -------------------------------- Slides --------------------------------- */

function WelcomeSlide(_: SlideCtx) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <div className="relative mb-8">
        <div className="absolute -inset-8 rounded-full bg-gradient-to-br from-foreground/10 via-transparent to-transparent blur-2xl" />
        <div className="relative grid h-24 w-24 place-items-center rounded-[28px] bg-foreground text-background shadow-xl">
          <Sparkles className="h-11 w-11" strokeWidth={2} />
        </div>
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-foreground/50">
        Welcome to
      </p>
      <h1 className="mt-2 font-serif text-[44px] leading-none tracking-tight" style={{ fontFamily: '"Instrument Serif", serif' }}>
        Braintape
      </h1>
      <p className="mt-6 max-w-xs text-[15px] leading-relaxed text-foreground/70">
        Your second brain — voice notes, movies, articles, and follow-ups in one calm place. Everything stays on this device.
      </p>
    </div>
  );
}

function FeatureSlide({
  icon,
  eyebrow,
  title,
  body,
  bullets,
}: SlideCtx & {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col justify-center">
        <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground/5 text-foreground ring-1 ring-foreground/10">
          {icon}
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-foreground/50">
          {eyebrow}
        </p>
        <h2 className="mt-1.5 text-[30px] font-bold leading-[1.1] tracking-tight">{title}</h2>
        <p className="mt-4 text-[15px] leading-relaxed text-foreground/70">{body}</p>

        <ul className="mt-8 space-y-3">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-3">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-foreground text-background">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
              <span className="text-[14px] leading-snug text-foreground/85">{b}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ThemeSlide(_: SlideCtx) {
  const { mode, setMode } = useTheme();
  const options: { id: "light" | "dark" | "system"; label: string; icon: ReactNode }[] = [
    { id: "light", label: "Light", icon: <Sun className="h-5 w-5" /> },
    { id: "dark", label: "Dark", icon: <Moon className="h-5 w-5" /> },
    { id: "system", label: "System", icon: <Laptop className="h-5 w-5" /> },
  ];
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col justify-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-foreground/50">
          Personalize
        </p>
        <h2 className="mt-1.5 text-[30px] font-bold leading-[1.1] tracking-tight">Pick your look</h2>
        <p className="mt-4 text-[15px] leading-relaxed text-foreground/70">
          Braintape follows a quiet monochrome palette. Choose the mood that suits you — you can change it anytime in Profile.
        </p>

        <div className="mt-8 grid grid-cols-3 gap-3">
          {options.map((o) => {
            const active = mode === o.id;
            return (
              <button
                key={o.id}
                onClick={() => setMode(o.id)}
                className={`flex flex-col items-center gap-2 rounded-2xl border p-4 text-[12px] font-medium transition-all active:scale-[0.97] ${
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-foreground/70"
                }`}
              >
                {o.icon}
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function NotificationsSlide({ goNext }: SlideCtx) {
  const [status, setStatus] = useState<NotificationPermission | "unsupported">(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    return Notification.permission;
  });

  const request = async () => {
    if (status === "unsupported") { goNext(); return; }
    try {
      const p = await Notification.requestPermission();
      setStatus(p);
    } catch {}
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col justify-center">
        <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground/5 text-foreground ring-1 ring-foreground/10">
          <Bell className="h-6 w-6" />
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-foreground/50">
          Stay in the loop
        </p>
        <h2 className="mt-1.5 text-[30px] font-bold leading-[1.1] tracking-tight">Turn on notifications</h2>
        <p className="mt-4 text-[15px] leading-relaxed text-foreground/70">
          Get a gentle nudge when a shared link finishes saving in the background.
        </p>

        <div className="mt-8">
          {status === "granted" ? (
            <div className="inline-flex items-center gap-2 rounded-full bg-foreground/5 px-4 py-2 text-[13px] font-medium text-foreground ring-1 ring-foreground/10">
              <Check className="h-4 w-4" /> Notifications enabled
            </div>
          ) : status === "denied" ? (
            <p className="text-[13px] text-foreground/60">
              Notifications are blocked. You can enable them later from your browser or system settings.
            </p>
          ) : (
            <button
              onClick={request}
              className="inline-flex items-center gap-2 rounded-full bg-foreground/5 px-4 py-2.5 text-[13px] font-semibold text-foreground ring-1 ring-foreground/10 press-bounce active:opacity-70"
            >
              Enable notifications
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReadySlide(_: SlideCtx) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <div className="relative mb-8">
        <div className="absolute -inset-6 rounded-full bg-foreground/5 blur-xl" />
        <div className="relative grid h-20 w-20 place-items-center rounded-full bg-foreground text-background shadow-xl">
          <Check className="h-10 w-10" strokeWidth={2.5} />
        </div>
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-foreground/50">
        You're all set
      </p>
      <h2 className="mt-2 text-[30px] font-bold leading-[1.1] tracking-tight">Start your first capture</h2>
      <p className="mt-4 max-w-xs text-[15px] leading-relaxed text-foreground/70">
        Tap the mic to speak, share a link from anywhere, or search for a movie — Braintape will figure out the rest.
      </p>

      <div className="mt-10 grid w-full grid-cols-3 gap-3 text-[11px] font-medium text-foreground/70">
        <MiniHint icon={<Mic className="h-4 w-4" />} label="Speak" />
        <MiniHint icon={<LinkIcon className="h-4 w-4" />} label="Share a link" />
        <MiniHint icon={<Film className="h-4 w-4" />} label="Search media" />
      </div>
    </div>
  );
}

function MiniHint({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-border/60 bg-card px-3 py-3">
      <span className="text-foreground">{icon}</span>
      {label}
    </div>
  );
}
