# Installation and removal

## Supported preview environment

Version 0.1 targets Windows 11, Node 22.x, Git, PowerShell, and a Codex installation that provides the plugin CLI and App Server used by this release. Node 20 cannot run the product because the local store uses Node 22's built-in SQLite API.

Run installation and the long-lived workbench service from a normal Windows Terminal or PowerShell session. A service launched from inside an already sandboxed Codex command inherits an outer OS permission boundary that a nested App Server cannot repair; observed Run capture still works, but managed comparisons will fail their no-model workspace preflight instead of silently broadening access.

## Install from a checkout

```powershell
git clone https://github.com/rrrrrredy/runtime-evolution-workbench.git
Set-Location runtime-evolution-workbench
.\scripts\Install.ps1 -Open
```

The script fails before changing Codex state if Node is not 22.x or release checks fail. On success it:

1. runs `npm ci`, strict TypeScript builds, the production web build, regression tests, and plugin validation;
2. adds the repository as the `runtime-evolution-workbench` Codex marketplace;
3. installs `runtime-evolution-workbench@runtime-evolution-workbench` into Codex's plugin cache/configuration;
4. starts the local service on `127.0.0.1:43119`;
5. creates local state under `%LOCALAPPDATA%\RuntimeEvolutionWorkbench`.

It does not enable Windows startup unless `-EnableStartup` is supplied. It does not upload Run data or install a system-wide Windows service.

Restart Codex so the new Hooks, MCP tools, and Skill are loaded.

## Installer options

```powershell
.\scripts\Install.ps1 -EnableStartup -Open
.\scripts\Install.ps1 -NoStart
.\scripts\Install.ps1 -Repair
.\scripts\Install.ps1 -Port 53119 -DataDir D:\AgentData\RuntimeWorkbench
```

- `-EnableStartup` adds one current-user shortcut named `Runtime Evolution Workbench.lnk` to the Windows Startup folder.
- `-Open` opens the authenticated local session URL after the service is healthy.
- `-NoStart` installs the plugin but does not launch the service.
- `-Repair` removes and re-adds only this product's existing plugin and marketplace registration before installing. If a later step fails, the previous registration and Startup shortcut are restored.
- `-Port` and `-DataDir` are forwarded to the first service start and the optional Startup shortcut. A custom data path must either not exist yet or already carry this product's ownership marker; existing unmarked directories are rejected even when empty. When either value is customized, launch Codex with matching `REW_PORT` and `REW_DATA_DIR` values so Hooks and MCP tools use the same local instance.

Set `REW_NODE` to an exact Node 22 executable when more than one Node version is installed. Set `REW_DATA_DIR` or pass `-DataDir` to the start/stop scripts to relocate local data. The Hooks and MCP process must receive the same `REW_DATA_DIR` and `REW_PORT` values as the service.

## Start and stop

```powershell
.\scripts\Start.ps1 -Open
.\scripts\Stop.ps1
```

The background launcher writes a PID file and separate stdout/stderr logs in the product data directory. Stop verifies both the PID and command line before terminating anything; it refuses to guess when the PID file is absent.

For foreground diagnostics:

```powershell
.\scripts\Start.ps1 -Foreground
```

## Upgrade

Stop the service, update the checkout, then repair:

```powershell
.\scripts\Stop.ps1
git pull --ff-only
.\scripts\Install.ps1 -Repair -Open
```

Back up `%LOCALAPPDATA%\RuntimeEvolutionWorkbench` before a preview upgrade. Schema migrations will be documented in the changelog; 0.1 does not promise downgrade compatibility.

## Offline behavior

After dependencies and the plugin are installed, Run capture, local UI, SQLite/content storage, export, file proposal review, publishing, rollback, and verifiers can work offline. Codex-managed Runs still depend on whatever model access the user's Codex configuration requires. A source install needs network access for `npm ci` unless the npm cache is already complete.

## Uninstall

```powershell
.\scripts\Uninstall.ps1
```

The script stops this checkout's service, removes its optional Startup shortcut, removes its Codex plugin, and removes its marketplace source. It preserves the checkout and all Run data.

Permanent data removal is separate and explicit:

```powershell
.\scripts\Uninstall.ps1 -DeleteData
```

Verify the final machine state without changing it:

```powershell
.\scripts\Inspect-Installation.ps1 -RequireAbsent
.\scripts\Inspect-Installation.ps1 -RequireAbsent -RequireNoData
```

The first command permits the data preserved by the default uninstall. The second is the strict zero-data check after an explicit `-DeleteData` uninstall. Both fail when Codex plugin/marketplace state cannot be inspected instead of claiming success from missing evidence.

The script deletes only a real directory carrying a valid Runtime Evolution Workbench ownership marker. It also rejects files, reparse points, a drive root, user profile, Documents, Local AppData root, or another suspiciously broad path. `-DeleteData` is not recoverable by the product. Export important Runs first.

Release CI also executes `scripts\Acceptance-InstallUninstall.ps1` in an isolated Codex home. It occupies the service port to prove a failed first install removes every newly created product state, then repeats the fault during `-Repair` and requires the prior plugin, marketplace, Startup shortcut, and data to survive byte-for-byte where applicable. It then proves real registration, a loopback service, data preservation, reinstall, ownership-marked explicit deletion, and machine-audited zero product registration after removal. This lifecycle gate does not replace the authenticated Codex Run evidence described in the release process.
