# Fixed Get Vector Component

This is a shader-source lowering for Blender **5.3.0**. A fixed Index of 0, 1
or 2 becomes the existing `separate` IR with channel x, y or z. No browser math,
runtime opcode, or old serialized document changes. Unlinked integer sockets,
Function Input Integer literals, reroutes and equivalent group-bound literals
can qualify. Computed/changing selectors, out-of-range indices, animation,
unmeasured versions and unknown socket schemas refuse explicitly.

## Native availability and source contract

| Actual native build | Shader tree/group | Compositor group | Geometry group |
| --- | --- | --- | --- |
| 4.2.0 `a51f293548ad` | absent | absent | absent |
| 5.2.0 LTS `fbe6228777e7` | absent | absent | absent |
| 5.3.0 `02f0899d78e3` | creatable | creatable | creatable |

These creation checks are not numerical qualification. This port does not add
Compositor/Geometry extraction. Stock 4.2/5.2 raise an undefined-node error and
their source fixture records zero numerical cases.

The [5.3 declaration](https://github.com/blender/blender/blob/v5.3.0/source/blender/nodes/function/nodes/node_fn_get_vector_component.cc)
exposes Vector (XYZ vector), Index (integer) and Value (float); there is no
component menu. Its Index UI range is 0..2, but actual RNA stores all signed
32-bit indices unchanged. The [GPU implementation](https://github.com/blender/blender/blob/v5.3.0/source/blender/gpu/shaders/material/gpu_shader_material_get_vector_component.bsl.hh)
and [multi-function registry](https://github.com/blender/blender/blob/v5.3.0/source/blender/functions/intern/multi_function_common.cc)
both read the selected component in range and return zero outside it. The live
slice deliberately refuses out-of-range/dynamic selection rather than silently
inventing clamping or widening its measured contract. Source-file SHA256 values
are recorded in `native-sources.json`.

## Proof roles

`vector_component_check.py` probes all three native versions, exercises every
fixed component, typed literals, group defaults/links, automatic Final planning,
unknown versions, invalid/computed/live indices and animation. It also creates a
ZIP from the built add-on, imports its isolated package and checks the real
packaged emitter/planner. Source nodes, links and data counts are preserved.
This is a packed-source planning proof, not a claim of visitor Final pixels or
user preference installation.

`reference.py` builds **42 actual EEVEE selection graphs**: 18 constant/MF-eligible
and 24 shader-stage UV/object-uniform graphs. Every graph is rendered separately
against a native Separate XYZ control. All pixel words match exactly, including
the paired group's literal transport. Two additional carrier/orientation
controls are recorded separately. Signed/HDR components are encoded into a
positive emission carrier with exactly representable scale/offset, and both
graphs use the same encoding. Blender's half-float scene target is not presented
as an exact Float32 node result. An independently staged Float32 formula from
the native socket values/UV texel centers calibrates every native carrier pixel;
the fixture requires exact half representability and the fixed half-ULP plus
6e-6 bound before any browser runs. Nothing is fitted to browser pixels.

`run.mjs --built` checks those 44 cells on both APIs against immutable whole-
program runtime snapshots. The EEVEE carrier allowance is one native half ULP
plus 6e-6; it is unchanged across cases and adapters. An independent UV control
fixes row orientation once per backend. An additional **42 raw Float32 selection
controls per API** remove the emission encoding and compare every RGB lane to
the independently known native socket/vector or exact UV texel-center value,
with zero tolerance. These raw checks use a direct fragment carrier to bypass
the material's negative-radiance clamp; they are algebraic controls, not extra
native images. Signed-zero bit identity is outside this claim. Replacing each
program leaves the generic harness's single output texture unchanged and adds
zero program-owned textures. Physical and software adapters are reported from
the actual renderer rather than inferred from a launch flag.

## Reproduce

Use isolated `BLENDER_USER_RESOURCES` and official native binaries. First run
the source fixture on all three versions, which emits explicit absence or
qualified source-selection JSON:

```sh
BLENDLINK_VECTOR_COMPONENT_SCHEMA=/absolute/schema.json \
  "$BLENDLINK_BLENDER" --background --factory-startup -t 1 --python-exit-code 1 \
  --python packages/blender-addon/tests/vector_component_check.py
```

Build only the isolated worker and repeat that command on 5.3 with
`BLENDLINK_VECTOR_COMPONENT_PACKAGED_ADDON=$PWD/packages/blendlink/dist/addon`.
For native EEVEE plus both browser APIs:

```sh
BLENDLINK_BLENDER=/absolute/Blender-5.3 \
BLENDLINK_VECTOR_COMPONENT_EVIDENCE=/absolute/software-proof \
  node experiments/vector-component-differential/run.mjs --built

BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium \
BLENDLINK_VECTOR_COMPONENT_REFERENCES=/absolute/software-proof/reference \
BLENDLINK_VECTOR_COMPONENT_EVIDENCE=/absolute/physical-proof \
  node experiments/vector-component-differential/run.mjs --built --reuse-reference
```

The built guard independently checks JavaScript/native source bytes before
creating immutable snapshots. The report retains those snapshots, native
identity/hashes, actual renderer identities, all readbacks' numerical summaries,
raw-control mismatches, browser failures and the effective raw-fragment harness
hash. An absent node is never replaced by a numeric control-only pass.

## Earned checkpoint

The isolated worker's `artifacts/get-vector-component` contains
`qualified-schema-{42,52,53}.json`, `packed-schema53.json`, original native
`source-swift/reference`, and final `built-{swift,physical}-raw/report.json`.
Both physical Metal APIs and software SwiftShader/LLVM APIs passed: **176 native
carrier readbacks** (168 selection, eight independent controls), plus **168 raw
Float32 algebraic controls**, with zero raw mismatches. Native Component versus
Separate pixel mismatches were zero. The largest native carrier difference was
0.00048065185546875, within the independently declared half-target allowance
(largest budget ratio 0.9724258314); it is not described as exact native Float32
output. No browser execution errors/device loss or added program textures were
observed. The worker build, 1,418 unit tests (five skipped), 59 release policies
and isolated copied-add-on source/planning test passed. The original Metal-only
receipt did not claim native OpenGL-source qualification. That qualification is
now earned separately below; actual visitor Final pixel publication remains separate.

## Registration and native canaries

The capability map records only partial shader support and removes only that
shader key from `knownUnsupported`; compositor fixed selection has a separate
qualified gate, while geometry execution remains unsupported.
`validateVectorComponentSource` independently checks actual measured build and
schema, typed literal/reroute/group paths, unknown-version/schema mutations,
converted/computed/live index refusals and copied-add-on planning. Its source
probe always records zero numerical cases. Actual 4.2/5.2 absence is retained
separately and cannot stand in for the 5.3 native graph family.

The central shader gate runs this source probe first, then the built numeric
runner only for qualified 5.3. The lightweight native canary uses the official
checksum-pinned 5.3 Linux archive to earn fresh EEVEE/OpenGL evidence with both
browser APIs, without reference reuse or a watchdog override. Existing 4.2/5.2
jobs also check actual absence. The strict browser-report reader requires all
42 selection graphs, two carrier controls, both APIs, the independent native
carrier calibration, exact raw controls and zero added program textures.

The registration checkpoint passed 63 policy tests, actual source readers for
all three versions and refreshed built software/physical checks. Final reports
are `calibrated-built-{swift,physical}/report.json`; all 44 refreshed native pixel
files are byte-identical to the first reference capture, as retained in
`native-reference-refresh.json`. No new native pixel values or tolerance change
were introduced by the independent calibration. Hosted OpenGL qualification
is now recorded in the reviewed receipt below.

The first Linux 5.3 canary passed all numerical/raw checks, then failed its
backend audit: the factory preference defaulted to Vulkan and the separate
background GPU module was uninitialized. That run is not counted as OpenGL
qualification. Fresh captures record the initialized platform from the actual
native render process; the canary explicitly requests OpenGL and checks that
the recorded backend matches. `BLENDLINK_VECTOR_COMPONENT_NATIVE_BACKEND`
accepts `OPENGL`, `VULKAN` or `METAL`; local Metal replay passes with its actual
renderer/vendor recorded, without changing the numerical budgets.

### Reviewed Linux OpenGL receipt

Checkpoint `9d137e3`, run43411851888/job131839951921 passed with actual
Blender5.3 OpenGL/llvmpipe. The [shared receipt](../vector-component-differential/opengl53-receipt.json)
binds artifact14029991998 and its verified archive digest. Shader proof retains
42 paired selections and two independent native carrier controls (88 browser
carrier reads), plus84 exact raw algebraic controls. Its maximum carrier budget
ratio is0.972426; the independent half-target allowance is not node precision.
The separate compositor CPU/GPU proof contains256 native graphs and512
browser readbacks, maximum error zero. Current-source/ZIP guards and strict
browser readers pass; geometry execution, dynamic selectors, signed-zero
browser parity and actual visitor Final pixel publication remain outside scope.
