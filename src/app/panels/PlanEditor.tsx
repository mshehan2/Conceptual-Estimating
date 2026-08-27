/**
 * Plan editor.
 *
 * Draw and drag the building footprint directly. Presets expose their
 * parameters; the moment you pull a vertex the plan becomes a custom polygon
 * and stays one, which is the whole point — a real project is shaped by its
 * site, and the tool should never be the reason a building cannot be that
 * shape.
 *
 * Plan convention: +x east, +z north. SVG y runs down, so screen y is -z.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  FOOTPRINT_LABELS,
  composeFootprint,
  defaultShape,
  facadeSegments,
  footprintArea,
  footprintPerimeter,
  holeRings,
  outerRing,
  toPolygonShape,
  type FootprintKind,
  type FootprintShape,
  type Point,
} from "@/domain/footprint";
import type { Mass } from "@/domain/massing";
import { massFootprint } from "@/domain/massing";
import { num } from "@/ui/format";
import { Field, NumberInput, Section, Segmented, Select } from "@/ui/primitives";

const SNAPS = [
  { value: "0", label: "Off" },
  { value: "1", label: "1′" },
  { value: "5", label: "5′" },
  { value: "10", label: "10′" },
] as const;

interface Props {
  mass: Mass;
  /**
   * `recenter` is false while a drag is in flight. Re-deriving the bounds and
   * re-centring the points mid-gesture shifts every vertex under the cursor,
   * which makes the one being dragged accelerate away from the pointer.
   */
  onShape: (shape: FootprintShape, recenter?: boolean) => void;
  onSize: (w: number, d: number) => void;
}

/** Handle currently being dragged. */
interface Drag {
  index: number;
  /** Pointer offset from the vertex, in feet, so the grab point does not jump. */
  dx: number;
  dz: number;
  moved: boolean;
}

