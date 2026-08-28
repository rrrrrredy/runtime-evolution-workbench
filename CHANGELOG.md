# Changelog

All notable changes are recorded here. The project follows semantic versioning after 1.0; preview releases may make documented storage and integration changes.

## [Unreleased]

- The exact RunCase Interchange SHA-512 lock now matches the reproducible `v0.1.0` asset built from the public prerelease candidate.
- GitHub tag releases now require curated, version-matched adoption notes and are labeled prereleases so the public release surface matches the product's technical-preview status.
- Installation is now transactional across the product-created data root, plugin, marketplace, Startup shortcut, service startup, and failed `-Repair`; the clean-Windows gate injects real port conflicts and requires restoration plus a machine-readable zero-residue audit.
- Every entry point now creates only a previously nonexistent data directory or reuses one with a valid product ownership marker; it rejects existing unmarked directories, wrong-product markers, reparse points, and protected roots.
- The isolated Windows install/start/preserve/reinstall/delete/uninstall lifecycle gate is implemented; fresh hosted-Windows and full golden-closure evidence remain pending.
- Public release packaging and compatibility matrix pending.
- Read-only RunCase Interchange library for validated, redacted, idempotent Run/Case/Score imports.
- Windows comparison cleanup now waits for child-process pipes to close and normalizes 8.3 repository paths.
- Windows CI blocks on one asserted UI golden scenario; tag releases require commit-bound local Hook/App Server evidence without storing model credentials in GitHub.
- Installer and uninstaller now distinguish an installed plugin from an available marketplace entry, remove the marketplace format emitted by Codex 0.150 correctly, and carry custom port/data settings into service and Startup launches.
- Release artifacts now include a tag-bound clean-install evidence record, and the deprecated `@types/diff` stub is no longer installed.

## [0.1.0] - 2026-08-28

### Added

- Local Hook spool with pre-spool and pre-storage redaction.
- Observed Run retention and lossy Codex stored-thread backfill with explicit gaps.
- Product-managed Codex Runs through direct App Server stdio.
- Runs, Issues, and Evolution Lab web surfaces.
- Evidence-backed one-file AGENTS.md/SKILL.md proposals.
- Four-cell isolated baseline/candidate comparison with objective verifiers.
- Human-only approval, hash-safe publication, and conflict-safe rollback.
- `agent.run.v1` export through RunCase Interchange.
- Loopback-only API, random session token, MCP authority boundary, and startup recovery.
- Reversible Windows build, start, stop, install, and uninstall scripts.
