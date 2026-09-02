/**
 * Photoreal pass.
 *
 * The viewport render is the draft; this turns it into something presentable.
 * The conditioning passes are rendered here rather than by the provider,
 * because they come from the 3D scene and are therefore exact — no depth
 * estimator guessing at a flat image.
 */

import { useMemo, useRef, useState } from "react";
import { Chip, Empty, Field, NumberInput, Section, Segmented } from "@/ui/primitives";
import { useActiveScheme, useProject } from "../store/useProject";
import type { ViewportHandle } from "@/render/Viewport";
import type { PassKind } from "@/render/passes";
import { describeScheme } from "@/render/ai/describeScheme";
import {
  PROVIDERS,
  clearProviderConfig,
  loadProviderConfigs,
  providerById,
  saveProviderConfig,
} from "@/render/ai/registry";
import type { ControlImages, RenderResult, StructureLock } from "@/render/ai/provider";
import type { ReplicateProvider } from "@/render/ai/replicate";

const SIZES = [
  { label: "1024", width: 1024, height: 640 },
  { label: "1440", width: 1440, height: 900 },
  { label: "1920", width: 1920, height: 1200 },
];

const PASS_LABELS: Record<string, string> = {
  beauty: "Render",
  depth: "Depth",
  edge: "Linework",
  mask: "Materials",
};

