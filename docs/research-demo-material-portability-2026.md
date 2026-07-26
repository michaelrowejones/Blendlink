# Blender 4.0 Splash material portability, 2026

Research date: 2026-07-22

## Decision

Do not treat the Blender 4.0 Splash result as a lighting-tuning problem and do
not automatically route every **Needs Bake** material through the existing
Cycles Appearance bake. The published artifact has suffered complete material
payload collapse: all 33 materials used by the GLB are **Needs Bake**, while
the GLB contains no images, no textures, and no PBR parameters. Three therefore
renders the specification defaults instead of the authored colors.

That Final/verify quality gate is now implemented. It detects the condition
from the exact final artifact, groups source diagnostics by repeated material
graph, weights them by exported triangle coverage, and refuses to call the
result faithful without a deliberate remedy. It is additive to the existing
manifest contract.

That staging has now begun. Blendlink implements explicit constant and direct
color-attribute selections as ordinary unlit glTF and has dogfooded both one
DPM selection and 33 explicitly selected Splash materials. For remaining
intrinsic color, the next route is still an artist-named socket whose dependency
subgraph is proved for Cycles and baked through a private Emission proxy. Both
routes preserve selected fields; neither claims to reproduce the Splash's
complete `Shader to RGB`, ambient occlusion, shadows, Filmic, curve, or
compositor result. Those remain separate research cases.

Keep Blender's stock glTF exporter as the authority for recognized Principled
PBR graphs. A general Blender-node-to-Three shader compiler would take renderer
ownership from the application and turn Blendlink into the proprietary engine
the product boundary explicitly rejects.

## Evidence status

- **Implemented:** exact final-artifact coverage and payload classification,
  grouped/advisory reporting, independent Cycles compatibility, narrow
  collapse verification, export-scope diagnostics, private-scene PNG/EXR save
  ownership, the explicit `applicationMaterialAdapter` acknowledgement, and a
  shared plan/realize Material Compiler for exact constant and direct
  color-attribute selected fields.
- **Implemented:** compiler-private VEC4 carrier attributes plus an atomic GLB
  rewrite to standard `COLOR_0`. Blender-side attestation proves generated
  material/binding/primitive ownership and numeric color ranges; the final
  TypeScript document pass repeats those facts after resize, KTX2, and Meshopt.
- **Locally verified:** the untouched original was refused loudly at its
  210-frame range against the 120-frame exhaustive-audit cap, with durable
  evidence retained. A deterministically generated 120-frame derivative source
  compiled with Blender 5.2.0 LTS; the original file was not saved or mutated.
- **Locally verified:** the stock derivative intentionally fails performance
  and material verification but passes its packed-consumer production build and
  production Chromium HTTP/hash/WebGL/nonblank/error gate. The separate DPM-only
  and all-fields derivatives now pass material compilation and their production
  browser gates.
- **Locally verified:** the final packed `bakelib.py` writes both PNG and
  scene-linear EXR through a private stage while the actual Splash derivative's
  FFMPEG output and Filmic artist settings remain structurally untouched.
- **Measured only:** retained stock, DPM-only, and all-fields browser/reference
  statistics describe the visual change but are not an acceptance threshold or
  parity claim.
- **Future/prototype:** existing-image and selected-socket Cycles Emit
  materialization, separately proved alpha silhouettes, and any complete-
  surface family recognizer. A general EEVEE material engine is not the chosen
  product route.

## Reproduction inputs

