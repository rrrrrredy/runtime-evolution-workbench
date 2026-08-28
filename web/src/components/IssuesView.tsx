import { useEffect, useState } from "react";
import { AlertCircle, ArrowRight, Plus, ShieldQuestion, X } from "lucide-react";

import { api, post } from "../api";
import type { Issue, RunSummary } from "../types";
import { EmptyState, formatTime, SectionHeading, shortId, StatusBadge } from "./ui";

interface IssueDetail {
  issue: Issue;
  evidence: Array<{ runId: string; eventId: string | null; note: string }>;
}

const categories = ["instruction", "skill", "tool", "environment", "permission", "validation", "model", "unknown"] as const;

export function IssuesView({ issues, runs, onDataChanged }: { issues: Issue[]; runs: RunSummary[]; onDataChanged: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState<string | null>(issues[0]?.id ?? null);
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    summary: "",
    category: "unknown",
    runId: runs[0]?.id ?? "",
    note: "",
    suggestedTarget: "",
    counterEvidence: ""
  });

  useEffect(() => {
    if (selectedId !== null && issues.some((issue) => issue.id === selectedId)) return;
    setSelectedId(issues[0]?.id ?? null);
  }, [issues, selectedId]);

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    let active = true;
    void api<IssueDetail>(`/api/issues/${selectedId}`)
      .then((value) => { if (active) setDetail(value); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => { active = false; };
  }, [selectedId, issues]);

  async function createIssue() {
    if (form.runId.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const issue = await post<Issue>("/api/issues", {
        title: form.title,
        summary: form.summary,
        category: form.category,
        suggestedTarget: form.suggestedTarget.trim() || null,
        counterEvidence: form.counterEvidence,
        evidence: [{ runId: form.runId, note: form.note }]
      });
      await onDataChanged();
      setSelectedId(issue.id);
      setCreating(false);
      setForm((value) => ({ ...value, title: "", summary: "", note: "", counterEvidence: "" }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (issues.length === 0 && !creating) {
    return (
      <div className="page-frame">
        <SectionHeading eyebrow="Evidence-backed diagnosis" title="Issues" action={<button className="primary-button" onClick={() => setCreating(true)} disabled={runs.length === 0}><Plus size={16} /> New issue</button>} />
        <EmptyState title="No issue candidates yet" action={runs.length === 0 ? undefined : <button className="primary-button" onClick={() => setCreating(true)}>Create from a retained Run</button>}>
          An Issue is a suspected cause tied to concrete Run evidence. It is not a label inferred from invocation counts or a model guess.
        </EmptyState>
        {creating ? <CreateIssuePanel form={form} setForm={setForm} runs={runs} busy={busy} error={error} onClose={() => setCreating(false)} onSubmit={createIssue} /> : null}
      </div>
    );
  }

  return (
    <div className="split-page">
      <section className="entity-index">
        <SectionHeading eyebrow="Evidence-backed diagnosis" title="Issues" action={<button className="icon-button bordered" onClick={() => setCreating(true)}><Plus size={17} /></button>} />
        <p className="index-intro">A cause category stays provisional until the evidence and counter-evidence agree.</p>
        <div className="entity-list">
          {issues.map((issue) => (
            <button key={issue.id} onClick={() => setSelectedId(issue.id)} className={selectedId === issue.id ? "selected" : ""}>
              <div className="entity-row-top"><StatusBadge value={issue.category} /><span>{formatTime(issue.updatedAt)}</span></div>
              <strong>{issue.title}</strong>
              <p>{issue.summary}</p>
              <div className="entity-row-bottom"><span>{issue.evidenceCount} evidence link{issue.evidenceCount === 1 ? "" : "s"}</span><StatusBadge value={issue.status} /></div>
            </button>
          ))}
        </div>
      </section>

      <section className="entity-detail">
        {error === null ? null : <div className="inline-error"><AlertCircle size={16} /> {error}</div>}
        {detail === null ? <div className="loading-line"><span /> Loading issue evidence…</div> : (
          <>
            <header className="detail-titlebar">
              <div><div className="eyebrow">Issue candidate</div><h1>{detail.issue.title}</h1><p>{detail.issue.summary}</p></div>
              <StatusBadge value={detail.issue.status} />
            </header>
            <div className="issue-grid">
              <section className="plain-section">
                <header><h2>Evidence</h2><span>{detail.evidence.length}</span></header>
                {detail.evidence.map((evidence) => {
                  const run = runs.find((entry) => entry.id === evidence.runId);
                  return (
                    <article className="evidence-link" key={`${evidence.runId}-${evidence.eventId ?? "run"}`}>
                      <div className="evidence-icon"><ArrowRight size={16} /></div>
                      <div><strong>{run?.goal ?? "Retained Run"}</strong><p>{evidence.note}</p><code>{shortId(evidence.runId)}{evidence.eventId === null ? "" : ` / ${shortId(evidence.eventId)}`}</code></div>
                    </article>
                  );
                })}
              </section>

              <section className="plain-section diagnosis-panel">
                <header><h2>Diagnosis boundary</h2><StatusBadge value={detail.issue.category} /></header>
                <dl className="diagnosis-list">
                  <div><dt>Suspected layer</dt><dd>{detail.issue.category}</dd></div>
                  <div><dt>Suggested target</dt><dd>{detail.issue.suggestedTarget ?? "No capability file selected"}</dd></div>
                  <div><dt>Counter-evidence</dt><dd>{detail.issue.counterEvidence || "None recorded. Treat the cause as unconfirmed."}</dd></div>
                </dl>
                <div className="boundary-note"><ShieldQuestion size={18} /><p>The visible failure and the root cause are different claims. Evolution Lab can test one bounded file change; it cannot prove a model-level cause from one Run.</p></div>
              </section>
            </div>
          </>
        )}
      </section>
      {creating ? <CreateIssuePanel form={form} setForm={setForm} runs={runs} busy={busy} error={error} onClose={() => setCreating(false)} onSubmit={createIssue} /> : null}
    </div>
  );
}

type IssueForm = {
  title: string;
  summary: string;
  category: string;
  runId: string;
  note: string;
  suggestedTarget: string;
  counterEvidence: string;
};

function CreateIssuePanel({ form, setForm, runs, busy, error, onClose, onSubmit }: {
  form: IssueForm;
  setForm: React.Dispatch<React.SetStateAction<IssueForm>>;
  runs: RunSummary[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: () => Promise<void>;
}) {
  const update = (key: keyof IssueForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const valid = form.title.trim().length > 0 && form.summary.trim().length > 0 && form.runId.length > 0 && form.note.trim().length > 0;
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Create issue">
        <header><div><div className="eyebrow">From retained evidence</div><h2>New issue candidate</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></header>
        <label>Title<input value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="What repeated problem is visible?" /></label>
        <label>Visible failure<textarea rows={3} value={form.summary} onChange={(event) => update("summary", event.target.value)} placeholder="Describe what the user could observe." /></label>
        <label>Suspected layer<select value={form.category} onChange={(event) => update("category", event.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label>Evidence Run<select value={form.runId} onChange={(event) => update("runId", event.target.value)}>{runs.map((run) => <option key={run.id} value={run.id}>{run.goal}</option>)}</select></label>
        <label>Evidence note<textarea rows={3} value={form.note} onChange={(event) => update("note", event.target.value)} placeholder="Which retained fact supports this hypothesis?" /></label>
        <label>Suggested AGENTS/Skill path<input value={form.suggestedTarget} onChange={(event) => update("suggestedTarget", event.target.value)} placeholder="Optional, e.g. AGENTS.md" /></label>
        <label>Counter-evidence<textarea rows={3} value={form.counterEvidence} onChange={(event) => update("counterEvidence", event.target.value)} placeholder="What fact would weaken this diagnosis?" /></label>
        {error === null ? null : <div className="inline-error"><AlertCircle size={16} /> {error}</div>}
        <footer><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!valid || busy} onClick={() => void onSubmit()}>{busy ? "Saving…" : "Create issue"}</button></footer>
      </aside>
    </div>
  );
}
