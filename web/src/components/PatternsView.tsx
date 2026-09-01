import { useState } from "react";
import { AlertTriangle, BookOpenCheck, Download, History, Plus, X } from "lucide-react";

import { post } from "../api";
import type { Pattern, SkillImpact } from "../types";
import { EmptyState, formatTime, SectionHeading, shortId, StatusBadge } from "./ui";

export function PatternsView({ patterns, impacts, onDataChanged }: {
  patterns: Pattern[];
  impacts: SkillImpact[];
  onDataChanged: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    slug: "",
    title: "",
    summary: "",
    scope: "",
    status: "candidate" as Pattern["status"],
    evidenceKind: "support" as "support" | "counterexample",
    sourceKind: "run" as "run" | "issue" | "comparison" | "proposal" | "external",
    sourceId: "",
    note: ""
  });

  async function createPattern() {
    setBusy(true);
    setError(null);
    try {
      await post("/api/patterns", {
        slug: form.slug,
        title: form.title,
        summary: form.summary,
        scope: form.scope,
        status: form.status,
        evidence: [{
          kind: form.evidenceKind,
          sourceKind: form.sourceKind,
          sourceId: form.sourceId,
          note: form.note
        }]
      });
      setCreating(false);
      setForm({
        slug: "", title: "", summary: "", scope: "", status: "candidate",
        evidenceKind: "support", sourceKind: "run", sourceId: "", note: ""
      });
      await onDataChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="knowledge-view">
      <SectionHeading
        eyebrow="Persistent evolution knowledge"
        title="Patterns & impact"
        action={<button className="primary-button" onClick={() => setCreating(true)}><Plus size={16} /> Add pattern</button>}
      />
      <p className="knowledge-description">Consolidate recurring evidence without losing counterexamples, then inspect every comparison, approval, publication, and rollback in one append-only chain.</p>

      <div className="knowledge-export-row">
        <a className="secondary-button" href="/api/evolution/pattern-registry/export"><Download size={15} /> Pattern Registry JSON</a>
        <a className="secondary-button" href="/api/evolution/skill-impact-ledger/export"><Download size={15} /> Skill Impact Ledger JSON</a>
        <span>Versioned file boundary; no shared database or execution authority.</span>
      </div>

      <div className="knowledge-columns">
        <section className="knowledge-panel">
          <header><div><BookOpenCheck size={18} /><h2>Pattern Registry</h2></div><span>{patterns.length}</span></header>
          {patterns.length === 0 ? (
            <EmptyState title="No retained patterns">Add a recurring behavior only when a Run, Issue, comparison, or external artifact supports it.</EmptyState>
          ) : (
            <div className="pattern-list">
              {patterns.map((pattern) => (
                <article key={pattern.id} className="pattern-card">
                  <div className="pattern-card-top"><StatusBadge value={pattern.status} /><code>{pattern.slug}</code></div>
                  <h3>{pattern.title}</h3>
                  <p>{pattern.summary}</p>
                  <small>{pattern.scope} · {pattern.evidenceCount} evidence item{pattern.evidenceCount === 1 ? "" : "s"} · {formatTime(pattern.updatedAt)}</small>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="knowledge-panel">
          <header><div><History size={18} /><h2>Skill Impact Ledger</h2></div><span>{impacts.length}</span></header>
          {impacts.length === 0 ? (
            <EmptyState title="No impact entries">Completed comparisons and human decisions will append evidence here automatically.</EmptyState>
          ) : (
            <div className="impact-list">
              {[...impacts].reverse().map((impact) => (
                <article key={impact.id} className="impact-card">
                  <div><StatusBadge value={impact.decision} /><strong>{impact.action}</strong><code>{shortId(impact.entryDigest)}</code></div>
                  <h3>{impact.targetPath}</h3>
                  <p>{impact.note}</p>
                  <small>{formatTime(impact.createdAt)} · {Object.keys(impact.metrics).length} metric{Object.keys(impact.metrics).length === 1 ? "" : "s"}</small>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {creating ? (
        <div className="drawer-backdrop" role="presentation"><aside className="drawer wide" role="dialog" aria-modal="true">
          <header><div><div className="eyebrow">Evidence-backed knowledge</div><h2>Add pattern</h2></div><button className="icon-button" onClick={() => setCreating(false)}><X size={18} /></button></header>
          <div className="form-pair"><label>Slug<input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} placeholder="verify-after-write" /></label><label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Pattern["status"] })}><option value="candidate">candidate</option><option value="confirmed">confirmed</option><option value="contested">contested</option><option value="retired">retired</option></select></label></div>
          <label>Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label>Summary<textarea rows={3} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></label>
          <label>Scope<input value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value })} placeholder="repository mutation tasks" /></label>
          <div className="form-pair"><label>Evidence kind<select value={form.evidenceKind} onChange={(event) => setForm({ ...form, evidenceKind: event.target.value as typeof form.evidenceKind })}><option value="support">support</option><option value="counterexample">counterexample</option></select></label><label>Source kind<select value={form.sourceKind} onChange={(event) => setForm({ ...form, sourceKind: event.target.value as typeof form.sourceKind })}><option value="run">run</option><option value="issue">issue</option><option value="comparison">comparison</option><option value="proposal">proposal</option><option value="external">external</option></select></label></div>
          <label>Source ID<input value={form.sourceId} onChange={(event) => setForm({ ...form, sourceId: event.target.value })} /></label>
          <label>Evidence note<textarea rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
          {error === null ? null : <div className="inline-error"><AlertTriangle size={16} /> {error}</div>}
          <footer><button className="secondary-button" onClick={() => setCreating(false)}>Cancel</button><button className="primary-button" disabled={busy || !form.slug || !form.title || !form.summary || !form.scope || !form.sourceId || !form.note} onClick={() => void createPattern()}>{busy ? "Saving…" : "Save pattern"}</button></footer>
        </aside></div>
      ) : null}
    </div>
  );
}
