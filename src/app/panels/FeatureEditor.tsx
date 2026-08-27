/**
 * Feature editor.
 *
 * Place and tune the architectural moves — canopy, balconies, lobby volume,
 * fins, terrace and the rest — with what each one costs shown while you make
 * it. That readout is the point: a feature editor without it is a form, and
 * these are decisions that get argued about in dollars.
 */

import { useState } from "react";
import {
  FEATURE_COST_NOTES,
  FEATURE_LABELS,
  WHOLE_BUILDING_FEATURES,
  type Feature,
  type FeatureKind,
} from "@/domain/features";
import type { Mass } from "@/domain/massing";
import { massSegments } from "@/domain/massing";
import type { FeatureCost } from "@/domain/featureCost";
import { Chip, Empty, Field, NumberInput, Section, Segmented, Select } from "@/ui/primitives";
import { money, num } from "@/ui/format";

/** Grouped so the menu reads like a design conversation, not an alphabet. */
const FEATURE_GROUPS: { group: string; kinds: FeatureKind[] }[] = [
  { group: "Entry & arrival", kinds: ["canopy", "porte_cochere", "lobby", "plaza"] },
  { group: "Facade", kinds: ["sunshade", "brise_soleil", "bay", "feature_corner", "balcony", "loggia"] },
  { group: "Volume", kinds: ["atrium", "connector"] },
  { group: "Roof & outdoor", kinds: ["terrace", "roof_screen", "cornice", "pergola"] },
];

interface Props {
  mass: Mass;
  costs: Record<string, FeatureCost>;
  onAdd: (kind: FeatureKind) => void;
  onPatch: (featureId: string, patch: Partial<Feature>) => void;
  onRemove: (featureId: string) => void;
  onDuplicate: (featureId: string) => void;
}