| Input | SHA-256 | Frame range | Material evidence |
| --- | --- | ---: | --- |
| `C:\Users\micha\Downloads\blender-4.0-splash.blend` | `FEC31BE671D68E2594D087865FB2A8BBBC2929C56E365085A8D4E6AF260FB67F` | 1-210 | `a592b95162295418e55269f2eb48d79953d0de92dbde0def9304d9128ae2c727` |
| `artifacts/release-dogfood/blender-4-splash/fixtures/blender-4.0-splash-120f.blend` | `7CD0993A56E55379DDDF2EFB786597061CCD78215C4207AC0B4E1EA4C666E050` | 1-120 | `a592b95162295418e55269f2eb48d79953d0de92dbde0def9304d9128ae2c727` |
| `artifacts/release-dogfood/blender-4-splash/fixtures/blender-4.0-splash-web-color.blend` | `9B07007CBB8CAAC926E3F356D77501232295D4CD73CA48D8CD53C19198E24D85` | 1-120 | explicit DPM selected field |
| `artifacts/release-dogfood/blender-4-splash/fixtures/blender-4.0-splash-web-fields.blend` | `325FF0945DD82AB6DE15F6E1B10EE43D814FBEB3A2256DD094B62541C490284C` | 1-120 | 33 explicit selected fields |

The identical fingerprint in the first two rows covers material name, current
portability result, ordered reasons, and reachable active-Surface node types.
It establishes that the 120-frame baseline derivative did not change the
material problem; it is not a claim that those two complete `.blend` files are
otherwise identical. The two later fixtures deliberately add explicit Website
Color selections.

The inspected artifact is
`artifacts/release-dogfood/blender-4-splash/public/models/blender40Splash.glb`,
SHA-256
`F8F4DDC858D1F987A92E5F1B7942E146A9432BDBC8CE27B4D3978E4295FAF7A3`.
Its generator is `Khronos glTF Blender I/O v5.2.39`.

The artifact is 39,659,276 bytes. It contains 39,213,026 decoded accessor
bytes, of which 39,212,994 are geometry, and no embedded image or estimated GPU
texture bytes. It renders 1,100,070 triangles through 335 primitives/draws.

## Selected-field implementation and fresh dogfood

The first real all-fields compile was correctly refused: several generated
materials had a present but all-white `COLOR_0`. A targeted source/evaluated/
private-mesh probe showed that the intended `Attribute` bytes and selected
material bindings were still correct before Blender's exporter. In the bundled
Blender 5.2.39 `primitive_extract.py`, a later material slot using the same
layer can be looked up under a repeated key such as `AttributeAttribute`; the
all-vertex-colors fallback can then replace material mappings with another
layer. `export_all_vertex_colors=False` repaired only one affected slot, so it
was not accepted as a complete fix. The inspected logic is in the
[official Khronos/Blender primitive extractor][gltf-primitive-extract].

Two designs remained credible:

1. patch or fork Blender's exporter so its material-to-color lookup is correct;
2. preserve selected values through an exporter-neutral private carrier, then
   normalize the final GLB to ordinary `COLOR_0`.

Blendlink chose the second design. The compiler copies each selected source
layer into a private VEC4 mesh attribute, lets the stock exporter own primitive
splitting and accessor encoding, atomically points every generated-material
primitive's `COLOR_0` at the matching accessor, and erases all private
semantics. This avoids a source fork and keeps the public asset standard glTF.
The final GLBs contain no `_BLENDLINK_WEB_*` strings. When Blendlink enabled
custom-attribute export only to carry that private data, unrelated custom
semantics are removed; an explicit application-owned request to export custom
attributes remains intact.

Attestation is numeric, not structural-only. The Blender pass verifies
`KHR_materials_unlit`, base-color factor, alpha mode, double-sided state,
generated/source material ownership, bindings, primitive count, and finite
`COLOR_0` type/count/minimum/maximum. The TypeScript final-document pass repeats
that proof after resizing, KTX2, and optional Meshopt. The original white
failure is therefore a blocking test case, not a screenshot heuristic.
Selected bindings that exist only through evaluated Geometry Nodes on a
non-Mesh/Curve source also block: the compiler will not invent durable source
ownership for geometry that the artist cannot directly bind.

The fresh retained outcomes are:

