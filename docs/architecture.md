# Architecture boundaries

## Product process

```text
Codex hooks ──> local spool ──> ingestion ──> SQLite + content store
                                      └──> Runs / Issues API

Workbench ──> App Server adapter ──> stored-thread backfill
                                └──> managed comparison turns

Evolution Lab ──> isolated Git worktrees ──> objective verifier
              └──> hash-safe publish / three-way rollback
```

The plugin is a distribution and capture edge. The local service is the product.

## Trust boundaries

- The service listens only on loopback and requires a random bearer/cookie token.
- Hook and App Server payloads are redacted before durable storage.
- Reasoning items are not persisted; an omission marker preserves the observation boundary.
- User-selected excluded paths are never read into the content store.
- Managed runs use isolated worktrees, fixed inputs, and an explicit sandbox.
- Publishing and rollback compare SHA-256 hashes before writing.

## Codex 0.150.0-alpha.8 findings

- Direct stdio App Server works on Windows.
- Managed Runs canonicalize the requested checkout, declare it as the only runtime workspace root, repeat that exact root in the turn-level offline `workspaceWrite` policy, and run a sandboxed no-model write preflight before spending a model turn.
- Managed daemon lifecycle commands report Unix-only support on Windows.
- `thread/list` and `thread/read` can access stored ordinary sessions through a new App Server process.
- Stored thread/turn items are documented as lossy; live managed capture remains the stronger evidence source.
- Generated protocol contracts are versioned under `vendor/codex-app-server/0.150.0-alpha.8/schema`.
