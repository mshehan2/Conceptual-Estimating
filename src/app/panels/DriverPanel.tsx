/**
 * Program drivers.
 *
 * The sheet every area on a Benchmark model points back at. Nothing downstream
 * is typed in: move a driver here and the departmental area, the building area
 * and every category area follow.
 *
 * A building can hold more than one programme. A medical office building with
 * an ambulatory surgery centre in it is one building planned by two different
 * arithmetics, the office side by exam rooms at a blended departmental area
 * and the surgery side by operating rooms with their sterile core and PACU
 * counted separately. So each programme keeps its own chain and they combine.
 *
 * The blended chain also shows its own decomposition, because a metric like
 * 540 DGSF per key planning unit is a benchmark rather than a build-up, and
 * whether it should be 540 or 700 is really a question about how much support
 * each exam room needs.
 */

import { useState } from "react";
import {
  atDgsfPerKpu,
  blockFromChain,
  resolveBlocks,
  resolveChain,
  type CapacityDriver,
  type DriverChain,
  type ProgramBlock,
} from "@/domain/drivers";
import { BUILDING_TYPES } from "@/markets/registry";
import { Chip, Empty, Field, NumberInput, Section, Select } from "@/ui/primitives";
import { num, pct } from "@/ui/format";

interface Props {
  blocks: ProgramBlock[];
  onChange: (blocks: ProgramBlock[]) => void;
  /** Gross area the drawn box actually provides, for the reconciliation below. */
  boxGsf: number;
  /** Resize the box to hold the programme. */
  onFit: () => void;
}

/** Types that carry a planning framework, so they can be added as a programme. */
const ADDABLE = BUILDING_TYPES.filter((t) => t.driverChain);