| Scene | Compile | Selected-field evidence | GLB identity | Production browser evidence |
| --- | ---: | --- | --- | --- |
| DPM only (`blender40SplashWebColor`) | 24.7 s | 1 lowering; 1 vertex-color route with an attested numeric range | CLI 22,724 KiB; 23,269,768 fetched bytes; `75392D1CEC10F8D697D52554A2D6FC914C4AA71099BC0F0480FF1CE97638DFD2` | 1200x600 WebGL 2; entropy 5.835279; RGB standard deviations 56.0995 / 56.2362 / 56.2310; all HTTP/hash/Canvas/WebGL/nonblank/error assertions passed |
| All selected fields (`blender40SplashWebFields`) | 65.8 s | 33 lowerings: 30 vertex-color plus 3 factor; all 30 vertex routes have numeric evidence | CLI 37,780 KiB; 38,687,016 fetched bytes; `D7CDB1A1668AE2DE32E57B84C823E744A69FECDBD5D30291B69E2F7CF35EAB40` | 1200x600 WebGL 2; entropy 6.692781; RGB standard deviations 62.2697 / 65.4893 / 68.2333; all assertions passed with no relevant errors |

The production Vite build also passed. Both artifacts retain 1,100,070
rendered triangles; this material pass does not pretend to solve Splash's
separate distributed geometry cost.

The visual matrix is deliberately recorded as measurement, not acceptance:

| Final artifact | MAE | RMSE | Max channel error | Changed pixels |
| --- | ---: | ---: | ---: | ---: |
| Stock collapsed | 0.1813311 | 0.2640845 | 0.9098039 | 99.9750% |
| DPM selected field | 0.1813784 | 0.2643164 | 0.9098039 | 99.9340% |
| 33 selected fields | 0.1611896 | 0.2352268 | 1.0000000 | 99.9364% |

The all-fields result restores substantial selected chroma and improves the
aggregate error, but almost every pixel still differs. DPM alone does not
improve the aggregate selected-camera metric. Neither result includes
Shader-to-RGB lighting, AO, cast shadows, Filmic/view curves, film grain, lens
dispersion, or the procedural World, so neither is a full-surface or visual-
parity claim.

## What the current export-scoped diagnostics mean

An earlier all-datablock inventory of the complete source found 68 materials:

| Classification | Count |
| --- | ---: |
| Exact glTF | 15 |
| Approximated | 8 |
| Needs Bake | 45 |

The compiler now follows the actual export scope instead of presenting every
datablock as a publish warning. The retained manifest therefore has 42 records:
0 Exact, 0 Approximated, 42 Needs Bake, and 29 blocked from the current Cycles
Appearance route. Every record is bound to an export-scoped source object. The
stock exporter emits 33 material names in the final GLB, and the final-artifact
audit matches all 33 to Needs Bake diagnostics.

These are not unrelated edge cases. The export-scoped graphs repeat a small
number of stylized templates:

- all 42 use Hue/Saturation/Value on the active Surface path;
- 41 combine a shader with transparency through Mix Shader;
- 29 evaluate Diffuse lighting through EEVEE-only `Shader to RGB`, also use the
  Ambient Occlusion node, and are blocked from Cycles Appearance;
- 13 are the smaller outline family: Mix Shader, Hue/Saturation/Value, and
  Transparent BSDF;
- the remaining variants add Fresnel, Object Info, Geometry, Invert, or
  Translucent details.

The most important denominator is not all 68 source datablocks. The artifact
uses 33 materials, and **all 33 are Needs Bake**. They cover all 335 material
draws and all 1,100,070 rendered triangles; 29 of those used materials are
blocked by the current Cycles Appearance evaluator. The four largest affected bindings
already cover 69.8% of the triangles:

| Material | Triangles | Share |
| --- | ---: | ---: |
| `Bush.006` | 342,802 | 31.2% |
| `Bush.001` | 190,903 | 17.4% |
| `Bush.003` | 157,746 | 14.3% |
| `Outline` | 76,392 | 6.9% |

No exported material's reachable Surface path contains a Principled BSDF.
That matters because Blender documents the exporter as constructing Metal/Rough
PBR or unlit materials from node arrangements it recognizes, with base color
specifically taken from a Principled Base Color input or a recognized Image
Texture connection. [Blender glTF exporter manual][blender-gltf-manual] The
official exporter source follows that contract: it asks for Base Color,
BaseColor, or the special glTF material group, and falls back to white when no
factor can be gathered. [Khronos glTF-Blender-IO PBR gatherer][gltf-io-pbr]

