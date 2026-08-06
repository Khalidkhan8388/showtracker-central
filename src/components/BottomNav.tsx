import { Link } from "@tanstack/react-router";
import { Library, FolderOpen, Search } from "lucide-react";
import { haptic } from "@/lib/haptics";

/**
 * Bottom dock — three destinations only: Library (all entries),
 * Collections, and Search.
 */
export function BottomNav({ onLibrary }: { onLibrary: () => void }) {
  const item =
    "inline-flex h-12 w-16 items-center justify-center rounded-full text-neutral-900 press-bounce active:scale-90 active:opacity-70 dark:text-white";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-5">
      <nav
        aria-label="Primary"
        className="pointer-events-auto flex items-center gap-3 rounded-full glass-pill px-3 py-1"
      >
        <button
          type="button"
          aria-label="Library"
          onClick={() => {
            void haptic.tap();
            onLibrary();
          }}
          className={item}
        >
          <Library aria-hidden="true" className="h-6 w-6" strokeWidth={1.75} />
        </button>
        <Link to="/collections" aria-label="Collections" onClick={() => void haptic.tap()} className={item}>
          <FolderOpen aria-hidden="true" className="h-6 w-6" strokeWidth={1.75} />
        </Link>
        <Link to="/search" search={{ tab: "memories" as const }} aria-label="Search" onClick={() => void haptic.tap()} className={item}>
          <Search aria-hidden="true" className="h-6 w-6" strokeWidth={1.75} />
        </Link>
      </nav>
    </div>
  );
}
