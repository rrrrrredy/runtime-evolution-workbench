param(
  [switch]$InstallDependencies
)

. (Join-Path $PSScriptRoot "Common.ps1")

& (Join-Path $PSScriptRoot "Build.ps1") -InstallDependencies:$InstallDependencies
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

$node = Resolve-RewNode
$vitest = Join-Path $script:RewRoot "node_modules\vitest\vitest.mjs"
$pluginValidator = Join-Path $PSScriptRoot "validate-plugin.mjs"

Push-Location $script:RewRoot
try {
  & $node $vitest run
  if ($LASTEXITCODE -ne 0) { throw "Test suite failed." }
  & $node $pluginValidator
  if ($LASTEXITCODE -ne 0) { throw "Plugin validation failed." }
} finally {
  Pop-Location
}

Write-Host "Runtime Evolution Workbench release checks passed."
