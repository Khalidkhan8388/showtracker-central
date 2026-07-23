import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Accent = {
  id: string;
  name: string;
  primary: string;
  foreground: string;
};

export const ACCENTS: Accent[] = [
  { id: "yellow", name: "Sunshine", primary: "#ffc700", foreground: "#000000" },
  { id: "blue",   name: "Ocean",    primary: "#0a84ff", foreground: "#ffffff" },
  { id: "purple", name: "Iris",     primary: "#af52de", foreground: "#ffffff" },
  { id: "green",  name: "Matcha",   primary: "#30d158", foreground: "#000000" },
  { id: "pink",   name: "Blossom",  primary: "#ff2d92", foreground: "#ffffff" },
  { id: "orange", name: "Ember",    primary: "#ff9500", foreground: "#000000" },
  { id: "red",    name: "Cherry",   primary: "#ff3b30", foreground: "#ffffff" },
  { id: "mono",   name: "Graphite", primary: "#111111", foreground: "#ffffff" },
];

type ThemeMode = "light" | "dark" | "system";

export type SizeScaleId = "small" | "default" | "large" | "xlarge";
export const SIZE_SCALES: { id: SizeScaleId; name: string; value: number }[] = [
  { id: "small", name: "Small", value: 0.9 },
  { id: "default", name: "Default", value: 1 },
  { id: "large", name: "Large", value: 1.12 },
  { id: "xlarge", name: "Extra Large", value: 1.25 },
];

type ThemeCtx = {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  accent: Accent;
  setAccentId: (id: string) => void;
  isDark: boolean;
  sizeScale: SizeScaleId;
  setSizeScale: (id: SizeScaleId) => void;
};

const Ctx = createContext<ThemeCtx | null>(null);

const MODE_KEY = "braintape.theme.mode";
const ACCENT_KEY = "braintape.theme.accent";
const SIZE_KEY = "braintape.theme.size";

function applyAccent(a: Accent) {
  const r = document.documentElement;
  r.style.setProperty("--primary", a.primary);
  r.style.setProperty("--primary-foreground", a.foreground);
  r.style.setProperty("--ring", a.primary);
  r.style.setProperty("--sidebar-primary", a.primary);
  r.style.setProperty("--sidebar-ring", a.primary);
}

function applyMode(mode: ThemeMode) {
  const r = document.documentElement;
  const prefersDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = mode === "dark" || (mode === "system" && prefersDark);
  r.classList.toggle("dark", dark);
  return dark;
}

function applySize(id: SizeScaleId) {
  const found = SIZE_SCALES.find((s) => s.id === id) ?? SIZE_SCALES[1];
  document.documentElement.style.setProperty("--user-scale", String(found.value));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [accent, setAccent] = useState<Accent>(ACCENTS[0]);
  const [isDark, setIsDark] = useState(false);
  const [sizeScale, setSizeScaleState] = useState<SizeScaleId>("default");

  useEffect(() => {
    const storedMode = (localStorage.getItem(MODE_KEY) as ThemeMode | null) ?? "system";
    const storedAccentId = localStorage.getItem(ACCENT_KEY) ?? "yellow";
    const storedSize = (localStorage.getItem(SIZE_KEY) as SizeScaleId | null) ?? "default";
    const found = ACCENTS.find((a) => a.id === storedAccentId) ?? ACCENTS[0];
    setModeState(storedMode);
    setAccent(found);
    setSizeScaleState(storedSize);
    applyAccent(found);
    applySize(storedSize);
    setIsDark(applyMode(storedMode));

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const current = (localStorage.getItem(MODE_KEY) as ThemeMode | null) ?? "system";
      if (current === "system") setIsDark(applyMode("system"));
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setMode = (m: ThemeMode) => {
    localStorage.setItem(MODE_KEY, m);
    setModeState(m);
    setIsDark(applyMode(m));
  };

  const setAccentId = (id: string) => {
    const found = ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
    localStorage.setItem(ACCENT_KEY, found.id);
    setAccent(found);
    applyAccent(found);
  };

  const setSizeScale = (id: SizeScaleId) => {
    localStorage.setItem(SIZE_KEY, id);
    setSizeScaleState(id);
    applySize(id);
  };

  return (
    <Ctx.Provider value={{ mode, setMode, accent, setAccentId, isDark, sizeScale, setSizeScale }}>{children}</Ctx.Provider>
  );
}

export function useTheme() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme must be used within ThemeProvider");
  return v;
}

// Inline script string to run before hydration and avoid FOUC on dark mode.
export const THEME_BOOT_SCRIPT = `
(function(){try{
  var m = localStorage.getItem('${MODE_KEY}') || 'system';
  var a = localStorage.getItem('${ACCENT_KEY}') || 'yellow';
  var accents = ${JSON.stringify(ACCENTS)};
  var acc = accents.find(function(x){return x.id===a;}) || accents[0];
  var r = document.documentElement;
  r.style.setProperty('--primary', acc.primary);
  r.style.setProperty('--primary-foreground', acc.foreground);
  r.style.setProperty('--ring', acc.primary);
  r.style.setProperty('--sidebar-primary', acc.primary);
  r.style.setProperty('--sidebar-ring', acc.primary);
  var dark = m==='dark' || (m==='system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if(dark) r.classList.add('dark');
}catch(e){}})();
`;
