# Blender 5.2 glTF exporter capability cells

**Audit date:** 2026-07-25

**Status:** Shipped and verified structural/exporter evidence; no browser-pixel claim

**Experiment:** `experiments/blender-52-exporter-cells/`

## Conclusion

The user-supplied [Blender 5.2 glTF manual][blender-manual] is directly useful
to Blendlink. It describes an exporter grammar, not merely a file command:
portable materials include specific node patterns. This audit found three
places where Blendlink's material diagnostic grammar was narrower than the
pinned exporter, then closed them without making the grammar generally
permissive.

The compact differential found three actionable results:

1. Blendlink already preserves the tested stock material path extremely well.
   The broad compiled GLB is byte-for-byte identical to a direct stock export
   using the pinned Needle 1.4.2 argument family. Blender emitted the tested
   core material fields plus twelve material/texture extensions, and installed
   Three r184 loaded every result into the expected material fields.
2. Blendlink had one verified **false-positive blocker**: Blender 5.2's
   documented/exporter-recognized textured alpha-clip `Math` graph emits
   `alphaMode: "MASK"` and `alphaCutoff`, and Three r184 loads it as
   `alphaTest`. Blendlink now recognizes only the five direct exporter
   topologies covered by the focused headless matrix. Arbitrary Math, reused
   clip output, and a Noise source remain loud blockers.
3. Two nonblocking diagnostics overstated loss. Full `Sheen Weight = 1` and a
   correctly paired `glTF Material Output` thin-film/iridescence setup are
   emitted and loaded. Blendlink now marks those verified contexts Exact while
   keeping partial/linked sheen and unpaired/linked thin film non-Exact.

The deliberately unsupported Noise Texture control is also valuable:
Blender's stock path emits a fallback material with no procedural texture,
whereas Blendlink refuses publication and names the loss. The inspected Needle
1.4.2 export wrapper has no analogous preflight at that seam. This is a
verified Blendlink improvement in failure behavior, not a visual comparison.

Production diagnostics, focused add-on regressions, and this experiment were
changed. The shared technique ledger and feature-parity record now carry the
same bounded conclusions; this note remains the detailed evidence source.

## Primary sources and pinned identities

The normative format baseline is the Khronos [glTF 2.0 specification][gltf-spec]
and [glTF extension registry][gltf-extensions]. The authoring baseline is
Blender's [5.2 glTF manual][blender-manual]. Runtime loading was tested through
the installed implementation of Three's documented [`GLTFLoader`][three-loader],
not inferred from TypeScript declarations.

| Artifact | Exact identity |
| --- | --- |
| Blender | 5.2.0 LTS, build `fbe6228777e7`, build date 2026-07-14 |
| Installed Blender glTF exporter | 5.2.39 |
| Exporter root | `C:/Program Files/Blender Foundation/Blender 5.2/5.2/scripts/addons_core/io_scene_gltf2` |
| Exporter Python-tree identity | 126 `.py` files; SHA-256 `06ad0a3f28605ab8d52aea0703c522488b2821cb9e2d6d91b70673a1c967a66a` |
| Exporter `__init__.py` | SHA-256 `0cd8903bd1a72ef1edbd728bee70d24a3ecc93c9901db68927b00910bb38be70` |
| Exporter material search grammar | `blender/exp/material/search_node_tree.py`; SHA-256 `0c037d078db37da3b6d65054206a9f55d19fa5f8ca6542f5add614230c39f7e9` |
| Pinned Needle add-on | 1.4.2 |
| Needle export wrapper | `blender_export.py`; SHA-256 `6272997cfb4f1d740ea33a7c2512983b9993dedf93c9c8240ca0ff7f82925d77` |
| Blendlink | package 0.8.0; tested built CLI SHA-256 `c9ee7428199d964f5e1599fb913f4267772ab85aec76730c780086c3be2f47a9` |
| Blendlink diagnostic module | `packages/blender-addon/procedural.py`; SHA-256 `fa5a921e74316aa437751baed9066d737125229f945df359dd9447c178d6d042` |
| Three | 0.184.0; `package.json` SHA-256 `8308e43d6d6dd4c636c2dfe2e724da07dcd9fe4349bba6afb56f2c5ba6625391` |
| Installed Three loader | `node_modules/three/examples/jsm/loaders/GLTFLoader.js`; SHA-256 `97642d720f16cc9a0c9844934198e4d0c023bea8e89576d0f7545d03b2d103d2` |

`output/source-identity.json` contains the complete sorted per-file exporter
inventory and hashes. Its tree digest is defined as:

```text
sha256(sorted normalized relative path + NUL + per-file sha256 + LF)
```

This matters because “Blender 5.2” is not a sufficient exporter identity.
The installed exporter independently reports 5.2.39 and can evolve inside a
Blender release family.

