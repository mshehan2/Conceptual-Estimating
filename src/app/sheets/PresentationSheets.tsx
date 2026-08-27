/**
 * Presentation sheets.
 *
 * A concept summary and an options comparison, laid out at 17x11 landscape and
 * printed straight to PDF. The sheet carries the estimate's provenance in the
 * footer on purpose: a number that leaves the building without its basis is how
 * a conceptual figure ends up quoted as a commitment.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { SchemeEstimate } from "@/domain/estimate";
import type { Project, Scheme } from "@/domain/project";
import { TYPE_BY_ID, MARKET_BY_ID } from "@/markets/registry";
import { money, num, rate, signedPct } from "@/ui/format";
import type { ViewportHandle, CameraPreset } from "@/render/Viewport";
import { CAMERA_PRESETS } from "@/render/Viewport";
import "./sheets.css";

const DIVISION_COLORS = ["#003057", "#1d5b8a", "#2f8fa8", "#5aa78d", "#c4a24d", "#a0654f"];

export interface SheetImages {
  hero?: string;
  thumbs: { label: string; src: string }[];
  /** Per-scheme shot for the comparison sheet. */
  bySchemeId: Record<string, string>;
}

// ---------------------------------------------------------------------------

export function ConceptSheet({
  project,
  scheme,
  estimate,
  images,
}: {
  project: Project;
  scheme: Scheme;
  estimate: SchemeEstimate | undefined;
  images: SheetImages;
}) {
  const type = TYPE_BY_ID[scheme.typeId];
  const market = type ? MARKET_BY_ID[type.marketId] : undefined;
  const bottomUp = estimate?.bottomUp;
  const rec = estimate?.reconciliation;
  const gsf = estimate?.takeoff.gsf ?? 0;

  return (
    <div className="sheet">
      <header className="sheet-head">
        <div>
          <div className="sheet-title">{project.name || "Untitled project"}</div>
          <div className="sheet-sub">
            {[market?.label, type?.label, scheme.name].filter(Boolean).join(" · ")}
            {project.client && ` — ${project.client}`}
            {project.location.city && ` · ${project.location.city}`}
          </div>
        </div>
        <div className="sheet-brand">
          <strong>BUD</strong>
          <span>Conceptual Estimate</span>
          <span style={{ marginTop: 4, display: "block" }}>{new Date().toLocaleDateString()}</span>
        </div>
      </header>

      <div className="sheet-body">
        <div className="sheet-col">
          <div className="sheet-hero">
            {images.hero ? <img src={images.hero} alt="" /> : null}
          </div>
          {images.thumbs.length > 0 && (
            <div className="sheet-thumbs">
              {images.thumbs.slice(0, 3).map((t) => (
                <figure key={t.label} className="sheet-thumb">
                  <img src={t.src} alt="" />
                  <figcaption>{t.label}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>

        <div className="sheet-col">
          <div className="sheet-block">
            <h3>Project at a glance</h3>
            <div className="sheet-kpis">
              <div className="sheet-kpi">
                <span>Project total</span>
                <strong>{bottomUp ? money(bottomUp.project) : "—"}</strong>
              </div>
              <div className="sheet-kpi">
                <span>Cost / GSF</span>
                <strong>{bottomUp ? rate(bottomUp.perGSF) : "—"}</strong>
              </div>
              <div className="sheet-kpi">
                <span>Gross area</span>
                <strong>{num(Math.round(gsf))}</strong>
              </div>
              <div className="sheet-kpi">
                <span>{type?.capacityLabel ?? "Capacity"}</span>
                <strong>{num(scheme.targetCapacity)}</strong>
              </div>
              <div className="sheet-kpi">
                <span>Per {type?.capacityUom.toLowerCase() ?? "unit"}</span>
                <strong>
                  {bottomUp && scheme.targetCapacity > 0
                    ? money(bottomUp.project / scheme.targetCapacity)
                    : "—"}
                </strong>
              </div>
              <div className="sheet-kpi">
                <span>Storeys</span>
                <strong>{scheme.masses[0]?.floors ?? "—"}</strong>
              </div>
            </div>
          </div>

          {bottomUp && (
            <div className="sheet-block">
              <h3>Cost by division</h3>
              <table className="sheet-table">
                <tbody>
                  {bottomUp.divisions.map((d, i) => (
                    <tr key={d.id}>
                      <td style={{ width: "44%" }}>
                        {d.label}
                        <div className="sheet-bar">
                          <span
                            style={{
                              width: `${d.pctOfDirect}%`,
                              background: DIVISION_COLORS[i % DIVISION_COLORS.length],
                            }}
                          />
                        </div>
                      </td>
                      <td className="n">{rate(d.perGSF)}/SF</td>
                      <td className="n">{money(d.amount)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>Markups &amp; soft costs</td>
                    <td className="n">{rate(bottomUp.indirectTotal / Math.max(1, gsf))}/SF</td>
                    <td className="n">{money(bottomUp.indirectTotal)}</td>
                  </tr>
                  <tr className="total">
                    <td>Project total</td>
                    <td className="n">{rate(bottomUp.perGSF)}/SF</td>
                    <td className="n">{money(bottomUp.project)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {rec && (
            <div className="sheet-block">
              <h3>Against the market band</h3>
              <SheetBand low={rec.conceptualLow} likely={rec.conceptualLikely} high={rec.conceptualHigh} actual={rec.bottomUp} />
              <table className="sheet-table">
                <tbody>
                  <tr>
                    <td>Takeoff ({rec.scope})</td>
                    <td className="n">{money(rec.bottomUp)}</td>
                  </tr>
                  <tr>
                    <td>Market band</td>
                    <td className="n">{money(rec.conceptualLow)} – {money(rec.conceptualHigh)}</td>
                  </tr>
                  <tr className="total">
                    <td>Variance</td>
                    <td className="n" style={{ color: rec.withinBand ? "#2f7d5d" : "#b4741a" }}>
                      {signedPct(rec.variancePct)} · {rec.verdict}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <footer className="sheet-foot">
        <div style={{ maxWidth: "62%" }}>
          <strong>Basis.</strong> Conceptual estimate from a parametric model, priced{" "}
          {bottomUp ? `at the ${project.settings.band} point of each rate band` : ""} and indexed to{" "}
          {project.settings.adjustment.locationIndex} ({project.location.city || "national baseline"})
          {project.settings.adjustment.midpoint && `, escalated to a ${project.settings.adjustment.midpoint} midpoint`}.
          {bottomUp?.sourceMix.length ? ` Rates from ${bottomUp.sourceMix.map((s) => s.sourceLabel).join(", ")}.` : ""}
          {" "}Design is conceptual; quantities derive from massing, not from documents.
        </div>
        {bottomUp && (
          <div className="sheet-legend">
            {bottomUp.divisions.slice(0, 6).map((d, i) => (
              <span key={d.id}>
                <i style={{ background: DIVISION_COLORS[i % DIVISION_COLORS.length] }} />
                {d.label}
              </span>
            ))}
          </div>
        )}
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ComparisonSheet({
  project,
  estimates,
  images,
}: {
  project: Project;
  estimates: Record<string, SchemeEstimate>;
  images: SheetImages;
}) {
  const baseline = estimates[project.baselineSchemeId];
  const market = MARKET_BY_ID[project.marketId];
  const columns = Math.min(4, Math.max(1, project.schemes.length));

  return (
    <div className="sheet">
      <header className="sheet-head">
        <div>
          <div className="sheet-title">{project.name || "Untitled project"} — Options</div>
          <div className="sheet-sub">
            {market?.label}
            {project.client && ` — ${project.client}`}
            {project.location.city && ` · ${project.location.city}`}
            {` · ${project.schemes.length} schemes compared against ${
              project.schemes.find((s) => s.id === project.baselineSchemeId)?.name ?? "baseline"
            }`}
          </div>
        </div>
        <div className="sheet-brand">
          <strong>BUD</strong>
          <span>Options Comparison</span>
          <span style={{ marginTop: 4, display: "block" }}>{new Date().toLocaleDateString()}</span>
        </div>
      </header>

      <div className="sheet-compare">
        <div className="sheet-compare-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
          {project.schemes.slice(0, 4).map((scheme) => {
            const est = estimates[scheme.id];
            const type = TYPE_BY_ID[scheme.typeId];
            const delta =
              est && baseline && scheme.id !== project.baselineSchemeId && baseline.bottomUp.project > 0
                ? ((est.bottomUp.project - baseline.bottomUp.project) / baseline.bottomUp.project) * 100
                : null;

            return (
              <div key={scheme.id} className="sheet-option">
                <div className="shot">
                  {images.bySchemeId[scheme.id] && <img src={images.bySchemeId[scheme.id]} alt="" />}
                </div>
                <div className="meta">
                  <div>
                    <h4>{scheme.name}</h4>
                    <div className="type">{type?.label}</div>
                  </div>
                  <table className="sheet-table">
                    <tbody>
                      <tr>
                        <td>Total</td>
                        <td className="n"><strong>{est ? money(est.bottomUp.project) : "—"}</strong></td>
                      </tr>
                      <tr>
                        <td>$/GSF</td>
                        <td className="n">{est ? rate(est.bottomUp.perGSF) : "—"}</td>
                      </tr>
                      <tr>
                        <td>Gross area</td>
                        <td className="n">{est ? num(Math.round(est.takeoff.gsf)) : "—"}</td>
                      </tr>
                      <tr>
                        <td>{type?.capacityLabel ?? "Capacity"}</td>
                        <td className="n">{num(scheme.targetCapacity)}</td>
                      </tr>
                      <tr>
                        <td>Per {type?.capacityUom.toLowerCase() ?? "unit"}</td>
                        <td className="n">
                          {est && scheme.targetCapacity > 0 ? money(est.bottomUp.project / scheme.targetCapacity) : "—"}
                        </td>
                      </tr>
                      <tr>
                        <td>vs. market</td>
                        <td className="n">{est?.reconciliation ? signedPct(est.reconciliation.variancePct) : "—"}</td>
                      </tr>
                      <tr className="total">
                        <td>vs. baseline</td>
                        <td className="n" style={{ color: delta == null ? "#7e8c95" : delta > 0 ? "#c0392b" : "#2f7d5d" }}>
                          {delta == null ? "baseline" : signedPct(delta)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>

        {project.decisionLog.length > 0 && (
          <div className="sheet-block">
            <h3>Decision log</h3>
            <table className="sheet-table">
              <tbody>
                {project.decisionLog.slice(0, 6).map((entry) => (
                  <tr key={entry.id}>
                    <td style={{ width: 90 }} className="n">{new Date(entry.at).toLocaleDateString()}</td>
                    <td>{entry.text}</td>
                    <td className="n">{entry.total != null ? money(entry.total) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <footer className="sheet-foot">
        <div style={{ maxWidth: "72%" }}>
          <strong>Basis.</strong> Conceptual estimates from parametric models, indexed to{" "}
          {project.settings.adjustment.locationIndex} ({project.location.city || "national baseline"}).
          Options are priced on the same rate set, so the comparison between them is sounder than any
          single figure. Design is conceptual; quantities derive from massing, not from documents.
        </div>
      </footer>
    </div>
  );
}

function SheetBand({ low, likely, high, actual }: { low: number; likely: number; high: number; actual: number }) {
  const min = Math.min(low, actual) * 0.94;
  const max = Math.max(high, actual) * 1.06;
  const span = Math.max(1, max - min);
  const at = (v: number) => `${((v - min) / span) * 100}%`;
  return (
    <div className="sheet-band">
      <span className="rng" style={{ left: at(low), width: `${((high - low) / span) * 100}%` }} />
      <span className="mid" style={{ left: at(likely) }} />
      <span className="act" style={{ left: at(actual) }} />
    </div>
  );
}

// ---------------------------------------------------------------------------

export type SheetKind = "concept" | "comparison";

/**
 * The sheet viewer. Scales the fixed 17x11 layout down to fit the window so
 * what is on screen is exactly what prints, then hands the browser's own print
 * dialogue the job of making the PDF.
 */
export function SheetViewer({
  kinds,
  project,
  estimates,
  images,
  onClose,
}: {
  kinds: SheetKind[];
  project: Project;
  estimates: Record<string, SchemeEstimate>;
  images: SheetImages;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(0.5);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fit = () => {
      const available = (stageRef.current?.clientWidth ?? window.innerWidth) - 48;
      setScale(Math.min(1, Math.max(0.2, available / 1632)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const activeScheme = useMemo(
    () => project.schemes.find((s) => s.id === project.activeSchemeId) ?? project.schemes[0],
    [project],
  );

  return (
    <div className="sheet-stage" ref={stageRef}>
      <div className="sheet-toolbar">
        <strong style={{ fontSize: 13 }}>Presentation sheets</strong>
        <span className="hint">Print to PDF at 17″ × 11″ landscape.</span>
        <div className="fill" />
        <button className="btn primary" onClick={() => window.print()}>Print / Save PDF</button>
        <button className="btn" onClick={onClose}>Close</button>
      </div>

      <div className="sheet-scroll">
        {kinds.map((kind) => (
          <div
            key={kind}
            style={{
              transform: `scale(${scale})`,
              transformOrigin: "top center",
              height: 1056 * scale,
              width: 1632 * scale,
            }}
          >
            <div style={{ transform: `scale(${1 / scale})`, transformOrigin: "top left", width: 1632 }}>
              {kind === "concept" ? (
                <ConceptSheet
                  project={project}
                  scheme={activeScheme}
                  estimate={estimates[activeScheme?.id ?? ""]}
                  images={images}
                />
              ) : (
                <ComparisonSheet project={project} estimates={estimates} images={images} />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export { CAMERA_PRESETS };
export type { CameraPreset, ViewportHandle };