The source has 20 packed file images, but none reached a recognized material
channel in this artifact. The GLB has:

- 33 material records;
- 0 textures;
- 0 images;
- no `pbrMetallicRoughness`, normal, occlusion, emissive, unlit, or other
  material-extension payload on any material;
- only material names and two `doubleSided` variants;
- `KHR_lights_punctual` as its sole used extension.

This is the direct mechanism behind the gray browser output. Core glTF defaults
an omitted base color to white and omitted metallic/roughness factors to 1.
[glTF 2.0 material specification][gltf-material-spec] Three r184's
`GLTFLoader` implements those glTF defaults explicitly when it creates a
`MeshStandardMaterial`: white color, metalness 1, and roughness 1.
[Three r184 GLTFLoader][three-gltf-loader]

The retained Blender reference has substantial chroma, while every pixel in
the retained browser capture is grayscale:

| Capture | Dimensions | Near-gray pixels | Mean channel range |
| --- | ---: | ---: | ---: |
| `blender-reference-0001.png` | 1200x600 | 11.09% | 56.52 |
| `splash-browser.png` | 1280x720 | 100% | 0.00 |

That evidence rules out tone-mapping adjustment as the primary fix. A tone
mapper cannot restore color information that is absent from the asset.

## Secondary appearance differences

Material restoration alone will not produce pixel identity with the retained
Blender render. The source is authored in EEVEE and uses:

- Filmic with Medium High Contrast;
- exposure `-0.10554122924804688` and gamma `1.1831185817718506`;
- an enabled view curve;
- an active compositor graph containing an overlayed Film Grain group and Lens
  Distortion with dispersion `0.3`;
- a World graph with Mix Shader, which Blendlink already records as omitted in
  the generated authoring-preview evidence.

The generated module correctly warns that Filmic, its look, display gamma, and
curve are not reproduced by Preview Studio. These are application-owned
presentation/post-processing choices, not missing glTF base-color data. They
should be evaluated after a material route has restored chroma.

## Why the existing Cycles bake is not a blanket fix

Blendlink's Appearance route intentionally uses Cycles Combined baking; the
mechanics live in [`bakelib.py`](../packages/blendlink/blender/bakelib.py), and
[`export_scene.py`](../packages/blendlink/blender/export_scene.py) switches the
private bake scene to Cycles before `bpy.ops.object.bake`. Blender's official
bake contract likewise describes Cycles baking to an active Image Texture or
color attribute, with UVs and island margins. [Blender Cycles baking
manual][blender-cycles-bake]

Splash also exposed a lower-level save-ownership problem before any material
route could be tested. In Blender 5.2, its artist scene's current `FFMPEG`
output can narrow the file-format enum enough that assigning `PNG` on that same
scene fails. `save_dithered()` and `save_linear_exr()` now share a disposable
private save scene. Only that scene receives Standard/None/0, output format,
channels, depth, and dither; the requested live image buffer is saved, a
nonempty result is required, and the scene is removed in `finally`.

This is a structural ownership change, not merely another restore block. The
real headless regression runs the final packed tarball against this exact
Splash derivative and records unchanged `FFMPEG` / `RGB` / 8-bit / dither 1 /
Filmic / Medium High Contrast / exposure `-0.10554122924804688`, successful
260-byte PNG and 1,311-byte EXR writes, and no leaked private scene in
[`private-save-stage.json`](../artifacts/release-dogfood/blender-4-splash/evidence/private-save-stage.json).
That evidence binds the run to packed tarball SHA-256
`AEDCC65DA7D527DECE05EDB14FC903C6B147BF5CE14089ECE94FEFA8AE0A2B89`.
The general add-on headless check separately rejects any attempt to call the
old artist-scene color helper and compares the artist state and complete scene
inventory before and after both writes.

