/**
 * The iteration rail: market, then type, then schemes.
 *
 * This is the spine of the tool. The market is the project's identity and
 * changes rarely; the building type is the variable, and each scheme holds one
 * answer for it. Schemes carry their own headline number so the list itself is
 * the comparison.
 */

import { MARKETS, TYPE_BY_ID, typesForMarket } from "@/markets/registry";
import { useProject } from "../store/useProject";
import { money, num, signedPct } from "@/ui/format";
import { Field, Select } from "@/ui/primitives";
import type { Scheme } from "@/domain/project";

export function ProjectRail() {
  const project = useProject((s) => s.project);
  const estimates = useProject((s) => s.estimates);
  const setMarket = useProject((s) => s.setMarket);
  const setActiveScheme = useProject((s) => s.setActiveScheme);
  const setBaselineScheme = useProject((s) => s.setBaselineScheme);
  const setSchemeType = useProject((s) => s.setSchemeType);
  const addScheme = useProject((s) => s.addScheme);
  const duplicateScheme = useProject((s) => s.duplicateScheme);
  const removeScheme = useProject((s) => s.removeScheme);
  const renameScheme = useProject((s) => s.renameScheme);

  const market = MARKETS.find((m) => m.id === project.marketId);
  const types = typesForMarket(project.marketId);
  const active = project.schemes.find((s) => s.id === project.activeSchemeId) ?? project.schemes[0];
  const baseline = estimates[project.baselineSchemeId];

  return (
    <>
      <div className="rail-section">
        <Field label="Market">
          <Select
            value={project.marketId}
            onChange={setMarket}
            options={MARKETS.map((m) => ({ value: m.id, label: m.label }))}
          />
        </Field>
        {market && (
          <p className="hint" style={{ marginTop: 7 }}>{market.description}</p>
        )}
      </div>

      <div className="rail-section">
        <Field label="Building type" hint={TYPE_BY_ID[active?.typeId ?? ""]?.description}>
          <Select
            value={active?.typeId ?? types[0]?.id ?? ""}
            onChange={(typeId) => active && setSchemeType(active.id, typeId)}
            options={types.map((t) => ({ value: t.id, label: t.label }))}
          />
        </Field>
      </div>

      <div className="fill scroll">
        <div style={{ padding: "10px 12px 4px" }} className="row">
          <span className="label">Schemes</span>
          <button className="btn ghost sm" onClick={() => addScheme()} title="Add a scheme">
            + Add
          </button>
        </div>

        <div style={{ padding: "0 8px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
          {project.schemes.map((scheme) => (
            <SchemeRow
              key={scheme.id}
              scheme={scheme}
              selected={scheme.id === project.activeSchemeId}
              isBaseline={scheme.id === project.baselineSchemeId}
              total={estimates[scheme.id]?.bottomUp.project}
              gsf={estimates[scheme.id]?.takeoff.gsf}
              baselineTotal={baseline?.bottomUp.project}
              canRemove={project.schemes.length > 1}
              onSelect={() => setActiveScheme(scheme.id)}
              onSetBaseline={() => setBaselineScheme(scheme.id)}
              onDuplicate={() => duplicateScheme(scheme.id)}
              onRemove={() => removeScheme(scheme.id)}
              onRename={(name) => renameScheme(scheme.id, name)}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function SchemeRow({
  scheme,
  selected,
  isBaseline,
  total,
  gsf,
  baselineTotal,
  canRemove,
  onSelect,
  onSetBaseline,
  onDuplicate,
  onRemove,
  onRename,
}: {
  scheme: Scheme;
  selected: boolean;
  isBaseline: boolean;
  total?: number;
  gsf?: number;
  baselineTotal?: number;
  canRemove: boolean;
  onSelect: () => void;
  onSetBaseline: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
}) {
  const type = TYPE_BY_ID[scheme.typeId];
  // Only show a delta once there is a baseline that is not this scheme.
  const delta =
    !isBaseline && total != null && baselineTotal != null && baselineTotal > 0
      ? ((total - baselineTotal) / baselineTotal) * 100
      : null;

  return (
    <div
      className="rail-item"
      aria-selected={selected}
      onClick={onSelect}
      style={{ flexDirection: "column", alignItems: "stretch", gap: 3, cursor: "pointer" }}
    >
      <div className="row">
        <input
          value={scheme.name}
          onChange={(e) => onRename(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          style={{
            border: 0,
            background: "transparent",
            font: "inherit",
            fontWeight: selected ? 600 : 500,
            color: "inherit",
            padding: 0,
            minWidth: 0,
            flex: 1,
          }}
        />
        {isBaseline && <span className="chip">base</span>}
      </div>

      <div className="row" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
        <span className="truncate">{type?.short ?? scheme.typeId}</span>
        <span className="num">{gsf != null ? `${num(Math.round(gsf))} GSF` : "—"}</span>
      </div>

      <div className="row">
        <span className="num" style={{ fontSize: 13, fontWeight: 600 }}>
          {total != null ? money(total) : "—"}
        </span>
        {delta != null && (
          <span
            className="num"
            style={{ fontSize: 10.5, color: delta > 0 ? "var(--bad)" : "var(--good)" }}
          >
            {signedPct(delta)}
          </span>
        )}
      </div>

      {selected && (
        <div className="row" style={{ gap: 4, marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
          <button className="btn ghost sm" onClick={onDuplicate}>Fork</button>
          {!isBaseline && (
            <button className="btn ghost sm" onClick={onSetBaseline}>Set base</button>
          )}
          {canRemove && (
            <button className="btn ghost sm" style={{ color: "var(--bad)" }} onClick={onRemove}>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