### Exact applicability boundary

The three relaxed diagnostics are enabled only when the runtime exporter
reports the exact `io_scene_gltf2.bl_info.version` tuple `(5, 2, 39)`.
Blendlink's add-on still supports Blender 4.2 and later, but this experiment
does not claim that 4.2 through 5.1—or a future exporter after 5.2.39—uses the
same material grammar. Unknown, older, and newer exporter revisions therefore
retain the pre-fix conservative behavior:

- recognized alpha-clip Math remains `Needs Bake`;
- nonzero Sheen Weight remains `Approximated`; and
- authored Thin Film remains non-Exact even beside the recognized settings
  group.

The focused headless suite injects exporter versions `(4, 2, 0)`,
`(5, 2, 40)`, and an unavailable/unknown `None` result and requires those
three outcomes to stay loud. This is an internal capability seam; the public
`analyze_material(material)` interface is unchanged. Adding another accepted
exporter version requires a pinned source identity and rerunning the
differential cells first.

### Needle comparison

For Blender 3.6 and newer, pinned Needle 1.4.2 calls
`bpy.ops.export_scene.gltf` with:

```json
{
  "check_existing": false,
  "export_format": "GLB",
  "export_cameras": true,
  "export_lights": true,
  "use_active_scene": true,
  "gltf_export_id": "Needle Engine",
  "export_import_convert_lighting_mode": "COMPAT",
  "export_apply": true,
  "export_animations": true,
  "use_visible": false,
  "export_image_format": "AUTO",
  "export_jpeg_quality": 100
}
```

The direct stock side of this experiment uses that exact argument family.
This pins the relevant Needle behavior at the exporter seam. It does **not**
claim that Needle's licensed production transform was run, nor that Needle
component hooks produce identical bytes in a component-bearing scene.

Needle's inspected `blender_export.py` calls the stock operator and reports
operator exceptions. Its material panel enumerates image textures for
compression settings. No analogous active-surface portability preflight was
found in those relevant paths. Therefore the Noise Texture comparison is
limited to this export seam; it is not a claim about every possible Needle
editor warning.

## Fixture design

`create_fixtures.py` regenerates three small `.blend` files with factory
startup, Eevee as source engine, one frame, packed 2×2 textures, and no
scene-specific Blendlink configuration:

| Fixture | Purpose |
| --- | --- |
| `portable-factors.blend` | Core Principled, direct alpha blend, direct-color unlit, clearcoat, transmission, volume, IOR, sheen, specular, anisotropy, emissive strength, iridescence, dispersion, and a UV Mapping → Image Texture transform |
| `portable-alpha-mask.blend` | Image alpha → `Math: Greater Than` → Principled Alpha, one of Blender 5.2's explicitly recognized alpha-clip graph forms |
| `unsupported-procedural.blend` | Noise Texture → Principled Base Color, a negative control that stock editable glTF cannot carry |

The runner:

1. recreates the fixtures and direct stock GLBs in Blender 5.2;
2. records source, fixture, and output hashes;
3. parses GLB JSON without rewriting it;
4. calls the installed Three r184 `GLTFLoader`;
5. runs zero-configuration Blendlink plans for all three cells;
6. compiles the accepted broad and alpha-mask cells;
7. checks both compiled GLBs against the direct stock bytes; and
8. asserts the positive contexts and the independent negative controls.

The Node loader test supplies only a minimal `createImageBitmap` test adapter,
so texture objects can be constructed in Node. It validates loader structure
and material fields. It does not upload to a GPU, compile shaders, or prove
browser pixels.

## Results

### Broad stock/KHR cell

The direct GLB is 19,192 bytes with SHA-256
`ae8f231eb6294831e371aad9ec3477a3b18a0971264e5bd7772bd1d18b65c27d`.
It declares:

```text
KHR_lights_punctual
KHR_materials_anisotropy
KHR_materials_clearcoat
KHR_materials_dispersion
KHR_materials_emissive_strength
KHR_materials_ior
KHR_materials_iridescence
KHR_materials_sheen
KHR_materials_specular
KHR_materials_transmission
KHR_materials_unlit
KHR_materials_volume
KHR_texture_transform
```

The material values were not merely declared. Representative exact structural
observations include:

| Cell | Blender 5.2 GLB | Three r184 |
| --- | --- | --- |
| Alpha blend | `alphaMode: BLEND`, factor alpha `0.38` | `transparent: true`, `opacity: 0.38` |
| Clearcoat | factor `0.70`, roughness `0.16` | `clearcoat: 0.70`, `clearcoatRoughness: 0.16` |
| Transmission/volume | transmission `0.82`, thickness `0.45`, attenuation distance `5.0`, IOR `1.33` | matching `MeshPhysicalMaterial` fields |
| Iridescence/dispersion | factor `0.64`, IOR `1.42`, maximum thickness `460`, dispersion `0.18` | matching `iridescence`, `iridescenceIOR`, and `dispersion` |
| Sheen full weight | color `[0.82, 0.28, 0.12]`, roughness `0.42` | `sheen: 1`, matching color/roughness |
| Anisotropy | strength `0.65`, converted rotation `1.256637...` | matching anisotropy fields |
| Emission | `KHR_materials_emissive_strength: 3.6` | `emissiveIntensity: 3.6` |
| Unlit | `KHR_materials_unlit` | `MeshBasicMaterial` |
| Texture transform | offset `[0.102239..., 0.397331...]`, rotation `0.3`, scale `[2, 0.5]` | matching map offset/rotation/repeat |

Blendlink compiled this cell successfully. Its stable GLB and addressed copy
are both 19,192 bytes with the **same SHA-256 as the direct stock GLB**. This
is verified byte preservation for this fixture and toolchain, not a universal
claim about all Blender scenes.

Blendlink's manifest now records all ten materials as `Exact glTF`, zero as
`Approximated`, and zero as `Needs Bake`. Focused regressions separately keep
partial/linked sheen and unpaired/linked thin film non-Exact.

### Alpha-mask differential

The stock GLB is 3,232 bytes with SHA-256
`5c8c57460d18c09f56722f95a577f674fb65bc32852fb95b9fb2ccb2c03095ba`.
It contains:

```json
{
  "name": "Cell.AlphaMask",
  "alphaMode": "MASK",
  "alphaCutoff": 0.41999998688697815
}
```

Three r184 creates a `MeshStandardMaterial` with `alphaTest: 0.41999999` and
the base-color/alpha texture attached.

Blendlink plan now exits 0. Compile succeeds, the stable and addressed output
remain byte-for-byte identical to the direct stock GLB, and the manifest
contains one `Exact glTF` material.

The production matcher recognizes the installed exporter's direct `ROUND`,
legacy `GREATER_THAN`, legacy `LESS_THAN`, `LESS_THAN` then `SUBTRACT`, and
reversed `GREATER_THAN` then `SUBTRACT` shapes. The Math output must feed only
Principled Alpha. An arbitrary `MULTIPLY`, output reused for Roughness, and a
recognized clip fed by Noise each remain `Needs Bake` in the add-on headless
suite.

### Procedural negative control

The stock GLB is 2,616 bytes with SHA-256
`a6d60d9faa27edcecdbff72362cb06df78741f78f5c0b4442062a031e5d4f014`.
The Noise Texture has no editable glTF representation; the resulting material
contains only fallback core factors and Three loads that fallback.

Blendlink plan exits 1 with:

```text
material.used-needs-bake
Cell.UnsupportedNoise
Noise Texture contributes to the active surface but cannot be represented as editable glTF.
```

This is the desired loud, artist-readable behavior. At the inspected export
seam, it improves on simply invoking the stock exporter and accepting the
collapsed payload.

## Capability record

The local evidence cells below map into the shared technique ledger as follows:
`B52-MAT-001` through `B52-MAT-005` support `NDL-MAT-001`;
`B52-MAT-006` supports `NDL-MAT-002`.

| ID | Capability | Relation to pinned Needle export seam | Implementation | Evidence |
| --- | --- | --- | --- | --- |
| B52-MAT-001 | Core Principled, direct alpha blend, unlit, image, UV mapping/transform | **Match** | **Shipped** | **Verified 2026-07-25**: direct stock structure, Three r184 load, Blendlink compile, byte-identical broad GLB |
| B52-MAT-002 | Clearcoat, transmission, volume, IOR, specular, anisotropy, emissive strength, sheen, iridescence, dispersion | **Match** for tested constants | **Shipped** | **Verified 2026-07-25** structurally and through Three r184; browser pixels not tested |
| B52-MAT-003 | Exporter-recognized alpha-clip Math topology | **Match** | **Shipped** | **Verified 2026-07-25**: stock `MASK` + cutoff; Three `alphaTest`; Blendlink plan/compile pass; byte-identical GLB; five positive and three negative headless shapes |
| B52-MAT-004 | Full `Sheen Weight = 1` diagnostic | **Match** | **Shipped** | **Verified 2026-07-25**: exporter/Three represent full sheen; manifest Exact; 0/1, partial, linked, older-exporter, and newer-exporter headless matrix |
| B52-MAT-005 | Paired glTF Material Output thin-film/iridescence diagnostic | **Match** | **Shipped** | **Verified 2026-07-25**: factors emitted/loaded; manifest Exact; paired, disabled, noncanonical, unpaired, linked, older-exporter, and newer-exporter headless matrix |
| B52-MAT-006 | Unsupported procedural material refusal | **Improvement** | **Shipped** | **Verified 2026-07-25** at the export seam: stock fallback vs Blendlink named exit 1; authenticated Needle browser run not performed |

