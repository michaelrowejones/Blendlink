# Blender 4 Splash: Eevee, Blendlink, and Needle visual differential

- Audit date: 2026-07-24
- Fixture: `artifacts/release-dogfood/blender-4-splash/fixtures/blender-4.0-splash-selected-sky.blend`
- Fixture SHA-256:
  `9f9527030372e7f478bea487b59633af79be2bfaec4b57ff945aae56817c027a`
- Eevee reference:
  `artifacts/release-dogfood/blender-4-splash/blender-reference-selected-sky-0001.png`
- Reference SHA-256:
  `650e2f0fc9f78bbd6aec6656d9d241b656a6acf16c4cb10eb12cb7c8e601f243`
- Scope: the reported loss of shadow information, noisy/incorrect sky, and
  missing building texture in the Blender 4.0 Splash dogfood scene
- Decision authority: Eevee remains the visual source of truth. Needle is the
  required behavioral baseline, not a replacement reference image.

## Outcome

An actual Needle add-on export and Needle Engine browser render now exists for
the same Splash fixture. It does **not** solve this scene's visual-portability
problem.

The result is mixed:

- Needle preserves substantially more broad shadow structure and
  building-region frequency detail than the current Blendlink selected-sky
  result.
- Blendlink preserves dramatically more of the authored palette than Needle.
- Needle's exported graph has 36 materials, but only its generated `skybox`
  material has a base-color texture. The other 35 materials are untextured and
  omit a base-color factor, so stock glTF defaults them to white. This explains
  the almost monochrome browser result.
- Neither result passes the three fixture-specific, Eevee-relative visual
  checks. Needle is not a visual-parity waiver for Blendlink's current shadow,
  sky, or building-surface gaps.

The comparison image is ordered Eevee, Blendlink, Needle:

![Three-way Splash comparison](../artifacts/release-dogfood/blender-4-splash/needle-three-way-2026/three-way-overview.png)

The composite SHA-256 is
`0e141749c6b5e61585cf9722d571cbaa542660c874746fa671444aca2e74502f`.

## Evidence language

This note keeps four different claims separate:

- **Source verified** means the exact content-identified add-on/runtime source
  implements the described behavior.
- **Browser verified** means the named artifact loaded and rendered through the
  recorded browser harness.
- **Fixture differential verified** means the named Eevee-relative metric and
  its isolated negative controls ran. A red result is still valid evidence of a
  gap.
- **Pending** means the complete Needle build-pipeline or production condition
  was not exercised and must not be inferred from source inspection.

The browser smoke gate passed loading, camera, asset, Canvas, WebGL, and
nonblank assertions. The visual-fidelity differential intentionally exited
nonzero because the rendered pixels failed all three appearance checks. Those
are not conflicting outcomes.

## Exact Needle identity and integration boundary

`npm.cmd run verify:needle-baseline` passed on 2026-07-24:

```text
BLENDLINK_NEEDLE_BASELINE_VERIFIED 122 files, 7 source version identities (2026-07-24) integration=mixed-source named=splash-official-preview:coherent
```

The authoritative inventory remains
[`needle-baseline.json`](needle-baseline.json) and
[`research-needle-behavioral-baseline-2026.md`](research-needle-behavioral-baseline-2026.md).

The add-on root used for the export was:

```text
C:/Users/micha/Documents/GitHub/MichaelRoweJonesSite/.cache/needle-spike/addon/Needle Engine Exporter for Blender
```

The clean official Preview root is:

```text
experiments/needle-splash-official-preview
```

| Element | Exact identity |
| --- | --- |
| Blender add-on | Needle Engine Exporter for Blender `1.4.2`; `__init__.py` SHA-256 `980226a628182e9e0b1d443c0e294f799162c76e06c5f599dacc20c614a8c96e` |
| Browser runtime | `@needle-tools/engine` `5.1.4`; `package.json` SHA-256 `522f0a5aa64c22fe76a5d7c6fd0f039fce396eb841324512862c0d704bcacb38` |
| Blender | `5.2.0 LTS`, build hash `fbe6228777e7` |
| Official Preview host | Generated package/config shape; `package.json` SHA-256 `c808e760808b96fc87b0ff8a2be6b346e844a204976c16aaf85fcedf80844ec2`; lock SHA-256 `a3c5b7c3102414fdc1b7d1a07859816c38525c0e1b647ce0c90341558e40d322` |
| Harness build | Official Needle Vite plugin with Vite `8.0.3`; Vite package SHA-256 `a6e1e3371949bbc440444b6503c4ab206386d1eca5cf51caecd28283aaa0631d`; 537 modules |
| Browser | Chrome, WebGL 2 reported as `WebGL 2.0 (OpenGL ES 3.0 Chromium)` / `WebKit WebGL` |
| Add-on-selected build pipeline | `@needle-tools/gltf-build-pipeline` `3.0.0`; source inspected, authenticated transform not run |

