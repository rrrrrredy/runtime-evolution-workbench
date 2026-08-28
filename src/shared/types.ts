export type RunMode = "observed" | "managed" | "imported";
export type RunStatus = "running" | "completed" | "failed" | "cancelled" | "agent_timeout" | "agent_crash" | "infrastructure_error";
export type OutcomeStatus = "success" | "partial" | "failure" | "unknown";
export type Completeness = "complete" | "partial" | "unknown";

export interface HookEnvelope {
  schema_version: "rew.hook.v1";
  event_id: string;
  session_id: string;
  turn_id: string | null;
  hook_event_name: string;
  cwd: string;
  model: string | null;
  permission_mode: string | null;
  received_at: string;
  payload: Record<string, unknown>;
  redaction: {
    status: "not_needed" | "applied" | "partial" | "unknown";
    redacted_field_count: number;
    truncated_field_count: number;
    patterns: string[];
  };
}

export interface StoredRun {
  id: string;
  sessionId: string;
  threadId: string | null;
  mode: RunMode;
  status: RunStatus;
  goal: string;
  cwd: string;
  model: string | null;
  agentProduct: string;
  agentVersion: string | null;
  startedAt: string;
  endedAt: string | null;
  completeness: Completeness;
  outcomeStatus: OutcomeStatus;
  outcomeSummary: string;
  configurationSnapshotId: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredEvent {
  id: string;
  runId: string;
  turnId: string | null;
  sequence: number | null;
  timestamp: string;
  receivedAt: string;
  type: string;
  source: string;
  summary: string;
  data: Record<string, unknown>;
  contentRefs: string[];
  redacted: boolean;
}

export interface ObservationGap {
  id: string;
  runId: string;
  kind: "missing" | "out_of_order" | "source_unavailable" | "excluded" | "redacted" | "mapping_loss" | "unknown";
  summary: string;
  source: string | null;
  startAt: string | null;
  endAt: string | null;
}

export interface UserCorrection {
  id: string;
  runId: string;
  kind: "result_label" | "instruction" | "replacement" | "rollback" | "other";
  text: string;
  targetEventIds: string[];
  redacted: boolean;
  createdAt: string;
}

export type IssueCategory = "instruction" | "skill" | "tool" | "environment" | "permission" | "validation" | "model" | "unknown";
export type IssueStatus = "unconfirmed" | "confirmed" | "proposing" | "comparing" | "resolved" | "rejected" | "recurring";

export interface IssueRecord {
  id: string;
  title: string;
  summary: string;
  category: IssueCategory;
  status: IssueStatus;
  suggestedTarget: string | null;
  counterEvidence: string;
  createdAt: string;
  updatedAt: string;
  evidenceCount: number;
}

export type ProposalStatus = "draft" | "ready" | "comparing" | "approved" | "published" | "rejected" | "rollback_conflict" | "rolled_back";
export type CapabilityTargetKind = "agents" | "skill";

export interface CapabilityProposal {
  id: string;
  issueId: string;
  workspaceRoot: string;
  targetPath: string;
  targetKind: CapabilityTargetKind;
  originalDigest: string;
  originalContentRef: string;
  candidateDigest: string;
  candidateContentRef: string;
  diffText: string;
  rationale: string;
  status: ProposalStatus;
  originalRunId: string;
  protectionRunId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface PublishEvent {
  id: string;
  proposalId: string;
  action: "publish" | "rollback";
  status: "applied" | "conflict" | "failed";
  targetPath: string;
  expectedDigest: string;
  currentDigest: string;
  resultingDigest: string | null;
  currentContentRef: string | null;
  message: string;
  createdAt: string;
}

export type ComparisonStatus = "queued" | "running" | "completed" | "infrastructure_error";
export type ComparisonVariant = "baseline" | "candidate";
export type ComparisonCaseKind = "failure" | "protection";

export interface ComparisonCase {
  id: string;
  comparisonId: string;
  kind: ComparisonCaseKind;
  name: string;
  prompt: string;
  verifierCommand: string;
  verifierArgs: string[];
  verifierTimeoutMs: number;
}

export interface ComparisonRecord {
  id: string;
  proposalId: string;
  baseCommit: string;
  status: ComparisonStatus;
  summary: string;
  conclusion: "candidate_supported" | "candidate_not_supported" | "inconclusive";
  singleRunEvidence: true;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ComparisonRunRecord {
  id: string;
  comparisonId: string;
  caseId: string;
  variant: ComparisonVariant;
  runId: string | null;
  verifierStatus: "pass" | "fail" | "timeout" | "error" | "not_run";
  verifierExitCode: number | null;
  verifierOutputRef: string | null;
  patchRef: string | null;
  durationMs: number | null;
  infrastructureError: string;
  createdAt: string;
}
