import type { ReactNode } from "react";
import { ArrowUpRight, CircleDashed, type LucideIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "cyan" | "green" | "amber";
}) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}
export function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export function EmptyState({
  icon: Icon = CircleDashed,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={23} strokeWidth={1.4} />
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
  tone = "cyan",
}: {
  title: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
  tone?: string;
}) {
  return (
    <div className="metric-card">
      <div className="metric-top">
        <span>{title}</span>
        <div className={`metric-icon ${tone}`}>
          <Icon size={17} />
        </div>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </div>
  );
}
export function NewInspectionButton({ compact = false }: { compact?: boolean }) {
  return (
    <Button asChild size={compact ? "sm" : "default"}>
      <Link to="/inspection">
        {compact ? "New inspection" : "Start New Inspection"}
        <ArrowUpRight size={16} />
      </Link>
    </Button>
  );
}
export function PageIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-intro">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
