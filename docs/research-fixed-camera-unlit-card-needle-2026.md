# Fixed-camera unlit cards: Blender, Needle, and Blendlink, 2026

Status: **implemented and verified** for the exact generated-card grammar in
the package fixture and production MichaelRoweJones dogfood. This record does
not authorize general Light Path or Mix Shader acceptance.

Stable capability ID: `NDL-MAT-013`.

## Question

Blendlink's own `capture_fixed_camera_card()` primitive compiles a fixed-camera
Eevee capture to one RGBA image and one quad. The MichaelRoweJones Final publish
was refused because Material Fidelity classified that generated material as
`needsBake`. The investigation asked whether this was a real fidelity loss, a
Needle/stock-export limitation, or a Blendlink diagnostic false positive.

## Exact inspected sources

The current Needle baseline first passed `npm run verify:needle-baseline`: 130
files, nine source-version identities, reviewed 2026-07-25. The broad inventory
remains `integration=mixed-source`; the material-export finding below is
attributed to the exact add-on and Blender exporter files rather than presented
as a coherent production Needle transform.

| Owner | Version and normalized source | SHA-256 |
| --- | --- | --- |
| Needle add-on | `1.4.2` `blender_export.py` | `6272997cfb4f1d740ea33a7c2512983b9993dedf93c9c8240ca0ff7f82925d77` |
| Needle add-on | `1.4.2` `extensions/NEEDLE_components.py` | `e543cb43130fcb9672879dec44fcd9aebbc31bfa3764610fb40828116754e97a` |
| Needle add-on | `1.4.2` `extensions/NEEDLE_components_postprocess.py` | `90cdd4fbd883858816d36ea1605e75fd820c4bcac2e8d8c87e76a465eb1ce031` |
| Needle add-on | `1.4.2` `panels_object.py` | `89dbb640ce3326915de768773e9ed7443a5f1778ed37b418437d757abff279ec` |
| Blender glTF | `5.2.39` `blender/exp/material/unlit.py` | `71a8dc2fdcb0b05ec4f4c52c15607b45f08b69f1553fdf6abfaf891815fe5aa4` |
| Blender glTF | `5.2.39` `blender/exp/material/materials.py` | `f0678496e6762566727fc9c76264c7d7665b2f22dee4671b63cfe968ed5c31` |
| Blender glTF | `5.2.39` `blender/exp/material/search_node_tree.py` | `0c037d078db37da3b6d65054206a9f55d19fa5f8ca6542f5add614230c39f7e9` |
| Needle runtime inventory | `src/engine-components/Renderer.ts` | `c77ede6eee371ccce367281e22c77aacfdce4fd9d57c23d3d67ca9fa6ec0e159` |
| Needle-nested Three | `0.169.19` `examples/jsm/loaders/GLTFLoader.js` | `4aba05147b1ccb01f581979ea44950b60a568e74a5db811df9f5573a2b3521b1` |

Blender was `5.2.0 LTS`, build `fbe6228777e7`, with exporter tree digest
`06ad0a3f28605ab8d52aea0703c522488b2821cb9e2d6d91b70673a1c967a66a`.

## Observed behavior

Needle's add-on delegates ordinary material serialization to
`bpy.ops.export_scene.gltf`; it does not lower or bake this material itself.
Blender 5.2.39 deliberately recognizes a camera-ray shadeless grammar and
emits `KHR_materials_unlit`.

The saved dogfood material has the exact generated topology:

1. One RGBA Image Texture drives Emission Color.
2. `Light Path / Is Camera Ray` drives an inner Mix Shader.
3. White Transparent is inner input 1; unit-strength Emission is input 2.
4. The same image Alpha drives an outer Mix Shader.
5. The same Transparent is outer input 1; the inner Mix is input 2.
6. The outer Mix alone drives the active Material Output Surface.

A stock Blender export emitted one `KHR_materials_unlit` material,
`alphaMode: BLEND`, `doubleSided: true`, and one base-color texture containing
the exact source PNG bytes. This is a diagnostic false positive, not a request
for another bake or an application material adapter.

