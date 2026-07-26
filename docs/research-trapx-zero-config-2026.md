# TrapX painterly shader zero-configuration audit (2026)

Status: **research complete; the Final material gate fix is Shipped and
Verified; no TrapX appearance transport was added.**

This note audits the private local scene
`C:/Users/micha/Downloads/TrapX - Stylized Painting Shader.blend`. The goal is
not to hand-configure one attractive sphere. It is to find reusable Blendlink
behavior for Cycles-authored Fresnel, glass, transparency, painterly
procedurals, packed images, and camera-space presentation.

Redistribution rights have not been pinned. The source, packed images,
rendered frames, and exported GLBs remain in the ignored
`experiments/trapx-zero-config-audit/output/` directory. No scene-derived
binary is part of this change.

## Conclusion

TrapX is a valuable narrow stress test because its geometry is trivial while
its appearance is not. One mesh and one material isolate the exact class of
failure that a successful GLB load can hide:

- the source truth is a one-frame Cycles render, not Eevee;
- one custom group combines Principled, Glass, two Transparent closures,
  Emission, Fresnel, Add/Mix Shader, Voronoi, Bump, Normal Map, and two image
  textures;
- the camera presentation also uses two Lens Distortion nodes and Glare in the
  compositor;
- the stock Blender/Needle path can discover the Principled subset and one
  packed painting image, but it does not preserve the surrounding shader
  algebra;
- the resulting GLB is structurally healthy but materially opaque and has no
  transmission/volume/custom-shader representation.

The untouched Blendlink Final planner correctly identifies that semantic loss:
it exits `1` with one `material.used-needs-bake` error and fourteen concrete
reasons. The first identical Final compile exposed a real consistency bug: it
published the stock floor while its manifest still said `needsBake`. The
compiler now reuses the staged export's exact sidecar diagnostics before
optimization or commit. The fixed command exits `1`, repeats all fourteen
reasons, discards the stage, and leaves the retained prior bytes unchanged.
The plan/compile gate is therefore **Shipped and Verified**, not an open
interpretation.

Needle is not a hidden solution for this graph. The exact inspected Needle
Blender add-on delegates ordinary materials to Blender's stock glTF exporter.
Its opt-in Cycles lightmap bake is a combined lighting bake, not an automatic
unsupported-material fallback. Its runtime can consume MaterialX or
custom-shader extensions, but add-on 1.4.2 does not produce either from
Blender nodes.

The likely artist-first direction is therefore a truthful choice between:

1. an exactly recognized portable optical/PBR subset;
2. an explicit fixed-camera appearance route for the complete authored still;
3. a loud block when neither contract applies.

`materialCompilation: preserved/full-surface` describes the material
compiler's intervention scope: no selected-field lowering replaced the full
stock material. It does not override the independent portability status
`needsBake`. Final acceptance must use both contracts and may not imply that
an ordinary UV bake preserves view-dependent Fresnel/refraction.

## Identity and immutable-source evidence

Source:

- file bytes: `41,863,981`
- SHA-256:
  `d32731c7983e59546893bcc7fd4ef5c14532b0b2e782f63fa7ef9ed4faafb6ae`
- saved Blender version: `3.6.11`
- local audit host: Blender `5.2.0 LTS`, build `fbe6228777e7`
- opened with `--factory-startup --disable-autoexec`
- exact hash before and after every completed inventory/render/plan/compile
  probe: unchanged

Hardware used for the authored source render:

- NVIDIA GeForce RTX 5080
- driver `596.21`
- reported memory `16,303 MiB`
- Cycles CUDA, 512 samples, denoising enabled

The successful authored render uses the scene's own one-frame FFMPEG/H264
output because Blender 5.2 keeps that contextual file-format enum restricted
to `FFMPEG` for this file in background mode. Blender renders frame `0`, runs
the compositor, and writes a one-frame movie. Chromium then decodes that movie
to a review canvas.

Local review artifacts:

- authored H264 SHA-256:
  `f99ee5903d97c93d6c73a1fbb66a2ded6b443043b881e1ce5e870e22123ec52a`
- decoded PNG SHA-256:
  `a744de038968bf9fae9512c65488975587a6be9f46d147c471d47c00a635e8f2`

The decoded still is suitable for human comparison, not lossless pixel
thresholds. It shows the intended pale painterly sphere, dense brush-stroke
variation, chromatic/refractive rim, and warm lower-right translucency on
black.

