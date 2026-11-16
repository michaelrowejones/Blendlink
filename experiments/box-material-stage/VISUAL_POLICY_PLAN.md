# Unlit BOX color visual diagnostics — unqualified proposal

This is an experiments-only proposal. It gives no support, material or scene
credit and does not replace the failed strict R3 result, exact source/input/mip
requirements, structural node checks, all-five-channel/no-skip requirements,
physical failure recovery, low-level material state, or resource ownership.
The scope is the bounded **unlit opaque LDR color field**, not a complete BSDF,
HDR presentation, NormalMap, original camera, or artist's whole scene.

## Proposed fixed criterion, declared before measuring R3

The display transform is exposure1, Standard sRGB, and nearest8-bit integer
quantization. The transfer follows the [W3C sRGB specification](https://www.w3.org/Graphics/Color/srgb).
It is not Blender AgX/Filmic. Every finite RGB sample must be in0..1 before
comparison; negative values, HDR and nonfinite values refuse the profile.
There is no clipping, image-dependent exposure, tone mapping or fitted transform.

Every RGB channel of **every common-covered pixel** and every common-background
pixel must differ by at most one of255 display codes. There is no eroded
interior, SSIM-only aggregate, percentile exclusion or error hidden by averaging.
Mean/RMS/max are reported separately from this per-channel limit. Coverage
disagreements are counted explicitly and cannot hide out-of-range colors.

Independent binary masks must satisfy symmetric outline distance at most one
Chebyshev pixel, one-to-one overlap of all8-connected foreground components and
all enclosed4-connected background holes, and exact preservation of covered
endpoints having at most one covered8-neighbor. Missing components, split/merged
silhouettes, filled holes and lost thin-feature endpoints refuse the proposal.
An isolated one-pixel contour bump cannot be identified as an authored feature
from a binary image alone; future scene acceptance still needs source geometry
attestation and explicit thin-feature controls. This diagnostic does not claim
to prove arbitrary subpixel geometry or preserve every semantic feature.

The originally proposed XOR area limit is the smaller of
`ceil(.005 * viewportPixels)` and `ceil(.01 * sourceCoveredPixels)`.
A **separate unqualified stricter diagnostic** uses `.001` and `.005` instead.
Both include a discrete one-pixel round-up at small resolutions; actual
fractions, integer limits and margins are reported. The first proposal was
not changed after observing R3. The stricter version is the proposed frozen
policy for a fresh512 target-resolution experiment, pending independent review.

Same-valid-coverage Mapping retains the existing raw2^-10 bound as a distinct
transport/debugging requirement. Whole-frame raw mask/Alpha/Mapping/color
failures remain in the output unchanged. A future combined gate must require
the structural/Mapping/input contract **and** visual checks; a display metric
alone is not a test of source-node equivalence.

## Measured existing R3 diagnostics

CPU reader replays all204 raw rows and245,760 numeric words, reproducing exactly
50 strict violations. All24 color frames at64×4 and128×8 satisfy the proposed
one-code diagnostic. Maximum display difference is1 on every tuple; no channel
exceeds1. Same-valid-coverage Mapping has zero2^-10 violations. Both Metal APIs
have zero coverage disagreements. Each SwiftShader API has two:

| Frame | Native foreground | XOR pixels | Original limit/margin | Stricter limit/margin |
| --- | ---: | ---: | ---: | ---: |
| Plane.021128×8 | 308 | 1 | 4 / 3 | 2 / 1 |
| Walls64×4 | 111 | 1 | 2 / 1 | 1 / 0 |

All affected outlines remain within one pixel, foreground component counts stay2
with one-to-one overlap, hole counts stay0, and no thin endpoints disappear.
These are diagnostic observations, not an attribution to anisotropy or a claim
that the raw errors are repaired. Source and all previous failed bytes remain
untouched. `visual-diagnostic-r1.json` retains both budgets and full results.

Eight synthetic CPU tests cover transfer breakpoints, no-clipping refusal,
one-code acceptance and a single two-code violation,64/128 size behavior,
bounded outline variation versus an entire one-pixel shift, lost tiny components,
thin endpoints, filled holes, wrong material and a shifted checker UV field.

Earlier signal-only negatives are kept separate from installed R3. All12
omitted-OVERLAY rows visually reject. Omitted Mapping rejects only2/12 rows
(one two-code channel on plane0 per Metal API);10/12 are visually insensitive
at the one-code bound. Those are not labelled discriminating negatives, and no
threshold is adjusted to force them to reject. The prior strict source/Mapping
requirements remain necessary. Actual wrong-UV GPU controls are not available;
the wrong-UV case here is explicitly synthetic only.

## Bounded next capture for review

Keep private71/72 immutable and change no production math, mip storage or source
scope. Use the existing72 resource-repaired harness in a new experiment branch,
three saved original-BSDF Finals, and the existing native field producer. Add
512×32 observation frames, preserving the exact16:1 projection used by the
64×4/128×8 field fixtures. This is a target-width field proof, not a normal-aspect
whole-scene preview. It must not be presented as release-resolution scene proof.

After an exclusive hardware lease, capture three native masks/Mapping/color
observations per saved fixture at512×32, then all four actual browser tuples,
existing resize/lifecycle/COLOR0/material negatives, and physical failure cases.
Check every resource/bitmap counter with the owned poison geometry still
attached at disposal. Retain raw strict results, use the frozen stricter budget
as a separate display diagnostic, and require independent review of new
synthetic cases before any acceptance/promotion. No inference from64/128 to512,
from unlit color to BRDF, or from this slice to the original scene is allowed.

CPU reproduction (new output file only; no GPU):

```sh
node --test experiments/box-material-stage/visual-color-policy.test.mjs
node experiments/box-material-stage/visual-diagnostic.mjs NEW_DIAGNOSTIC_JSON
```

The reader verifies immutable local proof/report/raw-byte pins before writing
that new result. It does not edit old receipts or install the private SDK patch.

## Prepared512 harness (CPU checked, never captured)

The existing producer/reader accept one additional declared field profile,
`--target-width=512`. It retains64×4 and128×8 observations and adds512×32.
Material draw/repeat, poison COLOR0, ordinary-material controls, last-good
recovery, disposal and remount all execute at512×32. The complete census is
27 native observations,63 rows per browser tuple/252 raw rows total, and
3,391,488 numeric words. No native or browser run has exercised this harness yet.

`stricterPolicy` freezes the proposed fresh-profile limits at0.1% viewport,
0.5% source coverage, one symmetric outline pixel, unchanged topology/endpoint
checks and one display code on every common pixel. It is labelled pending
independent policy review and fresh capture. It does not reinterpret R3's v1
result. Ten CPU tests now include predeclared512 census/aspect, stricter-profile
wrong silhouettes/materials and undeclared-profile refusals.

The normal reader invocation remains fully strict. An explicit
`--visual-diagnostic` mode shares every structural/source/mip/package/lifecycle
validation and records every raw strict violation alongside the separate
stricter visual/Mapping proposal. Its status always says diagnostics-only,
independent review pending, and zero credit. Mip comparison additionally requires
every byte-level SHA to match the frozen cold-native/R6 chain, beyond the
companion's internal hashes. No color/math/format/runtime code changes follow.

The next run must use the newly frozen integrated private candidate on public
a1684, with a **new** hash guard manifest for its merged Shadow/BOX source bytes.
Do not run it against old71 or alter that historical patch/receipt. Root owns
that integrated candidate and the hardware queue. Once its manifest and source
freeze are reviewed and an exclusive lease is granted, the planned commands are:

```sh
node experiments/box-material-stage/export-colors.mjs NEW_FINAL_DIR --gpu-lease --target-width=512
node experiments/box-material-stage/native-color-references.mjs \
  NEW_FINAL_DIR NEW_NATIVE_DIR /tmp/scenetoweb-box-storage-native-r3 \
  --gpu-lease --target-width=512
node experiments/box-material-stage/installed.mjs \
  NEW_FINAL_DIR NEW_BROWSER_DIR --gpu-lease --target-width=512
node experiments/box-material-stage/read-installed.mjs \
  NEW_FINAL_DIR NEW_NATIVE_DIR NEW_BROWSER_DIR NEW_DIAGNOSTIC_JSON --visual-diagnostic
```

These are preparation instructions, not executed-proof results or a release
gate. Actual artist-view aspect/resolution and complete scene comparison remain
separate future work.

The fresh `integrated-sdk-files-43840.json` profile pins2064 files (about48MB of
SDK/addon sources/config, all built JavaScript/Python/JSON, Three build/source
and actual loader/decoder dependencies, compiler/lockfile and proof helpers).
`integrated-sdk.mjs` verifies every byte and requires frozen43840 ancestry before
inputs, output directories or hardware. Its proof is bound into all three
Final/native/browser records and rechecked by the reader. Existing
`candidate-sdk.mjs`, its17-file manifest and historical patch are unchanged.
The new integrated profile can be checked without inputs/hardware:

```sh
node experiments/box-material-stage/integrated-sdk.mjs --check-sdk
node experiments/box-material-stage/installed.mjs --check-sdk --profile=integrated43840
```

The public SDK refuses both the old private and the new integrated profiles.
The new512 mode selects only the integrated profile; it cannot silently run
against old71. Independent full strict readback remains available with
`--profile=integrated43840`; its raw thresholds are unchanged and any failure
must be retained alongside the separate diagnostic report.

## First integrated attempt and CPU policy harness repair

Frozen90e4's first attempt stopped before Final export, native fields or browser
capture. Its single CPU policy process had one30s outer deadline for three
separate189MB saved files. That timer cancelled the launcher; the child records
SIGTERM/aborted, no successful policy JSON and no qualification credit. Exit143
was not accepted as a successful shutdown. The failure is preserved at
`policy-timeout-r1/` with exact source/receipt pins.

An explicitly authorized, separate60s CPU-only diagnostic completed the original
policy in37.601s. Compiler import took.373s; all plan calls total.664s and private
carrier probes.267s (nested plan timing overlaps). The remaining work is outside
those measured phases, including large source reload/context teardown/hash work.
Its attempted `wm.open_mainfile` timing hook did not persist on Blender's fresh
operator proxy; case names are null and it does not measure exact open durations.
Native load logs retain the case order. It is a diagnostic, not qualification
or evidence that a longer qualification timeout should be accepted.

The new audit installs persistent `bpy.ops.render` and `bpy.ops.object` modules,
overrides render/render.opengl and bake/bake_image when registered, and denies
`gpu.init`. It verifies lookup identities before inputs and after loading a
file. Before any compiler/input work, it actually calls those patched native
operator lookups and requires their denial exceptions. A real headless native
selftest passed in1.531s: five intentional denied probes, zero native GPU/render/
bake calls. The original BPyOpFunction types and separate selftest/body counts
are recorded; merely observing a zero counter is not the test.

Each policy worker now receives exactly one case and the same original30s
deadline. Three policy calls have an explicit3×30s aggregate maximum; no single
deadline is inflated. Their separately hashed case reports must collectively
cover all three immutable inputs. The strict archive census becomes **three
policy invocations plus three actual Finals, six fresh Python prefixes**.
The reader verifies each exact case argument, persistent-denial witness and
case-report hash. Phase timing now records source hashes, actual file load,
positive plan, private-carrier restoration and both refusal probes.

This is a CPU harness repair only. The60s diagnostic and the native denial
selftest do not qualify the repaired full transaction. Freeze/cherry-pick this
separate repair and obtain an exclusive lease before the single planned retry.
No SDK math, storage, visual cutoff or source support is changed.

## Resource-failed512 R2 and dedicated negative geometry

Frozen4b8 passed all three policy workers (13.701/13.424/13.195s), three actual
Finals with the exact six-prefix census, and all27 native observations. Its
first Metal/WebGPU browser case completed23 rows including64/128/512 fields,
actual material/COLOR0 controls, missing/corrupt/abort recovery, dispose/remount
and genuine legacy refusal. Expanded cleanup then rejected one remaining GPU
attribute/64bytes. The run stopped; no other tuple was inferred. The partial
color fields satisfy the proposed one-code diagnostic, but that does not close
the failed lifecycle or qualify the port. The failed report, source/module pins,
raw locations and partial diagnostics are retained at `resource-failure-r2/`.

Pinned Three0.184's `common/Geometries.js` registers its geometry-disposal
callback with the **first RenderObject's active attribute list**. The owned BOX
shader correctly ignores COLOR0. A later generic negative activated the poison
COLOR0 buffer, which was absent from that first list even though it remained
attached to the test geometry. Merely cloning and disposing that geometry could
not release the late test-owned buffer through that callback.

The next harness-only correction gives the generic negative its own geometry,
first drawn with COLOR0 enabled. It keeps the owned/plain control separate and
disposes both geometries before disposing their first materials. A small helper
asserts distinct geometry/attribute/index ownership and exact preserved source
bytes, including interleaved storage; it checks the caller's identities/bytes
again after disposal. Its source is pinned in each browser report. Two CPU
geometry tests plus the earlier14 policy/guard tests pass. No GPU validation of
this correction has occurred yet. It does not claim to repair arbitrary
application material/late-attribute transitions or change any SDK/Three cache.

The one planned browser-only retry reuses immutable Final/native R2 bytes and
must pin the existing packed SDK SHA256
`a0556c36289535f654bf019094ccc344f0bf5843f2addbecbcb02cf83b1ea3bb`.
`--packed-sha256=...` verifies newly packaged bytes are identical **before** a
browser starts. No native/Final rerender or source/math changes are required.
Freeze/cherry-pick the harness and obtain an exclusive lease before retrying:

```sh
node experiments/box-material-stage/installed.mjs \
  /tmp/scenetoweb-box-integrated-finals-r2 NEW_BROWSER_DIR \
  --gpu-lease --target-width=512 \
  --packed-sha256=a0556c36289535f654bf019094ccc344f0bf5843f2addbecbcb02cf83b1ea3bb
```

## Full browser R3 and canonical-field reader correction

Frozen3f2's final bounded browser retry completed all four tuples and252 rows
using the exact same packed SDK, three Finals and27 native observations.
All12 cleanup checks return geometry/attribute/storage/readback counts to
baseline; all four tuples close9/9 owned bitmaps. Dedicated-negative ownership
and source-geometry byte checks pass. This does not prove a generic Three
late-attribute-switch fix, cold-start performance or original-scene acceptance.

The first full CPU reader retained all152 raw strict violations but had a bug
in its **new visual/Mapping branch**: strict comparisons used the declared
WebGPU row adapter, while that new branch consumed raw top-left rows. Its
misoriented diagnostic is preserved at `canonical-field-correction-r3/` and is
not accepted. No GPU/SDK/native data, exposure, threshold or policy was changed.

`field-readback.mjs` now makes raw numeric buffers private. It applies the
already-declared backend origin convention once, and strict, visual and Mapping
paths consume that same canonical field accessor. The supporting-frame accessor
rejects numeric kinds. Three actual observation-entry tests use independent
asymmetric masks and nonconstant colors/coordinates on both APIs, and make
missing/extra/double-flip cases reject. Together with prior tests,19 CPU tests
pass. This prevents a branch from silently skipping or repeating the adapter.

An independent CPU recomputation using this accessor reproduces **every raw row
unchanged**,3,391,488 words/152 strict violations. All36 corrected color frames
meet the frozen stricter proposal, with no RGB channel beyond one display code,
no outline/topology/endpoint/area failure and no same-valid-coverage Mapping
violation. Both Metal APIs have0 raw violations and0 XOR pixels; each SwiftShader
API retains76 raw violations and4 XOR pixels across nine frames. These corrected
diagnostics do not qualify the port. The corrected full structural reader must
be cherry-picked/replayed and independently reviewed before any acceptance;
original material/scene, normal composition and artist-view framing stay open.
