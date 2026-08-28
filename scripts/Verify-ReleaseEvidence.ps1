param(
  [string]$Version = "0.1.0"
)

. (Join-Path $PSScriptRoot "Common.ps1")

Push-Location $script:RewRoot
try {
  $relativeEvidence = "release-evidence/runtime-product-gate-$Version.json"
  $evidencePath = Join-Path $script:RewRoot $relativeEvidence
  if (-not (Test-Path -LiteralPath $evidencePath -PathType Leaf)) {
    throw "Release evidence is missing: $relativeEvidence"
  }
  $evidence = Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
  if ($evidence.product -ne "runtime-evolution-workbench" -or $evidence.version -ne $Version) {
    throw "Release evidence names the wrong product or version."
  }
  if ([string]$evidence.testedCommit -notmatch '^[0-9a-f]{40}$') {
    throw "Release evidence has an invalid testedCommit."
  }
  $required = @(
    [bool]$evidence.observed.retained,
    ([int]$evidence.observed.ingestedFiles -ge 3),
    [bool]$evidence.observed.hasAppServerGap,
    [bool]$evidence.managed.completed,
    [bool]$evidence.managed.exactResponse,
    [bool]$evidence.managed.liveStructuredEvents,
    [bool]$evidence.managed.reasoningExclusionDeclared
  )
  if ($required -contains $false) { throw "Release evidence does not satisfy every real product-gate condition." }
  if ([string]$evidence.codexVersion -notmatch '0\.150\.0-alpha\.8') {
    throw "Release evidence was not produced with the supported Codex 0.150.0-alpha.8 gate."
  }

  git cat-file -e "$($evidence.testedCommit)^{commit}"
  if ($LASTEXITCODE -ne 0) { throw "The tested commit is not present in this checkout." }
  git merge-base --is-ancestor $evidence.testedCommit HEAD
  if ($LASTEXITCODE -ne 0) { throw "The tested commit is not an ancestor of the release tag." }
  $changed = @(git diff --name-only "$($evidence.testedCommit)..HEAD" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  $unexpected = @($changed | Where-Object { $_ -ne $relativeEvidence })
  if ($changed.Count -ne 1 -or $unexpected.Count -gt 0) {
    throw "Only $relativeEvidence may change after the real product gate. Re-run the gate on the current code."
  }
  Write-Host "Release evidence verified for v$Version at tested commit $($evidence.testedCommit)."
} finally {
  Pop-Location
}