## Source truth

| Property | Authored value |
| --- | --- |
| Engine | Cycles |
| Frame / range | `0 / 0..0` |
| Camera | `Camera`, perspective, 44 mm |
| Resolution | `1080 x 1080`, square pixels |
| Color | sRGB display, Standard, Look None, exposure 0, gamma 1 |
| World | black Background, strength 1 |
| Lights | two shadowed Suns, energies 5 and 1.5 |
| Renderable geometry | one Icosphere |
| Other objects | one camera, two lights, one render-hidden Font |
| Compositor | Render Layers, two Lens Distortion, Glare, Group Output |

The camera has a CamFX participation property, but its generated bokeh and
lens-dirt object references are null in this saved scene. Two unpacked CamFX
images are missing and report `0 x 0`; Blendlink proves they are used only by
material graphs outside the render-visible export scope and warns without
blocking. The other 45 of 47 images are packed.

## Active material closure

`Icosphere` uses `Showcase`. Its active Material Output is driven by
`Stylized Painterly Shader - TrapX`, whose node inventory is:

| Node family | Count |
| --- | ---: |
| Principled BSDF | 1 |
| Glass BSDF | 1 |
| Transparent BSDF | 2 |
| Emission | 1 |
| Fresnel | 1 |
| Add Shader | 2 |
| Mix Shader | 2 |
| general Mix | 6 |
| Voronoi Texture | 2 |
| Image Texture | 2 |
| Bump / Normal Map | 1 / 1 |
| Invert / Math / Mapping / Texture Coordinate | 2 / 2 / 1 / 1 |

The material's saved surface render method is Dithered. That setting is not a
portable substitute for the two Transparent BSDF closures, and transparency
coverage is not the same contract as optical transmission.

This is exactly where the Blender 5.2 glTF manual supplied by the maintainer is
useful. It documents a recognized metal/rough Principled material model,
ordinary image channels, alpha modes, and extensions such as
`KHR_materials_transmission`; it does not promise arbitrary Blender shader
graph transport. The installed exporter source is the behavioral truth for
this run.

## Exact Blender/Needle baseline

`npm.cmd run verify:needle-baseline` passes:

```text
BLENDLINK_NEEDLE_BASELINE_VERIFIED 130 files, 9 source version identities
(2026-07-25) integration=mixed-source
named=splash-official-preview:coherent
```

Relevant identities:

| Source | Version / normalized path | SHA-256 |
| --- | --- | --- |
| Needle Blender add-on | `1.4.2`, `blender_export.py` | `6272997cfb4f1d740ea33a7c2512983b9993dedf93c9c8240ca0ff7f82925d77` |
| Needle archive | `needle-blender-plugin-1.4.2.zip` | `d947ab298f6c6e47591321ba462c8b21ada2229bc640262cad9998564a0e745a` |
| Blender glTF add-on | `5.2.39`, `__init__.py` | `0cd8903bd1a72ef1edbd728bee70d24a3ecc93c9901db68927b00910bb38be70` |
| Blender material traversal | `blender/exp/material/search_node_tree.py` | `0c037d078db37da3b6d65054206a9f55d19fa5f8ca6542f5add614230c39f7e9` |
| Blender material gather | `blender/exp/material/materials.py` | `f0678496e6762566727fc9c76264c7d7665b2f22dee4671b63cfefe968ed5c31` |
| Blender PBR gather | `blender/exp/material/pbr_metallic_roughness.py` | `1ecdd7caa392d58234c444a428e2c4d8d6d4b673ca9cf5630ff50c6a94a04d56` |
| Blender unlit recognizer | `blender/exp/material/unlit.py` | `71a8dc2fdcb0b05ec4f4c52c15607b45f08b69f1553fdf6abfaf891815fe5aa4` |
| Needle build pipeline | `3.0.0`, `dist/cli/index.js` | `73afd7b8fdacf74717577e22bfb899ce080ca00bcc4ccdcf6dbfaad52bb144d1` |
| Needle Preview runtime | `@needle-tools/engine` `5.1.4` | package identity in the verified named coherent cell |

