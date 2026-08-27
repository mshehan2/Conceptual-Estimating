/**
 * Rendering controls.
 *
 * Sun position is set by date, hour, and the project's own latitude, so the
 * shadows in the image are the shadows the building will actually cast. The
 * still export runs the same accumulator the viewport uses, just at higher
 * resolution and for more samples.
 */

import { useState } from "react";
import { Field, NumberInput, Section, Segmented } from "@/ui/primitives";
import { CAMERA_PRESETS, type ViewportHandle, type ViewportSettings } from "@/render/Viewport";
import { solarPosition } from "@/render/sun";
import { num } from "@/ui/format";
import type { RenderMode } from "@/render/materials";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STILL_SIZES = [
  { label: "1080p", width: 1920, height: 1080 },
  { label: "2K", width: 2560, height: 1440 },
  { label: "4K", width: 3840, height: 2160 },
];

export function RenderPanel({
  settings,
  onChange,
  viewport,
}: {
  settings: ViewportSettings;
  onChange: (patch: Partial<ViewportSettings>) => void;
  viewport: React.RefObject<ViewportHandle | null>;
}) {
  const [exporting, setExporting] = useState<number | null>(null);
  const [size, setSize] = useState(STILL_SIZES[1]);
  const [stillSamples, setStillSamples] = useState(320);

  const sun = solarPosition(settings.sun);

  const exportStill = async () => {
    const handle = viewport.current;
    if (!handle) return;
    setExporting(0);
    try {
      const dataUrl = await handle.renderStill(size.width, size.height, stillSamples, setExporting);
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `bud-render-${size.label}-${Date.now()}.png`;
      link.click();
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <Section title="Display">
        <Field label="Mode">
          <Segmented
            value={settings.mode}
            onChange={(v) => onChange({ mode: v as RenderMode })}
            options={[
              { value: "realistic", label: "Material", title: "Full PBR skins and glass" },
              { value: "clay", label: "Clay", title: "Neutral white model" },
              { value: "program", label: "Program", title: "Coloured by market" },
            ]}
          />
        </Field>

        <div className="row mt-2">
          <label className="row" style={{ gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={settings.showEntourage}
              onChange={(e) => onChange({ showEntourage: e.target.checked })}
            />
            Entourage
          </label>
          <label className="row" style={{ gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={settings.showGround}
              onChange={(e) => onChange({ showGround: e.target.checked })}
            />
            Ground
          </label>
        </div>
      </Section>

      <Section title="Camera">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {CAMERA_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className="btn sm"
              onClick={() => viewport.current?.applyPreset(preset)}
            >
              {preset.label}
            </button>
          ))}
          <button className="btn sm" onClick={() => viewport.current?.frameAll()}>Fit</button>
        </div>
        <p className="hint mt-2">
          Drag to orbit, shift-drag or right-drag to pan, scroll to zoom. The image sharpens as
          soon as you stop moving.
        </p>
      </Section>

      <Section
        title="Sun"
        meta={sun.up ? `${sun.altitude.toFixed(0)}° alt · ${sun.azimuth.toFixed(0)}°` : "below horizon"}
      >
        <div className="grid-2">
          <Field label="Month">
            <select
              className="control"
              value={settings.sun.month}
              onChange={(e) => onChange({ sun: { ...settings.sun, month: Number(e.target.value) } })}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Day">
            <NumberInput
              value={settings.sun.day}
              min={1}
              max={31}
              onChange={(v) => onChange({ sun: { ...settings.sun, day: Math.round(v) } })}
            />
          </Field>
        </div>

        <div className="mt-2">
          <div className="row">
            <span className="label">Hour</span>
            <span className="num" style={{ fontSize: 11 }}>
              {String(Math.floor(settings.sun.hour)).padStart(2, "0")}:
              {String(Math.round((settings.sun.hour % 1) * 60)).padStart(2, "0")}
            </span>
          </div>
          <input
            type="range"
            min={4}
            max={21}
            step={0.25}
            value={settings.sun.hour}
            onChange={(e) => onChange({ sun: { ...settings.sun, hour: Number(e.target.value) } })}
          />
        </div>

        <div className="mt-2">
          <div className="row">
            <span className="label">Cloud cover</span>
            <span className="num" style={{ fontSize: 11 }}>{Math.round(settings.overcast * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={settings.overcast}
            onChange={(e) => onChange({ overcast: Number(e.target.value) })}
          />
          <p className="hint">
            An overcast sky widens the sun's effective size, so shadows soften as well as dim.
          </p>
        </div>

        <div className="mt-2">
          <div className="row">
            <span className="label">Exposure</span>
            <span className="num" style={{ fontSize: 11 }}>{settings.exposure.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0.3}
            max={2.4}
            step={0.02}
            value={settings.exposure}
            onChange={(e) => onChange({ exposure: Number(e.target.value) })}
          />
        </div>

        <p className="hint mt-2">
          Latitude {settings.sun.latitude.toFixed(2)}°, longitude {settings.sun.longitude.toFixed(2)}°.
          Set the project location to move the sun to the real site.
        </p>
      </Section>

      <Section title="Quality" meta={`${settings.maxSamples} samples`} defaultOpen={false}>
        <div className="row">
          <span className="label">Viewport samples</span>
          <span className="num" style={{ fontSize: 11 }}>{settings.maxSamples}</span>
        </div>
        <input
          type="range"
          min={16}
          max={400}
          step={8}
          value={settings.maxSamples}
          onChange={(e) => onChange({ maxSamples: Number(e.target.value) })}
        />
        <p className="hint">
          Each sample re-renders with the projection and sun slightly offset. More samples means
          cleaner edges and softer, more accurate shadows; the cost is only paid while the camera
          is still.
        </p>
      </Section>

      <Section title="Export a still">
        <div className="grid-2">
          <Field label="Resolution">
            <select
              className="control"
              value={size.label}
              onChange={(e) => setSize(STILL_SIZES.find((s) => s.label === e.target.value) ?? STILL_SIZES[1])}
            >
              {STILL_SIZES.map((s) => (
                <option key={s.label} value={s.label}>
                  {s.label} · {num(s.width)}×{num(s.height)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Samples">
            <NumberInput value={stillSamples} min={32} max={2000} step={32} onChange={(v) => setStillSamples(Math.round(v))} />
          </Field>
        </div>

        <button className="btn primary mt-2" style={{ width: "100%" }} onClick={exportStill} disabled={exporting !== null}>
          {exporting === null ? "Render and download PNG" : `Rendering… ${Math.round(exporting * 100)}%`}
        </button>

        {exporting !== null && (
          <div className="sample-bar mt-2" style={{ width: "100%" }}>
            <span style={{ width: `${exporting * 100}%` }} />
          </div>
        )}

        <p className="hint mt-2">
          Renders from the current camera at full resolution. 4K at 320 samples takes a few seconds
          and is worth putting in front of a client.
        </p>
      </Section>
    </>
  );
}
