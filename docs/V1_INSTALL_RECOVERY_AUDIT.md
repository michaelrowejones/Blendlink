# First-install recovery audit

Reviewed source `5ef60b87` on November 15, 2026, against
[the 1.0 release plan](V1_RELEASE_PLAN.md). This is a focused local CPU audit,
not an exact-artifact clean Blender installation or public distribution approval.

## Concrete defect and correction

Both `previewrun.last_message()` and `syncrun.last_message()` searched backward
for any line containing “error”. npm prefixes its final debug-log location with
`npm error`, so that footer replaced the actual installation failure in Blender's
failure card. Open Log retained the cause, but an artist could not understand the
failure or recover from the card itself.

An actual `npm exec --offline` with an empty cache outside the repository
reproduced this sequence on Node 24.22.1 / npm 11.20.0:

```text
npm error code ENOTCACHED
npm error request to https://registry.npmjs.org/scenetoweb failed: cache mode is 'only-if-cached' but no cached response is available.
npm error A complete log of this run can be found in: <private-cache>/_logs/<timestamp>-debug-0.log
```

The baseline failure-card function returned only the last line. A shared pure
message selector now omits npm's log-location/footer lines, preserves the real
cause, and explains the enable-online-access/retry remedy for `ENOTCACHED`.
Unrelated compiler errors retain their own message. Raw diagnostic lines and
logs remain intact; no subprocess, download, version, cache or cancellation
policy changed. Node, compiler and viewer caches remain separate prerequisites
for the corresponding offline workflow.

## Focused evidence

- Six CPU regression cases run through both actual runner modules, covering
  offline recovery, network/registry causes, old npm prefixes, compiler errors,
  footer-only output and unchanged raw diagnostic lines.
- Six existing private-runtime bootstrap checks pass, including offline reuse,
  checksum failure, archive traversal and matching compiler selection.
- Seven headless-suite discovery/profile policy tests pass; the new CPU suite
  is discovered with its explicit successful sentinel.
- UI name resolution passes for all eight checked modules; `git diff --check`
  passes.

Reproduce without Blender, native renders, GPU jobs or registry access:

```sh
python3 packages/blender-addon/tests/task_messages_check.py
python3 packages/blender-addon/tests/bootstrap_check.py
node --test scripts/lib/addon-headless-suites.test.mjs
python3 packages/blender-addon/tests/ui_name_resolution_check.py
git diff --check
```

## Remaining distribution gates

1. Freeze and rehearse the exact candidate ZIP/tarball from clean desktop
   profiles, including first download, interruption/retry, cached offline use,
   update and uninstall with artist scene/assets preserved. Existing broad
   suite passes do not establish every promised candidate/platform cell.
2. Complete the selected whole-scene acceptance and physical-device matrix;
   narrow public compatibility claims where evidence is absent. Playwright
   WebKit is distinct from actual Safari and physical iOS hardware.
3. At the authorized distribution stage, verify `scenetoweb` ownership and any
   one-time registry bootstrap, configure protected OIDC/immutable release
   gates, then publish and independently compare downloaded bytes/provenance.
   A source checkout/local compiler rehearsal does not resolve the currently
   unpublished registry path. Marketplace moderation remains separate.

No accounts, external settings, publication, spreadsheet or support categories
changed in this audit.

## Evaluated binding inspection: Sample UV Surface

The hash-pinned official original
`https://download.blender.org/demo/geometry-nodes/geometry_nodes_sample_uv_surface.blend`
(SHA256 `d0bd07e650dea9b903f34707cb9d96f63515722ae66b9076fd9b5c6a81cf8ada`)
previously made `plan --blend <original> --json` exit 1 without JSON. Blender
5.3.0 build `02f0899d78e3` cannot return an inspectable evaluated Mesh for
`GEO-stitching_name`: “Object does not have geometry data”. There is no proof
that omitting that source is harmless, so it remains refused.

A narrow typed `MaterialBindingInspectionError` now preserves object, native
cause and repair guidance. Only plan-only export serializes it as
`diagnostics.materialBindingIssues`; the CLI emits hard
`material.binding-inspection-failed` errors with `object`/`usedBy` and
`inspection.incomplete=true`, then exits 1. No bake estimate is computed for the
incomplete scope. Appearance ownership and application material adapters cannot
waive the error. Actual Preview/Final exports still raise the refusal. Other
programmer/extraction exceptions are not converted into a successful plan
protocol response. Native `to_mesh` refusal and explicit evaluated-material-use
errors are the typed boundary; remaining material iteration errors retain their
original exception path.

Focused checks on the same native build pass:

- The existing material-plan diagnostic suite, extended with a real FONT object
  and empty Geometry Nodes output: structured negative result, no emitted GLB,
  no bake estimation, no swallowed unexpected TypeError, preserved source scene
  and last-good output after both Preview and Final refusal.
- TypeScript build and 17 plan-manifest tests, including non-waivable object
  inspection errors.
- The actual unchanged official original returns valid JSON and exit 1. Retained
  output `/tmp/scenetoweb-sample-uv-structured-plan.json`, SHA256
  `d18e5adb1917a9b53a12e62cd75619b12d55d92ddea643e0237044142b2a1c3b`;
  stderr `/tmp/scenetoweb-sample-uv-structured-plan.stderr.log`.
- Native log `/tmp/scenetoweb-binding-native-check.log`; unit log
  `/tmp/scenetoweb-binding-vitest.log`; `git diff --check` passes.

These are CPU/headless planning/refusal checks, not a render, geometry
translation, partial material-scope pass, demo-scene acceptance or support
promotion. Source-owned coverage fingerprints need the normal retained refresh
at the integrated checkpoint; no native inventory refresh follows.