Needle add-on 1.4.2 calls `bpy.ops.export_scene.gltf`. The installed Blender
exporter recursively finds linked Principled inputs and writes recognized
stock glTF channels. It does not evaluate the surrounding Add/Mix/Fresnel/
Glass/Transparent/Voronoi closure. Its unlit path recognizes two narrow
Transparent/Mix patterns; that is not a general transparent shader compiler.

Needle's MaterialX and `NEEDLE_techniques_webgl` loaders consume already
produced extensions. Complete source search finds no producer for either in
the inspected Blender add-on. The detailed paths, hashes, and line-level
findings are retained in
`experiments/trapx-zero-config-audit/needle-source-audit.md`.

The broad Needle inventory is mixed-source. Only the named official Preview
cell is coherent; production compression findings remain source-audited, not a
TrapX production-browser claim.

## Untouched Blendlink Final plan

Configuration contains only:

- Blender 5.2 executable;
- source path and scene name;
- local output/generated directories;
- a local URL prefix.

There is no material adapter, recipe, bake marker, quality override, or
scene-specific shader configuration.

Command:

```text
node packages/blendlink/dist/cli.js plan trapxUntouched --json
```

Result:

- requested quality: `final`
- exit code: `1`
- `plan: null`
- one error, code `material.used-needs-bake`
- material: `Showcase`
- used by: `Icosphere`
- source hash unchanged

The fourteen reasons name:

- Add Shader and Mix Shader branch loss;
- Math, general Mix, Fresnel, and Invert as nonportable;
- Voronoi contribution;
- Bump without a directly portable tangent-space image path;
- Transparent and Glass BSDF;
- linked Subsurface Scale and nonportable Normal;
- Emission response differences;
- omitted Subsurface Weight.

This is good artist-facing diagnosis: one error explains the complete active
surface instead of failing later as “the GLB loaded.”

## Untouched compile gate

Command:

```text
node packages/blendlink/dist/cli.js compile trapxUntouched --force
```

The first run before the gate fix exited `0` and emitted a `5,103 kB`,
1,280-triangle stock floor. Its manifest records `Showcase` as `needsBake`
with the same fourteen reasons and also records:

```json
{
  "intent": "automatic",
  "outcome": "preserved",
  "fidelity": "full-surface",
  "limitations": [],
  "transport": "stock"
}
```

Those fields are not contradictory. `preserved/full-surface` means the
selected-field compiler did not replace the stock material; it is not a
portability or visual-fidelity success signal. The bug was that Final did not
enforce the separate `needsBake` result before publication.

The current exact command now returns:

- exit code `1`;
- source hash unchanged;
- one `Blendlink Material Fidelity refused to publish trapxUntouched` error;
- the same material, user, summary, and fourteen reasons as `plan`;
- explicit next actions: Website Material, portable glTF, or supported
  Appearance;
- explicit transactional result: staged export discarded, previous
  publication unchanged.

Current implementation identities:

- `packages/blendlink/src/sync.ts` SHA-256:
  `faa6592ed5231f502a74293e7a5899397bf965ad13a36979b812f6371ba9c67e`
- `packages/blendlink/dist/sync.js` SHA-256:
  `06d801507ed8431c3c4c22869d444268c1af96ffa90205c638c3f1d22cb11146`
- `packages/blendlink/src/planManifest.ts` SHA-256:
  `4b5e00bf63790236b12080d83e7fa9e67f055ec577d2c7acb5e76a63b326d16f`
- `packages/blendlink/dist/planManifest.js` SHA-256:
  `9e753512aa2180a7cc43c97a64da45d679a785204824240285a0fa168ba0ef08`
- `packages/blendlink/dist/cli.js` SHA-256:
  `7ef29e97fe17530611e63f3084d4ad1069f2bb6f3b21fe6abfe80ed262c6dbb7`
- `packages/blendlink/dist/blender/export_scene.py` SHA-256:
  `9ea88103fbafcfad431ad409ebb67305d4a31e30309ac7c64d444548a2050dd5`

The real-scene runner hashes the complete retained scene-publication set
identified by the retained manifest before and after the refused compile.
That manifest has one runtime-asset-graph entry and declares no companion
files:

