# Blender 2.91 Splash zero-configuration differential

- Date: 2026-07-24
- Source: `C:/Users/micha/Downloads/blender-2.91-splash.blend`
- Source identity: 69,359,275 bytes; SHA-256
  `b60bd6d566d202cc9cd8c0bd260a45be0ab8c37fc24e0d2e9c909efa41e94655`
- Source modification: none. The final recheck retained mtime
  `2026-07-22T18:58:11.7829860Z` and the same hash.
- Evidence:
  [`artifacts/release-dogfood/blender-2.91-splash`](../artifacts/release-dogfood/blender-2.91-splash)

## Outcome

This untouched scene is a successful **expected-refusal** corpus cell, not a
visual-parity pass. It exposed and closed two general silent-loss paths:

1. render-visible legacy `HAIR` / `PATH` particle systems now stop export with
   object, system, count, transport consequence, and artist remedy; and
2. a realtime `blendlink plan` with `plan: null` now exits red when a used
   material is still classified `needsBake`.

Blendlink did not generate a Preview GLB from the source after these gates were
added. The scene remains blocked until legacy paths have a verified transport
or the artist converts them to a visually validated mesh/card representation.
The active-camera adoption design remains **Prototype** and made no production
manifest or runtime change.

| Capability | Relation | Implementation | Evidence |
| --- | --- | --- | --- |
| `NDL-DIAG-006` realtime `plan: null` material-loss gate | **Improvement** | **Shipped** | Five pure planner cases plus the existing two verifier cases and `experiments/realtime-plan-material-diagnostics/run.mjs`; 2026-07-24, Node 24.15.0 / Blender 5.2.0 |
| `NDL-GEO-001` legacy `HAIR/PATH` transport | Stock/Needle export behavior **Match** for the underlying loss; early Blendlink refusal **Improvement** | **Shipped blocker**; renderable adapter **Future** | Eight-path stock-export fixture plus untouched 2.91 source; 2026-07-24, Blender 5.2.0 / glTF exporter 5.2.39 |
| `NDL-CAM-003` source-active camera as a bounded fallback | **Improvement candidate** over Needle's implicit all-camera candidates | **Prototype** | Four-case precedence prototype plus exact `Camera_1` mapping; no production gate |

## Primary-source scope

