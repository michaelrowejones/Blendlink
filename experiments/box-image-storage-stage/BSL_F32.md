# Source-specialized paired mip candidate

This additive stage preserves all frozen `09b5310`/`c3d6f1a` numerical files,
native-r3 references and earlier failed captures. The fixed comparison bound is
still `2^-10`; support, installed-scene and full Archviz credit remain zero.

Pinned source distinguishes two operations that the old CPU model conflated:

- `mtl_backend.mm` enables direct sRGB image writes on Apple GPUs.
  `gpu_texture_mipmap.cc` therefore selects the UNORM shader with
  `is_srgb_texture=false`; native typed texture read/write performs sRGB IO.
- That shader still uses `SharedSRGB` between the two generated levels. Its
  source conversion uses Float32 constants and explicit reciprocal/multiply/pow
  expressions, followed by native pack/unpack normalization.

`mip-model-bsl-f32.mjs` adds those source Float32 operations for shared storage
without pretending that `Math.pow` or mathematical transfer functions prove
native GPU behavior. One CPU comparison retains every sRGB failure at LODs
1–10 unchanged while preserving all eleven Non-Color sampled LOD passes. This
is useful negative evidence: changing source expression precision does not
close the remaining hardware-typed stage. No parameter was fitted to outputs.

The separate `gpu-paired-mips.js` candidate uses actual WebGPU sRGB attachment
read/write and source paired/shared operations to generate requested byte mip
chains from independently decoded pinned PNG bytes. Both Three renderer APIs
then receive those explicit mip arrays. Generation identity and byte chains
are archived; independent explicit filtered LOD controls precede interpretation
of the derivative/anisotropic BOX controls. The same retained reader and
backend-declared row-origin adapter remain in use. Invalid positive-LOD native
texelFetch rows stay retained and uncredited.

The first browser capture `box-paired-browser-r1` stopped at WGSL compilation;
the diagnostic initially serialized native compilation messages as `{}`.
Fresh R2 records the precise issue: `shared` is a reserved WGSL identifier.
The candidate renames that function to `shared_sample`, preserves all arithmetic
and gates, and closes its error scope on compilation failure. Both failed
namespaces remain zero numerical credit. R3 passed compilation but its browser context was destroyed during bulk
numeric-array transport. Fresh R4 uses binary PNG-decode fixtures and compact
base64 mip archives, with identical byte inputs and shader math. All failed
namespaces are retained and earn zero numeric credit.

Artifacts and commands:

```sh
node experiments/box-image-storage-stage/model-check-bsl-f32.mjs \
  /tmp/scenetoweb-box-storage-native-r3 /tmp/scenetoweb-box-bsl-f32-model-r1.json
BOX_STORAGE_NATIVE=/tmp/scenetoweb-box-storage-native-r3 \
  node --test experiments/box-image-storage-stage/bsl-f32.test.mjs
# Requires the shared GPU slot, actual Chromium/Metal and a built local SDK:
node experiments/box-image-storage-stage/browser-paired.mjs \
  /tmp/scenetoweb-box-storage-native-r3 /tmp/scenetoweb-box-paired-browser-r4 --gpu-lease
node experiments/box-image-storage-stage/paired-check.mjs \
  /tmp/scenetoweb-box-storage-native-r3 /tmp/scenetoweb-box-paired-browser-r4 \
  /tmp/scenetoweb-box-paired-browser-r4-closed.json /tmp/scenetoweb-v1-box-storage-stage
```

These bounded resource/mip experiments do not establish a production material
route. Actual Mapping/NormalMap material, saved-original Final, public installed
rendering and resource/failure proofs remain required before SDK admission.


## First numeric result: R4

The hardware-typed paired candidate closes every filtered sRGB LOD word exactly
on both actual Metal APIs: 22 rows / 5,632 words, maximum error zero. Its actual
sRGB BOX sampler with the source scene's anisotropy 2 passes all 18,432 words
per API at the fixed 2^-10 bound (maximum error 0.00012198090553283691).
NoMip and ordinary-Mip policies remain separate mismatching negative controls.

The GPU-render-attachment Non-Color chain fails: 252 filtered-LOD component
violations / 5,632 words, maximum error 0.003676474094390869. Its actual
scene-anisotropic normal sampler retains 80 violations per API, maximum error
0.0023839473724365234. Do not admit this aggregate candidate into the SDK.
A CPU comparison against the already measured normalized-store model localizes
byte differences to odd levels only: even levels and level zero are identical;
odd levels differ by at most one byte. This is the typed normalized-store
stage, not an excuse to alter a bound or fit transfer constants.

