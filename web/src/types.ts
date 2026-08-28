export type ViewName = "runs" | "issues" | "evolution";

export interface RunSummary {
  id: string;
  sessionId: string;
  threadId: string | null;
  mode: "observed" | "managed" | "imported";
  status: string;
  goal: string;
  cwd: string;
  model: string | null;
  agentProduct: string;
  agentVersion: string | null;
  startedAt: string;
  endedAt: string | null;
  completeness: "complete" | "partial" | "unknown";
  outcomeStatus: "success" | "partial" | "failure" | "unknown";
  outcomeSummary: string;
  configurationSnapshotId: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunEvent {
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
  kind: string;
  summary: string;
  source: string | null;
  startAt: string | null;
  endAt: string | null;
}

export interface Correction {
  id: string;
  runId: string;
  kind: string;
  text: string;
  targetEventIds: string[];
  redacted: boolean;
  createdAt: string;
}

export interface RunBundle {
  run: RunSummary;
  events: RunEvent[];
  gaps: ObservationGap[];
  corrections: Correction[];
}

export interface Issue {
  id: string;
  title: string;
  summary: string;
  category: string;
  status: string;
  suggestedTarget: string | null;
  counterEvidence: string;
  createdAt: string;
  updatedAt: string;
  evidenceCount: number;
}

export interface Proposal {
  id: string;
  issueId: string;
  workspaceRoot: string;
  targetPath: string;
  targetKind: "agents" | "skill";
  originalDigest: string;
  originalContentRef: string;
  candidateDigest: string;
  candidateContentRef: string;
  diffText: string;
  rationale: string;
  status: string;
  originalRunId: string;
  protectionRunId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface PublishEvent {
  id: string;
  proposalId: string;
  action: string;
  status: string;
  targetPath: string;
  expectedDigest: string;
  currentDigest: string;
  resultingDigest: string | null;
  currentContentRef: string | null;
  message: string;
  createdAt: string;
}

export interface ProposalDetail {
  proposal: Proposal;
  publishEvents: PublishEvent[];
  originalContent: string;
  candidateContent: string;
}

export interface Comparison {
  id: string;
  proposalId: string;
  baseCommit: string;
  status: string;
  summary: string;
  conclusion: string;
  singleRunEvidence: true;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ComparisonCase {
  id: string;
  comparisonId: string;
  kind: "failure" | "protection";
  name: string;
  prompt: string;
  verifierCommand: string;
  verifierArgs: string[];
  verifierTimeoutMs: number;
}

export interface ComparisonRun {
  id: string;
  comparisonId: string;
  caseId: string;
  variant: "baseline" | "candidate";
  runId: string | null;
  verifierStatus: string;
  verifierExitCode: number | null;
  verifierOutputRef: string | null;
  patchRef: string | null;
  durationMs: number | null;
  infrastructureError: string;
  createdAt: string;
}

export interface ComparisonDetail {
  comparison: Comparison;
  cases: ComparisonCase[];
  runs: ComparisonRun[];
}

export interface CodexThread {
  id: string;
  preview?: string;
  cwd?: string;
  updatedAt?: number;
  cliVersion?: string;
}
