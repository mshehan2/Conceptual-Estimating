/**
 * Program drivers.
 *
 * The sheet every area on a Benchmark model points back at. Nothing downstream
 * is typed in: move a driver here and the departmental area, the building
 * area and every category area follow.
 *
 * The blended chain also shows its own decomposition, because a metric like
 * 540 DGSF per key planning unit is a benchmark rather than a build-up, and
 * the argument about whether it should be 540 or 700 is really an argument
 * about how much support each exam room needs.
 */

import {
  atDgsfPerKpu,
  resolveChain,
  type CapacityDriver,
  type DriverChain,
} from "@/domain/drivers";
import { Field, NumberInput, Section, Empty } from "@/ui/primitives";
import { num, pct } from "@/ui/format";

interface Props {
  chain: DriverChain;
  onChange: (chain: DriverChain) => void;
}

export function DriverPanel({ chain, onChange }: Props) {
  const r = resolveChain(chain);
  const blended = chain.mode === "blended";

  const patchDriver = (id: string, patch: Partial<CapacityDriver>) =>
    onChange({ ...chain, drivers: chain.drivers.map((d) => (d.id === id ? { ...d, ...patch } : d)) });

  return (
    <>
      <Section title="Program drivers" meta={`${num(Math.round(r.bgsf))} BGSF`}>
        <table className="table">
          <thead>
            <tr>
              <th>Driver</th>
              <th className="n" style={{ width: 62 }}>Count</th>
              <th className="n" style={{ width: 74 }}>{blended ? "Room SF" : "DGSF ea"}</th>
              <th className="n" style={{ width: 74 }}>DGSF</th>
            </tr>
          </thead>
          <tbody>
            {chain.drivers.map((d) => (
              <tr key={d.id}>
                <td className="truncate" title={`${d.label} (per ${d.unit})`}>
                  {d.label}
                  {d.kpu && <span className="label" style={{ marginLeft: 5 }}>KPU</span>}
                </td>
                <td className="n" style={{ padding: 2 }}>
                  <NumberInput
                    value={d.count}
                    min={0}
                    onChange={(v) => patchDriver(d.id, { count: Math.max(0, Math.round(v)) })}
                  />
                </td>
                <td className="n" style={{ padding: 2 }}>
                  <NumberInput
                    value={blended ? (d.roomSf ?? 0) : d.dgsfPer}
                    min={0}
                    step={10}
                    onChange={(v) => patchDriver(d.id, blended ? { roomSf: v } : { dgsfPer: v })}
                  />
                </td>
                <td className="n">
                  {num(Math.round(blended ? d.count * (chain.dgsfPerKpu ?? 0) : d.count * d.dgsfPer))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="grid-2 mt-2">
          {blended && (
            <Field label="DGSF per KPU" hint="The single biggest lever in the model">
              <NumberInput
                value={chain.dgsfPerKpu ?? 0}
                min={0}
                step={10}
                onChange={(v) => onChange({ ...chain, dgsfPerKpu: v })}
              />
            </Field>
          )}
          <Field label="BGSF / DGSF factor">
            <NumberInput
              value={chain.grossFactor}
              min={1}
              step={0.05}
              onChange={(v) => onChange({ ...chain, grossFactor: v })}
            />
          </Field>
        </div>

        <p className="hint mt-2">
          {num(r.kpu)} key planning units · {num(Math.round(r.dgsf))} DGSF ·{" "}
          <b className="num">{num(Math.round(r.bgsf))}</b> BGSF at{" "}
          {num(Math.round(r.dgsfPerKpu))} DGSF per KPU
        </p>

        {r.roomArea > 0 && (
          <p className="hint mt-1">
            Of that, <b className="num">{num(Math.round(r.roomArea))}</b> SF is actual room, or{" "}
            {num(Math.round(r.roomArea / Math.max(1, r.kpu)))} per unit. The other{" "}
            {num(Math.round(r.dgsfPerKpu - r.roomArea / Math.max(1, r.kpu)))} is everything
            supporting it, so the room share is {pct(r.roomShare * 100)}.
          </p>
        )}
      </Section>

      {blended && (
        <Section title="Sensitivity" meta="DGSF per KPU" defaultOpen={false}>
          <table className="table">
            <thead>
              <tr>
                <th className="n">DGSF/KPU</th>
                <th className="n">BGSF</th>
                <th className="n">Room share</th>
              </tr>
            </thead>
            <tbody>
              {[440, 540, 640, 700].map((m) => {
                const alt = atDgsfPerKpu(chain, m);
                const here = Math.abs(m - (chain.dgsfPerKpu ?? 0)) < 1;
                return (
                  <tr key={m} style={here ? { fontWeight: 600 } : undefined}>
                    <td className="n">{m}</td>
                    <td className="n">{num(Math.round(alt.bgsf))}</td>
                    <td className="n">{pct(alt.roomShare * 100)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint mt-2">
            Every 100 DGSF per KPU is worth roughly {num(Math.round(100 * r.kpu * chain.grossFactor))}{" "}
            BGSF here. The metric is the planner's, not the estimator's, and it is doing more work
            than any cost rate in the model.
          </p>
        </Section>
      )}

      <Section title="Space program" meta={`${chain.categories.length} categories`} defaultOpen={false}>
        {r.categories.length === 0 ? (
          <Empty>No space program for this type.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="n" style={{ width: 64 }}>% BGSF</th>
                <th className="n" style={{ width: 74 }}>Area SF</th>
              </tr>
            </thead>
            <tbody>
              {r.categories.map((c) => (
                <tr key={c.id}>
                  <td className="truncate" title={c.label}>
                    {c.label}
                    {c.balance && <span className="label" style={{ marginLeft: 5 }}>balance</span>}
                  </td>
                  <td className="n" style={{ padding: 2 }}>
                    {c.balance ? (
                      <span className="num">{pct(c.share * 100)}</span>
                    ) : (
                      <NumberInput
                        value={Math.round(c.share * 1000) / 10}
                        min={0}
                        max={100}
                        step={0.5}
                        suffix="%"
                        onChange={(v) =>
                          onChange({
                            ...chain,
                            categories: chain.categories.map((x) =>
                              x.id === c.id ? { ...x, share: v / 100 } : x,
                            ),
                          })
                        }
                      />
                    )}
                  </td>
                  <td className="n">{num(Math.round(c.area))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint mt-2">
          The balance category takes whatever the named ones leave, so the set always covers the
          building. Where these shares are an assumption rather than the client's framework, say so
          on the sheet: on the Original Hospital they are Benchmark's, and they are the most
          attackable numbers in that model.
        </p>
      </Section>
    </>
  );
}
