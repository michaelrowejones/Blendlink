# Exact CPU Difference Key profile

Fresh extraction on measured Blender 4.2.0, 5.2.0 and 5.3.0 uses
`native-difference-key-cpu-exact-v2` for CPU-evaluated Difference Key. Modern
GPU scenes can use this profile only when the actual upstream topology is
single-valued and Blender evaluates the node through its CPU multi-function.
The runtime independently repeats that classification; metadata alone cannot
grant CPU evaluation to a field. This is not new native GPU-field support.

The earlier admitted CPU expression had a visible HDR failure: gray
`.1414213478565216`, zero key, Tolerance/Falloff `.1`, input alpha `2^60`.
Native Image alpha is `477555592576106496`, while the old physical/software
expression returns `477555626935844864`, an error of `2^35`. Native captures
are retained byte-unchanged in
`/tmp/blendlink-cpu-keyer-hdr-audit/artifacts/verification-keyer-hdr{42,52,53}/reference`.
No native output pixels construct the production expression.

## Contract and primary source

- [4.2 CPU operation](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/operations/COM_DifferenceMatteOperation.cc)
- [5.2 CPU multi-function](https://github.com/blender/blender/blob/v5.2.0/source/blender/nodes/composite/nodes/node_composite_difference_key.cc)
- [5.3 CPU multi-function](https://github.com/blender/blender/blob/v5.3.0/source/blender/nodes/composite/nodes/node_composite_difference_key.cc)

The native CPU metric is a staged left-associated sum of absolute RGB
differences, divided by three. Key alpha is ignored. Whole original RGBA is
multiplied by Matte; original signed/HDR alpha is preserved, including the
legacy fully-keyed-zero rule versus the modern alpha cap.

The fresh profile requires positive Float32 Tolerance in `[2^-50,1]` and
Falloff zero or in `[1/64,1]`. Modern settings must be unlinked or direct
literal Value nodes; unqualified fixed arithmetic is not silently folded in
Python double precision. Runtime checks the exact native release tuple,
schema, source/effective evaluator, controls, native Color inputs and output
type. Inputs, output kind and settings are captured before deferred shader
construction, with a caller-mutation regression. Exact release guards reject
unmeasured patch versions.

Individual absolute components may be bounded to 12 because any such component
already exceeds the largest key threshold after averaging. The rounded sum is
at most 36. For sums at least `2^-72`, division by four is an exact normal power
of two scaling; `(sum/4)/.75` therefore rounds exactly as native `sum/3`.
Its operands fall within the independently earned Distance ratio helper's
range: numerator `[2^-74,9]`, divisor `.75`. Smaller sums are already far below
the minimum positive Tolerance, so setting their metric to zero preserves the
key decision and the legacy/modern alpha rules. Actual low-input, negative-HDR
alpha terminal cases exercise this shield.

The ramp numerator is `max(f32(mean-Tolerance),0)`. When nonzero near the
threshold it is at least `2^-74`, while its maximum is below 16. The existing
bounded integer ratio helper with fixed Falloff `[1/64,1]` returns exactly
rounded Float32. Shared division, generic Math, Noise and the ratio helper
implementation are unchanged. Falloff zero does not evaluate a quotient.

## Underflow refusals and compatibility

Normal input RGB alone does not guarantee a normal average. With R equal to
the smallest normal Float32 and G/B zero, native CPU 4.2/5.2 preserves a tiny
positive average while physical Metal flushes it. At Tolerance/Falloff zero,
native Image alpha is four and the browser gives zero. With Falloff `.125`
and independent alpha `2^120`, the discrepancy becomes `.0833333283662796`.
The measured 5.3 CPU result differs from 4.2/5.2 and matches the physical flush
for these controls. This does not establish a general 5.3 tiny-input profile.

Fresh CPU v2 therefore refuses zero and extremely small Tolerance for both
hard and soft keys. `native_tiny.py` retains actual native outputs, exact
Float32 files and source diagnostics outside its control-only numeric index.
The original observations remain at
`/private/tmp/blendlink-difference-precision-proof/tiny-before-{42,52,53}` and
`tiny-prototype-physical/results.json`.

Serialized `native-difference-key-v1` and the measured GPU
`native-difference-key-rne-v1` retain their original arithmetic and admission;
they do not acquire CPU v2 precision guarantees. Re-export scenes with the
current add-on and matching runtime to opt into v2. Existing native GPU field
models remain separate. Six old CPU v1 outputs also reproduce the frozen old
browser values exactly in the dedicated compatibility replay, including the
known approximate HDR values. This is runtime compatibility evidence, not
successful native v2 parity or a native output fit. Nonzero Float32 words are
identical; zero-sign identity is outside that replay's claim.

## Independent and full-graph proof

`native_mean.py` captures 16,384 actual CPU field values per version with an
explicit native ADD/ADD/DIVIDE graph equivalent to the pinned staged mean.
Its mathematically chosen inputs cover all admitted exponent strata, sparse
components, mantissa boundaries and random asymmetric triples. Native output
also agrees with an independent binary64 divide rounded to Float32. The browser
checks input bits independently and compares the snapshotted production mean
helper bit-for-bit, on physical Metal and SwiftShader/LLVM WebGPU/WebGL2.
All 49,152 native values pass each adapter/API pair (196,608 mean readbacks).
This is source-helper evidence, separate from built full-graph proof.

```sh
BLENDER_USER_RESOURCES=/absolute/isolated-profile \
BLENDLINK_DIFFERENCE_MEAN_REFERENCES=/absolute/mean \
  "$BLENDER" --background --factory-startup --python-exit-code 1 -t 1 \
  --python experiments/compositor-difference-key-differential/native_mean.py
BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium \
  node experiments/compositor-difference-key-differential/mean-run.mjs \
  /absolute/mean --out /absolute/physical-mean
BLENDLINK_DIFFERENCE_PRECISION_REFERENCES=/absolute/precision \
  "$BLENDER" --background --factory-startup --python-exit-code 1 -t 1 \
  --python packages/blender-addon/tests/compositor_difference_precision_check.py
# Repeat with BLENDLINK_DIFFERENCE_PRECISION_DEVICE=GPU for actual CPU-fold controls.
```

The full built corpus contains 413 indexed rows: 305 fresh CPU v2 programs,
90 existing native GPU v1 programs and 18 independent controls. It covers
default/nonbinary/power-of-two ramps, both Image/Matte outputs, fields, two-field
keys, literal links, groups, safe finite cascades, positive/negative `2^60`
alpha, low differences below the metric cutoff, actual EEVEE Render Layers,
repeated same-graph sizes and DPR2. Legacy GPU has no CPU-fold claim. Refused
native cases stay outside the numeric index.

Retained root: `/private/tmp/blendlink-difference-precision-proof`.
Final exact references are in `release2/exact-{42,52,53}-{cpu,gpu}`; ordinary
references and tiny-input controls are in `release/ordinary-*` / `release/tiny-*`.
`release2/final-{physical,swiftshader}/results.json` contains the immutable built
module/whole-program emit-guard proof. All 413 rows passed every adapter/API
pair with exact zero error, one pass, no retained textures and unchanged caller
MRT/clear state. Maximum observed fragment source is 5,905 bytes, within the
unchanged 16,000-byte precision gate. `mean-final-{physical,swiftshader}` retains the
independent primitive proof; `legacy-v1-physical` is a separate compatibility
replay and is not counted as native parity. The matching worker build, 1,418
unit tests (five skipped), 55 policy tests, 717-file package and Vanilla/R3F
consumer builds passed. Fresh hosted qualification of CPU v2 remains separate.

## Gate registration

The central compositor gate generates fresh CPU-v2 precision fields, modern GPU
CPU-fold controls, tiny-threshold native refusals and the independent staged
mean. Tiny refusals contribute only their two independently checked input
controls to browser comparison; four native Image/Matte outputs and exact raw
Float32 files stay outside the numerical index. Legacy GPU's lack of CPU folding
is explicit, with zero CPU-v2 numerical cases. Ordinary unmeasured OpenGL field
profiles retain the original hashed refusal protocol and cannot be converted
into a numeric success by their input-only control.

Native canaries cover CPU v2 on 4.2 and 5.2 plus actual modern GPU CPU folding.
The existing Blender 5.2 CPU job also generates and validates a fresh 16,384-value
mean reference, then checks the immutable production TypeScript helper source
on both browser APIs. That source-only proof is recorded separately from the
built JS graph comparison. Validators enforce native identity, counts, source
models, zero numerical coverage for refusals, raw refusal-byte hashes and exact
staged mean values. All artifacts remain in the native compositor canary
directory; software CI cannot create a physical Metal qualification.