This closes a named **uncompressed add-on export plus clean official Preview
host plus exact Engine 5.1.4 browser-load** cell:

```text
integration:splash-official-preview=coherent
```

`npm.cmd ls --all` passes in the fixture root. The official build-info path
reports Engine `5.1.4`; the browser loads the exact GLB and EXR, selects the
authored camera, and passes its scoped smoke assertions. The project resolves
`@needle-tools/three` `0.169.21` while Engine contains nested
`@needle-tools/three` `0.169.19`; this is a clean package tree, not a
single-copy-Three claim.

The broad inventory remains `integration=mixed-source` because it also
contains historical Engine `5.1.7` and independently acquired package/source
cells. The named Preview result does not promote those unrelated paths.

The exact pixels below are an actual coherent Preview result, but not a claim
about Needle Cloud transformation, production compression, or an authenticated
`@needle-tools/gltf-build-pipeline@3.0.0 transform`. The official development
build explicitly skipped that licensed production path. It remains
**Pending**.

The official Preview input and evidence identities are:

| Browser input/output | SHA-256 |
| --- | --- |
| `vite.config.js` | `38831f1bb7f23b086c0f096f3dbd165b1f61e0eb8b9e1ebeb0b71af295e9e573` |
| Engine `lib/needle-engine.js` | `c6fefdeda5137b38a611c587bca9c93f9f56068ffdf88c0d2b2d3bd0a1bae261` |
| browser evidence JSON | `aa6045b86588b48ea0e8153c7c440fe03a3bf3bb191ba0ca840c18b3d8bba06c` |
| browser screenshot | `54e30ecaa0342611122288efbf6ffe9c7440709d6d613c67adf77d37fe0efcbc` |
| Eevee-relative visual evidence JSON | `ac538adc31de0a7d4446c54890cdbaa2907793484c91f112f94b2f573f0d5e9d` |

The screenshot is byte-identical to the earlier mixed-host screenshot. That
superseded harness remains historical provenance, but it is no longer the
integration basis for the visual findings in this note.

## Source files inspected

No Needle implementation text was copied into Blendlink. These hashes identify
the behavior summarized below.

### Add-on 1.4.2

| Normalized source path | SHA-256 |
| --- | --- |
| `blender_export.py` | `6272997cfb4f1d740ea33a7c2512983b9993dedf93c9c8240ca0ff7f82925d77` |
| `settings_scene.py` | `6e02da2ab32558fb042f0000c863bc6631176458ceb06534d9afcd5061dfd063` |
| `extensions/NEEDLE_components_postprocess.py` | `90cdd4fbd883858816d36ea1605e75fd820c4bcac2e8d8c87e76a465eb1ce031` |
| `extensions/skybox_utils.py` | `cbeb3ccbe8cdd018514e5de874c0b3e555a0958c4a1e22a0eafe90396fc5e09c` |
| `extensions/NEEDLE_lightmaps.py` | `3831dd545261fdd4fa5e5fca9ad98ae7912a0939ea2758bb737b74eae4376a77` |
| `lightmapping/lightmapping.py` | `4e69f0934d9329b2d8480b097baa1d903aa31bed9337c7a2ae0630cbc900b4f1` |
| `lightmapping/lightmapping_pack.py` | `242aad7a29c177ac566ad519425ec55cb0376805d02197a0519107a761801cd3` |
| `panels_object.py` | `89dbb640ce3326915de768773e9ed7443a5f1778ed37b418437d757abff279ec` |

### Engine 5.1.4 package used by the browser

