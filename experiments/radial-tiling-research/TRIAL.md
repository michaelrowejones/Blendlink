# Private unrounded shader kernel trial

This continues native research `aa2ee522`. All code remains under this
experiment. There is **no public opcode/emitter, SDK runtime change, support
promotion, Final/Preview installation proof or Cycles/MF admission**.
`trial-receipt.json` pins the actual evidence and records exclusions separately.

## Native and browser scope

`trial_reference.py` retains the independently calibrated signed digit carrier
from the native viability study. It authors actual EEVEE52/53 shader materials,
integer Sides3..12, Roundness0, both Normalize states, and real full-float opaque
Non-Color nearest data images. Each version has160 scalar output planes:
100 shader-field planes and60 separate literal/MF controls. The64² input field
contains1025 independently authored grid, origin, signed-zero and adjacent-F32
polar boundary points, repeated to fill the texture. It does not contain native
kernel output pixels. All source graphs/images survive actual save/reload with
unchanged fingerprints. Source profiles remain measured Darwin arm64/M5 Metal,
builds `fbe6228777e7`/`02f0899d78e3`; OpenGL source is not qualified.

`trial-kernel.js` implements only the upstream Apache-2.0 **unrounded integer**
GPU branch, retaining its source operation order and separate ID formula.
Native MF/Cycles optimized paths are not substituted. Two candidate variants
are retained:

- `intrinsic-v1`: source-shaped browser cos/tan. Actual software APIs fail8192
  qualified scalar samples, maximum `0.0005335807800292969`, under the original
  Sides3/5 corpus. Raw failed planes and immutable source snapshot remain at
  `artifacts/radial/trial-intrinsic-software-v3`; no larger tolerance is applied.
- `portable-trig-v1`: the existing independently proved portable sin/cos helper;
  tangent is sin/cos within this bounded unrounded branch. No coefficients were
  fitted to Radial outputs and the native target/carrier budget is unchanged.

The candidate predicate was fixed before browser results: finite actual input
components within magnitude2, radius≥`2^-10`, distance from every sector divider
≥`2^-10` radians, no negative-zero component, integer Sides3..12. This is a
private trial domain, not a production source certificate. The portable variant
passes **1280 output-plane comparisons /2245440 qualified scalar samples**:

| Actual destination profile | Maximum qualified error | Candidate failures |
| --- | ---: | ---: |
| SwiftShader WebGPU+WebGL2, both native versions | `1.6391277313232422e-6` | 0 |
| Physical Metal WebGPU+WebGL2, both native versions | `1.0132789611816406e-6` | 0 |

The raw numerical allowance stays `2e-5 + 16/2^29`; ID requires exact equality.
There is no general scene-half or raster allowance. Raw Float32 source-field
transport/orientation is independently checked exactly. Native origin/coarse
carrier failures are excluded by their preserved masks;480 literal/MF
control-plane comparisons are **not** included in candidate admission. Literal MF controls retain
real signed-zero branch failures, and physical WebGPU also produces non-finite
origin controls. These are not numerical passes or support for the default/MF
node. Full raw planes, native expected planes, masks and shader sources remain
available. The receipt counts all excluded/failing control samples explicitly.

Both browser profiles require an actual WebGPU adapter/device, reject renderer
fallback, assert actual/requested API equality, and assert two distinct APIs
per native version. Software must report SwiftShader; physical runs must report
Apple/Metal and reject SwiftShader. Immutable snapshots, all four Three build
modules, helper, harness/domain source pins, native fixture/index/source.blend
pins and actual generated fragment shader bytes are checked. `watch:null` and
`hmr:false` prevent source replacement during a run.

## Observed cost

Final cost captures ran in a coordinated window with no team test/render
processes active. They measure **wall-clock completion**, not GPU timestamps,
idle-desktop certification, a PBR scene or visitor FPS: ten submitted1920×1080
RGBA32F draws plus a one-pixel completion readback, repeated three times.
Input and Radial points are independently authored, finite, exact-half data.
Baseline and cold/first completion figures are retained. Warmed pipeline/cache
state changes the observed cost, so do not turn these into a universal budget.

| Actual destination | Input median ms | Coordinates median ms | Normalized coordinates median ms |
| --- | ---: | ---: | ---: |
| Physical Metal WebGPU | .28 | .48 | .13 |
| Physical Metal WebGL2 | 1.66 | 1.67 | 1.66 |
| SwiftShader WebGPU | 2.54 | 5.89 | 6.33 |
| SwiftShader WebGL2 | 3.33 | 5.01 | 5.00 |

