// Primitivas visuais da gestão, na linguagem Ledgerix (verde/preto/cinza).
// Todas puras (sem hooks) → Server Components. O accent usa os utilitários
// `brand` (recoloridos para verde pelo scope .gestao em globals.css); os
// restantes tokens via valores arbitrários var(--ink|gray|line|card|bg).

import Link from "next/link";
import { IconArrowUpRight, IconArrowDownRight } from "./icons";

// ── Cartão base ────────────────────────────────────────────────────────────
export function Card({
  children,
  className = "",
  as: As = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}) {
  return (
    <As
      className={`rounded-2xl border border-[var(--line)] bg-[var(--card)] ${className}`}
    >
      {children}
    </As>
  );
}

export function CardHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-[var(--ink)]">{title}</h3>
      {action ?? (hint ? <span className="text-xs text-[var(--gray)]">{hint}</span> : null)}
    </div>
  );
}

// ── Cabeçalho de página (breadcrumb + título Fredoka + ações) ───────────────
export function PageHeader({
  crumb,
  title,
  action,
}: {
  crumb: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <nav className="flex items-center gap-1.5 text-xs text-[var(--gray)]">
          <Link href="/gestao" className="hover:text-[var(--ink)]">
            Gestão
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-[var(--ink)]">{crumb}</span>
        </nav>
        <h1 className="mt-1 font-[family-name:var(--font-logo)] text-[26px] font-semibold tracking-tight text-[var(--ink)]">
          {title}
        </h1>
      </div>
      {action}
    </div>
  );
}

// ── Pílula de variação (+12% / -4%) ─────────────────────────────────────────
export function DeltaPill({ value }: { value: number }) {
  const up = value >= 0;
  const label = `${up ? "+" : "−"}${Math.abs(value)}%`;
  return (
    <span
      className={
        up
          ? "inline-flex items-center gap-0.5 rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-[#0b3d1a]"
          : "inline-flex items-center gap-0.5 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700"
      }
    >
      {up ? (
        <IconArrowUpRight className="h-3 w-3" />
      ) : (
        <IconArrowDownRight className="h-3 w-3" />
      )}
      {label}
    </span>
  );
}

// ── KPI: rótulo + número grande (Fredoka) + delta + slot (sparkline) ────────
export function Stat({
  label,
  value,
  unit,
  delta,
  children,
  icon,
}: {
  label: string;
  value: string | number;
  unit?: string;
  delta?: number;
  children?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 text-xs text-[var(--gray)]">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 flex items-end gap-2">
        <span className="font-[family-name:var(--font-logo)] text-[30px] font-semibold leading-none text-[var(--ink)]">
          {value}
          {unit ? <span className="text-base">{unit}</span> : null}
        </span>
        {typeof delta === "number" ? <span className="mb-1"><DeltaPill value={delta} /></span> : null}
      </div>
      {children ? <div className="mt-2">{children}</div> : null}
    </Card>
  );
}

// ── Chip de estado (com ponto opcional; "no ar" tem ping) ───────────────────
type ChipTone = "ok" | "neutral" | "warn" | "danger" | "live" | "info";

const CHIP_TONE: Record<ChipTone, string> = {
  ok: "bg-brand/15 text-[#0b3d1a]",
  neutral: "bg-[var(--bg)] text-[var(--gray)]",
  warn: "bg-amber-100 text-amber-700",
  danger: "bg-red-100 text-red-700",
  live: "bg-brand/15 text-[#0b3d1a]",
  info: "bg-violet-100 text-violet-700",
};

export function StatusChip({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: React.ReactNode;
  tone?: ChipTone;
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${CHIP_TONE[tone]}`}
    >
      {dot ? (
        <span className="relative flex h-1.5 w-1.5">
          {tone === "live" ? (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
          ) : null}
          <span
            className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
              tone === "warn"
                ? "bg-amber-500"
                : tone === "danger"
                  ? "bg-red-500"
                  : tone === "neutral"
                    ? "bg-[var(--gray)]"
                    : "bg-brand"
            }`}
          />
        </span>
      ) : null}
      {children}
    </span>
  );
}