| Normalized source path | SHA-256 |
| --- | --- |
| `src/engine-components/Light.ts` | `7ceb0827f6d49e94ea350b438cf7374bd23cf07473e13569355866b40820823e` |
| `src/engine-components/Renderer.ts` | `c77ede6eee371ccce367281e22c77aacfdce4fd9d57c23d3d67ca9fa6ec0e159` |
| `src/engine-components/RendererLightmap.ts` | `0c2b96f12d22dd000a0c92c185b1685cd48af72b8f5b8f8569f703be7e889bd7` |
| `src/engine-components/Skybox.ts` | `ef981296e6ceaeb792feb8c433df7cd48740bacf090f77ea693e42cda86876b5` |
| `src/engine-components/ContactShadows.ts` | `e4bd8398c59d47ad3bd2eef66625b03c14f260e678d27a332a8ad73d4c17733b` |
| `src/engine/extensions/NEEDLE_lightmaps.ts` | `000794aa7421d6b3d73d76c546f0af68ffde784f7d2ee10c1308e1c4d89922e7` |
| `src/engine/extensions/NEEDLE_lighting_settings.ts` | `b3aca7337fa4bfde8f9424483945f747e401fa4ba54135d7a9cbc352af609a1c` |
| `src/engine/engine_lightdata.ts` | `9ef66efa71b66a0a02dbdb2160cd0285c4cb409b589d7471f9a6380c5a7c2e59` |
| `src/engine/engine_scenelighting.ts` | `8a01815980eee222f1b2cbf03f5c2ecec5b36e3a4ccaa858af5ee302939ff9b5` |
| `src/engine-components/postprocessing/Effects/Tonemapping.ts` | `bc31231e56421a4c071fff07c7afcbda0da552d94e9e9cde10111a0461685552` |
| `src/engine-components/postprocessing/Effects/Tonemapping.utils.ts` | `867de57e9b5447cff7e43078bc4ede0f52203cdbb13846b409d592b625875b9a` |

Some Engine source bytes match the previously inventoried 5.1.7 package.
Every conclusion in this note is nevertheless attributed to the exact 5.1.4
package path and hash used by the browser.

## Reproduction and immutable artifacts

### Fixture preparation

The source fixture was copied before Needle metadata was authored. Its original
bytes remain unchanged at the fixture path and hash recorded above. Needle then
saved project/settings metadata into this working copy:

```text
artifacts/release-dogfood/blender-4-splash/needle-three-way-2026/fixture/blender-4.0-splash-selected-sky-needle.blend
```

The working-copy SHA-256 after Needle setup is
`58668b54f59518ea2c914ea73d0bd3be8209bd057625c1e8d64619040b5f8bbe`.
The evidence script changed Needle integration settings only; it did not claim
byte identity with the source after Blender/Needle saved it.

The final visual-comparison export used the source camera and Needle's own
settings to remove its menu controls:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' `
  --background `
  'artifacts\release-dogfood\blender-4-splash\needle-three-way-2026\fixture\blender-4.0-splash-selected-sky-needle.blend' `
  --python `
  'artifacts\release-dogfood\blender-4-splash\needle-three-way-2026\export_splash_needle.py' `
  -- `
  'C:\Users\micha\Documents\GitHub\blendlink\artifacts\release-dogfood\blender-4-splash\needle-three-way-2026' `
  false
```

`false` disables Needle's default camera auto-fit. Contact shadows and the
exported realtime Sun remained enabled.

### Frozen final Needle assets

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `experiments/needle-splash-official-preview/assets/scene.glb` | 39,759,032 | `ba66cf5c974bf5fb14740e42225de5030174e9ecbe2731d74b7ad0fb38660da9` |
| `experiments/needle-splash-official-preview/assets/forest.exr` | 552,641 | `bdf2298244affa0f85509380fd130ac6d4dfaa3c856df065998f7f4c1a93dc0d` |
| networked official Preview screenshot | 707,931 | `54e30ecaa0342611122288efbf6ffe9c7440709d6d613c67adf77d37fe0efcbc` |
| matching browser evidence JSON | 9,483 | `aa6045b86588b48ea0e8153c7c440fe03a3bf3bb191ba0ca840c18b3d8bba06c` |

The official Preview fixture was installed and built with:

```powershell
Push-Location experiments\needle-splash-official-preview
npm.cmd ci `
  --cache ..\needle-coherent-addon-1.4.2\.npm-cache `
  --prefer-offline `
  --no-audit `
  --no-fund
