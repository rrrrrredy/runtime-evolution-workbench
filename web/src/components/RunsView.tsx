import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  FileCode2,
  MessageSquarePlus,
  RefreshCw,
  Search,
  TerminalSquare,
  X
} from "lucide-react";

import { api, post } from "../api";
import type { CodexThread, RunBundle, RunEvent, RunSummary } from "../types";
import { duration, EmptyState, formatTime, SectionHeading, shortId, StatusBadge } from "./ui";

function eventIcon(event: RunEvent) {
  if (event.type.includes("command") || event.type.includes("tool")) return <TerminalSquare size={16} />;
  if (event.type.includes("file")) return <FileCode2 size={16} />;
  if (event.type.includes("message") || event.type.includes("prompt")) return <MessageSquarePlus size={16} />;
  if (event.type.includes("completed") || event.type.includes("ended")) return <Check size={16} />;
  return <CircleDot size={15} />;
}

export function RunsView({ runs, onDataChanged }: { runs: RunSummary[]; onDataChanged: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState<string | null>(runs[0]?.id ?? null);
  const [bundle, setBundle] = useState<RunBundle | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correction, setCorrection] = useState("");
  const [outcomeSummary, setOutcomeSummary] = useState("");
  const [threadPicker, setThreadPicker] = useState(false);
  const [threads, setThreads] = useState<CodexThread[]>([]);

  useEffect(() => {
    if (selectedId !== null && runs.some((run) => run.id === selectedId)) return;
    setSelectedId(runs[0]?.id ?? null);
  }, [runs, selectedId]);

  useEffect(() => {
    if (selectedId === null) {
      setBundle(null);
      return;
    }
    let active = true;
    setError(null);
    void api<RunBundle>(`/api/runs/${selectedId}`)
      .then((value) => { if (active) setBundle(value); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => { active = false; };
  }, [selectedId, runs]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return runs;
    return runs.filter((run) => `${run.goal} ${run.cwd} ${run.id} ${run.status}`.toLowerCase().includes(needle));
  }, [query, runs]);

  async function saveCorrection() {
    if (bundle === null || correction.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/api/runs/${bundle.run.id}/corrections`, { kind: "instruction", text: correction, targetEventIds: [] });
      setCorrection("");
      const updated = await api<RunBundle>(`/api/runs/${bundle.run.id}`);
      setBundle(updated);
      await onDataChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function markOutcome(status: "success" | "partial" | "failure") {
    if (bundle === null) return;
    setBusy(true);
    try {
      const updated = await post<RunBundle>(`/api/runs/${bundle.run.id}/outcome`, { status, summary: outcomeSummary });
      setBundle(updated);
      await onDataChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function openThreadPicker() {
    setThreadPicker(true);
    setBusy(true);
    try {
      const result = await api<{ threads: CodexThread[] }>("/api/codex/threads?limit=25");
      setThreads(result.threads);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function backfill(threadId: string) {
    setBusy(true);
    try {
      const result = await post<{ run: RunSummary }>("/api/backfill", { threadId });
      await onDataChanged();
      setSelectedId(result.run.id);
      setThreadPicker(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (runs.length === 0) {
    return (
      <div className="page-frame">
        <SectionHeading eyebrow="Local evidence" title="Runs" action={<button className="primary-button" onClick={() => void openThreadPicker()}><ArrowDownToLine size={16} /> Backfill</button>} />
        <EmptyState title="No Runs retained yet" action={<button className="primary-button" onClick={() => void openThreadPicker()}>Backfill a stored Codex Thread</button>}>
          Install the plugin for ordinary lifecycle capture, or import a stored Thread through App Server. A missing Run is never presented as a complete Trace.
        </EmptyState>
        {threadPicker ? <ThreadPicker threads={threads} busy={busy} onClose={() => setThreadPicker(false)} onBackfill={backfill} /> : null}
      </div>
    );
  }

  return (
    <div className="runs-page">
      <section className="run-index">
        <div className="index-header">
          <SectionHeading eyebrow="Local evidence" title="Runs" />
          <button className="icon-button bordered" onClick={() => void openThreadPicker()} aria-label="Backfill stored Codex Thread"><ArrowDownToLine size={17} /></button>
        </div>
        <label className="search-field">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Runs" />
        </label>
        <div className="index-count">{filtered.length} retained Run{filtered.length === 1 ? "" : "s"}</div>
        <div className="run-list">
          {filtered.map((run) => (
            <button key={run.id} className={`run-row ${selectedId === run.id ? "selected" : ""}`} onClick={() => setSelectedId(run.id)}>
              <div className="run-row-top"><code>{shortId(run.id)}</code><span>{formatTime(run.startedAt)}</span></div>
              <strong>{run.goal}</strong>
              <div className="run-row-bottom"><StatusBadge value={run.completeness} label={run.completeness === "partial" ? "Partial evidence" : run.completeness} /><span>{run.mode}</span></div>
            </button>
          ))}
        </div>
      </section>

      <section className="run-detail">
        {error === null ? null : <div className="inline-error"><AlertTriangle size={16} /> {error}</div>}
        {bundle === null ? <div className="loading-line"><span /> Loading selected Run…</div> : (
          <>
            <header className="run-titlebar">
              <div>
                <div className="eyebrow">{bundle.run.mode === "managed" ? "Managed Run" : "Observed Run"}</div>
                <h1>{bundle.run.goal}</h1>
                <div className="run-meta">
                  <code>{shortId(bundle.run.id)}</code>
                  <span><Clock3 size={14} /> {duration(bundle.run.startedAt, bundle.run.endedAt)}</span>
                  <span>{bundle.run.agentVersion ?? "Codex version unknown"}</span>
                </div>
              </div>
              <div className="title-actions">
                <StatusBadge value={bundle.run.completeness} {...(bundle.run.completeness === "partial" ? { label: "Partial evidence" } : {})} />
                <button className="secondary-button" onClick={() => void openThreadPicker()}><RefreshCw size={15} /> Backfill</button>
              </div>
            </header>

            <div className="evidence-strip">
              <EvidenceCell label="Overall evidence" value={`${bundle.events.length} events`} state={bundle.gaps.length === 0 ? "complete" : "partial"} />
              <EvidenceCell label="Tool & command" value={`${bundle.events.filter((event) => event.type.includes("tool") || event.type.includes("command")).length} events`} state="retained" />
              <EvidenceCell label="File changes" value={`${bundle.events.filter((event) => event.type.includes("file")).length} events`} state="retained" />
              <EvidenceCell label="Corrections" value={`${bundle.corrections.length} saved`} state={bundle.corrections.length > 0 ? "retained" : "none"} />
            </div>

            <div className="run-body">
              <div className="timeline-panel">
                <div className="panel-tabs"><strong>Timeline</strong><span>{bundle.events.length} structured events</span></div>
                <div className="timeline">
                  {bundle.events.map((event) => (
                    <details className="timeline-event" key={event.id}>
                      <summary>
                        <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                        <span className="event-node">{eventIcon(event)}</span>
                        <span className="event-copy"><strong>{event.summary}</strong><small>{event.type} · {event.source}</small></span>
                        {event.redacted ? <StatusBadge value="partial" label="Redacted" /> : null}
                        <ChevronRight className="disclosure" size={16} />
                      </summary>
                      <pre>{JSON.stringify(event.data, null, 2)}</pre>
                    </details>
                  ))}
                </div>
              </div>

              <aside className="evidence-inspector">
                <InspectorSection title="Outcome">
                  <div className="key-value"><span>Status</span><StatusBadge value={bundle.run.outcomeStatus} /></div>
                  <p>{bundle.run.outcomeSummary || "No user or verifier result has been recorded."}</p>
                  <textarea value={outcomeSummary} onChange={(event) => setOutcomeSummary(event.target.value)} placeholder="Optional evidence-backed outcome note" rows={2} />
                  <div className="button-row compact">
                    <button disabled={busy} onClick={() => void markOutcome("success")}>Success</button>
                    <button disabled={busy} onClick={() => void markOutcome("partial")}>Partial</button>
                    <button disabled={busy} onClick={() => void markOutcome("failure")}>Failure</button>
                  </div>
                </InspectorSection>

                <InspectorSection title="Observation gaps" count={bundle.gaps.length}>
                  {bundle.gaps.length === 0 ? <p className="positive-copy"><Check size={14} /> No declared gaps.</p> : bundle.gaps.map((gap) => (
                    <div className="gap-row" key={gap.id}><AlertTriangle size={15} /><div><strong>{gap.kind.replaceAll("_", " ")}</strong><p>{gap.summary}</p></div></div>
                  ))}
                </InspectorSection>

                <InspectorSection title="Configuration snapshot">
                  <dl className="config-list">
                    <div><dt>Working directory</dt><dd>{bundle.run.cwd}</dd></div>
                    <div><dt>Snapshot</dt><dd><code>{shortId(bundle.run.configurationSnapshotId)}</code></dd></div>
                    <div><dt>Model</dt><dd>{bundle.run.model ?? "Not retained"}</dd></div>
                  </dl>
                </InspectorSection>

                <InspectorSection title="User correction" count={bundle.corrections.length}>
                  {bundle.corrections.map((item) => <blockquote key={item.id}>{item.text}<small>{formatTime(item.createdAt)}</small></blockquote>)}
                  <textarea value={correction} onChange={(event) => setCorrection(event.target.value)} placeholder="What should the Agent have done differently?" rows={3} />
                  <button className="primary-button full" disabled={busy || correction.trim().length === 0} onClick={() => void saveCorrection()}>Save correction</button>
                </InspectorSection>
              </aside>
            </div>
          </>
        )}
      </section>
      {threadPicker ? <ThreadPicker threads={threads} busy={busy} onClose={() => setThreadPicker(false)} onBackfill={backfill} /> : null}
    </div>
  );
}

function EvidenceCell({ label, value, state }: { label: string; value: string; state: string }) {
  return <div className="evidence-cell"><span>{label}</span><strong>{value}</strong><small className={state === "partial" ? "negative-copy" : "muted"}>{state}</small></div>;
}

function InspectorSection({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return <section className="inspector-section"><header><h3>{title}</h3>{count === undefined ? null : <span>{count}</span>}</header>{children}</section>;
}

function ThreadPicker({ threads, busy, onClose, onBackfill }: { threads: CodexThread[]; busy: boolean; onClose: () => void; onBackfill: (id: string) => Promise<void> }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Backfill stored Codex Thread">
        <header><div><div className="eyebrow">App Server</div><h2>Backfill a stored Thread</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></header>
        <p className="muted">Stored history can be lossy. The resulting Run will keep that mapping gap visible.</p>
        <div className="thread-list">
          {threads.length === 0 ? <div className="loading-line"><span /> {busy ? "Reading Codex Threads…" : "No stored Threads returned."}</div> : threads.map((thread) => (
            <button key={thread.id} onClick={() => void onBackfill(thread.id)} disabled={busy}>
              <div><strong>{thread.preview || "Untitled Codex Thread"}</strong><small>{thread.cwd ?? "Working directory unavailable"}</small></div>
              <code>{shortId(thread.id)}</code>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