The supplied [Blender 5.2 glTF manual](https://docs.blender.org/manual/en/5.2/addons/scene_gltf2.html)
is useful because it documents the portable surface: meshes, recognized
metal/rough or unlit materials, textures, cameras, punctual lights, and
supported animation. It does not promise legacy particle-path geometry. The
manual is the user-facing contract; the installed exporter source and an
actual GLB differential below determine the exact Blender 5.2 behavior.

Installed Blender:

- Blender `5.2.0 LTS`, build `fbe6228777e7`;
- glTF generator `Khronos glTF Blender I/O v5.2.39`;
- `io_scene_gltf2/__init__.py` SHA-256
  `0cd8903bd1a72ef1edbd728bee70d24a3ecc93c9901db68927b00910bb38be70`;
- `blender/exp/tree.py` SHA-256
  `a7cdaebf55836ce2cb466b7ab4f48a66490aacd2fc0cb45dcb0bcda8a18080f6`;
- `blender/exp/material/search_node_tree.py` SHA-256
  `0c037d078db37da3b6d65054206a9f55d19fa5f8ca6542f5add614230c39f7e9`;
  and
- `blender/exp/material/materials.py` SHA-256
  `f0678496e6762566727fc9c76264c7d7665b2f22dee4671b63cfefe968ed5c31`.

`tree.py` expands object/collection duplis from
`depsgraph.object_instances`, and separately traverses Geometry Nodes
instances. It contains no legacy path-to-primitive conversion. This source
observation is independently guarded by the eight-path GLB fixture described
below, so the diagnostic will fail if the exporter later gains real path
geometry.

Pinned Needle sources:

- Blender add-on `1.4.2`;
- `blender_export.py` SHA-256
  `6272997cfb4f1d740ea33a7c2512983b9993dedf93c9c8240ca0ff7f82925d77`;
- `extensions/NEEDLE_components_postprocess.py` SHA-256
  `90cdd4fbd883858816d36ea1605e75fd820c4bcac2e8d8c87e76a465eb1ce031`.

`npm run verify:needle-baseline` passed on 2026-07-24 for 122 files and seven
source-version identities. The broad inventory remains
`integration=mixed-source`; the named `splash-official-preview` cell is
coherent only within its documented scope.

Needle `blender_export.py` delegates ordinary geometry/material/camera
serialization to Blender's stock exporter. No legacy particle-path
materializer was found in the inspected add-on. Therefore the research GLB
uses Needle's exact uncompressed stock-export floor but is deliberately
labelled **research-only**, not a complete coherent Needle export or browser
result.

## Read-only source audit

The source opens at frame 1 in Eevee with:

- active `Camera_1`, four cameras, four camera actions, frames 1–100;
- authored output 3400 × 1250, aspect `2.72`;
- Filmic plus Medium High Contrast and an enabled compositor;
- 291 objects, 285 render-visible/evaluated nonempty meshes;
- 4,148,257 evaluated triangles;
- 23 materials, all authored `DITHERED`;
- two Geometry Nodes modifiers that the existing audit can safely realize;
- four legacy `HAIR/PATH` systems configured for 31,000 parents each; and
- one `HAIR/OBJECT` system configured for 200 parents and evaluated to 1,000
  instances of `Mesh.008` at the authored frame.

The exact active Blendlink export scope contains three of the four path
systems—`ForeGround_terrain`, `MidGround2_terrain`, and
`MidGround_terrain`—for 93,000 configured parents. `BackGround_terrain` is
outside that scope through the active View Layer, so the production blocker
correctly reports three rather than using the broader datablock inventory.

The retained pre-fix plan sidecar recorded 22 used-material diagnostics:
19 `needsBake` and three `approximated`. The 19 include the scene's
Shader-to-RGB / Diffuse / Color-Ramp stylization. Before the fix, the CLI
reported `plan: null` and exited `0`; that presentation incorrectly implied
there was nothing left to solve.

## Stock/Needle-floor structural differential

The read-only probe produced:

- GLB bytes: `103,921,932`;
- SHA-256:
  `246ca906ca45c27fd089a803a4df29411ab4effc0568bed0c9ef11da8efc55fa`;
- 1 scene, 1,291 nodes, 1,285 mesh nodes, 285 meshes, 373 primitives;
- 20 emitted materials, four cameras, four animations, and two lights; and
- one mesh referenced 1,001 times, accounting for the source mesh plus the
  1,000 evaluated flower object-particle instances.

The object-particle geometry survives because it is represented in the
depsgraph instance stream. No primitive corresponding to the legacy path
field is emitted. All 20 emitted materials are `OPAQUE`; source materials
`grass` and `grass2`, used for the missing paths, do not appear. This is a
structural loss, not a size/optimization choice.

The Eevee reference differential makes the consequence visible:

![Authored Eevee render](../artifacts/release-dogfood/blender-2.91-splash/evidence/blender-eevee-authored.png)

![Same unsaved scene with path-particle modifiers disabled](../artifacts/release-dogfood/blender-2.91-splash/evidence/blender-eevee-without-path-particles.png)

Disabling only the legacy path modifiers in memory removes the dense orange
grass field. The source file was never saved. A healthy-looking emitter-only
GLB would therefore be a major visible false success.

## Chosen particle design

Two credible designs were compared.

### Design A — pass stock output through

This matches Needle's current ordinary-export floor and keeps the compiler
small, but silently removes artist-authored grass while leaving a structurally
valid GLB. It is rejected for Blendlink because loud, artist-readable failure
is a core product promise.

### Design B — automatically convert legacy paths

Automatic path conversion could eventually preserve this family with less
configuration, but a truthful adapter must cover at least:

- parent and child paths;
- strand/card thickness and camera-facing behavior;
- object/collection/path render modes;
- material and alpha semantics;
- animation and frame evaluation;
- source visibility and emitter policy; and
- payload, draw-call, and LOD consequences.

No current fixture proves that full interface. Shipping an ad hoc conversion
would replace one silent loss with a plausibly rendered but unbounded
approximation.

### Selected design — early scoped refusal

`unsupported_renderable_issues()` now owns this exporter preflight behind its
existing small interface. The implementation inspects the exact resolved
export scope, checks render-enabled `HAIR/PATH` systems with positive counts,
and returns structured evidence. `enforce_supported_renderable_transport()`
turns it into one loud refusal with a mesh/card remedy and a precisely scoped
future-adapter requirement.

This is a deepening of the existing unsupported-renderable module rather than
a new particle-specific public interface. Grease Pencil, modern Hair Curves,
and legacy particle paths now share one seam for the same user problem:
stock glTF can retain a node/emitter while dropping the artwork.

Focused differential:

1. create one cube with eight render-visible `HAIR/PATH` parents;
2. assert the exact structured issue;
3. assert the artist-readable refusal;
4. export the selection with the installed stock exporter;
5. prove the GLB contains only the emitter's one mesh/primitive; and
6. disable the particle modifier for render and prove the blocker disappears.

The registered add-on suite passed this fixture on Blender 5.2.0. The full
`npm run test:addon-headless` rerun passed build, UI-state, reflection,
web-light, real probe, and bake-save phases, then stopped in a concurrent
material-factorization assertion unrelated to this change. The direct
registered suite remains the current evidence for `NDL-GEO-001`; the root
aggregate must be rerun after shared material work settles.

## Chosen realtime-plan diagnostic design

Two designs were compared.

### Design A — treat `plan: null` as success

This is valid only when every used material already has a portable or
explicitly owned route. It failed on this scene because the deep sidecar knew
19 used materials needed a bake while the public command exited `0`.

### Design B — derive a small blocking inspection from canonical diagnostics

`inspectRealtimePlanMaterialDiagnostics(diagnostics, options)` accepts
`hasBakePlan` and an optional `applicationMaterialAdapter`, and returns
structured errors only when:

- there is no real bake plan;
- the material is used;
- its status is `needsBake`; and
- an explicit Website Material lowering has not already taken ownership.

A real bake plan retains its own acceptance policy, and unused material
residue does not block. This keeps complexity behind one pure interface shared
by JSON and human CLI output. A declared `applicationMaterialAdapter` is the
same deliberate developer-owned exception already recognized by Final
verification: the inspection moves the issues from `errors` to loud
`warnings`, records `acknowledgedBy`, and exits `0`. It does not suppress the
material names, reasons, adapter description, or browser-gate obligation.
The warning is accepted developer ownership, not successful material-fidelity
evidence.

Scenes without that explicit acknowledgement—including the untouched 2.91
Splash—remain red.

Evidence:

- `npx vitest run packages/blendlink/src/planManifest.test.ts
  packages/blendlink/src/syncMaterialCollapse.test.ts`: seven passing cases,
  including one direct plan/verify consistency assertion; and
- `node experiments/realtime-plan-material-diagnostics/run.mjs`: the real
  Blender fixture without an adapter exits `1`, emits `plan: null`, and carries
  one structured `material.used-needs-bake` error naming
  `Autumn Shader to RGB` and `Realtime Needs Bake`. The same fixture with a
  named adapter exits `0`, while both JSON and human output retain the warning,
  acknowledgement, and browser-gate consequence.

## Camera ownership: prototype only

The stock GLB contains all four cameras and maps the active source object
`Camera_1` to one loaded camera node, but glTF carries no active-camera
contract.

Needle 1.4.2's `postProcessComponents()` calls `__addCameraData()` for every
camera object. When a camera lacks an explicit Camera component, that function
adds one tagged `MainCamera` and, when scene settings allow it, adds
`OrbitControls`. It does not consult `bpy.context.scene.camera` in that camera
selection path. The only `scene.camera` use in the inspected file is for
Ground Projection's far-clip-derived radius. A nearby source TODO explicitly
acknowledges the multiple-camera/MainCamera ambiguity.

Three designs were compared:

1. **Require explicit Website Camera only.** Safest ownership, but needlessly
   discards an unambiguous source-active camera when Blendlink would otherwise
   create its own fallback.
2. **Adopt Needle's implicit all-camera candidates.** Low configuration, but
   it does not select Blender's active camera and creates ambiguous candidates
   in this four-camera scene.
3. **Bounded source-active fallback.** Preserve explicit recipe and
   application-owned cameras; use attested source-active evidence only instead
   of a package-created fallback.

The prototype selects design 3 with this precedence:

```text
explicit presentation camera
application-owned Canvas camera
attested source-active camera
package-created fallback
```

Four pure cases pass, and `Camera_1` maps exactly once in the retained stock
artifact at frame 1/aspect 2.72. Production integration is intentionally
deferred until the generated manifest can carry and attest the mapping. It
must never replace the site's Canvas camera, choose responsive composition, or
silently install controls.

## Corpus consequence

This scene justified widening the corpus: it found two release-critical,
general failures that the existing Cube and Blender 4.0 Splash cells did not.
The next high-value cells remain:

1. Blender 4.5 DOGWALK for packed PBR images, collection instances, curves,
   rigs, actions, and drivers without another Shader-to-RGB-dominated result;
2. Ellie Animation for a compact positive skinning/multiple-action gate; and
3. Blender 2.82 Tram Station as a required Grease Pencil refusal.

Broader should mean orthogonal capability coverage, not merely more visually
complex scenes. Each cell should remain zero-configuration until a named
general gap is proven, then improve Blendlink rather than adding scene-specific
configuration.

## Commands

```powershell
npm.cmd run verify:needle-baseline
node artifacts/release-dogfood/blender-2.91-splash/run-readonly-plan.mjs
node artifacts/release-dogfood/blender-2.91-splash/inspect_stock_probe.mjs
node artifacts/release-dogfood/blender-2.91-splash/prototype_camera_adoption.mjs
npx.cmd vitest run packages/blendlink/src/planManifest.test.ts
node experiments/realtime-plan-material-diagnostics/run.mjs
blender --background --factory-startup --python-exit-code 1 --python packages/blender-addon/tests/run_headless.py
```