export function FeatureEditor({ mass, costs, onAdd, onPatch, onRemove, onDuplicate }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const features = mass.features ?? [];
  const segments = massSegments(mass);

  const total = features
    .filter((f) => !f.disabled)
    .reduce((a, f) => a + (costs[f.id]?.amount ?? 0), 0);

  return (
    <Section
      title="Architectural features"
      meta={features.length ? `${features.filter((f) => !f.disabled).length} · ${money(total)}` : undefined}
    >
      {features.length === 0 ? (
        <Empty>
          No features yet. A canopy, a glazed lobby or a set of fins is usually the difference
          between a massing diagram and something a client recognises.
        </Empty>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          {features.map((feature) => (
            <FeatureRow
              key={feature.id}
              feature={feature}
              cost={costs[feature.id]}
              segments={segments}
              mass={mass}
              expanded={open === feature.id}
              onToggleExpand={() => setOpen(open === feature.id ? null : feature.id)}
              onPatch={(patch) => onPatch(feature.id, patch)}
              onRemove={() => onRemove(feature.id)}
              onDuplicate={() => onDuplicate(feature.id)}
            />
          ))}
        </div>
      )}

      <div className="mt-2">
        <Field label="Add a feature">
          <Select
            value=""
            onChange={(kind) => kind && onAdd(kind as FeatureKind)}
            options={[
              { value: "", label: "Choose…" },
              ...FEATURE_GROUPS.flatMap((g) =>
                g.kinds.map((k) => ({ value: k, label: FEATURE_LABELS[k], group: g.group })),
              ),
            ]}
          />
        </Field>
      </div>

      {features.length > 0 && (
        <p className="hint mt-2">
          Features priced at <b className="num">{money(total)}</b> direct. Envelope side effects —
          a bay adding wall, a loggia removing plate — are priced in the shell and structure
          divisions rather than counted here, so nothing is charged twice.
        </p>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------

function FeatureRow({
  feature,
  cost,
  segments,
  mass,
  expanded,
  onToggleExpand,
  onPatch,
  onRemove,
  onDuplicate,
}: {
  feature: Feature;
  cost?: FeatureCost;
  segments: ReturnType<typeof massSegments>;
  mass: Mass;
  expanded: boolean;
  onToggleExpand: () => void;
  onPatch: (patch: Partial<Feature>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const wholeBuilding = WHOLE_BUILDING_FEATURES.has(feature.kind);
  const segment = segments[feature.segment];
  const disabled = Boolean(feature.disabled);

  return (
    <div
      style={{
        border: "1px solid " + (expanded ? "var(--line-strong)" : "var(--line)"),
        borderRadius: "var(--r-sm)",
        background: disabled ? "transparent" : "var(--panel-alt)",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <button
        onClick={onToggleExpand}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 8,
          alignItems: "center",
          width: "100%",
          padding: "8px 10px",
          border: 0,
          background: "transparent",
          color: "inherit",
          textAlign: "left",
        }}
      >
        <span style={{ minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{FEATURE_LABELS[feature.kind]}</span>
          <span className="row" style={{ gap: 5, marginTop: 2, justifyContent: "flex-start" }}>
            {wholeBuilding ? (
              <Chip>whole building</Chip>
            ) : segment ? (
              <Chip>{segment.cardinal} wall · {Math.round(segment.length)}′</Chip>
            ) : (
              <Chip kind="warn">wall gone</Chip>
            )}
            {disabled && <Chip kind="warn">off</Chip>}
          </span>
        </span>
        <span className="num" style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>
          {cost ? money(cost.amount) : "—"}
        </span>
      </button>

      {expanded && (
        <div style={{ padding: "0 10px 10px" }}>
          {!wholeBuilding && (
            <div className="grid-2">
              <Field label="Wall">
                <Select
                  value={String(feature.segment)}
                  onChange={(v) => onPatch({ segment: Number(v) } as Partial<Feature>)}
                  options={segments
                    .filter((s) => !s.courtFacing)
                    .map((s) => ({
                      value: String(s.index),
                      label: `${s.cardinal} · ${Math.round(s.length)}′`,
                    }))}
                />
              </Field>
              <Field label="Position along wall">
                <NumberInput
                  value={Math.round(feature.along * 100)}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(v) => onPatch({ along: Math.max(0, Math.min(1, v / 100)) } as Partial<Feature>)}
                />
              </Field>
            </div>
          )}

          <div className="mt-2">
            <FeatureParams feature={feature} mass={mass} onPatch={onPatch} />
          </div>

          {cost && cost.lines.length > 0 && (
            <table className="table mt-2">
              <tbody>
                {cost.lines.map((line) => (
                  <tr key={line.key}>
                    <td className="truncate" title={line.label}>{line.label}</td>
                    <td className="n">
                      {num(Math.round(line.quantity))}
                      <span className="label" style={{ marginLeft: 3 }}>{line.uom}</span>
                    </td>
                    <td className="n">{money(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {cost && hasEnvelopeEffect(cost) && (
            <p className="hint mt-1">
              Also changes the shell:{" "}
              {cost.envelopeEffect.wall !== 0 && <>{fmtDelta(cost.envelopeEffect.wall)} SF wall. </>}
              {cost.envelopeEffect.glazing !== 0 && <>{fmtDelta(cost.envelopeEffect.glazing)} SF glazing. </>}
              {cost.envelopeEffect.plate !== 0 && (
                <><b style={{ color: "var(--warn)" }}>{fmtDelta(cost.envelopeEffect.plate)} SF floor area.</b> </>
              )}
              Priced in the shell and structure divisions.
            </p>
          )}

          {cost && cost.unpriced.length > 0 && (
            <p className="hint mt-1" style={{ color: "var(--warn)" }}>
              No rate for {cost.unpriced.join(", ")} — excluded rather than assumed free.
            </p>
          )}

          <p className="hint mt-1">{FEATURE_COST_NOTES[feature.kind]}</p>

          <div className="row mt-2" style={{ gap: 6, justifyContent: "flex-start" }}>
            <button
              className={`btn sm${disabled ? "" : " active"}`}
              onClick={() => onPatch({ disabled: !disabled } as Partial<Feature>)}
              title="Turn off without deleting, to compare options"
            >
              {disabled ? "Off" : "On"}
            </button>
            <button className="btn sm" onClick={onDuplicate}>Duplicate</button>
            <button className="btn sm" style={{ color: "var(--bad)" }} onClick={onRemove}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

const hasEnvelopeEffect = (cost: FeatureCost) =>
  cost.envelopeEffect.wall !== 0 || cost.envelopeEffect.glazing !== 0 || cost.envelopeEffect.plate !== 0;

const fmtDelta = (value: number) => `${value > 0 ? "+" : "−"}${num(Math.abs(Math.round(value)))}`;

// ---------------------------------------------------------------------------

/** Kind-specific parameters. Each control edits the number that both draws and prices. */
function FeatureParams({
  feature,
  mass,
  onPatch,
}: {
  feature: Feature;
  mass: Mass;
  onPatch: (patch: Partial<Feature>) => void;
}) {
  const set = (patch: Record<string, unknown>) => onPatch(patch as Partial<Feature>);
  const topFloor = Math.max(0, mass.floors - 1);

  const floorRange = (from: number, to: number) => (
    <div className="grid-2">
      <Field label="From floor">
        <NumberInput
          value={from}
          min={0}
          max={topFloor}
          onChange={(v) => set({ fromFloor: Math.round(v) })}
        />
      </Field>
      <Field label="To floor" hint={to > topFloor ? `Clamped to ${topFloor}` : undefined}>
        <NumberInput
          value={Math.min(to, topFloor)}
          min={0}
          max={topFloor}
          onChange={(v) => set({ toFloor: Math.round(v) })}
        />
      </Field>
    </div>
  );

  switch (feature.kind) {
    case "canopy":
      return (
        <>
          <div className="grid-3">
            <Field label="Width (ft)">
              <NumberInput value={feature.width} min={4} onChange={(v) => set({ width: v })} />
            </Field>
            <Field label="Projection (ft)">
              <NumberInput value={feature.projection} min={2} onChange={(v) => set({ projection: v })} />
            </Field>
            <Field label="Height (ft)">
              <NumberInput value={feature.height} min={8} onChange={(v) => set({ height: v })} />
            </Field>
          </div>
          <Field label="Support">
            <Segmented
              value={feature.support}
              onChange={(v) => set({ support: v })}
              options={[
                { value: "cantilever", label: "Cantilever" },
                { value: "column", label: "Column" },
                { value: "suspended", label: "Suspended" },
              ]}
            />
          </Field>
        </>
      );

    case "porte_cochere":
      return (
        <div className="grid-2">
          <Field label="Width (ft)">
            <NumberInput value={feature.width} min={16} onChange={(v) => set({ width: v })} />
          </Field>
          <Field label="Projection (ft)">
            <NumberInput value={feature.projection} min={12} onChange={(v) => set({ projection: v })} />
          </Field>
          <Field label="Clear height (ft)" hint="14ft minimum for an ambulance">
            <NumberInput value={feature.height} min={9} onChange={(v) => set({ height: v })} />
          </Field>
          <Field label="Columns">
            <NumberInput value={feature.columns} min={2} max={12} onChange={(v) => set({ columns: Math.round(v) })} />
          </Field>
        </div>
      );

    case "lobby":
      return (
        <div className="grid-3">
          <Field label="Width (ft)">
            <NumberInput value={feature.width} min={10} onChange={(v) => set({ width: v })} />
          </Field>
          <Field label="Projection (ft)">
            <NumberInput value={feature.projection} min={0} onChange={(v) => set({ projection: v })} />
          </Field>
          <Field label="Floors tall">
            <NumberInput value={feature.floors} min={1} max={4} onChange={(v) => set({ floors: Math.round(v) })} />
          </Field>
        </div>
      );

    case "bay":
      return (
        <>
          <div className="grid-2">
            <Field label="Width (ft)">
              <NumberInput value={feature.width} min={4} onChange={(v) => set({ width: v })} />
            </Field>
            <Field label="Projection (ft)">
              <NumberInput value={feature.projection} min={1} max={12} step={0.5} onChange={(v) => set({ projection: v })} />
            </Field>
          </div>
          {floorRange(feature.fromFloor, feature.toFloor)}
          <label className="row mt-1" style={{ gap: 6, justifyContent: "flex-start", fontSize: 12 }}>
            <input type="checkbox" checked={feature.glazed} onChange={(e) => set({ glazed: e.target.checked })} />
            Glazed
          </label>
        </>
      );

    case "sunshade":
      return (
        <div className="grid-2">
          <Field label="Coverage (%)">
            <NumberInput
              value={Math.round(feature.coverage * 100)}
              min={0}
              max={100}
              onChange={(v) => set({ coverage: v / 100 })}
            />
          </Field>
          <Field label="Projection (ft)">
            <NumberInput value={feature.projection} min={1} step={0.5} onChange={(v) => set({ projection: v })} />
          </Field>
        </div>
      );

    case "brise_soleil":
      return (
        <>
          <div className="grid-3">
            <Field label="Coverage (%)">
              <NumberInput
                value={Math.round(feature.coverage * 100)}
                min={0}
                max={100}
                onChange={(v) => set({ coverage: v / 100 })}
              />
            </Field>
            <Field label="Fin depth (ft)">
              <NumberInput value={feature.projection} min={0.5} step={0.5} onChange={(v) => set({ projection: v })} />
            </Field>
            <Field
              label="Spacing (ft)"
              hint={feature.spacing < feature.projection * 2 ? "Closer than twice the depth reads as solid" : undefined}
            >
              <NumberInput value={feature.spacing} min={0.75} step={0.5} onChange={(v) => set({ spacing: v })} />
            </Field>
          </div>
          <Field label="Orientation">
            <Segmented
              value={feature.orientation}
              onChange={(v) => set({ orientation: v })}
              options={[
                { value: "vertical", label: "Vertical fins" },
                { value: "horizontal", label: "Horizontal blades" },
              ]}
            />
          </Field>
        </>
      );

    case "balcony":
      return (
        <>
          <div className="grid-3">
            <Field label="Width (ft)">
              <NumberInput value={feature.width} min={4} onChange={(v) => set({ width: v })} />
            </Field>
            <Field label="Depth (ft)">
              <NumberInput value={feature.projection} min={3} step={0.5} onChange={(v) => set({ projection: v })} />
            </Field>
            <Field label="Per floor">
              <NumberInput value={feature.count} min={1} max={24} onChange={(v) => set({ count: Math.round(v) })} />
            </Field>
          </div>
          {floorRange(feature.fromFloor, feature.toFloor)}
          <label className="row mt-1" style={{ gap: 6, justifyContent: "flex-start", fontSize: 12 }}>
            <input type="checkbox" checked={feature.recessed} onChange={(e) => set({ recessed: e.target.checked })} />
            Recessed — cuts into the floor plate instead of hanging off it
          </label>
        </>
      );

    case "loggia":
      return (
        <>
          <div className="grid-2">
            <Field label="Width (ft)">
              <NumberInput value={feature.width} min={8} onChange={(v) => set({ width: v })} />
            </Field>
            <Field label="Depth into plan (ft)">
              <NumberInput value={feature.depth} min={4} onChange={(v) => set({ depth: v })} />
            </Field>
          </div>
          {floorRange(feature.fromFloor, feature.toFloor)}
        </>
      );

    case "feature_corner":
      return (
        <>
          <Field label="Wrap onto each wall (ft)">
            <NumberInput value={feature.wrap} min={6} onChange={(v) => set({ wrap: v })} />
          </Field>
          {floorRange(feature.fromFloor, feature.toFloor)}
        </>
      );

    case "atrium":
      return (
        <>
          <div className="grid-3">
            <Field label="Width (ft)">
              <NumberInput value={feature.width} min={10} onChange={(v) => set({ width: v })} />
            </Field>
            <Field label="Depth (ft)">
              <NumberInput value={feature.depth} min={10} onChange={(v) => set({ depth: v })} />
            </Field>
            <Field label="Floors">
              <NumberInput
                value={feature.floors}
                min={2}
                max={Math.max(2, mass.floors)}
                onChange={(v) => set({ floors: Math.round(v) })}
              />
            </Field>
          </div>
          <label className="row mt-1" style={{ gap: 6, justifyContent: "flex-start", fontSize: 12 }}>
            <input type="checkbox" checked={feature.skylight} onChange={(e) => set({ skylight: e.target.checked })} />
            Skylight
          </label>
        </>
      );

    case "connector":
      return (
        <>
          <div className="grid-3">
            <Field label="Span (ft)">
              <NumberInput value={feature.length} min={10} onChange={(v) => set({ length: v })} />
            </Field>
            <Field label="Width (ft)">
              <NumberInput value={feature.width} min={6} onChange={(v) => set({ width: v })} />
            </Field>
            <Field label="Floors">
              <NumberInput value={feature.floors} min={1} max={4} onChange={(v) => set({ floors: Math.round(v) })} />
            </Field>
          </div>
          <Field label="Height above base (ft)">
            <NumberInput value={feature.height} min={0} onChange={(v) => set({ height: v })} />
          </Field>
          <label className="row mt-1" style={{ gap: 6, justifyContent: "flex-start", fontSize: 12 }}>
            <input type="checkbox" checked={feature.glazed} onChange={(e) => set({ glazed: e.target.checked })} />
            Glazed
          </label>
        </>
      );

    case "terrace":
      return (
        <>
          <div className="grid-2">
            <Field label="Deck area (SF)">
              <NumberInput value={feature.area} min={100} step={100} onChange={(v) => set({ area: v })} />
            </Field>
            <Field label="Guard rail (ft)">
              <NumberInput value={feature.railing} min={0} step={10} onChange={(v) => set({ railing: v })} />
            </Field>
          </div>
          <label className="row mt-1" style={{ gap: 6, justifyContent: "flex-start", fontSize: 12 }}>
            <input type="checkbox" checked={feature.planters} onChange={(e) => set({ planters: e.target.checked })} />
            Planters
          </label>
        </>
      );

    case "plaza":
      return (
        <>
          <div className="grid-3">
            <Field label="Width (ft)">
              <NumberInput value={feature.width} min={10} onChange={(v) => set({ width: v })} />
            </Field>
            <Field label="Depth (ft)">
              <NumberInput value={feature.depth} min={10} onChange={(v) => set({ depth: v })} />
            </Field>
            <Field label="Seat wall (ft)">
              <NumberInput value={feature.seatWall} min={0} step={5} onChange={(v) => set({ seatWall: v })} />
            </Field>
          </div>
          <Field label="Paving">
            <Segmented
              value={feature.grade}
              onChange={(v) => set({ grade: v })}
              options={[
                { value: "plain", label: "Plain" },
                { value: "unit_paver", label: "Unit paver" },
                { value: "feature", label: "Feature" },
              ]}
            />
          </Field>
        </>
      );

    case "pergola":
      return (
        <>
          <div className="grid-3">
            <Field label="Width (ft)">
              <NumberInput value={feature.width} min={8} onChange={(v) => set({ width: v })} />
            </Field>
            <Field label="Projection (ft)">
              <NumberInput value={feature.projection} min={6} onChange={(v) => set({ projection: v })} />
            </Field>
            <Field label="Height (ft)">
              <NumberInput value={feature.height} min={7} onChange={(v) => set({ height: v })} />
            </Field>
          </div>
          <Field label="Material">
            <Segmented
              value={feature.material}
              onChange={(v) => set({ material: v })}
              options={[
                { value: "timber", label: "Timber" },
                { value: "steel", label: "Steel" },
                { value: "aluminium", label: "Aluminium" },
              ]}
            />
          </Field>
        </>
      );

    case "roof_screen":
      return (
        <>
          <div className="grid-2">
            <Field label="Height (ft)">
              <NumberInput value={feature.height} min={3} onChange={(v) => set({ height: v })} />
            </Field>
            <Field label="Coverage (%)">
              <NumberInput
                value={Math.round(feature.coverage * 100)}
                min={0}
                max={100}
                onChange={(v) => set({ coverage: v / 100 })}
              />
            </Field>
          </div>
          <Field label="Material">
            <Segmented
              value={feature.material}
              onChange={(v) => set({ material: v })}
              options={[
                { value: "mesh", label: "Mesh" },
                { value: "panel", label: "Panel" },
                { value: "louver", label: "Louver" },
              ]}
            />
          </Field>
        </>
      );

    case "cornice":
      return (
        <div className="grid-2">
          <Field label="Depth (ft)">
            <NumberInput value={feature.depth} min={0.5} step={0.5} onChange={(v) => set({ depth: v })} />
          </Field>
          <Field label="Projection (ft)">
            <NumberInput value={feature.projection} min={0.5} step={0.5} onChange={(v) => set({ projection: v })} />
          </Field>
        </div>
      );
  }
}
