/**
 * UI primitives.
 *
 * Small, unopinionated wrappers over the design tokens. Anything that needs to
 * know about a project, a scheme, or a cost belongs in a panel, not here.
 */

import { useState, type ReactNode } from "react";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function NumberInput({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  // Kept as text while focused so a partially typed number is not clobbered
  // mid-keystroke by clamping.
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <span style={{ position: "relative", display: "block" }}>
      <input
        className="control"
        type="number"
        value={draft ?? value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null) {
            const parsed = Number(draft);
            if (Number.isFinite(parsed)) {
              onChange(Math.max(min, max != null ? Math.min(max, parsed) : parsed));
            }
            setDraft(null);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(null);
        }}
        style={suffix ? { paddingRight: 30 } : undefined}
      />
      {suffix && (
        <span
          className="label"
          style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
        >
          {suffix}
        </span>
      )}
    </span>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; group?: string }[];
}) {
  const groups = new Map<string, typeof options>();
  for (const o of options) {
    const key = o.group ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }
  const grouped = groups.size > 1 || !groups.has("");

  return (
    <select className="control" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {grouped
        ? [...groups.entries()].map(([group, items]) =>
            group ? (
              <optgroup key={group} label={group}>
                {items.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            ) : (
              items.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))
            ),
          )
        : options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
    </select>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; title?: string }[];
}) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Section({
  title,
  meta,
  defaultOpen = true,
  children,
}: {
  title: string;
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <button className="section-head" type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="section-title">{title}</span>
        <span className="row" style={{ gap: 8 }}>
          {meta && <span className="section-meta">{meta}</span>}
          <Chevron open={open} />
        </span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        color: "var(--ink-3)",
        transform: open ? "rotate(180deg)" : "none",
        transition: "transform 0.14s",
        flex: "0 0 auto",
      }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function Kpi({
  label,
  value,
  unit,
  tone,
  title,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "good" | "warn" | "bad";
  title?: string;
}) {
  const color = tone ? `var(--${tone})` : "var(--ink)";
  return (
    <div className="kpi" title={title}>
      <span className="label">{label}</span>
      <span className="kpi-value" style={{ color }}>
        {value}
        {unit && <span className="kpi-unit">{unit}</span>}
      </span>
    </div>
  );
}

export function Chip({ kind, children, title }: { kind?: string; children: ReactNode; title?: string }) {
  return (
    <span className={`chip${kind ? ` ${kind}` : ""}`} title={title}>
      {children}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal" style={width ? { width: `min(${width}px, 100%)` } : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong style={{ fontSize: 13.5 }}>{title}</strong>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body scroll">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: "28px 16px", textAlign: "center", color: "var(--ink-3)", fontSize: 12 }}>{children}</div>
  );
}

/** Horizontal proportion bar, one segment per entry. */
export function Meter({ parts }: { parts: { value: number; color: string; label?: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className="meter">
      {parts.map((p, i) => (
        <span
          key={i}
          title={p.label}
          style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
        />
      ))}
    </div>
  );
}
