# TrapX zero-configuration audit: exact Needle source baseline

Date: 2026-07-25
Status: source-audit evidence; no TrapX Needle export or visual differential was run

## Executive conclusion

The inspected Needle Blender path does **not** compile an arbitrary Blender
shader graph. Needle Blender add-on 1.4.2 delegates material conversion to the
stock Blender glTF exporter, then adds Needle extensions for components,
lightmaps, progressive delivery, and per-image compression settings.

For the TrapX scene, this means:

- a linked Principled BSDF subset and ordinary image textures can export;
- an explicit Fresnel node, Glass BSDF, Transparent BSDF, Add Shader, general
  Mix Shader composition, Voronoi, and the complete painterly node group are
  not represented as that authored graph;
- the stock exporter recursively finds a linked Principled node and exports
  supported Principled inputs, but does not materialize or preserve the
  surrounding shader algebra;
- the narrow unlit detector recognizes only particular color/emission and
  Transparent-BSDF arrangements; it is not a general Transparent/Mix compiler;
- Needle's MaterialX runtime can load a pre-existing
  `NEEDLE_materials_mtlx` extension, but the inspected Blender add-on has no
  MaterialX or custom-shader exporter and therefore does not turn this TrapX
  Blender graph into MaterialX;
- Needle lightmapping is an explicit, object-marked Cycles `COMBINED` bake,
  not an automatic fallback for unsupported materials;
- packed PNG/JPEG bytes are supported by Blender's exporter on its compatible
  no-channel-repack path, but a later Needle production transform normally
  changes eligible texture bytes and MIME unless the artist explicitly sets
  the per-image compression override to `NONE`.

Therefore, Needle is a useful baseline for stock glTF PBR, packed-image
delivery, alpha/transmission extensions, opt-in lightmaps, and production
compression. It is **not** evidence that this Cycles painterly graph reaches
web visual parity automatically. A Blendlink result that detects the graph
loss loudly would already improve failure truthfulness; visual parity would
require a separately validated materialization/appearance strategy.

## Evidence boundary and exact identities

`npm.cmd run verify:needle-baseline` passed before this audit:

```text
BLENDLINK_NEEDLE_BASELINE_VERIFIED 130 files, 9 source version identities
(2026-07-25) integration=mixed-source named=splash-official-preview:coherent
```

The broad Needle inventory is intentionally mixed-source. The named coherent
cell covers the official uncompressed Preview host, not an authenticated
production transform. All production-compression findings below are source
inspection, not an end-to-end production claim.

### Needle Blender add-on

Root:
`C:/Users/micha/Documents/GitHub/MichaelRoweJonesSite/.cache/needle-spike/addon/Needle Engine Exporter for Blender`

Acquisition archive:
`C:/Users/micha/Documents/GitHub/MichaelRoweJonesSite/.cache/needle-spike/needle-blender-plugin-1.4.2.zip`,
SHA-256
`d947ab298f6c6e47591321ba462c8b21ada2229bc640262cad9998564a0e745a`.

| Normalized source path | SHA-256 | Relevant behavior |
|---|---|---|
| `__init__.py` | `980226a628182e9e0b1d443c0e294f799162c76e06c5f599dacc20c614a8c96e` | Declares add-on version 1.4.2 and registers the stock glTF export hooks. |
| `blender_export.py` | `6272997cfb4f1d740ea33a7c2512983b9993dedf93c9c8240ca0ff7f82925d77` | Calls `bpy.ops.export_scene.gltf` with GLB, cameras, lights, `COMPAT` light conversion, and image format `AUTO`; it supplies no custom material-graph compiler. |
| `extensions/NEEDLE_texture_compression.py` | `5aa7da6fd633e01609039b06f2830a5dd39dcd44e86622f18bd4809bfe286b51` | Writes an optional `NEEDLE_compression_texture` extension from artist-enabled per-image settings, including `none`, `webp`, `ETC1S`, and `UASTC`. |
| `image_types.py` | `f6bf5a3682fadf6dceb668362798c3049325944368886c3fdb9df8841b931c5c` | Defines the artist-facing compression override; override is disabled by default. |
| `settings_scene.py` | `6e02da2ab32558fb042f0000c863bc6631176458ceb06534d9afcd5061dfd063` | `compressOnSave` defaults to false. |
| `utils_web_project.py` | `a59ca4ffbf965460cc6eda0574066ef8c6631bab100506f80308787599e64437` | When enabled, runs the pinned glTF build pipeline over the assets directory. |
| `lightmapping/lightmapping.py` | `4e69f0934d9329b2d8480b097baa1d903aa31bed9337c7a2ae0630cbc900b4f1` | Selects explicitly lightmapped objects, switches the bake transaction to Cycles, and invokes `bpy.ops.object.bake(type='COMBINED', ...)`. |
| `lightmapping/lightmapping_common.py` | `9108d701addb1f1c4f13f05fc1df64b37c653e861623d2db69738f6363fa112a` | Owns Needle's Cycles bake settings and restoration. |
| `extensions/NEEDLE_lightmaps.py` | `3831dd545261fdd4fa5e5fca9ad98ae7912a0939ea2758bb737b74eae4376a77` | Exports the baked lightmap and its Needle extension. |
| `extensions/NEEDLE_components_postprocess.py` | `90cdd4fbd883858816d36ea1605e75fd820c4bcac2e8d8c87e76a465eb1ce031` | Adds generic tone mapping and, for Cycles scenes, default bloom/AO components; it does not translate Cycles materials. |

