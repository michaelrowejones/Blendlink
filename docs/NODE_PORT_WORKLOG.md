# Local node-port batches

## Working policy

Development currently uses `codex/node-ports-local-first`, with local checks,
commits and pushes. Do not create or update pull requests, dispatch hosted
workflows, push release tags, or merge into `main` during this phase. The old
PR branch remains separate. Use `[skip ci]` on checkpoint commit messages as an
additional safeguard. Existing workflow definitions are retained for later use.

New numerical work targets the measured Blender 5.3 build first. Shader EEVEE
and compositor CPU/GPU are different evaluators. Native availability, schema
discovery, private kernels and appearance baking do not earn live coverage.

Work on families that share an enforceable primitive. Keep node modes, valid
input domains, actual source profiles and renderer APIs explicit. Prefer an
artist-useful field route where the shared infrastructure allows it. A bounded
literal route can unlock typed graph composition, but it does not close an
unimplemented image/field path.

Use these initial investigation budgets as review points, not correctness
allowances:

| Stage | Review point | Action when progress stalls |
| --- | --- | --- |
| Native semantics and feasibility | 15 minutes | Record the missing primitive and a reproducible counterexample; move to an independent route. |
| Kernel/extractor implementation | 30 minutes | Share a reusable primitive or split off an enforceable scope. Do not broaden claims to meet a deadline. |
| Numerical proof failures | Two failed fixes or 20 minutes | Retain the failure, add a named refusal and queue the root cause. Avoid repeated precision experiments on one edge. |
| Integration and build contention | Before every proof | Freeze the shared code, build once and queue GPU work. Use an isolated immutable checkout when concurrent implementation is still valuable. |

For every blocked item, record the native node/context, evaluated device,
smallest failing fixture, shared dependency, next useful experiment, and any
independent nodes that can proceed. Reopen the item when its prerequisite
changes. Do not repeatedly rediscover the same boundary.

Run targeted unit/refusal tests during implementation. At the frozen batch
boundary run native references, saved Final exports and the actual built browser
builder on distinct requested APIs. Track owned resources and shader/pass
bounds separately from numerical correctness; timing requires its own device
evidence. Run the broader local unit/policy gates once per integrated batch.
Update capability/coverage reports after numerical transactions finish, because
those reports are part of their pinned inputs.

## Batch beginning 2026-11-13

Starting Blender 5.3 inventory: 46 supported, 76 partial, 14 structural and
196 unsupported context/node pairs. There are 332 target pairs and 26 additional
legacy-only entries. Partial support is not whole-node parity.

Current independent work:

- Compositor Gradient and Checker: share extraction, literal/field validation,
  native fixtures and Final/browser proof. Native compositor sphere bias and
  radial evaluation differ from the shader implementation; no blind alias.
- Relative To Pixel: scalar domain-size conversion. Its Image input supplies
  dimensions without becoming the numeric output domain. Preserve that native
  distinction and reject ambiguous transformed/bordered references.
- Float to Integer: register the existing bounded port with the common watched
  manifest and fresh verification runner. This removes a manual proof path.

### Recorded bottleneck: two-component vector values

The [native discovery receipt](../experiments/compositor-vector-width/discovery.json)
records actual `NodeSocketVector2D` and `NodeSocketIntVector2D` sockets. The
current IR's legacy `VECTOR` is float3. Treating float2 as float3 would also
change scalar reduction: native float2 averages two components.

A short literal-group approach was stopped when native group-interface
creation rejected both two-component socket classes. No unqualified runtime
code or coverage promotion was retained. The prerequisite is explicit field
width/provenance and native conversion edges, rather than a padded float3
workaround. Relative To Pixel's own vector default is a possible later literal
entrypoint. Image Coordinates remains unported until its actual output/domain
and conversion paths are proven.

Relevant pinned implementation:
[Blender 5.3 type conversions](https://github.com/blender/blender/blob/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/blenkernel/intern/type_conversions.cc).

This discovery has zero numerical coverage. Independent scalar and texture
work continues while the vector-width prerequisite is queued.

### Batch proof and bottleneck outcomes

Gradient, Checker and Relative To Pixel closed their bounded Blender 5.3
proofs: together 588 native graphs, 36 saved Final scenes and 2,496 built browser
case runs, with zero word mismatches in the admitted domains. They remain
partial. Gradient's unqualified fields/radial/sphere modes and all unlinked
default texture coordinates remain refused. Nonlinear Gradient coordinates
and Checker inputs retain their explicit grid restrictions. Negative-zero
literals are refused where their native/runtime sign behavior is not qualified.

The common Float to Integer transaction now captures its own native references,
Final publications and actual browser APIs. Narrowing its fixture dependency
closure removes unrelated-test invalidations without excluding implementation
or shared-oracle changes. Its tracked receipt identifies exact captured source
hashes; later source/classification changes are not silently relabeled as a new
numerical run.

Several late admission decisions required repeated shared builds and browser
captures. The next workers use isolated worktrees for Switch, integer and
Image Coordinates families. Decide all intended provenance/edge classes before
the proof freeze; do not add fresh case families after numerical verification
has started. Retain meaningful failures without reopening the whole scope.

### Recorded bottleneck: native float-list transport

On the measured Blender process, widening float32 subnormals through NumPy
`.tolist()` or Python image pixel slicing can flush their words to signed zero
before JSON serialization. A native `foreach_get` buffer viewed as uint32
retains the original words. This is an oracle/transport boundary, not permission
to change node expectations.

The [transport control](../experiments/compositor-vector-width/word-transport-evidence.json)
records that failure and an integer-word JSON roundtrip. The generic compositor
browser harness accepts optional `inputWords`/`expectedWords` packets through
`experiments/native-compositor-differential/word_transport.py` and
`word-transport.mjs`, automatically enforcing exact word comparisons. Large
captures should retain raw `.rgba32f` rather than large JSON arrays. Existing
floating-list fixtures remain compatible; this tool change does not requalify
their older node evidence. New Gradient/Checker and Relative To Pixel proofs
already use raw float32 buffers.

### Classification refresh

`audit-node-coverage.py --reclassify-retained --check` now validates pinned full
catalog bytes and existing native baselines before updating classifications.
It preserves the original native inventory date. This replaces manual report
rewrites and avoids fetching legacy binaries solely to classify a new 5.3 port.
