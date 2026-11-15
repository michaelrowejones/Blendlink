# BOX storage, mip and readback-origin research

This follows frozen `5ce68d9` in a new isolated worktree. Production SDK files, admission rules and the fixed `2^-10` image bound are unchanged. **Support, installed-scene and full Archviz credit remain zero.** No custom mip candidate has been uploaded to a browser or qualified as a node port.

## Actual observations

The original Archviz source SHA256 remains `9f636b2e1a59b3d181f90caf1b1703658eeadebad57f3c6207737d2fe3ffd85e`. Native Blender 5.3.0 `02f0899d78e3` on Apple M5 Pro Metal captures 102 actual EEVEE renders plus 44 direct texture probes. Chromium 158 Metal WebGPU/WebGL2 capture 348 geometry/sampler readbacks plus 88 explicit-LOD readbacks, with no page, HTTP or shader errors. Full 64×4 images and all original failing results are retained.

After actual EEVEE renders initialize native texture resources, public `gpu.texture.from_image` observes:

| Source image | Native image metadata | Actual native GPU format | Actual WebGPU / WebGL2 format |
| --- | --- | --- | --- |
| Plaster-Overlay.png | Non-float, depth24, channels4, sRGB, straight alpha | SRGB8_A8 | rgba8unorm-srgb / SRGB8_ALPHA8 (35907) |
| Plaster-normal.png | Non-float, depth24, channels4, Non-Color, straight alpha | RGBA8 | rgba8unorm / RGBA8 (32856) |

Both expose all eleven queried mip sizes 1024→1. There is no direct public Python observation of the internal ImBuf pointer or buffer classification; the table distinguishes image metadata from actual texture format. The candidate already uses byte ImageBitmap textures. A Float32-versus-byte mismatch is not the demonstrated issue.

Two earlier fresh attempts after the existing direct-Float32 calibration sequence abort at `gpu.texture.from_image`: `SIGABRT`, `__cxa_pure_virtual`, `GPU_shader_bind` → `texture_update_mipmap_chain` → `IMB_acquire_gpu_texture`. Their logs, incomplete transaction archives and exact producer snapshots remain in `/tmp/scenetoweb-box-storage-native-r1` and `-r2`. This is a failure of that cold sequence, not a claim that the API always fails. Moving observations after actual EEVEE rendering succeeds in fresh `-r3`; no failed attempt is credited.

## Correction: image mip generation is compute, not Metal-blit-only

The earlier source-only Metal-blit inference is superseded. Pinned `image_gpu.cc` requests mip-capable image textures; `util_gpu.cc` invokes `GPU_texture_update_mipmap_chain`. Generic `gpu_texture_mipmap.cc` selects its format-specific compute shader when supported and dispatches **two levels together**. Backend `MTLTexture::generate_mipmap` is the fallback when that compute path is unavailable. The observed abort stack enters the generic compute path.

Pinned Apache-2.0 `gpu_shader_update_mipmaps.bsl.hh` contains an important detail: RGBA8 uses `SharedSRGB` for packed intermediate storage even for Non-Color textures. This changes the second output level relative to sequential ordinary UNORM mip reductions. Native source pins, actual image/format observations and raw probes are retained in `evidence.json` and the artifact reports.

`mip-model.mjs` is an **Apache-2.0 experimental CPU model**, based on that Apache-2.0 shader's power-of-two reduction and shared-storage semantics. It is separate from the GPL native capture helpers and prior GPL BOX candidate, and is not copied into the MIT runtime. Its simple PNG decoder reads the pinned RGB8 PNG bytes without Blender answers. It compares ordinary stored-box reduction against paired shared-sRGB reduction with explicit Float32 arithmetic. Mathematical sRGB conversion and normalized-store rounding remain approximations to actual typed GPU storage/filter behavior.

The paired correction closes all 64 sampled filtered coordinates on normal-image even LODs 2,4,6,8,10 within the unchanged bound (maximum error ≤0.00021184; LOD10 exact). Ordinary stored-box reduction fails every one of those levels. **Odd LODs and the sRGB image still fail**, so this establishes a useful partial model correction, not a complete mip implementation or sampler proof.

## Correction: positive-LOD native texelFetch is not a valid mip reference here

Filtered `textureLod` and integer `texelFetch` probes are kept separate. Both image probes at LOD0 match browser output bit-exactly on both APIs. Higher filtered LODs show small differences, typically around one byte; those are the useful mip diagnostics.

The positive-LOD native fetch probe contradicts native filtered sampling: normal-image LOD10 fetch returns approximately `(0.553,0.576,0.992)`, while filtered LOD10 returns `(0.502,0.502,0.980)`. It cannot be used to qualify mip contents. Source `gpu_shader_msl_sampler.msl` implements fetch with `texture->sample(_mtl_fetch_samp, ..., lod)` and a `coord::pixel` sampler, rather than `texture->read(..., lod)`. Independently decoding the PNG and addressing **base-level pixels** with the level-scaled integer coordinates predicts all 22 native fetch rows (5,632 words) within the fixed bound. This observable base-level alias explains why those rows are invalid mip references. The underlying native/Metal limitation is not repaired here.