The complete R4 capture has 348 geometry/sampler rows plus 88 explicit-LOD rows,
no shader/page/HTTP errors, and no unexpected device loss. Its final automatic
close originally refused a relocated native producer path. CPU closure instead
uses the **exact retained 09b5310 producer checkout**, validating its reader and
producer bytes against that commit before invoking the unchanged archive guard.
The guard is not loosened. New browser/source/mip pins are verified independently.
See `paired-evidence-r4.json` for hashes, failures and next scope.


## Source-domain correction: R5 sampler stage passes

A fresh isolated R5 keeps the bit-exact sRGB hardware chain and supplies the
Non-Color chain from the existing CPU Float32/normalized-store model. That model
already passed every native sampled LOD before the GPU comparison. Selection is
by declared source color-space/storage domain, not image name, expected pixels
or fitted parameters. The reader independently reconstructs every uploaded
Non-Color mip byte from the pinned PNG and refuses borrowing R4's different
GPU-UNORM generation report.

Both actual Metal WebGPU/WebGL2 APIs now match all filtered LOD words exactly
for both original images: 44 rows / 11,264 Float32 words, zero difference. All
73,728 actual BOX sampler words under the original scene's anisotropy 2 pass
the unchanged 2^-10 bound. Maximum absolute error is 0.00012198090553283691
for sRGB and 0.00048786401748657227 for Non-Color. All independent geometry,
normal, weight, coordinate, polygon-ID and position controls pass their existing
bounds. NoMip and ordinaryMip negative policies remain mismatched and retained;
no pixel masks or thresholds changed.

The automatic close exits zero with the exact original 09b producer path.
Independent CPU replay is byte-identical. See `paired-evidence-r5.json` and
`/tmp/scenetoweb-box-paired-browser-r5/closed.json`. Two CPU regressions pass:
source Float32 behavior and rejection of R4 proof borrowing. All R1–R4 results
remain unchanged in their original checkout/artifacts.

This is a **sampler-stage pass**, with zero node, installed-scene or full Archviz
support credit. Mapping/NormalMap material composition, saved-original graph
Final/public installation and lifecycle/resource controls are still required.


## R6: standalone WebGL2 typed generation

R5's WebGL2 sampler consumed sRGB mip bytes made by a separate WebGPU device,
so it did not establish WebGL2-only operation. Fresh R6 removes that dependency:
the WebGL2 page has `navigator.gpu` explicitly unavailable before preparation.
A private OffscreenCanvas WebGL2 context generates the sRGB chain with actual
SRGB8_ALPHA8 input/output attachment conversion. A framebuffer encoding query
refuses any attachment that is not sRGB. Non-Color uses the unchanged independent
CPU paired/store model. There is no CPU-sRGB or WebGPU fallback.

The Apache-2.0 paired/shared conversion helper preserves attribution. Its
normalized-byte packing independently derives nearest-even quantization from
IEEE binary32 integer bits, rather than introducing an extra float multiply.
The private context owns its textures, framebuffer, shaders, program and VAO;
cleanup deletes them and intentionally loses only that private context. It never
changes the renderer's GL state. Both APIs report zero device-loss events. The
GL2 generator's single 1024-square sRGB chain takes 137.7 ms on this capture; this
is preparation with synchronous readback, not steady-state rendering/FPS.

Automatic and independent CPU closes are byte-identical, SHA256
`e00df02e1ba5dc742152f04dde419187eaa9dbdd523853562a174ffb40d6d30e`.
The independent additive strict stage gate also passes: all 44 filtered LOD rows
(11,264 words) are bit-exact; all 72 scene-anisotropic BOX rows (73,728 words)
pass the existing 2^-10 bound. All 348 geometry/sampler rows and both negative
policy sets remain present. No new support/material/scene credit is assigned.
See `paired-evidence-r6.json` for immutable paths, pins and model domains.

```sh
PATH=/tmp/scenetoweb-apply-tooling:$PATH node experiments/box-image-storage-stage/paired-check.mjs \
  /tmp/scenetoweb-box-storage-native-r3 /tmp/scenetoweb-box-paired-browser-r6 \
  /tmp/scenetoweb-box-paired-browser-r6-independent-closed.json \
  /tmp/scenetoweb-v1-box-storage-stage
```

A full RGBA8 1024-to-1 chain has 5,592,404 bytes, of which 1,398,100 are added
mip bytes. The experiment temporarily owns eleven GPU textures and readback
bytes per sRGB image; CPU normal mip construction also retains Float32 working
levels. Production must account for decoded images, cache identity, memory,
abort/update/disposal and avoid retaining the experiment's three policy variants.
This does not establish a distributable runtime route. Research BOX blending is
GPL transcription and must not be copied into the MIT SDK; the next material
slice requires an independent mathematical implementation plus actual source
Mapping/NormalMap, saved Final and public installed proofs.
