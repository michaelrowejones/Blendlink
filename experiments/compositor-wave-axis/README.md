# Qualified partial CPU compositor Wave axis fields

The [closed next37 receipt](./evidence.json) qualifies a bounded Blender 5.3.0
CPU compositor route at source `d459c1db3d097bd23ab9ff5c17d48676faed110d`. The
automatic manifest transaction and independent family reader both closed with a
stable workspace. Classification is a separately reviewed **5.3-only partial**
entry; the runner does not promote categories. Shader Wave and older Blender
classifications retain their earlier verification.

| Measurement | Closed result |
| --- | ---: |
| Native production graphs | 140 |
| Native-only coordinate/domain controls | 9 |
| Actual native renders | 149 |
| Authored saved Final scenes | 20 |
| Actual browser cases, all four API/profile tuples | 640 |
| Primary Float32 words | 10,876,288 |
| Word mismatches / contract violations | 0 / 0 |
| Exact native RGB zero / one words | 264 / 198 |
| Separately checked resize frames / Final lifecycle cycles | 384 / 240 |
| Unique guarded Python prefixes | 22 |

The actual browser profiles are Apple Metal and SwiftShader, each through
WebGPURenderer WebGPU and WebGL2. Native sources are the pinned Blender 5.3.0
build `02f0899d78e3` macOS arm64 CPU compositor. The reference carrier scene uses
Cycles CPU; this does not qualify EEVEE/shader or native GPU compositor math.

## Admitted source and domain

The node's own unlinked Vector supplies native Uniform coordinates, for Bands
X/Y and SAW/TRI, Color/Fac. Scale and Phase Offset remain unlinked stored raw
Float32 literals: positive zero or normal magnitude from 2^-16 through 8.
Default Scale 5 and Phase 0 are unchanged. Distortion must be raw positive zero.
Detail, Detail Scale and Detail Roughness must be unlinked: their arithmetic is
unused, but linked input/domain scheduling is unqualified. Vector RNA defaults
are natively ignored. The source stays a field even when all values coincide.

Requires CPU FULL/AUTO, identity texture mapping, full-frame zero-origin square
pixels, physical width/height 4..8192, no render border/crop, and a static
contributing graph. Group/reroute/shared-key and declared mixed White Noise
controls are included. No source scene bake, output repair or parameter
quantization is used. Default SIN remains refused after its independent native
exact-endpoint counterexample. Rings, Z/DIAGONAL, linked controls or coordinates,
nonzero Distortion, animation/drivers/NLA and native mute bypasses refuse.

## Resource and installation measurements

A source-derived exact factor row is built on valid physical extent changes.
One distinct axis/profile/Scale-word/Phase-word key uses one R32F row, shared
between Color/Fac and repeated nodes in a compositor build. Maximum extent8192
uses at most 32 KiB logical Float32 data per Wave row. The separately owned White
Noise axis table is at most64 KiB. These are logical row bounds, not whole-install
or physical driver-memory totals.

The measured 240 actual Final cycles comprise 216 single-Wave cycles and 24
mixed White Noise/Wave cycles. Every API/profile tuple contributes 54 single and
6 mixed cycles. Row-only preparation and commit each allocate/upload zero rows;
live first rendering allocates/uploads one row for single-Wave and two rows for
mixed cases. PMREM and other install resources are excluded from these counters.
Valid extent changes upload once; repeated/warm frames upload zero times. The
row owner performs no production readback or extra render-target pass.

The eight combined Wave/White Noise/Ellipse/display sampled-resource limit is
a structural admission budget, not an observed eight-table benchmark. Closed
texture-free pointwise composition only; declared scene/image/render-pass/spatial
inputs, registered effects and unknown domains refuse. There is no Image Info
consumer extension or arbitrary downstream amplification claim.

The shared owned row table checks actual texture-node value/reference/UV/sampling
bindings and physical allocation ownership, including first-upload failure and
saved-original-renderer disposal. Physical extent/DPR/target/mip/viewport checks
remain live; warm frames do not scan data. Caller-owned mesh/material/geometry,
callbacks and renderer/scene state survive prepare/commit/dispose. All three
installation cycles per Final case are measured, rather than inferred.

## Evidence and retained failures

The independent reader rehashes the complete native source census and guarded
archive, re-decodes raw Float32 references, checks the coordinate/Wave/mixed hash
laws and native zero/one endpoints, closes actual Final assets/generated
descriptors, and freshly rebuilds runtime provenance for all archived browser
runs. The nine native coordinate/domain witnesses grant no runtime consumer
credit. [sources.json](./sources.json) pins primary source; historical
[readiness.json](./readiness.json) remains its original CPU-only checkpoint.

The failed `artifacts/verification-next36-wave-axis` transaction is retained with
zero qualification credit. Its reader incorrectly depended on JSON input-key
insertion order after captures; next37 compares the same exact key set without
that ordering dependency. Source arithmetic, numerical gates and ownership
thresholds were unchanged. SIN's separate research failure remains a numerical
refusal; neither failure is rewritten as success.

Exact node-field output within this scope does not prove general shader math,
whole-scene lighting/BSDF/IBL, original official demo appearance, other native
builds/hosts/versions or all-node completion. The automatic White Noise regression
after shared-owner extraction has its own independently pinned receipt.

Run a new transaction from supported Node24, with a fresh output directory and
a coordinated native/browser window:

```sh
PATH=/tmp/mrj-tooling:$PATH node scripts/test-node-port.mjs \
  compositor-wave-axis --profile mac-53 --blender /absolute/Blender \
  --evidence artifacts/verification-wave-axis-fresh
```

The manifest is [node-ports/compositor-wave-axis.json](../../node-ports/compositor-wave-axis.json).