## Correction: sparse WebGPU normals were row-origin mismatch

The fresh native weight fixture explicitly links CombineXYZ to TexImage Vector, fixing the previous invalid unlinked-default control. It also exports independent per-polygon dyadic IDs and encoded source world positions alongside normal and weight controls. These depend only on authored source inputs.

The unadapted raw reader repeats 53 WebGPU normal-component violations, with 24 weight and 24 face-component violations and larger position differences. Inspecting the independent fields identifies a whole-image Y reversal: row0↔3, row1↔2. Thus the earlier depth/raster surface-selection interpretation is superseded. The [WebGPU specification](https://www.w3.org/TR/webgpu/#coordinate-systems) declares top-left framebuffer origin; [OpenGL ES ReadPixels](https://registry.khronos.org/OpenGL/specs/es/2.0/es_full_spec_2.0.pdf) declares lower-left origin. Pinned Three `WebGPUTextureUtils.copyTextureToBuffer` passes `(x,y)` directly to the API and returns mapped buffer rows without a reversal; its GL path calls `readPixels`. These source/API origins determine the adapter before numerical comparison, rather than selecting whichever transform fits. The full Three source is pinned in the browser report. The independent `orientation-check.mjs` applies **one backend-declared whole-image reversal** to WebGPU readback, leaves WebGL2 unchanged and never derives transforms or values from native pixels.

| Oriented control, both APIs | Words | Violations | Maximum absolute error |
| --- | ---: | ---: | ---: |
| Mask | 24,576 | 0 | 0 |
| Coordinate field | 12,288 | 0 | 0 |
| Normal, both SNORM qualities | 24,576 | 0 | 0.000487447 |
| Explicit-linked weight field | 24,576 | 0 | 0.000416398 |
| Polygon ID (exact gate) | 24,576 | 0 | 0 |
| Source world position | 24,576 | 0 | 0.000487983 |

The oriented actual image samplers still fail: 40,741 component violations across 221,184 words and all three policies/APIs. No pixels are masked out and no bound is widened. This reader is a separate diagnostic; original failed `closed.json` remains immutable. No SDK normal/depth change is warranted from the former row mismatch.

## Evidence replay

Immutable artifacts remain outside Git:

- `/tmp/scenetoweb-box-storage-native-r3`: complete source-preserving native transaction, geometry, PNGs, EXRs, texture observations and all raw words.
- `/tmp/scenetoweb-box-storage-browser-r3`: complete raw browser matrix and original failed numeric close.
- `/tmp/scenetoweb-box-storage-oriented-r1.json`: separate fixed-origin comparison.
- `/tmp/scenetoweb-box-storage-model-r3.json`: CPU model comparison, model hashes and retained failures. Earlier model-r1/r2 attempts are not removed.

```sh
PATH=/tmp/scenetoweb-apply-tooling:$PATH node experiments/box-image-storage-stage/compare.mjs /tmp/scenetoweb-box-storage-native-r3 /tmp/scenetoweb-box-storage-browser-r3 /tmp/scenetoweb-box-storage-replayed.json
PATH=/tmp/scenetoweb-apply-tooling:$PATH node experiments/box-image-storage-stage/orientation-check.mjs /tmp/scenetoweb-box-storage-native-r3 /tmp/scenetoweb-box-storage-browser-r3 /tmp/scenetoweb-box-storage-oriented-replayed.json
PATH=/tmp/scenetoweb-apply-tooling:$PATH node experiments/box-image-storage-stage/model-check.mjs /tmp/scenetoweb-box-storage-native-r3 /tmp/scenetoweb-box-storage-model-replayed.json
BOX_STORAGE_NATIVE=/tmp/scenetoweb-box-storage-native-r3 BOX_STORAGE_BROWSER=/tmp/scenetoweb-box-storage-browser-r3 PATH=/tmp/scenetoweb-apply-tooling:$PATH node --test experiments/box-image-storage-stage/storage.test.mjs
```

Tests validate actual texture format observations, byte-identical original replay, independent oriented fields, and the partial CPU correction while requiring remaining failures and zero credit. Original producer files and dependencies remain pinned; relocating a checkout does not substitute a new closure.

## Next smallest step

Keep the fixed row-origin adapter in any future capture. Replace invalid positive-LOD fetch probes with normalized texel-center `textureLod` or a demonstrated actual-mip image/read view. Close odd-level typed normalized-store/filter rounding and the sRGB transfer/storage stage independently. Then upload a custom paired mip chain in a fresh isolated browser comparison with explicit LOD controls before testing derivative-selected anisotropic BOX sampling. Only after those close should full Mapping/NormalMap material and saved-original Final/public installed proofs proceed. No further GPU job was run after this matrix, and the GPU slot is released.
