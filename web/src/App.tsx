import { useCallback, useEffect, useState } from "react";
import { Activity, AlertCircle, Beaker, BookOpenCheck, Database, Menu, RefreshCw, X } from "lucide-react";

import { api } from "./api";
import { EvolutionView } from "./components/EvolutionView";
import { IssuesView } from "./components/IssuesView";
import { PatternsView } from "./components/PatternsView";
import { RunsView } from "./components/RunsView";
import type { Comparison, Issue, Pattern, Proposal, RunSummary, SkillImpact, ViewName } from "./types";

interface WorkspaceData {
  runs: RunSummary[];
  issues: Issue[];
  proposals: Proposal[];
  comparisons: Comparison[];
  patterns: Pattern[];
  impacts: SkillImpact[];
}

const emptyData: WorkspaceData = { runs: [], issues: [], proposals: [], comparisons: [], patterns: [], impacts: [] };

export function App() {
  const [view, setView] = useState<ViewName>("runs");
  const [data, setData] = useState<WorkspaceData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileNav, setMobileNav] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [runs, issues, proposals, comparisons, patterns, impacts] = await Promise.all([
        api<{ runs: RunSummary[] }>("/api/runs"),
        api<{ issues: Issue[] }>("/api/issues"),
        api<{ proposals: Proposal[] }>("/api/proposals"),
        api<{ comparisons: Comparison[] }>("/api/comparisons"),
        api<{ patterns: Pattern[] }>("/api/patterns"),
        api<{ entries: SkillImpact[] }>("/api/evolution/skill-impact-ledger")
      ]);
      setData({
        runs: runs.runs,
        issues: issues.issues,
        proposals: proposals.proposals,
        comparisons: comparisons.comparisons,
        patterns: patterns.patterns,
        impacts: impacts.entries
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const navigate = (next: ViewName) => {
    setView(next);
    setMobileNav(false);
  };

  return (
    <div className="app-shell">
      <header className="mobile-header">
        <button className="icon-button" onClick={() => setMobileNav((value) => !value)} aria-label="Toggle navigation">
          {mobileNav ? <X size={18} /> : <Menu size={18} />}
        </button>
        <span>Runtime Evolution Workbench</span>
        <button className="icon-button" onClick={() => void refresh()} aria-label="Refresh"><RefreshCw size={17} /></button>
      </header>

      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Activity size={18} /></div>
          <div>
            <strong>Runtime Evolution</strong>
            <span>Workbench</span>
          </div>
        </div>
        <nav aria-label="Primary">
          <button className={view === "runs" ? "active" : ""} onClick={() => navigate("runs")}>
            <Database size={18} /><span>Runs</span><small>{data.runs.length}</small>
          </button>
          <button className={view === "issues" ? "active" : ""} onClick={() => navigate("issues")}>
            <AlertCircle size={18} /><span>Issues</span><small>{data.issues.length}</small>
          </button>
          <button className={view === "patterns" ? "active" : ""} onClick={() => navigate("patterns")}>
            <BookOpenCheck size={18} /><span>Patterns</span><small>{data.patterns.length}</small>
          </button>
          <button className={view === "evolution" ? "active" : ""} onClick={() => navigate("evolution")}>
            <Beaker size={18} /><span>Evolution Lab</span><small>{data.proposals.length}</small>
          </button>
        </nav>
        <div className="sidebar-foot">
          <span className="local-dot" /> Local only
          <button className="icon-button" onClick={() => void refresh()} aria-label="Refresh all data"><RefreshCw size={16} /></button>
        </div>
      </aside>

      <main className="workspace">
        {error === null ? null : (
          <div className="global-error" role="alert">
            <AlertCircle size={17} />
            <span>{error === "authentication_required" ? "Open the one-time session URL printed by the local service." : error}</span>
            <button onClick={() => void refresh()}>Retry</button>
          </div>
        )}
        {loading ? <div className="loading-line"><span /> Loading local evidence…</div> : null}
        {!loading && view === "runs" ? <RunsView runs={data.runs} onDataChanged={refresh} /> : null}
        {!loading && view === "issues" ? <IssuesView issues={data.issues} runs={data.runs} onDataChanged={refresh} /> : null}
        {!loading && view === "patterns" ? <PatternsView patterns={data.patterns} impacts={data.impacts} onDataChanged={refresh} /> : null}
        {!loading && view === "evolution" ? (
          <EvolutionView
            proposals={data.proposals}
            comparisons={data.comparisons}
            issues={data.issues}
            runs={data.runs}
            onDataChanged={refresh}
          />
        ) : null}
      </main>
    </div>
  );
}
