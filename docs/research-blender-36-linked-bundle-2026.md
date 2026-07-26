# Blender 3.6 Pet Projects linked-bundle audit

**Date:** 2026-07-25

**Status:** archive and extracted closure verified; Blender 5.1 read-only load
verified; generated legacy-Curve diagnostic differential passed on Blender
5.1/5.2; untouched-bundle 5.1 named refusal verified; Blender 5.2 loader crash
reproduced; no browser or visual-parity claim

**Fixture:** official Blender 3.6 splash production bundle, retained locally
only

## Decision

Keep this bundle in the **manual/release production-stress lane**, not the
portable test suite.

It is unusually valuable because its 7.9 MB entry scene is not a self-contained
asset: it loads a production graph of 30 linked `.blend` files, 24 external
image references, library overrides, embedded rig scripts, 5,935 inventoried
drivers, 1,787 Geometry Nodes modifiers, and 271 materials. It has already
found two independent boundaries that compact demo files did not:

1. Blender 5.2.0 LTS crashes in its library-override read path before any
   Blendlink Python can run.
2. Blender 5.1.2 opens the source, but five local objects using linked POLY
   Curve data and a `GN-Hide` Geometry Nodes modifier produce no evaluated
   mesh. This first exposed an unhelpful Blendlink `AttributeError`; Blendlink
   now refuses with the object, data, spline type, linked source, fidelity
   consequence, and artist remedies.

Do not work around either result by silently selecting Blender 5.1, enabling
embedded Python, skipping the curves, localizing libraries, or resaving the
source. The remaining high-confidence package improvement is a loud
missing-linked-ID preflight. Blendlink deliberately does not fall back to raw
Curve points: they cannot represent bevels, Geometry Nodes, modifiers, or
other evaluated geometry.

## Primary sources and exact identities

### Blender source bundle

- Official archive:
  [Blender 3.6 splash production bundle][bundle].
- Local archive: `C:\Users\micha\Downloads\blender-3.6-splash.zip`.
- Archive bytes: `256,907,103`.
- Archive SHA-256:
  `d3e31955432149483d70e5a61b0b03f56b037b467265556449d58a302c8f3b58`.
- Extracted files: `48` files (`90` ZIP entries when directories are counted),
  including `31` `.blend` files and `14` TIFF files.
- Entry scene: `blender-3.6-splash/blender-3.6-splash.blend`,
  `7,878,056` bytes, SHA-256
  `c65a4203f136ed2dabb076a0f13a347818da1e14ff73c84bd0b08caffbb36ef4`.
- The archive `README.txt`, SHA-256
  `23c5a9e974e17c6d50003f708dd93b4c97a27f4acb4ee02e7b4c00d6a16349c0`,
  calls this a production bundle from Blender Studio's Pet Projects open
  movie and tells the user to open the entry scene and render.
- The embedded `README` text identifies Blender Studio / Blender Foundation
  copyright and writes only `(CC)`. Neither notice states an exact Creative
  Commons license version. The archive and derivatives therefore remain local
  until redistribution terms are pinned.

The official Blender manual explains that [Link][link] keeps a reference to
data in another `.blend` and that a missing library becomes placeholder
datablocks. It also explains that [library overrides][overrides] may be
automatically resynchronized while a file is opened. These are load-time
semantics, before a Blendlink or Needle exporter can inspect the scene.

### Blender executables

| Executable | Exact build |
| --- | --- |
| `C:\Program Files\Blender Foundation\Blender 5.1\blender.exe` | Blender `5.1.2`, build hash `ec6e62d40fa9`, Windows Release, build date 2026-05-19 |
| `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe` | Blender `5.2.0 LTS`, build hash `fbe6228777e7`, Windows Release, build date 2026-07-14 |

The inventory and integrity commands explicitly pass `--disable-autoexec`.
Blender's [security manual][security] names registered text blocks and Python
driver expressions as auto-execution surfaces, says auto-execution is disabled
by default, and documents `--disable-autoexec` as the command-line override.

### Needle baseline

`npm.cmd run verify:needle-baseline` passed on 2026-07-25:

```text
BLENDLINK_NEEDLE_BASELINE_VERIFIED 130 files, 9 source version identities
(2026-07-25) integration=mixed-source
named=splash-official-preview:coherent
```

