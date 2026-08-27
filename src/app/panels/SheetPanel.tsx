/**
 * Sheet assembly.
 *
 * Captures the views a sheet needs from the live model, so the drawing on the
 * sheet is the drawing that was priced. Any photoreal result already produced
 * can stand in as the hero image.
 */

import { useState } from "react";
import { Chip, Field, Section } from "@/ui/primitives";
import { useProject } from "../store/useProject";
import { CAMERA_PRESETS, type ViewportHandle } from "@/render/Viewport";
import { SheetViewer, type SheetImages, type SheetKind } from "../sheets/PresentationSheets";

const HERO_PRESET = CAMERA_PRESETS.find((p) => p.id === "corner") ?? CAMERA_PRESETS[0];
const THUMB_PRESETS = ["aerial", "street", "plan"];

export function SheetPanel({
  viewport,
  photorealImage,
  quality,
}: {
  viewport: React.RefObject<ViewportHandle | null>;
  photorealImage?: string | null;
  /**
   * Viewport sample budget. Sheet capture scales off it so the quality slider
   * on the Render tab governs how long building a sheet takes — on a machine
   * without a real GPU, a fixed high count is the difference between seconds
   * and minutes.
   */
  quality: number;
}) {
  const project = useProject((s) => s.project);
  const estimates = useProject((s) => s.estimates);
  const setActiveScheme = useProject((s) => s.setActiveScheme);

  const [kinds, setKinds] = useState<SheetKind[]>(["concept"]);
  const [images, setImages] = useState<SheetImages | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [usePhotoreal, setUsePhotoreal] = useState(true);

  const toggle = (kind: SheetKind) =>
    setKinds((current) =>
      current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind],
    );

  const capture = async () => {
    const handle = viewport.current;
    if (!handle) return;
    setBusy("Framing views");

    const heroSamples = Math.max(24, Math.round(quality * 1.4));
    const thumbSamples = Math.max(16, Math.round(quality * 0.7));
    const optionSamples = Math.max(20, Math.round(quality * 0.9));

    try {
      const shots: SheetImages = { thumbs: [], bySchemeId: {} };

      // Hero and thumbnails for the active scheme.
      handle.applyPreset(HERO_PRESET);
      await settle();
      shots.hero = (await handle.renderPasses(["beauty"], 1400, 900, heroSamples)).beauty;

      for (const id of THUMB_PRESETS) {
        const preset = CAMERA_PRESETS.find((p) => p.id === id);
        if (!preset) continue;
        setBusy(`Rendering ${preset.label.toLowerCase()} view`);
        handle.applyPreset(preset);
        await settle();
        const shot = (await handle.renderPasses(["beauty"], 700, 480, thumbSamples)).beauty;
        shots.thumbs.push({ label: preset.label, src: shot });
      }

      // One shot per scheme for the comparison sheet, which means switching the
      // active scheme; the original is restored when the loop finishes.
      if (kinds.includes("comparison")) {
        const original = project.activeSchemeId;
        for (const scheme of project.schemes.slice(0, 4)) {
          setBusy(`Rendering ${scheme.name}`);
          setActiveScheme(scheme.id);
          await settle(700);
          handle.applyPreset(HERO_PRESET);
          await settle();
          shots.bySchemeId[scheme.id] = (await handle.renderPasses(["beauty"], 760, 500, optionSamples)).beauty;
        }
        setActiveScheme(original);
        await settle(400);
      }

      if (usePhotoreal && photorealImage) shots.hero = photorealImage;
      setImages(shots);
      setOpen(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Section title="Presentation sheets">
        <p className="hint">
          A concept summary and an options comparison, laid out at 17″ × 11″ and printed straight to
          PDF. Views are captured from the live model, so the drawing on the sheet is the drawing
          that was priced.
        </p>

        <div className="stack mt-2">
          <label className="row" style={{ justifyContent: "flex-start", gap: 7, fontSize: 12 }}>
            <input type="checkbox" checked={kinds.includes("concept")} onChange={() => toggle("concept")} />
            Concept summary
            <span className="hint">— hero view, cost breakdown, market band</span>
          </label>
          <label className="row" style={{ justifyContent: "flex-start", gap: 7, fontSize: 12 }}>
            <input type="checkbox" checked={kinds.includes("comparison")} onChange={() => toggle("comparison")} />
            Options comparison
            <span className="hint">— {project.schemes.length} scheme{project.schemes.length === 1 ? "" : "s"} side by side</span>
          </label>
          {photorealImage && (
            <label className="row" style={{ justifyContent: "flex-start", gap: 7, fontSize: 12 }}>
              <input type="checkbox" checked={usePhotoreal} onChange={(e) => setUsePhotoreal(e.target.checked)} />
              Use the photoreal render as the hero image
              <Chip kind="good">available</Chip>
            </label>
          )}
        </div>

        <button
          className="btn primary mt-2"
          style={{ width: "100%" }}
          onClick={capture}
          disabled={Boolean(busy) || kinds.length === 0}
        >
          {busy ?? "Build sheets"}
        </button>

        {images && !open && (
          <button className="btn mt-2" style={{ width: "100%" }} onClick={() => setOpen(true)}>
            Reopen last sheets
          </button>
        )}

        <p className="hint mt-2">
          Every sheet carries the estimate's basis in its footer — index, escalation, rate sources
          and the fact that quantities come from massing. A number that leaves the building without
          its basis is how a conceptual figure gets quoted back as a commitment.
        </p>
      </Section>

      <Section title="Title block" defaultOpen={false}>
        <div className="stack">
          <Field label="Project number">
            <input
              className="control"
              value={project.number}
              onChange={(e) => useProject.getState().patchProject({ number: e.target.value })}
            />
          </Field>
          <p className="hint">
            Project name, client and location come from the header; market and building type come
            from the scheme.
          </p>
        </div>
      </Section>

      {open && images && (
        <SheetViewer
          kinds={kinds}
          project={project}
          estimates={estimates}
          images={images}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Give the progressive renderer time to converge before grabbing a frame. */
const settle = (ms = 900) => new Promise((resolve) => setTimeout(resolve, ms));