| Retained artifact | SHA-256 before and after |
| --- | --- |
| stable `blendlink/trapxUntouched.glb` | `d22ef7be85467c5d808ab1ba02d18560a35eb25ca3f2e7992d4799522e19267b` |
| immutable `blendlink/trapxUntouched/ce2bac49a10ac8cc875a72a4e934f58e8c68f9d2af2016e1d5ecc0c3864c148b/trapxUntouched.glb` | `d22ef7be85467c5d808ab1ba02d18560a35eb25ca3f2e7992d4799522e19267b` |
| `generated/trapxUntouched.manifest.json` | `b7e02dd5c6c18b18d63aae1f8dc33963130eb3b195894f5b5353f39547d6e182` |
| `generated/trapxUntouched.gen.ts` | `04a12fac5677eb0fd9a4be900ad50294c67e23c3fba8e1d3e440105d83f47316` |
| `generated/trapxUntouched.baked.ts` | `a0bac0fea523dda9fe3c9b9413a150647700e5be8e5cef4d7a2cb91978cd0949` |

The graph fingerprint is
`ce2bac49a10ac8cc875a72a4e934f58e8c68f9d2af2016e1d5ecc0c3864c148b`.
The runner reports all five artifacts unchanged. This is an exact scoped
claim; it does not infer the state of unrelated publications.

The focused integration fixture
`syncMaterialPortability.integration.test.ts` independently proves that the
gate removes its stage, creates no GLB/manifest/module, and still permits an
explicit named application-owned material adapter while retaining a visible
warning and browser-gate requirement.

Exact focused command, passed 2026-07-25:

```text
npm.cmd run test --workspace blendlink -- syncMaterialPortability.integration.test.ts
```

Result: one test file and one test passed (`172 ms` test time, `812 ms`
total).

## Retained pre-fix stock structural floor

The pre-fix GLB is retained only as a stock/Needle-equivalent structural
floor. It is not a successful publication under the current Blendlink Final
gate.

The retained GLB:

- bytes: `5,225,384`
- SHA-256:
  `d22ef7be85467c5d808ab1ba02d18560a35eb25ca3f2e7992d4799522e19267b`
- generator: `Khronos glTF Blender I/O v5.2.39`
- four nodes: camera, Icosphere, and two Suns
- one mesh, one primitive, one material
- one embedded PNG, `5,185,598` bytes
- two Texture definitions that reuse that image as Base Color and Normal
- one camera and two `KHR_lights_punctual` directional lights
- no animations

The sole material is `OPAQUE`. It has:

- Base Color texture and Normal texture with the same `7 x 7` transform;
- metallic `0`, roughness about `0.5487`;
- `KHR_materials_specular`, `KHR_materials_ior`, and
  `KHR_texture_transform`;
- no `KHR_materials_transmission`;
- no `KHR_materials_volume`;
- no alpha blend/mask;
- no custom-shader or MaterialX extension;
- no representation of the compositor.

This proves useful structural/image transport and simultaneously proves that
the GLB cannot encode the authored Transparent/Glass/Fresnel/compositor
response.

Chrome `150.0.7871.182` and Three `0.184.0` load the exact retained bytes with
no page, console, or request failures. The result is one
`MeshPhysicalMaterial`, but it is opaque (`transparent=false`, `alphaTest=0`,
`transmission=0`, `thickness=0`). The painting PNG is used as both Base Color
and Normal inputs. The exported camera sees a strongly red/orange opaque
sphere, while the authored Cycles reference is pale gray, translucent at the
warm lower-right edge, and chromatically refracted around the rim.

Descriptive H264-review metrics:

- source foreground pixels: `829,785`;
- floor foreground pixels: `741,017`;
- silhouette intersection-over-union: `0.893023`;
- all-pixel mean absolute RGB error: `63.526672`;
- union-foreground mean absolute RGB error: `89.199887`;
- source foreground mean RGB:
  `[139.479, 138.337, 138.485]`;
- floor foreground mean RGB:
  `[113.166, 39.033, 21.886]`.

These metrics quantify the visible gap but are not release thresholds because
the source still is H264-decoded and the floor runs through SwiftShader with
no Needle post stack or Blender compositor.

## Designs compared

### Compile-gate design A: run a second plan-only Blender pass

Credible but rejected. Compile could invoke `blendlink plan` first, then start
the real export only after the plan succeeds. That is easy to describe, but it
duplicates Blender startup and scene evaluation. Drivers, dependency state,
temporary resources, or source edits between passes could make the inspected
scene differ from the staged artifact.

### Compile-gate design B: reuse the staged export's exact sidecar diagnostics