## Implemented general fixes

### 1. Narrow alpha-clip grammar

`analyze_material(material)` remains the small public interface. Its internal
matcher accepts only the installed exporter's direct clip patterns:

- `Math: Round`;
- `1 - (X < cutoff)`;
- `1 - (cutoff > X)`; and
- the exporter's legacy `X > cutoff` and `cutoff < X` forms.

The matcher exempts only the structural Math nodes; ordinary traversal still
inspects the upstream source. Arbitrary Math and a recognized clip fed by
Noise remain `Needs Bake`. Blendlink additionally requires exclusive clip
output use, a stricter guard than the exporter that prevents an alpha helper
from making an unrelated PBR socket look portable.

This deepens the existing module: callers learn nothing new, while exporter
version knowledge and topology checks remain local behind its existing
interface.

### 2. Context-sensitive extension diagnostics

Two exact internal recognizers are shipped:

- Treat `Sheen Weight` as structurally exact when it is unlinked and exactly
  `0` (disabled) or `1` (full extension weight). Continue to report intermediate
  constants as approximated because exporter 5.2.39 uses the socket as an
  enable gate and does not serialize its magnitude. A linked weight must remain
  a loud blocker until independently proven.
- Recognize `Thin Film Thickness` and `Thin Film IOR` as transported only when
  the same material has the exporter-defined `glTF Material Output` inputs
  needed to emit `KHR_materials_iridescence`. Do not globally remove them from
  the omitted-input list.

Both changes are keyed to tested exporter behavior. The thin-film matcher
requires the canonical `glTF Material Output*` datablock prefix, enabled
unlinked factor, minimum input, and constant positive Principled thickness.
The installed exporter 5.2.39 contains a nested-`any` bug that can accept an
arbitrarily named group. Blendlink intentionally does not bless that accidental
shape: the headless matrix keeps a noncanonical group `Approximated`.

### 3. Preserved negative control

The dedicated gate reruns the Noise Texture cell and requires its independent
`material.used-needs-bake` evidence. The headless matrix also feeds Noise
through an otherwise recognized alpha-clip topology and still requires the
Noise reason.

### 4. Keep evidence layers separate

This audit proves:

- exact installed-source identity;
- emitted GLB structure;
- Three r184 loader field construction;
- Blendlink planning behavior; and
- byte preservation for the broad and alpha-mask compiled fixtures.

It does not prove:

- Eevee-to-Three pixel identity;
- texture GPU upload or shader compilation;
- transmission/refraction equivalence under a website renderer;
- Needle's authenticated production transform; or
- cross-browser behavior.

Those claims belong in browser/visual fixtures, not in this structural gate.

## Reproduction

From the repository root:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' `
  --background --factory-startup --python-exit-code 1 `
  --python 'packages\blender-addon\tests\run_headless.py'
node experiments/blender-52-exporter-cells/run.mjs
```

Last pass: 2026-07-25 on Blender 5.2.0 LTS build `fbe6228777e7`,
glTF exporter 5.2.39, Node 24.15.0, and Three 0.184.0. The first command
printed `BLENDLINK_ADDON_TESTS_PASSED`; the second printed the sentinel below.

Expected sentinel:

```text
BLENDLINK_BLENDER_52_EXPORTER_CELLS_PASSED exporter=06ad0a3f28605ab8d52aea0703c522488b2821cb9e2d6d91b70673a1c967a66a stock=3 compiled=ae8f231eb6294831e371aad9ec3477a3b18a0971264e5bd7772bd1d18b65c27d alpha=5c8c57460d18c09f56722f95a577f674fb65bc32852fb95b9fb2ccb2c03095ba
```

On Windows, Blendlink compilation also writes its normal publication lease
under the user's local AppData directory. A restricted sandbox therefore needs
the same permission as any ordinary `blendlink compile`.

Evidence files:

- `experiments/blender-52-exporter-cells/output/evidence.json`
- `experiments/blender-52-exporter-cells/output/source-identity.json`
- `experiments/blender-52-exporter-cells/output/generation.json`
- `experiments/blender-52-exporter-cells/output/generated/portableFactors.manifest.json`
- `experiments/blender-52-exporter-cells/output/generated/portableAlphaMask.manifest.json`

[blender-manual]: https://docs.blender.org/manual/en/5.2/addons/scene_gltf2.html
[gltf-spec]: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
[gltf-extensions]: https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md
[three-loader]: https://threejs.org/docs/#examples/en/loaders/GLTFLoader
