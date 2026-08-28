# Contributing

Runtime Evolution Workbench welcomes focused bug fixes, compatibility probes, security hardening, and improvements to the user-visible Run-to-change closure.

## Before opening a change

Open an issue for a new product surface or a change to the evidence model. Small fixes can go directly to a pull request. Do not include private Runs, repository content, credentials, session tokens, or generated worktrees in issues or commits.

## Local setup

Use Windows 11 and Node 22.x:

```powershell
$env:REW_NODE = 'C:\path\to\node-v22\node.exe'
.\scripts\Check.ps1 -InstallDependencies
```

The full check must pass. Add a regression case for behavior changes. UI changes should also be exercised at desktop and 390px mobile widths with zero console errors.

## Product invariants

- Observation gaps are data, not UI decoration.
- No hidden-reasoning claim.
- No Agent-accessible approve/publish authority.
- No capability-file write before objective comparison and human approval.
- No overwrite when the current file hash differs.
- Infrastructure failures remain distinct from task failures.
- The product stays loopback-only and local-first.
- Workflow Environment Factory may depend on RunCase Interchange, but it may not share this service, database, UI, or executor.

## Pull requests

Describe the user-visible problem, the evidence that reproduces it, the smallest change, and the exact checks run. Mark any result based on mocks or a single run. Maintainers may ask for a clean-environment probe when a change touches Hooks, Codex App Server, plugin installation, Git worktrees, publishing, rollback, or Windows process management.

By submitting a contribution, you agree that it is licensed under Apache-2.0 as described by the repository license and Apache-2.0 contribution terms.
