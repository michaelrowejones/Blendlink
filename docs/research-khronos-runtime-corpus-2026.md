# Official Khronos post-export runtime corpus, 2026

Research and evidence date: 2026-07-25

## Decision

Add a small official Khronos corpus beside the Blender source-scene corpus.
The two lanes answer different questions:

- Blender scenes test the **compiler** from authored Blender intent to a
  publishable scene.
- Khronos glTF assets begin after export and test the **runtime transport**:
  exact asset closure, glTF structure, Three `GLTFLoader` construction, and
  extension compatibility.

The reusable experiment is
[`experiments/khronos-runtime-corpus`](../experiments/khronos-runtime-corpus).
Its manifest pins 20 official cells, 26 files, and 6,703,746 bytes. The
default command is deliberately offline and refuses missing or changed bytes:

```powershell
node experiments/khronos-runtime-corpus/run.mjs
node experiments/khronos-runtime-corpus/run.mjs --browser
```

Acquisition is a separate explicit operation:

```powershell
node experiments/khronos-runtime-corpus/run.mjs --fetch
```

Every acquired file must match its recorded byte count and SHA-256 before it
is written. Every later offline run rechecks the same facts. The downloaded
cache is ignored by Git; the manifest, runner, license evidence, and generated
evidence contract are reviewable.

This does **not** claim Blender/Eevee parity or Khronos Sample Viewer pixel
parity. The browser gate proves exact-file loading and Three object/material
construction only.

## Designs compared

### A. Commit selected third-party GLB files

Vendoring makes CI offline immediately, but it adds 6.7 MB of third-party
binary history and duplicates upstream license/attribution maintenance. A
fixture update is difficult to review because the source revision and binary
change can drift independently.

### B. Pin a manifest and acquire into a hash-checked cache

The manifest records one immutable upstream revision, every relative path,
byte count, SHA-256, license, attribution, and immutable license-evidence URL.
Acquisition is explicit. The ordinary gate is deterministic and offline.

Choose **B**. The runner is a deep experiment module with one small interface:

```text
run corpus [fetch missing] [load in Chromium] -> evidence report or loud failure
```

Acquisition, content verification, GLB/JSON parsing, capability
classification, browser hosting, GLTFLoader inspection, and evidence writing
stay in the implementation. Corpus entries declare facts and expectations;
they do not each grow a script.

## Pinned primary sources and runtime identities

