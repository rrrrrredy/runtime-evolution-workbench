import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
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
import { basename, dirname, isAbsolute, join, relative } from "node:path";

import { sha256 } from "../shared/ids.js";

const OPERATION_PREFIX = ".runtime-evolution-workbench-recovery-";
const JOURNAL_STATES = new Set<FileAdoptionState>([
  "prepared",
  "target_guarded",
  "target_adopted",
  "applied",
  "conflict"
]);

interface FileIdentity {
  device: string;
  inode: string;
}

export interface FileAdoptionInput {
  operationId: string;
  operationSecret: string;
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
  schema_version: "runtime.file-adoption.v2";
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
  target_identity: FileIdentity;
  staged_identity: FileIdentity;
  created_at: string;
  updated_at: string;
  auth_tag: string;
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
  constructor(
    currentDigest: string,
    recoveryPath: string | null,
    evidencePath: string | null,
    message = "The target changed during non-overwriting adoption"
  ) {
    super(message, currentDigest, recoveryPath, evidencePath);
    this.name = "ConcurrentTargetChangeError";
  }
}

function digestAt(path: string): string {
  return sha256(readFileSync(path));
}

function identityAt(path: string): FileIdentity {
  const stats = lstatSync(path, { bigint: true });
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Expected a regular, non-link file: ${path}`);
  }
  if (realpathSync(path) !== path) {
    throw new Error(`File resolves through an unexpected path: ${path}`);
  }
  return { device: stats.dev.toString(), inode: stats.ino.toString() };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function assertFileIdentity(
  path: string,
  expected: FileIdentity,
  allowedLinkCounts: readonly number[],
  label: string
): void {
  const stats = lstatSync(path, { bigint: true });
  if (!stats.isFile() || stats.isSymbolicLink() || realpathSync(path) !== path) {
    throw new Error(`${label} is not an independent regular file at the signed path`);
  }
  const actual = { device: stats.dev.toString(), inode: stats.ino.toString() };
  if (!sameIdentity(actual, expected)) {
    throw new Error(`${label} file identity differs from the authenticated journal`);
  }
  const links = Number(stats.nlink);
  if (!allowedLinkCounts.includes(links)) {
    throw new Error(`${label} has an unexpected hard-link count ${links}`);
  }
}

function assertIndependentRegularFile(path: string, label: string): void {
  const stats = lstatSync(path, { bigint: true });
  if (!stats.isFile() || stats.isSymbolicLink() || realpathSync(path) !== path || Number(stats.nlink) !== 1) {
    throw new Error(`${label} must be one independent regular file`);
  }
}

function fsyncDirectory(path: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function journalPayload(journal: FileAdoptionJournal): Record<string, unknown> {
  return {
    schema_version: journal.schema_version,
    product: journal.product,
    operation_id: journal.operation_id,
    action: journal.action,
    sequence: journal.sequence,
    state: journal.state,
    workspace_root: journal.workspace_root,
    target_path: journal.target_path,
    staged_path: journal.staged_path,
    recovery_path: journal.recovery_path,
    expected_digest: journal.expected_digest,
    desired_digest: journal.desired_digest,
    target_identity: journal.target_identity,
    staged_identity: journal.staged_identity,
    created_at: journal.created_at,
    updated_at: journal.updated_at
  };
}

function authenticateJournal(journal: FileAdoptionJournal, secret: string): FileAdoptionJournal {
  return {
    ...journal,
    auth_tag: createHmac("sha256", secret).update(JSON.stringify(journalPayload(journal))).digest("hex")
  };
}

function journalAuthenticated(journal: FileAdoptionJournal, secret: string): boolean {
  const expected = Buffer.from(
    createHmac("sha256", secret).update(JSON.stringify(journalPayload(journal))).digest("hex"),
    "hex"
  );
  const actual = Buffer.from(journal.auth_tag, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function appendJournal(
  journal: FileAdoptionJournal,
  state: FileAdoptionState,
  secret: string
): FileAdoptionJournal {
  const next = authenticateJournal(
    {
      ...journal,
      sequence: journal.sequence + 1,
      state,
      updated_at: new Date().toISOString(),
      auth_tag: ""
    },
    secret
  );
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

function isIdentity(value: unknown): value is FileIdentity {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.device === "string" && typeof candidate.inode === "string";
}

function isJournal(value: unknown): value is FileAdoptionJournal {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.schema_version === "runtime.file-adoption.v2" &&
    candidate.product === "runtime-evolution-workbench" &&
    typeof candidate.operation_id === "string" &&
    (candidate.action === "publish" || candidate.action === "rollback") &&
    Number.isSafeInteger(candidate.sequence) &&
    typeof candidate.state === "string" &&
    JOURNAL_STATES.has(candidate.state as FileAdoptionState) &&
    typeof candidate.workspace_root === "string" &&
    typeof candidate.target_path === "string" &&
    typeof candidate.staged_path === "string" &&
    typeof candidate.recovery_path === "string" &&
    typeof candidate.expected_digest === "string" &&
    typeof candidate.desired_digest === "string" &&
    isIdentity(candidate.target_identity) &&
    isIdentity(candidate.staged_identity) &&
    typeof candidate.created_at === "string" &&
    typeof candidate.updated_at === "string" &&
    typeof candidate.auth_tag === "string" &&
    /^[0-9a-f]{64}$/.test(candidate.auth_tag);
}

function operationDirectoryPrefix(input: FileAdoptionInput): string {
  return `${OPERATION_PREFIX}${sha256(input.operationId).replace(/^sha256:/, "").slice(0, 16)}-`;
}

function latestJournal(directory: string, input: FileAdoptionInput): FileAdoptionJournal {
  const candidates = readdirSync(directory)
    .filter((name) => /^journal-\d{3,}-(?:prepared|target_guarded|target_adopted|applied|conflict)\.json$/.test(name))
    .sort()
    .reverse();
  const name = candidates[0];
  if (name === undefined) {
    throw new Error(`Authenticated recovery directory has no journal: ${directory}`);
  }
  const path = join(directory, name);
  assertIndependentRegularFile(path, "Recovery journal");
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isJournal(parsed)) {
    throw new Error(`Recovery journal schema is invalid: ${path}`);
  }
  const expectedName = `journal-${String(parsed.sequence).padStart(3, "0")}-${parsed.state}.json`;
  if (name !== expectedName) {
    throw new Error(`Recovery journal filename does not match its signed sequence and state: ${path}`);
  }
  const expectedStaged = join(directory, `${basename(input.targetPath)}.staged`);
  const expectedRecovery = join(directory, `${basename(input.targetPath)}.original`);
  if (
    parsed.operation_id !== input.operationId ||
    parsed.action !== input.action ||
    parsed.workspace_root !== input.workspaceRoot ||
    parsed.target_path !== input.targetPath ||
    parsed.staged_path !== expectedStaged ||
    parsed.recovery_path !== expectedRecovery ||
    parsed.expected_digest !== input.expectedDigest ||
    parsed.desired_digest !== input.desiredDigest
  ) {
    throw new Error(`Recovery journal does not match the requested operation: ${path}`);
  }
  if (!journalAuthenticated(parsed, input.operationSecret)) {
    throw new Error(`Recovery journal authentication failed: ${path}`);
  }
  return parsed;
}

function validateInput(input: FileAdoptionInput): void {
  if (input.operationSecret.length < 32) {
    throw new Error("File-adoption operation secret is missing or too short");
  }
  if (realpathSync(input.workspaceRoot) !== input.workspaceRoot || !statSync(input.workspaceRoot).isDirectory()) {
    throw new Error("File-adoption workspace root must be a real directory");
  }
  const relativeTarget = relative(input.workspaceRoot, input.targetPath);
  if (
    relativeTarget.length === 0 ||
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(relativeTarget)
  ) {
    throw new Error("File-adoption target must remain inside the workspace root");
  }
  if (sha256(input.desiredContent) !== input.desiredDigest) {
    throw new Error("Desired file content does not match its approved digest");
  }
}

function findPendingOperation(input: FileAdoptionInput): FileAdoptionJournal | null {
  const matches: FileAdoptionJournal[] = [];
  const prefix = operationDirectoryPrefix(input);
  for (const entry of readdirSync(input.workspaceRoot, { withFileTypes: true })) {
    if (!entry.name.startsWith(prefix)) continue;
    const directory = join(input.workspaceRoot, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`Recovery path is not a real directory: ${directory}`);
    }
    const stats = lstatSync(directory, { bigint: true });
    if (!stats.isDirectory() || stats.isSymbolicLink() || realpathSync(directory) !== directory) {
      throw new Error(`Recovery directory resolves through an untrusted path: ${directory}`);
    }
    const journal = latestJournal(directory, input);
    if (journal.state !== "conflict") matches.push(journal);
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
  if (realpathSync(input.targetPath) !== input.targetPath) {
    throw new FileAdoptionError("The target resolves through a link or alias", "unknown", null, input.targetPath);
  }
  const targetIdentity = identityAt(input.targetPath);
  assertFileIdentity(input.targetPath, targetIdentity, [1], "Target");
  const previousDigest = digestAt(input.targetPath);
  if (previousDigest === input.desiredDigest) {
    throw new AlreadyDesiredContent(previousDigest);
  }
  if (previousDigest !== input.expectedDigest) {
    throw new ConcurrentTargetChangeError(
      previousDigest,
      null,
      input.targetPath,
      "The target no longer matches the approved preimage"
    );
  }

  const directory = join(input.workspaceRoot, `${operationDirectoryPrefix(input)}${randomUUID()}`);
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  if (statSync(directory).dev !== statSync(input.targetPath).dev) {
    throw new FileAdoptionError(
      "The recovery directory is not on the target filesystem",
      previousDigest,
      null,
      input.targetPath
    );
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
  const stagedIdentity = identityAt(stagedPath);
  assertFileIdentity(stagedPath, stagedIdentity, [1], "Staged candidate");
  if (digestAt(stagedPath) !== input.desiredDigest) {
    throw new FileAdoptionError(
      "The staged capability file did not match the approved digest",
      previousDigest,
      null,
      input.targetPath
    );
  }

  const probePath = join(directory, `${basename(input.targetPath)}.hardlink-probe`);
  try {
    hooks.beforeHardLinkPreflight?.();
    linkToAbsent(stagedPath, probePath);
    unlinkSync(probePath);
    assertFileIdentity(stagedPath, stagedIdentity, [1], "Staged candidate");
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
    schema_version: "runtime.file-adoption.v2",
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
    target_identity: targetIdentity,
    staged_identity: stagedIdentity,
    created_at: now,
    updated_at: now,
    auth_tag: ""
  };
  return appendJournal(initial, "prepared", input.operationSecret);
}

function linkToAbsent(source: string, destination: string): void {
  linkSync(source, destination);
}

class AlreadyDesiredContent extends Error {
  constructor(readonly digest: string) {
    super("The desired content is already present");
  }
}

function restoreRecoveryToAbsentTarget(journal: FileAdoptionJournal): void {
  if (existsSync(journal.target_path)) return;
  assertFileIdentity(journal.recovery_path, journal.target_identity, [1], "Guarded original");
  try {
    linkToAbsent(journal.recovery_path, journal.target_path);
  } catch (error) {
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

function conflict(
  journal: FileAdoptionJournal,
  secret: string,
  currentDigest: string,
  evidencePath: string,
  message: string
): never {
  appendJournal(journal, "conflict", secret);
  throw new ConcurrentTargetChangeError(currentDigest, journal.recovery_path, evidencePath, message);
}

function detachAppliedStagedLink(journal: FileAdoptionJournal): void {
  assertFileIdentity(journal.target_path, journal.staged_identity, [1, 2], "Adopted target");
  if (existsSync(journal.staged_path)) {
    assertFileIdentity(journal.staged_path, journal.staged_identity, [2], "Staged candidate");
    unlinkSync(journal.staged_path);
    fsyncDirectory(dirname(journal.staged_path));
  }
  assertFileIdentity(journal.target_path, journal.staged_identity, [1], "Adopted target");
}

function resumeOperation(
  journal: FileAdoptionJournal,
  secret: string,
  hooks: FileAdoptionHooks
): FileAdoptionResult {
  const recoveryExists = existsSync(journal.recovery_path);
  const targetExists = existsSync(journal.target_path);
  const targetDigest = targetExists ? digestAt(journal.target_path) : null;
  const targetIsCandidate = targetDigest === journal.desired_digest;
  if (journal.state === "applied" && recoveryExists && targetIsCandidate) {
    assertFileIdentity(journal.recovery_path, journal.target_identity, [1], "Guarded original");
    detachAppliedStagedLink(journal);
    return {
      previousDigest: journal.expected_digest,
      resultingDigest: journal.desired_digest,
      recoveryPath: journal.recovery_path
    };
  }
  if (!existsSync(journal.staged_path)) {
    throw new FileAdoptionError(
      "The durable staged file is missing",
      "missing",
      journal.recovery_path,
      recoveryExists ? journal.recovery_path : null
    );
  }
  assertFileIdentity(
    journal.staged_path,
    journal.staged_identity,
    targetIsCandidate ? [2] : [1],
    "Staged candidate"
  );
  if (digestAt(journal.staged_path) !== journal.desired_digest) {
    throw new FileAdoptionError(
      "The durable staged file is corrupt",
      "missing",
      journal.recovery_path,
      recoveryExists ? journal.recovery_path : null
    );
  }
  if (recoveryExists) {
    assertFileIdentity(
      journal.recovery_path,
      journal.target_identity,
      targetExists && targetDigest === journal.expected_digest ? [1, 2] : [1],
      "Guarded original"
    );
  } else if (targetExists && targetDigest === journal.expected_digest) {
    assertFileIdentity(journal.target_path, journal.target_identity, [1], "Target");
  }
  if (targetIsCandidate) {
    assertFileIdentity(journal.target_path, journal.staged_identity, [2], "Adopted target");
  }

  if (recoveryExists && targetIsCandidate) {
    journal = appendJournal(journal, "applied", secret);
    detachAppliedStagedLink(journal);
    return {
      previousDigest: journal.expected_digest,
      resultingDigest: journal.desired_digest,
      recoveryPath: journal.recovery_path
    };
  }
  if (recoveryExists && targetDigest !== null) {
    conflict(
      journal,
      secret,
      targetDigest,
      journal.target_path,
      "A target file appeared while the original was guarded; both versions were preserved"
    );
  }

  if (!recoveryExists) {
    if (targetDigest === null) {
      throw new FileAdoptionError("Both target and recovery are missing", "missing", journal.recovery_path, null);
    }
    if (targetDigest !== journal.expected_digest) {
      conflict(journal, secret, targetDigest, journal.target_path, "The target changed before it could be guarded");
    }
    assertFileIdentity(journal.target_path, journal.target_identity, [1], "Target");
    renameSync(journal.target_path, journal.recovery_path);
    assertFileIdentity(journal.recovery_path, journal.target_identity, [1], "Guarded original");
    journal = appendJournal(journal, "target_guarded", secret);
    hooks.afterTargetGuarded?.(journal);
  }

  const guardedDigest = digestAt(journal.recovery_path);
  if (guardedDigest !== journal.expected_digest) {
    restoreRecoveryToAbsentTarget(journal);
    const evidencePath = existsSync(journal.target_path) ? journal.target_path : journal.recovery_path;
    conflict(
      journal,
      secret,
      digestAt(evidencePath),
      evidencePath,
      "The guarded target changed before adoption; it was restored without replacing another file"
    );
  }

  if (journal.state === "target_adopted" || journal.state === "applied") {
    restoreRecoveryToAbsentTarget(journal);
    const evidencePath = existsSync(journal.target_path) ? journal.target_path : journal.recovery_path;
    conflict(
      journal,
      secret,
      digestAt(evidencePath),
      evidencePath,
      "The adopted target disappeared after a process interruption; the guarded version was restored when possible"
    );
  }

  hooks.afterExpectedDigestVerified?.(journal);
  try {
    assertFileIdentity(journal.staged_path, journal.staged_identity, [1], "Staged candidate");
    linkToAbsent(journal.staged_path, journal.target_path);
  } catch (error) {
    if (existsSync(journal.target_path)) {
      conflict(
        journal,
        secret,
        digestAt(journal.target_path),
        journal.target_path,
        "Another writer recreated the target; candidate adoption did not replace it"
      );
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
  assertFileIdentity(journal.staged_path, journal.staged_identity, [2], "Staged candidate");
  assertFileIdentity(journal.target_path, journal.staged_identity, [2], "Adopted target");
  journal = appendJournal(journal, "target_adopted", secret);
  hooks.afterTargetAdopted?.(journal);

  const resultingDigest = digestAt(journal.target_path);
  if (resultingDigest !== journal.desired_digest) {
    conflict(
      journal,
      secret,
      resultingDigest,
      journal.target_path,
      "The target changed immediately after candidate adoption; current and recovery files were preserved"
    );
  }
  journal = appendJournal(journal, "applied", secret);
  detachAppliedStagedLink(journal);
  return { previousDigest: journal.expected_digest, resultingDigest, recoveryPath: journal.recovery_path };
}

export function adoptFileWithoutOverwrite(
  input: FileAdoptionInput,
  hooks: FileAdoptionHooks = {}
): FileAdoptionResult {
  let journal: FileAdoptionJournal | null = null;
  try {
    validateInput(input);
    journal = findPendingOperation(input);
    if (journal === null && existsSync(input.targetPath)) {
      const currentDigest = digestAt(input.targetPath);
      if (currentDigest === input.desiredDigest) {
        return { previousDigest: currentDigest, resultingDigest: currentDigest, recoveryPath: null };
      }
    }
    if (journal === null) {
      journal = createOperation(input, hooks);
      hooks.afterPrepared?.(journal);
    }
    return resumeOperation(journal, input.operationSecret, hooks);
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
