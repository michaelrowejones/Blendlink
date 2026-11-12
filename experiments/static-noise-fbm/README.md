# Static 4D FBM Color candidate

This CPU literal fold targets the retained Linux SwiftShader Subzero loss at
`cycles-fbm-raw-4d-color-constant-4` and
`blender_eevee-fbm-normalized-4d-color-constant-4`. It is not a claim that local
Mac LLVM SwiftShader reproduces or certifies that hosted driver.

The runtime executes a bounded, read-only scalar/vector IR subset independently
of TSL. Eligible inputs use ordinary finite Float32 literals, Combine/Separate,
Vector Scale, selected scalar Math and Vector Math operations. It does not trust
`constant`/`static` tags, sample textures, read GPU pixels, or substitute measured
reference colors. Unknown operations, dynamic coordinates, uniforms, nested
Noise, cycles, excessive trees, subnormal/non-Float32 literals, ambiguous
multiply-add products, and inexact division remain on the existing GPU path.

Only `noise_fractal` and `noise_normalized`, 4D, Color, static FBM, Distortion
absent/zero, and no live Roughness qualify. The existing Detail<=6, Roughness<=1,
|Lacunarity|<=2 and |Scale|<=80 bounds remain. Normalized profiles are restricted
to `native-standard-f32`, `mf-periodic-f32`, and `eevee-metal-periodic-f32`.
`cycles-neon-fma` and the legacy `noise` opcode remain unchanged.

The pure scalar Perlin kernel ports Cycles/OSL's BSD-licensed Jenkins hash,
sixteen 4D gradients, Float32 fade and quad interpolation. The Apache-licensed
native FBM recurrence explicitly rounds frequency, amplitude, accumulated sum,
normalization endpoints and fractional-detail interpolation. Every color seed
and every octave coordinate, including the fractional extra octave and even
zero-amplitude octaves, must remain finite with |coordinate|<90,000. Thus the
qualified MF/Metal periodic reducers are the proven identity; this fold does
not emulate their large-coordinate arithmetic. Failing any qualification
returns the original GPU graph rather than an approximate literal.

Primary kernels are the official Blender packages' `kernel/svm/noise.h`,
`util/hash.h`, and `kernel/svm/fractal_noise.h`; the existing runtime ports remain
untouched. The CPU result is emitted as a TSL RGB literal, so the problematic
material no longer contains the 4D hash/octave shader body.

The native fixture retains its independent constant render-precision and image
orientation controls, D±1 cases which deliberately stay on the GPU, and an
amplified residual. Generate each native 4.2/5.2/5.3 raw/normalized corpus:

```sh
BLENDLINK_BLENDER=/absolute/path/to/blender \
BLENDLINK_NOISE_STATIC_4D_ONLY=1 \
BLENDLINK_NOISE_EVIDENCE=/absolute/canonical/evidence/raw \
node experiments/noise-fractal-differential/run.mjs

BLENDLINK_BLENDER=/absolute/path/to/blender \
BLENDLINK_NOISE_NORMALIZED=1 BLENDLINK_NOISE_STATIC_4D_ONLY=1 \
BLENDLINK_NOISE_EVIDENCE=/absolute/canonical/evidence/normalized \
node experiments/noise-fractal-differential/run.mjs
```

Use Node24; omit `BLENDLINK_NOISE_STATIC_4D_ONLY` for the complete unchanged-path
regression. After building, `--reuse-reference --built` checks every emitted
production module against its source and repeats the exact retained native
pixels. The isolated immutable snapshot prevents later workspace edits from
changing the module under test. On macOS, use the canonical `/private/tmp` path
for evidence in a temporary worktree, rather than its `/tmp` symlink alias.

The investigative `analyze.mts` compares the pure CPU result against unchanged
native constant-oracle files without involving a browser. It is not the browser
acceptance gate and does not produce production literals from those references.

Initial measured local proof: both retained raw failing IDs pass WebGPU/WebGL2;
Cycles mapped maximum is `2.9802322387695312e-8`. The normalized failing ID also
passes both. Existing EEVEE half-target allowances and the `2e-5` arithmetic
budget are unchanged. On measured Mac LLVM SwiftShader, the raw material's total
program bytes decrease from 22,606/21,136 to 2,256/2,648 (WebGPU/WebGL2), and its
first render/readback takes 5–33ms. These timings are device-specific. Hosted
Linux Subzero completion is required before declaring the crash resolved.

Fresh native 4.2/5.2/5.3 constant corpora pass both browser APIs: 27 raw graphs
per version and 21/28/28 normalized graphs respectively, 316 readbacks total.
The current candidate also passes the focused retained-ID replays in built
mode, 1,212 unit tests (5 skipped), and its isolated package build.

The complete retained Linux 5.2 raw334 + normalized175 corpora pass both actual
physical Metal browser APIs (1,018 readbacks). Comparing those same native
IR/expected-file bytes against a clean 9904 baseline proves all 966 non-folded
readbacks / 15,826,944 Float32 words remain bit-identical. The 52 eligible
literal-fold readbacks stay within their unchanged native budgets. The
`compare-unchanged.mts` helper verifies input hashes and independently rejects
unexpected eligibility of native dynamic cases before doing that comparison.

The two retained serialized legacy `noise` programs (4D Fac and distorted 4D
Color) also remain bit-identical on physical Metal and LLVM SwiftShader, both
APIs: 131,072 Float32 words, including sign bits. `compare-legacy.mjs` snapshots
both the baseline source and guarded built candidate, records actual adapters,
uses an independent literal calibration, and refuses flat/failed legacy fields.
These are runtime compatibility controls, separate from native oracle parity.

```sh
node --experimental-strip-types experiments/static-noise-fbm/compare-unchanged.mts \
  /absolute/baseline-report /absolute/candidate-report /absolute/comparison
node experiments/static-noise-fbm/compare-legacy.mjs \
  /absolute/clean-9904-worktree /absolute/legacy-comparison
```

Actual hosted Subzero certification remains pending; it is not inferred from
these local numeric, shader-size, or unchanged-path controls.