These generated shader variants are approximately7KB, versus1KB for the input
baseline. Physical WebGL2 completed-batch figures are visibly quantized; the
source/points/method and individual samples are in the receipt. No architecture,
IR admission or material slot is justified by timing alone.

## Proposed first production slice and pending gate

The next **unearned** source/sampler gate is actual EEVEE52/53 direct nearest
data-image input with literal texel-center sampler coordinates (including1×1
images). Current field evidence uses spatial UV sampling; it must not silently
grant the literal-coordinate source/packing contract.

If that gate passes, the first slice can be independently proved at export and
runtime without any assumed spatial UV or owner bound:

1. EEVEE shader stage only. Direct ImageTexture Color→Radial Vector, native
   measured source version/backend/profile, explicit new versioned selector.
   The image guarantees shader stage even when its sampler coordinates are
   literal. Source MF/default/unlinked vectors and Cycles stay refused.
2. Literal RNA/direct Value Sides3..12, literal Roundness exactly0, both Normalize
   states. No Python-double folding of linked arithmetic, animated knobs or
   unproved groups/coordinate arithmetic.
3. Static packed Float data, Non-Color plus `is_data`, Straight opaque alpha1,
   Half Precision off, Closest/FLAT/EXTEND, default identity texture mapping.
   Power-of-two width/height≤32; exact literal sampler coordinates at an actual
   texel center. Exclude implicit UV/Generated, CLIP, external texture refs,
   color-managed/animated images, filtering/mipmaps and unproved mapping.
4. Independently inspect actual selected Float32 RG using the same fixed
   radius/magnitude/sector/negative-zero predicate. Validate actual finite/opaque
   RGBA payload, ≤4096 values/image, total≤12288 inspected values,64 nodes/depth8.
   Re-prove actual data each install; caches may refer only to owned immutable
   attempt snapshots, not caller array identity. A mutated-array reapply must
   refuse before texture allocation and keep the last healthy installation.
5. ID/Width/Rotation remain **float** outputs. Coordinates is vec3(x,y,0) for
   vector/color consumers initially; defer unproved implicit vector→scalar
   coercion. Normalize grants no full-vector unit range. Source and runtime
   independently reject unsupported model/version/shape/storage tags.
6. Register Radial as engine-sensitive; do not silently substitute Cycles for an
   EEVEE fallback. Preserve all old documents/operators. A new unknown opcode
   must fail on older runtimes instead of ignoring precision metadata.

Before production promotion, use the generic fresh renderer-requirement
contract being developed separately: actual validated shipped programs across
**all** material channels, including Roughness with portable BaseColor; no
marker-only exemption and no legacy WebGLRenderer silent skip. WebGPURenderer's
WebGL2 backend is an earned destination. Require actual Final+Preview flow,
sidecar/program pins, repeat/retry/cancel/disposal and mutation/reapply proof.
This trial supplies none of those installation claims yet.

## Repeat

Run under Node24 with the locked dependencies. Native generation does not build
SDK dist or touch the main workspace. For suffix52/53:

```sh
BLENDLINK_RADIAL_OUTPUT=artifacts/radial/trial-reference53 "$BLENDLINK_RESEARCH_BLENDER" --factory-startup -b --python-exit-code 1 --python experiments/radial-tiling-research/trial_reference.py
```

The runner **reuses** those native references; it never generates or replaces
them. For software, then physical Metal with the bundled full Chromium channel:

```sh
BLENDLINK_TEST_PROFILE=software BLENDLINK_RADIAL_TRIAL_NATIVE=artifacts/radial/trial-reference52,artifacts/radial/trial-reference53 BLENDLINK_RADIAL_TRIAL_EVIDENCE=artifacts/radial/trial-final-portable-software npm exec --yes --package=node@24 -- node experiments/radial-tiling-research/trial-run.mjs --variant portable-trig-v1
BLENDLINK_TEST_PROFILE=metal BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium BLENDLINK_RADIAL_TRIAL_NATIVE=artifacts/radial/trial-reference52,artifacts/radial/trial-reference53 BLENDLINK_RADIAL_TRIAL_EVIDENCE=artifacts/radial/trial-final-portable-metal npm exec --yes --package=node@24 -- node experiments/radial-tiling-research/trial-run.mjs --variant portable-trig-v1
```

Add `--cost-only` and use distinct `cost-final-portable-{profile}` evidence paths
for cost capture in a coordinated timing window; it emits a cost marker, no empty
numerical pass. Domain/API adversarial checks and receipt audit:

```sh
npm exec --yes --package=node@24 -- node --test experiments/radial-tiling-research/trial-domain.test.mjs
npm exec --yes --package=node@24 -- node experiments/radial-tiling-research/trial-audit.mjs
```