npm.cmd ls --all
npm.cmd run build
Pop-Location
```

The Vite build used Needle's official plugin and build-info path. It was a
development/Preview build and explicitly skipped the licensed production
pipeline.

The browser command was:

```powershell
node artifacts\release-dogfood\blender-4-splash\needle-three-way-2026\capture.mjs `
  C:\Users\micha\Documents\GitHub\MichaelRoweJonesSite `
  'C:\Program Files\Google\Chrome\Application\chrome.exe' `
  authored-camera-official-preview-networked `
  C:\Users\micha\Documents\GitHub\blendlink\experiments\needle-splash-official-preview `
  https
```

The browser evidence passed all of its scoped assertions:

- HTTP 200 for the page, `scene.glb`, and `forest.exr`;
- Needle loading finished;
- a 1200 by 600 Canvas and live WebGL2 context;
- exported Camera active at the glTF world transform;
- visible `Splash-Gaku-Tada` root;
- 342 runtime meshes, 340 visible;
- zero relevant console, page, request, or HTTP errors; and
- a visibly nonblank frame.

Needle retained non-fatal `MeshRenderer` retrieval warnings for several
Icospheres and the expected commercial-license logo warning. They are recorded
in the browser evidence and are not reclassified as successful material
behavior.

Warnings remain evidence, not failures hidden by the harness:

- multiple Three copies;
- 22 `MeshRenderer` components that could not retrieve a glTF mesh/material;
- the Needle commercial-license warning; and
- one non-descriptive `[Object, Object]` warning.

### Default auto-fit control

Needle 1.4.2 defaults `autoFit` to true. For this fixture, the visible sky
geometry dominates the fitted bounds and the browser shows a white sphere-like
surface instead of the authored composition.

That control is frozen separately:

| Artifact | SHA-256 |
| --- | --- |
| `runs/default-autofit/scene.glb` | `51414a8d37310f9b9c975f67aaa25dc086de70f4571dbdf47fbbadd42cac124a` |
| default-auto-fit screenshot | `04b7975d12222a355e6c88216bcaed32ed94bfd91d1a1c0ea28be68d991f4c7d` |
| default-auto-fit browser JSON | `9a8a97fe29c83e11f24d457cabd4b200c1085d0b7c707868f4d67ac780349625` |

This is camera-policy evidence only. It is deliberately excluded from the
appearance comparison below.

## What Needle actually exported

The final GLB reports `Khronos glTF Blender I/O v5.2.39` and contains:

| Field | Needle | Current Blendlink selected-sky GLB |
| --- | ---: | ---: |
| Nodes | 271 | 266 |
| Meshes | 240 | 236 |
| Primitives | 339 | 335 |
| Materials | 36 | 33 |
| Textures / images | 1 / 1 PNG | 1 / 1 PNG |
| Punctual lights | 1 | 1 |
| Primitives with `COLOR_0` | 338 | 334 |
| Primitives with `TEXCOORD_0` | 118 | 117 |

Needle's only base-color-textured material is its generated `skybox`
material. All other 35 glTF materials are untextured and omit
`baseColorFactor`. The browser therefore receives the glTF default white
factor, modulated by vertex colors where present. The source `.blend` contains
68 materials and 22 images, so neither raw count nor successful glTF export is
evidence that the Eevee material programs survived.

Needle added these non-renderer components:

- `Camera` and `OrbitControls(autoFit=false)`;
- `ToneMappingEffect(mode=0, exposure=0.929456190290404)`;
- `ContactShadows(autoFit=true, darkness=0.5, opacity=0.5)`;
- one realtime directional `Light` with soft shadows, 2048 shadow resolution,
  300-unit distance, bias `-0.0001`, and normal bias `0.02`;
- `PlayableDirector`; and
- a `NeedleMenu` record with logo and controls disabled.

The GLB's `NEEDLE_lightmaps` extension contains `forest.exr` as environment
type `1`, not a receiver lightmap. No renderer component has a lightmap index,
and runtime traversal found zero materials with `lightMap`.

## Exact source behavior by visual subsystem

### Materials and textures

`blender_export.py` delegates ordinary scene materials to Blender's stock glTF
exporter. It requests GLB, cameras, lights, `COMPAT` lighting conversion,
applied modifiers, automatic image format, and JPEG quality 100. The inspected
path has no automatic realization of arbitrary Eevee node graphs into
base-color textures.

