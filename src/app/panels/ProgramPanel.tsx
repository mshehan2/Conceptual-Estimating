/**
 * Program and massing.
 *
 * Set a capacity target and the program seeds itself from the type's mix; from
 * there every count is editable. The capacity meter is the honest part: it
 * compares the gross area the program needs against the gross area the drawn
 * box provides, so an over-programmed scheme says so instead of quietly
 * inflating the estimate.
 */

import { TYPE_BY_ID } from "@/markets/registry";
import { UNIT_BY_REF, unitArea } from "@/markets/unitCatalog";
import { capacity, circulation, grossingFactor, programUnits } from "@/domain/program";
import { grossArea, wallHeight } from "@/domain/massing";
import { useActiveEstimate, useActiveScheme, useProject } from "../store/useProject";
import { Field, NumberInput, Section, Select, Segmented, Empty } from "@/ui/primitives";
import { PlanEditor } from "./PlanEditor";
import { num, pct } from "@/ui/format";
import type { GlazingPreset, RoofKind, SkinKey } from "@/markets/types";
import { SKIN_SPECS } from "@/render/textures";

const SKIN_OPTIONS = (Object.keys(SKIN_SPECS) as SkinKey[]).map((k) => ({
  value: k,
  label: SKIN_SPECS[k].label,
}));