Needle does not preserve the graph's non-camera-ray shadow intent by default.
Its renderer metadata defaults shadow casting to On, and the runtime applies
that Boolean. A blended `MeshBasicMaterial` with no alpha test can therefore
cast a solid card shadow. Blendlink's generated card already set Blender
`visible_shadow=false`, but core glTF did not carry it.

## Designs compared

| Design | Result |
| --- | --- |
| Require a site adapter, explicit Website Color, or a second bake | Rejected. It asks a developer or artist to acknowledge a loss that the stock exporter does not have and risks rewriting already-correct RGBA bytes. |
| Import Blender's private `detect_shadeless_material()` | Rejected. It couples Blendlink planning/UI to a private module and wider grammar whose strength, alpha-source, and secondary-ray losses are not all acceptable. |
| Match a strict generated-card subset and attest the final GLB | Chosen. It is name-independent, revision-gated, accepts the exact package-authored representation, and keeps independent near-misses loud. |

## Implemented contract

`procedural.analyze_material()` recognizes only the direct top-level generated
family when all of these remain true:

- exactly one active Material Output;
- no linked Volume, Displacement, or other output channel;
- exact outer alpha and inner camera-ray branch order;
- `Is Camera Ray`, not another Light Path output or a Math wrapper;
- one unmuted white Transparent node shared by both mixes;
- unlinked Emission Strength `1` and Weight `0`;
- one four-channel Image Texture supplies both Color and Alpha; and
- exporter identity is exactly `5.2.39`.

The material is reported **Approximated**, not pixel-exact: camera-visible
RGBA and unlit transport are exact in stock glTF, while Blender's Dithered
surface and per-ray model become raster alpha plus object-level shadow flags.
Unknown, older, and future exporter identities remain `needsBake` until their
source and differential are pinned.

`bakelib.capture_fixed_camera_card()` now authors
`blendlink_cast_shadow=false` in addition to native `visible_shadow=false`.
That is a scoped **Improvement** over Needle's default for this compiler-owned
card. Blendlink does not infer no-cast intent for arbitrary artist objects.

## Evidence

The registered Blender test was first observed failing on the canonical graph,
then passed after the implementation:

```text
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" \
  --background --factory-startup --python-exit-code 1 \
  --python tests/run_headless.py
BLENDLINK_ADDON_TESTS_PASSED
```

The fixture independently mutates `Is Shadow Ray`, both branch orders,
Emission Strength, a separate alpha image, procedural alpha, linked Volume,
and exporter identities `4.2.0`, unknown, and `5.2.40`; every near-miss remains
`needsBake`. It then exports the positive quad through the stock exporter and
asserts `KHR_materials_unlit`, `BLEND`, double-sided output, exact sampler,
byte-identical PNG, and the `blendlink_cast_shadow=false` node extra.

The exact package tarball
`blendlink-0.8.0-6f1d1fb19ed5c89997c5a62f45839b0fed6b4ba38450873699523e91eca30c9b.tgz`
installed with archive and installed-tree fingerprint equality. Then:

```text
npm run blendlink:publish -- workbenchDogfood
21 passed
Final assets, repository build, and configured browser smoke verified
```

The regenerated dogfood card retains the same packed `115x84` PNG SHA-256
`6a8d2c61d35c45ef5014e60ff60c56ad734fb3523f8ce760e21efa4317ab438a`.
The independent Eevee source-versus-card gate passed at `1600x900` with MAE
`0.1760`, RMSE `0.8122`, IoU `0.9832`, and at `1200x900` with `0.0947`,
`0.5335`, `0.9912`. The generated manifest records the Approximated reason and
`blendlink_cast_shadow=false`; the public hero's atomic/nonblank screenshot
shows the cloud in the upper-right window.

This proves structural transport, package intent, exact-package publication,
and same-camera production visibility. The following remain separate claims:

- **Pending:** same-camera browser-versus-Eevee edge pixels for Dithered versus
  glTF Blend across physical GPU and multiple browsers.
- **Future:** arbitrary/moving-camera Geometry Nodes cloud transport. The
  direct source has view-dependent Shader-to-RGB/procedural behavior and is not
  covered by this card grammar.
