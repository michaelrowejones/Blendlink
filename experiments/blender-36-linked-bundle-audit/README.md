# Blender 3.6 linked production-bundle audit

This retained research cell opens the official Pet Projects scene from
Blender's 3.6 splash bundle without repacking, localizing, or saving it. It is
an intentionally difficult dependency-closure case: the small entry file
depends on 30 linked `.blend` libraries and 24 external image references.

The archive and extracted source stay under ignored local paths. The committed
evidence contains identities and structural facts, not redistributed Blender
Studio assets. The embedded README identifies the project and copyright owner
but does not state an exact license version, so do not publish the archive,
source, or derivatives from this cell.

## Verify retained evidence

Run from the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File experiments\blender-36-linked-bundle-audit\verify_evidence.ps1
```

The verifier hashes the source archive and every extracted file, checks that
the inventory resolves all linked libraries and external images, and
content-identifies the retained Blender 5.1 load-integrity evidence and Blender
5.2 crash report.

## Rebuild the read-only inventory

Blender 5.1.2 opens the exact closure. Explicitly disable Python auto-execution
because the source contains registered scripts and thousands of Python-backed
drivers:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' `
  --background `
  --factory-startup `
  --disable-autoexec `
  'artifacts\release-dogfood\next-corpus\sources\blender-3.6-splash-official\blender-3.6-splash\blender-3.6-splash.blend' `
  --python experiments\demo-corpus-audit\inventory_blend.py -- `
  experiments\blender-36-linked-bundle-audit\output\source-inventory-blender-5.1.json
```

Blender 5.2.0 LTS crashes while reading the same file, before the inventory
script executes. Re-running that command with the 5.2 executable is therefore
a negative loader reproduction, not a Blendlink exporter test. Do not add an
automatic fallback to 5.1.

The narrower integrity probe names missing linked IDs and curves that cannot
satisfy Blendlink's evaluated-mesh requirement:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' `
  --background `
  --factory-startup `
  --disable-autoexec `
  'artifacts\release-dogfood\next-corpus\sources\blender-3.6-splash-official\blender-3.6-splash\blender-3.6-splash.blend' `
  --python experiments\blender-36-linked-bundle-audit\inspect_load_integrity.py -- `
  experiments\blender-36-linked-bundle-audit\output\load-integrity-blender-5.1.json
```

## Isolated Blendlink planning

The two subdirectories differ only by configured Blender executable:

```powershell
Push-Location experiments\blender-36-linked-bundle-audit\five-two
node ..\..\..\packages\blendlink\dist\cli.js plan --json
Pop-Location

Push-Location experiments\blender-36-linked-bundle-audit\five-one
node ..\..\..\packages\blendlink\dist\cli.js plan --json
Pop-Location
```

Both point at the immutable retained source. The verified 5.2 result is a loud
abnormal-exit diagnostic. The verified 5.1 result reaches Blendlink's sidecar
collector and refuses the first affected Curve with the object
`GEO-electrical_wire.blue`, data `NurbsPath.014`, spline type `POLY`, exact
linked library, fidelity consequence, and artist remedies. It does not
substitute raw source points, silently omit the curve, change Blender versions,
or save the source.

## Generated Curve differential

The portable differential creates two temporary `.blend` files:

- a library containing beveled POLY Curve data;
- a website scene with a local object using that linked data and a
  render-enabled `GN-Hide` Geometry Nodes modifier whose evaluated result is
  empty.

That is the smallest form of the production blocker. It proves that stock
Blender glTF, invoked with Needle 1.4.2's exact supported export arguments,
finishes with a named node but no mesh. It then proves Blendlink refuses with
the named diagnostic, clears temporary meshes after sampling failures, and
leaves both in-memory state and source-file hashes unchanged:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' `
  --background --factory-startup --python-exit-code 1 `
  --python experiments\legacy-curve-sidecar-differential\run.py -- `
  experiments\legacy-curve-sidecar-differential\evidence.json
```

The same differential also passes under Blender 5.1.2.

See
[`docs/research-blender-36-linked-bundle-2026.md`](../../docs/research-blender-36-linked-bundle-2026.md)
for the evidence and conclusions.
