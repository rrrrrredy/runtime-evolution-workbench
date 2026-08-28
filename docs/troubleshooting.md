# Troubleshooting

## “requires Node 22.x”

Check the executable selected by the scripts:

```powershell
node -p "process.execPath + ' ' + process.versions.node"
```

When several versions exist, set an exact path:

```powershell
$env:REW_NODE = 'D:\tools\node-v22\node.exe'
```

The scripts invoke TypeScript, Vite, Vitest, and npm through that executable to avoid silently falling back to another Node on `PATH`.

## The plugin is installed but no new Runs appear

Restart Codex after plugin installation. Confirm the plugin selector appears in `codex plugin list`. Then inspect `spool\pending` under the configured data directory. Hook capture does not require the service to be running; the service ingests pending envelopes when started or when ingestion is requested.

If the plugin is absent, run `.\scripts\Install.ps1 -Repair`. If a custom `REW_DATA_DIR` was used, ensure Codex, the MCP process, and the service inherit the same value.

## MCP tools report the workbench is unavailable

Start the service:

```powershell
.\scripts\Start.ps1 -Open
```

Confirm `http://127.0.0.1:43119/health` returns product `runtime-evolution-workbench`. A custom `REW_PORT` must match for both service and plugin processes.

## Port 43119 is in use

Choose another unprivileged port and use it consistently:

```powershell
$env:REW_PORT = '43129'
.\scripts\Start.ps1 -Port 43129 -Open
```

Do not stop an unknown process merely because it owns the port. The bundled stop script refuses to act without a matching PID and command line.

## Stored Thread backfill fails

Run `codex app-server --help` and confirm Codex itself starts. Backfill depends on the installed Codex App Server protocol and is explicitly version-probed. Ordinary Hook capture and retained Runs remain usable when App Server is unavailable.

## A comparison is inconclusive

Inspect all four cells. An absent objective result, Codex timeout/crash, verifier error/timeout, or cleanup failure prevents an improvement claim. Fix the infrastructure or verifier and create a new comparison; do not reinterpret an infrastructure failure as a task failure.

## Publish or rollback reports a conflict

The target file changed after the proposal or publish event. This is a safety outcome. Review the retained original/candidate/current content and merge manually. The product will not overwrite the later edit.

## Service stopped unexpectedly

Restart it. Any Run still marked running becomes `infrastructure_error` with a startup-recovery observation gap. Any running comparison becomes inconclusive, its proposal returns to ready, and registered experiment worktrees are cleaned up on a best-effort basis. Check `logs\service.stderr.log` for the original failure.
