# Performance evidence for node ports

Correctness and efficiency need separate evidence. The native-to-browser port
transaction establishes the declared numerical domain. A performance report
measures the cost of that same implementation on a named device and scene.
Neither report substitutes for the other.

## Research direction

The current direction is a scene compiler with a small runtime, with EEVEE as
the live shading reference and deliberate baking for Cycles. Preserve native
evaluation stages before optimizing: Blender's compositor can evaluate constant
subgraphs through a CPU multi-function path even when image execution is on the
GPU. Moving that arithmetic to a fragment shader is a semantic change.

Use the pinned Three.js implementation as the renderer contract. Its
[`TempNode`](https://github.com/mrdoob/three.js/blob/r184/src/nodes/core/TempNode.js)
can avoid duplicate evaluation when the same node instance has multiple uses.
Repeated JSON expressions do not establish that this sharing occurred. Inspect
generated code and measured compilation before claiming a CSE improvement.
Sharing must retain material, object-owner, geometry, UV, coordinate-space and
native arithmetic-profile boundaries. The existing material installer already
shares eligible variants and separates mutable object bindings.

Avoid adding render targets for every translated node. Three's
[`RTTNode`](https://github.com/mrdoob/three.js/blob/r184/src/nodes/utils/RTTNode.js)
can introduce a fullscreen render and texture storage. Fuse compatible pointwise
work when its evaluation stage, image domain, precision and alpha semantics are
preserved. Convolution, branching image domains and independently consumed
intermediates need explicit scheduling and evidence. A static source-node count
cannot determine GPU pass or instruction counts.

Measure shader preparation separately. Three's
[`compileAsync`](https://threejs.org/docs/pages/Renderer.html#compileAsync)
requires the actual lighting/environment configuration and helps avoid first-use
compilation stutter. A fresh page/context does not clear driver or OS shader
caches; call these fresh-context phase timings unless those caches were actually
controlled. A useful optimization reduces preparation and steady work without
creating excessive material variants.

Track resources through repeated install/dispose and scene updates.
[`renderer.info`](https://github.com/mrdoob/three.js/blob/r184/src/renderers/common/Info.js)
provides renderer counters; distinguish its observed fields from estimates and
unknown allocations. Three requires explicit
[`dispose()`](https://threejs.org/manual/pages/cleanup.html)
for owned textures, geometries and materials. Internal renderer caches can remain
after the first draw, so compare repeated warmed cycles as well as initial state.

## Measurement protocol

Keep two fixture levels:

1. Small production-builder cases isolate a node or graph pattern. Include
   linked fields, repeated branches, worst admitted domains, shared materials,
   and repeated installation. Retain independent correctness evidence.
2. Actual scenes expose composition, material variants, evaluated geometry,
   texture transfer, upload and compositor costs. Download from
   [Blender's official demo collection](https://www.blender.org/download/demo-files/)
   with recorded creator/license, URL, byte length and SHA-256. Preserve the
   original bytes. Every control or derivative lists its changes.

Record actual renderer/API, GPU identity, browser and Three.js version/source,
host identity, harness digest, runtime source/emitter digests and scene artifact
digests. Fix viewport, DPR, camera, animation policy, lights and output settings.
Software rendering measures that software profile; it does not qualify a phone
or a physical GPU. Run GPU workloads serially on an otherwise idle machine.

Keep these measurements separate:

- Load/parse, material installation, shader preparation and first frame.
- Warmed CPU submission time and requestAnimationFrame intervals, with raw
  samples and p50/p95. RAF intervals include scheduling/vsync and are not GPU
  execution time. A fixed camera and paused animation cover only that workload.
- GPU timestamps from an explicitly instrumented pass when supported. Record
  unavailable/disjoint measurements as unknown. Do not rename a readback fence
  or CPU wall clock as GPU timing.
- Draws, triangles, material/program counts and renderer resource counters.
  Observe after install, steady rendering, disposal and repeated disposal.
- Exact shipped bytes and decoded resources, using the existing `scenetoweb perf`
  final-artifact analysis. Compression can reduce transfer without reducing
  triangles, draw submission, shader work or decoded memory.

Do not time correctness readbacks as ordinary frame throughput. Do not accept a
faster report when channels were refused, assets disappeared, the scene became
blank or its correctness domain changed. A fallback carrier is a cost control,
not a visually equivalent implementation of the source scene.

## Structural analysis

```sh
npm run nodes:cost -- --input /path/to/actual.materials.json \
  --output artifacts/verification-node-performance/cost.json \
  --pixel-digest-elements 65536
```

The [structural analyzer](../scripts/lib/node-port-cost.md) records exact graph
occurrences/depth, declared image/table elements, unknown lowering models and
bounded structural duplication candidates. Optional limits can enforce these
counts. Optional image digests distinguish repeated logical payload occurrences
from confirmed unique payload bytes within inspected coverage. None of these
counts establishes physical texture sampling, shader instructions, passes,
runtime duplication or GPU residency.

The browser benchmark is available through `npm run nodes:benchmark -- --built`;
its [runner documentation](../experiments/runtime-performance/README.md) describes
the actual production micro fixture and scene inputs. The manual CI observation
uses a named software-renderer profile. It cannot establish physical-device speed.

## Comparing changes

`scripts/compare-node-performance.mjs` reads two runtime benchmark reports and an
explicit policy. It compares only matching input, harness, settings, observed
host/browser/Three/GPU and installed/refused material coverage. Runtime code may
differ: that is the optimization being tested.

```sh
node scripts/compare-node-performance.mjs \
  --baseline /path/to/baseline/results.json \
  --candidate /path/to/candidate/results.json \
  --policy config/node-performance-policy.json \
  --output artifacts/verification-node-performance/comparison.json
```

The initial policy is a **screening threshold**, not a universal device budget:
10% relative and 0.2 ms absolute slowdown, at least three trials, and at least
30 samples per frame-timing trial. Both margins must be exceeded in every paired
trial to flag a slowdown. Mixed trials are inconclusive. Cold-phase checks use
one actual duration per trial, without inventing frame samples or significance.
Repeated resource growth is reported separately.

Exit 0 means measured metrics stayed within configured thresholds; exit 1 means
a threshold was exceeded or evidence was invalid; exit 2 means results were not
comparable or inconclusive. The comparison always grants zero correctness and
performance qualification. Unavailable GPU timing stays explicitly unmeasured.
Correctness gates, hardware acceptance and declared absolute frame budgets
remain separate required evidence before broader support or speed claims.

## Fresh real-scene findings

The [official demo corpus](../experiments/official-demo-node-performance/README.md)
contains pinned acquisition/probe commands and compact receipts for Cube Diorama,
Mandelbrot Grow and Radial Tiling. No original scene is shipped in this repository.

All three unmodified scenes currently refuse production Final for recorded
material/animation limitations. Stock glTF/browser controls and bounded native
EEVEE reference renders are observation evidence, not completed scene ports or
appearance acceptance. The original Cube floor alone contributes 2,097,152 of
2,106,644 exported triangles. An explicit floor-modifier control reduces the
stock artifact from 64,673,072 to 4,186,976 bytes and to 17,684 triangles; this is
an artist-visible derivative, not an automatic scene rewrite.

Profiling the original Cube also identified avoidable compiler work. Material
usage discovery created one Python RNA wrapper for every evaluated face merely
to read its material index. The compiler now uses Blender's bulk `foreach_get`
into an integer array. It retains the same evaluated mesh, slot ordering,
Geometry Nodes assignments, ARMATURE suppression and ownership cleanup.

Fresh native stock-export/binding differential checks pass on Blender 4.2, 5.2
and 5.3. The complete Cube plan JSON matches the old implementation, without
stripping fields. On Blender 5.3, three fresh alternating-order process pairs
observed warmed planning medians of about 467.35 ms before and 380.47 ms after
(18.6% less time); first-call variance is retained in the receipts. On 5.2/5.3,
peak Python-tracked allocation drops from 134,222,912 to 8,393,152 bytes. Native
Blender allocations, GPU memory and browser frame time are outside that memory
measurement. These are scoped planner improvements, not faster rendering claims.

## Current priorities

First establish comparable baselines and find the dominant costs. Then optimize
measured bottlenecks: redundant graph expansion, unnecessary intermediate
textures/passes, shader variants and compilation, repeated resource creation,
and scene geometry/texture delivery. Re-run native correctness after changing
arithmetic, folding, caching or pass boundaries. Prefer an explicit bounded
route or bake to an expensive precision emulation with no measured user benefit.
Do not silently lower precision, resolution, samples or scene content to pass a
performance target.
