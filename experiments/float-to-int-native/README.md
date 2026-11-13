# Float to Integer native research

This corpus researches `FunctionNodeFloatToInt`. It adds no public opcode,
extractor/runtime handler or coverage promotion. Native captures establish a
candidate domain; browser execution and enforceable live input proofs remain
separate work.

## Actual availability and sources

Actual creation is attempted in shader, compositor and Geometry trees, with
native assignment of every rounding mode. Blender 4.2.0 and 5.2.0 accept the
node only in Geometry trees. Blender 5.3.0 also accepts it in compositor trees.
All three reject shader-tree creation. Compositor absence on 4.2/5.2 returns
`NATIVE_NODE_UNAVAILABLE` with zero numerical compositor cases; Geometry MF
measurements do not change that denominator.

The 5.3 schema has one `Float` input (`VALUE`, default 0), one `Integer` output
(`INT`, default 0), and `rounding_mode` values `ROUND`, `FLOOR`, `CEILING`,
`TRUNCATE`. The nine official source URLs/revisions and bare SHA256 hashes are
pinned in [sources.json](sources.json). The 4.2/5.2 node registers through
`fn_node_type_base` and has a multi-function evaluator only. Revision
`02f0899d78e3` registers through `fn_cmp_node_type_base`, adds a GPU callback and
selects a mode-specific shader. Its compositor evaluator chooses CPU MF for
single-value compile units even when the selected compositor device is GPU;
spatial GPU inputs use the shader operation.

The CPU expressions are integer casts of native `round`, `floor`, `ceil` or
`trunc`. The shader uses the corresponding operation followed by an integer
cast. The casts do not provide a specified saturation contract for NaN,
infinity or out-of-int32 values. Observing a result on one host cannot turn
those inputs into a supported cross-platform clamp.

## Captured evidence

The retained captures use actual Blender builds `a51f293548ad` (4.2.0),
`fbe6228777e7` (5.2.0) and `02f0899d78e3` (5.3.0) on macOS arm64. Check the
individual receipts for the authoritative build values. Actual platform queries
attest Metal on 5.2/5.3. Blender 4.2 has no background `gpu.init` API and reports
`SOURCE_ATTESTATION_NA`; no Metal qualification is inferred for it.

There are 52 exact Float32 input words: ordinary signed fractions, both signed
zeros, immediate neighbors of positive/negative half integers, minimum and
maximum subnormals, minimum normal neighbors, the Float32 exact-integer
boundary, int32 boundary neighbors, and nine explicitly undefined conversion
controls. Control generation uses integer bit patterns rather than ambient
Float32 arithmetic: an initial NumPy-based generator lost subnormal controls
under Blender 5.3's ambient FP mode. Those initial captures remain retained as
`initial-geometry*.json`; the current captures use the complete identical word
set on all three versions.

`geometry_probe.py` evaluates actual POINT float attributes through the native
MF into an INT attribute, reading integer results directly. Typed buffer
uploads/readbacks preserve every requested source word. These supplementary
Geometry measurements cover all four modes in all three versions; they are not
compositor or GPU support claims.

`compositor_probe.py` captures 241 actual image-only EEVEE-context compositor
graphs per source device on 5.3, using FULL precision:

- one identity image/type/output calibration;
- four spatial image graphs, each containing all 52 controls;
- 52 unlinked socket constants for each of four modes;
- seven linked Value constants for each of four modes.

Both CPU and actual Metal offline GPU are captured, for 482 graphs total. The
8×8 opaque Non-Color full-float image is verified word-for-word after its final
upload. The identity output reproduces all 256 source RGBA Float32 words,
including signed zero, subnormals and the undefined controls. Graph/default/link
state and source image bytes remain unchanged around every render. Every EXR,
raw Float32 output, fixture, control generator and shared oracle helper is
hashed. Changing generated-image color/alpha settings initially resets its
pixels; `source-staging.json` records that failed setup and the explicit final
upload. Only the verified final input bytes are used for numerical comparisons.

## Results and limits

The captured CPU/GPU compositor output words agree for every measured control.
`ROUND(-0.5) = -1` and `ROUND(+0.5) = 1`: halves go away from zero. Immediate
neighbors on either side of those boundaries are retained separately. Both
signed zeros become integer zero, carried back as positive float zero.

Subnormals are an explicit counterexample to ideal real-number rounding. In
5.3, spatial input words `80000001` and `807fffff` give FLOOR result 0 rather
than -1; words `00000001` and `007fffff` give CEILING result 0 rather than 1.
The input identity control preserves those same words, so the change occurs
later in native evaluation. Geometry MF on 4.2/5.2 preserves the corresponding
-1/+1 response, while 5.3 Geometry MF also gives zero. RNA constant readback is
recorded as an observation, not raw-memory attestation: tiny values can already
be flushed while setting or reading a scalar socket.

The nine undefined conversion controls show ARM saturation/NaN-zero behavior in
these captures. Geometry INT readback distinguishes INT_MAX from its rounded
Float32 output carrier; the compositor's positive `2147483648` carrier can be
the Float32 representation of INT_MAX. These observations remain controls,
not a defined or portable conversion promise.

A candidate first browser domain is **5.3 compositor only**, with finite exact
Float32 inputs that are normal or zero and have `abs(value) <= 2**24`. There are
34 measured control points per mode in this proposed domain. All match the
independently calculated rounding result, including half neighbors and signed
zero, on both native source devices. This is not yet production admission or
exhaustive numerical certification. Generic interval bounds that cross zero do
not prove absence of subnormals; a live port still needs independently
checkable source/runtime input provenance and a browser trial. Source platforms
and GPU backends beyond the measured host remain unqualified.

