# Codex App Server compatibility snapshot

These aggregate JSON Schemas were generated from `codex-cli 0.150.0-alpha.8` with the App Server schema generator during the 0.1 compatibility probe:

- `schema/codex_app_server_protocol.schemas.json`
- `schema/codex_app_server_protocol.v2.schemas.json`

They are retained as review evidence for the adapter mapping and version boundary. The runtime does not treat this snapshot as a promise that later Codex versions are compatible; it probes the live App Server and fails managed/backfill operations explicitly while ordinary Hook capture remains usable.

Per-type generated files and TypeScript bindings are intentionally excluded because they are reproducible from the aggregates and add no independent evidence.

## Provenance and license

The two aggregate files were generated from OpenAI Codex `codex-cli 0.150.0-alpha.8` and are retained without manual schema edits. OpenAI Codex is Copyright 2025 OpenAI and licensed under the Apache License, Version 2.0. The upstream source is <https://github.com/openai/codex>; this repository's root `LICENSE` and `NOTICE` carry the redistribution terms and attribution.
