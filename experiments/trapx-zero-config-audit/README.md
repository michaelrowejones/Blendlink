# TrapX zero-configuration audit

This is a local, research-only corpus audit of:

`C:/Users/micha/Downloads/TrapX - Stylized Painting Shader.blend`

The source file and all generated visual/GLB evidence stay outside version
control. Redistribution rights for the downloaded scene have not been pinned,
so do not copy its `.blend`, packed images, rendered frames, or exported GLBs
into release fixtures.

The checked-in scripts are source-agnostic audit scaffolding. They always open
the source with Blender auto-execution disabled and never save it.

## Evidence boundary

- `output/` and `work/` are ignored.
- The source SHA-256 is checked before and after every Blendlink plan/compile
  operation.
- `source-cycles-camera-frame-0000.png` is a human-review still decoded in
  Chromium from Blender's authored one-frame H264 output. It is not a lossless
  raw render.
- `output/blendlink/trapxUntouched.glb` is an untouched compiled structural
  floor, not visual-parity evidence.
- The exact Needle source audit is in
  [`needle-source-audit.md`](needle-source-audit.md).

## Commands

Run from the repository root unless the command changes directory:

```powershell
npm.cmd run verify:needle-baseline

$source = 'C:\Users\micha\Downloads\TrapX - Stylized Painting Shader.blend'
$blender = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
$before = (Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash.ToLower()
& $blender --background --factory-startup --disable-autoexec $source `
  --python experiments\trapx-zero-config-audit\inventory_source.py -- `
  --source $source `
  --output experiments\trapx-zero-config-audit\output\source-inventory.json
$after = (Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash.ToLower()
if ($before -ne $after) { throw 'TrapX source changed during inventory' }

# The scene is authored as a one-frame FFMPEG/H264 animation.
& $blender --background --factory-startup --disable-autoexec $source `
  --render-output `
  experiments\trapx-zero-config-audit\output\source-authored-frame0 `
  --render-anim -- --cycles-device CUDA

node experiments\trapx-zero-config-audit\extract_video_frame.mjs

Push-Location experiments\trapx-zero-config-audit
node run_blendlink_plan.mjs
node run_blendlink_compile.mjs
node run_plan_compile_consistency.mjs
node inspect_compiled_glb.mjs
node run_stock_floor_browser.mjs
Pop-Location

npm.cmd run test --workspace blendlink -- `
  syncMaterialPortability.integration.test.ts
```

`run_blendlink_compile.mjs` points the publication-lease registry into the
ignored experiment output so a sandbox run does not need to write to the
normal per-user Blendlink cache.

## Current local sentinels

```text
BLENDLINK_NEEDLE_BASELINE_VERIFIED 130 files, 9 source version identities
(2026-07-25) integration=mixed-source
named=splash-official-preview:coherent

BLENDLINK_TRAPX_INVENTORY_OK scenes=1 materials=7 images=47

BLENDLINK_TRAPX_AUTHORED_FRAME_EXTRACTED
video=f99ee5903d97c93d6c73a1fbb66a2ded6b443043b881e1ce5e870e22123ec52a
png=a744de038968bf9fae9512c65488975587a6be9f46d147c471d47c00a635e8f2

BLENDLINK_TRAPX_STOCK_FLOOR_BROWSER_VERIFIED
glb=d22ef7be85467c5d808ab1ba02d18560a35eb25ca3f2e7992d4799522e19267b
png=866dded4e0965289552337ef4260c1b42baae21b2691f8c331c80c78fe31f45d
visible=741017 iou=0.893023 mae=63.526672

BLENDLINK_PLAN_COMPILE_CONSISTENCY_PASSED errors=1 reasons=14 retained=5
```

The untouched Final planner exits `1` with one
`material.used-needs-bake` error. A real-scene regression exposed that the
matching compile initially emitted the stock structural floor instead of
applying the same gate. The fixed Final compile now exits `1`, repeats all
fourteen material reasons, discards the stage, and leaves the exact retained
scene-publication scope byte-identical:

```text
stable GLB
d22ef7be85467c5d808ab1ba02d18560a35eb25ca3f2e7992d4799522e19267b

immutable addressed GLB
d22ef7be85467c5d808ab1ba02d18560a35eb25ca3f2e7992d4799522e19267b

manifest
b7e02dd5c6c18b18d63aae1f8dc33963130eb3b195894f5b5353f39547d6e182

generated scene module
04a12fac5677eb0fd9a4be900ad50294c67e23c3fba8e1d3e440105d83f47316

baked recipe module
a0bac0fea523dda9fe3c9b9413a150647700e5be8e5cef4d7a2cb91978cd0949
```

The retained manifest's runtime asset graph has exactly one declared entry,
the GLB, and no declared companions. The runner discovers and hashes every
declared graph entry at both stable and immutable paths, then hashes the
manifest and both generated modules. It does not enumerate undeclared runtime
files, so this is an exact declared-publication-scope claim rather than proof
that no unlisted file exists. The retained files, structural report, and
browser evidence preserve a rejected pre-fix floor; they are not a current
accepted publication.

Final frozen gate identities:

```text
src/sync.ts
faa6592ed5231f502a74293e7a5899397bf965ad13a36979b812f6371ba9c67e
dist/sync.js
06d801507ed8431c3c4c22869d444268c1af96ffa90205c638c3f1d22cb11146
src/planManifest.ts
4b5e00bf63790236b12080d83e7fa9e67f055ec577d2c7acb5e76a63b326d16f
dist/planManifest.js
9e753512aa2180a7cc43c97a64da45d679a785204824240285a0fa168ba0ef08
dist/cli.js
7ef29e97fe17530611e63f3084d4ad1069f2bb6f3b21fe6abfe80ed262c6dbb7
dist/blender/export_scene.py
9ea88103fbafcfad431ad409ebb67305d4a31e30309ac7c64d444548a2050dd5
```

The final evidence run used Blendlink `0.8.0`, Node `v24.15.0`, npm
`11.12.1`, Blender `5.2.0 LTS` build `fbe6228777e7`, and Vitest `3.2.7`.
