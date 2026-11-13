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

Use `npm run nodes:diagnose -- <report.json>` on common-runner receipts to rank
recorded command costs and inspect native invocation counts and median/p95
times. Child native durations are nested inside suite commands; the diagnosis
keeps them separate and does not invent a whole-transaction wall time. This
read-only command never starts Blender, browsers, builds or hosted jobs.

The first Float to Integer checkpoint recorded 114.4 seconds of commands:
69.7 seconds for the Metal suite, 42.0 for software, and 2.5 for build steps.
Its 32 Final export invocations took 26.9 seconds in total, nested in those
suites; two native capture invocations took 1.8 seconds. This receipt does not
show execution as a twenty-minute bottleneck. Repeated fixture development,
precision debugging and proof-specific harness work remain the areas to reduce.
Keep distinct numerical/resource contracts, but reuse transport, native process
isolation, API attestation and family fixtures rather than copying entire suites.

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

## Integrated selection, integer and coordinate batch

Fresh combined-root transactions closed all three families after a single
production build. Isolated receipts were replaced by fresh captures when shared
extraction code changed. A missing shared-oracle fingerprint triggered a fresh
Integer/Pixel capture with the complete 107-file native import/oracle inventory;
no hashes were grafted onto an older numerical receipt.

| Family | Native graphs | Saved Final scenes | Browser case runs | Primary Float32 words |
| --- | ---: | ---: | ---: | ---: |
| Static Switch / Index Switch / Menu Switch, shader and compositor | 195 | 72 | 1,068 | 273,408 |
| Compositor Bit Math / INT Hash Value | 594 | 24 | 2,472 | 632,832 |
| Compositor Image Coordinates Pixel INT2 | 32 | 8 | 160 | 246,080 |

Every admitted comparison passed with zero word mismatches on actual WebGPU and
WebGL2 under Metal and SwiftShader. The Switch counts include three native and
24 browser controls; the integer counts include 24 native and 96 browser
transport controls. Controls earn no node credit. Integer per-node counts overlap
on the explicit Bit Math to Hash chain and must not be summed.

All nine new context/node pairs remain partial: fixed typed Switch selectors
forward an existing selected expression without a new GPU operation; integer
ports admit bounded typed constant/own-family graphs; Pixel admits direct
full-frame pointwise fields and explicit INT2 to RGBA/float3 conversion. Pixel
supports actual animation-frame resize/DPR changes. Uniform/Normalized float2
coordinates and implicit default Gradient/Checker fields remain pending. The
Blender 5.3 totals are now 46 supported, 88 partial, 14 structural and 184
unsupported; 4.2/5.2 classifications are unchanged.

### Bottlenecks resolved and retained

- Static branch planning now visits only the selected branch, including separate
  instances of a shared artist group. Inactive unsupported branches no longer
  force an otherwise supported material to bake.
- Three's GLSL integer bitcast helper crossed through float bit representations.
  Pure integer casts fixed the measured Bit Math counterexample; generated-shader
  regression controls reject that float path on both actual APIs.
- Resizing a raw DataTexture requires GPU allocation disposal before changing its
  dimensions. Actual PassNode renders must advance real renderer animation frames.
  The Pixel proof fixes those fixture lifecycles, with no production uniform
  compensation for a stale texture or frame.
- A source-only compositor import now resolves the addon-authored static policy
  through the same sibling loader; the built package's derived import closure
  includes the policy beside the exporter and extension.
- Switch now prepares one fresh parent-pinned runtime snapshot per transaction.
  Each child revalidates compiler sources, resolution probes, source/dist/build
  inventories and snapshot bytes; the closing reader independently emits again.
  The observed browser phase decreased from 81.001 to 58.184 seconds (28.2%).
  This is one scoped measurement, not a general runtime or whole-job speed claim.
- The same Switch transaction recorded 95.687 seconds in guarded Final exports
  out of 172.507 recorded command seconds. Native process/identity startup is the
  next execution bottleneck. Investigate bounded export batching while preserving
  individual scene results and source/prefix accounting; do not weaken the guards
  or add more per-family cases during a proof freeze.