Needle does have resource-export machinery for component-referenced materials
and images. That is not a general Eevee surface compiler, and it did not
materialize the Splash graphs. Its separate lightmapping path bakes lighting
for explicitly marked receivers; it does not turn these unsupported material
programs into portable appearance textures.

This distinction matches the pixels: Needle retains geometry, vertex color,
normals, realtime light, and line structure, but loses almost all authored
surface color.

### Shadows and lightmaps

Needle exports two shadow mechanisms for this unconfigured fixture:

1. the source Sun as one realtime directional light with shadow metadata; and
2. a screen/runtime-generated contact-shadow component enabled by the scene
   setting that defaults true.

Needle's offline lightmapping is explicit. `NEEDLE_isLightmapped` defaults
false per object. The bake selects marked receivers, creates/uses a dedicated
lightmap UV layer, bakes through Cycles, and exports receiver indices plus the
lightmap texture for runtime application. None of those receiver marks or
lightmaps existed in this source scene, so treating the browser result as
"Needle lightmapped Splash" would be false.

The actual result nevertheless retains more shadow structure than the current
Blendlink selected-sky path. Blendlink should study the realtime Sun and
contact-shadow combination before changing its shadow policy, then prove any
deviation with the same mask-based differential. This does not imply that
Needle meets Eevee parity; it does not.

### Environment and visible sky

Needle 1.4.2 reads Material Preview viewport lighting. When the selected studio
light is `Default`, the inspected add-on searches Blender's studio lights for
`forest.exr`, copies it beside the GLB, and emits a relative
`NEEDLE_lightmaps` environment pointer. Engine 5.1.4 loads `.exr` through
Three's `EXRLoader` and applies the texture through its scene-lighting system.

For this fixture the exported Camera has:

- background intensity `0`;
- environment intensity `1`;
- solid-color clear flags;
- background color approximately `[0.050876, 0.050876, 0.050876]`; and
- background blurriness `0.125`.

The external forest environment therefore contributes lighting/reflections,
but is not the authored visible sky-paint surface. The visible sky remains
ordinary scene geometry using `DP-SkyPaint.MAT`. Because that material's Eevee
graph did not become a texture in Needle's GLB, Needle's visible sky is also
wrong.

Blendlink deliberately treats the artist-selected Eevee World/scene as source
truth rather than silently adopting a Material Preview studio light. That is a
product boundary, not permission to keep the current noisy selected-sky
result. The visible sky material still needs a portable Eevee-safe route.

### Tone mapping and postprocessing

The exact source scene reports:

```text
render engine: BLENDER_EEVEE
view transform: Filmic
look: Medium High Contrast
exposure: -0.10554122924804688 stops
```

Needle exports `2 ** exposure`, which is
`0.929456190290404`. Add-on 1.4.2 recognizes AgX and Khronos PBR Neutral
explicitly; other transforms, including Filmic, use mode `0`. Engine 5.1.4 maps
that mode to its linear tone-mapping path. The Blender `Medium High Contrast`
look is not represented.

The add-on contains compatibility paths for Eevee bloom and GTAO, but Blender
5.2 exposes neither legacy `scene.eevee.use_bloom` nor
`scene.eevee.use_gtao` for this loaded scene. The actual GLB consequently has
no Bloom or SSAO component. Its only image effect is Tone Mapping.

Blendlink's current private authoring-preview metadata instead records:

- Filmic approximated by Three ACES;
- the exact authored exposure;
- a loud warning that Filmic has no exact Three display transform;
- a loud warning that `Medium High Contrast` is not reproduced;
- display-gamma and curve warnings; and
- an unsupported World-graph warning.

That is a diagnostic improvement over silently presenting the linear fallback
as parity. It is not evidence that ACES matches Filmic pixels. A scalar ramp,
highlight rolloff, and colored-patch differential is still required before
promoting any Filmic approximation beyond **Prototype** visual evidence.

## Three-way visual evidence

The fixture-specific differential and its isolated negative controls live at
[`experiments/splash-visual-fidelity-differential`](../experiments/splash-visual-fidelity-differential/).
It is not a universal visual-parity score.

Needle command:

```powershell
node experiments/splash-visual-fidelity-differential/run.mjs `
  --candidate `
  'experiments/needle-splash-official-preview/browser-evidence-needle-blender-4-splash-selected-sky-authored-camera-official-preview-networked.png' `
  --output `
  'experiments/needle-splash-official-preview/visual-gates'
```

