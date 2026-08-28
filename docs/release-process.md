# Release process

A green build is not a Runtime Evolution Workbench release.

## Fixed release inputs

- Agent Run Protocol: `v0.1.0`.
- Node.js: 22.x.
- Codex CLI used by the real App Server gate: `0.150.0-alpha.8`.
- The real gate uses the maintainer's existing local Codex authentication. No model credential is stored in GitHub.

## Pull-request gate

Windows CI runs the strict server/web build, 11 focused regression tests, plugin validation, and one synthetic UI golden scenario. The UI gate must retain three Runs, show an observation gap, import one standard Factory Case, fit the mobile viewport, and report no browser/page errors.

## Code-freeze gate

After every code and documentation change is committed, run:

```powershell
.\scripts\Prepare-ReleaseEvidence.ps1 -Version 0.1.0
```

The script repeats the full check and uses the local authenticated Codex to prove ordinary Hook ingestion, explicit ordinary-Run gaps, stored-thread mapping loss when available, a real managed App Server turn, live structured events, and reasoning exclusion. Any missing condition fails. Temporary Run data is deleted after the probe.

The sanitized JSON includes product, Node, Codex, and tested commit versions, but no local path, prompt history, credential, or repository content. Review it and commit only `release-evidence/runtime-product-gate-0.1.0.json`.

## Tag gate

The tag workflow verifies that:

1. the evidence names the expected product and version;
2. every real gate condition passed with the supported Codex version;
3. the tested commit is an ancestor of the tag;
4. the evidence file is the only change after the tested commit.

It then repeats offline checks and the UI gate, creates a Windows archive containing reviewed source plus compiled server/UI, verifies required files, emits a commit-bound manifest and SHA-256, attaches build provenance, and publishes the GitHub Release.

Fresh Windows installation, a real failure→proposal→four-cell comparison→publish→rollback closure, uninstall, and no-residue evidence remain the final stable-release gate.