- Shared strict runtime archive validation replaces another pair of handwritten
  readers and rejects incomplete module/vendor/map/fixture inventories. Native
  launcher archiving is also shared with the common runner.

Fresh read-only planning on the three pinned official demos still finds artist
gaps: animated/repeat shader transport in Mandelbrot, Radial Tiling fidelity,
and Cycles normal/bake channels in Cube. The
[fresh triage receipt](../experiments/official-demo-node-performance/integrated-node-triage.json)
is planning evidence, not Final publication or visual parity. None of the three
used material graphs contains this batch's new node classes. A broken fresh-demo
download path was fixed with a separate, byte-pinned demo downloader; executable
download restrictions remain intact.

## Integrated floating coordinates, texture fields and native Menu sources

The next combined-root freeze extends existing partial nodes and adds the
shader/compositor `FunctionNodeInputMenu` context pairs as partial. New routes
are qualified only on Blender 5.3.0 build `02f0899d78e3`, macOS arm64, using
native compositor CPU/Metal and actual browser WebGPU/WebGL2 on Metal and
SwiftShader. Earlier Blender classifications remain unchanged. The resulting
5.3 inventory is 46 supported, 90 partial, 14 structural and 182 unsupported.
These are scoped implementation classifications, not a claim that all modes or
arbitrary composed graphs have visual parity.

| Fresh integrated family | Native graphs | Saved Final scenes | Browser case runs | Primary Float32 words | Exact-word differences | Contract violations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Uniform/Normalized Image Coordinates FLOAT2 | 96 | 16 | 448 | 596,992 | 33,024 | 0 |
| Default/linked Gradient and Checker fields | 222 | 16 | 952 | 68,565,664 | 66,090 | 0 |
| Static selection including native Menu sources | 213 | 90 | 1,212 | 310,272 | 0 | 0 |
| Pixel INT2 regression replay | 32 | 8 | 160 | 246,080 | 0 | 0 |

The same current runtime fingerprint closes all four receipts. These are fresh
native captures, saved Final publications, independent browser runs and closing
source/runtime checks, rather than relabelled isolated results. Shared cases
and controls earn no additional per-node credit; family counts must not be
summed into a number of newly supported node classes.

### Coordinate precision and artist defaults

Fresh `FLOAT_VECTOR2` distinguishes native two-component floating coordinates
from existing float3 `VECTOR` and Pixel `INT_VECTOR2`. Direct/reroute/artist-group
paths admit explicit RGBA `(x,y,0,1)` and padded float3 `(x,y,0)` edges. Float2
scalar/int conversion remains unqualified. The full-frame source is a direct
texture-backed Render Layers Image with zero offset, square pixels and physical
extents1..8192, with no crop/border or spatial/neighborhood operations. Physical
image/drawing/target agreement is checked during actual animation-frame
resize/DPR changes.

The coordinate contract was declared before proof: XY must satisfy both
<=2ULP and absolute error<=2^-22; zero centers, Z=+0 and alpha=1 stay exact.
Measured maximum was1ULP / 5.960464477539063e-8. This bound ends at the field
output and padding conversions. Downstream Math can amplify error, and Compare
or Checker can cross a branch boundary, so each composition needs its own proof.

An unlinked compositor Gradient/Checker Vector now uses Blender's actual
implicit Uniform field. Linked qualified Uniform/Normalized fields use the same
coordinate kernel; no literal zero or fake Render Layers dependency substitutes
for the implicit field. Existing exact literal scopes retain their earlier
contracts. Field domains require identity texture mapping, full-frame square
pixels, no borders/neighborhood operations and physical extents4..8192.

LINEAR/QUADRATIC and admitted EASING fields require both <=8ULP and absolute
error<=2^-20, with every native zero/one/alpha word exact. The measured maximum
was3ULP / 1.7881393432617188e-7. EASING additionally checks source-derived X
endpoint separation before export and every resize: default Uniform1920x1080
and portrait4x8192 pass; landscape8192x4 refuses. Uniform DIAGONAL remains exact
only when the maximum physical extent is a power of two. Normalized DIAGONAL
uses its independently bounded nonnegative-input contract.

