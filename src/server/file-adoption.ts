import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { sha256 } from "../shared/ids.js";

const OPERATION_PREFIX = ".runtime-evolution-workbench-recovery-";

export interface FileAdoptionInput {
  operationId: string;
  action: "publish" | "rollback";
  workspaceRoot: string;
  targetPath: string;
  expectedDigest: string;
  desiredContent: string;
  desiredDigest: string;
}

export interface FileAdoptionResult {
  previousDigest: string;
  resultingDigest: string;
  recoveryPath: string | null;
}

export interface FileAdoptionHooks {
  beforeHardLinkPreflight?: () => void;
  afterPrepared?: (journal: FileAdoptionJournal) => void;
  afterTargetGuarded?: (journal: FileAdoptionJournal) => void;
  afterExpectedDigestVerified?: (journal: FileAdoptionJournal) => void;
  afterTargetAdopted?: (journal: FileAdoptionJournal) => void;
}

type FileAdoptionState = "prepared" | "target_guarded" | "target_adopted" | "applied" | "conflict";

export interface FileAdoptionJournal {
  schema_version: "runtime.file-adoption.v1";
  product: "runtime-evolution-workbench";
  operation_id: string;
  action: "publish" | "rollback";
  sequence: number;
  state: FileAdoptionState;
  workspace_root: string;
  target_path: string;
  staged_path: string;
  recovery_path: string;
  expected_digest: string;
  desired_digest: string;
  created_at: string;
  updated_at: string;
}

export class FileAdoptionError extends Error {
  constructor(
    message: string,
    readonly currentDigest: string,
    readonly recoveryPath: string | null,
    readonly evidencePath: string | null,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "FileAdoptionError";
  }
}

export class ConcurrentTargetChangeError extends FileAdoptionError {
  constructor(currentDigest: string, recoveryPath: string | null, evidencePath: string | null, message = "The target changed during non-overwriting adoption") {
    super(message, currentDigest, recoveryPath, evidencePath);
    this.name = "ConcurrentTargetChangeError";
  }
}

function digestAt(path: string): string {
  return sha256(readFileSync(path));
}

