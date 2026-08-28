import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { newId, stableUuid } from "../shared/ids.js";
import type {
  CapabilityProposal,
  CapabilityTargetKind,
  ComparisonCase,
  ComparisonCaseKind,
  ComparisonRecord,
  ComparisonRunRecord,
  ComparisonStatus,
  ComparisonVariant,
  Completeness,
  IssueCategory,
  IssueRecord,
  IssueStatus,
  ObservationGap,
  OutcomeStatus,
  ProposalStatus,
  PublishEvent,
  RunMode,
  RunStatus,
  StoredEvent,
  StoredRun,
  UserCorrection
} from "../shared/types.js";

interface Row {
  [key: string]: unknown;
}

export interface RunBundle {
  run: StoredRun;
  events: StoredEvent[];
  gaps: ObservationGap[];
  corrections: UserCorrection[];
}

export interface EnsureRunInput {
  sessionId: string;
  threadId?: string | null;
  mode: RunMode;
  status?: RunStatus;
  goal?: string;
  cwd?: string;
  model?: string | null;
  agentVersion?: string | null;
  startedAt?: string;
  completeness?: Completeness;
}

export interface AddEventInput {
  id: string;
  runId: string;
  turnId?: string | null;
  sequence?: number | null;
  timestamp: string;
  receivedAt: string;
  type: string;
  source: string;
  summary: string;
  data?: Record<string, unknown>;
  contentRefs?: string[];
  redacted?: boolean;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapRun(row: Row): StoredRun {
  return {
    id: asString(row.id),
    sessionId: asString(row.session_id),
    threadId: asNullableString(row.thread_id),
    mode: asString(row.mode) as RunMode,
    status: asString(row.status) as RunStatus,
    goal: asString(row.goal),
    cwd: asString(row.cwd),
    model: asNullableString(row.model),
    agentProduct: asString(row.agent_product),
    agentVersion: asNullableString(row.agent_version),
    startedAt: asString(row.started_at),
    endedAt: asNullableString(row.ended_at),
    completeness: asString(row.completeness) as Completeness,
    outcomeStatus: asString(row.outcome_status) as OutcomeStatus,
    outcomeSummary: asString(row.outcome_summary),
    configurationSnapshotId: asString(row.configuration_snapshot_id),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at)
  };
}

function mapEvent(row: Row): StoredEvent {
  return {
    id: asString(row.id),
    runId: asString(row.run_id),
    turnId: asNullableString(row.turn_id),
    sequence: typeof row.sequence === "number" ? row.sequence : null,
    timestamp: asString(row.timestamp),
    receivedAt: asString(row.received_at),
    type: asString(row.type),
    source: asString(row.source),
    summary: asString(row.summary),
    data: parseJson<Record<string, unknown>>(row.data_json, {}),
    contentRefs: parseJson<string[]>(row.content_refs_json, []),
    redacted: Number(row.redacted) === 1
  };
}

function mapGap(row: Row): ObservationGap {
  return {
    id: asString(row.id),
    runId: asString(row.run_id),
    kind: asString(row.kind) as ObservationGap["kind"],
    summary: asString(row.summary),
    source: asNullableString(row.source),
    startAt: asNullableString(row.start_at),
    endAt: asNullableString(row.end_at)
  };
}

function mapCorrection(row: Row): UserCorrection {
  return {
    id: asString(row.id),
    runId: asString(row.run_id),
    kind: asString(row.kind) as UserCorrection["kind"],
    text: asString(row.text),
    targetEventIds: parseJson<string[]>(row.target_event_ids_json, []),
    redacted: Number(row.redacted) === 1,
    createdAt: asString(row.created_at)
  };
}

function mapProposal(row: Row): CapabilityProposal {
  return {
    id: asString(row.id),
    issueId: asString(row.issue_id),
    workspaceRoot: asString(row.workspace_root),
    targetPath: asString(row.target_path),
    targetKind: asString(row.target_kind) as CapabilityTargetKind,
    originalDigest: asString(row.original_digest),
    originalContentRef: asString(row.original_content_ref),
    candidateDigest: asString(row.candidate_digest),
    candidateContentRef: asString(row.candidate_content_ref),
    diffText: asString(row.diff_text),
    rationale: asString(row.rationale),
    status: asString(row.status) as ProposalStatus,
    originalRunId: asString(row.original_run_id),
    protectionRunId: asString(row.protection_run_id),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    publishedAt: asNullableString(row.published_at)
  };
}

