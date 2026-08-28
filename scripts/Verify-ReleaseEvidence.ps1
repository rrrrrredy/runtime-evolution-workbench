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
  if ($evidence.schemaVersion -ne "product.runtime-evolution-gate.v2") {
    throw "Release evidence does not use the required evolution-gate schema."
  }
  if ([string]$evidence.testedCommit -notmatch '^[0-9a-f]{40}$') {
    throw "Release evidence has an invalid testedCommit."
  }
  $required = @(
    [bool]$evidence.observed.retained,
    ([int]$evidence.observed.ingestedFiles -ge 3),
    ([int]$evidence.observed.eventCount -ge 3),
    [bool]$evidence.observed.hasAppServerGap,
    (-not [bool]$evidence.storedBackfill.available -or [bool]$evidence.storedBackfill.mappingLossDeclared),
    [bool]$evidence.managed.sourceWorkspacePreflight,
    ([int]$evidence.managed.runCount -eq 6),
    [bool]$evidence.managed.allCompleted,
    ([int]$evidence.managed.minimumEventCount -ge 2),
    [bool]$evidence.managed.allHaveLiveStructuredEvents,
    [bool]$evidence.managed.allDeclareReasoningExclusion,
    [bool]$evidence.evolution.initialFailureCompleted,
    ($evidence.evolution.initialFailureVerifier -eq "fail"),
    [bool]$evidence.evolution.protectionCompleted,
    ($evidence.evolution.protectionVerifier -eq "pass"),
    ($evidence.evolution.issueCategory -eq "instruction"),
    ([int]$evidence.evolution.issueEvidenceCount -ge 2),
    ($evidence.evolution.correctionKind -eq "instruction"),
    [bool]$evidence.evolution.correctionRetained,
    [bool]$evidence.evolution.distinctEvidenceRuns,
    ($evidence.evolution.proposalTarget -eq "AGENTS.md"),
    [bool]$evidence.evolution.proposalDiffPresent,
    ($evidence.evolution.comparisonStatus -eq "completed"),
    ($evidence.evolution.comparisonConclusion -eq "candidate_supported"),
    ([int]$evidence.evolution.comparisonCells -eq 4),
    ($evidence.evolution.failureBaseline -eq "fail"),
    ($evidence.evolution.failureCandidate -eq "pass"),
    ($evidence.evolution.protectionBaseline -eq "pass"),
    ($evidence.evolution.protectionCandidate -eq "pass"),
    [bool]$evidence.evolution.singleRunEvidence,
    [bool]$evidence.evolution.allCellsHaveRunIds,
    [bool]$evidence.evolution.noInfrastructureErrors,
    ($evidence.evolution.approvalStatus -eq "approved"),
    [bool]$evidence.evolution.publishApplied,
    [bool]$evidence.evolution.rollbackConflict,
    [bool]$evidence.evolution.conflictPreserved,
    [bool]$evidence.evolution.rollbackApplied,
    [bool]$evidence.evolution.originalRestored,
    ($evidence.evolution.finalProposalStatus -eq "rolled_back"),
    [bool]$evidence.evolution.sourceRepositoryClean,
    [bool]$evidence.evolution.worktreesRemoved
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
