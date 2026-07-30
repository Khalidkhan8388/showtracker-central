export function SectionLabel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground ${className}`}
    >
      {children}
    </span>
  );
}

export function SectionHeader({
  label,
  count,
  action,
  onClick,
  children,
}: {
  label?: string;
  count?: number;
  action?: React.ReactNode;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const labelNode = children ? (
    <SectionLabel>{children}</SectionLabel>
  ) : label ? (
    <SectionLabel>{label}</SectionLabel>
  ) : null;

  const meta = (
    <div className="flex items-center gap-0.5">
      {count !== undefined && (
        <span className="text-[11px] text-muted-foreground">
          {count} {count === 1 ? "entry" : "entries"}
        </span>
      )}
      {action}
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full items-baseline justify-between text-left"
      >
        {labelNode}
        {meta}
      </button>
    );
  }

  return (
    <div className="flex w-full items-baseline justify-between">
      {labelNode}
      {meta}
    </div>
  );
}