Chosen and shipped. The real export already produces the complete scoped
diagnostics before optimization and publication. Final now applies the same
material inspection to that exact sidecar while the GLB remains in its private
stage. A refusal removes the stage and does not replace the prior publication.

This avoids duplicate Blender work and evaluation/state drift. The real TrapX
loop proves identical `plan`/Final reasons and an unchanged five-artifact
retained publication set; the focused integration fixture proves clean
staging, no new publication, and the explicit adapter path.

### Material transport A: treat stock glTF extraction as successful preservation

Rejected. It is small, standard, and easy for developers, but the TrapX floor
selects one Principled/image subset and drops the material's defining
view-dependent shader composition. “Full-surface preserved” would be false.

### Material transport B: compile arbitrary graphs to custom GLSL or MaterialX

Rejected as a default product direction. It could preserve interactive
Fresnel/glass behavior for some graphs, but would make Blendlink responsible
for a proprietary renderer/material engine, shader portability, security,
backend differences, and long-term node compatibility. Needle itself does not
perform this conversion in the inspected Blender add-on.

A separately authored developer Web Material remains a valid explicit escape
hatch. It should be selected intentionally, not generated optimistically.

### Material transport C: lower a canonical optical subset to glTF extensions

Recommended as a bounded future path. Exact Principled transmission/IOR/
volume/specular and separately proven alpha coverage can stay portable and
interactive. Recognition must be revision-pinned and topology-specific.

This path does not solve TrapX's present graph. A Glass BSDF mixed by explicit
Fresnel with Transparent, Emission, and painterly procedurals is not equivalent
to a lone Principled transmission material.

### Material transport D: fixed-camera appearance on retained geometry

Recommended for an explicit authored-still mode after further proof. It is the
only product-aligned route likely to preserve this exact Cycles material plus
compositor look without owning a general shader engine. The existing
`NDL-MAT-009` prototype already demonstrates retained geometry, raycasts,
unrelated materials, exact camera/aspect checks, and owned teardown on an
opaque synthetic receiver.

TrapX widens the hard part: transparent/glass edges, background contribution,
and compositor lens/glare must be represented honestly. The current prototype
refuses alpha/dynamic surfaces and is not a TrapX solution yet.

### Material transport E: ordinary UV bake of the complete surface

Rejected for complete parity. It can materialize static intrinsic color and
normal fields, but explicit Fresnel, refraction, transparency, and compositor
response vary with camera/background/lighting. Baking those once to UVs would
change the contract while looking superficially plausible.

## Recommended deep interface

Keep generated bindings tiny and put the decision in one package-owned
material-transport module:

```text
Portable
  exact recognized glTF core/KHR closure

FixedCameraAppearance
  exact source engine + frame + camera + aspect + receiver bindings
  explicit transparency/compositor limitations

Blocked
  material, users, reasons, and valid next actions
```

The application should only receive stable status/progress/ready/error data
and the chosen transport descriptor. It still owns Canvas, route, loading
presentation, controls, interactivity, and deployment.

Artist workflow should remain nearly zero-configuration:

1. Blendlink inspects the active Surface closure.
2. It selects portable transport only when proved exact.
3. For a one-frame fixed-camera source like TrapX, it can recommend Fixed
   Camera Appearance with its interaction limits visible.
4. If neither route is valid, Preview/Final/Publish refuse consistently and
   name the exact material and reasons.
5. Optional Website Material selection remains an intentional developer
   approximation, not an automatic parity claim.

## Capability register

`NDL-MAT-002` below is the detailed production-scene evidence mapped by the
shared technique ledger. The other rows keep their existing shared IDs or a
local research-only ID; this note does not promote Prototype/Future work.