Checker remains bitexact at fixed integer Scale0..256. A cached
O(width+height) rational phase-margin check encloses coordinate and fused/unfused
Float32 arithmetic uncertainty and requires one unambiguous floor for each
phase. Default Scale5 admits1920x1080,1080x1920,1280x720,3840x2160 and13x9;
4x5,5x4,15x10 and1920x1081 refuse. Resizes repeat the admission test and recover
after returning to a safe extent. The actual field color fixtures cover HDR RGB
and alpha0/1; native RNA clamped attempted negative RGB assignments, so those
attempts provide no measured negative-color credit.

Counterexamples remain tracked separately: near-boundary Checker phases,
non-dyadic Uniform DIAGONAL cancellation at native zero, and thin landscape
EASING endpoint rounding. No shader epsilon, output repair or relaxed threshold
was added after these failures. Actual Final pipelines and raw graphs cover
768 texture-field resize/DPR frames, refusal/recovery and exact renderer-owned
DFG cache/source restoration over three apply/dispose cycles. The kernels add
no port-owned textures/RTTs or per-frame GPU readback. These resource properties
are not a broad frame-time performance claim.

### Menu sources and verification throughput

`FunctionNodeInputMenu` now supplies the resolved native `node.value` choice to
existing compile-time Menu Switch, including direct, reroute and artist-group
bindings. Empty/conflicting choices, animation/drivers/NLA, invalid schemas and
budget violations still refuse. Only the selected existing expression is
emitted: no new GPU opcode, branch pass or generic standalone Menu transport.
The expanded Switch family keeps all310,272 words exact and includes six Menu
source cases per shader/compositor context with actual saved Final scenes.

The guarded launcher keeps full per-invocation SHA256 as its default. An
explicit opt-in serial transaction profile checks full native/Node bytes at
capture and finalize, per-call identity metadata and fresh helper/bridge bytes,
then seals exact successful calls before archival. Every native Python action
still gets a fresh prefix before imports; failed, overlapping, unsealed,
tampered or owner-dead transactions refuse/clean up. Nineteen guard tests include
actual Blender invocation and during-child drift. This is local proof execution
infrastructure, not an artist-export speed or rendering speed claim.

Paired six-export CPU-only batches measured a17.76% stage reduction and11.58%
reduction after including optimized capture/finalize/archive costs (mean8.146s
to7.202s); GLBs were byte-identical and sources unchanged. The expanded integrated
Switch transaction recorded156.191 command seconds, including84.136s Final
exports and56.474s browser checks. Its larger census differs from the preceding
run, so the integrated totals are not a controlled whole-job speed comparison.

### Integration failures and next bottlenecks

- A texture-field dispatcher assumed every spatial refusal control had a
  `properties` object. Existing Pixel/Float bad-spatial controls exposed a
  TypeError before their named refusal. Optional access fixes the production
  dispatch; a public dispatcher regression now protects it. Switch/Float/Pixel
  were freshly replayed after the shared fix, without grafting receipts.
- The new texture reader initially disagreed with its copied writer's legacy
  status token. The reader now demands the exact existing writer token while
  retaining field-specific case/source/module/fixture closure. No numerical
  reports or acceptance gates were patched. Shared typed harness contracts
  should replace copied metadata constants before the next family.
- Keep source/admission decisions ahead of the proof freeze. Independently
  porting workers are useful; simultaneous edits to shared extraction or proof
  helpers force expensive recaptures. Freeze one combined build before serial
  GPU proofs and record each failure as a distinct retained transaction.
- Next reusable work is native float2 scalar/int casts, domain/window/origin
  algebra and composition-aware precision budgets. Existing Gradient/Checker
  field scopes no longer wait on basic Uniform/Normalized support. Safe broader
  Scale/coordinate provenance, remaining Gradient modes and real artist-scene
  Radial/animation/Cycles-bake blockers remain pending.

Local verification passed180 SDK test files (1,508 tests, five optional skips),
98 release-policy tests,107 Node pipeline tests and seven Python audit tests.
The guarded native identity suite passed19 tests. A freshly packed SDK compiled
in Vanilla and R3F consumers. An independent install using an empty npm cache
verified the archive SRI, CLI version, root import and browser build. This is
local install verification; no release, publish, PR change or hosted workflow
was requested or run.
