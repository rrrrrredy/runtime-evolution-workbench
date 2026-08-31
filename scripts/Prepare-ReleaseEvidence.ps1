param(
  [string]$Version = "0.2.0",
  [string]$EvidenceDirectory = ""
)

. (Join-Path $PSScriptRoot "Common.ps1")

Push-Location $script:RewRoot
try {
  $status = (git status --porcelain=v1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "The checkout is not a Git repository." }
  if ($status.Length -gt 0) { throw "Commit or remove every change before running the real release gate." }
  $package = Get-Content -LiteralPath (Join-Path $script:RewRoot "package.json") -Raw | ConvertFrom-Json
  if ($package.version -ne $Version) { throw "Requested version $Version does not match package.json." }

  & (Join-Path $PSScriptRoot "Check.ps1") -InstallDependencies
  if ($LASTEXITCODE -ne 0) { throw "Release checks failed." }

  $outputRoot = if ([string]::IsNullOrWhiteSpace($EvidenceDirectory)) {
    Join-Path $script:RewRoot "release-evidence"
  } else {
    [System.IO.Path]::GetFullPath($EvidenceDirectory)
  }
  New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
  $evidencePath = Join-Path $outputRoot "runtime-product-gate-$Version.json"
  if (Test-Path -LiteralPath $evidencePath -PathType Leaf) { Remove-Item -LiteralPath $evidencePath -Force }

  $configuredGateRoot = [Environment]::GetEnvironmentVariable("REW_RELEASE_GATE_ROOT", "Process")
  $gateRoot = if ([string]::IsNullOrWhiteSpace($configuredGateRoot)) {
    Join-Path (Split-Path $script:RewRoot -Parent) "_tmp"
  } else {
    [System.IO.Path]::GetFullPath($configuredGateRoot)
  }
  New-Item -ItemType Directory -Path $gateRoot -Force | Out-Null
  $resolvedGateRoot = (Resolve-Path -LiteralPath $gateRoot).Path
  $gateData = Join-Path $resolvedGateRoot "rew-release-gate-$([Guid]::NewGuid().ToString('N'))"
  $previousData = [Environment]::GetEnvironmentVariable("REW_GATE_DATA_DIR", "Process")
  $previousOutput = [Environment]::GetEnvironmentVariable("REW_GATE_OUTPUT", "Process")
  try {
    [Environment]::SetEnvironmentVariable("REW_GATE_DATA_DIR", $gateData, "Process")
    [Environment]::SetEnvironmentVariable("REW_GATE_OUTPUT", $evidencePath, "Process")
    $node = Resolve-RewNode
    & $node (Join-Path $script:RewRoot "spikes\product-gate-probe.mjs")
    if ($LASTEXITCODE -ne 0) { throw "Real Hook/App Server evolution-closure gate failed." }
  } finally {
    [Environment]::SetEnvironmentVariable("REW_GATE_DATA_DIR", $previousData, "Process")
    [Environment]::SetEnvironmentVariable("REW_GATE_OUTPUT", $previousOutput, "Process")
    if (Test-Path -LiteralPath $gateData -PathType Container) {
      $resolvedGateData = (Resolve-Path -LiteralPath $gateData).Path
      $expectedPrefix = Join-Path $resolvedGateRoot "rew-release-gate-"
      if (-not $resolvedGateData.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe release-gate cleanup target: $resolvedGateData"
      }
      Remove-Item -LiteralPath $resolvedGateData -Recurse -Force
    }
  }

  $evidence = Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
  $head = (git rev-parse HEAD | Out-String).Trim()
  if ($evidence.testedCommit -ne $head) { throw "Product-gate evidence does not match the current commit." }
  Write-Host "Real product-gate evidence: $evidencePath"
  Write-Host "Tested commit: $head"
  Write-Host "Review and commit only this evidence file before tagging v$Version."
} finally {
  Pop-Location
}
