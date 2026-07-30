import { BackButton } from "./BackButton";
import { SectionLabel } from "./SectionLabel";

export function PageHeader({
  title,
  onBack,
  backTo,
  children,
  className = "",
}: {
  title: string;
  onBack?: () => void;
  backTo?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={`sticky top-0 z-20 border-b border-border/60 bg-background ${className}`}>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <BackButton onClick={onBack} to={backTo} />
          <SectionLabel>{title}</SectionLabel>
        </div>
        {children}
      </div>
    </header>
  );
}