Relevant exact Needle Engine Exporter for Blender `1.4.2` sources:

| Normalized source path | SHA-256 | Observed behavior |
| --- | --- | --- |
| `__init__.py` | `980226a628182e9e0b1d443c0e294f799162c76e06c5f599dacc20c614a8c96e` | declares Blender `(4, 0, 0)` as its minimum |
| `utils_version_warnings.py` | `36a1a352df24cc07c7983b9139b3246d593b49493086a77222612c5481812c87` | warns for exact Blender 5.1.0 and 5.1.1 exporter bugs; contains no 5.1.2 or 5.2.0 loader warning |
| `blender_export.py` | `6272997cfb4f1d740ea33a7c2512983b9993dedf93c9c8240ca0ff7f82925d77` | operates on the already-open Blender scene and delegates GLB creation to `bpy.ops.export_scene.gltf` |

Needle's `__runExport` passes `export_apply=True` and the other arguments
reproduced by the generated differential directly to the stock operator. It
contains no Curve-specific refusal or sidecar analogue.

The exact installed Blender glTF exporter inspected for the differential is
version `5.2.39`:

| Normalized source path | SHA-256 | Observed behavior |
| --- | --- | --- |
| `io_scene_gltf2/__init__.py` | `0cd8903bd1a72ef1edbd728bee70d24a3ecc93c9901db68927b00910bb38be70` | declares exporter version `5.2.39` |
| `io_scene_gltf2/blender/exp/nodes.py` | `43e09e51a9d200ceee03e97881769f061ab5ad6d706eaba6b2cec4f3d3b278ee` | `__gather_mesh_from_blender_nonmesh` returns `None` when evaluated `to_mesh()` returns `None`, and also collapses conversion exceptions to `None` |

This matches the [official Blender glTF add-on manual][gltf-addon]: the
operator is Blender's bundled Khronos glTF exporter. The behavior claim above
comes from the exact installed source and differential rather than inferring
an edge case from the manual.

No coherent full Needle run was made on this exact 3.6 bundle. Therefore:

- the Blender 5.2 crash is a **platform boundary**, not a Blendlink-versus-Needle
  visual comparison;
- the add-on source cannot intercept a crash that occurs while Blender is
  opening the file, before the add-on export operation;
- Needle's full result after a successful 5.1 load remains unaudited. The
  generated differential validates only its stock-export core floor, not its
  complete build pipeline or a visual result.

## Evidence files

| File | What it proves |
| --- | --- |
| `experiments/blender-36-linked-bundle-audit/output/archive-entry-hashes.json` | exact archive identity plus byte length and SHA-256 for all 48 extracted files |
| `experiments/blender-36-linked-bundle-audit/output/source-inventory-blender-5.1.json` | read-only scene, dependency, material, geometry, animation, and lighting inventory |
| `experiments/blender-36-linked-bundle-audit/output/load-integrity-blender-5.1.json` | exact Blender build, autoexec state, missing IDs, registered scripts, and evaluated-Curve failures; SHA-256 `9f0809ad51dbae82b41053a40a66002d14c4faae442d5d9052df44c2ca5480a6` |
| `experiments/blender-36-linked-bundle-audit/output/blender-5.2-load-crash.txt` | native crash transcript; SHA-256 `af6f94f363b45d510726d31585cfb140ce86162ea0e3f8a4e33191d7dfa406b6` |
| `experiments/blender-36-linked-bundle-audit/output/blendlink-plan-results.json` | exact Blendlink build identities and concise 5.1/5.2 plan outcomes |
| `experiments/legacy-curve-sidecar-differential/evidence.json` | generated linked Curve-data fixture, exact Needle-style stock-export floor, named Blendlink refusal, cleanup, and source/state immutability |

`verify_evidence.ps1` rehashes the archive and every extracted file, validates
the recorded closure and integrity facts, content-identifies both retained
diagnostic files plus the plan and generated-Curve evidence, and checks the
named diagnostic, stock node/no-mesh floor, cleanup, and restoration facts.

## Blender 5.1 result

### Source and dependency closure

Blender 5.1.2 opens the untouched entry scene with auto-execution disabled.
The source hash is unchanged before and after inventory, integrity inspection,
and both Blendlink plan attempts.

