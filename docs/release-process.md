# Release process

A green build is not a Runtime Evolution Workbench release.

## Fixed release inputs

- RunCase Interchange: `v0.1.0`.
- Node.js: 22.23.2 in CI and release evidence; the product contract remains compatible with Node 22.x.
- Codex CLI used by the real App Server gate: `0.150.0-alpha.8`.
- The real gate uses the maintainer's existing local Codex authentication. No model credential is stored in GitHub.

`scripts/Check.ps1` also enforces that RunCase Interchange comes from the exact HTTPS GitHub Release asset with the expected SHA-512 lock integrity. A Git, SSH, mutable branch, or unpinned source fails the release.

## Pull-request gate

Windows CI runs the strict server/web build, 16 focused regression tests, plugin validation, installation data-root safety checks, and one synthetic UI golden scenario. The UI gate must retain three Runs, show an observation gap, import one standard Factory Case, fit the mobile viewport, and report no browser/page errors.

## Code-freeze gate

After every code and documentation change is committed, run:

```powershell
.\scripts\Prepare-ReleaseEvidence.ps1 -Version 0.1.0
```

The script repeats the full check and uses the local authenticated Codex to prove two different things. First, ordinary Hook ingestion survives independently and declares its App Server observation gap. Second, a disposable Git repository must complete the real product loop: reproduce one objective failure, pass a distinct protection Run, create an evidence-backed Issue and one-file `AGENTS.md` proposal, execute the four real App Server comparison cells, obtain the `fail/pass/pass/pass` verifier matrix, approve and publish, preserve a later user edit as a rollback conflict, then restore the exact original. All six managed Runs must retain live structured events and explicit reasoning exclusion. The disposable checkout defaults to a `_tmp` directory beside the repository parent so Windows sandbox ACLs are tested on the same volume; `REW_RELEASE_GATE_ROOT` may select another dedicated scratch root. A failed seed stops before the four comparison Runs. Any missing condition fails, and temporary Run/repository data is deleted after the probe.

The sanitized JSON includes product, Node, Codex, and tested commit versions, but no local path, prompt history, credential, or repository content. Review it and commit only `release-evidence/runtime-product-gate-0.1.0.json`.

The archive embeds `release-source.json`, so its installation lifecycle can identify the reviewed commit even after extraction without a `.git` directory. The tag workflow independently runs the isolated Windows installation lifecycle and publishes `runtime-installation-evidence.json` beside the archive. That file is bound to the tag commit, but it does not replace the authenticated real-Run evidence above.

## Tag gate

The tag workflow verifies that:

1. the evidence names the expected product and version;
2. every real gate condition passed with the supported Codex version;
3. the tested commit is an ancestor of the tag;
4. the evidence file is the only change after the tested commit;
5. the evidence uses `product.runtime-evolution-gate.v2` and proves the complete failure-to-safe-rollback closure rather than an exact-response smoke test.

It then repeats offline checks and the UI gate, creates a Windows archive containing reviewed source plus compiled server/UI, verifies required files, emits a commit-bound manifest and SHA-256, attaches build provenance, and publishes the GitHub Release.

Fresh Windows installation, user-visible UI review, uninstall, and no-residue evidence remain the final stable-release gate. The authenticated code-freeze evidence proves the same core closure through the product services; it does not substitute for clean-machine installation or human UI acceptance.
