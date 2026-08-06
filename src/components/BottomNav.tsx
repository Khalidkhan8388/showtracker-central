import { Link } from "@tanstack/react-router";
import { Library, FolderOpen, Search } from "lucide-react";
import { haptic } from "@/lib/haptics";

/**
 * Bottom dock — three destinations only: Library (all entries),
 * Collections, and Search.
 */
export function BottomNav({ onLibrary }: { onLibrary: () => void }) {
  const item =
    "inline-flex flex-1 flex-col items-center justify-center gap-1 rounded-full px-4 py-2 text-[11px] font-semibold text-neutral-900 press-bounce active:scale-90 active:opacity-70 dark:text-white";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-5">
      <nav
        aria-label="Primary"
        className="pointer-events-auto flex w-full max-w-sm items-center gap-1 rounded-full glass-pill p-1.5"
      >
        <button
          type="button"
          onClick={() => {
            void haptic.tap();
            onLibrary();
          }}
          className={item}
        >
          <Library aria-hidden="true" className="h-5 w-5" />
          Library
        </button>
        <Link to="/collections" onClick={() => void haptic.tap()} className={item}>
          <FolderOpen aria-hidden="true" className="h-5 w-5" />
          Collections
        </Link>
        <Link to="/search" onClick={() => void haptic.tap()} className={item}>
          <Search aria-hidden="true" className="h-5 w-5" />
          Search
        </Link>
      </nav>
    </div>
  );
}