The read-only inventory reports:

| Area | Evidence |
| --- | --- |
| Scene | Eevee; `020_0050.lighting`; frame range `150..150`, current frame `151`; 2000×1000; Filmic / Medium High Contrast; compositor enabled |
| Objects | 912 total: 662 meshes, 193 curves, 10 armatures, 3 cameras, 8 lights, plus empties/lattices |
| Render-visible geometry | 641 meshes and 189 curves |
| Materials | 271 |
| Animation | 44 actions; 5,935 drivers in the inventory's object/object-data/node-group/material owner scope |
| Procedural geometry | 1,787 Geometry Nodes modifiers |
| Lights | 5 Area, 1 Point, 2 Sun |
| File closure | 30/30 linked library paths exist |
| Image closure | 24/24 external image references resolve; 0 packed images |

“All paths resolve” is intentionally narrower than “all linked data is
healthy.” Blender still reports two missing IDs inside existing library files:

- Material `blue` from `pro/lib/props/inflatable_ramp/inflatable_ramp.blend`;
- NodeTree `SH-shader_main` from `pro/lib/nodes/shading.blend`.

Blender also prints extensive library-override resync and hierarchy-repair
warnings. Those are important compatibility evidence, but they are only
in-memory load behavior because the audit never saves the file.

### Auto-execution and driver truth

The integrity result records `autoexecEnabled: false` and seven registered
text blocks: one `lighting_overrider_execution.py`, one
`lighting_rig_setup.py`, and five `cloudrig.py` records from the linked
closure. Blender explicitly prints that each is skipped.

Dependency-graph evaluation also prints restricted-access failures for:

- `shading and self.show_render` on `GEO-head_open.show_viewport`;
- three `depsgraph.scene.camera.matrix_world.to_euler()` channels on
  `HLP-scene_camera_dummy.004.rotation_euler`.

The wider integrity sweep sees 6,640 driver FCurves, whereas the generic
inventory's deliberately narrower owner scope counts 5,935. Blender's
`FCurve.is_valid` flag remains true for all 6,640 even while stderr reports the
restricted-access failures. Therefore that flag is not sufficient evidence
that a source evaluates faithfully with auto-execution disabled.

Enabling scripts would make this stress scene look healthier, but it would
cross a security boundary. Blendlink must instead name the dependency and let
the artist choose whether to trust and prepare it.

### Blendlink plan gap found, then repaired

The 5.1 plan exits `1` after source loading:

```text
The export script failed inside Blender.
AttributeError: 'NoneType' object has no attribute 'vertices'
packages/blendlink/dist/blender/export_scene.py:1069 collect_sidecar
```

The failing assumption is:

```python
mesh = evaluated.to_mesh()
sampled = [yup(matrix @ vertex.co) for vertex in mesh.vertices]
```

Five linked, render-visible POLY Curve objects return `None` from
`evaluated.to_mesh()`:

1. `GEO-electrical_wire.blue`;
2. `GEO-electrical_wire.blue.001`;
3. `GEO-electrical_wire.brown.001`;
4. `GEO-electrical_wire.red`;
5. `GEO-electrical_wire.red.001`.

That initial result was a **Gap**, not a successful loud refusal. The Python
traceback did not tell the artist which object failed or whether the curve
could be represented safely.

The generated differential reduced the condition to a local Object with
linked beveled POLY Curve data and a render-enabled Geometry Nodes modifier
that evaluates to no geometry. Blender 5.2.39's stock exporter, invoked with
Needle 1.4.2's exact supported glTF arguments, returns `FINISHED` and emits the
named node without a mesh. Blendlink now stops earlier with:

```text
Blendlink cannot compile render-visible Curve 'GEO-electrical_wire.blue'
(data 'NurbsPath.014', spline type POLY; source library
'...\annecy_banner\annecy_banner.blend'): Blender returned no evaluated Mesh.
```

The complete diagnostic explains why raw spline points would discard evaluated
geometry and offers three routes: mark an intentionally empty Curve
non-rendering, repair the modifier/linked data or make a local website-owned
copy/Library Override, or convert a website-owned copy to Mesh.

The untouched entry scene remains SHA-256
`c65a4203f136ed2dabb076a0f13a347818da1e14ff73c84bd0b08caffbb36ef4`
after the plan. Blendlink does not localize, convert, or save it.

