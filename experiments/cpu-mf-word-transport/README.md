# CPU-MF word boundaries — research only

This closes a bounded investigation of negative zero and subnormal transport in
Blender5.3.0 build02f0899d78e3 on macOS arm64. It changes no SDK code or coverage.
The original [failed calibration](../cpu-mf-attribute-oracle/failed-calibration.json)
remains unchanged. All new non-preservation results are retained in
[observations.json](observations.json) and
[hash-observations.json](hash-observations.json); [evidence.json](evidence.json)
records the two strict guarded-native archives and exact source snapshots.
There are 32 private Geometry cases, 8 image/EXR controls and 48 tiny actual
Cycles-CPU / CPU-compositor renders, with no GPU evaluation or port credit.

## What the controls establish

Eight words cover +0, -0, positive/negative minimum and maximum subnormals,
minimum normal and ordinary0.1. Raw mesh attribute storage, raw image storage
and independent RGBA32F EXR save/load preserve every word. An actual native
Image field through the CPU compositor also preserves every word. The earlier
loss is therefore not an unavoidable Python-array or EXR readback limitation.
Public homogeneous `foreach_set/get` seeds and checks storage without RNA
scalar-promotion flushing, FPU/DNA mutation or sign repair.

| Authored path | -0 / four subnormal inputs | Normal / +0 controls |
|---|---|---|
| Mesh named Float attribute -> new Float attribute | Raw words retained | Retained |
| Value -> Float attribute, and Value -> compositor RGBA | +0 at terminal output | Retained |
| Value -> native HashValue | Original input-word hash retained | Retained |
| Value -> Combine/Separate Matrix -> Float attribute / compositor RGBA | +0 | Retained |
| Value -> Combine/Separate Matrix -> native HashValue | Hash of +0 | Retained |

Geometry's Value row fans the same source into Float storage and an INT hash
witness within one authored graph. The witness retains -0/subnormal words while
the Float attribute becomes +0. This localizes an observable constant-field
materialization boundary beyond that source/consumer branch. It does not mean
all attribute sinks lose sign: the named-field path preserves it.

The separate actual compositor hash graphs agree with Geometry's hash results.
They also show why comparing terminal Float/RGB results is insufficient:
Value->Hash retains words that Value->terminalFloat does not. Geometry Math
`+0 * -1` likewise has a negative-zero hash witness while its Float attribute is
positive zero. No normalization or post-read sign correction is safe for a
future arbitrary downstream bit-sensitive consumer.

## Primary source and stage limits

[sources.json](sources.json) pins the reviewed primary sources. Shader Value's
MF builder constructs a typed native constant. The compositor groups compatible
nodes into pixel compile units; CPU contexts execute an MF procedure and expose
external results. Source code establishes these distinct interfaces, but this
probe does not instrument the exact scheduled unit boundaries or the precise
assignment that canonicalizes each constant in the unmodified executable.
Those remain a narrower follow-up, not an inferred implementation diagnosis.

The Geometry attribute-capture source has separate direct-sharing, constant
single-value and evaluated array/destination paths. This supports the measured
path distinction; it is not proof that a particular allocation fast path is the
sole cause. Float hash/equality utilities also deliberately equate signed zeros
for some caching purposes. No generic CSE or FTZ diagnosis is claimed.

HashValue FLOAT calls the native noise float hash, which first bitcasts the
Float32 word before integer Jenkins hashing. The Geometry INT attribute witness
is raw int32. The compositor hash witness uses ordinary native INT-to-Float RGBA
conversion; its eight predeclared hash codes remain distinct after Float32
rounding. This distinguishes those candidate words only. It is **not** full
INT32 transport, an injectivity proof for every Float32 input, or a reversible
hash-based generic raw-Float oracle. Minimum-normal and ordinary controls
independently calibrate that carrier.

## Consequence for future ports

Keep the existing normal/+0 domains and copy-only/intermediate restrictions.
Sharing an MF builder is not sufficient to fold arbitrary nodes separately:
materializing an intermediate can change what a later HashValue consumes.
A future reusable oracle needs the whole typed island, its actual downstream
consumer boundaries and source-specific equivalence, plus failure controls.
A bounded field-dependent destination experiment could investigate preserving
raw kernel outputs, but would itself be a different stage requiring native
compositor crosschecks. This research adds no generic CPU-MF, arithmetic,
Matrix-field, shader/EEVEE or GPU node qualification.

Rerun in fresh owned destinations with Node24; the scripts use guarded native
prefixes and a strict single-script census. Both scripts reset only their fresh
factory subprocess and privately own their Geometry resources. Geometry case
snapshots verify source/context/ID-user restoration.

```sh
PATH=/tmp/mrj-tooling:$PATH node experiments/cpu-mf-word-transport/run.mjs artifacts/verification-mf-word-research-new
PATH=/tmp/mrj-tooling:$PATH SCENETOWEB_MF_HASH_WITNESS=1 node experiments/cpu-mf-word-transport/run.mjs artifacts/verification-mf-word-hash-new
```

The first transaction's original runner is retained in its ignored
`frozen-sources` directory after the optional second-script selector was added.
No historical receipt is silently rewritten or promoted into current support.
