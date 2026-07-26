[CmdletBinding()]
param(
    [string]$ArchivePath = 'C:\Users\micha\Downloads\blender-3.6-splash.zip',
    [string]$ExtractedRoot = ''
)

$ErrorActionPreference = 'Stop'

$cellRoot = $PSScriptRoot
$repositoryRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $cellRoot '..\..')
)
$expectedPath = Join-Path $cellRoot 'output\archive-entry-hashes.json'
$inventoryPath = Join-Path $cellRoot 'output\source-inventory-blender-5.1.json'
$integrityPath = Join-Path $cellRoot 'output\load-integrity-blender-5.1.json'
$crashPath = Join-Path $cellRoot 'output\blender-5.2-load-crash.txt'
$planPath = Join-Path $cellRoot 'output\blendlink-plan-results.json'
$curveEvidencePath = Join-Path (
    [System.IO.Path]::GetFullPath((Join-Path $cellRoot '..'))
) 'legacy-curve-sidecar-differential\evidence.json'

if ([string]::IsNullOrWhiteSpace($ExtractedRoot)) {
    $ExtractedRoot = Join-Path $repositoryRoot (
        'artifacts\release-dogfood\next-corpus\sources\' +
        'blender-3.6-splash-official\blender-3.6-splash'
    )
}

$expected = Get-Content -Raw -LiteralPath $expectedPath | ConvertFrom-Json
$inventory = Get-Content -Raw -LiteralPath $inventoryPath | ConvertFrom-Json
$integrity = Get-Content -Raw -LiteralPath $integrityPath | ConvertFrom-Json
$plan = Get-Content -Raw -LiteralPath $planPath | ConvertFrom-Json
$curveEvidence = Get-Content -Raw -LiteralPath $curveEvidencePath | ConvertFrom-Json

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)]$Actual,
        [Parameter(Mandatory = $true)]$Expected,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if ($Actual -ne $Expected) {
        throw "$Label mismatch: expected '$Expected', received '$Actual'"
    }
}

$resolvedArchive = (Resolve-Path -LiteralPath $ArchivePath).Path
$resolvedExtractedRoot = (Resolve-Path -LiteralPath $ExtractedRoot).Path
$archive = Get-Item -LiteralPath $resolvedArchive
$archiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedArchive).Hash.ToLowerInvariant()

Assert-Equal $archive.Length ([int64]$expected.archive.bytes) 'archive byte length'
Assert-Equal $archiveHash ([string]$expected.archive.sha256) 'archive SHA-256'

