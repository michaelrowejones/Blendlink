# Qualified large-coordinate EEVEE Math Modulo

This is a new, narrowly admitted `math_modulo_native` opcode. Old `math` and
Noise opcodes retain their published behavior. An older SDK refuses the new
opcode instead of ignoring precision metadata attached to an old operation.

The first profile covers positive literal divisor 100000 and finite same-sign
Float32 input bounds wholly within `2^24 <= abs(a) < 2^31`. Exact constants and
one bounded live path are admitted: SeparateXYZ of a nearest FULL float image
plus a literal vector offset. The image must be opaque, flat, UV-addressed,
embedded, and have at most 16,384 pixels. Bounds are independently recomputed from
actual image payload/literals by Python and TypeScript; a claimed interval does
not authorize integer conversion. Other divisors, unknown input shapes and
ordinary small Math domains retain the old opcode. A witnessed large input
outside the qualified band/backend takes a named source-baking refusal.

Two actual native stages require different formulas:

| Input | Native 4.2 Metal constant/shader | Native 5.2/5.3 MF constant | Native 5.2/5.3 Metal image shader |
| --- | ---: | ---: | ---: |
| 1074099968 | 99968 | 99968 | 99968 |
| 1074100096 | 96 | 96 | 96 |
| 1638499968 | -32 | 99968 | -32 |

The modern MF path is exact C `fmodf`; in the qualified integer band this is a
signed integer remainder. The observed Metal shader path uses
`trunc(f32(a*f32(1/100000)))` for its quotient, then a fused remainder. Every
qualified Float32 input is an exact int32. Its quotient product is at most
2,147,400,000, and the difference fits int32, so exact integer subtraction
reproduces the fused result without an approximate floating-point FMA helper.
The reciprocal product has an explicit observable Float32 bit boundary before
integer conversion. `integer-controls.mjs` proves the identity independently
at 1,078,270 endpoint/quotient-boundary/random inputs; it does not replace native
stage evidence. Primary source context is Blender's
[`math_functions.cc`](https://github.com/blender/blender/blob/02f0899d78e3/source/blender/nodes/intern/math_functions.cc)
(Math operation/shader/MF registration) and the packaged Cycles
`source/util/math_base.h` safe `fmodf` implementation. Metal compiler staging is
qualified by actual native shader canaries, not inferred from the C++ registry.

Two real counterexamples remain explicit exclusions:

* Modern MF negative exact-zero remainder: native `MODULO(-1e9,100000)` followed
  by `ATAN2(result,-1)` produces `.1072998046875` after `.125*x+.5` encoding.
  WebGPU renders `.5`, while WebGL2 matches. Both fresh source and runtime refuse
  this new MF case. Generic Math and old serialized scenes are not changed.
* Native 4.2 Metal FULL-float image controls containing large values saturate at
  a value observed as 65520 even with `image.use_half_precision=False`. The
  first legacy image profile therefore requires every payload component to be
  exactly half-representable and within finite half range. This is independent
  of the source image's nominal storage tag. Modern5.2/5.3 full-float fields
  match. No global image-sampler fix or unknown OpenGL model is claimed here.

Native generator refusals retain the actual authored graph, image payload and
native pixels with hashes. None are silently dropped or treated as passing
numeric comparisons. Alpha is1 throughout the admitted image subset; general
association/filtering/unknown-coordinate behavior is outside this proof.

## Reproduce

Set `BLENDER` to the verified native executable for each version; tested builds
are 4.2`a51f293548ad`, 5.2`fbe6228777e7`, 5.3`02f0899d78e3` on macOS arm64 Metal.
Use an absolute canonical evidence path (`/private/tmp`, rather than its `/tmp`
symlink, on macOS). From the repository root:

```sh
npm exec --yes --package=node@24 -- npm run build --workspace blendlink
BLENDLINK_MATH_MODULO_NATIVE=1 BLENDLINK_NOISE_ENGINE=EEVEE \
BLENDLINK_BLENDER="$BLENDER" BLENDLINK_NOISE_EVIDENCE="$EVIDENCE" \
npm exec --yes --package=node@24 -- node experiments/noise-fractal-differential/run.mjs --built
```

The existing runner stages immutable production/native module bytes, records
hashes and whole-program built/source conformance, and strictly tests both
WebGPU and WebGL2. Repeat with `BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium` to
exercise the installed full Chromium profile; inspect the recorded adapter to
confirm it is physical Apple Metal rather than SwiftShader. `--reuse-reference`
replays byte-identical existing native references. Do not relabel the native
GPU backend to claim a different platform proof.

```sh
"$BLENDER" --background --factory-startup --python-exit-code 1 -t 1 \
  --python packages/blender-addon/tests/math_modulo_native_admission_check.py
npm exec --yes --package=node@24 -- node experiments/math-modulo-native/integer-controls.mjs "$EVIDENCE"
```

The historical `BLENDLINK_MATH_MODULO_PROBE=1` generator mode includes diagnostic
quotient/zero/domain canaries and is not a passing parity corpus for the generic
old Math model. The new `BLENDLINK_MATH_MODULO_NATIVE=1` mode asserts the actual
emitted stage/input profiles and records the qualified exclusions.

## Earned checkpoint

Each of4.2/5.2/5.3 has 33 admitted native graphs (30 Math and3 independent input/
carrier controls) plus 2 native-recorded exclusions. Built snapshots on
SwiftShader LLVM and physical Apple Metal, each on WebGPU and WebGL2, give 396
readbacks. Every packed remainder has exactly zero error; encoded zero-sign
and independent native half-target controls retain the existing measured
carrier allowance, without a widened node tolerance. Native image fields
include 4,096 coordinate samples per positive/negative full/half-exact control.
The half-exact shifted fields pass all 3 versions; full fields pass modern5.x.

`compat.mjs BASELINE EVIDENCE LEGACY_REFERENCE` compares candidate built bytes
against a frozen source baseline using 101 original generic Math/control
documents and 2 legacy Noise documents. The checkpoint baseline is96bd0ad;
6,750,208 Float32 words are bit-identical across both APIs on both browser
profiles. This comparison intentionally makes no claim that historical Math
canaries already matched native Blender; it proves they did not change.