## Blender 5.2 result

Blender 5.2.0 LTS crashes while loading the same exact closure. The retained
native transcript begins:

```text
ExceptionCode : EXCEPTION_ACCESS_VIOLATION (0xc0000005)
Exception Address : 0x00007FF6B294D14D
blender::BKE_lib_override_library_free
blender::BKE_libblock_free_data
blender::read_libraries
```

The isolated Blendlink 5.2 plan independently reproduces the same exception
address and exits `1` with:

```text
Blender exited abnormally (code 11).
```

Blendlink includes Blender's stderr and stdout tails, including the last linked
libraries read. No `BLENDLINK_OK` sentinel or plan artifact is produced. This
is a verified loud process-boundary failure; Blendlink cannot improve the
native loader's wording from inside a Python script that never runs.

Do not add this to `blender_known_issues.json` yet. That registry requires a
public primary issue, and none has been pinned for this exact crash. A future
upstream report should include the exact archive/source identities, Blender
build hash, exception address, and minimal closure if one can be reduced
without redistributing unlicensed material.

## Designs compared

### Version handling

| Design | Consequence | Decision |
| --- | --- | --- |
| On a 5.2 crash, silently retry the installed 5.1 executable | Hides the selected toolchain, changes evaluation/export semantics, and may publish a scene with missing IDs or disabled drivers | **Rejected** |
| Open/save a converted copy in 5.1, then retry 5.2 | Resyncs a large override hierarchy and risks making the compiler responsible for source migration | **Rejected** |
| Keep the configured executable authoritative; surface abnormal exit and exact Blender tail; let the artist select another version explicitly | Honest, reproducible, and consistent with website/artist ownership | **Selected; shipped and verified** |

### Curves with no evaluated mesh

| Design | Consequence | Decision |
| --- | --- | --- |
| Treat `None` as an empty curve and continue | Can silently delete visible wires | **Rejected** |
| Fall back to raw spline points | May omit Geometry Nodes, hooks, bevel, deformation, and evaluated topology | **Future prototype only** |
| Preflight the `None` result and fail with object, data, spline type, library, fidelity consequence, and artist remedies | Does not overclaim representation and makes the failure actionable | **Selected; shipped and verified** |

The missing-linked-ID preflight should run before curve/material export and
list the exact missing Material/NodeTree plus owning library. It should not
collapse “file path exists” and “referenced datablock exists” into one health
state.

## Capability register

| ID | Needle baseline | Blendlink choice | Relation | Implementation state | Evidence state |
| --- | --- | --- | --- | --- | --- |
| `NDL-B36-001` | No exact-bundle Needle run; audited exporter operates only after Blender has opened linked data | Retain a content-identified, read-only linked-closure stress lane | **No analogue** | **Prototype** | `verify_evidence.ps1` passed 2026-07-25: 48 files, 30/30 libraries, 24/24 images |
| `NDL-B36-002` | Add-on 1.4.2 requires Blender 4.0+ but cannot intercept a native pre-export file-load crash | Keep configured Blender authoritative and surface abnormal exit plus ordered stderr/stdout tails | **Boundary** | **Shipped** | isolated 5.2 `plan --json`, exit 1, exact access-violation address, 2026-07-25 |
| `NDL-B36-003` | Exact-bundle security behavior unaudited; Needle runs inside the artist-opened Blender process | Keep auto-execution disabled in the isolated compiler process and expose restricted driver/script consequences | **Boundary** | **Shipped** | Blender 5.1 integrity probe: autoexec false, seven registered scripts skipped, four restricted driver evaluations |
| `NDL-B36-004` | Add-on 1.4.2 has no sidecar-Curve analogue and delegates to stock glTF; Blender 5.2.39 returns no mesh without an artist diagnostic | Refuse an unevaluable render-visible Curve before sidecar publication; name object/data/type/library and remedies; never substitute raw points | **Improvement** | **Shipped** | generated differential passed Blender 5.1.2 and 5.2.0 LTS; stock node/no-mesh floor, cleanup, source/state immutability; untouched 3.6-bundle plan names `GEO-electrical_wire.blue`, 2026-07-25 |
| `NDL-B36-005` | Exact-bundle missing-ID handling not run in Needle | Distinguish resolved files from missing linked datablocks before claiming a healthy closure | **Gap** | **Future** | Blender 5.1 names Material `blue` and NodeTree `SH-shader_main`; package preflight not yet shipped |

