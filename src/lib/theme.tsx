import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type ThemeMode = "light" | "dark" | "system";

export type SizeScaleId = "small" | "default";
export const SIZE_SCALES: { id: SizeScaleId; name: string; value: number }[] = [
  { id: "small", name: "Small", value: 0.9 },
  { id: "default", name: "Default", value: 1 },
];

type ThemeCtx = {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  isDark: boolean;
  sizeScale: SizeScaleId;
  setSizeScale: (id: SizeScaleId) => void;
};

const Ctx = createContext<ThemeCtx | null>(null);

const MODE_KEY = "braintape.theme.mode";
const SIZE_KEY = "braintape.theme.size";

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
  const [isDark, setIsDark] = useState(false);
  const [sizeScale, setSizeScaleState] = useState<SizeScaleId>("default");

  useEffect(() => {
    const storedMode = (localStorage.getItem(MODE_KEY) as ThemeMode | null) ?? "system";
    const storedSize = (localStorage.getItem(SIZE_KEY) as SizeScaleId | null) ?? "default";
    setModeState(storedMode);
    setSizeScaleState(storedSize);
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

  const setSizeScale = (id: SizeScaleId) => {
    localStorage.setItem(SIZE_KEY, id);
    setSizeScaleState(id);
    applySize(id);
  };

  return (
    <Ctx.Provider value={{ mode, setMode, isDark, sizeScale, setSizeScale }}>{children}</Ctx.Provider>
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
  var s = localStorage.getItem('${SIZE_KEY}') || 'default';
  var sizes = ${JSON.stringify(SIZE_SCALES)};
  var sz = sizes.find(function(x){return x.id===s;}) || sizes[1];
  var r = document.documentElement;
  r.style.setProperty('--user-scale', String(sz.value));
  var dark = m==='dark' || (m==='system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if(dark) r.classList.add('dark');
}catch(e){}})();
`;