export function ProgramPanel({ selectedMassId }: { selectedMassId: string | null }) {
  const scheme = useActiveScheme();
  const project = useProject((s) => s.project);
  const estimate = useActiveEstimate();
  const setSchemeCapacity = useProject((s) => s.setSchemeCapacity);
  const patchMass = useProject((s) => s.patchMass);
  const setMassShape = useProject((s) => s.setMassShape);
  const addMass = useProject((s) => s.addMass);
  const removeMass = useProject((s) => s.removeMass);

  if (!scheme) return <Empty>No scheme selected.</Empty>;

  const type = TYPE_BY_ID[scheme.typeId];
  const mass = scheme.masses.find((m) => m.id === selectedMassId) ?? scheme.masses[0];
  if (!mass || !type) return <Empty>This scheme has no massing yet.</Empty>;

  const cap = capacity(mass, project.settings.circulation);
  const circ = circulation(mass, project.settings.circulation);
  const units = programUnits(mass.program);
  const efficiencyBand = type.efficiency;
  const achieved = cap.efficiency;

  const capacityTone =
    cap.pct > 104 ? "var(--bad)" : cap.pct > 98 ? "var(--warn)" : "var(--good)";

  return (
    <>
      <Section
        title="Capacity"
        meta={`${num(scheme.targetCapacity)} ${type.capacityLabel}`}
      >
        <div className="grid-2">
          <Field label={`Target ${type.capacityLabel}`}>
            <NumberInput
              value={scheme.targetCapacity}
              min={1}
              step={type.capacityUom === "SF" ? 1000 : 1}
              onChange={(v) => setSchemeCapacity(scheme.id, v)}
            />
          </Field>
          <Field label="Floors">
            <NumberInput
              value={mass.floors}
              min={1}
              max={80}
              onChange={(v) => patchMass(scheme.id, mass.id, { floors: Math.round(v) })}
            />
          </Field>
        </div>

        <div className="mt-2">
          <div className="row">
            <span className="label">Program vs. box</span>
            <span className="num" style={{ fontSize: 11, color: capacityTone, fontWeight: 600 }}>
              {pct(cap.pct)}
            </span>
          </div>
          <div className="meter mt-1">
            <span style={{ width: `${Math.min(100, cap.pct)}%`, background: capacityTone }} />
          </div>
          <p className="hint mt-1">
            Program needs <b className="num">{num(Math.round(cap.required))}</b> GSF
            {" · "}box provides <b className="num">{num(Math.round(cap.available))}</b> GSF
            {cap.over && <> — <span style={{ color: "var(--bad)" }}>over by {num(Math.round(cap.required - cap.available))} GSF</span></>}
          </p>
        </div>

        <div className="mt-2">
          <div className="row">
            <span className="label">Efficiency (net / gross)</span>
            <span className="num" style={{ fontSize: 11 }}>{pct(achieved * 100, 1)}</span>
          </div>
          <p className="hint mt-1">
            Typical for {type.label.toLowerCase()}: {pct(efficiencyBand.low * 100)}–{pct(efficiencyBand.high * 100)}
            {achieved > 0 && achieved < efficiencyBand.low && " — this scheme is less efficient than the type usually runs"}
            {achieved > efficiencyBand.high && " — this scheme is more efficient than the type usually runs"}
          </p>
        </div>
      </Section>

      <Section title="Unit mix" meta={`${num(Math.round(cap.netProgram))} SF net`}>
        {units.length === 0 ? (
          <Empty>No program yet. Set a capacity target above.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Space type</th>
                <th className="n" style={{ width: 56 }}>Count</th>
                <th className="n" style={{ width: 62 }}>SF ea</th>
                <th className="n" style={{ width: 68 }}>Net SF</th>
              </tr>
            </thead>
            <tbody>
              {units.map(({ unit, count }) => (
                <tr key={unit.ref}>
                  <td className="truncate" title={unit.label}>{unit.label}</td>
                  <td className="n" style={{ padding: 2 }}>
                    <NumberInput
                      value={count}
                      min={0}
                      onChange={(v) =>
                        patchMass(scheme.id, mass.id, {
                          program: { ...mass.program, [unit.ref]: Math.max(0, Math.round(v)) },
                        })
                      }
                    />
                  </td>
                  <td className="n">{num(unitArea(unit))}</td>
                  <td className="n">{num(unitArea(unit) * count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-2">
          <Field label="Add a space type">
            <Select
              value=""
              onChange={(ref) => {
                if (!ref) return;
                patchMass(scheme.id, mass.id, {
                  program: { ...mass.program, [ref]: (mass.program[ref] ?? 0) + 1 },
                });
              }}
              options={[
                { value: "", label: "Choose…" },
                ...type.unitRefs
                  .filter((r) => UNIT_BY_REF[r])
                  .map((r) => ({ value: r, label: UNIT_BY_REF[r].label })),
              ]}
            />
          </Field>
        </div>
      </Section>

      <PlanEditor
        mass={mass}
        onShape={(shape, recenter) => setMassShape(scheme.id, mass.id, shape, recenter)}
        onSize={(w, d) => patchMass(scheme.id, mass.id, { w, d })}
      />

      <Section title="Massing" meta={`${num(mass.floors)} floors`} defaultOpen={false}>
        <div className="grid-2">
          <Field label="Floor to floor (ft)">
            <NumberInput value={mass.fth} min={7} step={0.5} onChange={(v) => patchMass(scheme.id, mass.id, { fth: v })} />
          </Field>
          <Field label="Rotation (°)">
            <NumberInput value={mass.rot} min={-180} max={180} step={5} onChange={(v) => patchMass(scheme.id, mass.id, { rot: v })} />
          </Field>
        </div>

        <div className="grid-2 mt-2">
          <Field label="Roof">
            <Select
              value={mass.roof}
              onChange={(v) => patchMass(scheme.id, mass.id, { roof: v as RoofKind })}
              options={[
                { value: "flat", label: "Flat" },
                { value: "gable", label: "Gable" },
                { value: "hip", label: "Hip" },
              ]}
            />
          </Field>
          {mass.roof !== "flat" && (
            <Field label="Pitch (:12)">
              <NumberInput value={mass.pitch} min={1} max={18} step={0.5} onChange={(v) => patchMass(scheme.id, mass.id, { pitch: v })} />
            </Field>
          )}
        </div>

        <p className="hint mt-2">
          {num(Math.round(grossArea(mass)))} GSF · {num(mass.floors)} floors ·{" "}
          {num(Math.round(wallHeight(mass)))}′ to parapet · grossing ×{grossingFactor(mass).toFixed(2)}
        </p>

        <div className="row mt-2">
          <button className="btn sm" onClick={() => addMass(scheme.id)}>+ Add mass</button>
          {scheme.masses.length > 1 && (
            <button className="btn sm" style={{ color: "var(--bad)" }} onClick={() => removeMass(scheme.id, mass.id)}>
              Remove this mass
            </button>
          )}
        </div>
      </Section>

      <Section title="Envelope" meta={mass.glz === "none" ? "solid" : `${num(mass.cov)}% glazed`} defaultOpen={false}>
        <Field label="Glazing strategy">
          <Segmented
            value={mass.glz}
            onChange={(v) => patchMass(scheme.id, mass.id, { glz: v as GlazingPreset })}
            options={[
              { value: "none", label: "None" },
              { value: "punched", label: "Punched" },
              { value: "strip", label: "Strip" },
              { value: "full", label: "Curtain" },
            ]}
          />
        </Field>

        {mass.glz !== "none" && (
          <div className="grid-2 mt-2">
            <Field label="Coverage (%)">
              <NumberInput value={mass.cov} min={0} max={100} onChange={(v) => patchMass(scheme.id, mass.id, { cov: v })} />
            </Field>
            <Field label="Sill height (ft)">
              <NumberInput value={mass.sill} min={0} step={0.5} onChange={(v) => patchMass(scheme.id, mass.id, { sill: v })} />
            </Field>
            {mass.glz === "punched" ? (
              <>
                <Field label="Window width (ft)">
                  <NumberInput value={mass.winW} min={1} step={0.5} onChange={(v) => patchMass(scheme.id, mass.id, { winW: v })} />
                </Field>
                <Field label="Window height (ft)">
                  <NumberInput value={mass.winH} min={1} step={0.5} onChange={(v) => patchMass(scheme.id, mass.id, { winH: v })} />
                </Field>
                <Field label="Spacing o.c. (ft)">
                  <NumberInput value={mass.oc} min={2} step={0.5} onChange={(v) => patchMass(scheme.id, mass.id, { oc: v })} />
                </Field>
              </>
            ) : (
              <Field label="Band height (ft)">
                <NumberInput value={mass.glassH} min={1} step={0.5} onChange={(v) => patchMass(scheme.id, mass.id, { glassH: v })} />
              </Field>
            )}
          </div>
        )}

        <div className="mt-2">
          <Field label="Exterior skin">
            <Select
              value={mass.skin}
              onChange={(v) => patchMass(scheme.id, mass.id, { skin: v as SkinKey })}
              options={SKIN_OPTIONS}
            />
          </Field>
        </div>
      </Section>

      <Section title="Circulation & egress" meta={`${circ.stairs} stairs · ${circ.elevators} lifts`} defaultOpen={false}>
        <div className="grid-2">
          <Field label="Stairs" hint={circ.auto.stairs ? "From travel distance" : "Overridden"}>
            <NumberInput
              value={circ.stairs}
              min={0}
              onChange={(v) => patchMass(scheme.id, mass.id, { stairOverride: Math.round(v) })}
            />
          </Field>
          <Field label="Elevators" hint={circ.auto.elevators ? "From units and area" : "Overridden"}>
            <NumberInput
              value={circ.elevators}
              min={0}
              onChange={(v) => patchMass(scheme.id, mass.id, { elevOverride: Math.round(v) })}
            />
          </Field>
        </div>
        <p className="hint mt-2">
          Core area <b className="num">{num(Math.round(circ.coreSF))}</b> GSF across all floors.
          {(mass.stairOverride != null || mass.elevOverride != null) && (
            <>
              {" "}
              <button
                className="btn ghost sm"
                onClick={() => patchMass(scheme.id, mass.id, { stairOverride: null, elevOverride: null })}
              >
                Reset to auto
              </button>
            </>
          )}
        </p>
      </Section>

      {estimate && (
        <Section title="Site" meta={`${num(Math.round(scheme.site.parking / 340))} stalls`} defaultOpen={false}>
          <div className="grid-2">
            <Field label="Parking (SF)">
              <NumberInput
                value={scheme.site.parking}
                min={0}
                step={340}
                onChange={(v) => useProject.getState().patchScheme(scheme.id, { site: { ...scheme.site, parking: v } })}
              />
            </Field>
            <Field label="Hardscape (SF)">
              <NumberInput
                value={scheme.site.patio}
                min={0}
                step={100}
                onChange={(v) => useProject.getState().patchScheme(scheme.id, { site: { ...scheme.site, patio: v } })}
              />
            </Field>
            <Field label="Stormwater (SF)">
              <NumberInput
                value={scheme.site.basin}
                min={0}
                step={100}
                onChange={(v) => useProject.getState().patchScheme(scheme.id, { site: { ...scheme.site, basin: v } })}
              />
            </Field>
            <Field label="Landscape (SF)">
              <NumberInput
                value={scheme.site.lawn}
                min={0}
                step={500}
                onChange={(v) => useProject.getState().patchScheme(scheme.id, { site: { ...scheme.site, lawn: v } })}
              />
            </Field>
          </div>
        </Section>
      )}
    </>
  );
}