| ID | Capability | Needle relation | State | Evidence |
| --- | --- | --- | --- | --- |
| `NDL-MAT-002` | Name and transactionally block linked-but-unrepresented active-Surface loss in plan and Final compile | **Improvement** over Needle's silent stock subset | **Shipped** | **Verified 2026-07-25:** `node run_blendlink_plan.mjs`, `node run_blendlink_compile.mjs`, and `npm.cmd run test --workspace blendlink -- syncMaterialPortability.integration.test.ts`; identical fourteen reasons; unchanged stable/addressed GLBs, manifest, generated module, and baked recipe |
| `NDL-MAT-009` | Fixed-camera display-referred appearance on retained geometry | **No analogue / Improvement candidate** | **Prototype** | `npm.cmd run test:fixed-camera-surface-browser` browser-verified 2026-07-24; TrapX transparency/compositor path **Pending** |
| `NDL-MAT-013` | Canonical portable optical closure lowering, keeping transmission distinct from alpha coverage | **Match** for stock Principled/KHR semantics; **Improvement** for exact recognition/refusal | **Future** | `npm.cmd run verify:needle-baseline` source identity verified 2026-07-25; tiny Blender/browser differential **Pending** |
| `TRAPX-AUD-001` | Immutable private Cycles painterly corpus case | **No Needle visual result claimed** | **Research only** | **Verified locally 2026-07-25:** inventory/source render, `node run_blendlink_plan.mjs`, `node run_blendlink_compile.mjs`, GLB inspection, and `node run_stock_floor_browser.mjs` |

## Implemented, verified, prototype, future

### Implemented in the current worktree

- active-Surface material diagnostics;
- staged-export Final material-publication gate;
- source-preserving plan/compile invocation;
- scoped missing-image reporting;
- stock glTF structural/image transport, retained only as the rejected floor;
- local private-corpus audit scaffolding.

The production change is the staged-export Final material gate. This audit did
not add a TrapX appearance transport, manifest/schema field, or application
integration.

### Verified in this audit

- exact source identity and non-mutation;
- Cycles/camera/frame/color/light/compositor inventory;
- authored source render and Chromium review extraction;
- exact Needle add-on/exporter/runtime source identities and behavior;
- untouched Final planner refusal;
- exact Final compile refusal and unchanged five-artifact retained publication
  scope;
- focused transactional integration fixture;
- retained GLB structure, browser load, and absent optical/custom-shader
  semantics.

### Prototype

- browser-decoded authored review frame;
- existing package-owned fixed-camera retained-surface projector
  (`NDL-MAT-009`), not yet applied to TrapX.

### Future work

- add a tiny canonical transmission-versus-alpha differential;
- design a transparent/glass-aware fixed-camera appearance contract;
- prove compositor ownership and application-owned postprocessing integration;
- only then consider dogfooding a production-facing transport.

## Commands and machine-readable evidence

Final evidence toolchain, 2026-07-25:

- Blendlink `0.8.0`;
- Node `v24.15.0`, npm `11.12.1`, Vitest `3.2.7`;
- Blender `5.2.0 LTS`, build `fbe6228777e7`;
- Chrome `150.0.7871.182`, Playwright `1.60.0`, Three `0.184.0`;
- source render: NVIDIA RTX 5080 through Cycles CUDA;
- browser structural floor: SwiftShader, so it validates correctness rather
  than physical-GPU timing.

Exact commands:

```text
npm.cmd run verify:needle-baseline

Push-Location experiments/trapx-zero-config-audit
node run_blendlink_plan.mjs
node run_blendlink_compile.mjs
node run_plan_compile_consistency.mjs
node inspect_compiled_glb.mjs
node run_stock_floor_browser.mjs
Pop-Location

npm.cmd run test --workspace blendlink -- syncMaterialPortability.integration.test.ts
```

The final plan runner exits `0` after verifying the wrapped CLI exit is `1`,
the source is unchanged, and the parsed result has one
`material.used-needs-bake` error. The final compile runner likewise exits `0`
after verifying wrapped CLI exit `1`, unchanged source bytes, the expected
Material Fidelity refusal, and unchanged hashes for every artifact in its
exact five-file retained-publication scope. The focused Vitest command passes
one file and one test. The combined runner independently prints
`BLENDLINK_PLAN_COMPILE_CONSISTENCY_PASSED`.

The full inventory/render commands and local sentinel output are documented
in `experiments/trapx-zero-config-audit/README.md`.

Ignored local evidence:

- `output/source-inventory.json`
- `output/source-video-frame-evidence.json`
- `output/blendlink-plan-evidence.json`
- `output/blendlink-compile-evidence.json`
- `output/compiled-glb-structure.json`
- `output/retained-stock-floor-browser-evidence.json`

Primary references:

- [Blender 5.2 glTF add-on manual](https://docs.blender.org/manual/en/5.2/addons/scene_gltf2.html)
- [Khronos glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
- [Khronos `KHR_materials_transmission`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_transmission)
- exact local Needle/Blender sources and hashes listed above