export function PhotorealPanel({
  viewport,
  onResult,
}: {
  viewport: React.RefObject<ViewportHandle | null>;
  /** Published so the sheets can use the photoreal image as their hero. */
  onResult?: (image: string | null) => void;
}) {
  const scheme = useActiveScheme();
  const project = useProject((s) => s.project);

  const [providerId, setProviderId] = useState(PROVIDERS[0].id);
  const [structure, setStructure] = useState<StructureLock>("balanced");
  const [size, setSize] = useState(SIZES[1]);
  const [seed, setSeed] = useState(0);
  const [subject, setSubject] = useState("");
  const [controls, setControls] = useState<ControlImages | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const provider = providerById(providerId)!;
  const autoSubject = useMemo(
    () => (scheme ? describeScheme(scheme, project) : ""),
    [scheme, project],
  );

  if (!scheme) return <Empty>No scheme selected.</Empty>;

  const capturePasses = async () => {
    const handle = viewport.current;
    if (!handle) return null;
    setBusy("Capturing conditioning passes");
    setError(null);
    try {
      const kinds = [...new Set<PassKind>(["beauty", "depth", "edge", "mask", ...provider.usesPasses])];
      // The control image only has to describe geometry cleanly — the model
      // repaints the materials regardless — so this is deliberately far short
      // of a converged beauty render.
      const captured = await handle.renderPasses(kinds, size.width, size.height, 64);
      const next = captured as unknown as ControlImages;
      setControls(next);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not render the passes");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    const ready = controls ?? (await capturePasses());
    if (!ready) return;
    if (!provider.isConfigured()) {
      setError(`${provider.label} needs an API key — set it below.`);
      return;
    }

    setBusy("Rendering");
    setProgress(0);
    setError(null);
    abortRef.current = new AbortController();

    try {
      const output = await provider.render({
        controls: ready,
        prompt: subject.trim() || autoSubject,
        structure,
        width: size.width,
        height: size.height,
        seed: seed > 0 ? seed : undefined,
        signal: abortRef.current.signal,
        onProgress: (fraction, note) => {
          setProgress(fraction);
          if (note) setBusy(note);
        },
      });
      setResult(output);
      onResult?.(output.image);
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        setError(err instanceof Error ? err.message : "The render failed");
      }
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  };

  const download = (dataUrl: string, name: string) => {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = name;
    link.click();
  };

  return (
    <>
      <Section title="Photoreal pass" meta={<Chip kind={provider.isConfigured() ? "good" : "warn"}>{provider.state()}</Chip>}>
        <p className="hint">
          The viewport render is the draft. This conditions an image model on it — plus exact depth
          and linework taken from the 3D scene, not estimated from the picture — so the photoreal
          output is the building you priced rather than one the model invented.
        </p>

        <div className="mt-2">
          <Field label="Provider" hint={provider.summary}>
            <select className="control" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-2">
          <Field
            label="Structure lock"
            hint={
              provider.maxLock === "strict"
                ? "This provider conditions on depth and linework directly, so strict really is strict."
                : "This provider holds structure by instruction, so strict reduces drift rather than eliminating it."
            }
          >
            <Segmented
              value={structure}
              onChange={(v) => setStructure(v as StructureLock)}
              options={[
                { value: "loose", label: "Loose", title: "Most freedom, most drift" },
                { value: "balanced", label: "Balanced" },
                { value: "strict", label: "Strict", title: "Hold the geometry" },
              ]}
            />
          </Field>
        </div>

        <div className="grid-2 mt-2">
          <Field label="Size">
            <select
              className="control"
              value={size.label}
              onChange={(e) => setSize(SIZES.find((s) => s.label === e.target.value) ?? SIZES[1])}
            >
              {SIZES.map((s) => (
                <option key={s.label} value={s.label}>{s.width}×{s.height}</option>
              ))}
            </select>
          </Field>
          <Field label="Seed" hint="0 for random">
            <NumberInput value={seed} min={0} step={1} onChange={(v) => setSeed(Math.round(v))} />
          </Field>
        </div>

        <div className="mt-2">
          <Field label="Description" hint="Derived from the scheme. Edit to steer the result.">
            <textarea
              className="control"
              rows={4}
              value={subject}
              placeholder={autoSubject}
              onChange={(e) => setSubject(e.target.value)}
              style={{ resize: "vertical", fontFamily: "inherit", textAlign: "left" }}
            />
          </Field>
          {subject && (
            <button className="btn ghost sm mt-1" onClick={() => setSubject("")}>
              Reset to derived description
            </button>
          )}
        </div>

        <div className="row mt-2" style={{ justifyContent: "flex-start", gap: 8 }}>
          <button className="btn" onClick={capturePasses} disabled={Boolean(busy)}>
            Capture passes
          </button>
          <button className="btn primary" onClick={run} disabled={Boolean(busy)}>
            {busy ?? "Render photoreal"}
          </button>
          {busy && abortRef.current && (
            <button className="btn ghost" onClick={() => abortRef.current?.abort()}>Cancel</button>
          )}
        </div>

        {busy && progress > 0 && (
          <div className="sample-bar mt-2" style={{ width: "100%" }}>
            <span style={{ width: `${progress * 100}%` }} />
          </div>
        )}

        {error && (
          <div
            className="mt-2"
            style={{
              padding: "8px 10px",
              borderRadius: "var(--r-sm)",
              border: "1px solid var(--bad)",
              background: "color-mix(in srgb, var(--bad) 8%, transparent)",
              fontSize: 11.5,
              color: "var(--bad)",
            }}
          >
            {error}
          </div>
        )}
      </Section>

      {controls && (
        <Section title="Conditioning passes" meta={`${Object.keys(controls).length}`} defaultOpen={false}>
          <p className="hint">
            Exact depth and geometric linework, plus a mask that knows which pixels are glass and
            which are brick. These constrain the model instead of leaving it to guess.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
            {(["beauty", "depth", "edge", "mask"] as const).map((kind) =>
              controls[kind] ? (
                <figure key={kind} style={{ margin: 0 }}>
                  <img
                    src={controls[kind]}
                    alt={PASS_LABELS[kind]}
                    style={{
                      width: "100%",
                      borderRadius: "var(--r-sm)",
                      border: "1px solid var(--line)",
                      display: "block",
                    }}
                  />
                  <figcaption className="label" style={{ marginTop: 3 }}>{PASS_LABELS[kind]}</figcaption>
                </figure>
              ) : null,
            )}
          </div>
        </Section>
      )}

      {result && (
        <Section title="Result" meta={`${result.elapsedSeconds.toFixed(1)}s`}>
          <img
            src={result.image}
            alt="Photoreal render"
            style={{ width: "100%", borderRadius: "var(--r-sm)", border: "1px solid var(--line)", display: "block" }}
          />
          <div className="row mt-2" style={{ justifyContent: "flex-start", gap: 8 }}>
            <button
              className="btn"
              onClick={() => download(result.image, `bud-photoreal-${Date.now()}.png`)}
            >
              Download
            </button>
            <span className="hint">{result.model}{result.seed != null && ` · seed ${result.seed}`}</span>
          </div>
        </Section>
      )}

      <ProviderSettings providerId={providerId} />
    </>
  );
}

/**
 * Where the bundled pass-through lives, and whether we are somewhere it exists.
 *
 * It is dev-server middleware, so a built copy served from anywhere else does
 * not have one. Saying that outright beats letting someone re-paste a good key
 * at a wall: a hosted page cannot reach an image API however it is configured.
 */
const LOCAL_PROXY = "/ai-proxy?url={url}";
const LOCAL =
  typeof location !== "undefined" &&
  /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

function ProviderSettings({ providerId }: { providerId: string }) {
  const provider = providerById(providerId)!;
  const stored = loadProviderConfigs()[providerId] ?? {};
  const [apiKey, setApiKey] = useState(stored.apiKey ?? "");
  const [proxyUrl, setProxyUrl] = useState(stored.proxyUrl ?? "");
  const [version, setVersion] = useState(stored.version ?? "");
  const [model, setModel] = useState(stored.model ?? provider.models[0]?.id ?? "");
  const [saved, setSaved] = useState(false);

  const isReplicate = provider.id === "replicate";

  const save = () => {
    const config = { apiKey: apiKey.trim(), proxyUrl: proxyUrl.trim(), model, version: version.trim() };
    (provider as ReplicateProvider).configure(config);
    saveProviderConfig(provider.id, config);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <Section title={`${provider.label} settings`} defaultOpen={!provider.isConfigured()}>
      <div className="stack">
        <Field label="API key" hint="Stored in this browser only, never in the project file.">
          <input
            className="control"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Paste key"
          />
        </Field>

        {provider.models.length > 1 && (
          <Field label="Model">
            <select className="control" value={model} onChange={(e) => setModel(e.target.value)}>
              {provider.models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </Field>
        )}

        {isReplicate && (
          <Field
            label="Model version"
            hint="Either owner/name for an official model, or a version hash. The input field names in the adapter belong to this model."
          >
            <input
              className="control"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="owner/model-name"
            />
          </Field>
        )}

        <Field
          label="Proxy URL"
          hint={
            LOCAL
              ? "These APIs send no CORS headers, so the browser blocks a direct call before it is sent. Use the bundled pass-through, or your own: {url} is replaced with the target."
              : "Required. These APIs send no CORS headers, and a hosted copy cannot call an outside host at all — see below."
          }
        >
          <input
            className="control"
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder={LOCAL_PROXY}
          />
        </Field>

        {LOCAL && proxyUrl.trim() !== LOCAL_PROXY && (
          <button className="btn sm" onClick={() => setProxyUrl(LOCAL_PROXY)}>
            Use the local proxy
          </button>
        )}

        {!LOCAL && (
          <p className="hint" style={{ color: "var(--warn)" }}>
            This copy is served from {location.host}, which forbids requests to outside hosts, so
            no key or proxy will make a render work here. Run the app locally with{" "}
            <code>npm run dev</code> — the pass-through it serves needs no setup.
          </p>
        )}
      </div>

      <div className="row mt-2" style={{ justifyContent: "flex-start", gap: 8 }}>
        <button className="btn primary" onClick={save} disabled={!apiKey.trim()}>
          {saved ? "Saved" : "Save"}
        </button>
        {provider.isConfigured() && (
          <button
            className="btn"
            onClick={() => {
              clearProviderConfig(provider.id);
              provider.configure({ apiKey: "", proxyUrl: "" });
              setApiKey("");
              setProxyUrl("");
            }}
          >
            Clear
          </button>
        )}
      </div>

      {provider.lastError() && (
        <p className="hint mt-2" style={{ color: "var(--bad)" }}>{provider.lastError()}</p>
      )}
    </Section>
  );
}