function fsyncDirectory(path: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(path, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function appendJournal(journal: FileAdoptionJournal, state: FileAdoptionState): FileAdoptionJournal {
  const next: FileAdoptionJournal = {
    ...journal,
    sequence: journal.sequence + 1,
    state,
    updated_at: new Date().toISOString()
  };
  const directory = dirname(next.staged_path);
  const journalPath = join(directory, `journal-${String(next.sequence).padStart(3, "0")}-${state}.json`);
  const descriptor = openSync(journalPath, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8" });
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  fsyncDirectory(directory);
  return next;
}

function isJournal(value: unknown): value is FileAdoptionJournal {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.schema_version === "runtime.file-adoption.v1" &&
    candidate.product === "runtime-evolution-workbench" &&
    typeof candidate.operation_id === "string" &&
    typeof candidate.action === "string" &&
    typeof candidate.sequence === "number" &&
    typeof candidate.state === "string" &&
    typeof candidate.workspace_root === "string" &&
    typeof candidate.target_path === "string" &&
    typeof candidate.staged_path === "string" &&
    typeof candidate.recovery_path === "string" &&
    typeof candidate.expected_digest === "string" &&
    typeof candidate.desired_digest === "string" &&
    typeof candidate.created_at === "string" &&
    typeof candidate.updated_at === "string";
}

function latestJournal(directory: string): FileAdoptionJournal | null {
  const candidates = readdirSync(directory)
    .filter((name) => /^journal-\d{3}-(?:prepared|target_guarded|target_adopted|applied|conflict)\.json$/.test(name))
    .sort()
    .reverse();
  for (const name of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(join(directory, name), "utf8")) as unknown;
      if (isJournal(parsed)) return parsed;
    } catch {
      // A process may have died while appending the newest immutable journal record.
    }
  }
  return null;
}

function findPendingOperation(input: FileAdoptionInput): FileAdoptionJournal | null {
  const matches: FileAdoptionJournal[] = [];
  for (const entry of readdirSync(input.workspaceRoot, { withFileTypes: true })) {
    if (!entry.name.startsWith(OPERATION_PREFIX) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directory = join(input.workspaceRoot, entry.name);
    if (lstatSync(directory).isSymbolicLink()) continue;
    if (realpathSync(directory) !== directory) continue;
    const journal = latestJournal(directory);
    if (journal === null || journal.state === "conflict") continue;
    if (
      journal.operation_id === input.operationId &&
      journal.action === input.action &&
      journal.workspace_root === input.workspaceRoot &&
      journal.target_path === input.targetPath &&
      dirname(journal.staged_path) === directory &&
      dirname(journal.recovery_path) === directory &&
      journal.expected_digest === input.expectedDigest &&
      journal.desired_digest === input.desiredDigest
    ) matches.push(journal);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple unfinished file-adoption journals exist for ${input.operationId}; manual recovery is required`);
  }
  return matches[0] ?? null;
}

function createOperation(input: FileAdoptionInput, hooks: FileAdoptionHooks): FileAdoptionJournal {
  if (!existsSync(input.targetPath)) {
    throw new FileAdoptionError("The target is missing and no unfinished recovery journal exists", "missing", null, null);
  }
  const previousDigest = digestAt(input.targetPath);
  if (previousDigest === input.desiredDigest) {
    throw new AlreadyDesiredContent(previousDigest);
  }
  if (previousDigest !== input.expectedDigest) {
    throw new ConcurrentTargetChangeError(previousDigest, null, input.targetPath, "The target no longer matches the approved preimage");
  }

  const directory = join(input.workspaceRoot, `${OPERATION_PREFIX}${randomUUID()}`);
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  if (statSync(directory).dev !== statSync(input.targetPath).dev) {
    throw new FileAdoptionError("The recovery directory is not on the target filesystem", previousDigest, null, input.targetPath);
  }
  const stagedPath = join(directory, `${basename(input.targetPath)}.staged`);
  const recoveryPath = join(directory, `${basename(input.targetPath)}.original`);
  const mode = statSync(input.targetPath).mode & 0o777;
  const descriptor = openSync(stagedPath, "wx", mode);
  try {
    writeFileSync(descriptor, input.desiredContent, { encoding: "utf8" });
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  if (digestAt(stagedPath) !== input.desiredDigest) {
    throw new FileAdoptionError("The staged capability file did not match the approved digest", previousDigest, null, input.targetPath);
  }

  const probePath = join(directory, `${basename(input.targetPath)}.hardlink-probe`);
  try {
    hooks.beforeHardLinkPreflight?.();
    linkToAbsent(stagedPath, probePath);
    unlinkSync(probePath);
  } catch (error) {
    if (existsSync(probePath)) unlinkSync(probePath);
    throw new FileAdoptionError(
      "This filesystem cannot provide the no-clobber hard link required for safe publication",
      previousDigest,
      null,
      input.targetPath,
      { cause: error }
    );
  }

  const now = new Date().toISOString();
  const initial: FileAdoptionJournal = {
    schema_version: "runtime.file-adoption.v1",
    product: "runtime-evolution-workbench",
    operation_id: input.operationId,
    action: input.action,
    sequence: -1,
    state: "prepared",
    workspace_root: input.workspaceRoot,
    target_path: input.targetPath,
    staged_path: stagedPath,
    recovery_path: recoveryPath,
    expected_digest: input.expectedDigest,
    desired_digest: input.desiredDigest,
    created_at: now,
    updated_at: now
  };
  return appendJournal(initial, "prepared");
}

function linkToAbsent(source: string, destination: string): void {
  // linkSync is an atomic create-if-absent operation; unlike rename, it cannot replace destination bytes.
  linkSync(source, destination);
}

class AlreadyDesiredContent extends Error {
  constructor(readonly digest: string) { super("The desired content is already present"); }
}

function restoreRecoveryToAbsentTarget(journal: FileAdoptionJournal): void {
  if (existsSync(journal.target_path)) return;
  try { linkToAbsent(journal.recovery_path, journal.target_path); } catch (error) {
    if (!existsSync(journal.target_path)) {
      throw new FileAdoptionError(
        "The guarded target could not be restored without overwriting another file",
        digestAt(journal.recovery_path),
        journal.recovery_path,
        journal.recovery_path,
        { cause: error }
      );
    }
  }
}

function conflict(journal: FileAdoptionJournal, currentDigest: string, evidencePath: string, message: string): never {
  appendJournal(journal, "conflict");
  throw new ConcurrentTargetChangeError(currentDigest, journal.recovery_path, evidencePath, message);
}

function resumeOperation(journal: FileAdoptionJournal, hooks: FileAdoptionHooks): FileAdoptionResult {
  if (!existsSync(journal.staged_path) || digestAt(journal.staged_path) !== journal.desired_digest) {
    throw new FileAdoptionError("The durable staged file is missing or corrupt", "missing", journal.recovery_path, existsSync(journal.recovery_path) ? journal.recovery_path : null);
  }

  const recoveryExists = existsSync(journal.recovery_path);
  const targetExists = existsSync(journal.target_path);
  const targetDigest = targetExists ? digestAt(journal.target_path) : null;

  if (recoveryExists && targetDigest === journal.desired_digest) {
    appendJournal(journal, "applied");
    return { previousDigest: journal.expected_digest, resultingDigest: targetDigest, recoveryPath: journal.recovery_path };
  }
  if (recoveryExists && targetDigest !== null) {
    conflict(journal, targetDigest, journal.target_path, "A target file appeared while the original was guarded; both versions were preserved");
  }

  if (!recoveryExists) {
    if (targetDigest === null) {
      throw new FileAdoptionError("Both target and recovery are missing", "missing", journal.recovery_path, null);
    }
    if (targetDigest !== journal.expected_digest) {
      conflict(journal, targetDigest, journal.target_path, "The target changed before it could be guarded");
    }
    renameSync(journal.target_path, journal.recovery_path);
    journal = appendJournal(journal, "target_guarded");
    hooks.afterTargetGuarded?.(journal);
  }

  const guardedDigest = digestAt(journal.recovery_path);
  if (guardedDigest !== journal.expected_digest) {
    restoreRecoveryToAbsentTarget(journal);
    const evidencePath = existsSync(journal.target_path) ? journal.target_path : journal.recovery_path;
    conflict(journal, digestAt(evidencePath), evidencePath, "The guarded target changed before adoption; it was restored without replacing another file");
  }

  if (journal.state === "target_adopted" || journal.state === "applied") {
    restoreRecoveryToAbsentTarget(journal);
    const evidencePath = existsSync(journal.target_path) ? journal.target_path : journal.recovery_path;
    conflict(journal, digestAt(evidencePath), evidencePath, "The adopted target disappeared after a process interruption; the guarded version was restored when possible");
  }

  hooks.afterExpectedDigestVerified?.(journal);
  try {
    linkToAbsent(journal.staged_path, journal.target_path);
  } catch (error) {
    if (existsSync(journal.target_path)) {
      conflict(journal, digestAt(journal.target_path), journal.target_path, "Another writer recreated the target; candidate adoption did not replace it");
    }
    restoreRecoveryToAbsentTarget(journal);
    throw new FileAdoptionError(
      "Candidate adoption failed; the guarded target was restored without overwriting another file",
      existsSync(journal.target_path) ? digestAt(journal.target_path) : guardedDigest,
      journal.recovery_path,
      existsSync(journal.target_path) ? journal.target_path : journal.recovery_path,
      { cause: error }
    );
  }
  journal = appendJournal(journal, "target_adopted");
  hooks.afterTargetAdopted?.(journal);

  const resultingDigest = digestAt(journal.target_path);
  if (resultingDigest !== journal.desired_digest) {
    conflict(journal, resultingDigest, journal.target_path, "The target changed immediately after candidate adoption; current and recovery files were preserved");
  }
  appendJournal(journal, "applied");
  return { previousDigest: journal.expected_digest, resultingDigest, recoveryPath: journal.recovery_path };
}

export function adoptFileWithoutOverwrite(input: FileAdoptionInput, hooks: FileAdoptionHooks = {}): FileAdoptionResult {
  let journal = findPendingOperation(input);
  if (journal === null && existsSync(input.targetPath)) {
    const currentDigest = digestAt(input.targetPath);
    if (currentDigest === input.desiredDigest) {
      return { previousDigest: currentDigest, resultingDigest: currentDigest, recoveryPath: null };
    }
  }
  try {
    if (journal === null) {
      journal = createOperation(input, hooks);
      hooks.afterPrepared?.(journal);
    }
    return resumeOperation(journal, hooks);
  } catch (error) {
    if (error instanceof AlreadyDesiredContent) {
      return { previousDigest: error.digest, resultingDigest: error.digest, recoveryPath: null };
    }
    if (error instanceof FileAdoptionError) throw error;
    const recoveryPath = journal?.recovery_path ?? null;
    const evidencePath = existsSync(input.targetPath)
      ? input.targetPath
      : recoveryPath !== null && existsSync(recoveryPath) ? recoveryPath : null;
    const currentDigest = evidencePath === null ? "missing" : digestAt(evidencePath);
    throw new FileAdoptionError(
      `File adoption was interrupted: ${error instanceof Error ? error.message : String(error)}`,
      currentDigest,
      recoveryPath,
      evidencePath,
      { cause: error instanceof Error ? error : undefined }
    );
  }
}