export function PlanEditor({ mass, onShape, onSize }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [snap, setSnap] = useState(5);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [ortho, setOrtho] = useState(true);
  const [showDims, setShowDims] = useState(true);
  const [pasteOpen, setPasteOpen] = useState(false);

  const shape = mass.shape ?? { kind: "rect" as const };
  const footprint = massFootprint(mass);
  const ring = outerRing(footprint);
  const holes = holeRings(footprint);
  const segments = facadeSegments(footprint);
  const editable = shape.kind === "polygon";

  // Frame the plan with a margin, so handles near the edge stay grabbable.
  const view = useMemo(() => {
    const pad = Math.max(20, Math.max(mass.w, mass.d) * 0.14);
    const halfW = mass.w / 2 + pad;
    const halfD = mass.d / 2 + pad;
    return { minX: -halfW, minY: -halfD, width: halfW * 2, height: halfD * 2 };
  }, [mass.w, mass.d]);

  /** Screen point -> plan feet. */
  const toPlan = useCallback((clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    const x = view.minX + fx * view.width;
    // SVG y runs down; plan z runs north, so the sign flips here and only here.
    const z = -(view.minY + fy * view.height);
    return [x, z];
  }, [view]);

  const applySnap = useCallback(
    (value: number) => (snap > 0 ? Math.round(value / snap) * snap : Math.round(value * 100) / 100),
    [snap],
  );

  const points = editable ? (shape as Extract<FootprintShape, { kind: "polygon" }>).points : ring;

  const updatePoints = (next: Point[], recenter = true) => {
    onShape({ ...(shape.kind === "polygon" ? shape : {}), kind: "polygon", points: next }, recenter);
  };

  /** Turn a preset into an editable polygon, preserving what is on screen. */
  const makeEditable = (): Point[] => {
    if (editable) return points;
    const converted = toPolygonShape(footprint);
    onShape(converted);
    return (converted as Extract<FootprintShape, { kind: "polygon" }>).points;
  };

  const onVertexDown = (event: React.PointerEvent, index: number) => {
    event.stopPropagation();
    const plan = toPlan(event.clientX, event.clientY);
    if (!plan) return;
    const current = makeEditable();
    const vertex = current[index];
    setSelected(index);
    setDrag({ index, dx: plan[0] - vertex[0], dz: plan[1] - vertex[1], moved: false });
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };

  const onMove = (event: React.PointerEvent) => {
    if (!drag) return;
    const plan = toPlan(event.clientX, event.clientY);
    if (!plan) return;

    const current = editable ? points : makeEditable();
    let x = applySnap(plan[0] - drag.dx);
    let z = applySnap(plan[1] - drag.dz);

    // Orthogonal lock: hold the dragged vertex square to whichever neighbour it
    // is more nearly aligned with, which is what keeps a hand-drawn plan
    // buildable instead of subtly out of true everywhere.
    if (ortho) {
      const prev = current[(drag.index - 1 + current.length) % current.length];
      const next = current[(drag.index + 1) % current.length];
      const snapped = orthoLock([x, z], prev, next, snap || 1);
      x = snapped[0];
      z = snapped[1];
    }

    const updated = current.map((p, i) => (i === drag.index ? ([x, z] as Point) : p));
    setDrag({ ...drag, moved: true });
    updatePoints(updated, false);
  };

  /** Settle the frame once the gesture ends, not during it. */
  const onUp = () => {
    if (drag?.moved && editable) updatePoints(points, true);
    setDrag(null);
  };

  /** Insert a vertex at an edge midpoint. */
  const splitEdge = (index: number) => {
    const current = makeEditable();
    const a = current[index];
    const b = current[(index + 1) % current.length];
    const mid: Point = [applySnap((a[0] + b[0]) / 2), applySnap((a[1] + b[1]) / 2)];
    const next = [...current.slice(0, index + 1), mid, ...current.slice(index + 1)];
    updatePoints(next);
    setSelected(index + 1);
  };

  const deleteVertex = (index: number) => {
    const current = makeEditable();
    // Below four points there is no polygon left to edit.
    if (current.length <= 3) return;
    updatePoints(current.filter((_, i) => i !== index));
    setSelected(null);
  };

  const area = footprintArea(footprint);
  const perimeter = footprintPerimeter(footprint);
  const scale = view.width / 100;

  return (
    <>
      <Section title="Plan shape" meta={FOOTPRINT_LABELS[shape.kind]}>
        <Field label="Shape">
          <Select
            value={shape.kind}
            onChange={(kind) => onShape(defaultShape(kind as FootprintKind))}
            options={(Object.keys(FOOTPRINT_LABELS) as FootprintKind[]).map((k) => ({
              value: k,
              label: FOOTPRINT_LABELS[k],
            }))}
          />
        </Field>

        <div
          style={{
            marginTop: 10,
            border: "1px solid var(--line-strong)",
            borderRadius: "var(--r-sm)",
            background: "var(--sunken)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <svg
            ref={svgRef}
            viewBox={`${view.minX} ${view.minY} ${view.width} ${view.height}`}
            style={{ display: "block", width: "100%", aspectRatio: `${view.width} / ${view.height}`, touchAction: "none" }}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
            onClick={() => setSelected(null)}
          >
            <defs>
              <pattern id="plan-grid" width="10" height="10" patternUnits="userSpaceOnUse">
                <path d="M10 0 L0 0 0 10" fill="none" stroke="var(--line)" strokeWidth={scale * 0.35} />
              </pattern>
            </defs>
            <rect x={view.minX} y={view.minY} width={view.width} height={view.height} fill="url(#plan-grid)" />

            {/* Bounding box the shape sits inside. */}
            <rect
              x={-mass.w / 2}
              y={-mass.d / 2}
              width={mass.w}
              height={mass.d}
              fill="none"
              stroke="var(--ink-3)"
              strokeWidth={scale * 0.4}
              strokeDasharray={`${scale * 3} ${scale * 3}`}
              opacity={0.55}
            />

            {/* The plan itself. */}
            <path
              d={pathOf(points, holes)}
              fill="color-mix(in srgb, var(--navy) 16%, transparent)"
              stroke="var(--navy)"
              strokeWidth={scale * 0.9}
              strokeLinejoin="round"
              fillRule="evenodd"
            />

            {showDims &&
              segments.map((s) => {
                const mx = (s.start[0] + s.end[0]) / 2;
                const mz = (s.start[1] + s.end[1]) / 2;
                // Push the label just outside the wall it measures.
                const off = scale * 5;
                return (
                  <text
                    key={s.index}
                    x={mx + s.normal[0] * off}
                    y={-(mz + s.normal[1] * off)}
                    fontSize={scale * 3.4}
                    fill="var(--ink-2)"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{ fontFamily: "var(--mono)", pointerEvents: "none" }}
                  >
                    {Math.round(s.length)}′
                  </text>
                );
              })}

            {/* Midpoint handles: click to add a vertex. */}
            {points.map((p, i) => {
              const b = points[(i + 1) % points.length];
              const mx = (p[0] + b[0]) / 2;
              const mz = (p[1] + b[1]) / 2;
              return (
                <circle
                  key={`mid-${i}`}
                  cx={mx}
                  cy={-mz}
                  r={scale * 1.5}
                  fill="var(--panel)"
                  stroke="var(--ink-3)"
                  strokeWidth={scale * 0.4}
                  style={{ cursor: "copy" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    splitEdge(i);
                  }}
                >
                  <title>Add a point here</title>
                </circle>
              );
            })}

            {/* Vertex handles. */}
            {points.map((p, i) => (
              <g key={`v-${i}`}>
                <circle
                  cx={p[0]}
                  cy={-p[1]}
                  r={scale * (selected === i ? 2.6 : 2.1)}
                  fill={selected === i ? "var(--accent)" : "var(--panel)"}
                  stroke={selected === i ? "var(--accent)" : "var(--navy)"}
                  strokeWidth={scale * 0.6}
                  style={{ cursor: "grab" }}
                  onPointerDown={(e) => onVertexDown(e, i)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <title>{`${Math.round(p[0])}, ${Math.round(p[1])} — drag to move`}</title>
                </circle>
                {selected === i && (
                  <text
                    x={p[0]}
                    y={-p[1] - scale * 4.5}
                    fontSize={scale * 3.2}
                    fill="var(--accent)"
                    textAnchor="middle"
                    style={{ fontFamily: "var(--mono)", pointerEvents: "none" }}
                  >
                    {Math.round(p[0])}, {Math.round(p[1])}
                  </text>
                )}
              </g>
            ))}

            {/* North arrow, because a plan without one is ambiguous. */}
            <g transform={`translate(${view.minX + view.width * 0.06}, ${view.minY + view.height * 0.12})`}>
              <path
                d={`M0 ${-scale * 5} L${scale * 2} ${scale * 3} L0 ${scale * 1} L${-scale * 2} ${scale * 3} Z`}
                fill="var(--ink-2)"
              />
              <text
                y={scale * 8}
                fontSize={scale * 3.4}
                fill="var(--ink-2)"
                textAnchor="middle"
                style={{ fontFamily: "var(--mono)" }}
              >
                N
              </text>
            </g>
          </svg>
        </div>

        <div className="row mt-2" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-start" }}>
          <Segmented
            value={String(snap)}
            onChange={(v) => setSnap(Number(v))}
            options={SNAPS.map((s) => ({ value: s.value, label: s.label, title: "Snap increment" }))}
          />
          <button
            className={`btn sm${ortho ? " active" : ""}`}
            onClick={() => setOrtho((o) => !o)}
            title="Keep edges square to their neighbours while dragging"
          >
            Ortho
          </button>
          <button className={`btn sm${showDims ? " active" : ""}`} onClick={() => setShowDims((d) => !d)}>
            Dims
          </button>
          {selected != null && editable && points.length > 3 && (
            <button className="btn sm" style={{ color: "var(--bad)" }} onClick={() => deleteVertex(selected)}>
              Delete point
            </button>
          )}
        </div>

        <p className="hint mt-2">
          {editable ? (
            <>
              Drag a point to move it, click a hollow midpoint to add one.{" "}
              <b className="num">{points.length}</b> points.
            </>
          ) : (
            <>Drag any point to convert this preset into an editable custom plan.</>
          )}
        </p>

        <div className="grid-3 mt-2">
          <Readout label="Area" value={`${num(Math.round(area))} SF`} />
          <Readout label="Perimeter" value={`${num(Math.round(perimeter))}′`} />
          <Readout label="Walls" value={String(segments.length)} />
        </div>
      </Section>

      <PresetControls shape={shape} onShape={onShape} />

      <Section title="Size & import" defaultOpen={false}>
        <div className="grid-2">
          <Field label="Bounding width (ft)">
            <NumberInput value={Math.round(mass.w)} min={10} onChange={(v) => onSize(v, mass.d)} />
          </Field>
          <Field label="Bounding depth (ft)">
            <NumberInput value={Math.round(mass.d)} min={10} onChange={(v) => onSize(mass.w, v)} />
          </Field>
        </div>
        <p className="hint mt-1">
          Resizing scales a custom plan proportionally, so a traced site keeps its shape.
        </p>

        <button className="btn mt-2" style={{ width: "100%" }} onClick={() => setPasteOpen((p) => !p)}>
          {pasteOpen ? "Cancel import" : "Paste coordinates…"}
        </button>
        {pasteOpen && (
          <CoordinateImport
            onImport={(imported) => {
              onShape({ kind: "polygon", points: imported });
              setPasteOpen(false);
            }}
          />
        )}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="num" style={{ fontSize: 13, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

/** Parameter controls for whichever preset is selected. */
function PresetControls({ shape, onShape }: { shape: FootprintShape; onShape: (s: FootprintShape) => void }) {
  if (shape.kind === "rect" || shape.kind === "polygon") return null;

  const slider = (label: string, key: string, value: number, min: number, max: number, hint?: string) => (
    <div>
      <div className="row">
        <span className="label">{label}</span>
        <span className="num" style={{ fontSize: 11 }}>{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={0.01}
        value={value}
        onChange={(e) => onShape({ ...shape, [key]: Number(e.target.value) } as FootprintShape)}
      />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );

  return (
    <Section title={`${FOOTPRINT_LABELS[shape.kind]} parameters`}>
      <div className="stack">
        {shape.kind === "L" && (
          <>
            {slider("Wing width", "armW", shape.armW, 0.15, 0.85)}
            {slider("Bar depth", "armD", shape.armD, 0.15, 0.85)}
            <Field label="Notch corner">
              <Select
                value={shape.notch}
                onChange={(notch) => onShape({ ...shape, notch: notch as typeof shape.notch })}
                options={[
                  { value: "ne", label: "North-east" },
                  { value: "nw", label: "North-west" },
                  { value: "se", label: "South-east" },
                  { value: "sw", label: "South-west" },
                ]}
              />
            </Field>
          </>
        )}

        {shape.kind === "U" && (
          <>
            {slider("Wing width", "armW", shape.armW, 0.12, 0.45)}
            {slider("Court depth", "courtD", shape.courtD, 0.2, 0.85)}
            <Field label="Court opens toward">
              <Select
                value={shape.open}
                onChange={(open) => onShape({ ...shape, open: open as typeof shape.open })}
                options={[
                  { value: "N", label: "North" },
                  { value: "E", label: "East" },
                  { value: "S", label: "South" },
                  { value: "W", label: "West" },
                ]}
              />
            </Field>
          </>
        )}

        {shape.kind === "T" && (
          <>
            {slider("Stem width", "stemW", shape.stemW, 0.15, 0.7)}
            {slider("Bar depth", "barD", shape.barD, 0.2, 0.8)}
            <Field label="Stem projects toward">
              <Select
                value={shape.stem}
                onChange={(stem) => onShape({ ...shape, stem: stem as typeof shape.stem })}
                options={[
                  { value: "N", label: "North" },
                  { value: "E", label: "East" },
                  { value: "S", label: "South" },
                  { value: "W", label: "West" },
                ]}
              />
            </Field>
          </>
        )}

        {shape.kind === "courtyard" && (
          <>
            {slider("Court width", "courtW", shape.courtW, 0.15, 0.8)}
            {slider("Court depth", "courtD", shape.courtD, 0.15, 0.8)}
            {slider("Offset east", "offsetX", shape.offsetX, -0.35, 0.35)}
            {slider("Offset north", "offsetZ", shape.offsetZ, -0.35, 0.35)}
          </>
        )}
      </div>
      <p className="hint mt-2">
        Editing these keeps the plan a preset. Dragging a point in the plan above makes it custom.
      </p>
    </Section>
  );
}

/** Paste a coordinate list from a survey or a DXF-derived export. */
function CoordinateImport({ onImport }: { onImport: (points: Point[]) => void }) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => parseCoordinates(text), [text]);

  return (
    <div className="mt-2">
      <textarea
        className="control"
        rows={5}
        placeholder={"0, 0\n180, 0\n180, 90\n60, 120\n0, 120"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ resize: "vertical", fontFamily: "var(--mono)", fontSize: 11.5, textAlign: "left" }}
      />
      <p className="hint mt-1">
        One point per line as <code>x, y</code> in feet. Commas, tabs or spaces all work, and the
        winding is corrected automatically — a survey exported clockwise imports the same as one
        exported counter-clockwise.
      </p>
      {text.trim() && (
        <p className="hint" style={{ color: parsed.length >= 3 ? "var(--good)" : "var(--bad)" }}>
          {parsed.length >= 3
            ? `${parsed.length} points read.`
            : `Need at least 3 points; read ${parsed.length}.`}
        </p>
      )}
      <button
        className="btn primary mt-1"
        style={{ width: "100%" }}
        disabled={parsed.length < 3}
        onClick={() => onImport(parsed)}
      >
        Use these points
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Parse a pasted coordinate list. Tolerant of separators and stray blank lines. */
export function parseCoordinates(text: string): Point[] {
  const points: Point[] = [];
  for (const line of text.split(/[\n\r]+/)) {
    const trimmed = line.trim();
    if (!trimmed || /^[a-z]/i.test(trimmed)) continue; // skip headers and labels
    const parts = trimmed.split(/[\s,;\t]+/).filter(Boolean).map(Number);
    if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) continue;
    points.push([parts[0], parts[1]]);
  }
  // A closed ring repeats its first point; the model stores it open.
  if (points.length > 3) {
    const [fx, fz] = points[0];
    const [lx, lz] = points[points.length - 1];
    if (Math.abs(fx - lx) < 0.01 && Math.abs(fz - lz) < 0.01) points.pop();
  }
  return points;
}

/**
 * Square a dragged vertex to whichever neighbour it is more nearly aligned
 * with. Without this, a hand-drawn plan ends up a degree or two out on every
 * edge, which looks fine on screen and is not buildable.
 */
export function orthoLock(p: Point, prev: Point, next: Point, tolerance: number): Point {
  let [x, z] = p;
  for (const neighbour of [prev, next]) {
    if (Math.abs(x - neighbour[0]) <= tolerance) x = neighbour[0];
    if (Math.abs(z - neighbour[1]) <= tolerance) z = neighbour[1];
  }
  return [x, z];
}

/** SVG path for a ring and its holes, with y flipped into screen space. */
function pathOf(ring: Point[], holes: Point[][]): string {
  const draw = (r: Point[]) =>
    r.map(([x, z], i) => `${i === 0 ? "M" : "L"}${x} ${-z}`).join(" ") + " Z";
  return [ring, ...holes].map(draw).join(" ");
}

export { composeFootprint };