The three files not yet enumerated individually in
`docs/needle-baseline.json` (`NEEDLE_texture_compression.py`,
`image_types.py`, and `utils_web_project.py`) were hashed both from the
verified extraction and directly from their entries in the verified 1.4.2
archive; the bytes match.

### Blender and the stock glTF exporter actually used here

Blender is 5.2.0 LTS, build hash `fbe6228777e7`, and its bundled official glTF
exporter reports version 5.2.39. This exporter is outside the current
machine-readable Needle inventory, so it is pinned separately for this audit.

Root:
`C:/Program Files/Blender Foundation/Blender 5.2/5.2/scripts/addons_core/io_scene_gltf2`

| Normalized source path | SHA-256 |
|---|---|
| `__init__.py` | `0cd8903bd1a72ef1edbd728bee70d24a3ecc93c9901db68927b00910bb38be70` |
| `blender/exp/material/search_node_tree.py` | `0c037d078db37da3b6d65054206a9f55d19fa5f8ca6542f5add614230c39f7e9` |
| `blender/exp/material/materials.py` | `f0678496e6762566727fc9c76264c7d7665b2f22dee4671b63cfefe968ed5c31` |
| `blender/exp/material/pbr_metallic_roughness.py` | `1ecdd7caa392d58234c444a428e2c4d8d6d4b673ca9cf5630ff50c6a94a04d56` |
| `blender/exp/material/unlit.py` | `71a8dc2fdcb0b05ec4f4c52c15607b45f08b69f1553fdf6abfaf891815fe5aa4` |
| `blender/exp/material/extensions/transmission.py` | `0d3957e2d82a42337455b13a96700ab830dc1f3b6c09e706fc42a3026bfd2554` |
| `blender/exp/material/image.py` | `13e4bf9777c902882c477d511f5eff7e764bbda0249bcfaca901c1462366e358` |
| `blender/exp/material/encode_image.py` | `1f59e5a2a3116c21afab6c2baf49f9ea1b4c9d663b268d69ec5123d2bf011de1` |

### Needle build pipeline and runtime

Build-pipeline root:
`C:/Users/micha/Documents/GitHub/MichaelRoweJonesSite/.cache/needle-spike/pipeline-3.0.0/package`

- `package.json`, version 3.0.0, SHA-256
  `c5d25e13d4d17e3a8d7fa2695ca404a824d85fae36eb16a90ad5cd7cc3c0077e`.
- `dist/cli/index.js`, SHA-256
  `73afd7b8fdacf74717577e22bfb899ce080ca00bcc4ccdcf6dbfaad52bb144d1`.

Named coherent Preview root:
`C:/Users/micha/Documents/GitHub/blendlink/experiments/needle-splash-official-preview`

- `@needle-tools/engine` 5.1.4 `package.json`, SHA-256
  `522f0a5aa64c22fe76a5d7c6fd0f039fce396eb841324512862c0d704bcacb38`.
- Engine-nested `@needle-tools/three` 0.169.19 `package.json`, SHA-256
  `17bdbf08346fcbab12c79ca75847a0e90f26be57a0faac241a4a3564faa9e463`.
- Engine-nested
  `@needle-tools/three/examples/jsm/loaders/GLTFLoader.js`, SHA-256
  `4aba05147b1ccb01f581979ea44950b60a568e74a5db811df9f5573a2b3521b1`.
- `@needle-tools/engine/src/engine/extensions/NEEDLE_materialx.ts`,
  SHA-256
  `bb8f82a1372a877aafb261138f74a3e8bca541c530396d3856912844e5b58896`.