But `Shader to RGB` is explicitly EEVEE-only and does not work in Cycles. It
evaluates lighting on its input BSDF before converting that result to color.
[Blender EEVEE node support][blender-eevee-nodes] It contributes to 31 source
materials, including 29 materials reached by the compiled artifact and the
dominant bush/DPM family. Therefore:

1. **Bake Appearance** is a valid route for Cycles-evaluable graphs.
2. It is not truthful to tell a Splash artist that the current Combined bake
   can preserve these EEVEE materials.
3. The portability report needs a separate answer to “can this graph be baked
   by the selected engine?” rather than using **Needs Bake** as if it implied
   “Cycles can bake it.”

The scene uses one Sun, but the selected-socket contract must stop upstream of
the EEVEE-only lit result unless a future pass separately proves that semantic.
Ambient Occlusion, cast shadows, world relationship, transparency, and actual
surface position still make a general exact UV-flattened result impossible.

## Design comparison

| Design | What it preserves | Splash outcome | Product fit | Decision |
| --- | --- | --- | --- | --- |
| Stock glTF plus a material-payload quality gate | Standard Principled/KHR material interoperability; website-owned renderer | Refuses the empty-material Final and names the affected graph families/triangle share | Excellent; deep compiler check, no renderer ownership | **Implemented and verified** |
| Existing Cycles Appearance bake | A flattened, unlit Combined atlas for Cycles-evaluable, UV-bakeable graphs | Cannot evaluate the 29 used Cycles-blocked materials faithfully | Good when explicitly selected and compatibility-proven | **Compatibility diagnostics implemented; keep the proven route** |
| Explicit direct selected-field lowering | Artist-marked constant or exact Color/Alpha attribute published as ordinary unlit factor or `COLOR_0` | Restores the chosen intrinsic field while leaving EEVEE lighting/post claims out | Excellent; source-visible, standard output, numerically attested | **Implemented and dogfood-verified** |
| Automatic recognized graph lowering | Only a complete, proven source pattern translated to ordinary glTF PBR/unlit payload | Could remove repetitive artist marking for an exact family | Good only when the complete Surface equivalence is proved | **Future; no family is inferred from a similar name** |
| Explicit selected-socket Cycles Emit bake | The artist-selected, Cycles-evaluable intrinsic color field, flattened through private proxy nodes into a standard texture | Can restore remaining chosen color without pretending to bake Shader to RGB, AO, shadows, or compositor output | Good as a narrow compiler-owned materialization pass | **Prototype second, only for explicit selections** |
| General EEVEE UV-space materializer | Arbitrary EEVEE-evaluable surface graphs | Would require reconstructing position, normals, object coordinates, derivatives, masks, and scene/view dependencies before making fidelity claims | Too broad for the evidenced job and risks becoming a second renderer | **Do not make this the default route** |
| EEVEE fixed-camera render plate | The authored camera, compositor, and screen-space result | Highest single-view pixel fidelity | Poor as a general 3D scene; freezes view/interactivity and duplicates website presentation ownership | **Application-owned fallback/reference only** |
| Blender-node-to-TSL/GLSL runtime translator | Potentially dynamic procedural shading | Would require a large semantic/runtime surface and still must reproduce EEVEE lighting nodes | Conflicts with the non-engine product boundary | **Reject as a general Blendlink feature** |

The last choice has weak standards support today. Khronos has ratified focused
PBR material extensions, but arbitrary procedural textures are only an initial
draft (`KHR_texture_procedurals`) in the current registry.
[glTF extension registry][gltf-extensions] Three's own migration guide also
records that its node-material implementation is WebGPU-only after r170, so a
TSL commitment would constrain the application's renderer rather than merely
ship an ordinary glTF scene. [Three migration guide][three-migration]

## Implemented foundation and next sequence

### 1. Implemented: block complete material payload collapse in Final/verify

After the stock export, Blendlink inspects material bindings and the final GLB. If every
used authored material is Needs Bake and the artifact supplies no meaningful
PBR/unlit/texture/emissive material payload, report an artist-readable failure
before browser verification. The verified Splash diagnostic reports:

