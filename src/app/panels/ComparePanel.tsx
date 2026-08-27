/**
 * Scheme comparison.
 *
 * The point of iterating by type is being able to put the options side by side,
 * so this reads across every scheme at once rather than one at a time. Deltas
 * are always against the baseline scheme, which the rail lets you change.
 */

import { TYPE_BY_ID } from "@/markets/registry";
import { useProject } from "../store/useProject";
import { Empty, Section } from "@/ui/primitives";
import { money, num, rate, signedPct } from "@/ui/format";

export function ComparePanel() {
  const project = useProject((s) => s.project);
  const estimates = useProject((s) => s.estimates);
  const setActiveScheme = useProject((s) => s.setActiveScheme);
  const addLogEntry = useProject((s) => s.addLogEntry);

  const baseline = estimates[project.baselineSchemeId];
  const rows = project.schemes.map((scheme) => ({
    scheme,
    type: TYPE_BY_ID[scheme.typeId],
    est: estimates[scheme.id],
  }));

  if (rows.every((r) => !r.est)) return <Empty>Pricing schemes…</Empty>;

  return (
    <>
      <Section title="Schemes" meta={`vs. ${project.schemes.find((s) => s.id === project.baselineSchemeId)?.name ?? "baseline"}`}>
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ minWidth: 320 }}>
            <thead>
              <tr>
                <th>Scheme</th>
                <th className="n">GSF</th>
                <th className="n">$/GSF</th>
                <th className="n">Total</th>
                <th className="n">Δ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ scheme, type, est }) => {
                const total = est?.bottomUp.project;
                const delta =
                  scheme.id !== project.baselineSchemeId && total != null && baseline
                    ? ((total - baseline.bottomUp.project) / baseline.bottomUp.project) * 100
                    : null;
                const isActive = scheme.id === project.activeSchemeId;
                return (
                  <tr
                    key={scheme.id}
                    onClick={() => setActiveScheme(scheme.id)}
                    style={{
                      cursor: "pointer",
                      background: isActive ? "var(--panel-alt)" : undefined,
                    }}
                  >
                    <td>
                      <div style={{ fontWeight: isActive ? 600 : 500 }} className="truncate">{scheme.name}</div>
                      <div className="label">{type?.short ?? ""}</div>
                    </td>
                    <td className="n">{est ? num(Math.round(est.takeoff.gsf)) : "—"}</td>
                    <td className="n">{est ? rate(est.bottomUp.perGSF) : "—"}</td>
                    <td className="n">{total != null ? money(total) : "—"}</td>
                    <td className="n" style={{ color: delta == null ? "var(--ink-3)" : delta > 0 ? "var(--bad)" : "var(--good)" }}>
                      {delta == null ? "base" : signedPct(delta)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Against the market" defaultOpen>
        <p className="hint">
          How each scheme's takeoff sits against the published band for its own building type.
        </p>
        <table className="table mt-1">
          <thead>
            <tr>
              <th>Scheme</th>
              <th>Type</th>
              <th className="n">Variance</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ scheme, type, est }) => {
              const rec = est?.reconciliation;
              return (
                <tr key={scheme.id}>
                  <td className="truncate">{scheme.name}</td>
                  <td className="truncate label">{type?.short}</td>
                  <td className="n">{rec ? signedPct(rec.variancePct) : "—"}</td>
                  <td style={{ color: rec?.withinBand ? "var(--good)" : "var(--warn)", fontSize: 11 }}>
                    {rec?.verdict ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section title="Capacity and efficiency" defaultOpen={false}>
        <table className="table">
          <thead>
            <tr>
              <th>Scheme</th>
              <th className="n">Capacity</th>
              <th className="n">$/capacity</th>
              <th className="n">Floors</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ scheme, type, est }) => (
              <tr key={scheme.id}>
                <td className="truncate">{scheme.name}</td>
                <td className="n">
                  {num(scheme.targetCapacity)}
                  <div className="label">{type?.capacityLabel}</div>
                </td>
                <td className="n">
                  {est && scheme.targetCapacity > 0
                    ? money(est.bottomUp.project / scheme.targetCapacity)
                    : "—"}
                </td>
                <td className="n">{scheme.masses[0]?.floors ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Decision log" meta={project.decisionLog.length || undefined} defaultOpen={false}>
        <LogInput onAdd={addLogEntry} />
        {project.decisionLog.length === 0 ? (
          <Empty>Nothing logged yet. Record why a scheme was chosen or dropped.</Empty>
        ) : (
          <div className="stack mt-2">
            {project.decisionLog.map((entry) => (
              <div key={entry.id} style={{ borderLeft: "2px solid var(--line-strong)", paddingLeft: 9 }}>
                <div style={{ fontSize: 12 }}>{entry.text}</div>
                <div className="hint num">
                  {new Date(entry.at).toLocaleDateString()}
                  {entry.total != null && <> · {money(entry.total)}</>}
                  {entry.gsf != null && <> · {num(Math.round(entry.gsf))} GSF</>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

function LogInput({ onAdd }: { onAdd: (text: string) => void }) {
  return (
    <input
      className="control"
      placeholder="Note a decision and press Enter…"
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        const value = (e.target as HTMLInputElement).value.trim();
        if (!value) return;
        onAdd(value);
        (e.target as HTMLInputElement).value = "";
      }}
    />
  );
}