$actualFiles = @(
    Get-ChildItem -LiteralPath $resolvedExtractedRoot -File -Recurse |
        ForEach-Object {
            $rootPrefix = $resolvedExtractedRoot.TrimEnd('\') + '\'
            if (-not $_.FullName.StartsWith(
                $rootPrefix,
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
                throw "Extracted file escaped the expected root: $($_.FullName)"
            }
            $relativePath = $_.FullName.Substring($rootPrefix.Length).Replace('\', '/')
            [pscustomobject]@{
                path = $relativePath
                bytes = $_.Length
                sha256 = (
                    Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName
                ).Hash.ToLowerInvariant()
            }
        } |
        Sort-Object path
)
$expectedFiles = @($expected.files | Sort-Object path)

Assert-Equal $actualFiles.Count ([int]$expected.fileCount) 'extracted file count'
Assert-Equal $actualFiles.Count $expectedFiles.Count 'recorded file count'

for ($index = 0; $index -lt $expectedFiles.Count; $index += 1) {
    $actualFile = $actualFiles[$index]
    $expectedFile = $expectedFiles[$index]
    Assert-Equal $actualFile.path ([string]$expectedFile.path) "entry path at index $index"
    Assert-Equal $actualFile.bytes ([int64]$expectedFile.bytes) "byte length for $($actualFile.path)"
    Assert-Equal $actualFile.sha256 ([string]$expectedFile.sha256) "SHA-256 for $($actualFile.path)"
}

$sourcePath = (Resolve-Path -LiteralPath $inventory.source.path).Path
$source = Get-Item -LiteralPath $sourcePath
$sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourcePath).Hash.ToLowerInvariant()
Assert-Equal $source.Length ([int64]$inventory.source.bytes) 'entry .blend byte length'
Assert-Equal $sourceHash ([string]$inventory.source.sha256) 'entry .blend SHA-256'

$existingLibraries = @($inventory.assets.linkedLibraries | Where-Object { $_.exists }).Count
$existingImages = @($inventory.assets.externalImages | Where-Object { $_.exists }).Count
Assert-Equal @($inventory.assets.linkedLibraries).Count 30 'linked-library record count'
Assert-Equal $existingLibraries 30 'resolved linked-library count'
Assert-Equal @($inventory.assets.externalImages).Count 24 'external-image record count'
Assert-Equal $existingImages 24 'resolved external-image count'

$crashHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $crashPath).Hash.ToLowerInvariant()
Assert-Equal $crashHash 'af6f94f363b45d510726d31585cfb140ce86162ea0e3f8a4e33191d7dfa406b6' (
    'Blender 5.2 crash transcript SHA-256'
)

$integrityHash = (
    Get-FileHash -Algorithm SHA256 -LiteralPath $integrityPath
).Hash.ToLowerInvariant()
Assert-Equal $integrityHash '9f0809ad51dbae82b41053a40a66002d14c4faae442d5d9052df44c2ca5480a6' (
    'Blender 5.1 load-integrity evidence SHA-256'
)
Assert-Equal $integrity.blender.version '5.1.2' 'load-integrity Blender version'
Assert-Equal $integrity.blender.buildHash 'ec6e62d40fa9' 'load-integrity Blender build'
Assert-Equal $integrity.blender.autoexecEnabled $false 'load-integrity auto-execution state'
Assert-Equal $integrity.linkedLibraries.total 30 'load-integrity library count'
Assert-Equal $integrity.linkedLibraries.resolved 30 'load-integrity resolved library count'
Assert-Equal @($integrity.missingIds).Count 2 'load-integrity missing ID count'
Assert-Equal @($integrity.registeredScripts).Count 7 'registered auto-run script count'
Assert-Equal @($integrity.curves.sidecarMeshAssumptionFailures).Count 5 (
    'sidecar mesh-assumption failure count'
)

$missingIdNames = @($integrity.missingIds | ForEach-Object { $_.name } | Sort-Object)
Assert-Equal ($missingIdNames -join '|') 'blue|SH-shader_main' 'missing linked ID names'
$curveFailureNames = @(
    $integrity.curves.sidecarMeshAssumptionFailures |
        ForEach-Object { $_.object } |
        Sort-Object
)
Assert-Equal (
    $curveFailureNames -join '|'
) (
    'GEO-electrical_wire.blue|GEO-electrical_wire.blue.001|' +
    'GEO-electrical_wire.brown.001|GEO-electrical_wire.red|' +
    'GEO-electrical_wire.red.001'
) 'sidecar mesh-assumption object names'

$planHash = (
    Get-FileHash -Algorithm SHA256 -LiteralPath $planPath
).Hash.ToLowerInvariant()
Assert-Equal $planHash '96ab0da55a79bfa46ffc89ad9d3c76ab8b4563ff56f21622afdaedb9b89bb492' (
    'Blendlink plan-result evidence SHA-256'
)
Assert-Equal $plan.source.sha256BeforeAndAfter $sourceHash (
    'recorded plan source SHA-256'
)
$fiveOne = @($plan.runs | Where-Object { $_.id -eq 'blender-5.1' })
Assert-Equal $fiveOne.Count 1 'Blender 5.1 plan-result count'
Assert-Equal $fiveOne[0].exitCode 1 'Blender 5.1 plan exit code'
Assert-Equal $fiveOne[0].sourceSha256After $sourceHash (
    'Blender 5.1 post-plan source SHA-256'
)
foreach ($fragment in @(
    'GEO-electrical_wire.blue',
    'NurbsPath.014',
    'POLY',
    'annecy_banner.blend',
    'no evaluated Mesh'
)) {
    if (-not $fiveOne[0].diagnostic.Contains($fragment)) {
        throw "Blender 5.1 plan diagnostic is missing '$fragment'"
    }
}
if (-not $fiveOne[0].fidelityPolicy.Contains('No raw-spline fallback')) {
    throw 'Blender 5.1 plan evidence does not record the no-fallback policy'
}

$curveEvidenceHash = (
    Get-FileHash -Algorithm SHA256 -LiteralPath $curveEvidencePath
).Hash.ToLowerInvariant()
Assert-Equal $curveEvidenceHash (
    '19b9a025bc572f9fe9b3ff14ce72f851e76d3acf9b84dd911ac2237214e3def0'
) 'generated Curve differential evidence SHA-256'
Assert-Equal $curveEvidence.blenderVersion '5.2.0 LTS' (
    'generated Curve differential Blender version'
)
Assert-Equal $curveEvidence.fixture.splineType 'POLY' (
    'generated Curve differential spline type'
)
Assert-Equal $curveEvidence.needleCoreFloor.operatorResult[0] 'FINISHED' (
    'Needle stock-export floor result'
)
Assert-Equal $curveEvidence.needleCoreFloor.curveNodeCount 1 (
    'Needle stock-export floor Curve node count'
)
Assert-Equal $curveEvidence.needleCoreFloor.curveNodeHasMesh $false (
    'Needle stock-export floor Curve mesh'
)
Assert-Equal $curveEvidence.blendlink.directEvaluatedMeshIsNone $true (
    'generated Curve evaluated-mesh blocker'
)
Assert-Equal $curveEvidence.blendlink.temporaryMeshCleanupOnFailure $true (
    'generated Curve temporary-mesh cleanup'
)
Assert-Equal $curveEvidence.source.stateUnchanged $true (
    'generated Curve source-state restoration'
)
Assert-Equal $curveEvidence.source.filesUnchanged $true (
    'generated Curve source-file restoration'
)
foreach ($fragment in @(
    'BLENDLINK_LINKED_POLY_WIRE',
    'POLY',
    'legacy_curve_library.blend',
    'raw spline points',
    'website-owned copy'
)) {
    if (-not $curveEvidence.blendlink.diagnostic.Contains($fragment)) {
        throw "Generated Curve diagnostic is missing '$fragment'"
    }
}

Write-Output (
    'BLENDLINK_BLENDER_36_LINKED_BUNDLE_EVIDENCE_PASSED ' +
    "files=$($actualFiles.Count) libraries=$existingLibraries images=$existingImages " +
    "missing_ids=$(@($integrity.missingIds).Count) " +
    "sidecar_mesh_failures=$(@($integrity.curves.sidecarMeshAssumptionFailures).Count) " +
    'curve_diagnostic=verified'
)