## Impact Fracture: Final export mesh ownership

The unchanged official Impact Fracture original (SHA256
`6785c3b4c5b50e2eab7b088914f6558b90aa3dad9cd105ef57d2973495c7b69c`)
exposed two concrete lifecycle failures on Blender 5.3.0 / exporter 5.3.43.
Its saved active Cube is in Edit Mode: assigning a private `obj.data` Mesh is
silently ignored. An immediate installation postcondition now refuses that
low-level misuse before emit. The worker prepares Object Mode before planning
and export, then restores its verified original active owner, data, selection
and mode on success or failure; it never saves the source file.

The stock glTF exporter also puts `gltf2_original_mesh` on its temporary
`to_mesh` result, referencing the private Main Mesh. Here that temporary result
has `is_evaluated=False` despite not belonging to `bpy.data.meshes`.
`to_mesh_clear` invalidates it without releasing the property ID user. Native
before/after graphs showed unchanged object/data bindings and no new objects;
the remaining user was neither a fake user nor an actual object. A depsgraph
update did not clear it.

A scoped adapter for exact Blender 5.3.0 / exporter 5.3.43 closes only the
observed non-Main temporary Mesh backlink to the transaction's private Mesh,
after gathering consumes it and before native temporary clearing. It checks
the applied flag and unchanged ownership, restores the gather hook, leaves
source/custom properties and foreign users intact, and retains the compiler's
strict zero-user and owner-binding cleanup checks. It does not force-unlink
Meshes or waive replacement guards. Other native profiles keep their existing
path.

Focused native evidence, with no render/GPU job:

- The original direct Final export completes, restores all 285 Object IDs and
  282 Main Mesh IDs, removes all 281 private copies, restores saved editing mode,
  and leaves the original file SHA unchanged. Frozen trace/log:
  `/tmp/scenetoweb-impact-native-fixed-debug.log`; graph:
  `/tmp/scenetoweb-impact-native-debug/data-graph.json`; result/artifact:
  `/tmp/scenetoweb-impact-native-debug/result.json` and `impact.glb`.
- A small actual Geometry Nodes geometry/instance export saved in Edit Mode
  succeeds, with source Mesh properties/bindings, selection and mode restored
  and no private Mesh/material leftovers. Direct low-level Edit Mode use refuses
  before emit and preserves the last-good bytes. Forced worker failure restores
  mode; foreign users survive and changed temporary ownership refuses.
- `export_mesh_ownership_check.py`, the existing `material_compiler_check.py`
  and `plan_material_diagnostics_check.py` pass on the pinned native build;
  `git diff --check` passes. Logs are
  `/tmp/scenetoweb-export-mesh-ownership-check.log`,
  `/tmp/scenetoweb-impact-material-compiler-check.log` and
  `/tmp/scenetoweb-impact-plan-check.log`.

This closes an export transaction defect, not whole-scene visual acceptance or
new geometry/material/node support. Standalone website and installed-browser
acceptance remain separate gates at the integrated candidate.

### Worker-excluded editing helpers

The saved-mode guard also distinguishes intentional `-noimp` removal from an
unexpected missing owner. `remove_noimp_objects` records completed deletions by
exact original name/pointer in a journal owned by the current worker-mode scope.
A deleted editing owner remains excluded and leaves the worker in Object Mode;
no unrelated surviving object becomes its replacement editing owner. Selected
excluded helpers are omitted from selection restoration. Surviving editing
owners retain checked data identity, including multi-object Edit Mode.

The native `source_export_mode_check.py` passes actual plan/Final exports with
an active `-noimp` editing helper, unchanged saved source bytes, multi-object
editing with a removed selected helper, and body-error propagation after an
intentional owner deletion. Unjournaled deletion, changed active owner and
changed editing data all remain hard failures. Log:
`/tmp/scenetoweb-source-export-mode-check.log`. No general disappearance waiver,
source-file save, geometry support promotion or GPU/render claim follows.

## Authored camera depth of field

Impact's original active Camera uses 50 mm, f/0.5 and a raw focus distance of
6.928999900817871 Blender units at frame 0. The generated website does not
translate native camera DOF, despite its existing authored scene effect.
The shared read-only `camera_fidelity` diagnostic now warns in Website Readiness,
plan/export warnings and raw sidecar `diagnostics.cameraFidelity`. It preserves
lens/sensor settings, aperture f-stop/blades/rotation/ratio, distance or focus
object/bone and frame; it never changes them or auto-adds an effect.

The separate Depth of Field scene Component has Preview adapter status and
world-space focus-distance/range plus blur-strength controls. It is not a
qualified Blender optical model. An enabled scene-targeted component does not
suppress the warning or establish parity; disabled or object-targeted records
do not count as an enabled scene effect. The remedy states the perspective-camera
scope, manual comparison and transparency caveat rather than guessing a
lens/f-stop conversion. Artist-chosen sharp output remains a deliberate choice.

`camera_fidelity_check.py` passes native minimal distance/object-focus,
disabled/explicit-effect cases, actual plan warning/sidecar preservation and
actual cached readiness without automatic effect creation. The unchanged
original was read on Blender 5.3.0 build `02f0899d78e3`; its source SHA remains
`6785c3b4c5b50e2eab7b088914f6558b90aa3dad9cd105ef57d2973495c7b69c`.
Evidence is `/tmp/scenetoweb-camera-dof-warning-native-report.json` and
`/tmp/scenetoweb-camera-dof-warning-native-check.log`. UI name resolution and
seven headless-discovery/profile tests pass. No render/GPU job, runtime effect
change, optical port, support promotion or scene acceptance follows.
