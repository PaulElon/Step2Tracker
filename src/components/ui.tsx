import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/ui";
import type { SectionId, StudyStatus } from "../types/models";

const statusClassNames: Record<StudyStatus, string> = {
  "Not Started": "border-slate-400/20 bg-slate-400/10 text-slate-200",
  "In Progress": "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
  Completed: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
  Skipped: "border-rose-300/20 bg-rose-300/10 text-rose-100",
};

const categoryPalette = [
  "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
  "border-blue-300/25 bg-blue-300/10 text-blue-100",
  "border-violet-300/25 bg-violet-300/10 text-violet-100",
  "border-pink-300/25 bg-pink-300/10 text-pink-100",
  "border-amber-300/25 bg-amber-300/10 text-amber-100",
  "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
];

function categoryTone(category: string) {
  const hash = [...category].reduce((total, character) => total + character.charCodeAt(0), 0);
  return categoryPalette[hash % categoryPalette.length];
}

export function Panel({
  title,
  subtitle,
  action,
  className,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("glass-panel min-w-0 overflow-hidden", className)}>
      {(title || subtitle || action) && (
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title ? <h3 className="text-base font-semibold text-white">{title}</h3> : null}
            {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  meta,
  icon: Icon,
  accentClassName,
}: {
  label: string;
  value: string;
  meta?: string;
  icon?: LucideIcon;
  accentClassName?: string;
}) {
  return (
    <div className="panel-subtle flex min-h-[132px] min-w-0 flex-col justify-between">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] text-slate-500">{label}</p>
          <p className="mt-2 text-[1.75rem] font-semibold tracking-[-0.04em] text-white">{value}</p>
        </div>
        {Icon ? (
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-[16px] border border-white/10 bg-slate-950/70 text-cyan-200",
              accentClassName,
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        ) : null}
      </div>
      {meta ? <p className="mt-3 text-sm text-slate-300">{meta}</p> : null}
    </div>
  );
}

export function StatusBadge({ status }: { status: StudyStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        statusClassNames[status],
      )}
    >
      {status}
    </span>
  );
}

export function CategoryBadge({ category }: { category: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        categoryTone(category),
      )}
    >
      {category}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[22px] border border-dashed border-white/10 bg-white/[0.025] px-6 text-center",
        compact ? "min-h-[172px] py-6" : "min-h-[220px] py-8",
      )}
    >
      <p className="text-lg font-semibold text-white">{title}</p>
      <p className="mt-2 max-w-md text-sm text-slate-300">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function NavigationButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left transition-colors",
        active
          ? "bg-white/[0.06] text-white"
          : "text-slate-400 hover:bg-white/[0.03] hover:text-slate-200",
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-colors",
          active ? "text-cyan-200" : "text-slate-500 group-hover:text-slate-300",
        )}
      />
      <span className="text-[13px] font-medium tracking-[0.01em]">{label}</span>
    </button>
  );
}

export function MobileNav({
  items,
  activeSection,
  onSelect,
}: {
  items: Array<{
    id: SectionId;
    label: string;
    icon: LucideIcon;
  }>;
  activeSection: SectionId;
  onSelect: (section: SectionId) => void;
}) {
  return (
    <div className="glass-panel flex gap-1.5 overflow-x-auto p-1.5 min-[1680px]:hidden">
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.id === activeSection;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={cn(
              "flex min-w-[104px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-[13px] font-medium transition-colors",
              active
                ? "bg-white/[0.06] text-white"
                : "bg-transparent text-slate-400 hover:bg-white/[0.03] hover:text-slate-200",
            )}
          >
            <Icon
              className={cn(
                "h-4 w-4",
                active ? "text-cyan-200" : "text-slate-500",
              )}
            />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
  icon: Icon,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {Icon ? <Icon className="h-4 w-4 text-slate-400" /> : null}
          <h3 className="text-base font-semibold text-white">{title}</h3>
        </div>
        {subtitle ? <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function QuietPanel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("quiet-panel min-w-0", className)}>{children}</section>
  );
}

export function CommandBar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("command-bar", className)}>{children}</div>;
}

export function MetricStrip({
  columns,
  className,
  children,
}: {
  columns: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("metric-strip", columns, className)}>{children}</div>
  );
}

export function MetricStripItem({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta?: string;
}) {
  return (
    <div className="metric-strip-item">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="text-[1.4rem] font-semibold tabular-nums text-white">{value}</p>
      {meta ? <p className="text-[11px] text-slate-400">{meta}</p> : null}
    </div>
  );
}

export function FlatList({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("flat-list", className)}>{children}</div>;
}

export function FlatListRow({
  className,
  onClick,
  children,
}: {
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn("flat-list-row w-full text-left", className)}>
        {children}
      </button>
    );
  }
  return <div className={cn("flat-list-row", className)}>{children}</div>;
}

export function SoftDivider({ className }: { className?: string }) {
  return <div role="separator" className={cn("soft-divider", className)} />;
}
