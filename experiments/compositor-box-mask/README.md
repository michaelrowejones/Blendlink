# CPU Box Mask

The [closed receipt](evidence.json) qualifies a bounded Blender 5.3 CPU-compositor
Box Mask on actual browser WebGPU and WebGL2, using observed Apple Metal and
SwiftShader adapters. It records 40 native graphs,12 actual saved Final scenes,
208 browser case-runs and 98,592 exact Float32 words with zero differences.
All four native Operation menu values—Add, Subtract, Multiply and Not—are
covered. This remains a partial port.

## Supported slice

Pinned Blender 5.3.0 build 02f0899d78e3, macOS arm64 CPU compositor. Position/Size/
Mask/Value must be static unlinked Float32 literals; Rotation must have raw
positive-zero bits. Position is [-2,2], Size [0,2], Mask/Value [0,1]; every component
is zero or has magnitude at least 2^-16. Negative zero, subnormal, nonfinite,
out-of-bound, linked/field and animated inputs refuse. Native default geometry
is included. The proof uses a Cycles CPU carrier and actual CPU compositor;
it does not establish an EEVEE material/shader or Blender GPU-authored route.

Physical domain is zero-offset full frame with square pixels, dimensions 2..8192.
Borders/crops and spatial/domain consumers, including Flip, refuse. Arbitrary
composed graphs, rotation, Ellipse and anti-aliasing remain unqualified. Other
versions/builds/hosts retain their previous unsupported classification. Legacy
WebGLRenderer has no live installer.

## Native fidelity and efficient runtime

Coordinates follow native endpoint sampling: texel/(displaySize−1), subtract
Position, multiply Y by height/width. Size is halved and strict comparisons keep
boundary equality outside. Rotation 0 gives two monotone axes. Their ordered-F32
classification produces one integer interval per axis, possibly empty. The
runtime scans O(width+height) only when a validated physical extent changes,
then the shader compares integer texels and selects precomputed inside/outside
values. There is no artist-input quantization, epsilon, mask texture, added pass
or per-frame readback.

For admitted literals, nonzero subtraction is at least 2^-39, aspect multiplication
at least approximately2^-51, half Size at least 2^-17, and scalar products at
least 2^-32. These stay well above Float32's normal floor 2^-126, avoiding ambient
flush-to-zero ambiguity. Unsupported values are refused rather than repaired.

Position/Size arrays use raw public RNA buffers. Scalars use native interface
`from_socket` copies into private homogeneous FLOAT storage, then `foreach_get`.
Factor/Angle subtypes remain scalar FLOAT properties. This preserves stored
bits even when Python scalar promotion hides subnormals. Both private groups
are removed in `finally`; the original sockets are never initialized or modified.
The production reader never uses `init_socket`, ctypes/DNA, serialization or FPU
changes. 128 repeated reads preserve source pointers, links, users, scalar words
and group census. Historical raw-copy probes and test-only `init_socket` seeding
leaks remain separately labelled research in the research receipts; they do not
supply current numerical credit or establish full native allocator closure.

The cache stores one extent. Pending dimensions and both intervals are validated
before replacing live uniforms/key; settings arrays are snapshotted. A result
VarNode retains extent validation when the shader optimizer erases constant or
all-zero geometry. Invalid extents refuse and recover with the prior cache intact.

## What was verified

[cases.json](cases.json) closes defaults, all operations, strict edges and adjacent
Float32 sizes, empty/full/offscreen rectangles, nonsymmetric grouped off-center
geometry, native2×2, small scalar inputs/differences, and FULL/AUTO precision.
Direct, group and reroute source graphs are retained. The current full transaction
recaptures all40 graphs; earlier26-case pilots are historical evidence only.

Both APIs on both measured adapter profiles match native CPU words exactly,
including scalar-to-RGBA alpha1. The96 live resize/DPR frames include native
references for default, all-zero and constant outputs, plus invalid→valid
recovery. Twelve actual saved Final scenes load pinned GLB/source presentations
and install the authored compositor in the production post pipeline.144 Final
install/dispose cycles restore source material/callback identities and the exact
zero-or-one DFG cache identities established by independent source-scene draws.
These checks do not establish whole-scene appearance or every composition.

The strict reader checks 125 current native source inputs, exact saved-source and
native invocation censuses, 13 distinct actual Python cache prefixes, native/Node/
helper archive bytes, independently emitted runtime modules, maps/vendor files,
fixture snapshots, descriptor/GLB pins, ordered cases and exact numerical/resource
controls. Runtime fingerprint:
`29a553a8c01a0541324fa23100e0ac2593dcfc66a85841a6dd58be46698a66dd`.
Only this Box transaction was freshly recaptured; unrelated node proofs keep
their original snapshots.

## Host cost measurement

The separate [host benchmark](performance.mjs) measured a 4K(3840×2160) extent
reclassification median of approximately0.009ms over 100 samples on Node 24.22.1,
Apple M5 Pro. This measures the host classifier, outside browser rendering;
cache hits do not call it. It is not a browser-main-thread, frame-rate, GPU-cost,
native Blender speedup or whole-scene performance claim.

## Replay

From the frozen built union root, using Node 24:

```sh
PATH=/tmp/mrj-tooling:$PATH node experiments/compositor-box-mask/matrix.mjs artifacts/verification-next8-box-union
```

Use a new owned artifact directory for a new transaction. The matrix creates a
fresh guarded native launcher, captures CPU references and performs12 Final
exports once, then four actual browser contexts covering both APIs. Do not run
`export.test.ts` again. Shared contract/census preflight runs before native work.

The immutable upstream pins and license notes are in [sources.json](sources.json).
Native node/kernel sources are GPL-2.0-or-later. No upstream shader body was
mechanically copied into the independently written MIT runtime; Python is
GPL-3.0-or-later. No unreferenced-artifact or all-other-ports freshness is claimed.
