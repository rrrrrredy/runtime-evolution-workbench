import {
  closeSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sha256 } from "../shared/ids.js";
import {
  adoptFileWithoutOverwrite,
  ConcurrentTargetChangeError,
  FileAdoptionError,
  type FileAdoptionHooks,
  type FileAdoptionInput
} from "./file-adoption.js";

function fixture(suffix: string): { root: string; workspace: string; target: string; input: FileAdoptionInput; original: string; desired: string } {
  const scratchRoot = process.env.REW_TEST_TMP ?? tmpdir();
  mkdirSync(scratchRoot, { recursive: true });
  const root = mkdtempSync(join(scratchRoot, `rew-adoption-${suffix}-`));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const target = join(workspace, "AGENTS.md");
  const original = "# Rules\n\n- Preserve the user's file.\n";
  const desired = "# Rules\n\n- Adopt the reviewed candidate.\n";
  writeFileSync(target, original, "utf8");
  return {
    root,
    workspace,
    target,
    original,
    desired,
    input: {
      operationId: `proposal-${suffix}:publish`,
      action: "publish",
      workspaceRoot: workspace,
      targetPath: target,
      expectedDigest: sha256(original),
      desiredContent: desired,
      desiredDigest: sha256(desired)
    }
  };
}

function recoveryDirectories(workspace: string): string[] {
  return readdirSync(workspace)
    .filter((name) => name.startsWith(".runtime-evolution-workbench-recovery-"))
    .map((name) => join(workspace, name));
}

describe("non-overwriting file adoption", () => {
  it("does not replace a target recreated by an atomic-save editor", () => {
    const value = fixture("atomic-save");
    const userContent = "# Rules\n\n- User saved during publication.\n";
    try {
      let failure: unknown;
      try {
        adoptFileWithoutOverwrite(value.input, {
          afterExpectedDigestVerified: () => {
            const temporary = join(value.workspace, "AGENTS.md.user-save");
            writeFileSync(temporary, userContent, "utf8");
            renameSync(temporary, value.target);
          }
        });
      } catch (error) { failure = error; }

      expect(failure).toBeInstanceOf(ConcurrentTargetChangeError);
      expect(readFileSync(value.target, "utf8")).toBe(userContent);
      const recoveryPath = (failure as ConcurrentTargetChangeError).recoveryPath;
      expect(recoveryPath).not.toBeNull();
      expect(readFileSync(recoveryPath!, "utf8")).toBe(value.original);
    } finally {
      rmSync(value.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("keeps a late write through the editor's old handle in the visible recovery file", () => {
    const value = fixture("old-handle");
    const descriptor = openSync(value.target, "r+");
    const lateContent = "# Rules\n\n- Late write through an old editor handle.\n";
    try {
      const result = adoptFileWithoutOverwrite(value.input, {
        afterTargetAdopted: () => {
          ftruncateSync(descriptor, 0);
          writeSync(descriptor, lateContent, 0, "utf8");
          fsyncSync(descriptor);
        }
      });
      expect(readFileSync(value.target, "utf8")).toBe(value.desired);
      expect(result.recoveryPath).not.toBeNull();
      expect(readFileSync(result.recoveryPath!, "utf8")).toBe(lateContent);
    } finally {
      closeSync(descriptor);
      rmSync(value.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("recovers a process interruption after each durable transition", () => {
    for (const transition of ["afterPrepared", "afterTargetGuarded", "afterTargetAdopted"] as const) {
      const value = fixture(transition);
      try {
        const hooks: FileAdoptionHooks = {
          [transition]: () => { throw new Error(`crash at ${transition}`); }
        };
        expect(() => adoptFileWithoutOverwrite(value.input, hooks)).toThrow(FileAdoptionError);
        const recovered = adoptFileWithoutOverwrite(value.input);
        expect(recovered.resultingDigest).toBe(value.input.desiredDigest);
        expect(readFileSync(value.target, "utf8")).toBe(value.desired);
        expect(recovered.recoveryPath).not.toBeNull();
        const reconciledAfterAppliedJournal = adoptFileWithoutOverwrite(value.input);
        expect(reconciledAfterAppliedJournal.recoveryPath).toBe(recovered.recoveryPath);
        const journals = readdirSync(recoveryDirectories(value.workspace)[0]!).filter((name) => name.includes("journal-"));
        expect(journals.some((name) => name.endsWith("-applied.json"))).toBe(true);
      } finally {
        rmSync(value.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    }
  });

  it("rejects an unsupported hard-link filesystem before moving the target", () => {
    const value = fixture("hardlink-preflight");
    try {
      expect(() => adoptFileWithoutOverwrite(value.input, {
        beforeHardLinkPreflight: () => { throw new Error("synthetic hard-link rejection"); }
      })).toThrow("cannot provide the no-clobber hard link");
      expect(readFileSync(value.target, "utf8")).toBe(value.original);
      for (const directory of recoveryDirectories(value.workspace)) {
        expect(readdirSync(directory).some((name) => name.endsWith(".original"))).toBe(false);
      }
    } finally {
      rmSync(value.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("restores a guarded concurrent edit only by linking into an absent target", () => {
    const value = fixture("guarded-change");
    const userContent = "# Rules\n\n- User changed the guarded inode.\n";
    try {
      let failure: unknown;
      try {
        adoptFileWithoutOverwrite(value.input, {
          afterTargetGuarded: (journal) => { writeFileSync(journal.recovery_path, userContent, "utf8"); }
        });
      } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(ConcurrentTargetChangeError);
      expect(existsSync(value.target)).toBe(true);
      expect(readFileSync(value.target, "utf8")).toBe(userContent);
      expect(readFileSync((failure as ConcurrentTargetChangeError).recoveryPath!, "utf8")).toBe(userContent);
    } finally {
      rmSync(value.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