## Implemented, verified, and future

### Implemented in this audit

- reusable full-closure evidence verifier;
- read-only Blender 5.1 load-integrity probe;
- isolated 5.1 and 5.2 Blendlink plan configurations;
- content-identified plan outcome record;
- package-owned evaluated non-Bezier Curve sampling seam with guaranteed
  temporary-mesh cleanup and an artist-readable `None` diagnostic;
- portable generated stock/Blendlink differential wired into the add-on
  headless gate.

### Verified

- archive, entry scene, and all 48 extracted file identities;
- 30/30 linked file paths and 24/24 external image references resolve in
  Blender 5.1.2;
- source `.blend` remains byte-identical;
- auto-execution is off and registered scripts are skipped;
- two linked datablocks remain missing despite complete file-path closure;
- five non-Bezier Curve objects violate the evaluated-mesh requirement;
- stock Blender glTF invoked with Needle's arguments finishes but emits the
  generated Curve node without a mesh;
- Blendlink refuses that condition with object/data/type/library/remedies and
  never falls back to raw points;
- source state and both generated/production `.blend` file hashes remain
  unchanged;
- Blender 5.2.0 LTS crashes before the inventory/export script;
- Blendlink surfaces that 5.2 crash loudly and does not silently fall back.

### Future work

1. Add a tiny generated missing-linked-ID fixture and package preflight before
   this production scene becomes its regression.
2. Consider a non-destructive evaluated-geometry adapter only if a real artist
   workflow requires one; raw-spline fallback remains rejected because the
   current differential proves it would disagree with evaluated output.
3. Report the Blender 5.2 crash upstream and pin the public issue before
   creating a known-issue registry entry.
4. Pin exact redistribution terms before publishing source assets,
   screenshots, or derivatives.
5. Only after the loader and preflight gates pass, compare Blender Eevee,
   stock glTF, Needle, and Blendlink browser renders. This audit contains no
   visual-parity evidence.

## Commands

From the repository root:

```powershell
npm.cmd run verify:needle-baseline

npm.cmd run build --workspace blendlink

& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' `
  --background --factory-startup --python-exit-code 1 `
  --python experiments\legacy-curve-sidecar-differential\run.py -- `
  experiments\legacy-curve-sidecar-differential\evidence.json

& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' `
  --background --factory-startup --python-exit-code 1 `
  --python experiments\legacy-curve-sidecar-differential\run.py

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File experiments\blender-36-linked-bundle-audit\verify_evidence.ps1

& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' `
  --background --factory-startup --disable-autoexec `
  'artifacts\release-dogfood\next-corpus\sources\blender-3.6-splash-official\blender-3.6-splash\blender-3.6-splash.blend' `
  --python experiments\demo-corpus-audit\inventory_blend.py -- `
  experiments\blender-36-linked-bundle-audit\output\source-inventory-blender-5.1.json

& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' `
  --background --factory-startup --disable-autoexec `
  'artifacts\release-dogfood\next-corpus\sources\blender-3.6-splash-official\blender-3.6-splash\blender-3.6-splash.blend' `
  --python experiments\blender-36-linked-bundle-audit\inspect_load_integrity.py -- `
  experiments\blender-36-linked-bundle-audit\output\load-integrity-blender-5.1.json

Push-Location experiments\blender-36-linked-bundle-audit\five-two
node ..\..\..\packages\blendlink\dist\cli.js plan --json
Pop-Location

Push-Location experiments\blender-36-linked-bundle-audit\five-one
node ..\..\..\packages\blendlink\dist\cli.js plan --json
Pop-Location
```

[bundle]: https://download.blender.org/demo/splash/blender-3.6-splash.zip
[link]: https://docs.blender.org/manual/en/5.2/files/linked_libraries/link_append.html
[overrides]: https://docs.blender.org/manual/en/5.2/files/linked_libraries/library_overrides.html
[security]: https://docs.blender.org/manual/en/5.2/advanced/scripting/security.html
[gltf-addon]: https://docs.blender.org/manual/en/5.2/addons/scene_gltf2.html
