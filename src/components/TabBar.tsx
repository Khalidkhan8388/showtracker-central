import { Link } from "@tanstack/react-router";
import { Search, Compass, Library, Ticket } from "lucide-react";
import { haptic } from "@/lib/haptics";

const TABS = [
  { to: "/search", label: "Search", icon: Search },
  { to: "/discover", label: "Discover", icon: Compass },
  { to: "/library", label: "Library", icon: Library },
  { to: "/stubs", label: "Stubs", icon: Ticket },
] as const;

export function TabBar() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center pb-[max(env(safe-area-inset-bottom),0.75rem)]"
    >
      <div className="glass-pill flex items-center gap-1 rounded-full px-1.5 py-1.5">
        {TABS.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            onClick={() => void haptic.tap()}
            aria-label={label}
            className="group inline-flex min-w-[68px] flex-col items-center gap-0.5 rounded-full px-3 py-1.5 text-neutral-500 press-bounce data-[status=active]:bg-primary data-[status=active]:text-primary-foreground dark:text-neutral-400"
          >
            <Icon className="h-[18px] w-[18px]" />
            <span className="text-[10px] font-semibold leading-none">{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
