import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Beaker, Check, GitCompareArrows, Plus, RotateCcw, ShieldCheck, Upload, X } from "lucide-react";

import { ApiError, api, post } from "../api";
import type { Comparison, ComparisonDetail, Issue, Proposal, ProposalDetail, RunSummary } from "../types";
import { EmptyState, formatTime, SectionHeading, shortId, StatusBadge } from "./ui";

export function EvolutionView({ proposals, comparisons, issues, runs, onDataChanged }: {
  proposals: Proposal[];
  comparisons: Comparison[];
  issues: Issue[];
  runs: RunSummary[];
  onDataChanged: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(proposals[0]?.id ?? null);
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [comparisonDetail, setComparisonDetail] = useState<ComparisonDetail | null>(null);
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [creatingComparison, setCreatingComparison] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposalForm, setProposalForm] = useState({
    issueId: issues[0]?.id ?? "",
    workspaceRoot: "",
    targetPath: "AGENTS.md",
    targetKind: "agents" as "agents" | "skill",
    originalRunId: runs[0]?.id ?? "",
    protectionRunId: runs[1]?.id ?? "",
    rationale: "",
    candidateContent: ""
  });
  const [comparisonForm, setComparisonForm] = useState({
    failureName: "Original failure",
    failurePrompt: "",
    failureCommand: "",
    failureArgs: "",
    protectionName: "Neighbor protection",
    protectionPrompt: "",
    protectionCommand: "",
    protectionArgs: ""
  });

  useEffect(() => {
    if (selectedId !== null && proposals.some((proposal) => proposal.id === selectedId)) return;
    setSelectedId(proposals[0]?.id ?? null);
  }, [proposals, selectedId]);

  const proposalComparisons = useMemo(
    () => comparisons.filter((comparison) => comparison.proposalId === selectedId),
    [comparisons, selectedId]
  );

  async function loadSelected(proposalId: string, comparisonId?: string) {
    const proposal = await api<ProposalDetail>(`/api/proposals/${proposalId}`);
    setDetail(proposal);
    const targetComparison = comparisonId ?? comparisons.find((entry) => entry.proposalId === proposalId)?.id;
    if (targetComparison === undefined) setComparisonDetail(null);
    else setComparisonDetail(await api<ComparisonDetail>(`/api/comparisons/${targetComparison}`));
  }

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      setComparisonDetail(null);
      return;
    }
    let active = true;
    void loadSelected(selectedId)
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => { active = false; };
    // comparisons are refreshed explicitly after mutations to avoid resetting a viewed historical comparison.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function mutateProposal(action: "approve" | "reject" | "publish" | "rollback") {
    if (selectedId === null) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/api/proposals/${selectedId}/${action}`);
      await onDataChanged();
      await loadSelected(selectedId, comparisonDetail?.comparison.id);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409 && typeof caught.payload === "object" && caught.payload !== null && "message" in caught.payload) {
        setError(String((caught.payload as { message: unknown }).message));
      } else setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function createProposal() {
    setBusy(true);
    setError(null);
    try {
      const proposal = await post<Proposal>("/api/proposals", proposalForm);
      await onDataChanged();
      setSelectedId(proposal.id);
      setCreatingProposal(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function createComparison() {
    if (selectedId === null) return;
    setBusy(true);
    setError(null);
    try {
      const comparison = await post<Comparison>("/api/comparisons", {
        proposalId: selectedId,
        cases: [
          {
            kind: "failure",
            name: comparisonForm.failureName,
            prompt: comparisonForm.failurePrompt,
            verifierCommand: comparisonForm.failureCommand,
            verifierArgs: comparisonForm.failureArgs.split("\n").map((value) => value.trim()).filter(Boolean)
          },
          {
            kind: "protection",
            name: comparisonForm.protectionName,
            prompt: comparisonForm.protectionPrompt,
            verifierCommand: comparisonForm.protectionCommand,
            verifierArgs: comparisonForm.protectionArgs.split("\n").map((value) => value.trim()).filter(Boolean)
          }
        ]
      });
      await onDataChanged();
      await loadSelected(selectedId, comparison.id);
      setCreatingComparison(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function runComparison() {
    if (comparisonDetail === null) return;
    if (!window.confirm("This starts exactly four Codex Runs: baseline and candidate for the failure case and protection case. Continue?")) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await post<ComparisonDetail>(`/api/comparisons/${comparisonDetail.comparison.id}/run`);
      setComparisonDetail(updated);
      await onDataChanged();
      if (selectedId !== null) await loadSelected(selectedId, updated.comparison.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (proposals.length === 0 && !creatingProposal) {
    return (
      <div className="page-frame">
        <SectionHeading eyebrow="Bounded capability change" title="Evolution Lab" action={<button className="primary-button" disabled={issues.length === 0 || runs.length < 2} onClick={() => setCreatingProposal(true)}><Plus size={16} /> New proposal</button>} />
        <EmptyState title="No capability proposal yet" action={issues.length === 0 || runs.length < 2 ? undefined : <button className="primary-button" onClick={() => setCreatingProposal(true)}>Create from evidence</button>}>
          A proposal changes one AGENTS.md or one SKILL.md, cites a failure Run and a distinct protection Run, then waits for a four-cell comparison and human approval.
        </EmptyState>
        {creatingProposal ? <ProposalDrawer form={proposalForm} setForm={setProposalForm} issues={issues} runs={runs} busy={busy} error={error} onClose={() => setCreatingProposal(false)} onSubmit={createProposal} /> : null}
      </div>
    );
  }

  return (
    <div className="lab-page">
      <section className="entity-index lab-index">
        <SectionHeading eyebrow="Bounded capability change" title="Evolution Lab" action={<button className="icon-button bordered" onClick={() => setCreatingProposal(true)}><Plus size={17} /></button>} />
        <p className="index-intro">One file, one failure case, one protection case, one run per cell.</p>
        <div className="entity-list">
          {proposals.map((proposal) => (
            <button key={proposal.id} className={selectedId === proposal.id ? "selected" : ""} onClick={() => setSelectedId(proposal.id)}>
              <div className="entity-row-top"><StatusBadge value={proposal.targetKind} /><span>{formatTime(proposal.updatedAt)}</span></div>
              <strong>{proposal.targetPath}</strong>
              <p>{proposal.rationale}</p>
              <div className="entity-row-bottom"><code>{shortId(proposal.id)}</code><StatusBadge value={proposal.status} /></div>
            </button>
          ))}
        </div>
      </section>

      <section className="lab-detail">
        {error === null ? null : <div className="inline-error"><AlertTriangle size={16} /> {error}</div>}
        {detail === null ? <div className="loading-line"><span /> Loading proposal…</div> : (
          <>
            <header className="detail-titlebar lab-titlebar">
              <div><div className="eyebrow">Capability proposal</div><h1>{detail.proposal.targetPath}</h1><p>{detail.proposal.rationale}</p></div>
              <div className="title-actions"><StatusBadge value={detail.proposal.status} /></div>
            </header>

            <div className="lab-toolbar">
              <div className="proposal-evidence">
                <span>Failure <code>{shortId(detail.proposal.originalRunId)}</code></span>
                <span>Protection <code>{shortId(detail.proposal.protectionRunId)}</code></span>
                <span>Original <code>{shortId(detail.proposal.originalDigest)}</code></span>
              </div>
              <div className="button-row">
                <button className="secondary-button" onClick={() => setCreatingComparison(true)} disabled={busy || detail.proposal.status !== "ready"}><GitCompareArrows size={15} /> New comparison</button>
                <button onClick={() => void mutateProposal("reject")} disabled={busy || detail.proposal.status === "published"}>Reject</button>
                <button className="secondary-button" onClick={() => void mutateProposal("approve")} disabled={busy || detail.proposal.status !== "ready"}><ShieldCheck size={15} /> Approve</button>
                <button className="primary-button" onClick={() => void mutateProposal("publish")} disabled={busy || detail.proposal.status !== "approved"}><Upload size={15} /> Publish</button>
                <button className="secondary-button" onClick={() => void mutateProposal("rollback")} disabled={busy || !["published", "rollback_conflict"].includes(detail.proposal.status)}><RotateCcw size={15} /> Roll back</button>
              </div>
            </div>

            <div className="lab-content">
              <div className="boundary-note"><ShieldCheck size={18} /><p>Publish and rollback keep the old file in a named recovery directory and install only when the target path is empty. Close editors and reconcile that recovery file before deleting it.</p></div>
              <section className="diff-section">
                <header><div><div className="eyebrow">Reviewable change</div><h2>Candidate diff</h2></div><span>{detail.proposal.targetKind === "agents" ? "AGENTS.md" : "SKILL.md"}</span></header>
                <pre className="diff-view">{detail.proposal.diffText}</pre>
              </section>

              <section className="comparison-section">
                <header className="comparison-header">
                  <div><div className="eyebrow">Objective check</div><h2>Baseline vs candidate</h2></div>
                  {comparisonDetail === null ? <StatusBadge value="unknown" label="Not compared" /> : <StatusBadge value={comparisonDetail.comparison.conclusion} />}
                </header>
                {proposalComparisons.length > 1 ? (
                  <label className="comparison-select">Comparison
                    <select value={comparisonDetail?.comparison.id ?? ""} onChange={(event) => { if (selectedId !== null) void loadSelected(selectedId, event.target.value); }}>
                      {proposalComparisons.map((comparison) => <option key={comparison.id} value={comparison.id}>{formatTime(comparison.createdAt)} · {comparison.status}</option>)}
                    </select>
                  </label>
                ) : null}
                {comparisonDetail === null ? (
                  <div className="comparison-empty"><Beaker size={24} /><p>Create the fixed two-case matrix. No batch of unrelated tests is added.</p><button className="secondary-button" onClick={() => setCreatingComparison(true)}>Define comparison</button></div>
                ) : (
                  <>
                    <ComparisonMatrix detail={comparisonDetail} />
                    <div className="comparison-conclusion">
                      <p>{comparisonDetail.comparison.summary || "The matrix is defined but has not run."}</p>
                      <strong>Always labeled: single-run evidence</strong>
                      {comparisonDetail.comparison.status === "queued" ? <button className="primary-button" disabled={busy} onClick={() => void runComparison()}>{busy ? "Running four cells…" : "Run 4 single trials"}</button> : null}
                    </div>
                  </>
                )}
              </section>

              <section className="publish-history">
                <header><h2>Publish & rollback history</h2><span>{detail.publishEvents.length}</span></header>
                {detail.publishEvents.length === 0 ? <p className="muted">No file has been changed by the workbench.</p> : detail.publishEvents.map((event) => (
                  <article key={event.id}><StatusBadge value={event.status} /><div><strong>{event.action}</strong><p>{event.message}</p><small>{formatTime(event.createdAt)}</small></div></article>
                ))}
              </section>
            </div>
          </>
        )}
      </section>
      {creatingProposal ? <ProposalDrawer form={proposalForm} setForm={setProposalForm} issues={issues} runs={runs} busy={busy} error={error} onClose={() => setCreatingProposal(false)} onSubmit={createProposal} /> : null}
      {creatingComparison ? <ComparisonDrawer form={comparisonForm} setForm={setComparisonForm} busy={busy} error={error} onClose={() => setCreatingComparison(false)} onSubmit={createComparison} /> : null}
    </div>
  );
}

function ComparisonMatrix({ detail }: { detail: ComparisonDetail }) {
  const runFor = (caseId: string, variant: "baseline" | "candidate") => detail.runs.find((run) => run.caseId === caseId && run.variant === variant);
  return (
    <div className="comparison-matrix">
      <div className="matrix-corner">Case</div><div className="matrix-head">Baseline</div><div className="matrix-head">Candidate</div>
      {detail.cases.map((comparisonCase) => (
        <div className="matrix-row" key={comparisonCase.id}>
          <div className="matrix-label"><StatusBadge value={comparisonCase.kind} /><strong>{comparisonCase.name}</strong><small>{comparisonCase.verifierCommand}</small></div>
          {(["baseline", "candidate"] as const).map((variant) => {
            const run = runFor(comparisonCase.id, variant);
            return <div className="matrix-cell" key={variant}>{run === undefined ? <span className="muted">Not run</span> : <><StatusBadge value={run.verifierStatus} /><code>{run.runId === null ? "no Run" : shortId(run.runId)}</code>{run.infrastructureError ? <small className="negative-copy">{run.infrastructureError}</small> : null}</>}</div>;
          })}
        </div>
      ))}
    </div>
  );
}

type ProposalForm = {
  issueId: string; workspaceRoot: string; targetPath: string; targetKind: "agents" | "skill";
  originalRunId: string; protectionRunId: string; rationale: string; candidateContent: string;
};

function ProposalDrawer({ form, setForm, issues, runs, busy, error, onClose, onSubmit }: {
  form: ProposalForm; setForm: React.Dispatch<React.SetStateAction<ProposalForm>>; issues: Issue[]; runs: RunSummary[];
  busy: boolean; error: string | null; onClose: () => void; onSubmit: () => Promise<void>;
}) {
  const update = <K extends keyof ProposalForm>(key: K, value: ProposalForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const valid = form.issueId && form.workspaceRoot && form.targetPath && form.originalRunId && form.protectionRunId && form.originalRunId !== form.protectionRunId && form.rationale && form.candidateContent;
  return (
    <div className="drawer-backdrop" role="presentation"><aside className="drawer wide" role="dialog" aria-modal="true">
      <header><div><div className="eyebrow">One capability file</div><h2>New proposal</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></header>
      <label>Issue<select value={form.issueId} onChange={(event) => update("issueId", event.target.value)}>{issues.map((issue) => <option key={issue.id} value={issue.id}>{issue.title}</option>)}</select></label>
      <label>Repository root<input value={form.workspaceRoot} onChange={(event) => update("workspaceRoot", event.target.value)} placeholder="D:\projects\your-repository" /></label>
      <div className="form-pair"><label>Target kind<select value={form.targetKind} onChange={(event) => update("targetKind", event.target.value as "agents" | "skill")}><option value="agents">AGENTS.md</option><option value="skill">SKILL.md</option></select></label><label>Relative path<input value={form.targetPath} onChange={(event) => update("targetPath", event.target.value)} /></label></div>
      <label>Failure Run<select value={form.originalRunId} onChange={(event) => update("originalRunId", event.target.value)}>{runs.map((run) => <option key={run.id} value={run.id}>{run.goal}</option>)}</select></label>
      <label>Protection Run<select value={form.protectionRunId} onChange={(event) => update("protectionRunId", event.target.value)}>{runs.map((run) => <option key={run.id} value={run.id}>{run.goal}</option>)}</select></label>
      <label>Evidence rationale<textarea rows={3} value={form.rationale} onChange={(event) => update("rationale", event.target.value)} placeholder="Why this file and this bounded change? Include counter-evidence." /></label>
      <label>Complete candidate file<textarea className="code-input" rows={10} value={form.candidateContent} onChange={(event) => update("candidateContent", event.target.value)} placeholder="Paste the complete candidate AGENTS.md or SKILL.md. The workbench stores a diff and does not publish it yet." /></label>
      {error === null ? null : <div className="inline-error"><AlertTriangle size={16} /> {error}</div>}
      <footer><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!valid || busy} onClick={() => void onSubmit()}>{busy ? "Creating…" : "Create proposal"}</button></footer>
    </aside></div>
  );
}

type ComparisonForm = {
  failureName: string; failurePrompt: string; failureCommand: string; failureArgs: string;
  protectionName: string; protectionPrompt: string; protectionCommand: string; protectionArgs: string;
};

function ComparisonDrawer({ form, setForm, busy, error, onClose, onSubmit }: {
  form: ComparisonForm; setForm: React.Dispatch<React.SetStateAction<ComparisonForm>>; busy: boolean; error: string | null;
  onClose: () => void; onSubmit: () => Promise<void>;
}) {
  const update = (key: keyof ComparisonForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const valid = form.failurePrompt && form.failureCommand && form.protectionPrompt && form.protectionCommand;
  return (
    <div className="drawer-backdrop"><aside className="drawer wide" role="dialog" aria-modal="true">
      <header><div><div className="eyebrow">Fixed scope</div><h2>Define two-case comparison</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></header>
      <div className="case-form"><div className="case-title"><span>01</span><strong>Original failure</strong></div><label>Name<input value={form.failureName} onChange={(event) => update("failureName", event.target.value)} /></label><label>Exact Codex prompt<textarea rows={3} value={form.failurePrompt} onChange={(event) => update("failurePrompt", event.target.value)} /></label><label>Verifier executable<input value={form.failureCommand} onChange={(event) => update("failureCommand", event.target.value)} placeholder="npm.cmd" /></label><label>Verifier args, one per line<textarea rows={3} className="code-input" value={form.failureArgs} onChange={(event) => update("failureArgs", event.target.value)} placeholder={'test\n--\nparser'} /></label></div>
      <div className="case-form"><div className="case-title"><span>02</span><strong>Neighbor protection</strong></div><label>Name<input value={form.protectionName} onChange={(event) => update("protectionName", event.target.value)} /></label><label>Exact Codex prompt<textarea rows={3} value={form.protectionPrompt} onChange={(event) => update("protectionPrompt", event.target.value)} /></label><label>Verifier executable<input value={form.protectionCommand} onChange={(event) => update("protectionCommand", event.target.value)} placeholder="npm.cmd" /></label><label>Verifier args, one per line<textarea rows={3} className="code-input" value={form.protectionArgs} onChange={(event) => update("protectionArgs", event.target.value)} /></label></div>
      <div className="boundary-note"><Check size={18} /><p>Creating the matrix does not run Codex. Starting it later performs exactly four single runs and never publishes the candidate.</p></div>
      {error === null ? null : <div className="inline-error"><AlertTriangle size={16} /> {error}</div>}
      <footer><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!valid || busy} onClick={() => void onSubmit()}>{busy ? "Saving…" : "Save comparison"}</button></footer>
    </aside></div>
  );
}
