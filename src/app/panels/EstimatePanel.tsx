/**
 * The estimate.
 *
 * Leads with the reconciliation, not with a single number: the bottom-up total
 * shown against the market band for the type, so the first thing you see is
 * whether the two agree. Below that, divisions roll down to individual lines,
 * and every line carries the source that priced it.
 */

import { useState } from "react";
import { TYPE_BY_ID } from "@/markets/registry";
import { useActiveEstimate, useActiveScheme, useProject } from "../store/useProject";
import { Chip, Empty, Field, NumberInput, Section, Segmented } from "@/ui/primitives";
import { CONFIDENCE_TONE, UOM_SHORT, money, num, pct, rate, signedPct, since } from "@/ui/format";
import type { BandPoint, DivisionTotal, EstimateLine } from "@/domain/estimate";
import type { SourceKind } from "@/costs/schema";

const SOURCE_CHIP: Record<SourceKind, string> = {
  seed: "seed",
  "destini-api": "live",
  import: "import",
  override: "override",
  derived: "seed",
};

const SOURCE_LABEL: Record<SourceKind, string> = {
  seed: "Seed",
  "destini-api": "DESTINI",
  import: "Import",
  override: "Manual",
  derived: "Derived",
};

export function EstimatePanel() {
  const estimate = useActiveEstimate();
  const scheme = useActiveScheme();
  const project = useProject((s) => s.project);
  const estimating = useProject((s) => s.estimating);
  const patchSettings = useProject((s) => s.patchSettings);

  if (!estimate || !scheme) {
    return <Empty>{estimating ? "Pricing…" : "No estimate yet."}</Empty>;
  }

  const { bottomUp, conceptual, reconciliation, takeoff } = estimate;
  const type = TYPE_BY_ID[scheme.typeId];

  return (
    <>
      {reconciliation && conceptual && (
        <Section
          title="Reconciliation"
          meta={
            <span style={{ color: reconciliation.withinBand ? "var(--good)" : "var(--warn)" }}>
              {reconciliation.verdict}
            </span>
          }
        >
          <p className="hint">
            Two independent readings of this scheme: the takeoff priced line by line, against the
            market band for {type?.label.toLowerCase() ?? "this type"}. Compared at{" "}
            <b>{reconciliation.scope}</b> scope.
          </p>

          <BandChart
            low={reconciliation.conceptualLow}
            likely={reconciliation.conceptualLikely}
            high={reconciliation.conceptualHigh}
            actual={reconciliation.bottomUp}
          />

          <div className="grid-2 mt-2">
            <Readout
              label="Takeoff"
              value={money(reconciliation.bottomUp)}
              sub={`${rate(bottomUp.construction / Math.max(1, takeoff.gsf))} / GSF`}
            />
            <Readout
              label="Market band"
              value={money(reconciliation.conceptualLikely)}
              sub={`${money(reconciliation.conceptualLow)} – ${money(reconciliation.conceptualHigh)}`}
            />
          </div>

          <div
            className="row mt-2"
            style={{
              padding: "8px 10px",
              borderRadius: "var(--r-sm)",
              background: "var(--panel-alt)",
              border: "1px solid var(--line)",
            }}
          >
            <span style={{ fontSize: 11.5 }}>Variance to market</span>
            <span
              className="num"
              style={{
                fontWeight: 600,
                color: reconciliation.withinBand
                  ? "var(--good)"
                  : Math.abs(reconciliation.variancePct) > 25
                    ? "var(--bad)"
                    : "var(--warn)",
              }}
            >
              {signedPct(reconciliation.variancePct)} · {money(reconciliation.variance)}
            </span>
          </div>

          <p className="hint mt-2">
            Band from <b>{conceptual.provenance.sourceLabel}</b>
            {conceptual.provenance.asOf && <> · {since(conceptual.provenance.asOf)}</>}
            {conceptual.provenance.sampleSize != null && <> · {conceptual.provenance.sampleSize} projects</>}
          </p>
        </Section>
      )}

      <Section title="Summary" meta={`${num(Math.round(takeoff.gsf))} GSF`}>
        <div className="grid-2">
          <Readout label="Direct cost" value={money(bottomUp.direct)} sub={`${rate(bottomUp.direct / Math.max(1, takeoff.gsf))} / GSF`} />
          <Readout label="Construction" value={money(bottomUp.construction)} sub={`${rate(bottomUp.construction / Math.max(1, takeoff.gsf))} / GSF`} />
          <Readout label="Project total" value={money(bottomUp.project)} sub={`${rate(bottomUp.perGSF)} / GSF`} />
          <Readout
            label={type ? `Per ${type.capacityUom.toLowerCase()}` : "Per unit"}
            value={bottomUp.perUnit != null ? money(bottomUp.perUnit) : bottomUp.perBed != null ? money(bottomUp.perBed) : "—"}
            sub={takeoff.units > 0 ? `${num(takeoff.units)} ${type?.capacityLabel ?? "units"}` : ""}
          />
        </div>

        <div className="mt-2">
          <Field label="Price at">
            <Segmented
              value={project.settings.band}
              onChange={(v) => patchSettings({ band: v as BandPoint })}
              options={[
                { value: "low", label: "Low", title: "Optimistic end of every rate band" },
                { value: "likely", label: "Likely", title: "Mid of every rate band" },
                { value: "high", label: "High", title: "Conservative end of every rate band" },
              ]}
            />
          </Field>
        </div>

        {bottomUp.unpriced.length > 0 && (
          <div
            className="mt-2"
            style={{
              padding: "8px 10px",
              borderRadius: "var(--r-sm)",
              border: "1px solid var(--warn)",
              background: "color-mix(in srgb, var(--warn) 8%, transparent)",
            }}
          >
            <strong style={{ fontSize: 11.5, color: "var(--warn)" }}>
              {bottomUp.unpriced.length} quantit{bottomUp.unpriced.length === 1 ? "y" : "ies"} not priced
            </strong>
            <p className="hint" style={{ marginTop: 3 }}>
              No source could price {bottomUp.unpriced.map((u) => u.key).join(", ")}. These are excluded
              from the total rather than assumed to be zero-cost.
            </p>
          </div>
        )}
      </Section>

      <Section title="Where the money is" meta={`${bottomUp.divisions.length} divisions`}>
        {bottomUp.divisions.map((d) => (
          <DivisionRow key={d.id} division={d} gsf={takeoff.gsf} />
        ))}

        <div className="divider" />

        <table className="table">
          <tbody>
            {bottomUp.indirects.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.label}
                  <span className="label" style={{ marginLeft: 6 }}>{pct(i.pct, 2)}</span>
                </td>
                <td className="n label" title="Subtotal this step was taken against">
                  {money(i.base)}
                </td>
                <td className="n">{money(i.amount)}</td>
              </tr>
            ))}
            <tr>
              <td className="label">Indirect total</td>
              <td className="n"></td>
              <td className="n">{money(bottomUp.indirectTotal)}</td>
            </tr>
            <tr style={{ fontWeight: 600 }}>
              <td>Project total</td>
              <td className="n"></td>
              <td className="n">{money(bottomUp.project)}</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="Data sources" meta={`${bottomUp.sourceMix.length}`} defaultOpen={false}>
        <p className="hint">Share of direct cost priced by each source.</p>
        <table className="table mt-1">
          <tbody>
            {bottomUp.sourceMix.map((s) => (
              <tr key={s.sourceLabel}>
                <td className="truncate" title={s.sourceLabel}>{s.sourceLabel}</td>
                <td className="n">{pct(s.pct)}</td>
                <td className="n">{money(s.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint mt-2">
          Weakest confidence in this estimate:{" "}
          <Chip kind={CONFIDENCE_TONE[bottomUp.weakestConfidence]}>{bottomUp.weakestConfidence}</Chip>
        </p>
      </Section>

      <Section title="Markups" meta={`${project.settings.markups.length} steps`} defaultOpen={false}>
        <p className="hint">
          Each step is a percentage of the running subtotal, not of direct cost. That is how
          Benchmark's workbook computes it, and the difference is not small: taken flat, these
          rates land about 10% low.
        </p>
        <div className="stack mt-2" style={{ gap: 4 }}>
          {project.settings.markups.map((step, i) => (
            <div key={step.id} className="row" style={{ gap: 8, alignItems: "center" }}>
              <span style={{ flex: 1, fontSize: 12.5 }}>{step.label}</span>
              <span style={{ width: 74 }}>
                <NumberInput
                  value={step.pct}
                  min={0}
                  max={60}
                  step={0.05}
                  suffix="%"
                  onChange={(v) => {
                    const next = project.settings.markups.map((m, j) => (j === i ? { ...m, pct: v } : m));
                    patchSettings({ markups: next });
                  }}
                />
              </span>
            </div>
          ))}
        </div>
        <p className="hint mt-2">
          Project-scope steps are excluded when comparing against a construction-scope market band.
          The 8/21 owner direction cut GC personnel to 5% and design contingency to 0% on the
          Hospital and Crescent models but not on UPC 1, so these belong to the scheme.
        </p>
      </Section>

    </>
  );
}

function Readout({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="num" style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.25 }}>{value}</div>
      {sub && <div className="hint num" style={{ fontSize: 10.5 }}>{sub}</div>}
    </div>
  );
}

function BandChart({ low, likely, high, actual }: { low: number; likely: number; high: number; actual: number }) {
  // Scale to whichever is wider: the published band or the distance out to the
  // takeoff, so a number outside the band is still visible on the chart.
  const min = Math.min(low, actual) * 0.94;
  const max = Math.max(high, actual) * 1.06;
  const span = Math.max(1, max - min);
  const at = (v: number) => `${((v - min) / span) * 100}%`;

  return (
    <div className="band mt-2" title={`Band ${money(low)} – ${money(high)}, takeoff ${money(actual)}`}>
      <span className="range" style={{ left: at(low), width: `${((high - low) / span) * 100}%` }} />
      <span className="likely" style={{ left: at(likely) }} />
      <span className="actual" style={{ left: at(actual) }} />
    </div>
  );
}

function DivisionRow({ division, gsf }: { division: DivisionTotal; gsf: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid var(--line)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto auto",
          gap: 10,
          alignItems: "center",
          width: "100%",
          padding: "7px 0",
          border: 0,
          background: "transparent",
          color: "inherit",
          textAlign: "left",
        }}
      >
        <span style={{ minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 500 }}>{division.label}</span>
          <span className="meter" style={{ marginTop: 4 }}>
            <span style={{ width: `${division.pctOfDirect}%`, background: "var(--navy)" }} />
          </span>
        </span>
        <span className="num" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
          {rate(division.perGSF)}/SF
        </span>
        <span className="num" style={{ fontSize: 12.5, fontWeight: 600, minWidth: 62, textAlign: "right" }}>
          {money(division.amount)}
        </span>
      </button>

      {open && (
        <table className="table" style={{ marginBottom: 8 }}>
          <thead>
            <tr>
              <th>Line</th>
              <th className="n">Qty</th>
              <th className="n">Rate</th>
              <th className="n">Amount</th>
            </tr>
          </thead>
          <tbody>
            {division.lines.map((line) => (
              <LineRow key={line.key} line={line} />
            ))}
          </tbody>
        </table>
      )}
      {void gsf}
    </div>
  );
}

