# Selected-field surface response: Needle baseline and bounded differential

Date: 2026-07-24

Status: **Shipped semantic carrier; full Splash appearance parity remains red**

Capability ID: `NDL-MAT-008`

Relation: **Match / scoped Improvement** for preserving lit versus deliberately
unlit surface response. It matches Needle's stock-glTF distinction and improves
on Needle for the selected-field transport that Needle does not provide.

## Question

Blendlink can privately evaluate a static, lighting-independent Color/Value
socket and publish it as an ordinary base-color texture. The current generated
carrier always declares `KHR_materials_unlit`. Does this preserve the artist's
surface semantics when the selected field feeds an ordinary lit surface?

No. Materializing the *intrinsic color* and flattening the *surface response*
are separate decisions. An ordinary selected base color should remain lit; an
explicit sky, Background, or Emission-only surface should remain unlit.

## Primary-source baseline

The exact Needle source identity remains `integration=mixed-source`; the
per-package observations below are valid, but they are not a coherent Needle
export-to-browser differential.

| Source | Version, normalized path, SHA-256 | Observed behavior |
| --- | --- | --- |
| Needle Blender add-on | `1.4.2`; `C:/Users/micha/Documents/GitHub/MichaelRoweJonesSite/.cache/needle-spike/addon/Needle Engine Exporter for Blender/blender_export.py`; `6272997cfb4f1d740ea33a7c2512983b9993dedf93c9c8240ca0ff7f82925d77` | `__runExport` invokes Blender's stock glTF exporter with materials left to that exporter; no selected-field surface rewrite occurs. |
| Needle Engine | `5.1.7`; `experiments/needle-spike/node_modules/@needle-tools/engine/src/engine/engine_loaders.gltf.ts`; `5fa4bf5a04b982d66b2f2975ed4b4f9e3cdbc21883df8fdcce9155c27ac28288` | Constructs Three's `GLTFLoader` and adds decoder support rather than replacing core material construction. |
| Needle-bundled Three | `0.169.19`; `experiments/needle-spike/node_modules/@needle-tools/engine/node_modules/three/examples/jsm/loaders/GLTFLoader.js`; `4aba05147b1ccb01f581979ea44950b60a568e74a5db811df9f5573a2b3521b1` | Core metallic-roughness creates `MeshStandardMaterial`; `KHR_materials_unlit` creates `MeshBasicMaterial`. |

This matches the standards-level contract. Khronos defines
`KHR_materials_unlit` as a deliberate preference for lighting-independent
color and says clients capable of PBR should not automatically upgrade it to a
lit material. Its color is only the base-color term, with lighting-related
properties ignored. [Khronos `KHR_materials_unlit`
specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_unlit/README.md)