- `@needle-tools/engine/src/engine/shaders/shaderData.ts`, SHA-256
  `b07508f3d2642e74f6bfe4b6744a31f66dc068d532dedf73ef95805ce7ad6027`.
- `@needle-tools/engine/src/engine/engine_shaders.ts`, SHA-256
  `f76b58121a529f53260ab34e50e7c359c4a4b4a765bd7b4bbc9fa607b826d219`.
- `@needle-tools/engine/src/engine/extensions/NEEDLE_techniques_webgl.ts`,
  SHA-256
  `9369bcc3ef5283042e5dcd8c35b06257d54e853b4b0390f65860f38d2aed3b76`.
- `@needle-tools/materialx` 1.7.1 `package.json`, SHA-256
  `350b1511e8abc756154ea39b17471a56b2079b4396b1ca845f31c3dd184dcfdb`.
- `@needle-tools/materialx/src/loader/loader.three.js`, SHA-256
  `79e815bf0ba139aac5f5df5eb71cf14c330900dc5315d7341ab155c9120d55c3`.

## TrapX facts that exercise these paths

The read-only source inventory is
`output/source-inventory.json`, SHA-256
`c52072af9a422e31b030e12bbecda96ad3394c5b2f9cb9dca4b3ffe584ead78`.
It inventories source SHA-256
`d32731c7983e59546893bcc7fd4ef5c14532b0b2e782f63fa7ef9ed4faafb6ae`
with factory startup and auto-execution disabled; the source was not saved.

Relevant inventory facts:

- the authored scene render engine is Cycles;
- it contains 47 images, 45 of them packed;
- the active `Showcase` material is bound to `Icosphere` and routes its
  surface through the `Stylized Painterly Shader - TrapX` group;
- that group contains one Principled BSDF, one Fresnel, one Glass BSDF, two
  Transparent BSDFs, two Add Shaders, two Mix Shaders, one Emission, two
  Voronoi nodes, and two Image Texture nodes;
- a separate read-only Blender query confirmed both group image nodes use
  packed images and the group output is driven by an Add Shader;
- two external CamFx images have no local bytes and report size `0 x 0`;
- no `NEEDLE_*`/Needle lightmap object property appears in the inventory.

No image bytes, shader source, `.blend`, or rendered copyrighted asset is
included in this audit.

## Behavior findings

### 1. Needle delegates Blender material conversion

`blender_export.py:377-416` builds the GLB export arguments and calls
`bpy.ops.export_scene.gltf`. It requests `export_image_format = "AUTO"` but
does not select a Needle material compiler or material bake. The stock
exporter's default `export_materials = "EXPORT"` therefore governs material
translation.

This is a strong architecture fact, not a visual result: for this exact add-on
version, any claimed support for a Blender shader node must exist in the
bundled Blender glTF exporter or in a registered Needle export extension.

### 2. Principled is extracted; the surrounding painterly algebra is not

The stock exporter recursively walks node groups and asks whether a candidate
node connects to an active Material Output
(`search_node_tree.py:163-181`, `:772-810`, and `:956-997`). For ordinary
material properties, `get_socket()` selects inputs from linked Principled BSDF
nodes. `materials.py:96-212` then emits glTF metal/rough PBR plus supported
extensions.

Consequences for TrapX:

- the linked Principled node is discoverable even though an Add Shader drives
  the group output;
- Fresnel, Glass BSDF, Transparent BSDF, Add Shader, Mix Shader, and Voronoi
  do not become equivalent glTF graph operations;
- the exporter may carry a recursively discovered Image Texture from a
  supported Principled socket, but it does not evaluate the intervening
  painterly closure into pixels;
- the source contains no general warning path identifying this semantic graph
  loss. The material exporter warnings found in this source concern malformed
  or unreadable images and narrow texture-transform cases, not arbitrary
  unsupported shader composition.

The unlit detector (`unlit.py:13-103`) is deliberately narrow. It recognizes
a color-style shadeless path plus two special Mix Shader patterns: a
Transparent-BSDF alpha wrapper and the camera-ray emission trick. It does not
make all Transparent/Mix networks portable.

### 3. Fresnel and glass require a distinction

glTF PBR and `KHR_materials_transmission` include physically based Fresnel
behavior in their BRDF/BTDF. That does **not** mean a Blender Fresnel node
driving an arbitrary Mix/Add network is exported.

