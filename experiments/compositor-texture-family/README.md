# Modern compositor Gradient and Checker

This family ports Blender **5.3.0 build `02f0899d78e3`, macOS arm64** compositor
nodes. EEVEE's existing material texture implementations are not treated as
compositor proof. The native CPU multi-function evaluator also handles these
single-value programs when the authored compositor device is GPU.

The qualified production slice has separate extraction and runtime validation.
The [compact current-build receipt](evidence.json) records the exact source and
artifact pins; the closed verifier passed all required transactions.

- **Gradient:** explicit linked literal/Value/group vector inputs. LINEAR admits
  exact Float32 normal coordinates or positive zero within +/-65536. QUADRATIC,
  EASING and DIAGONAL additionally require sixteenth-grid coordinates. Color and
  Fac preserve their native output types. RADIAL, SPHERICAL and
  QUADRATIC_SPHERE remain refused pending their distinct precision contracts.
- **Checker:** sixteenth-grid vector literals within +/-16, fixed integer Scale
  0..256, and finite exact Float32 literal/group colors within +/-65536. Fac
  prunes the unused Color input subtrees. Color preserves independent alpha,
  including signed/HDR color and negative/over-one alpha.
- Negative-zero words, subnormal inputs, implicit conversion/provenance
  assertions, unqualified computed/image fields, nonidentity texture mapping,
  animation/drivers, other native versions/builds/platforms and the unlinked
  Uniform Image Coordinates default refuse. Literal zero is not substituted
  for Blender's implicit coordinate field.

Bounds and provenance are rederived from the actual preceding operations;
no caller-supplied range annotation grants admission. Traversal is bounded to
2048 operations, 64 input visits and depth 8. The kernels allocate no image
textures or render targets, perform no per-frame readback, and share their
function layouts. This is structural cost evidence, not an FPS result.

## Reproduce the proof

Use the locked Three.js version, Node 24 and the exact measured native build.
Coordinate builds and GPU use with other native/browser transactions.

```sh
npm run build
node experiments/compositor-texture-family/capture.mjs \
  --blender /absolute/path/to/Blender --device CPU \
  --output artifacts/verification-compositor-texture53/cpu

BLENDLINK_TEXTURE_REFERENCES=artifacts/verification-compositor-texture53/cpu \
BLENDLINK_TEXTURE_BUILT=1 BLENDLINK_BLENDER=/absolute/path/to/Blender \
  node node_modules/vitest/vitest.mjs run experiments/compositor-texture-family/export.test.ts
```

Repeat native capture and Final publication with GPU and its separate `gpu`
directory. Native capture and nested Final export each use fresh Python-cache
prefixes; invocation identities and cache cleanup receipts are retained.

For each source-device directory, run `run.mjs --built` and
`run.mjs --built --final` under both browser adapter profiles:

```sh
BLENDLINK_TEXTURE_REFERENCES=artifacts/verification-compositor-texture53/cpu \
BLENDLINK_TEST_PROFILE=metal BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium \
BLENDLINK_TEST_CHROMIUM_ARGS='[]' \
  node experiments/compositor-texture-family/run.mjs --built

BLENDLINK_TEXTURE_REFERENCES=artifacts/verification-compositor-texture53/cpu \
BLENDLINK_TEST_PROFILE=software \
BLENDLINK_TEST_CHROMIUM_ARGS='["--use-angle=swiftshader","--use-webgpu-adapter=swiftshader"]' \
  node experiments/compositor-texture-family/run.mjs --built --final

node experiments/compositor-texture-family/verify.mjs \
  artifacts/verification-compositor-texture53 \
  experiments/compositor-texture-family/evidence.json
```

Each profile actually runs WebGPU and WebGL2 and rejects fallback/missing
WebGPU. Closed receipts require all 262 native cases and 14 saved Final scenes
per authored device: **524 native graphs, 28 saved Final publications and 2,208
browser case runs**. Primary outputs compare all 565,248 Float32 words exactly.
The Final path loads the actual GLB/source-presentation descriptor and production
post pipeline. Three apply/dispose cycles preserve source material/callback
ownership and restore the exact renderer-owned DFG_LUT identities observed in a
separate no-compositor draw of the same scene. Renderer caches do not count as
port-owned resources. Failed publication pins and seven malformed input shapes
per API transaction refuse without additional allocations.

Raw source programs, pixels, `.blend` files, Final bundles and immutable runtime
snapshots remain in the ignored machine-local artifact directory. The compact
receipt records their hashes; regenerate raw evidence before requalification.

## Boundaries found while porting

[research-counterexamples.json](research-counterexamples.json) retains two
specific blockers with **zero numerical port credit**:

1. Literal provenance and scalar-to-color folding change negative-zero behavior.
   An InputVector -0 used by Fac yields +0 after its native scalar-to-color path,
   while Color retains -0. ScalarValue(-0) through CombineXYZ also retains -0.
   The production admission excludes negative zero rather than hiding this
   distinction behind an epsilon.
2. On the measured Blender process, `ndarray.tolist()` and `image.pixels[:]`
   already flush Float32 subnormals to signed zero when converting them to
   Python doubles. Original NumPy uint32 views and `image.pixels.foreach_get`
   preserve the words. JSON merely serializes the already-changed doubles.
   Shared integer-word/raw-Float32 oracle transport is the enabling fix for
   future field work. The production family proof uses raw `.rgba32f` output,
   not a floating JSON list.

General field precision, default Uniform Image Coordinates and radial/spherical
kernels are separate work items. Spending more time on those boundaries is not
necessary to maintain the admitted literal family.