## Reproduce

Use isolated Blender preferences and an actual binary. Set
`BLENDLINK_VERSION` to `42`, `52` or `53` for the binary under test:

```sh
BLENDLINK_FLOAT_TO_INT_SCHEMA="artifacts/float-to-int/schema${BLENDLINK_VERSION}.json" \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python experiments/float-to-int-native/schema_probe.py

BLENDLINK_FLOAT_TO_INT_GEOMETRY="artifacts/float-to-int/geometry${BLENDLINK_VERSION}.json" \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python experiments/float-to-int-native/geometry_probe.py

BLENDLINK_FLOAT_TO_INT_OUTPUT="artifacts/float-to-int/compositor${BLENDLINK_VERSION}-cpu" \
  BLENDLINK_FLOAT_TO_INT_DEVICE=CPU BLENDLINK_FLOAT_TO_INT_CONSTANT_SCOPE=FULL \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python experiments/float-to-int-native/compositor_probe.py
```

Repeat the last command with device `GPU` and output suffix `-gpu`. On 4.2/5.2
both device requests record actual node absence, with zero numeric cases. After
capturing all three versions, verify pins, source preservation, calibration,
mode results and retained counterexamples:

```sh
python3 experiments/float-to-int-native/analyze.py artifacts/float-to-int
```

Current receipts are `artifacts/float-to-int/schema*.json`, `geometry*.json`,
`compositor53-{cpu,gpu}/report.json`, `compositor{42,52}-{cpu,gpu}/unavailable.json`
and `analysis.json`. No production files or capability/catalog data are edited.

## Private browser kernel trial

`run.mjs` snapshots its experiment-only browser fixtures and pins the actual
native CPU/GPU field receipts and raw pixels. It imports Three 0.184.0 directly;
there is no public opcode or production runtime modification. Actual adapter
metadata, requested/returned API identity, distinct API coverage and a real
missing-WebGPU-adapter negative control are recorded.

All four staged candidate kernels match every native output word at the 34
proposed normal-or-zero control points on Apple Metal WebGPU/WebGL2 and
SwiftShader WebGPU/WebGL2. The points repeat over 64-pixel fields: 1,024 scalar
pixel comparisons across four modes and four adapter/API combinations. The
candidate first truncates to an integer base, converts that exactly back to
Float32, and branches on the exact fractional remainder. ROUND steps away from
zero when its magnitude is at least 0.5; FLOOR/CEILING step only on the
corresponding signed fractional side. In the proposed bound, integer bases and
outputs are exactly representable, the subtraction is exact, and intermediates
are normal or zero.

A private `int(round(x))` baseline fails half controls on both WebGPU adapters
and SwiftShader WebGL2: those paths use ties-to-even, while the captured native
node uses halves away from zero. Metal WebGL2 happens to match this baseline.
Those mismatches are retained, not used to change the native expected words.
Subnormal and large/undefined controls run separately; their mismatches do not
count as passes or enlarge the candidate domain. Resource disposal leaves zero
owned textures.

The first private readback probe incorrectly divided the mapped buffer length
by the image height to infer row pitch. Three's WebGPU readback pads rows to
256 bytes but omits final-row padding. The independent word calibration caught
that instrumentation error; the current trial accepts only the known tight or
padded layout. Initial failed receipts remain under
`browser-*-initial-readback`. No numerical allowance was introduced.

```sh
BLENDLINK_TEST_PROFILE=metal BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium \
  BLENDLINK_TEST_CHROMIUM_ARGS='[]' \
  npm exec --yes --package=node@24 -- node experiments/float-to-int-native/run.mjs

BLENDLINK_TEST_PROFILE=software \
  BLENDLINK_TEST_CHROMIUM_ARGS='["--use-angle=swiftshader","--use-webgpu-adapter=swiftshader"]' \
  npm exec --yes --package=node@24 -- node experiments/float-to-int-native/run.mjs
```

Receipts are `artifacts/float-to-int/browser-{metal,software}/report.json`.
A successful result is `PRIVATE_CANDIDATE_PASSED`, never production coverage.

## Saved-image transport boundary

Before proposing an image input route, `image_storage_probe.py` tests actual
save/reopen plus the existing compositor Image extractor. An unpacked GENERATED
float image loses 186 of the 256 authored pixel words on native save/reopen;
the extractor then faithfully transports the reopened defaults. Packing keeps
every word and automatically produces an OPEN_EXR FILE image, even when the
initial image file-format preference was PNG. Explicit OPEN_EXR packing has the
same result. The existing image extractor correctly refuses both packed float
variants because their display/data windows are not yet transported. The
source `.blend` bytes remain unchanged during extraction.

Therefore the initial Float to Integer production candidate must use exact
Float32 literal/group constants. The in-memory generated-float research input
is not evidence of a faithful saved full-float Image route. No PNG quantization,
source-kind override or bypass of the existing image guard is admitted. A
full-float image extension remains separate work requiring actual published
scalar-word proof through a supported asset transport.

```sh
BLENDLINK_FLOAT_TO_INT_IMAGE_STORAGE=artifacts/float-to-int/image-storage53 \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python experiments/float-to-int-native/image_storage_probe.py
```

The counterexamples, three saved `.blend` files and extractor diagnostics remain
in `artifacts/float-to-int/image-storage53/report.json` and its sibling files.