> Material appearance collapsed: 33/33 used materials and 1,100,070/1,100,070
> triangles would publish with white glTF defaults. The dominant graph uses
> EEVEE Shader to RGB, procedural color, AO, and transparency. Choose a proven
> bake/materialization route, simplify to portable Principled inputs, or provide
> an application-owned material adapter.

Do not infer failure merely from `Needs Bake`; an intentionally approximate
artifact may still carry useful factors or textures. Detect the emitted payload
and require an explicit acknowledgement if loss is intentional. That interface
is the scene config's `applicationMaterialAdapter` object, whose
`acknowledgePayloadCollapse` must be exactly `true` and whose nonempty
`description` names the application-owned remedy. It converts only the narrow
collapse error to a loud warning and calls for browser verification. It does
not reshape the manifest, suppress the portability report, or assert that the
adapter is faithful.

### 2. Implemented core: separate portability from bake compatibility

For each reachable material graph, report independently:

- glTF portability: Exact / Approximated / Needs Bake;
- Cycles Appearance compatibility: compatible / blocked, with `Shader to RGB`
  as a named blocker;
- view/scene dependence: camera, world position, AO, shadows, transparency, or
  another dependency that a UV materializer would freeze or lose;
- affected exported objects, draws, and triangles.

Structurally fingerprint repeated active graphs so this scene presents roughly
seven graph families instead of 42 near-identical export-scoped walls of text.
Preserve the material-name drill-down for artists.

The current final-artifact advisory now reports used-material and rendered-
triangle coverage, distinguishes affected triangles with and without meaningful
payload, and counts only used Cycles blockers. Blender and CLI remedies no
longer offer Cycles Appearance when it is blocked. The remaining research in
this step is a more explicit camera/world/AO/shadow-dependence vocabulary so
portable lowering and selected-socket baking cannot overclaim their scope.

### 3. Implemented direct selections; next, selected-socket Emit

The disposable DPM-only and all-fields derivatives now exercise explicit
constant/attribute selections. They publish standard unlit factors or
`COLOR_0`, retain selected-field limitations in diagnostics, and refuse when
source sockets, conversions, bindings, attributes, or transparency are not
proved. This is not automatic recognition of the 29 Shader-to-RGB graphs.

For a family that still needs materialization, require the artist to select the
exact source socket. Validate the socket's reachable dependency graph against
the Cycles evaluator, connect it only inside private proxy nodes to Emission,
bake the Emit pass into the committed atlas UVs, and publish an ordinary unlit
or PBR base-color texture. Do not guess a socket or route the EEVEE-only Shader
to RGB result through a Cycles pass. Verify:

- original `.blend` hash unchanged;
- final GLB contains actual images/textures and no longer triggers the complete
  payload-collapse gate;
- the lowered or selected-socket contract and refusal cases are
  artist-readable;
- color-space contract remains Standard/None/0 on saved bytes;
- alpha coverage and outline silhouettes survive;
- exact bytes either reproduce at Preview/Final tiers or trigger the existing
  complete-graph drift warning without weakening integrity;
- selected camera gains chroma, with other views used to expose frozen
  position/AO/shadow assumptions.

The next distinct transport is an explicit procedural socket such as
`DP-SkyPaint.MAT → Group.Result`. Separately prove alpha/silhouette acceptance
for an outline case. Do not silently bake the all-datablock inventory's 45
Needs Bake materials, and do not infer a selected source from a graph family.

### 4. Keep exact EEVEE/post parity as separate future work

The earlier EEVEE UV-canvas prototype remains research evidence, not the next
general product layer. Productizing it would first require proof for original
position, normals, object coordinates, alpha, derivatives, margins, and every
scene/view dependency. AO, cast shadows, screen-space effects, Filmic/curves,
and the compositor still need separate acceptance evidence. A fixed-camera
EEVEE render is a visual reference or application-owned plate, not proof that
the navigable Blendlink scene matches.

## Verified dogfood versus research

Verified now:

