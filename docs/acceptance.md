# Release acceptance

Passing a build is not product acceptance. Version 0.1 may be labeled stable only after the following is reproduced on a fresh Windows 11 environment and the evidence is attached to the release.

## Golden closure

1. Install from the public repository and restart Codex.
2. Produce one real Codex failure in a disposable Git repository with an `AGENTS.md` or one Skill.
3. Confirm the ordinary Run, result, correction, structured events, and at least one explicit observation boundary are retained locally.
4. Create an evidence-backed Issue and a one-file proposal using that failure Run and a distinct protection Run.
5. Run the failure and protection cases once against baseline and candidate in four isolated worktrees.
6. Confirm the objective verifier matrix supports the candidate while the UI still labels it single-run evidence.
7. Approve and publish manually. Verify the exact target diff and digest.
8. Roll back successfully while the candidate is unchanged.
9. Publish again, edit the target outside the product, and confirm rollback produces a conflict without overwriting the edit.
10. Export the Run as a valid `agent.run.v1` document and validate it with RunCase Interchange.
11. Import one Factory `workflow.case.v1` and its `workflow.score.v1`; confirm both remain read-only, survive restart, and do not require the Factory service.

## Necessary failures

- Delete or delay one Hook envelope and confirm a missing/out-of-order gap remains visible.
- Make App Server unavailable and confirm ordinary retained Runs remain usable while backfill/managed actions fail explicitly.
- Stop the service during a Run/comparison and confirm startup recovery marks evidence incomplete/inconclusive.
- Put representative bearer/API/GitHub/private-key values in Hook fixtures and confirm pre-spool and pre-storage redaction.
- Force a Codex timeout and a verifier timeout; confirm they are not labeled task failures.
- Force Git worktree cleanup failure; confirm infrastructure status and cleanup evidence.
- Modify the target capability file between proposal, publish, and rollback; confirm hash-safe conflict behavior.
- Simulate an atomic-save editor after the target is guarded, a late write through the old file handle, and process interruption after journal, guard, and adoption transitions; confirm no bytes are replaced and the recovery path remains visible.
- Reject publication before moving the target when the filesystem cannot create a no-clobber hard link.

## Installation and removal

- Verify the installer reports every state change and the product binds only to loopback.
- Verify restart/startup behavior with and without `-EnableStartup`.
- Uninstall and confirm the plugin, marketplace entry, Startup shortcut, and service process are absent.
- Confirm Run data is preserved by default and removed only with an explicit, path-safe `-DeleteData` run.
- Occupy the configured port before a first install and a later `-Repair`; confirm the first leaves no new product state and the second restores the prior plugin, marketplace, Startup shortcut, and data.
- Require the machine-readable installation-state audit to pass after normal removal and again with no data after explicit deletion.
- Confirm neither Workflow Environment Factory nor RunCase Interchange must be running for the product to work.

The repeatable clean-user lifecycle portion is encoded in `scripts\Acceptance-InstallUninstall.ps1` and runs on a fresh GitHub-hosted Windows VM. The authenticated code-freeze gate executes the real failure-to-safe-evolution service closure with six real Codex Runs. Human review of the three UI surfaces and clean-machine installation remain separate acceptance evidence; neither result substitutes for the other.

`scripts/Acceptance-Portable.sh` repeats the plugin/service/preservation/removal lifecycle on GitHub-hosted Ubuntu and macOS with isolated Codex and product homes. It proves source/archive lifecycle compatibility only. It does not authenticate a model, exercise a physical Mac, or replace the real failure-to-evolution product gate.

Record the OS, Codex version, Node version, commit, commands, objective verifier outputs, exported protocol documents, screenshots, known limitations, and uninstall evidence. Do not substitute mocks or unit tests for this clean-environment report.
