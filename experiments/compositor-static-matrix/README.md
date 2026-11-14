# Static compositor Matrix copy islands

This candidate handles three Blender5.3 classes in **CPU compositor static
constant graphs**: Combine Matrix, Transpose Matrix and Separate Matrix. MATRIX
stays opaque inside Python. Separate's terminal Float outputs become existing
`value` operations; no browser Matrix kernel, transport, pass or resource is
introduced. This is a partial Blender 5.3 CPU-compositor port. Shader/EEVEE,
GPU-authored, field, animation and generic Matrix arithmetic remain unqualified.

The reviewed native classes share `build_multi_function` callbacks in Geometry
Nodes and the compositor's CPU single-value procedure. Combine and Separate
copy columns-first components; Transpose permutes them. Their callbacks have no
context inputs. `sources.json` pins the exact upstream sources and evaluator
selection. Upstream bodies remain unshipped; the independently written Python
wrapper is GPL-3.0-or-later and calls actual native classes in an owned carrier.

The source resolver admits typed literal/Value, explicit group-instance,
reroute/mute and already-qualified static Float-selection routes. It rejects
implicit conversions, unlinked MATRIX defaults, context/field/arithmetic
producers, unknown classes and animated owners. Every initial and recursive
group binding is recorded with its actual ancestry and node-tree identity.
Cached results retain their full transitive source-hop height, including group,
reroute and selector edges. Flat immutable recipe records reference integer
child IDs; fixed16-child key hashing never recursively expands a shared DAG.
Recipe height and source node/visit/depth budgets are checked before private
evaluation. Source Float storage is copied read-only through native Float interfaces and
homogeneous `foreach_get` before Python scalar promotion. Only finite normal
Float32 and positive zero are admitted. Negative zero, subnormals and nonfinite
words are never repaired. Native group RNA setters clamp infinity to the maximum
normal value; infinity is therefore tested as a raw-word predicate, not falsely
reported as an actual infinity fixture. Actual raw negative-zero and positive
and negative subnormal inputs are seeded with `foreach_set` and named-refuse.

One extraction owns its cache. One reviewed recipe builds one private one-point
Geometry Nodes graph, reads all16 Float attributes, and removes its private
Scene/Object/Mesh/NodeTree in `finally`. No authored user tree or owner geometry
is evaluated. Source raw words, topology, selectors, group ancestry, scene frame
and CPU settings are checked around native evaluation and cached reuse; source
and active/selected object/ID-user identities must remain unchanged. Limits are
64 source node instances, depth16,2048 socket visits,16 matrix islands and128
private nodes. No process-wide stale-source cache is retained.

## Closed post-fix union qualification

The [closed receipt](evidence.json) records 14 actual CPU compositor graphs,
6 actual saved Final publications, 80 browser case-runs and 5,120 primary
Float32 words with zero differences or contract violations. Both actual
WebGPU/WebGL2 APIs passed on observed Apple Metal and SwiftShader. The 48
resize/DPR frames are separate comparisons. The 72 Final lifecycle cycles
preserve source material/callback and independently drawn renderer cache
identities. All 16 direct and transpose component positions and opaque MATRIX /
terminal Float group bindings are covered.

The source policy passes 8 positive invariants and 12 refusal categories,
including the original shared-DAG and cached-depth regression mechanisms.
Flat recipe keys contain integer references; cached source records retain
transitive group/reroute/selector hop heights. Wide shallow source and excessive
recipe/source depth refuse before over-budget native evaluation. Native,
saved Final and browser phases were freshly rerun after this correction.

The transaction closes 129 native source inputs and 8 actual Python cache
prefixes at runtime fingerprint
`819e83b39bd016d505507cebfc1dff6c47e343669dc2d9f6126dee7d65955499`.
The native qualification hash is
`e9ff5da0f96a0dc5231c390e9bf09a83d506b9fdd30b307457f5a68e4216b4fd`;
the Final proof hash is
`eaf94b09423aebe23be39835c651b9bf7199643dcaf3671094eb8f322ada9f64`.
These are shared three-class family totals. Unrelated ports retain their own
captured source snapshots.