- the untouched original refuses loudly at 210 frames against the 120-frame
  exhaustive-audit cap, and the refusal evidence is retained;
- the reproducibly generated derivative source produces the grouped, triangle-
  weighted report and exact complete-collapse failure from its final GLB;
- the packed production consumer builds and its browser gate passes exact
  HTTP/hash/WebGL/nonblank/error assertions while Final verification rejects
  the same artifact on artistic-payload grounds;
- the DPM-only derivative compiles one vertex-color selection in 24.7 seconds,
  and the all-fields derivative compiles 30 vertex-color plus 3 factor
  selections in 65.8 seconds;
- both selected-field artifacts pass exact production HTTP/hash/WebGL/nonblank/
  error assertions, every vertex route carries final numeric range evidence,
  and neither final GLB contains a compiler-private carrier semantic;
- the all-fields visual comparison improves MAE/RMSE to
  `0.1611896`/`0.2352268`, while its 99.9364% changed-pixel ratio remains clear
  evidence that this is selected-color recovery rather than Blender parity;
- geometry, animation, loading, and browser-health evidence remain independent
  of a visual-parity claim.

Still a bake research case:

- any claim that Cycles Combined can reproduce the Splash;
- automatic routing of Needs Bake to an atlas;
- automatic complete-surface graph lowering or an implicit choice of the
  socket to bake;
- any claim that selected-socket Emit reproduces Shader-to-RGB/AO/shadows;
- general EEVEE UV-space materialization of scene/view-dependent graphs;
- general graph translation to Three/TSL;
- matching Filmic, view curves, film grain, chromatic dispersion, and World
  shading inside Blendlink's scene runtime.

## Primary sources and local source anchors

- [Blender glTF exporter manual][blender-gltf-manual]
- [Official Khronos/Blender glTF exporter source][gltf-io-pbr]
- [Official Khronos/Blender primitive extractor][gltf-primitive-extract]
- [Blender Cycles baking manual][blender-cycles-bake]
- [Blender EEVEE node support][blender-eevee-nodes]
- [Khronos glTF 2.0 material specification][gltf-material-spec]
- [Khronos glTF extension registry][gltf-extensions]
- [Three r184 `GLTFLoader` source][three-gltf-loader]
- [Three migration guide][three-migration]
- Installed exporter inspected at
  `C:\Program Files\Blender Foundation\Blender 5.2\5.2\scripts\addons_core\io_scene_gltf2`,
  version `(5, 2, 39)`. Relevant symbols are `gather_material`,
  `gather_material_pbr_metallic_roughness`, `get_node_socket`, and
  `check_if_is_linked_to_active_output`.
- Installed Three inspected at
  `node_modules/three/examples/jsm/loaders/GLTFLoader.js`, npm version `0.184.0`.
- Blendlink diagnostics: [`procedural.py`](../packages/blender-addon/procedural.py).
- Blendlink canonical bake mechanics:
  [`bakelib.py`](../packages/blendlink/blender/bakelib.py).
- Blendlink bake orchestration:
  [`export_scene.py`](../packages/blendlink/blender/export_scene.py).

[blender-gltf-manual]: https://docs.blender.org/manual/en/5.1/addons/import_export/scene_gltf2.html
[gltf-io-pbr]: https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/addons/io_scene_gltf2/blender/exp/material/pbr_metallic_roughness.py
[gltf-primitive-extract]: https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/addons/io_scene_gltf2/blender/exp/primitive_extract.py
[blender-cycles-bake]: https://docs.blender.org/manual/en/5.0/render/cycles/baking.html
[blender-eevee-nodes]: https://docs.blender.org/manual/en/5.0/render/eevee/limitations/nodes_support.html
[gltf-material-spec]: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#reference-material-pbrmetallicroughness
[gltf-extensions]: https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md
[three-gltf-loader]: https://github.com/mrdoob/three.js/blob/r184/examples/jsm/loaders/GLTFLoader.js#L3541-L3588
[three-migration]: https://github.com/mrdoob/three.js/wiki/Migration-Guide
