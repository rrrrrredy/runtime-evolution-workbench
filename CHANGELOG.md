# Changelog

All notable changes are recorded here. The project follows semantic versioning after 1.0; preview releases may make documented storage and integration changes.

## [Unreleased]

- Isolated Windows install/start/preserve/reinstall/delete/uninstall lifecycle now passes locally; fresh hosted-Windows and full golden-closure evidence remain pending.
- Public release packaging and compatibility matrix pending.
- Read-only Agent Run Protocol library for validated, redacted, idempotent Run/Case/Score imports.
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
- `agent.run.v1` export through Agent Run Protocol.
- Loopback-only API, random session token, MCP authority boundary, and startup recovery.
- Reversible Windows build, start, stop, install, and uninstall scripts.