## Historical isolated CPU checks

The guarded CPU policy has8 positive invariants and12 refusal categories,
including actual native schemas, all16 endpoints sharing one evaluation,
nested copy islands, distinct group instances, typed MATRIX and Float group
boundaries, raw-word refusals, stale scalar/group mutation, cached source/reroute depth, wide-source budgets
and independently instrumented bounded DAG hashing. The actual compositor RGB
caller also refuses the seeded-cache deep-DAG attack before reaching its
over-budget native evaluation.

An independent12-render pilot compared all16 component positions, both direct
Combine and Transpose, against private CPU-MF outputs and actual CPU compositor
FULL precision EXR32 output:32 endpoint comparisons and768 RGBA words exact.
Inputs include +0, positive/negative minimum normal and maximum Float32,0.1,
thirds, adjacent0.5 values,2049 and2016.125. Its closed guarded two-script
archive is machine-local at
`artifacts/verification-static-matrix-pilot-r1/closed-pilot.json`; original
runner/policy/helper/capture snapshots are retained in `frozen-sources`.
This is CPU pilot evidence only, with zero Final/browser credit.

The full14-case reference was also setup-tested successfully:896 exact native
RGBA words, both group binding patterns and6 saved authored source files.
Saving a `.blend` alone is not a Final publication. The later post-fix union qualification above supersedes this setup-only stage.

## Frozen full qualification scaffold

`cases.json` declares14 native graphs and6 source files for actual built Final
publication. Raw and Final browser fixtures use both actual WebGPU and WebGL2
on Metal and SwiftShader. The expected primary census is80 browser case-runs
and5120 Float32 words, with exact word equality throughout; resize comparisons
are reported separately. Saved Final loads pinned actual GLBs/manifests/source
presentations into the production post pipeline. Three apply/dispose cycles
must restore original material/callback and independently observed renderer
cache identities. No Matrix runtime operation is allowed, even in a forged
payload. Independent texture-load controls establish readback orientation.

The immutable family protocol and parsed preflight reject copied statuses,
wrong censuses, wrong transpose words and cross-family packets before native
startup. The shared strict archive reader requires exactly the two native
reference/policy scripts and6 actual exports, with fresh native Python prefixes.
Runtime, fixture, source, compiled-native helper and artifact byte pins must
close against the frozen root. A later source/runtime change requires a fresh
matrix; the isolated pilot is not substituted.

For a fresh frozen-root replay after its build (Node 24):

```sh
PATH=/tmp/mrj-tooling:$PATH node experiments/compositor-static-matrix/matrix.mjs artifacts/verification-next9-static-matrix-union
```

The matrix captures native references and performs the6 built Final exports;
do not run `export.test.ts` again separately. The root reader writes
`qualified.json` only if every phase closes. Coverage records must reference the passing receipt for that frozen source. CPU-only setup checks:

```sh
PATH=/tmp/mrj-tooling:$PATH node --test scripts/lib/browser-proof-contract.test.mjs experiments/compositor-static-matrix/protocol.test.mjs
PATH=/tmp/mrj-tooling:$PATH node experiments/compositor-static-matrix/pilot.mjs artifacts/verification-static-matrix-fresh-pilot
```

## DAG budget correction

Review found the first tuple recipe representation could recursively rehash
shared descendants and let a previously cached shallow result hide source
subtree depth at a deeper call site. No coverage promotion was applied. Flat
child IDs and complete cached source heights replace that representation;
adversarial native source controls now enforce both budget dimensions. The
pre-correction union receipt is historical evidence only. A fresh complete
root native/Final/browser transaction was required after this correction; the
closed post-fix receipt above now supplies it.
