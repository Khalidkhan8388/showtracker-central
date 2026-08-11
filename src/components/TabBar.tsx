import { Link } from "@tanstack/react-router";
import { Search, Compass, Library, Ticket } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { useScrolled } from "@/hooks/use-scrolled";

const TABS = [
  { to: "/discover", label: "Discover", icon: Compass },
  { to: "/library", label: "Library", icon: Library },
  { to: "/stubs", label: "Stubs", icon: Ticket },
] as const;

export function TabBar() {
  const shrink = useScrolled(24);

  return (
    <nav
      aria-label="Main"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-2 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
    >
      <div
        className={`glass-pill pointer-events-auto flex items-center gap-1 rounded-full p-1.5 transition-all duration-300 ease-out ${
          shrink ? "scale-90 opacity-95" : "scale-100"
        }`}
        style={{ transformOrigin: "bottom center" }}
      >
        {TABS.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            onClick={() => void haptic.tap()}
            aria-label={label}
            className={`group inline-flex flex-col items-center justify-center gap-0.5 rounded-full text-neutral-500 press-bounce data-[status=active]:bg-primary data-[status=active]:text-primary-foreground dark:text-neutral-400 ${
              shrink ? "min-w-[52px] px-2.5 py-1.5" : "min-w-[68px] px-3 py-1.5"
            }`}
          >
            <Icon className={shrink ? "h-[17px] w-[17px]" : "h-[18px] w-[18px]"} />
            {!shrink && <span className="text-[10px] font-semibold leading-none">{label}</span>}
          </Link>
        ))}
      </div>

      <Link
        to="/search"
        onClick={() => void haptic.tap()}
        aria-label="Search"
        className={`glass-pill pointer-events-auto grid place-items-center rounded-full text-neutral-500 press-bounce data-[status=active]:bg-primary data-[status=active]:text-primary-foreground dark:text-neutral-400 transition-all duration-300 ease-out ${
          shrink ? "h-11 w-11 scale-90" : "h-[52px] w-[52px]"
        }`}
        style={{ transformOrigin: "bottom center" }}
      >
        <Search className="h-[19px] w-[19px]" />
      </Link>
    </nav>
  );
}
