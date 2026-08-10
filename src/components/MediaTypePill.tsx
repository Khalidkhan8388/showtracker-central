import { Film, Tv } from "lucide-react";
import { haptic } from "@/lib/haptics";

export type MediaKind = "movie" | "tv";

/** Pill switch between Movies and TV shows. */
export function MediaTypePill({
  value,
  onChange,
  movieCount,
  tvCount,
}: {
  value: MediaKind;
  onChange: (v: MediaKind) => void;
  movieCount?: number;
  tvCount?: number;
}) {
  const items: Array<{ key: MediaKind; label: string; icon: typeof Film; count?: number }> = [
    { key: "movie", label: "Movies", icon: Film, count: movieCount },
    { key: "tv", label: "TV Shows", icon: Tv, count: tvCount },
  ];

  return (
    <div className="inline-flex w-full items-center gap-1 rounded-full bg-muted p-1">
      {items.map(({ key, label, icon: Icon, count }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => {
              void haptic.tap();
              onChange(key);
            }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-semibold press-bounce transition-colors ${
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {typeof count === "number" && (
              <span className={`text-[11px] tabular-nums ${active ? "opacity-70" : "opacity-60"}`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
