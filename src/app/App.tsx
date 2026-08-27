/**
 * Application shell.
 *
 * Three columns: the iteration rail on the left, the model in the middle, the
 * inspector on the right. The dock under the model carries the numbers that
 * matter at every moment, so switching inspector tabs never hides the headline.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProjectRail } from "./panels/ProjectRail";
import { ProgramPanel } from "./panels/ProgramPanel";
import { EstimatePanel } from "./panels/EstimatePanel";
import { ComparePanel } from "./panels/ComparePanel";
import { CostDataPanel } from "./panels/CostDataPanel";
import { RenderPanel } from "./panels/RenderPanel";
import { PhotorealPanel } from "./panels/PhotorealPanel";
import { SheetPanel } from "./panels/SheetPanel";
import { Viewport, type ViewportHandle, type ViewportSettings } from "@/render/Viewport";
import { useActiveEstimate, useActiveScheme, useProject } from "./store/useProject";
import { Kpi, Modal } from "@/ui/primitives";
import { money, num, rate, signedPct } from "@/ui/format";
import { TYPE_BY_ID } from "@/markets/registry";
import { LOCATION_FACTORS } from "@/costs/seed/locations";
import type { Project } from "@/domain/project";

type Tab = "program" | "estimate" | "compare" | "data" | "render" | "photoreal" | "sheets";

const TABS: { id: Tab; label: string }[] = [
  { id: "program", label: "Program" },
  { id: "estimate", label: "Estimate" },
  { id: "compare", label: "Compare" },
  { id: "data", label: "Cost data" },
  { id: "render", label: "Render" },
  { id: "photoreal", label: "Photoreal" },
  { id: "sheets", label: "Sheets" },
];

const DEFAULT_VIEW: ViewportSettings = {
  mode: "realistic",
  showEntourage: true,
  showGround: true,
  // Mid-morning in early autumn. The sun sits in the south-east while the
  // camera presets look from the south-west, so shadows rake ACROSS the view
  // instead of hiding behind the building, and the sun is low enough to model
  // the facades without the colour cast of golden hour.
  sun: { month: 9, day: 21, hour: 9.5, latitude: 39.95, longitude: -75.17, utcOffset: -4 },
  overcast: 0.15,
  exposure: 1,
  maxSamples: 96,
};

export function App() {
  const [tab, setTab] = useState<Tab>("program");
  const [view, setView] = useState<ViewportSettings>(DEFAULT_VIEW);
  const [selectedMassId, setSelectedMassId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [photorealImage, setPhotorealImage] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );

  const viewportRef = useRef<ViewportHandle>(null);
  const project = useProject((s) => s.project);
  const scheme = useActiveScheme();
  const estimate = useActiveEstimate();
  const estimating = useProject((s) => s.estimating);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Keep the sun over the real site once a location is set.
  useEffect(() => {
    const { lat, lon } = project.location;
    if (lat == null || lon == null) return;
    setView((v) =>
      v.sun.latitude === lat && v.sun.longitude === lon
        ? v
        : { ...v, sun: { ...v.sun, latitude: lat, longitude: lon, utcOffset: Math.round(lon / 15) } },
    );
  }, [project.location.lat, project.location.lon]);

  const patchView = useCallback((patch: Partial<ViewportSettings>) => {
    setView((v) => ({ ...v, ...patch }));
  }, []);

  const type = scheme ? TYPE_BY_ID[scheme.typeId] : undefined;

  return (
    <div className="app">
      <Header theme={theme} onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))} />

      <div className="app-body">
        <aside className="rail">
          <ProjectRail />
        </aside>

        <main className="stage">
          <div style={{ position: "relative", minHeight: 0 }}>
            {scheme && (
              <Viewport
                ref={viewportRef}
                scheme={scheme}
                settings={view}
                selectedMassId={selectedMassId}
                onSelectMass={setSelectedMassId}
                onProgress={setProgress}
              />
            )}

            <div className="stage-overlay top-left">
              <div className="cluster">
                {(["realistic", "clay", "program"] as const).map((mode) => (
                  <button
                    key={mode}
                    className={`btn ghost sm${view.mode === mode ? " active" : ""}`}
                    onClick={() => patchView({ mode })}
                  >
                    {mode === "realistic" ? "Material" : mode === "clay" ? "Clay" : "Program"}
                  </button>
                ))}
              </div>
            </div>

            <div className="stage-overlay top-right">
              <div className="cluster">
                <span className="sample-meter" title="Progressive samples accumulated">
                  <span className="sample-bar">
                    <span style={{ width: `${progress * 100}%` }} />
                  </span>
                  {progress >= 1 ? "final" : `${Math.round(progress * 100)}%`}
                </span>
              </div>
            </div>

            <div className="stage-overlay bottom-left">
              <div className="cluster">
                <button className="btn ghost sm" onClick={() => viewportRef.current?.frameAll()}>Fit</button>
                <button className="btn ghost sm" onClick={() => setTab("render")}>Render…</button>
              </div>
            </div>
          </div>

          <div className="dock">
            {estimate && scheme ? (
              <>
                <Kpi label="Project total" value={money(estimate.bottomUp.project)} />
                <Kpi label="Construction" value={money(estimate.bottomUp.construction)} />
                <Kpi label="Cost / GSF" value={rate(estimate.bottomUp.perGSF)} />
                <Kpi label="Gross area" value={num(Math.round(estimate.takeoff.gsf))} unit="GSF" />
                <Kpi
                  label={type?.capacityLabel ?? "Capacity"}
                  value={num(scheme.targetCapacity)}
                />
                <Kpi
                  label={`Per ${type?.capacityUom.toLowerCase() ?? "unit"}`}
                  value={
                    scheme.targetCapacity > 0
                      ? money(estimate.bottomUp.project / scheme.targetCapacity)
                      : "—"
                  }
                />
                {estimate.reconciliation && (
                  <Kpi
                    label="vs. market"
                    value={signedPct(estimate.reconciliation.variancePct)}
                    tone={
                      estimate.reconciliation.withinBand
                        ? "good"
                        : Math.abs(estimate.reconciliation.variancePct) > 25
                          ? "bad"
                          : "warn"
                    }
                    title={`Market band ${money(estimate.reconciliation.conceptualLow)} – ${money(
                      estimate.reconciliation.conceptualHigh,
                    )}`}
                  />
                )}
                <Kpi label="Stairs / lifts" value={`${estimate.takeoff.stairs} / ${estimate.takeoff.elevators}`} />
              </>
            ) : (
              <div className="kpi">
                <span className="label">{estimating ? "Pricing" : "No estimate"}</span>
              </div>
            )}
          </div>
        </main>

        <aside className="inspector">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                className="tab"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="fill scroll">
            {tab === "program" && <ProgramPanel selectedMassId={selectedMassId} />}
            {tab === "estimate" && <EstimatePanel />}
            {tab === "compare" && <ComparePanel />}
            {tab === "data" && <CostDataPanel />}
            {tab === "render" && (
              <RenderPanel settings={view} onChange={patchView} viewport={viewportRef} />
            )}
            {tab === "photoreal" && <PhotorealPanel viewport={viewportRef} onResult={setPhotorealImage} />}
            {tab === "sheets" && <SheetPanel viewport={viewportRef} photorealImage={photorealImage} />}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Header({ theme, onToggleTheme }: { theme: "light" | "dark"; onToggleTheme: () => void }) {
  const project = useProject((s) => s.project);
  const patchProject = useProject((s) => s.patchProject);
  const loadProject = useProject((s) => s.loadProject);
  const estimating = useProject((s) => s.estimating);
  const [showLocation, setShowLocation] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${project.name.replace(/[^\w-]+/g, "-").toLowerCase() || "project"}.bud.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const open = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Project;
      if (!parsed?.schemes?.length) throw new Error("Not a BUD project file");
      loadProject(parsed);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not read that file");
    }
  };

  return (
    <header className="app-header">
      <span className="wordmark">BUD</span>
      <span className="label" style={{ marginLeft: -8 }}>Conceptual Estimating</span>

      <div style={{ width: 1, height: 22, background: "var(--line)" }} />

      <input
        value={project.name}
        onChange={(e) => patchProject({ name: e.target.value })}
        className="control"
        style={{ width: 210, background: "transparent", border: "1px solid transparent", fontWeight: 600 }}
        aria-label="Project name"
      />
      <input
        value={project.client}
        onChange={(e) => patchProject({ client: e.target.value })}
        className="control"
        style={{ width: 150, background: "transparent", border: "1px solid transparent" }}
        placeholder="Client"
        aria-label="Client"
      />

      <button className="btn ghost sm" onClick={() => setShowLocation(true)} title="Location and escalation">
        📍 {project.location.city || "Set location"}
        <span className="label" style={{ marginLeft: 4 }}>idx {project.settings.adjustment.locationIndex}</span>
      </button>

      <div className="fill" />

      <span className="label" style={{ color: estimating ? "var(--accent)" : "var(--ink-3)" }}>
        {estimating ? "pricing…" : "priced"}
      </span>

      <button className="btn ghost sm" onClick={() => fileRef.current?.click()}>Open</button>
      <button className="btn ghost sm" onClick={save}>Save</button>
      <button className="btn ghost icon" onClick={onToggleTheme} title="Toggle theme">
        {theme === "light" ? "◐" : "◑"}
      </button>

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={(e) => {
          void open(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {showLocation && <LocationModal onClose={() => setShowLocation(false)} />}
    </header>
  );
}

function LocationModal({ onClose }: { onClose: () => void }) {
  const project = useProject((s) => s.project);
  const setLocationCity = useProject((s) => s.setLocationCity);
  const patchSettings = useProject((s) => s.patchSettings);
  const [query, setQuery] = useState(project.location.city);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LOCATION_FACTORS.slice(0, 12);
    return LOCATION_FACTORS.filter((l) => l.city.toLowerCase().includes(q)).slice(0, 12);
  }, [query]);

  return (
    <Modal title="Location and escalation" onClose={onClose} width={520}>
      <p className="hint">
        The location index scales every rate from the national baseline it is published at. The
        midpoint date compounds escalation from each rate's own pricing date.
      </p>

      <div className="mt-2">
        <span className="label">City</span>
        <input
          className="control mt-1"
          value={query}
          placeholder="Search cities…"
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      <table className="table mt-2">
        <thead>
          <tr>
            <th>City</th>
            <th className="n">Index</th>
            <th style={{ width: 60 }} />
          </tr>
        </thead>
        <tbody>
          {matches.map((l) => (
            <tr key={l.city}>
              <td>{l.city}</td>
              <td className="n">{l.index}</td>
              <td>
                <button
                  className="btn sm"
                  onClick={() => {
                    setLocationCity(l.city);
                    onClose();
                  }}
                >
                  Use
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid-2 mt-3">
        <label className="field">
          <span className="label">Escalation %/yr</span>
          <input
            className="control"
            type="number"
            step={0.25}
            min={0}
            value={project.settings.adjustment.escalationPctPerYear}
            onChange={(e) =>
              patchSettings({
                adjustment: {
                  ...project.settings.adjustment,
                  escalationPctPerYear: Math.max(0, Number(e.target.value)),
                },
              })
            }
          />
        </label>
        <label className="field">
          <span className="label">Construction midpoint</span>
          <input
            className="control"
            type="date"
            value={project.settings.adjustment.midpoint ?? ""}
            onChange={(e) =>
              patchSettings({
                adjustment: { ...project.settings.adjustment, midpoint: e.target.value || undefined },
              })
            }
          />
        </label>
      </div>
    </Modal>
  );
}