The Blender exporter obtains transmission only from the linked Principled
`Transmission Weight` socket
(`extensions/transmission.py:14-83`). It does not translate
`ShaderNodeBsdfGlass`. If the Principled transmission input is exported,
Needle's Three loader maps `KHR_materials_transmission` to
`MeshPhysicalMaterial.transmission` and `transmissionMap`
(`GLTFLoader.js:1071-1125`). That is a valid stock-glTF thin-transmission path,
not a faithful Glass-BSDF or authored Fresnel-network compiler.

The Khronos extension also explicitly separates optical transmission from
alpha-as-coverage and leaves difficult transparent ordering to the renderer.
See the official
[`KHR_materials_transmission` specification](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_transmission).

### 4. Alpha comes from exportable material sockets, not `HASHED` alone

In the bundled 5.2 exporter, alpha mode is derived by tracing Principled Alpha
or the narrow recognized unlit-alpha pattern
(`search_node_tree.py:509-584`). A constant one becomes opaque, a recognized
clip becomes `MASK`, and other represented alpha becomes `BLEND`.

Needle's Three loader then maps `BLEND` to `transparent = true` and
`depthWrite = false`, and `MASK` to `alphaTest`
(`GLTFLoader.js:3608-3625`).

The TrapX inventory's `HASHED`/`DITHERED` material setting alone is therefore
not proof that its Transparent-BSDF shader composition will export. Optical
transmission, alpha coverage, and Cycles Transparent BSDF composition are
three different contracts.

### 5. Packed images work on a constrained happy path

Needle requests Blender image format `AUTO`. The stock exporter detects JPEG,
WebP, or PNG-compatible output and, when no channel repack is required,
`encode_image.py:189-230` and `:372-414` read `image.packed_file.data` and
return the original bytes when the magic number matches the selected MIME.
When channels must be assembled or formats differ, it creates a new image and
re-encodes it.

Thus the 45 packed images are not inherently a Needle blocker. The blockers
are whether a packed image is reached from an exportable glTF material socket
and whether channel composition or later production compression changes it.

The two zero-size external CamFx images are a separate dependency problem:
`image.py:416-430` warns that a zero-size image cannot be exported and removes
that fill. Needle does not reconstruct missing source bytes.

### 6. A Cycles source scene is not automatically materialized

The ordinary Needle export path does not branch on `scene.render.engine` for
material conversion. The exact installed add-on uses the same stock glTF
material extraction for Eevee and Cycles source scenes.

`NEEDLE_components_postprocess.py:381-458` does inspect the renderer:
for Cycles it emits generic default bloom and screen-space AO components, and
it maps the scene color transform/exposure. That behavior can approximate
presentation defaults but cannot preserve Cycles shader or compositor
semantics.

### 7. Needle lightmapping is explicit, not a zero-config material fallback

`lightmapping.py:158-169` reads `NEEDLE_isLightmapped`. During a bake it
collects marked receivers, switches to Cycles if needed, and performs a
`COMBINED` bake (`:258-346`, `:423-449`). The inspected TrapX inventory has no
Needle participation property, so this route would require artist action.

Even when invoked, this is Needle's lightmap workflow and custom runtime
delivery. No inspected code automatically detects an unsupported painterly
material and replaces that material with a baked stock-glTF appearance.

### 8. Production compression is broad, with explicit opt-out

The add-on writes `NEEDLE_compression_texture` only when the per-image
override is enabled. `mode = "none"` is the exact opt-out.

Pipeline 3.0.0:

- skips texture processing when that extension says `none`
  (`dist/cli/index.js:3402-3407`);
- otherwise transforms PNG/JPEG/WebP through WebP or KTX2 according to
  texture slots, dimensions, use case, and explicit settings
  (`:3400-3475`);
- uses ETC1S by default, with higher-quality slot-specific decisions and UASTC
  support (`:3100-3134`);
- treats lightmaps and very small textures as WebP in the default path;
- changes texture bytes/MIME when processing succeeds.

This source behavior is clear, but the repository's current baseline correctly
marks the authenticated production integration pending. It must not be called
a verified TrapX production result.

### 9. ShaderData/custom GLSL and MaterialX are runtime inputs, not this Blender export path

Needle's `ShaderData` schema describes arrays of shader programs, vertex or
fragment shader records, techniques, attributes, and uniforms
(`shaderData.ts:4-64`). `engine_shaders.ts:100-230` resolves inline or
URI-addressed GLSL for those records. The `NEEDLE_techniques_webgl` loader
plugin consumes a matching glTF root/material extension, constructs a
`CustomShader`, binds uniform/texture values, and recognizes a string
`alphaMode = "BLEND"` as Three transparency with depth writing disabled
(`NEEDLE_techniques_webgl.ts:335-611`).

