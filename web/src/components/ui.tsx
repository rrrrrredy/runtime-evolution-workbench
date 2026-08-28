import type { ReactNode } from "react";

export function StatusBadge({ value, label }: { value: string; label?: string }) {
  const normalized = value.toLowerCase();
  const tone = normalized.includes("success") || normalized.includes("pass") || normalized.includes("supported") || normalized === "complete"
    ? "positive"
    : normalized.includes("fail") || normalized.includes("conflict") || normalized.includes("error") || normalized.includes("timeout")
      ? "negative"
      : normalized.includes("partial") || normalized.includes("unknown") || normalized.includes("inconclusive")
        ? "warning"
        : "neutral";
  return <span className={`status-badge status-${tone}`}>{label ?? value.replaceAll("_", " ")}</span>;
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-mark" aria-hidden="true">◇</div>
      <h2>{title}</h2>
      <div className="muted empty-copy">{children}</div>
      {action === undefined ? null : <div className="empty-action">{action}</div>}
    </div>
  );
}

export function SectionHeading({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow === undefined ? null : <div className="eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function formatTime(value: string | null): string {
  if (value === null) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function duration(start: string, end: string | null): string {
  if (end === null) return "running";
  const milliseconds = Math.max(0, Date.parse(end) - Date.parse(start));
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