| Source | Immutable identity |
| --- | --- |
| Official Khronos glTF Sample Assets | revision [`2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf`](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf) |
| glTF specification and ratified extensions | revision [`77b44be7bef26e01fb0b140e3d5bb1716421c5e9`](https://github.com/KhronosGroup/glTF/tree/77b44be7bef26e01fb0b140e3d5bb1716421c5e9) |
| Official Khronos Sample Viewer | revision [`313db85fa5c79f1c64c82ad0082dd0870103b0b1`](https://github.com/KhronosGroup/glTF-Sample-Viewer/tree/313db85fa5c79f1c64c82ad0082dd0870103b0b1) |
| Installed Three runtime | `three@0.184.0` |
| Installed Three loader | `node_modules/three/examples/jsm/loaders/GLTFLoader.js`, 114,959 bytes, SHA-256 `97642d720f16cc9a0c9844934198e4d0c023bea8e89576d0f7545d03b2d103d2` |
| Built Blendlink compatibility module | `packages/blendlink/dist/gltfRuntimeCompatibility.js`, SHA-256 `d4a5374b1fc8f06244205bc2b364293bfc8611ddb783c2dd16bbedaddf78aee4` |

The [Khronos extension mechanics](https://github.com/KhronosGroup/glTF/blob/77b44be7bef26e01fb0b140e3d5bb1716421c5e9/extensions/README.md)
distinguish `extensionsUsed` from `extensionsRequired`. Required extensions
allow an engine to decide whether it can properly load an asset without
walking every extension object. Material extensions usually retain a core PBR
fallback and therefore usually remain optional; compression or new image
formats become required when no core fallback is present.

[`KHR_animation_pointer`](https://github.com/KhronosGroup/glTF/blob/77b44be7bef26e01fb0b140e3d5bb1716421c5e9/extensions/2.0/Khronos/KHR_animation_pointer/README.md)
targets mutable glTF properties through JSON pointers. Its specification
explicitly says an implementation without the extension ignores pointer
channels because they omit the core `target.node`. That is conforming fallback
behavior, but it can still be an unacceptable artistic loss for a compiler
that promised to transport the animation.

The [official Sample Viewer](https://github.com/KhronosGroup/glTF-Sample-Viewer/blob/313db85fa5c79f1c64c82ad0082dd0870103b0b1/README.md)
supports `KHR_animation_pointer`, the material extensions below, variants,
decoder extensions, and additional newer material extensions. It is the
appropriate future visual oracle for these post-export cells; a Blender
render is not.

## Exact corpus

The full per-file record lives in
[`corpus.json`](../experiments/khronos-runtime-corpus/corpus.json). Each asset's
license link is revision-pinned. Hashes below identify the entry document; the
multi-file texture-transform cell additionally verifies its six companions.

| Cell | Entry bytes | Entry SHA-256 | License | Runtime fact |
| --- | ---: | --- | --- | --- |
| SimpleSkin | 3,566 | `7d0c3f48d0510d101269cb4fdd3ee035eaada0e04809a0899e0b4cfe8c38e68f` | CC0-1.0 | skin, joints/weights, bone animation |
| SimpleMorph | 3,000 | `0ff029b843d95d3f162a67c84e2d04c7fc76218e53a0cc8c85ca2323d5f82758` | CC0-1.0 | two morph targets, animated weights |
| InterpolationTest | 7,952 | `a86eb331b4a083715e75fe19a1f747eac5692d5b9ff120f1eaa457c23ba72bca` | CC0-1.0 | STEP, LINEAR, CUBICSPLINE |
| NegativeScaleTest | 62,568 | `ea8c41fd0630f03adcf7a5c06bf86d7b850fa510b6f07cc51eb1fccc205a50f2` | CC-BY-4.0 | negative node transforms |
| NormalTangentMirrorTest | 1,567,084 | `31ce5f3c873fc55531a17ccacf001e3d1d482a508695aa826fa79cc196e0ce78` | CC-BY-4.0 | supplied tangents and mirrored normal mapping |
| TextureCoordinateTest | 14,232 | `fe75a63a0423c9a682bf46c3045b6328ae9c55abefc9a50adf3ec1d6dc6ea3b9` | CC0-1.0 | core UV orientation |
| TextureTransformTest | 9,179 | `c22c8c6c96c0ea4bcbb9b47ea245a093c5ef59acc5fd425effa4c00da4cdf164` | CC0-1.0 | multi-file closure and `KHR_texture_transform` |
| CompareAnisotropy | 1,085,084 | `5b4d9c7e99f85054983697112bab468c344b8984feb7299702ea6c93ddab292e` | CC0-1.0 | `KHR_materials_anisotropy` |
| ClearCoatTest | 258,048 | `c3a1cbe318cd043b937130af4eb83ec2ea0b03613387b1b7d769dfab4ac15948` | CC-BY-4.0 | `KHR_materials_clearcoat` |
| CompareDispersion | 60,432 | `1c3eff819615d7e6d06e605f728907006eb6c36ef2ead53cc328e65d38a215c4` | CC0-1.0 | `KHR_materials_dispersion` |
| CompareEmissiveStrength | 111,796 | `e40d8e1d98345ae16211814bab097307c8710f1ae4f9399fe14e01049f3e7bd8` | CC0-1.0 | `KHR_materials_emissive_strength` |
| CompareIor | 213,104 | `3588b4b522d2a756809b337353c017a412b9e38793b60355fdc6eb162b360019` | CC0-1.0 | `KHR_materials_ior` |
| CompareIridescence | 214,756 | `abda6e8bcb13ad04534c90bc4ce9b21e80f2d8b74ac4d911800269f0009ff073` | CC0-1.0 | `KHR_materials_iridescence` |
| CompareSheen | 883,968 | `70b6ab5ba8006aa71079b567783a81cfe778a11cca8abc44c45e5e0b1f4252cc` | CC0-1.0 | `KHR_materials_sheen` |
| CompareSpecular | 1,408,364 | `57ea169e0b9b4a4ea1cb27980226974d0da25897445c9f29c3c817698dd923d8` | CC0-1.0 | `KHR_materials_specular` |
| CompareTransmission | 357,024 | `012a3ace61050f4aef77b416c56b3f8f313e1fa68c9040ce3d5037f67eea484f` | CC0-1.0 | `KHR_materials_transmission` |
| CompareVolume | 399,760 | `cb88f5dd70c1c2700e2a28caa5b612f4b6e8c34183d6261c681727d8bafdf7d2` | CC0-1.0 | `KHR_materials_volume` |
| UnlitTest | 3,992 | `e07b68c6fd9fbf73d372c610a681b89d6b013bdd1a506e46a411df82210a2481` | CC-BY-4.0 | required `KHR_materials_unlit` |
| CubeVisibility | 3,284 | `a4a2863c99bf6f2f008558c995ad176979f920bd235190970fb02e1142faac41` | CC0-1.0 | required unsupported `KHR_node_visibility` plus pointer animation |
| AnimatedColorsCube | 15,184 | `995bb9db5bd011b64bc9fc2235c60e5455e2931e509db5e715b4d20afc5ba71e` | CC0-1.0 | optional pointer color animation plus core transform fallback |

This covers all eleven Khronos material extensions constructed by the
installed core Three r184 loader, plus `KHR_texture_transform`.
`EXT_materials_bump` is also implemented by this Three revision, but the pinned
official Sample Assets revision has no corresponding model. It remains an
explicit corpus gap rather than a fabricated parity claim.

`KHR_materials_variants` and `KHR_animation_pointer` are documented by the
installed `GLTFLoader` as external-plugin paths, not built-in support.

## Verified evidence

The offline structural command passed:

```text
BLENDLINK_KHRONOS_RUNTIME_CORPUS_PASSED assets=20 files=26 bytes=6703746 browser=no
```

The real browser command then passed with Chrome
`150.0.7871.182`, the exact installed Three loader, and the exact built
Blendlink production compatibility module:

```text
BLENDLINK_KHRONOS_RUNTIME_CORPUS_PASSED assets=20 files=26 bytes=6703746 browser=yes
```

Positive evidence includes:

- one Three `SkinnedMesh` and one loaded bone-animation track;
- one morph mesh and one loaded morph-weight track;
- nine animation tracks spanning Discrete, Linear, and glTF CubicSpline
  interpolants;
- six loaded objects with a negative world determinant;
- one tangent-bearing geometry and the expected UV-bearing geometries;
- six non-identity texture transforms in the multi-file cell;
- `MeshPhysicalMaterial` construction for anisotropy, clearcoat, dispersion,
  IOR, iridescence, sheen, specular, transmission, and volume;
- `MeshStandardMaterial` with emissive intensity `1` and `3`;
- `MeshBasicMaterial` for required unlit; and
- no page errors, console errors, or failed requests.

Before any raw `GLTFLoader` bypass, the production profile also refused:

- `CubeVisibility` with both
  `runtime.required-extension-unsupported` and
  `runtime.animation-pointer-unsupported`; and
- `AnimatedColorsCube` with
  `runtime.animation-pointer-unsupported` while its explicit raw-Three probe
  retained only the two core tracks.

After each raw load, the same browser run also classified the concrete
`gltf.parser` through `loadedThreeRuntimeProfile()`. All twenty loaded-parser
decisions matched the static gate. For the pointer cells, injecting a named
but no-op `KHR_animation_pointer` parser plugin still produced
`runtime.animation-pointer-unsupported`, proving registration is not treated
as semantic support.

The exact generated evidence is SHA-256
`297f9928e972c05630de07eef1d13d5de795ecd173583bd5b1bdcd4549e11df4`.
The runner is SHA-256
`6b4844cfd65186b431b5400f9f04f69f44af8c57520a172cdf1ef0c9eb8f3fb7`
and the browser harness is SHA-256
`e8cf4ccbe77a7d3bb965c4ec32075988a0f44cfdd2867f6415d86e4fd171a0de`.

This is structural/runtime evidence, not a material-pixel comparison. In
particular, constructing `MeshPhysicalMaterial` proves that the extension
plugin ran; it does not prove the Sample Viewer and Three shade identically.

## The unsupported-extension result

The pinned Three r184 implementation does not fail an unknown required
extension. In `GLTFLoader.parse`, it emits:

```text
THREE.GLTFLoader: Unknown extension "KHR_node_visibility".
```

and continues. The official `CubeVisibility` asset therefore loads five
meshes, but its sole pointer animation becomes a zero-track `AnimationClip`.
The visible result is optimistic but semantically incomplete.

`AnimatedColorsCube` is a different and important case. It does not put
`KHR_animation_pointer` in `extensionsRequired`, which is valid because its
transform channels remain a core fallback. Raw Three loads the geometry and
two core tracks while silently dropping the third, material-color pointer
track. A generic `extensionsRequired` allowlist alone cannot detect that
authored loss.

The package-owned production classifier therefore keeps two loud results
separate:

1. reject every required extension absent from the concrete runtime capability
   profile; and
2. reject unsupported pointer channels when Blendlink claims to transport that
   authored behavior, even when Khronos allows a partial core fallback.

This is the same distinction Blendlink already makes at Blender compile time:
standard Three cannot bind material/light/camera property animation, so the
compiler blocks it rather than calling a partial GLB successful.

## Needle comparison

`npm.cmd run verify:needle-baseline` passed on 2026-07-25:

```text
BLENDLINK_NEEDLE_BASELINE_VERIFIED 130 files, 9 source version identities
(2026-07-25) integration=mixed-source named=splash-official-preview:coherent
```

The coherent Preview cell's Needle Engine `5.1.4` implementation at
`experiments/needle-splash-official-preview/node_modules/@needle-tools/engine/lib/engine/extensions/extensions.js`
is 5,263 bytes with SHA-256
`e00c4909eaea01cb2d21d45b7bb022ed2f1c87060ce736d74c023ee78f072e1c`.
It dynamically imports and registers
`@needle-tools/three-animation-pointer@1.1.2`. The plugin implementation at
`experiments/needle-splash-official-preview/node_modules/@needle-tools/three-animation-pointer/src/GLTFLoaderAnimationPointer.js`
has SHA-256
`9b6ed41c2bee905a0b1f2d48a7fd80b9408ad6ee17918467b366eaa904030617`.

Needle therefore has a real pointer-import path. Blendlink's early compile-time
refusal is safer than raw core Three's silent partial result, but it does not
match Needle's ability to transport the property animation. That is a
production **Gap**, not parity.

## Production seam: implemented decision

Blendlink did not paste an experiment-local allowlist into every loader call.

### Design A: static final-artifact allowlist

A JSON list beside final verification is easy to ship, but it conflates three
different facts:

- an extension class exists in Three source;
- the configured loader has its required decoder/plugin; and
- Blendlink promises the extension's visible behavior.

For example, Draco, Meshopt, and Basis support depends on configured adapters,
while `KHR_animation_pointer` can be added by an application-owned loader.
One static list would become a shallow module and drift from the concrete
loading path.

### Design B: one compatibility classifier with a concrete capability profile

Put a deep classifier at the final-GLB/runtime-loader seam:

```text
classify artifact(document evidence, runtime capability profile)
  -> compatible | loud issues
```

The profile belongs to the concrete loader adapter and records built-in
handlers, configured decoders, and semantics Blendlink actually promises.
Unknown registered plugin names are not capabilities. The classifier owns
required-extension checks and loss-sensitive channel checks. Compiler verification, Preview, Final publish,
and browser smoke consume the same result. An application-owned loader may
declare additional capabilities, but the optional browser gate must validate
them; a declaration alone is not evidence.

Blendlink chose and shipped **B** in
`packages/blendlink/src/gltfRuntimeCompatibility.ts`. Exact final/typegen
bytes use the pinned r184 compiled profile; already-loaded Three scenes derive
a non-mutating profile from exact r184 built-ins and configured KTX2/Meshopt
decoders before detached preparation or commit. An application capability is
added only when an explicit semantic declaration and a concrete parser
registration agree. The manifest schema was not reshaped.

The corpus runner and Vite/Chrome harness now import that exact built module.
This removes the prior experiment/production classifier duplication and makes
the browser cell capable of failing when production profile bytes or behavior
drift. Application-declared loaded-parser capabilities now have an explicit
interface; they never widen the compile profile and require application-owned
browser evidence. Package-owned pointer playback remains Future and is never
inferred from a loader promise or plugin name.

## Capability status

Stable audited record:

| ID | Capability | Relation | Implementation | Evidence |
| --- | --- | --- | --- | --- |
| `NDL-RUN-003` | Exact official post-export runtime corpus and loud artifact/runtime compatibility classification | corpus itself **No analogue**; pointer transport **Gap** versus Needle; early refusal **Improvement** over raw core Three | classifier, exact-byte compile/typegen adapters, loaded-parser adapter, and corpus integration **Shipped**; pointer playback **Future** | `npm run build` then `node experiments/khronos-runtime-corpus/run.mjs --browser`, passed 2026-07-25 on Three `0.184.0`, Chrome `150.0.7871.182`; the real loaded-parser adapter matched every static decision and a browser-injected no-op pointer plugin name remained refused. Production classifier SHA-256 `d4a5374b1fc8f06244205bc2b364293bfc8611ddb783c2dd16bbedaddf78aee4`; evidence SHA-256 `297f9928e972c05630de07eef1d13d5de795ecd173583bd5b1bdcd4549e11df4`; runner `6b4844cfd65186b431b5400f9f04f69f44af8c57520a172cdf1ef0c9eb8f3fb7`; browser harness `e8cf4ccbe77a7d3bb965c4ec32075988a0f44cfdd2867f6415d86e4fd171a0de` |

## Explicit limits and next cells

- No Blender source file is opened; this cannot validate Blender exporter
  behavior.
- No scene is rendered against a Sample Viewer reference image.
- No physical GPU, WebGPU, Firefox, WebKit, or mobile browser is covered.
- `EXT_materials_bump` lacks an official pinned cell.
- Variants, diffuse transmission, animation pointer, and node visibility need
  intentional product decisions rather than optimistic fallback.
- Basis/KTX2, Meshopt, Draco, external-file failure, base path/CDN, CSP,
  workers, CORS, and context loss belong to the decoder/deployment matrix.
- A future material visual lane should use the exact same assets and compare
  fixed camera/environment/tone-mapping pixels with the pinned official
  Khronos Sample Viewer. It must not infer material parity from a successful
  `GLTFLoader` promise.
