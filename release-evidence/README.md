# Release evidence

`runtime-product-gate-<version>.json` is created only by `scripts/Prepare-ReleaseEvidence.ps1` from a clean, committed checkout with an authenticated local Codex installation.

The file is intentionally small and sanitized. It records the tested commit, tool versions, ordinary Hook retention, and pass/fail facts for the real failure-to-safe-rollback closure. It must not contain prompts, local paths, repository contents, credentials, or hidden reasoning.

The absence of a versioned JSON file means the authenticated code-freeze gate has not passed for that version. Unit tests, synthetic UI checks, and installation-lifecycle CI do not replace it.
