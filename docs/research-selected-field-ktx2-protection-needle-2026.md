# Exact selected-field images under scene texture compression

Date: 2026-07-25
Capability: `NDL-MAT-011`
Decision: **Match / scoped Improvement / Shipped** for automatic exclusion of
an exactly attested compiler carrier from scene-wide KTX2 compression.

## Question

Blendlink's selected-field compiler can emit an ordinary PNG or JPEG
base-color texture and attest its exact bytes, MIME type, dimensions, sampler,
UV field, material response, and primitive ownership. Scene-wide KTX2
compression previously ran before final scene diagnostics and considered that
same material-bound texture an ordinary compression candidate.

Those contracts cannot both succeed: `KHR_texture_basisu` uses an
`image/ktx2` image and changes the encoded bytes. Khronos describes ETC1S and
UASTC as universal compressed formats whose runtime representation is
transcoded for the target GPU:

- [Khronos `KHR_texture_basisu`](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_basisu/README.md)
- [KTX-Software reference](https://github.khronos.org/KTX-Software/libktx/index.html)

The exact selected-field attestation must not be weakened into a decoded-image
similarity claim. Its purpose is to prove that no later optimizer silently
changed the artist-selected intrinsic field.

## Exact Needle baseline

The inspected local production pipeline is:

| Package | Version | Normalized source path | SHA-256 |
| --- | --- | --- | --- |
| `@needle-tools/gltf-build-pipeline` | 3.0.0 | `experiments/needle-coherent-addon-1.4.2/node_modules/@needle-tools/gltf-build-pipeline/package.json` | `c5d25e13d4d17e3a8d7fa2695ca404a824d85fae36eb16a90ad5cd7cc3c0077e` |
| `@needle-tools/gltf-build-pipeline` | 3.0.0 | `experiments/needle-coherent-addon-1.4.2/node_modules/@needle-tools/gltf-build-pipeline/dist/cli/index.js` | `73afd7b8fdacf74717577e22bfb899ce080ca00bcc4ccdcf6dbfaad52bb144d1` |

`npm.cmd run verify:needle-baseline` passed against the broader recorded
inventory on 2026-07-25.

The bundled Needle CLI has an explicit per-texture exclusion:

- `processTexture()` reads `NEEDLE_compression_texture`;
- `mode === "none"` logs that the texture was configured to skip compression
  and returns before WebP/KTX2 processing;
- otherwise it may resize, choose WebP for some small/lightmap textures, or
  choose ETC1S/UASTC KTX2 from slot/use-case heuristics.

This is a source-audited behavior, not a completed production differential.
The authenticated Needle 3.0.0 transform and a browser run of its output remain
Pending in the baseline record.

Needle 1.4.2 has no audited selected-socket compiler or exact selected-field
image attestation. Therefore there is no direct Needle analogue for deriving
the exclusion from such proof. Blendlink matches Needle's explicit
do-not-compress behavior and improves the scoped workflow by deriving it
automatically from compiler-owned evidence rather than asking the artist to
configure the generated texture.

## Reproduction

A focused 4x4 PNG fixture is deliberately eligible for Blendlink's ETC1S
path. It is bound to an unlit generated stock-glTF material and carries valid
selected-field material evidence.

Before the fix, scene-wide KTX2 ignored the new evidence option and produced:

- input PNG: 94 bytes, `image/png`;
- output ETC1S KTX2: 486 bytes, `image/ktx2`;
- measured level-zero PSNR: about `41.85 dB`.

That is acceptable lossy compression for an ordinary color map, but it is a
deterministic violation of the exact byte/MIME attestation. The red test
expected the original GLB and failed with the full KTX rate-distortion report.

## Designs compared

### A. Accept KTX2 when decoded pixels are close

This would make scene compression convenient by changing exact attestation
into a visual-quality threshold. Rejected: it silently weakens an existing
compiler proof and conflates an artist-selected intrinsic field with an
ordinary optimizable delivery texture.

### B. Protect an image by texture name or content hash

This is small, but glTF texture names can be empty or duplicated. A content
hash would conservatively protect unrelated duplicate Texture objects that
happen to contain the same bytes. Either approach protects a guess rather than
the exact emitted binding. Rejected.

### C. Re-attest, then protect the bound Texture object

The KTX module already owns one decoded glTF-Transform `Document`. It now:

1. receives the existing `MaterialCompilationEvidence`;
2. runs the existing complete `verifyMaterialCompilationEvidence()` against
   that pre-compression document;
3. resolves each image transport through its uniquely attested generated
   material and base-color binding;
4. stores the exact glTF-Transform `Texture` object identity;
5. excludes only those objects from scene-wide KTX2 and emits an
   artist-readable warning; and
6. leaves the existing final post-transform attestation unchanged.

This is selected. It adds no manifest field, no Blender marker, no name
convention, and no schema reshape. If an earlier resize already changed the
image, the pre-compression verifier refuses loudly rather than protecting
untrusted bytes.

## Implemented behavior

- `sync.ts` passes exporter-owned material compilation evidence into the
  package-owned KTX compiler.
- `sceneDiagnostics.ts` exposes one verified resolution seam returning exact
  image-carrier Texture objects.
- `textureCompression.ts` excludes those object identities before decoder or
  KTX tool discovery.
- The warning explains that scene-wide GPU compression intentionally retained
  the original MIME and bytes for the compiler-owned carrier.
- Final type generation still performs its independent post-optimization
  material attestation.

No public manifest shape changed. Ordinary material textures continue through
the existing ETC1S/UASTC policy and rate-distortion gates.

## Evidence

Verified on 2026-07-25:

- `npm.cmd test --workspace blendlink -- src/textureCompression.test.ts -t
  "exactly attested selected-field"`: the focused red/green regression passes;
  the GLB and embedded PNG remain byte-for-byte unchanged and a deliberately
  unusable explicit encoder path is never consulted.
- With
  `BLENDLINK_KTX_PATH=C:\Program Files\KTX-Software\bin\ktx.exe`,
  `npm.cmd test --workspace blendlink -- src/textureCompression.test.ts`
  passes all 11 tests against KTX-Software `v4.3.2~6`, including ordinary
  ETC1S/UASTC conversion, fidelity/mip validation, baked-atlas protection, and
  the selected-field exclusion.
- `npm.cmd test --workspace blendlink -- src/sceneDiagnostics.test.ts` passes
  17/17.
- `npm.cmd run build --workspace blendlink` passes TypeScript compilation and
  asset copying.

## Honest boundary

`NDL-MAT-011` is Shipped and unit/toolchain verified. It does not claim a
Needle production browser differential, JPEG-specific fixture coverage,
deployed KTX2 decoder behavior, or visual equivalence between the protected
PNG and an alternate compressed representation.

The automatic exclusion currently belongs to scene-wide KTX2. An explicit
per-texture resize that targets an exact carrier is still refused by the
unchanged attestation rather than silently ignored. Any future lossy texture
stage must cross the same verified object-identity seam or remain a loud gap.
