# BOX image geometry/normal stage — frozen research

This isolated follow-up reuses the existing SDK `buildGeometryContext` SNORM10/16 implementation and the prior experimental BOX candidate. It changes no production SDK, admission, coverage, or tolerance. **Support credit, installed-scene credit, and full Archviz credit are all zero.** The previous four captures remain unchanged.

The source is the original `archiviz.blend` (SHA256 `9f636b2e1a59b3d181f90caf1b1703658eeadebad57f3c6207737d2fe3ffd85e`). Its Plaster images are packed 1024² PNGs; BOX blend is `0.09966777265071869`. Actual scene settings select SNORM10 normals and render anisotropy `FILTER_2` (2 samples). The viewport preference is recorded separately and is not the render authority.

## Inputs and controls

The CPU fixture extracts actual evaluated `Plane.021` and `Walls` corner normals, local positions, triangle indices, object matrices, and the original shifted perspective camera. Four additional planes exercise signed off-axis normals, nonuniform scale, rotation, and both Blender/glTF coordinate bases. The browser receives these source inputs, never native per-pixel answers. Basis transport preserves raw normal words without pre-normalizing them. The existing SDK geometry/camera validation accepts all six inputs.

The matrix uses Blender 5.3.0 `02f0899d78e3`, Apple M5 Pro Metal, and Chromium 158.0.8127.18 on Metal WebGPU and WebGL2. It preserves every full 64×4 image, including uncovered pixels. There are 78 actual EEVEE renders and 300 browser readbacks (307,200 Float32 words), plus independent target-storage calibration. Both APIs report no page, HTTP, or shader errors. Native source, producer files, geometry inputs, PNGs, SDK distribution, Three source, and every raw result are pinned by the independent reader.

## Measured results

| Stage | Words | Violations | Maximum absolute error |
| --- | ---: | ---: | ---: |
| Geometry mask | 24,576 | 0 | 0 |
| Coordinate input | 12,288 | 0 | 0 |
| Object normal | 24,576 | 53 | 0.3536376953 |
| Weight diagnostic (invalid fixture) | 24,576 | 9,980 | 1 |
| Image sampler | 221,184 | 40,989 | 0.2705193013 |

Masks and input fields require exact equality. The unchanged image-stage bound is `2^-10` (0.0009765625).

Every WebGL2 normal control passes, for both SNORM qualities, including both source owners (maximum error 0.0004874468). Every synthetic WebGPU normal control also passes. WebGPU has 53 component violations at a few pixels on actual source owners, at the same locations for both qualities. A depth/raster surface-selection difference is a hypothesis; it is not proved and no normals were fitted to native answers. For example, at Walls pixel (7,0), native encoded normal is `(0.1463623047, 0.1463623047, 0.5)` while WebGPU returns `(0, 0.5, 0.5)`. Geometry coverage is still exact.

| API / sampler policy | Violations | Maximum absolute error |
| --- | ---: | ---: |
| WebGPU, no mipmaps | 11,894 | 0.2705193013 |
| WebGPU, mipmaps, anisotropy 1 | 7,006 | 0.0668007135 |
| WebGPU, mipmaps, actual scene anisotropy 2 | 2,477 | 0.0668007135 |
| WebGL2, no mipmaps | 11,854 | 0.2539177388 |
| WebGL2, mipmaps, anisotropy 1 | 6,601 | 0.0226897597 |
| WebGL2, mipmaps, actual scene anisotropy 2 | 1,157 | 0.0043332577 |

Matching scene anisotropy sharply reduces sampler error, but even WebGL2 (whose normal controls pass) remains outside the fixed bound. The WebGPU sampler numbers also contain the unresolved source-normal discrepancy. The matrix does not establish full Mapping/NormalMap material or scene equivalence.

**The new weight diagnostic is invalid.** Its native TexImage Vector default is set but unlinked. Native TexImage ignores unlinked defaults and uses implicit UV (`node_shader_tex_image.cc:62–63`). Therefore its 9,980 reported violations do not establish a BOX weight-math failure. This failed producer is deliberately frozen; a future capture must explicitly link a constant RGB/CombineXYZ node. The earlier separate 26-case bit-exact weight result remains distinct evidence.

## Storage and mip analysis (CPU only, after capture)

The packed image candidate already uses `ImageBitmap` → `THREE.Texture`, default `UnsignedByteType`, with sRGB or Non-Color storage. It does **not** decode these PNGs into Float32 image textures; Float32 is used for independent coordinate/weight controls and output readback.

Pinned native `imbuf/intern/util_gpu.cc:71–110` selects `UNORM_8_8_8_8` for non-color byte buffers, `SRGBA_8_8_8_8` for the native scene-linear-sRGB byte classification, or half/full-float formats when an actual float buffer exists. `image_gpu.cc:660–670` requests mipmaps and the applicable image flags. `IMB_acquire_gpu_texture` updates the chain; Metal's `MTLTexture::generate_mipmap` calls `generateMipmapsForTexture` on that storage. The PNG IHDRs are recorded in evidence.json.

Pinned Three source predicts `rgba8unorm` / `rgba8unorm-srgb` on WebGPU and `RGBA8` / `SRGB8_ALPHA8` on WebGL2. WebGPU generates successive mip levels with render-pass `textureSample`; WebGL2 calls `gl.generateMipmap`. This establishes different mip-generation paths, **not** a measured format or gamma mismatch. Actual native ImBuf classification, GPU texture format, and per-level mip words were not captured. Quantization, gamma averaging, derivative/LOD selection, and hardware filtering remain hypotheses. No global image-sampler flag was changed.

## Replaying the frozen evidence

Local immutable artifacts (not checked into Git):

- `/tmp/scenetoweb-box-normal-native-r1` — native source/geometry/raw archive.
- `/tmp/scenetoweb-box-normal-browser-r1` — both APIs, all raw words, independent `closed.json`.
- `/tmp/scenetoweb-box-normal-schema-r1` — earlier CPU-only source extraction and preflight.

From this worktree, with the original artifact dependencies available:

```sh
PATH=/tmp/scenetoweb-apply-tooling:$PATH node experiments/box-image-normal-stage/compare.mjs /tmp/scenetoweb-box-normal-native-r1 /tmp/scenetoweb-box-normal-browser-r1 /tmp/scenetoweb-box-normal-replayed.json
BOX_NORMAL_NATIVE=/tmp/scenetoweb-box-normal-native-r1 BOX_NORMAL_BROWSER=/tmp/scenetoweb-box-normal-browser-r1 PATH=/tmp/scenetoweb-apply-tooling:$PATH node --test experiments/box-image-normal-stage/*.test.mjs
```

The reader validates capture/source/archive/raw hashes before retaining every numeric failure. The tests require byte-identical replay, preserve zero credit and fixed controls, and reject a deliberately modified raw word in a separate temporary copy. Raw paths and producer SDK pins point to this isolated worktree; a relocated checkout needs that captured dependency closure, not replacement results.

## Next bounded dependency

Do not change production sampler policies based on this matrix. First observe actual native image storage and mip words, and compare the existing byte-format candidate at the same levels with explicit LOD controls. Only then choose the smallest demonstrated format/mip change. In the same fresh namespace, fix the constant-link weight control and add independent face/depth controls for the sparse WebGPU discrepancy. After those controls close, qualify the full NormalMap/Mapping material and saved-original Final/public installed flow. No further capture was run after this matrix.