Blender's official glTF documentation likewise distinguishes core
metallic-roughness PBR from shadeless `KHR_materials_unlit`; the exporter
recognizes material node patterns and exports the corresponding glTF
surface. [Blender glTF 2.0
manual](https://docs.blender.org/manual/en/3.3/addons/import_export/scene_gltf2.html)

Needle therefore preserves this surface distinction wherever Blender's stock
exporter can represent the material. Blendlink's selected-field materializer
has no direct Needle analogue, but its generated carrier should preserve the
same distinction by default.

## Differential

The throwaway fixture is
[`experiments/selected-field-lit-transport-differential`](../experiments/selected-field-lit-transport-differential/README.md).
It uses Blender 5.2.0 LTS and Blendlink's canonical `bakelib.py` to evaluate a
procedural red/blue intrinsic field into one 256×256 PNG. It then transports
the exact same PNG bytes through:

1. the current `KHR_materials_unlit` stock-glTF carrier; and
2. an ordinary core metallic-roughness PBR carrier with metallic `0`.

The Blender fixture contains a selected-field receiver partly occluded from a
Sun and a selected-field opaque caster over a neutral receiver. Chromium loads
each GLB with Three 0.184.0. It isolates three claims by independently toggling
the receiver-only occluder, the selected caster, and direct light.

Run:

```powershell
node experiments/selected-field-lit-transport-differential/run.mjs
```

Result:

```text
BLENDLINK_SELECTED_FIELD_SURFACE_DIFFERENTIAL_PASSED
receive=0->18249 cast=5944/5944 light=0->148000
eeveeRmse=0.117074->0.017423
```

| Claim | Current unlit | Lit PBR candidate | Evidence |
| --- | ---: | ---: | --- |
| Embedded selected-field PNG preserved | same SHA-256 `be0829…806b` | same SHA-256 `be0829…806b` | GLB binary attestation |
| Loaded Three material | `MeshBasicMaterial` | `MeshStandardMaterial` | Actual Chromium loader result |
| Receiver changes under isolated occluder shadow | `0` pixels | `18,249` pixels | 800×500 WebGL2 readback |
| Selected surface changes under direct Sun | `0` pixels | `148,000` pixels | Isolated receiver readback |
| Opaque selected object casts on neutral receiver | `5,944` pixels | `5,944` pixels | Selected-caster toggle |
| Equal-renderer distance from source Eevee | `0.117074` RGB RMSE | `0.017423` RGB RMSE | Blender Eevee source versus each Blender carrier |

The cast-shadow result is important: an opaque unlit Three material can still
cast when the website enables its renderer, light, and mesh shadow flags. It
cannot *receive* ordinary direct-light shadowing, because that would contradict
the unlit material contract.

The browser-to-Eevee images are informative, not an equal-renderer parity
claim. The equal-renderer claim is the Blender source versus Blender carrier
comparison. Chromium ran through ANGLE/SwiftShader and provides deterministic
functional pixels, not physical-GPU performance evidence.

## Design comparison

### Design A — always unlit

Keep the existing carrier.

Advantages:

- exact intrinsic color is visible without application lighting;
- deliberate sky, Background, and Emission surfaces behave correctly; and
- the carrier is cheap.

Costs:

- ordinary lit materials cannot receive light or shadows;
- materializing a base-color field silently changes surface semantics; and
- the result diverges from both Eevee and Needle's stock-material behavior.

**Rejected as the universal default.** Retain it only for genuinely unlit
source intent.

### Design B — always lit

Publish every selected field as core PBR.

Advantages:

- ordinary diffuse/Principled fields retain light and shadow response; and
- the carrier remains portable stock glTF.

Costs:

- sky cards and explicit emission/unlit surfaces become incorrectly shaded;
- a website with no light can turn selected fields black; and
- the compiler would replace one silent semantic collapse with another.

**Rejected as the universal default.**

### Design C — preserve surface response

Classify the selected field against the active Surface graph:

- a reachable path through a BSDF is `lit`;
- a direct Background/Emission-only path with no BSDF contribution is
  `unlit`; and
- mixed, unreachable, or unsupported paths are `ambiguous` and refuse unless
  the artist chooses explicitly.

This is the chosen design direction. It matches Needle's stock behavior,
requires no website configuration, and keeps the selected-field evaluation
boundary narrow.

## Smallest production interface

The deep module seam belongs in material-compiler planning:

```text
surfaceResponse: auto | lit | unlit
```

`auto` should be the artist-facing default. A single namespaced override on
the existing Blendlink Web Color marker should be shown only when the active
graph is ambiguous. The website should not need to know this setting.

No manifest reshaping is necessary:

- keep the existing selected-field transport (`factor`, `vertexColor`, or
  `image`);
- widen existing `gltfEvidence.unlit` from the literal `true` type to a
  boolean;
- attest `KHR_materials_unlit` presence for `unlit` and absence plus core PBR
  parameters for `lit`;
- use the existing generated material-rule extra to distinguish the two; and
- optionally add `surfaceResponse` to diagnostics as an additive schema-1
  field.

The compiler should preserve the selected color, alpha, UV, sampler, and
artifact-byte attestations independently from its surface-response attestation.

## Historical prototype limits and prescribed gate

This prototype covers one opaque, static, unit-range Color field on one UV
set and ordinary diffuse/PBR response. It does not prove arbitrary Principled
extensions, transparency, normal/roughness preservation, Shader to RGB parity,
or automated classification across nested groups.

The prototype prescribed these production gates:

1. add minimal Blender graphs for direct Principled, direct
   Background/Emission, BSDF→Shader to RGB→Emission, mixed shader, nested
   group, and unreachable marker paths;
2. differential-test the classifier and explicit ambiguity refusal;
3. update material planning fingerprints and artifact attestation without
   weakening current selected-field byte/UV evidence;
4. run the real headless material compiler gate and the Splash browser
   differential; and
5. record the result in the technique ledger and feature-parity matrix only
   after those gates pass.

## Production implementation and current evidence

The prescribed carrier work now ships under `NDL-MAT-008`.

- `AUTO` follows the selected intrinsic field through nested groups and the
  active Surface graph. Direct portable Principled/Diffuse ownership preserves
  a lit website response; a direct Background/Emission-only path preserves an
  unlit response.
- Eevee-only Shader-to-RGB/AO convergence and non-portable BSDF ownership
  refuse automatically. The Splash differential proved that treating a
  parallel Shader-to-RGB response as ordinary PBR can restore shadows while
  materially changing the authored shader.
- Ambiguous, mixed, unsupported, or unreachable graphs refuse loudly unless
  the artist chooses the namespaced `LIT` or `UNLIT` override.
- Lit carriers use ordinary core metallic-roughness glTF with metallic `0`
  and roughness `0.5`. Unlit carriers use `KHR_materials_unlit`. Neither path
  requires a Blendlink-specific material decoder.
- Opaque, mask, and blend classifications are computed per primitive binding,
  shared materials split into attested variants when necessary, and the final
  GLB is re-read to verify alpha mode, PBR factors, extension use, selected
  field bytes, sampler, and UV evidence.

Focused evidence passed on 2026-07-24 with Blender 5.2.0 LTS:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' `
  --background --factory-startup --python-exit-code 1 `
  --python packages/blender-addon/tests/material_compiler_check.py
npx vitest run packages/blendlink/src/sceneDiagnostics.test.ts
```

The Blender gate covers direct lit and unlit graphs, nested portable groups,
Shader-to-RGB convergence refusal, a disconnected lit scratch branch,
Translucent/mixed/unreachable refusal, explicit overrides, shared-material
alpha variants, and final artifact attestation.

The retained hash-pinned Splash diagnostic publish contains 29 lit and 4
intentionally unlit selected-field materials, all 33 correctly classified
`OPAQUE`. It was produced by the now-rejected automatic Shader-to-RGB
heuristic; the conservative compiler correctly requires a supported
factorization or an explicit artist override before republishing those complex
materials. Chromium
loads exactly one content-addressed 42,890,492-byte GLB
(`d2d1e73c257afbf9a352b3cdf692dec468a74f2de50ba02a1b86b15556324b05`)
into a nonblank WebGL2 Canvas with no relevant request, console, or page
errors. The named doorway lamp and flowerpots recover, all 208 direct
renderable source object names occur in the GLB, and the registered broad
shadow gate passes. These pixels remain causal evidence for alpha and response
diagnosis, not the current compiler's accepted zero-configuration result.

This does not establish full Splash appearance parity. The current production
frame still collapses 10 small/outline regions versus 4 in the opaque-only
prototype. Against the retained Eevee reference, the sky local-noise ratio is
`2.287613` and its median color error is `3.475832` reference spreads; the
building pattern error is `0.841205` reference details. Whole-frame
MAE/RMSE (`0.16402220996732025` / `0.25419111744580364`) are worse than the
prior unlit carrier. Those are active, separately registered fidelity gaps,
not evidence against the narrower semantic improvement proved here.