function LineRow({ line }: { line: EstimateLine }) {
  const setOverride = useProject((s) => s.setOverride);
  const clearOverride = useProject((s) => s.clearOverride);
  const [editing, setEditing] = useState(false);
  const isOverride = line.provenance.sourceKind === "override";

  return (
    <>
      <tr>
        <td style={{ minWidth: 0 }}>
          <div className="truncate" title={line.label}>{line.label}</div>
          <div style={{ display: "flex", gap: 4, marginTop: 2, flexWrap: "wrap" }}>
            <Chip
              kind={SOURCE_CHIP[line.provenance.sourceKind]}
              title={[
                line.provenance.sourceLabel,
                line.provenance.basis,
                line.provenance.note,
                line.provenance.asOf ? `as of ${line.provenance.asOf}` : "",
              ]
                .filter(Boolean)
                .join(" — ")}
            >
              {SOURCE_LABEL[line.provenance.sourceKind]}
            </Chip>
            {line.csi && <Chip title="CSI MasterFormat">{line.csi}</Chip>}
            {line.provenance.derived && <Chip title={line.provenance.note}>adj</Chip>}
          </div>
        </td>
        <td className="n">
          {num(Math.round(line.quantity))}
          <div className="label">{UOM_SHORT[line.uom]}</div>
        </td>
        <td className="n">
          <button
            className="btn ghost sm"
            style={{ fontFamily: "var(--mono)", padding: "1px 4px" }}
            onClick={() => setEditing((e) => !e)}
            title="Override this rate"
          >
            {rate(line.rate)}
          </button>
        </td>
        <td className="n">{money(line.amount)}</td>
      </tr>

      {editing && (
        <tr>
          <td colSpan={4} style={{ background: "var(--panel-alt)" }}>
            <div className="row" style={{ gap: 8 }}>
              <div style={{ flex: 1 }}>
                <span className="label">Override rate ({UOM_SHORT[line.uom]})</span>
                <NumberInput
                  value={line.baseRate}
                  min={0}
                  step={line.baseRate > 1000 ? 100 : 1}
                  onChange={(v) => {
                    setOverride(line.key, v, line.uom, line.label);
                    setEditing(false);
                  }}
                />
              </div>
              {isOverride && (
                <button
                  className="btn sm"
                  onClick={() => {
                    clearOverride(line.key);
                    setEditing(false);
                  }}
                >
                  Revert
                </button>
              )}
            </div>
            {line.superseded.length > 0 && (
              <p className="hint" style={{ marginTop: 6 }}>
                Superseding{" "}
                {line.superseded
                  .map((s) => `${rate(s.rate)} from ${s.sourceLabel}`)
                  .join(", ")}
              </p>
            )}
            {line.provenance.basis && <p className="hint">{line.provenance.basis}</p>}
            {line.provenance.note && <p className="hint">{line.provenance.note}</p>}
          </td>
        </tr>
      )}
    </>
  );
}