Current Blendlink command:

```powershell
node experiments/splash-visual-fidelity-differential/run.mjs `
  --candidate `
  'artifacts/release-dogfood/blender-4-splash/browser-evidence-blender-4-splash-selected-sky.png' `
  --output `
  'artifacts/release-dogfood/blender-4-splash/needle-three-way-2026/visual-differential-blendlink-selected-sky'
```

Both commands correctly exit `1`: all three isolated negative controls pass,
then all three real candidates fail.

| Eevee-relative symptom | Acceptance | Current Blendlink | Needle actual |
| --- | --- | ---: | ---: |
| Broad shadow-band ratio | at least `0.72x` | `0.268233x` | `1.066283x` |
| Shadow luma-range ratio | at least `0.72x` | `0.154057x` | `0.550198x` |
| Sky local-noise ratio | at most `1.25x` | `1.630712x` | `1.371534x` |
| Sky median color error | at most `2` reference spreads | `3.458311` | `5.037634` |
| Building luma-detail ratio | at least `0.7x` | `0.042990x` | `0.879401x` |
| Building color-detail ratio | at least `0.7x` | `0.040908x` | `0.925291x` |
| Building pattern correlation | at least `0.65` | `0.045046` | `0.595708` |
| Building pattern error | at most `0.7` | `0.999061` | `0.852540` |

Evidence identities:

| Candidate | Screenshot SHA-256 | Differential JSON SHA-256 |
| --- | --- | --- |
| Current Blendlink | `853d883dac57506c45a23cbc06056a691e19a22199ec2387d35baa902ae55621` | `2278a4a7e55417a5ddf58838dd6baf30354c231113bebfb23277bfec5958d633` |
| Needle official Preview | `54e30ecaa0342611122288efbf6ffe9c7440709d6d613c67adf77d37fe0efcbc` | `ac538adc31de0a7d4446c54890cdbaa2907793484c91f112f94b2f573f0d5e9d` |

A separate whole-image sRGB chroma diagnostic quantifies the obvious palette
loss without presenting it as a perceptual-parity score:

| Candidate | Mean channel chroma | Pixels with chroma at least `0.05` | Pixels with chroma at least `0.15` |
| --- | ---: | ---: | ---: |
| Eevee | `0.188088` | `72.1972%` | `50.7250%` |
| Current Blendlink | `0.169929` | `61.1914%` | `44.2307%` |
| Needle actual | `0.025078` | `24.3428%` | `0.0061%` |

The diagnostic is
`artifacts/release-dogfood/blender-4-splash/needle-three-way-2026/palette-diagnostic.json`,
SHA-256
`79e302e10c3f2975b67b1f8a59286069a6a83ec3fd8569aaf3a14e025e2097a6`.

## Capability ledger

The relation describes current Blendlink behavior relative to the exact Needle
path. Implementation and evidence are separate.

