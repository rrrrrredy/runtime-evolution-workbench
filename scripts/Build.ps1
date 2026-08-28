param(
  [switch]$InstallDependencies
)

. (Join-Path $PSScriptRoot "Common.ps1")

$node = Resolve-RewNode
if ($InstallDependencies -or -not (Test-Path -LiteralPath (Join-Path $script:RewRoot "node_modules") -PathType Container)) {
  Push-Location $script:RewRoot
  try { Invoke-RewNpm @("ci") } finally { Pop-Location }
}

$typescript = Join-Path $script:RewRoot "node_modules\typescript\bin\tsc"
$vite = Join-Path $script:RewRoot "node_modules\vite\bin\vite.js"
foreach ($required in @($typescript, $vite)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Dependency missing: $required. Run scripts\Build.ps1 -InstallDependencies."
  }
}

Push-Location $script:RewRoot
try {
  & $node $typescript -p tsconfig.server.json
  if ($LASTEXITCODE -ne 0) { throw "Server TypeScript build failed." }
  & $node $typescript -p tsconfig.web.json --noEmit
  if ($LASTEXITCODE -ne 0) { throw "Web TypeScript check failed." }
  & $node $vite build
  if ($LASTEXITCODE -ne 0) { throw "Web production build failed." }
} finally {
  Pop-Location
}

Write-Host "Runtime Evolution Workbench build passed with $(& $node -p 'process.versions.node')."
