/**
 * Cost data.
 *
 * Shows the source stack in priority order, what each one currently holds, and
 * how to feed it. The DESTINI endpoint form is the whole "go live" step: fill
 * it in and the live source outranks everything below it on the next estimate.
 */

import { useRef, useState } from "react";
import { Chip, Empty, Field, Section } from "@/ui/primitives";
import { useProject } from "../store/useProject";
import {
  clearDestiniConfig,
  destiniSource,
  importSource,
  overrideSource,
  resolver,
  saveDestiniConfig,
  seedSource,
  loadDestiniConfig,
} from "../store/costSources";
import type { ImportReport } from "@/costs/sources/importSource";
import { rate, since } from "@/ui/format";
import { PRIORITY, type SourceStatus } from "@/costs/source";

const STATE_TONE: Record<SourceStatus["state"], string | undefined> = {
  ready: "good",
  loading: undefined,
  empty: undefined,
  error: "bad",
  unconfigured: "warn",
};

export function CostDataPanel() {
  const project = useProject((s) => s.project);
  const bump = useProject((s) => s.bumpSources);
  const clearOverride = useProject((s) => s.clearOverride);
  const revision = useProject((s) => s.sourceRevision);

  return (
    <>
      <Section title="Source stack" meta={`${resolver.list().length} sources`}>
        <p className="hint">
          Highest priority that can answer a question wins it. Everything it outranks stays
          visible on the line it superseded.
        </p>
        <div className="stack mt-2">
          {resolver
            .list()
            .map((source) => {
              const status = source.status();
              return (
                <div
                  key={source.id}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: "var(--r-sm)",
                    padding: "8px 10px",
                    background: "var(--panel-alt)",
                  }}
                >
                  <div className="row">
                    <strong style={{ fontSize: 12 }}>{source.label}</strong>
                    <Chip kind={STATE_TONE[status.state]}>{status.state}</Chip>
                  </div>
                  <div className="row" style={{ marginTop: 3 }}>
                    <span className="hint truncate" title={status.detail}>{status.detail ?? "—"}</span>
                    <span className="label">P{source.priority}</span>
                  </div>
                </div>
              );
            })}
        </div>
        {void revision}
      </Section>

      <DestiniSection onChange={bump} />
      <ImportSection onChange={bump} />

      <Section
        title="Manual overrides"
        meta={project.overrides.length ? `${project.overrides.length}` : undefined}
        defaultOpen={false}
      >
        {project.overrides.length === 0 ? (
          <Empty>
            No overrides. Click any rate in the estimate to type a number over the fed value —
            the original stays visible underneath.
          </Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Rate</th>
                <th className="n">Value</th>
                <th style={{ width: 28 }} />
              </tr>
            </thead>
            <tbody>
              {project.overrides.map((o) => (
                <tr key={o.key}>
                  <td className="truncate" title={o.label ?? o.key}>{o.label ?? o.key}</td>
                  <td className="n">{rate(o.value)}</td>
                  <td>
                    <button
                      className="btn ghost sm"
                      title="Revert to the fed value"
                      onClick={() => clearOverride(o.key)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Seed library" defaultOpen={false}>
        <p className="hint">
          {seedSource.status().detail}
        </p>
        <p className="hint mt-2">
          These are planning-level industry ranges, not DESTINI data. Every seed value is marked
          low confidence and is superseded the moment a real source is connected. They exist so the
          tool is useful before the feed is wired up, and so the shape of that feed is exercised end
          to end.
        </p>
      </Section>
    </>
  );
}

function DestiniSection({ onChange }: { onChange: () => void }) {
  const saved = loadDestiniConfig();
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? "");
  const [token, setToken] = useState(saved?.token ?? "");
  const [dataset, setDataset] = useState(saved?.dataset ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const status = destiniSource.status();

  const connect = async () => {
    setBusy(true);
    setMessage(null);
    const config = { baseUrl: baseUrl.trim(), token: token.trim(), dataset: dataset.trim() };
    destiniSource.configure(config);
    saveDestiniConfig(config);
    try {
      await destiniSource.refresh();
      const after = destiniSource.status();
      setMessage(after.state === "error" ? `Could not connect: ${after.detail}` : `Connected — ${after.detail}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setBusy(false);
      onChange();
    }
  };

  const disconnect = () => {
    destiniSource.configure({ baseUrl: "", token: "", dataset: "" });
    clearDestiniConfig();
    setBaseUrl("");
    setToken("");
    setDataset("");
    setMessage(null);
    onChange();
  };

  return (
    <Section
      title="DESTINI endpoint"
      meta={<Chip kind={STATE_TONE[status.state]}>{status.state}</Chip>}
      defaultOpen={status.state !== "ready"}
    >
      <p className="hint">
        Point this at a DESTINI-facing service and it outranks the seed library and any imported
        file. The adapter is already written — this form is the only thing standing between the
        seed data and a live feed.
      </p>

      <div className="stack mt-2">
        <Field label="Base URL" hint="No trailing slash. The browser calls it directly, so it must allow this origin.">
          <input
            className="control"
            value={baseUrl}
            placeholder="https://costs.example.com/api/v1"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </Field>
        <Field label="Token" hint="Stored in this browser only, never in the project file.">
          <input
            className="control"
            type="password"
            value={token}
            placeholder="Bearer token or API key"
            onChange={(e) => setToken(e.target.value)}
          />
        </Field>
        <Field label="Dataset" hint="Optional, when the tenant hosts more than one.">
          <input className="control" value={dataset} onChange={(e) => setDataset(e.target.value)} />
        </Field>
      </div>

      <div className="row mt-2" style={{ justifyContent: "flex-start", gap: 8 }}>
        <button className="btn primary" onClick={connect} disabled={busy || !baseUrl.trim()}>
          {busy ? "Connecting…" : status.state === "ready" ? "Reconnect" : "Connect"}
        </button>
        {destiniSource.isConfigured() && (
          <button className="btn" onClick={disconnect}>Disconnect</button>
        )}
      </div>

      {message && (
        <p className="hint mt-2" style={{ color: message.startsWith("Connected") ? "var(--good)" : "var(--bad)" }}>
          {message}
        </p>
      )}

      <details className="mt-2">
        <summary className="label" style={{ cursor: "pointer" }}>Expected endpoints</summary>
        <table className="table mt-1">
          <tbody>
            <tr><td><code>GET /conceptual-benchmarks</code></td><td className="hint">$/GSF and $/capacity bands by market and type</td></tr>
            <tr><td><code>GET /unit-costs</code></td><td className="hint">Assembly rates keyed by rate key or cost code</td></tr>
            <tr><td><code>GET /indices?city=</code></td><td className="hint">Location factor and escalation</td></tr>
          </tbody>
        </table>
        <p className="hint mt-1">
          If your JSON differs, <code>mapBenchmark</code> and <code>mapRate</code> in
          {" "}<code>destiniApiSource.ts</code> are the only two functions that need editing.
        </p>
      </details>
    </Section>
  );
}

function ImportSection({ onChange }: { onChange: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<ImportReport | null>(importSource.lastReport());
  const [kind, setKind] = useState<"rates" | "benchmarks">("rates");

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setReport(importSource.ingest(text, file.name, kind));
    onChange();
  };

  const status = importSource.status();

  return (
    <Section title="Import a DESTINI export" meta={<Chip kind={STATE_TONE[status.state]}>{status.state}</Chip>} defaultOpen={!report}>
      <p className="hint">
        CSV or JSON from DESTINI Estimator or Profiler. Column names are matched by alias, so
        template drift is fine. Anything that cannot be mapped is reported below rather than
        quietly dropped.
      </p>

      <div className="row mt-2" style={{ justifyContent: "flex-start", gap: 8 }}>
        <div className="seg">
          <button aria-pressed={kind === "rates"} onClick={() => setKind("rates")}>Unit costs</button>
          <button aria-pressed={kind === "benchmarks"} onClick={() => setKind("benchmarks")}>Benchmarks</button>
        </div>
        <button className="btn" onClick={() => fileRef.current?.click()}>Choose file…</button>
        {report && (
          <button
            className="btn ghost"
            onClick={() => {
              importSource.clear();
              setReport(null);
              onChange();
            }}
          >
            Clear
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        style={{ display: "none" }}
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {report && (
        <div className="mt-2">
          <table className="table">
            <tbody>
              <tr><td>File</td><td className="n truncate">{report.fileName}</td></tr>
              <tr><td>Rows read</td><td className="n">{report.rowsRead}</td></tr>
              <tr><td>Rates mapped</td><td className="n">{report.ratesMapped}</td></tr>
              <tr><td>Benchmarks mapped</td><td className="n">{report.benchmarksMapped}</td></tr>
              <tr><td>Skipped</td><td className="n">{report.skipped.length}</td></tr>
            </tbody>
          </table>

          {report.missingColumns.length > 0 && (
            <p className="hint mt-1" style={{ color: "var(--warn)" }}>
              Missing expected columns: {report.missingColumns.join(", ")}
            </p>
          )}

          {report.skipped.length > 0 && (
            <details className="mt-1">
              <summary className="label" style={{ cursor: "pointer" }}>
                {report.skipped.length} skipped row{report.skipped.length === 1 ? "" : "s"}
              </summary>
              <table className="table mt-1">
                <tbody>
                  {report.skipped.slice(0, 40).map((s) => (
                    <tr key={s.row}>
                      <td className="n" style={{ width: 44 }}>{s.row}</td>
                      <td className="hint">{s.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {report.skipped.length > 40 && (
                <p className="hint mt-1">…and {report.skipped.length - 40} more.</p>
              )}
            </details>
          )}
        </div>
      )}

      <p className="hint mt-2">
        Recognised headers include <code>Cost Code</code>, <code>Line Description</code>,
        {" "}<code>Unit of Measure</code>, <code>Unit Cost</code>, <code>Low</code>/<code>High</code>,
        {" "}<code>CSI</code>, <code>UNIFORMAT</code>, <code>Effective Date</code>, and{" "}
        <code>Projects</code>. Imported rows are marked high confidence and sit above the seed
        library. Priority {PRIORITY.import}.
      </p>
      {void since}
    </Section>
  );
}
