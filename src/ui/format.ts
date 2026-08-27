/**
 * Number formatting.
 *
 * Conceptual estimates are read at a glance, so money is abbreviated by
 * magnitude and never shown to more precision than the underlying data
 * supports. A $52.7M number written as $52,714,338 implies a confidence the
 * estimate does not have.
 */

import type { Confidence, Uom } from "@/costs/schema";

export function money(value: number, opts: { compact?: boolean; decimals?: number } = {}): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (opts.compact !== false) {
    if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
    if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}K`;
  }
  return `${sign}$${abs.toLocaleString(undefined, {
    minimumFractionDigits: opts.decimals ?? 0,
    maximumFractionDigits: opts.decimals ?? 0,
  })}`;
}

/** A rate, shown with the precision its magnitude warrants. */
export function rate(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 10_000) return money(abs);
  if (abs >= 100) return `$${abs.toFixed(0)}`;
  if (abs >= 10) return `$${abs.toFixed(1)}`;
  return `$${abs.toFixed(2)}`;
}

export function num(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function pct(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "" : "-"}${Math.abs(value).toFixed(decimals)}%`;
}

export function signedPct(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(decimals)}%`;
}

export const UOM_SHORT: Record<Uom, string> = {
  SF: "SF", GSF: "GSF", LF: "LF", CY: "CY", EA: "ea", TON: "ton",
  STALL: "stall", UNIT: "unit", KEY: "key", BED: "bed", SEAT: "seat",
  STUDENT: "student", LS: "LS",
};

export const CONFIDENCE_TONE: Record<Confidence, "good" | "warn" | "bad" | undefined> = {
  high: "good",
  medium: undefined,
  low: "warn",
  placeholder: "bad",
};

/** Short relative date, for "as of" stamps. */
export function since(iso: string | undefined): string {
  if (!iso) return "";
  const then = Date.parse(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (!Number.isFinite(then)) return "";
  const days = Math.round((Date.now() - then) / 86_400_000);
  if (days < 0) return "future";
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

export function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}