export function DriverPanel({ blocks, onChange, boxGsf, onFit }: Props) {
  const [open, setOpen] = useState<string | null>(blocks[0]?.id ?? null);
  const combined = resolveBlocks(blocks);
  const multi = blocks.length > 1;

  const patchBlock = (id: string, chain: DriverChain) =>
    onChange(blocks.map((b) => (b.id === id ? { ...b, chain } : b)));

  const addBlock = (typeId: string) => {
    const type = ADDABLE.find((t) => t.id === typeId);
    if (!type?.driverChain) return;
    const id = `pb${Date.now().toString(36)}`;
    onChange([...blocks, blockFromChain(id, type.label, type.driverChain, type.id)]);
    setOpen(id);
  };

  return (
    <>
      <Section
        title={multi ? "Programmes" : "Program drivers"}
        meta={`${num(Math.round(combined.bgsf))} BGSF`}
      >
        {blocks.length === 0 ? (
          <Empty>No programme yet. Add one below.</Empty>
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            {combined.blocks.map((r) => {
              const block = blocks.find((b) => b.id === r.id)!;
              const expanded = open === r.id || !multi;
              return (
                <div
                  key={r.id}
                  style={{
                    border: `1px solid var(${expanded ? "--line-strong" : "--line"})`,
                    borderRadius: "var(--r-sm)",
                    background: "var(--panel-alt)",
                  }}
                >
                  {multi && (
                    <div className="row" style={{ gap: 6, padding: "8px 10px", alignItems: "center" }}>
                      <button
                        onClick={() => setOpen(expanded ? null : r.id)}
                        style={{
                          flex: 1, border: 0, background: "transparent", color: "inherit",
                          textAlign: "left", padding: 0, cursor: "pointer",
                        }}
                      >
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{r.label}</span>
                        <span className="row" style={{ gap: 5, marginTop: 2, justifyContent: "flex-start" }}>
                          <Chip>{num(Math.round(r.bgsf))} BGSF</Chip>
                          <Chip>{pct(r.shareOfBgsf * 100)}</Chip>
                          {r.kpu > 0 && <Chip>{num(r.kpu)} KPU</Chip>}
                        </span>
                      </button>
                      <button
                        className="btn sm"
                        style={{ color: "var(--bad)" }}
                        onClick={() => onChange(blocks.filter((b) => b.id !== r.id))}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                  {expanded && (
                    <div style={{ padding: multi ? "0 10px 10px" : 0 }}>
                      <ChainEditor chain={block.chain} onChange={(c) => patchBlock(r.id, c)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-2">
          <Field
            label="Add a programme"
            hint="A surgery centre inside a medical office building is one building and two programmes"
          >
            <Select
              value=""
              onChange={(v) => v && addBlock(v)}
              options={[
                { value: "", label: "Choose…" },
                ...ADDABLE.map((t) => ({ value: t.id, label: t.label })),
              ]}
            />
          </Field>
        </div>

        {multi && (
          <p className="hint mt-2">
            {num(combined.kpu)} key planning units across {blocks.length} programmes ·{" "}
            {num(Math.round(combined.dgsf))} DGSF ·{" "}
            <b className="num">{num(Math.round(combined.bgsf))}</b> BGSF combined
          </p>
        )}

        {combined.bgsf > 0 && <BoxCheck bgsf={combined.bgsf} boxGsf={boxGsf} onFit={onFit} />}
      </Section>

      <Section
        title="Space program"
        meta={`${combined.categories.length} categories`}
        defaultOpen={false}
      >
        {combined.categories.length === 0 ? (
          <Empty>No space program yet.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="n" style={{ width: 64 }}>% BGSF</th>
                <th className="n" style={{ width: 78 }}>Area SF</th>
              </tr>
            </thead>
            <tbody>
              {combined.categories.map((c) => (
                <tr key={c.label}>
                  <td className="truncate" title={c.label}>
                    {c.label}
                    {c.balance && <span className="label" style={{ marginLeft: 5 }}>balance</span>}
                  </td>
                  <td className="n">{pct(c.share * 100)}</td>
                  <td className="n">{num(Math.round(c.area))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint mt-2">
          {multi
            ? "Categories are merged by name across programmes, so circulation reads once for the building rather than once per block. Edit the shares on each programme above."
            : "The balance category takes whatever the named ones leave, so the set always covers the building."}{" "}
          Where these shares are an assumption rather than the client's framework, say so: on the
          Original Hospital they are Benchmark's, and they are the most attackable numbers in that
          model.
        </p>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * The programme against the box that is actually drawn.
 *
 * Adding a surgery centre to a medical office building makes the building
 * bigger. If the drawn mass does not follow, the estimate prices a building
 * nobody proposed: the programme reads 96,000 BGSF and the box still holds
 * 70,000, so the surgery centre is planned and not paid for. This is the
 * check, and the button closes it.
 */
function BoxCheck({ bgsf, boxGsf, onFit }: { bgsf: number; boxGsf: number; onFit: () => void }) {
  const gap = boxGsf - bgsf;
  const off = Math.abs(gap) / bgsf;
  const tone = off > 0.1 ? "var(--bad)" : off > 0.02 ? "var(--warn)" : "var(--good)";

  return (
    <div className="mt-2">
      <div className="row">
        <span className="label">Programme vs. drawn box</span>
        <span className="num" style={{ fontSize: 11, color: tone, fontWeight: 600 }}>
          {gap >= 0 ? "+" : "−"}{num(Math.round(Math.abs(gap)))} GSF
        </span>
      </div>
      <p className="hint mt-1">
        Programme asks <b className="num">{num(Math.round(bgsf))}</b> BGSF · box provides{" "}
        <b className="num">{num(Math.round(boxGsf))}</b> GSF
        {off > 0.02 && (
          <>
            {" "}
            <button className="btn sm" onClick={onFit}>Fit the box</button>
          </>
        )}
      </p>
      {off > 0.02 && (
        <p className="hint mt-1">
          Until these agree the estimate prices the box, not the programme.
        </p>
      )}
    </div>
  );
}

function ChainEditor({ chain, onChange }: { chain: DriverChain; onChange: (c: DriverChain) => void }) {
  const r = resolveChain(chain);
  const blended = chain.mode === "blended";

  const patchDriver = (id: string, patch: Partial<CapacityDriver>) =>
    onChange({ ...chain, drivers: chain.drivers.map((d) => (d.id === id ? { ...d, ...patch } : d)) });

  return (
    <>
      <table className="table">
        <thead>
          <tr>
            <th>Driver</th>
            <th className="n" style={{ width: 58 }}>Count</th>
            <th className="n" style={{ width: 70 }}>{blended ? "Room SF" : "DGSF ea"}</th>
            <th className="n" style={{ width: 70 }}>DGSF</th>
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
        <Field label="Grossing: BGSF / DGSF" hint="Departmental gross to building gross">
          <NumberInput
            value={chain.grossFactor}
            min={1}
            max={6}
            step={0.05}
            onChange={(v) => onChange({ ...chain, grossFactor: v })}
          />
        </Field>
      </div>

      <p className="hint mt-2">
        {num(r.kpu)} KPU · {num(Math.round(r.dgsf))} DGSF ·{" "}
        <b className="num">{num(Math.round(r.bgsf))}</b> BGSF at {num(Math.round(r.dgsfPerKpu))}{" "}
        DGSF per KPU
      </p>

      {r.roomArea > 0 && (
        <p className="hint mt-1">
          Of that, <b className="num">{num(Math.round(r.roomArea))}</b> SF is actual room, or{" "}
          {num(Math.round(r.roomArea / Math.max(1, r.kpu)))} per unit. The other{" "}
          {num(Math.round(r.dgsfPerKpu - r.roomArea / Math.max(1, r.kpu)))} is everything supporting
          it, so the room share is {pct(r.roomShare * 100)}.
        </p>
      )}

      {blended && (
        <table className="table mt-2">
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
      )}
    </>
  );
}
