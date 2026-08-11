import { useScrolled } from "@/hooks/use-scrolled";

/** Small live-blur page title pill, top-left. */
export function TitlePill({ children }: { children: React.ReactNode }) {
  const shrink = useScrolled(24);
  return (
    <div className="pointer-events-none sticky top-2 z-30 flex px-4 pt-2">
      <span
        className={`glass-pill pointer-events-auto inline-flex items-center rounded-full font-normal tracking-tight text-foreground transition-all duration-300 ease-out ${
          shrink ? "px-3 py-1 text-[12px]" : "px-3.5 py-1.5 text-[14px]"
        }`}
      >
        {children}
      </span>
    </div>
  );
}
