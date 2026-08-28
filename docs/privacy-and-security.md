# Privacy and security model

Runtime Evolution Workbench is local-first, not magically risk-free. It stores the evidence needed to diagnose Agent work, which can include repository paths, prompts, commands, diffs, and artifact references. Use the controls below as a data-handling boundary, not as a guarantee that sensitive source code can never appear.

## Data locations

The default root is `%LOCALAPPDATA%\RuntimeEvolutionWorkbench`:

- `workbench.sqlite3` stores structured metadata;
- `content/` stores SHA-256-addressed diagnostic content;
- `spool/pending/` stores atomic Hook envelopes waiting for ingestion;
- `spool/archive/` stores ingested envelopes;
- `spool/rejected/` stores invalid envelopes for local inspection;
- `experiments/` contains transient detached Git worktrees;
- `logs/` contains service stdout/stderr;
- `session-token` protects the local API.

No product telemetry or cloud sync exists in 0.1.

## Capture and redaction

The Hook process applies redaction before writing its atomic spool file. The service applies redaction again before durable storage. Current deterministic rules cover secret-like field names, bearer tokens, OpenAI-style API keys, GitHub tokens, private-key blocks, and oversized strings.

Redaction is intentionally reported in retained metadata. It is not a full data-loss-prevention system: an uncommon secret format inside an ordinary field can evade a pattern. Do not put production credentials in prompts, verifier arguments, repository fixtures, or capability files.

Hidden reasoning is not captured. When an App Server item contains reasoning material, its content is excluded and an observation gap records the exclusion.

## Local API

The service hard-rejects any host other than `127.0.0.1`. A 256-bit random token is created locally. Every `/api/` route requires the token either as a bearer credential or an HttpOnly, SameSite=Strict browser cookie. The health endpoint is intentionally public on loopback and reveals only product/version health.

Loopback binding protects against network access, not every process running as the same Windows user. Treat malware or another compromised local process as outside the 0.1 threat model.

## Agent and MCP authority

The plugin's MCP server can list/export Runs, save corrections, create evidence-backed Issues, create bounded proposals, and request stored-thread backfill. It cannot approve, publish, or roll back capability files. Those actions remain authenticated human UI/API actions.

Product-managed Codex Runs reject approval requests from the App Server client rather than silently granting extra command or file authority.

## Comparison execution

Each comparison creates four detached Git worktrees beneath the product data directory. Codex runs with `workspace-write` inside each worktree. The user-supplied verifier command is invoked directly with `shell: false`, but it still runs as the current Windows user and can execute repository code. Only use trusted repositories and verifier commands.

An Agent timeout, crash, verifier timeout/error, and worktree cleanup error remain separate infrastructure evidence. Startup recovery marks interrupted comparisons inconclusive and attempts to remove only the worktrees derived from the interrupted comparison IDs.

## Publishing and rollback

A proposal is limited to one repository-relative `AGENTS.md` or `SKILL.md`. The product stores the original and candidate SHA-256 digests. Publishing requires a supported comparison, explicit approval, and a current file hash matching the original. Rollback requires the current hash to match the published candidate. A mismatch creates a conflict with the current content retained; it never overwrites later user edits.

## Reporting vulnerabilities

Do not open a public issue containing a credential, exploit, or private Run. Follow [SECURITY.md](../SECURITY.md).