function mapPublishEvent(row: Row): PublishEvent {
  return {
    id: asString(row.id),
    proposalId: asString(row.proposal_id),
    action: asString(row.action) as PublishEvent["action"],
    status: asString(row.status) as PublishEvent["status"],
    targetPath: asString(row.target_path),
    expectedDigest: asString(row.expected_digest),
    currentDigest: asString(row.current_digest),
    resultingDigest: asNullableString(row.resulting_digest),
    currentContentRef: asNullableString(row.current_content_ref),
    message: asString(row.message),
    createdAt: asString(row.created_at)
  };
}

function mapComparison(row: Row): ComparisonRecord {
  return {
    id: asString(row.id),
    proposalId: asString(row.proposal_id),
    baseCommit: asString(row.base_commit),
    status: asString(row.status) as ComparisonStatus,
    summary: asString(row.summary),
    conclusion: asString(row.conclusion) as ComparisonRecord["conclusion"],
    singleRunEvidence: true,
    startedAt: asNullableString(row.started_at),
    completedAt: asNullableString(row.completed_at),
    createdAt: asString(row.created_at)
  };
}

function mapComparisonCase(row: Row): ComparisonCase {
  return {
    id: asString(row.id),
    comparisonId: asString(row.comparison_id),
    kind: asString(row.kind) as ComparisonCaseKind,
    name: asString(row.name),
    prompt: asString(row.prompt),
    verifierCommand: asString(row.verifier_command),
    verifierArgs: parseJson<string[]>(row.verifier_args_json, []),
    verifierTimeoutMs: Number(row.verifier_timeout_ms)
  };
}

function mapComparisonRun(row: Row): ComparisonRunRecord {
  return {
    id: asString(row.id),
    comparisonId: asString(row.comparison_id),
    caseId: asString(row.case_id),
    variant: asString(row.variant) as ComparisonVariant,
    runId: asNullableString(row.run_id),
    verifierStatus: asString(row.verifier_status) as ComparisonRunRecord["verifierStatus"],
    verifierExitCode: typeof row.verifier_exit_code === "number" ? row.verifier_exit_code : null,
    verifierOutputRef: asNullableString(row.verifier_output_ref),
    patchRef: asNullableString(row.patch_ref),
    durationMs: typeof row.duration_ms === "number" ? row.duration_ms : null,
    infrastructureError: asString(row.infrastructure_error),
    createdAt: asString(row.created_at)
  };
}

export class WorkbenchStore {
  readonly #db: DatabaseSync;

  constructor(databasePath: string) {
    this.#db = new DatabaseSync(databasePath);
    this.#db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.#migrate();
  }

  #migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        thread_id TEXT,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        goal TEXT NOT NULL,
        cwd TEXT NOT NULL,
        model TEXT,
        agent_product TEXT NOT NULL,
        agent_version TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        completeness TEXT NOT NULL,
        outcome_status TEXT NOT NULL,
        outcome_summary TEXT NOT NULL,
        configuration_snapshot_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS runs_thread_id_unique ON runs(thread_id) WHERE thread_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS runs_started_at_idx ON runs(started_at DESC);

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        turn_id TEXT,
        sequence INTEGER,
        timestamp TEXT NOT NULL,
        received_at TEXT NOT NULL,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        summary TEXT NOT NULL,
        data_json TEXT NOT NULL,
        content_refs_json TEXT NOT NULL,
        redacted INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS events_run_order_idx ON events(run_id, sequence, received_at);