| Capability ID | Capability | Relation | Implementation state | Evidence state |
| --- | --- | --- | --- | --- |
| `SPL-NDL-CAM-001` | Preserve an authored fixed camera for a scene with large backdrop/sky geometry | **Improvement** | **Shipped** | Browser verified 2026-07-24. Needle default auto-fit produces the frozen white-sphere control; `autoFit=false` restores the authored composition. Current Blendlink selected-sky composition uses the authored camera without that Needle-specific setting. |
| `SPL-NDL-MAT-001` | Retain the authored Splash palette when ordinary glTF cannot express the material graph | **Improvement** | **Shipped** | Bounded fixture diagnostic verified 2026-07-24: strong-color pixel fraction is `44.2307%` for Blendlink versus `0.0061%` for Needle and `50.7250%` for Eevee. This does not prove material parity. |
| `SPL-NDL-MAT-002` | Preserve the authored building-surface pattern | **Gap** | **Shipped** | Current implementation is insufficient: fixture differential red 2026-07-24. Needle correlation is `0.595708`; current Blendlink is `0.045046`; both miss `0.65`. The next material-compiler route must beat Needle and pass Eevee-relative acceptance. |
| `SPL-NDL-LIT-001` | Preserve Eevee-like shadow information in the unbaked realtime presentation | **Gap** | **Shipped** | Current implementation is insufficient: fixture differential red 2026-07-24. Needle retains `0.550198x` luma range versus Blendlink `0.154057x`; both miss `0.72x`. Needle's realtime Sun plus contact-shadow behavior is the required next differential baseline. |
| `SPL-NDL-LMAP-001` | Avoid falsely claiming an offline lightmap when the source has no marked/baked receivers | **Match** | **Shipped** | Browser verified 2026-07-24: Needle exported zero receiver lightmaps and runtime found zero `lightMap` materials; the Blendlink selected-sky case is likewise realtime, not a baked-lighting result. A configured same-receiver Needle-vs-Blendlink bake remains Pending. |
| `SPL-NDL-ENV-001` | Choose environment authority for an Eevee-authored scene | **Boundary** | **Shipped** | Source and browser verified 2026-07-24. Needle copies Material Preview `forest.exr`; Blendlink treats the Eevee World/scene as authoritative and warns when that World is not portable. Current visible-sky fidelity remains red and is not excused by the boundary. |
| `SPL-NDL-PP-001` | Report unsupported Filmic/look reproduction honestly | **Improvement** | **Shipped** | Diagnostic behavior is source verified 2026-07-24. Needle maps this Filmic fixture to mode `0` plus exposure and omits `Medium High Contrast`; Blendlink records ACES as an approximation and names Filmic, look, gamma, curve, and World limitations. Pixel superiority of the Filmic substitute remains **Pending** a ramp/patch differential. |
| `SPL-NDL-ASSET-001` | Publish the complete environment companion graph safely | **Improvement** | **Shipped** | Needle actual requires stable relative `scene.glb` plus `forest.exr`; Blendlink's complete content-addressed graph and CDN/subpath gates are verified separately in [`research-asset-addressing-deployment-2026.md`](research-asset-addressing-deployment-2026.md). The Needle authenticated transform remains Pending. |

## Design consequence for Blendlink

The evidence supports a three-part target rather than copying the Needle
screenshot:

1. **Keep Blendlink's better palette retention and loud material diagnostics.**
   Needle's ordinary stock-glTF path demonstrates exactly why silent white
   material fallback is not acceptable for an artist-first compiler.
2. **Adopt or beat Needle's retained shadow and surface-frequency behavior.**
   The current Blendlink result is measurably behind Needle in those two
   dimensions even though Needle is visibly wrong overall. The realtime Sun,
   receiver/caster flags, contact-shadow fit, tone-mapping order, and material
   field realization must be tested independently.
3. **Pass Eevee, not merely Needle.** Needle is the behavioral floor and
   architecture comparison. The acceptance image and thresholds remain the
   Eevee render because the artist selected Eevee.

The highest-confidence next fixtures are:

- a Sun-only shadow differential with identical geometry, camera, tone
  mapping, shadow-map size, caster/receiver flags, and no contact shadow;
- the same fixture with only Needle-style contact shadows added;
- a building-material field fixture that separates vertex color, diffuse
  lighting, Shader to RGB/AO, and procedural color realization;
- a sky-only fixture that separates visible sky geometry from World
  environment lighting;
- a Filmic/Medium-High-Contrast ramp and colored-patch comparison; and
- a configured, identical receiver set baked through Needle lightmapping and
  Blendlink Lighting bake, tested at equal delivery resolution.

No schema or production behavior should change from this browser result alone.
Each implementation should land only after its focused differential can make
the Needle-style and Blendlink-style designs fail independently.

## Limitations and pending work

- One camera, one frame, one 1200 by 600 viewport, and one Chrome/WebGL2
  environment were captured.
- The working Needle copy contains integration metadata and is not byte-equal
  to the untouched fixture after save.
- The browser used the clean official Preview Vite/plugin/build-info path, but
  only its development build.
- The clean tree contains project Three `0.169.21` and Engine-nested Three
  `0.169.19`; no general cross-copy safety claim is made.
- The production Needle build-pipeline transform and any authenticated
  progressive/compression output remain Pending.
- Needle lightmapping was not configured for this source; the actual result is
  correctly classified as realtime plus contact shadows.
- The fixture-specific masks do not score every material, line, transparency,
  reflection, animation, or temporal artifact.
- The global chroma statistic is diagnostic only; it can demonstrate a nearly
  monochrome regression but cannot certify a correct palette.
- No claim here upgrades the current Splash scene to visual parity. All three
  named appearance symptoms remain open.
