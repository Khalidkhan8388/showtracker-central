import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Search, Library, Settings } from "lucide-react";
import type { ReactNode } from "react";

const tabs = [
  { to: "/", label: "Home", icon: Home },
  { to: "/search", label: "Search", icon: Search },
  { to: "/library", label: "Library", icon: Library },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col pb-20">
        {children}
      </div>
      <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 border-t border-border bg-background/95 backdrop-blur">
        <ul className="grid grid-cols-4">
          {tabs.map((t) => {
            const active = t.to === "/" ? pathname === "/" : pathname.startsWith(t.to);
            const Icon = t.icon;
            return (
              <li key={t.to}>
                <Link
                  to={t.to}
                  className={`flex flex-col items-center gap-1 py-3 text-xs transition-colors ${
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className={`h-5 w-5 ${active ? "stroke-[2.5]" : ""}`} />
                  <span>{t.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-4 px-5 pt-8 pb-4">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </header>
  );
}

export function Poster({ src, alt, className = "" }: { src: string | null; alt: string; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-xl bg-muted ${className}`}>
      {src ? (
        <img src={src} alt={alt} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">No image</div>
      )}
    </div>
  );
}
