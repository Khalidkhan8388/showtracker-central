import { ChevronLeft } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";

export function BackButton({
  onClick,
  to,
  label = "Back",
  className = "",
}: {
  onClick?: () => void;
  to?: string;
  label?: string;
  className?: string;
}) {
  const navigate = useNavigate();
  const base =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground press-bounce active:opacity-70";

  if (to) {
    return (
      <Link to={to} aria-label={label} className={`${base} ${className}`}>
        <ChevronLeft className="h-5 w-5" />
      </Link>
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        if (onClick) {
          onClick();
          return;
        }
        if (typeof window !== "undefined" && window.history.length > 1) {
          window.history.back();
        } else {
          void navigate({ to: "/home" });
        }
      }}
      className={`${base} ${className}`}
    >
      <ChevronLeft className="h-5 w-5" />
    </button>
  );
}
