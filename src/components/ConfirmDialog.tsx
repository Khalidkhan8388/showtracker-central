import { useEffect, useState } from "react";

/**
 * App-wide confirmation dialog. Replaces window.confirm() everywhere so we
 * never show the browser chrome. Imperative API — call from anywhere:
 *
 *   if (!(await confirmDialog({ title: "Delete note", destructive: true }))) return;
 */

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Pending = ConfirmOptions & { resolve: (v: boolean) => void };

let push: ((p: Pending) => void) | null = null;

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (!push) {
    // Provider not mounted (SSR / edge case) — fail closed.
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => push!({ ...opts, resolve }));
}

export function ConfirmDialogHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    push = (p) => setPending(p);
    return () => { push = null; };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const id = requestAnimationFrame(() => setVisible(true));
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(id);
      document.body.style.overflow = prev;
    };
  }, [pending]);

  const close = (value: boolean) => {
    if (!pending) return;
    const { resolve } = pending;
    setVisible(false);
    window.setTimeout(() => {
      setPending(null);
      resolve(value);
    }, 140);
  };

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  if (!pending) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[200] flex items-center justify-center px-6"
      style={{
        background: "color-mix(in oklab, var(--color-background) 45%, transparent)",
        backdropFilter: "blur(14px) saturate(140%)",
        opacity: visible ? 1 : 0,
        transition: "opacity 160ms ease-out",
      }}
      onClick={() => close(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-pill w-full max-w-[340px] overflow-hidden rounded-[26px] px-5 pb-4 pt-6 text-center"
        style={{
          transform: visible ? "scale(1)" : "scale(0.9)",
          opacity: visible ? 1 : 0,
          transition: visible
            ? "transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 160ms ease-out"
            : "transform 140ms ease-in, opacity 140ms ease-in",
        }}
      >
        <h2 className="text-[19px] font-semibold tracking-tight text-foreground">{pending.title}</h2>
        {pending.message && (
          <p className="mx-auto mt-2 max-w-[280px] text-[14px] leading-snug text-muted-foreground">
            {pending.message}
          </p>
        )}

        <div className="mt-5 space-y-2">
          <button
            type="button"
            onClick={() => close(true)}
            className={`press-bounce glass-item w-full outline-none rounded-[18px] py-3.5 text-[16px] font-medium ${
              pending.destructive ? "text-destructive" : "text-foreground"
            }`}
          >
            {pending.confirmLabel ?? (pending.destructive ? "Delete" : "Confirm")}
          </button>
          <button
            type="button"
            onClick={() => close(false)}
            className="press-bounce glass-item w-full outline-none rounded-[18px] py-3.5 text-[16px] font-medium text-foreground"
          >
            {pending.cancelLabel ?? "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