      CREATE TABLE IF NOT EXISTS observation_gaps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        source TEXT,
        start_at TEXT,
        end_at TEXT,
        UNIQUE(run_id, kind, summary, source)
      );

      CREATE TABLE IF NOT EXISTS user_corrections (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        target_event_ids_json TEXT NOT NULL,
        redacted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS issues (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        category TEXT NOT NULL,
        status TEXT NOT NULL,
        suggested_target TEXT,
        counter_evidence TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS issue_evidence (
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
        note TEXT NOT NULL,
        PRIMARY KEY(issue_id, run_id, event_id)
      );

      CREATE TABLE IF NOT EXISTS capability_proposals (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE RESTRICT,
        workspace_root TEXT NOT NULL,
        target_path TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        original_digest TEXT NOT NULL,
        original_content_ref TEXT NOT NULL,
        candidate_digest TEXT NOT NULL,
        candidate_content_ref TEXT NOT NULL,
        diff_text TEXT NOT NULL,
        rationale TEXT NOT NULL,
        status TEXT NOT NULL,
        original_run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
        protection_run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        published_at TEXT
      );
      CREATE INDEX IF NOT EXISTS capability_proposals_updated_idx ON capability_proposals(updated_at DESC);

      CREATE TABLE IF NOT EXISTS publish_events (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL REFERENCES capability_proposals(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        target_path TEXT NOT NULL,
        expected_digest TEXT NOT NULL,
        current_digest TEXT NOT NULL,
        resulting_digest TEXT,
        current_content_ref TEXT,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS publish_events_proposal_idx ON publish_events(proposal_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS comparisons (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL REFERENCES capability_proposals(id) ON DELETE CASCADE,
        base_commit TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        conclusion TEXT NOT NULL,
        single_run_evidence INTEGER NOT NULL DEFAULT 1,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS comparison_cases (
        id TEXT PRIMARY KEY,
        comparison_id TEXT NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        verifier_command TEXT NOT NULL,
        verifier_args_json TEXT NOT NULL,
        verifier_timeout_ms INTEGER NOT NULL,
        UNIQUE(comparison_id, kind)
      );

      CREATE TABLE IF NOT EXISTS comparison_runs (
        id TEXT PRIMARY KEY,
        comparison_id TEXT NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
        case_id TEXT NOT NULL REFERENCES comparison_cases(id) ON DELETE CASCADE,
        variant TEXT NOT NULL,
        run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        verifier_status TEXT NOT NULL,
        verifier_exit_code INTEGER,
        verifier_output_ref TEXT,
        patch_ref TEXT,
        duration_ms INTEGER,
        infrastructure_error TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(comparison_id, case_id, variant)
      );
    `);
  }

  close(): void {
    this.#db.close();
  }

  recoverInterruptedState(now = new Date().toISOString()): {
    runIds: string[];
    comparisonIds: string[];
    proposalIds: string[];
  } {
    const runIds = (this.#db.prepare("SELECT id FROM runs WHERE status = 'running'").all() as Row[])
      .map((row) => asString(row.id));
    const interruptedComparisons = this.#db.prepare(
      "SELECT id, proposal_id FROM comparisons WHERE status = 'running'"
    ).all() as Row[];
    const comparisonIds = interruptedComparisons.map((row) => asString(row.id));
    const proposalIds = [...new Set(interruptedComparisons.map((row) => asString(row.proposal_id)))];

    this.transaction(() => {
      for (const runId of runIds) {
        this.#db.prepare(`
          UPDATE runs
          SET status = 'infrastructure_error', ended_at = ?, completeness = 'partial',
              outcome_status = 'unknown',
              outcome_summary = CASE WHEN outcome_summary = ''
                THEN 'The workbench restarted before this Run reached a terminal state.'
                ELSE outcome_summary END,
              updated_at = ?
          WHERE id = ? AND status = 'running'
        `).run(now, now, runId);
        this.addGap({
          runId,
          kind: "source_unavailable",
          summary: "The workbench process stopped before a terminal event was retained; later activity may be missing.",
          source: "startup-recovery",
          startAt: null,
          endAt: now
        });
      }

      for (const comparisonId of comparisonIds) {
        this.#db.prepare(`
          UPDATE comparisons
          SET status = 'infrastructure_error', conclusion = 'inconclusive',
              summary = 'The workbench restarted during this comparison. No improvement claim is allowed; create a new comparison.',
              completed_at = ?
          WHERE id = ? AND status = 'running'
        `).run(now, comparisonId);
      }

      for (const proposalId of proposalIds) {
        this.#db.prepare("UPDATE capability_proposals SET status = 'ready', updated_at = ? WHERE id = ? AND status = 'comparing'")
          .run(now, proposalId);
      }
    });

    return { runIds, comparisonIds, proposalIds };
  }

  ensureRun(input: EnsureRunInput): StoredRun {
    const now = new Date().toISOString();
    const id = stableUuid("runtime-evolution-workbench/run", input.sessionId);
    const startedAt = input.startedAt ?? now;
    const goal = input.goal?.trim() || "Observed Codex session";
    const snapshotId = `cfg:${stableUuid("runtime-evolution-workbench/config", `${input.cwd ?? "unknown"}\0${input.model ?? "unknown"}`)}`;
    this.#db.prepare(`
      INSERT INTO runs (
        id, session_id, thread_id, mode, status, goal, cwd, model, agent_product, agent_version,
        started_at, ended_at, completeness, outcome_status, outcome_summary,
        configuration_snapshot_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'codex', ?, ?, NULL, ?, 'unknown', '', ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        thread_id = COALESCE(excluded.thread_id, runs.thread_id),
        goal = CASE WHEN runs.goal = 'Observed Codex session' AND excluded.goal <> 'Observed Codex session' THEN excluded.goal ELSE runs.goal END,
        cwd = CASE WHEN excluded.cwd <> '' THEN excluded.cwd ELSE runs.cwd END,
        model = COALESCE(excluded.model, runs.model),
        agent_version = COALESCE(excluded.agent_version, runs.agent_version),
        updated_at = excluded.updated_at
    `).run(
      id,
      input.sessionId,
      input.threadId ?? null,
      input.mode,
      input.status ?? "running",
      goal,
      input.cwd ?? "unknown",
      input.model ?? null,
      input.agentVersion ?? null,
      startedAt,
      input.completeness ?? "partial",
      snapshotId,
      now,
      now
    );
    const run = this.getRunBySessionId(input.sessionId);
    if (run === null) throw new Error("Run could not be created");
    return run;
  }

  getRun(id: string): StoredRun | null {
    const row = this.#db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
    return row === undefined ? null : mapRun(row);
  }

  getRunBySessionId(sessionId: string): StoredRun | null {
    const row = this.#db.prepare("SELECT * FROM runs WHERE session_id = ?").get(sessionId) as Row | undefined;
    return row === undefined ? null : mapRun(row);
  }

  getRunByThreadId(threadId: string): StoredRun | null {
    const row = this.#db.prepare("SELECT * FROM runs WHERE thread_id = ?").get(threadId) as Row | undefined;
    return row === undefined ? null : mapRun(row);
  }

  listRuns(limit = 100): StoredRun[] {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    return (this.#db.prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?").all(safeLimit) as Row[]).map(mapRun);
  }

  updateRunGoal(runId: string, goal: string): void {
    const text = goal.trim();
    if (text.length === 0) return;
    this.#db.prepare("UPDATE runs SET goal = ?, updated_at = ? WHERE id = ? AND goal = 'Observed Codex session'").run(text, new Date().toISOString(), runId);
  }

  updateRunTerminal(runId: string, status: RunStatus, endedAt = new Date().toISOString()): void {
    this.#db.prepare("UPDATE runs SET status = ?, ended_at = ?, updated_at = ? WHERE id = ?").run(status, endedAt, endedAt, runId);
  }

  updateRunThread(runId: string, threadId: string, agentVersion?: string | null): void {
    this.#db.prepare("UPDATE runs SET thread_id = ?, agent_version = COALESCE(?, agent_version), updated_at = ? WHERE id = ?").run(
      threadId,
      agentVersion ?? null,
      new Date().toISOString(),
      runId
    );
  }

  updateOutcome(runId: string, status: OutcomeStatus, summary: string): void {
    this.#db.prepare("UPDATE runs SET outcome_status = ?, outcome_summary = ?, updated_at = ? WHERE id = ?").run(
      status,
      summary,
      new Date().toISOString(),
      runId
    );
  }

  setCompleteness(runId: string, completeness: Completeness): void {
    this.#db.prepare("UPDATE runs SET completeness = ?, updated_at = ? WHERE id = ?").run(completeness, new Date().toISOString(), runId);
  }

  addEvent(input: AddEventInput): boolean {
    const nextRow = this.#db.prepare("SELECT COALESCE(MAX(sequence), -1) + 1 AS next_sequence FROM events WHERE run_id = ?").get(input.runId) as Row;
    const nextSequence = typeof nextRow.next_sequence === "number" ? nextRow.next_sequence : 0;
    const result = this.#db.prepare(`
      INSERT OR IGNORE INTO events (
        id, run_id, turn_id, sequence, timestamp, received_at, type, source, summary,
        data_json, content_refs_json, redacted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.runId,
      input.turnId ?? null,
      input.sequence ?? nextSequence,
      input.timestamp,
      input.receivedAt,
      input.type,
      input.source,
      input.summary,
      JSON.stringify(input.data ?? {}),
      JSON.stringify(input.contentRefs ?? []),
      input.redacted === true ? 1 : 0
    );
    return result.changes === 1;
  }

  latestEventTimestamp(runId: string): string | null {
    const row = this.#db.prepare("SELECT timestamp FROM events WHERE run_id = ? ORDER BY sequence DESC LIMIT 1").get(runId) as Row | undefined;
    return row === undefined ? null : asString(row.timestamp);
  }

  addGap(gap: Omit<ObservationGap, "id"> & { id?: string }): string {
    const id = gap.id ?? newId();
    this.#db.prepare(`
      INSERT OR IGNORE INTO observation_gaps (id, run_id, kind, summary, source, start_at, end_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, gap.runId, gap.kind, gap.summary, gap.source, gap.startAt, gap.endAt);
    return id;
  }

  removeGaps(runId: string, kind: ObservationGap["kind"], source: string): void {
    this.#db.prepare("DELETE FROM observation_gaps WHERE run_id = ? AND kind = ? AND source = ?").run(runId, kind, source);
  }

  addCorrection(input: Omit<UserCorrection, "id" | "createdAt"> & { id?: string; createdAt?: string }): UserCorrection {
    const correction: UserCorrection = {
      id: input.id ?? newId(),
      runId: input.runId,
      kind: input.kind,
      text: input.text,
      targetEventIds: [...new Set(input.targetEventIds)],
      redacted: input.redacted,
      createdAt: input.createdAt ?? new Date().toISOString()
    };
    this.#db.prepare(`
      INSERT INTO user_corrections (id, run_id, kind, text, target_event_ids_json, redacted, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      correction.id,
      correction.runId,
      correction.kind,
      correction.text,
      JSON.stringify(correction.targetEventIds),
      correction.redacted ? 1 : 0,
      correction.createdAt
    );
    return correction;
  }

  getRunBundle(runId: string): RunBundle | null {
    const run = this.getRun(runId);
    if (run === null) return null;
    const events = (this.#db.prepare("SELECT * FROM events WHERE run_id = ? ORDER BY sequence, received_at").all(runId) as Row[]).map(mapEvent);
    const gaps = (this.#db.prepare("SELECT * FROM observation_gaps WHERE run_id = ? ORDER BY rowid").all(runId) as Row[]).map(mapGap);
    const corrections = (this.#db.prepare("SELECT * FROM user_corrections WHERE run_id = ? ORDER BY created_at").all(runId) as Row[]).map(mapCorrection);
    return { run, events, gaps, corrections };
  }

  createIssue(input: {
    title: string;
    summary: string;
    category: IssueCategory;
    status?: IssueStatus;
    suggestedTarget?: string | null;
    counterEvidence?: string;
    evidence: Array<{ runId: string; eventId?: string | null; note: string }>;
  }): IssueRecord {
    const id = newId();
    const now = new Date().toISOString();
    this.#db.prepare(`
      INSERT INTO issues (id, title, summary, category, status, suggested_target, counter_evidence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.title,
      input.summary,
      input.category,
      input.status ?? "unconfirmed",
      input.suggestedTarget ?? null,
      input.counterEvidence ?? "",
      now,
      now
    );
    const statement = this.#db.prepare("INSERT INTO issue_evidence (issue_id, run_id, event_id, note) VALUES (?, ?, ?, ?)");
    for (const evidence of input.evidence) statement.run(id, evidence.runId, evidence.eventId ?? null, evidence.note);
    const issue = this.getIssue(id);
    if (issue === null) throw new Error("Issue could not be created");
    return issue;
  }

  listIssues(): IssueRecord[] {
    return (this.#db.prepare(`
      SELECT i.*, COUNT(e.run_id) AS evidence_count
      FROM issues i LEFT JOIN issue_evidence e ON e.issue_id = i.id
      GROUP BY i.id ORDER BY i.updated_at DESC
    `).all() as Row[]).map((row) => this.#mapIssue(row));
  }

  getIssue(id: string): IssueRecord | null {
    const row = this.#db.prepare(`
      SELECT i.*, COUNT(e.run_id) AS evidence_count
      FROM issues i LEFT JOIN issue_evidence e ON e.issue_id = i.id
      WHERE i.id = ? GROUP BY i.id
    `).get(id) as Row | undefined;
    return row === undefined ? null : this.#mapIssue(row);
  }

  getIssueEvidence(id: string): Array<{ runId: string; eventId: string | null; note: string }> {
    return (this.#db.prepare("SELECT run_id, event_id, note FROM issue_evidence WHERE issue_id = ? ORDER BY rowid").all(id) as Row[]).map((row) => ({
      runId: asString(row.run_id),
      eventId: asNullableString(row.event_id),
      note: asString(row.note)
    }));
  }

  createProposalRecord(input: Omit<CapabilityProposal, "id" | "createdAt" | "updatedAt" | "publishedAt">): CapabilityProposal {
    const id = newId();
    const now = new Date().toISOString();
    this.#db.prepare(`
      INSERT INTO capability_proposals (
        id, issue_id, workspace_root, target_path, target_kind, original_digest, original_content_ref,
        candidate_digest, candidate_content_ref, diff_text, rationale, status, original_run_id,
        protection_run_id, created_at, updated_at, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      id,
      input.issueId,
      input.workspaceRoot,
      input.targetPath,
      input.targetKind,
      input.originalDigest,
      input.originalContentRef,
      input.candidateDigest,
      input.candidateContentRef,
      input.diffText,
      input.rationale,
      input.status,
      input.originalRunId,
      input.protectionRunId,
      now,
      now
    );
    const proposal = this.getProposal(id);
    if (proposal === null) throw new Error("Proposal could not be created");
    return proposal;
  }

  getProposal(id: string): CapabilityProposal | null {
    const row = this.#db.prepare("SELECT * FROM capability_proposals WHERE id = ?").get(id) as Row | undefined;
    return row === undefined ? null : mapProposal(row);
  }

  listProposals(): CapabilityProposal[] {
    return (this.#db.prepare("SELECT * FROM capability_proposals ORDER BY updated_at DESC").all() as Row[]).map(mapProposal);
  }

  updateProposalStatus(id: string, status: ProposalStatus, publishedAt?: string | null): void {
    const now = new Date().toISOString();
    this.#db.prepare(`
      UPDATE capability_proposals
      SET status = ?, updated_at = ?, published_at = CASE WHEN ? IS NULL THEN published_at ELSE ? END
      WHERE id = ?
    `).run(status, now, publishedAt ?? null, publishedAt ?? null, id);
  }

  addPublishEvent(input: Omit<PublishEvent, "id" | "createdAt">): PublishEvent {
    const event: PublishEvent = { ...input, id: newId(), createdAt: new Date().toISOString() };
    this.#db.prepare(`
      INSERT INTO publish_events (
        id, proposal_id, action, status, target_path, expected_digest, current_digest,
        resulting_digest, current_content_ref, message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.proposalId,
      event.action,
      event.status,
      event.targetPath,
      event.expectedDigest,
      event.currentDigest,
      event.resultingDigest,
      event.currentContentRef,
      event.message,
      event.createdAt
    );
    return event;
  }

  listPublishEvents(proposalId: string): PublishEvent[] {
    return (this.#db.prepare("SELECT * FROM publish_events WHERE proposal_id = ? ORDER BY created_at DESC").all(proposalId) as Row[]).map(mapPublishEvent);
  }

  createComparison(input: {
    proposalId: string;
    baseCommit: string;
    cases: Array<Omit<ComparisonCase, "id" | "comparisonId">>;
  }): ComparisonRecord {
    const id = newId();
    const now = new Date().toISOString();
    this.transaction(() => {
      this.#db.prepare(`
        INSERT INTO comparisons (
          id, proposal_id, base_commit, status, summary, conclusion, single_run_evidence,
          started_at, completed_at, created_at
        ) VALUES (?, ?, ?, 'queued', '', 'inconclusive', 1, NULL, NULL, ?)
      `).run(id, input.proposalId, input.baseCommit, now);
      const statement = this.#db.prepare(`
        INSERT INTO comparison_cases (
          id, comparison_id, kind, name, prompt, verifier_command, verifier_args_json, verifier_timeout_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const comparisonCase of input.cases) {
        statement.run(
          newId(),
          id,
          comparisonCase.kind,
          comparisonCase.name,
          comparisonCase.prompt,
          comparisonCase.verifierCommand,
          JSON.stringify(comparisonCase.verifierArgs),
          comparisonCase.verifierTimeoutMs
        );
      }
    });
    const comparison = this.getComparison(id);
    if (comparison === null) throw new Error("Comparison could not be created");
    return comparison;
  }

  getComparison(id: string): ComparisonRecord | null {
    const row = this.#db.prepare("SELECT * FROM comparisons WHERE id = ?").get(id) as Row | undefined;
    return row === undefined ? null : mapComparison(row);
  }

  listComparisons(proposalId?: string): ComparisonRecord[] {
    const rows = proposalId === undefined
      ? this.#db.prepare("SELECT * FROM comparisons ORDER BY created_at DESC").all()
      : this.#db.prepare("SELECT * FROM comparisons WHERE proposal_id = ? ORDER BY created_at DESC").all(proposalId);
    return (rows as Row[]).map(mapComparison);
  }

  listComparisonCases(comparisonId: string): ComparisonCase[] {
    return (this.#db.prepare("SELECT * FROM comparison_cases WHERE comparison_id = ? ORDER BY CASE kind WHEN 'failure' THEN 0 ELSE 1 END").all(comparisonId) as Row[]).map(mapComparisonCase);
  }

  listComparisonRuns(comparisonId: string): ComparisonRunRecord[] {
    return (this.#db.prepare("SELECT * FROM comparison_runs WHERE comparison_id = ? ORDER BY created_at").all(comparisonId) as Row[]).map(mapComparisonRun);
  }

  startComparison(id: string): void {
    const now = new Date().toISOString();
    this.#db.prepare("UPDATE comparisons SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'").run(now, id);
  }

  finishComparison(id: string, status: ComparisonStatus, summary: string, conclusion: ComparisonRecord["conclusion"]): void {
    this.#db.prepare("UPDATE comparisons SET status = ?, summary = ?, conclusion = ?, completed_at = ? WHERE id = ?").run(
      status,
      summary,
      conclusion,
      new Date().toISOString(),
      id
    );
  }

  addComparisonRun(input: Omit<ComparisonRunRecord, "id" | "createdAt">): ComparisonRunRecord {
    const record: ComparisonRunRecord = { ...input, id: newId(), createdAt: new Date().toISOString() };
    this.#db.prepare(`
      INSERT INTO comparison_runs (
        id, comparison_id, case_id, variant, run_id, verifier_status, verifier_exit_code,
        verifier_output_ref, patch_ref, duration_ms, infrastructure_error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.comparisonId,
      record.caseId,
      record.variant,
      record.runId,
      record.verifierStatus,
      record.verifierExitCode,
      record.verifierOutputRef,
      record.patchRef,
      record.durationMs,
      record.infrastructureError,
      record.createdAt
    );
    return record;
  }

  markComparisonRunInfrastructure(comparisonId: string, caseId: string, variant: ComparisonVariant, message: string): void {
    this.#db.prepare(`
      UPDATE comparison_runs SET infrastructure_error = ?
      WHERE comparison_id = ? AND case_id = ? AND variant = ?
    `).run(message, comparisonId, caseId, variant);
  }

  #mapIssue(row: Row): IssueRecord {
    return {
      id: asString(row.id),
      title: asString(row.title),
      summary: asString(row.summary),
      category: asString(row.category) as IssueCategory,
      status: asString(row.status) as IssueStatus,
      suggestedTarget: asNullableString(row.suggested_target),
      counterEvidence: asString(row.counter_evidence),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
      evidenceCount: Number(row.evidence_count ?? 0)
    };
  }

  transaction<T>(callback: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const value = callback();
      this.#db.exec("COMMIT");
      return value;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  runRaw(sql: string, ...params: SQLInputValue[]): void {
    this.#db.prepare(sql).run(...params);
  }
}
