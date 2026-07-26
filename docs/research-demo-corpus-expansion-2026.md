# Capability-balanced demo corpus expansion, 2026

Research date: 2026-07-24

## Decision

Yes: Blendlink should test a wider spectrum of scenes. The present visual
dogfood is intentionally difficult, but it is biased toward two families:
large static dioramas and stylized Eevee splash art. Adding more splash files
without a capability matrix would increase runtime without telling us which
compiler behavior failed.

Use a fixed, tiered corpus with three independent result classes:

1. **Positive transport** must compile, build, load, render, and preserve the
   named capability.
2. **Artist-assisted transport** must first record the untouched zero-config
   result, then count every namespaced artist marker needed to pass.
3. **Expected refusal** must fail before replacing the last known-good
   artifact and name the exact renderable behavior that would be lost.

The machine-readable starting inventory is
[`demo-corpus-inventory.json`](demo-corpus-inventory.json). The repeatable,
read-only authoring inventory lives in
[`experiments/demo-corpus-audit/inventory_blend.py`](../experiments/demo-corpus-audit/inventory_blend.py).
Neither script nor this audit saves a source `.blend`.

## Why the Blender glTF manual is useful

The user-supplied
[Blender 5.2 glTF exporter manual](https://docs.blender.org/manual/en/5.2/addons/scene_gltf2.html)
is directly useful as a **portable-floor map**. It tells us which authored
domains stock glTF intends to carry: meshes, a recognized metal/rough PBR or
unlit material graph, textures, cameras, supported lights, custom-property
extras, transform/skin/shape-key animation, and the exporter options governing
selection, evaluated data, animation, and images. It also names important loss
surfaces: Blender and glTF material systems differ, non-mesh data may need
conversion, and arbitrary material/light/physics animation is not core glTF
animation.

It is not a visual-parity oracle. A valid GLB can still omit Grease Pencil or
Hair Curves, flatten a Shader-to-RGB material to a plain factor, lose
compositing, or carry geometry while erasing the authored look. Blendlink's
job begins where “stock export completed” stops: classify the complete
renderable dependency graph, compile the portable representation, attest the
artifact, and refuse artistic collapse loudly.

Use the manual together with the actual installed exporter implementation and
the [Khronos glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html).
The manual describes intended behavior; the installed
[glTF-Blender-IO source](https://github.com/KhronosGroup/glTF-Blender-IO)
decides the exact Blender-version behavior; the specification defines what the
artifact can claim.

## Designs compared

### Design A: ad hoc gallery sweep

Download visually impressive scenes, run `publish`, and fix the first visible
problem in each. This produces screenshots quickly, but one scene can combine
materials, evaluated geometry, animation, transparency, compositing, and
unsupported renderables. A failure has poor diagnostic locality, and a
scene-specific tweak can masquerade as compiler progress.

### Design B: fixed capability cells and a configuration ladder

Give every source an immutable identity, license/provenance record, source
render engine, capability tags, cadence, expected result class, Blender
reference frames/views, and Needle comparison cell. Run the untouched source
first. Permit artist assistance only through a counted namespaced marker
budget; application configuration remains post-processing, interactivity, and
the website-owned loading/route integration.

Choose **Design B**. It creates one deep corpus-runner module with a small
future interface such as:

```text
run corpus { tier, scene ids, baseline } -> evidence report
```

Acquisition, Blender inspection, Blendlink planning, Needle export, generated
website harnesses, browser capture, image/object comparison, artifact
attestation, and cleanup stay inside the implementation. Scene entries declare
facts and expectations; they do not grow their own orchestration scripts.

## Configuration ladder

The corpus must make “little configuration” measurable:

- **Zero configuration:** immutable source path plus generated scene name only.
  No source mutation, application material adapter, scene-specific runtime
  patch, or special compiler option.
- **Minimal artist configuration:** only `blendlink_*` intent authored in a
  derivative `.blend`, plus application-owned post-processing or interactivity.
  Record the count, objects/materials affected, and why automatic inference
  could not be truthful.
- **Research-only:** generated material rewrites, non-namespaced source edits,
  custom application material adapters, or scene-specific runtime patches.
  These may answer a question but cannot support a zero/minimal-config claim.

Every artist-assisted scene retains its untouched zero-config result beside the
derivative. Tool improvements must be validated by deleting or reducing
markers in later runs; otherwise the corpus rewards configuration growth.

## Two orthogonal axes: source scenes and capability lanes

Broader coverage should not mean “download every attractive `.blend`.” The
scene corpus and the conformance corpus answer different questions and should
cross-check one another:

1. **Generated Blender exporter cells** isolate one authored behavior at a
   time: stock PBR and unlit inputs, alpha modes, every glTF material extension
   emitted by the installed exporter, transforms, cameras, punctual lights,
   constraints, drivers, skins, morphs, and actions. These are the fast
   compiler regressions.
2. **Official Blender production scenes** exercise combinations that small
   fixtures cannot anticipate: Cube Diorama, the 2.91/3.6/4.0/4.5 splash
   families, and Ellie. These are Blender-to-web compiler dogfood.
3. **Official Khronos glTF assets** start after Blender export and exercise
   runtime loading, animation/interpolation, skins/morphs, extensions, decoder
   paths, and multi-file asset closure. Compare them with Khronos Sample
   Viewer, not with a Blender render. The
   [sample repository](https://github.com/KhronosGroup/glTF-Sample-Assets)
   explicitly separates Testing, Core Only, Complete, and Showcase lists and
   records per-model licenses. The first pinned 20-cell implementation is now
   verified structurally and in Chromium; see
   [`research-khronos-runtime-corpus-2026.md`](research-khronos-runtime-corpus-2026.md).
4. **Deployment matrices** exercise the website boundary independently:
   Next/Vite base paths, CDN origins, strict CSP, worker policy, CORS, missing
   companions, WebGL loss, zero-height Canvas, and production-build smoke.

A production scene can expose a failure, but the smallest relevant generated
or Khronos cell must become its durable regression whenever possible. This
keeps release gates fast and tells us whether a failure belongs to Blender
compilation, glTF transport, Three runtime policy, or website deployment.

The installed Blender 5.2 exporter and installed Three GLTFLoader are also an
explicit compatibility pair. Blender can emit extensions that a particular
Three revision does not consume. The generated lane must therefore enumerate
the exporter’s actual extension set and fail loudly when a required extension
has no runtime path; a successful stock export is not sufficient evidence of a
renderable Blendlink artifact.

## Tiered source-scene corpus

### Pull-request conformance

Keep this under a few minutes and make each failure local:

- generated stock-PBR/unlit/alpha/animation primitives;
- Pip's CC-BY 4.0 animated Shader-to-RGB refusal;
- CC0 Jiggly Pudding Simulation Zone refusal; and
- CC0 Animal Fur Hair Curves refusal.

These tests prove contract edges, not full-scene visual quality.

### Nightly positive and artistic stress

- Cube Diorama: Cycles, evaluated-geometry cost, complex materials, area
  lights, baking, and performance;
- Blender 3.6 Splash / Pet Projects: Eevee, a small entry scene backed by 30
  linked `.blend` libraries, 14 external TIFFs (including two numbered
  texture tiles), library-authored rigs/nodes/lights/cameras, and complete
  external-dependency closure;
- Blender 4.0 Splash: Eevee, selected fields, alpha, object completeness,
  world volume, and distributed Geometry Nodes;
- Blender 2.91 Splash: Eevee foliage, five particle systems, 20 Shader-to-RGB
  nodes, dithered materials, two Geometry Nodes modifiers, and four animated
  cameras.

Use a generated Blender rig/action fixture and Khronos `RiggedSimple` for the
small positive skinning cells. The official Ellie bundle proved to be a
production rig, not a compact conformance asset.

### Release/manual production stress

- Blender 4.5 DOGWALK Splash: a 401,947,045-byte production file with 70
  packed images, 39 collection instances, 90 render-visible meshes, seven
  render-visible curves, nine Geometry Nodes modifiers, five armatures, 52
  actions, and 131 drivers at the authored static frame 85;
- Ellie Animation: an Eevee production rig with 104 render-visible meshes, 58
  actions, 3,226 drivers, 14 shape-key objects, 53 complex materials, seven
  legacy path-hair systems, and two embedded Python rig scripts;
- Blender 2.82 Tram Station: Grease Pencil loss remains a required loud
  negative result; and
- TrapX: a verified private, immutable Cycles material negative. Its Final
  plan and compile now refuse the same fourteen unsupported active-Surface
  behaviors and preserve the complete prior publication; its retained stock
  browser floor proves why a healthy GLB load is not appearance parity.
  Fixed-camera or portable-optics work remains local until redistribution
  rights are recovered.

Large-scene cadence is not capability priority. A 165 KiB Simulation Zone file
can be more important to the release contract than a 400 MiB screenshot.

## Read-only audit of the two newly noticed local splash files

### Blender 2.91 — Red Autumn Forest

- Exact source: 69,359,275 bytes; SHA-256
  `b60bd6d566d202cc9cd8c0bd260a45be0ab8c37fc24e0d2e9c909efa41e94655`.
- Official splash mirror download; its NTFS origin records the Blender mirror.
- Embedded README: Robin Tran, CC-BY-SA 3.0.
- Eevee, frames 1–100, 291 scene objects, 285 render-visible meshes, 23
  materials, three images, one packed image, two Geometry Nodes modifiers,
  five particle systems, 20 Shader-to-RGB nodes, four cameras, and seven
  actions.
- Current Blendlink procedural audit sees the two Geometry Nodes objects as
  realizable. The completed zero-config run then proved that three
  render-visible legacy `HAIR/PATH` systems in the exact export scope configure
  93,000 parent particles that stock glTF does not transport. Blendlink now
  blocks them before export. A retained pre-fix sidecar also exposed 19 used
  `needsBake` materials behind a misleading `plan: null`; the planner now
  blocks that state unless a named application adapter accepts a loud warning.

This is now a verified expected-refusal regression. No Preview was emitted.
The active-camera fallback design remains a four-case Prototype and is not
production behavior. See
[`research-blender-291-zero-config-2026.md`](research-blender-291-zero-config-2026.md).

### Blender 4.5 — DOGWALK

- Exact source: 401,947,045 bytes; SHA-256
  `7f8718cfd89baf59151cc4ba431eeab38b9ff260ffa0054d93293f228a70cc36`.
- Official splash mirror download; the source opens at one authored frame,
  85, in Eevee.
- 185 objects: 90 meshes, seven curves, 79 empties, five armatures, one
  camera, and two Suns. It also has 43 materials, 73 images (70 packed), 39
  collection instances, nine Geometry Nodes modifiers, 52 actions, and 131
  drivers.
- Unlike Splash 4.0, the datablock inventory contains no Shader-to-RGB node
  and contains 120 image-texture nodes. It is therefore a useful independent
  test of packed image/PBR transport, evaluated instances/curves/rigs, and
  source-object completeness rather than another selected-field-only test.
- The local `.blend` has no embedded license statement. The official
  [DOGWALK release note](https://studio.blender.org/blog/dogwalk-early-access/)
  says the whole project is Creative Commons, but it does not state the exact
  variant in the accessible text. Keep source and derived captures local until
  that exact license is pinned.

The zero-config and structural authored-frame audit is now complete. Final
planning returns no plan and names 22 used materials that need a portable
route; Final compilation independently blocks driven camera-data animation
before publication. The source hash remains exact. Pinned-Needle-equivalent
stock, current-frame, current-pose, and current-pose-plus-Actions controls
separate frame-zero camera state from armature rest pose and from the remaining
material/lighting/compositor gaps. See
[`research-blender-45-dogwalk-zero-config-2026.md`](research-blender-45-dogwalk-zero-config-2026.md).
At 402 MB it remains in the release/manual lane until measured wall time and
peak memory justify nightly use.

### Blender 3.6 — Pet Projects linked production bundle

- Exact local archive: 256,907,103 bytes; SHA-256
  `d3e31955432149483d70e5a61b0b03f56b037b467265556449d58a302c8f3b58`.
- Production bundle layout: 90 archive entries, 31 `.blend` files, 14 external
  TIFFs, and a 7,878,056-byte entry scene at
  `blender-3.6-splash/blender-3.6-splash.blend`.
- The embedded README identifies the Pet Projects open movie and says to open
  the entry scene and render it. It does not state an exact license.
- Unlike the packed-image DOGWALK case, this scene makes the entire linked
  library and external texture closure part of source truth. It can detect
  accidental dependence on the current working directory, incomplete archive
  staging, missing linked datablocks, numbered-tile/UDIM loss, and attribution
  gaps before export.
- The isolated audit is now verified. Blender 5.1.2 resolves all 30 library
  paths and all 24 referenced images with auto-execution disabled, while still
  exposing two missing linked IDs, seven registered scripts, restricted driver
  evaluations, and five render-visible POLY Curve objects whose evaluated
  `to_mesh()` result is `None`. The previous Blendlink 5.1 plan surfaced the
  latter as an internal `AttributeError`. A generated linked-`POLY`
  differential now passes on Blender 5.1.2 and 5.2.0 LTS, and the untouched
  bundle rerun names `GEO-electrical_wire.blue` / `NurbsPath.014` plus its
  source library and remedies. Blendlink never substitutes raw spline points
  for missing evaluated geometry.
- Blender 5.2.0 LTS reproducibly crashes in its native library-override read
  path before Blendlink Python can run. Blendlink reports abnormal exit code
  11 and the access-violation tail and never silently retries 5.1. This is a
  verified platform boundary, not a known-issue-registry entry: no public
  primary issue for the exact crash has been pinned.

Keep the archive, isolated extraction, and any derivatives local until the
exact license is pinned. The reusable evidence, exact source identities, two
versioned plan results, and design comparison are recorded in
[`research-blender-36-linked-bundle-2026.md`](research-blender-36-linked-bundle-2026.md).
No screenshot or visual-parity claim is made yet.

### Ellie Animation — production rig, not compact positive

- Official archive: 25,491,843 bytes; SHA-256
  `b0293d1f5b39b654236deaf8b7dd0f215be503db2afe9c98d96610a1a97700db`.
- Entry `.blend`: 25,591,121 bytes; SHA-256
  `20e00af5488721c5bf5a10534e7f6a5cef667849c671773daf8348b7c1237b9e`.
- Both embedded README text blocks state `License: CC-BY`; the exact license
  version and required attribution string remain to be pinned.
- Read-only Blender 5.2 inspection with Python auto-execution disabled found
  144 objects, 104 render-visible meshes, one armature, 58 actions, 3,226
  drivers, 14 objects with shape keys, 53 materials, 11 packed images, and
  seven legacy `HAIR/PATH` particle systems. The file tried to register
  `cloudrig.py` and `rigged_particle_hair.py`; neither script was executed.
- The materials are primarily Dithered and contain large procedural/grouped
  graphs, including Hair BSDF, Light Path, Camera Data, Layer Weight, and
  hundreds of math/vector operations.
- The untouched 2026-07-25 Final plan is a verified loud refusal: `plan` is
  null with 41 `material.used-needs-bake` errors across 41 used materials, the
  source SHA-256 remains exact, and no publication file is emitted. The
  diagnostics name both material and owning mesh and enumerate the non-portable
  active inputs instead of allowing a plausible but collapsed stock export.
  The repeatable evidence runner and complete plan live in
  [`experiments/ellie-zero-config-audit`](../experiments/ellie-zero-config-audit).

This is a valuable release/manual stress scene, but using it as the only
“positive animation” case would conflate rig transport with particle hair,
material compilation, driver security, and embedded scripts. Keep the
generated authored-frame fixture as the Blender exporter-positive cell and
add Khronos `RiggedSimple`/`Fox` for runtime skin and named-clip coverage. Run
the refusal as a regression until a general material route clears preflight;
only then should the same immutable source advance to rig, driver, hair,
browser, and visual gates. Treat any required derivative markers as a measured
artist-assistance budget.

## Automated evidence ladder

Each positive or artist-assisted cell should produce one evidence directory
with these phases:

1. **Acquire/identify:** verify source SHA-256, bytes, provenance, license, and
   no source modification. Disable Python auto-execution.
2. **Read-only inspect:** capture engine, frame/view, active camera, objects,
   supported and unsupported renderables, evaluated/source topology, material
   graph blockers, images/libraries, animation ownership, and external
   dependencies.
3. **Zero-config plan:** run Final planning without replacing website
   artifacts. A blocker must name the object/material/behavior and remedy.
4. **Compile and attest:** if planning permits, verify the complete
   content-addressed asset graph, renderable/object mapping, material/alpha
   evidence, animations, camera, lights, and companion files.
5. **Website build and browser smoke:** exact response hashes, HTTP 200,
   nonzero Canvas size, nonblank render, WebGL context, no page/console/request
   errors, and declared CSP/decoder-worker expectations.
6. **Three-way visual evidence:** render Blender's selected engine at the
   authored camera/frame, the pinned Needle cell, and Blendlink. Require
   object-ID completeness and semantic masks in addition to full-frame
   MAE/RMSE. Full-frame error alone can hide a missing lamp or plant.
7. **Performance/determinism:** record compile time, peak memory, transfer/GPU
   bytes, triangles, draw calls, programs, ready latency, steady frames, and
   repeat-run artifact identity. Set thresholds only after a stable baseline.

Positive success requires all applicable phases. An expected-refusal scene
passes at phase 3 only when no Final artifact was emitted and the exact
diagnostic matches. Browser nonblank is never a substitute for visual or
object completeness.

## Needle comparison contract

Every behavior-level conclusion remains a three-column result:

```text
Blender source truth | pinned Needle result | Blendlink result
```

Before a scene can support a Match/Improvement claim:

- run `npm run verify:needle-baseline`;
- record the exact Needle add-on/runtime/build identities and hashes from
  [`needle-baseline.json`](needle-baseline.json);
- export the same immutable source, camera, frame, and visibility state;
- use a named coherent integration, not the global mixed-source inventory;
- record uncompressed Preview separately from the still-pending licensed
  production transform; and
- compare artifact completeness and visible pixels, not merely whether Needle
  also produced a GLB.

The current coherent named cell is `splash-official-preview`: Needle add-on
1.4.2, Engine 5.1.4, Vite 8.0.3, and its pinned browser evidence. It proves one
official Preview path, not Needle production compression. Where Needle also
silently drops a renderable, Blendlink's early named refusal can be recorded as
an Improvement only after a differential fixture independently fails the two
outcomes.

## Next five runs

1. **Blender 4.5 Splash:** retain the verified zero-config refusal and its
   four structural controls. Re-enter Final only after general material and
   property-animation work independently clears the named blockers; do not
   turn the source into a scene-configured success.
2. **Blender 3.6 Splash bundle:** retain the verified isolated closure,
   version-boundary evidence, generated evaluated-Curve regression, and
   repaired immutable 5.1 refusal. Add a small missing-linked-ID regression
   before attempting any repair; do not silently downgrade after the verified
   5.2 native loader crash.
3. **Ellie Animation bundle:** retain the verified zero-config material
   refusal with autoexec disabled. Re-enter the later rig, driver, legacy-hair,
   browser, and visual phases only after a general material compiler route can
   independently clear the 41 current blockers. Do not replace the small
   generated/Khronos positive animation cells with this compound scene.
4. **Blender 2.91 Splash regression:** require the same three-system/93,000
   parent refusal until a dedicated transport can independently prove the
   missing path behavior.
5. **TrapX private regression:** retain the verified zero-configuration
   plan/compile refusal and byte-identical last-good publication. Re-enter
   only through a general portable-optics subset or the surface-scoped
   fixed-camera Appearance route, locally. It fills the Cycles
   Fresnel/glass/transparency/compositor gap but must not become public
   release evidence without a recovered redistribution license.

This order broadens capability coverage while the active Splash 4.0 work
continues. It does not postpone current object/material fixes, and it avoids
turning Blendlink into a pile of demo-specific configuration.

## Evidence status

- **Verified read-only:** exact local hashes, embedded license text for Cube,
  Splash 4.0, and Splash 2.91, plus the listed Blender 5.2 datablock counts for
  Cube and Splashes 4.0/2.91/4.5.
- **Previously verified:** Cube/Splash 4.0 dogfood gates and Pip, Hair Curves,
  Simulation Zone, and Grease Pencil refusal fixtures as recorded in the
  existing research notes.
- **Verified expected refusal:** Splash 2.91 source identity, stock/Needle-floor
  structural export, Eevee path-particle visual differential, active-scope
  blocker, and realtime material-plan CLI differential.
- **Prototype:** the reusable read-only corpus inventory script, cadence
  design, and bounded source-active-camera precedence.
- **Verified expected refusal:** Ellie source identity, 41 used-material
  blockers, unchanged source hash, null Final plan, and zero publication.
- **Verified post-export runtime corpus:** 20 official Khronos assets, 26
  exact files/6,703,746 bytes, core skin/morph/interpolation/transform/UV
  behavior, eleven Three-built-in material extensions, and two independently
  failing unsupported animation-extension cells.
- **Verified Blender 5.2 exporter matrix:** broad core/KHR material structure,
  Three r184 construction, byte-identical Blendlink/Needle-equivalent stock
  output, exact alpha-clip grammar controls, and an independently failing
  procedural Noise control. See
  [`research-blender-52-exporter-cells-2026.md`](research-blender-52-exporter-cells-2026.md).
- **Verified linked-production boundary:** Blender 3.6 archive/extracted
  identity, 30/30 resolved library paths, 24/24 resolved images, two missing
  linked IDs, seven skipped registered scripts, five sidecar curve failures,
  generated 5.1/5.2 no-raw-fallback diagnostic evidence, unchanged source
  hash, repaired loud 5.1 plan failure, and reproducible loud Blender 5.2
  native loader crash.
- **Verified DOGWALK production stress:** immutable-source read-only inventory,
  22-material zero-config refusal, driven camera-data compile refusal,
  Needle-equivalent stock structural floor, and current-frame/current-pose
  browser controls. A publishable Blendlink artifact, exact license, full
  three-way material/lighting/compositor visual evidence, physical-GPU
  performance, and repeat-run determinism remain pending.
- **Verified TrapX private material regression:** immutable source identity,
  authored Cycles/compositor frame, identical fourteen-reason Final plan and
  compile refusal, unchanged stable/addressed runtime graph plus manifest,
  generated scene module, and baked recipe module, and a Chromium-loaded
  stock/Needle-equivalent floor whose missing
  optical/compositor semantics are measured and visually retained. A portable
  optical lowering or production fixed-camera appearance transport remains
  Future.
- **Pending:** browser/performance/determinism evidence for any future Splash
  2.91 path transport; exact license,
  a general missing-ID diagnostic/remedy, and any later browser/visual evidence
  for Splash 3.6; exact CC-BY version and any post-material visual/animation
  evidence for Ellie; and any future accepted TrapX appearance transport.
