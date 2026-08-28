param(
  [switch]$InstallDependencies
)

. (Join-Path $PSScriptRoot "Common.ps1")

& (Join-Path $PSScriptRoot "Build.ps1") -InstallDependencies:$InstallDependencies
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

$node = Resolve-RewNode
$vitest = Join-Path $script:RewRoot "node_modules\vitest\vitest.mjs"
$pluginValidator = Join-Path $PSScriptRoot "validate-plugin.mjs"
$releaseDependencyValidator = Join-Path $PSScriptRoot "validate-release-dependencies.mjs"
$productGateProbe = Join-Path $script:RewRoot "spikes\product-gate-probe.mjs"

Push-Location $script:RewRoot
try {
  & $node $vitest run
  if ($LASTEXITCODE -ne 0) { throw "Test suite failed." }
  & $node $pluginValidator
  if ($LASTEXITCODE -ne 0) { throw "Plugin validation failed." }
  & $node $releaseDependencyValidator
  if ($LASTEXITCODE -ne 0) { throw "Release dependency validation failed." }
  & $node --check $productGateProbe
  if ($LASTEXITCODE -ne 0) { throw "Product-gate probe syntax validation failed." }
} finally {
  Pop-Location
}

Write-Host "Runtime Evolution Workbench release checks passed."