That is a real Needle custom-shader runtime, but it is not a Blender node
compiler:

- `ShaderData` contains compiled shader programs/techniques, not Blender
  `Glass BSDF`, `Transparent BSDF`, Fresnel, or Mix/Add node semantics;
- the runtime alpha handling is metadata on an already-produced custom shader;
  it does not infer alpha or transmission from Blender nodes;
- the custom-shader loader has no stock `KHR_materials_transmission` mapping;
  that mapping remains the separate Three `GLTFLoader`/Principled path;
- the build pipeline preserves `NEEDLE_techniques_webgl` as opaque extension
  data, but the exact Blender add-on has no producer for that extension;
- a complete search of add-on 1.4.2 found no `ShaderData`,
  `NEEDLE_techniques_webgl`, or custom-shader export path.

Engine 5.1.4 registers a loader for an existing
`NEEDLE_materials_mtlx` extension. The build pipeline preserves that extension
as opaque data. A complete search of the exact Blender add-on 1.4.2 source
found no `materialx`, `mtlx`, or `NEEDLE_materials_mtlx` producer.

Therefore MaterialX does not rescue this scene automatically. It would require
a separate exporter/compiler that is absent from the inspected Blender
integration.

## Proposed capability relations for the parent audit

These are relation proposals, not shared-ledger updates. Their implementation
and differential evidence remain for the parent workstream.

| Proposed capability | Relation to inspected Needle | Proposed state/evidence |
|---|---|---|
| Stock Principled/glTF PBR and compatible packed-image delivery | **Match** | Require a tiny packed PNG/JPEG + Principled export fixture and browser render. |
| Principled Alpha and `KHR_materials_transmission` | **Match** | Require separate alpha-coverage and optical-transmission fixtures; do not use a Glass BSDF fixture as proof. |
| Loud detection of linked but unrepresented Fresnel/Glass/Transparent/Add/Mix/procedural closure | **Improvement** | Needle source has no general graph-loss diagnostic. A deterministic red fixture can validate Blendlink refusal without claiming visual parity. |
| Automatic full painterly/Cycles material parity | **Gap** until proved | Needle has no analogue. A material/appearance bake or another compiler needs an Eevee/Cycles reference differential and must preserve view dependence truthfully. |
| Static, validated materialization of an eligible closure | **Improvement** if differential passes | No Needle Blender analogue was found. Keep unsupported view/light-dependent closures red rather than broadening optimistically. |
| Exact source-byte carrier protected from later texture compression | **Improvement** | Needle supports artist-authored `NONE`; automatic protection derived from compiler attestation is a Blendlink product-boundary improvement if final re-attestation passes. |
| Opt-in lightmap bake and runtime delivery | **Match / Boundary** | Compare the actual lightmap workflow separately; it is not evidence for arbitrary material compilation. |
| ShaderData/custom GLSL or MaterialX consumption | **No analogue in Needle Blender export** | Both Needle runtime inputs exist, but the inspected Blender add-on produces neither. Adding either compiler to Blendlink would be a new product decision, not matching this Blender path. |
| Missing external image reporting | **Match**, potentially **Improvement** in presentation | Blender emits a warning for zero-size images. Blendlink should retain an artist-readable, named dependency error and block parity claims. |

## Evidence limits

- No Needle GLB was generated from the TrapX source and no Needle browser
  screenshot was captured. This avoids emitting copyrighted asset output and
  means visual claims remain pending.
- The scene inventory is a read-only diagnostic, not proof of exporter output.
- Source inspection proves which conversion paths exist, but only focused
  differential fixtures can prove their behavior on Blender-generated bytes.
- The exact stock Blender exporter is current local Blender 5.2.0 / glTF
  exporter 5.2.39. Needle 1.4.2 also supports other Blender versions, whose
  bundled exporter behavior may differ.
- The named coherent Needle Preview cell is uncompressed. Pipeline 3.0.0 was
  inspected but not run as an authenticated coherent production cell.
- Negative findings apply only to the exact add-on/archive and versions above;
  they are not claims about future Needle releases.

## Primary references

- Exact local sources and hashes listed above.
- [Blender 5.2 glTF add-on manual supplied for this audit](https://docs.blender.org/manual/en/5.2/addons/scene_gltf2.html).
- [Official Khronos glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html).
- [Official Khronos `KHR_materials_transmission` extension](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_transmission).
- [Official Khronos Blender glTF exporter repository](https://github.com/KhronosGroup/glTF-Blender-IO).
