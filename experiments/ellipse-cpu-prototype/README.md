# Ellipse CPU row prototype — no production support

This isolated experiment tests the pinned Blender5.3 CPU compositor with
Rotation positive zero. It implements no SDK admission/emission, runtime node,
Final export, browser renderer or GPU-authored reference support. All support,
Final and browser credits remain zero.

A fresh guarded factory Blender process ran87 actual untouched native
`CompositorNodeEllipseMask` cases using CyclesCPU, `_cycles.set_device_override`
CPU and compositorCPU/FULL. No EEVEE render or GPU initialization was requested.
All32,120 decoded RGBAFloat32 words matched the independent host classifier
exactly. Five focused Node tests passed; another218,334 dense host pixels
validated the compact row representation separately from native arithmetic.
The case list includes all four operations,12 zero-Size identities, strict
boundary/adjacent Float32 controls, eight FMA-distinguishing controls, odd/even,
portrait/2x2 extents, negative/offscreen positions, normal minimum values and
32 seeded shapes. This is a pilot corpus, not universal coverage of every
admitted literal/extent or an interchangeable CPU/GPU claim.

## Arithmetic evidence

Pinned source and native binary identities are recorded in
`cpu-pilot-receipt.json`. `native-ellipse-add-focused.txt` is a read-only focused
Mach-O disassembly of the actual templated CPU worker, extracted with
`llvm-objdump --macho --disassemble --dis-symname <recorded-symbol>`.
It shows separately rounded `fmul`, `fmul`, `fadd`, then scalar `fsqrt`, without
FMA contraction. The source's Vec2 dot product accumulates component products,
and length calls sqrt. Eight actual native cases distinguish the unfused
sequence from a contracted alternative. Names/source expressions alone were
not used to infer the native compiler's contraction setting.

The host preserves Float32 texel division, Position subtraction, Y aspect
multiplication, radius division, each product, the sum and sqrt result.
It does not replace length with squared-distance comparison, introduce an
epsilon, round artist inputs to an artificial grid or change native FPU state.
Rotation0's identity matrix operations do not change the nonzero admitted
coordinates; any intermediate zero sign disappears when squared.

Prototype inputs follow Box's bounded literal envelope: Position[-2,2],
Size[0,2], Mask/Value[0,1], each component exactly Float32 and either zero or
magnitude at least2^-16; negative zero is refused. Extents are integers2..8192.
Every nonzero source texel ratio is at least1/8191. The existing Box analysis
bounds nonzero coordinate subtraction at2^-39 and aspect multiplication at
about2^-51. With radii at most1, nonzero normalized components and their squares
remain above Float32's subnormal floor; the minimum square is about2^-102.
At the other extreme, the admitted aspect/radius bounds keep squared lengths
finite. These bounds avoid ambient FTZ becoming a hidden repair step. The
prototype still needs independent production admission and complete native
profile proof before this envelope becomes a support claim.

Native Size is clamped nonnegative; any zero component shares the original
Mask for every operation. The prototype explicitly returns an identity result
with no coordinate/bound allocation. In particular, Multiply is not replaced by
an all-zero outside value in this path. The raw scalar-copy storage/admission
helper is not reimplemented here: production integration must reuse the proven
public reader, with all animation/link/socket/precision checks intact.

## Why row binary search is valid

For a fixed row, rounded normalized X is monotone. Its absolute magnitude is
unimodal, and squaring, adding the fixed nonnegative Y square, sqrt and the
strict comparison preserve the two monotone sides. Rounding plateaus cannot
create a second inside island. The host finds the minimum-|X| pivot, checks it,
then binary-searches each side for inclusive first/last inside pixels. Empty
rows use `[width,-1]`. This is O(W+H log W) work and two signed integers per row;
it never creates a full CPU pixel mask except in the independent test reader.
The native comparison reads original compositor outputs, not a golden-masked
replacement graph or an operator with changed implementation.

The proposed renderer representation is a two-integer nearest/load row texture,
looked up at integer Y and tested against integer X. No floating boundary would
be recomputed by the shader. This texture representation has **not** been built
or tested on either Three API here. Numeric texture format, nearest/load
semantics, physical pixel index, upload/lifetime/disposal and atomic invalid
resize/recovery still need actual browser qualification. Cache on physical
extent plus immutable settings and rebuild/upload only when that key changes.

## Cost observations and remaining proof

One local Node24 host run measured a1920x1080 build at about0.64ms with22,574
membership evaluations, a3840x2160 build at1.21ms with49,452 evaluations, and
8192x8192 at4.93ms with204,932 evaluations. These are single-run microbenchmarks,
not stable performance gates, render/export latency or GPU measurements.
Row storage was8,640 /17,280 /65,536 bytes, respectively. That excludes transient
Float32 axis arrays of4(W+H) bytes and temporary runtime/driver overhead.
An8192-square RGBAFloat32 pixel mask would instead occupy1,073,741,824 bytes;
no such native or host full-size image was allocated in this experiment.

Before production qualification, close source/schema/raw-scalar admission,
actual row texture format and integer comparisons on both APIs, zero-size
resource bypass, cached-setting isolation, source/native-profile refusals,
full physical extent and resize validation, callback/resource disposal, native
output conversions/composition and fresh saved Final. Freeze a broader matrix
and fixture/runtime/vendor/source census before those jobs. No native GPU
reference or source engine equivalence follows from this CPU pilot.

## Reproduce

Use a fresh owned output path, Node24 and the pinned installed Blender:

```sh
node experiments/ellipse-cpu-prototype/capture.mjs artifacts/verification-ellipse-cpu-new
node experiments/ellipse-cpu-prototype/verify.mjs artifacts/verification-ellipse-cpu-new
node --test experiments/ellipse-cpu-prototype/classifier.test.mjs
```

The guarded launcher gives each Python invocation a fresh private cache prefix
and records native identities. Captures retain EXR/raw data, source hashes,
progress and logs under the owned artifact directory. The verifier writes its
comparison receipt before failing a numerical mismatch; failed directories
must remain intact and a new invocation must use a new directory. No failed
numerical capture was replaced by the passing pilot in this checkpoint.
