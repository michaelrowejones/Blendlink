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

## Integrated Pixel conversions, practical Vector Math and Image Info

Three fresh combined-root transactions passed on Blender 5.3.0 build
`02f0899d78e3`, macOS arm64, with native CPU/GPU compositor settings and actual
browser WebGPU/WebGL2 on Metal and SwiftShader. Each closes the same current
runtime fingerprint `6c018a70abdba552a25eb2d7112447a1657de722911ccaecc0265ac57a0e114a`
against its own newly captured native references, saved Final publications and
browser results. The tracked [Pixel receipt](../experiments/compositor-image-coordinates/evidence.json),
[Vector Math receipt](../experiments/compositor-vector-math/evidence.json) and
[Image Info receipt](../experiments/compositor-image-info/evidence.json) retain
their separate source, fixture, launcher and asset pins.

| Fresh integrated family | Native graphs | Saved Final scenes | Browser case runs | Primary Float32 words | Exact-word differences | Contract violations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Pixel INT2, including scalar/integer/Boolean edges | 156 | 32 | 752 | 1,071,200 | 0 | 0 |
| Compositor Vector Math literals | 408 | 64 | 1,888 | 483,328 | 0 | 0 |
| Image Info metadata and separate aspect consumers | 264 | 24 | 1,152 | 1,604,288 | 0 | 0 |

Counts describe family matrices, not additional node classes. Existing Pixel
scope is extended; Vector Math and Image Info add partial compositor routes.
All three nodes remain partial, and the goal of porting all nodes is unfinished.
Native availability, extraction refusals, private controls and protocol/unit
tests contribute no numerical qualification credit. The 5.3 classification is
46 supported, 92 partial, 14 structural and 180 unsupported; older-version
classifications and the retained native inventory audit date are unchanged.
Pixel, Vector Math and Image Info own 34, 66 and 26 unique disposed native Python
prefixes respectively. Image Info exercises 728 actual resize/DPR frames.
Native/export/browser resource checks preserve source ownership and restore the
exact independently warmed renderer-owned DFG cache identities; no node-owned
textures/RTTs or per-frame GPU readback are introduced.

### Practical exact arithmetic and typed Pixel edges

Twelve simple Vector Math modes now admit actual stored normal Float32 literal
defaults with nonzero magnitude in [2^-32,2^16], or positive zero: ADD, SUBTRACT,
MULTIPLY, SCALE, MINIMUM, MAXIMUM, ABSOLUTE, FLOOR, CEIL, FRACTION, ROUND and SIGN.
Artist values such as 0.1, 0.8 and thirds use their real native RNA Float32
representations. These ordinary rounded operations still require exact output
words; no output tolerance is granted. Ordered staging is explicit, including
`a-floor(a)` for FRACTION and `floor(Float32(a+.5))` for ROUND.

Four compound modes retain tighter exactly representable domains:
MULTIPLY_ADD, CROSS_PRODUCT, DOT_PRODUCT and DIVIDE use sixteenth-grid inputs
within +/-16. Nonzero Divide denominators must be powers of two; native safe
division by zero returns positive zero. The bounds keep admitted reductions
exact across fused/unfused execution. Negative-zero inputs and operations that
could produce unqualified negative-zero products/quotients refuse, as do CEIL
inputs strictly between -1 and 0. The measured native SCALE zero-sign
counterexample stays quarantined without output repair.

Socket defaults, typed Input Vector, Value/CombineXYZ components, reroutes and
artist groups retain bounded executable provenance checks. Computed Vector Math
chains, image/coordinate fields, animation/drivers and remaining modes need
separate contracts. Modern native CPU multi-function single values are the
reference in both CPU/GPU-authored compositor settings; this does not qualify
native GPU-field arithmetic or arbitrary downstream composition. Eleven actual
extractor refusals and thirteen independent browser-program refusals guard the
excluded domains.

Pixel INT2 now has explicit scalar `(x+y)/2`, native integer midpoint and Boolean
edges alongside RGBA/padded-float3. Native integer half-way ties round toward X;
Boolean is true when either component is nonzero. Nonnegative integer Pixel
components through 8191 make these reductions exact. Independent analytic native
controls check odd-sum ties on both sides of X=Y. Direct, reroute and artist-group
paths, portrait/landscape resize and DPR changes use the same built program and
actual saved Final pipeline. Float2 scalar/integer reductions, transformed image
domains and spatial/neighborhood consumers remain separate work.

### Exact image metadata and a bounded aspect consumer

Image Info exposes exact Dimensions, Resolution, Location, Rotation and Scale
for a proved current-scene, direct full-frame Render Layers Image domain with
identity transform, square pixels and no borders. Host single-value metadata is
used even when the authored compositor device is GPU. Physical extents 1..8192
convert exactly to Float32; live texture/drawing/target dimensions must agree.
The source domain is rechecked during resize/DPR changes and hazardous settings
refuse before drawing, with recovery after returning to an admitted domain.
Static, transformed, single-value and arbitrary computed image inputs remain
unqualified.

The aspect example is an explicit existing consumer chain:
Dimensions/Resolution -> padded VECTOR -> SeparateXYZ -> Math DIVIDE(X,Y).
It is not an Image Info output socket. Only that ratio consumer uses both
<=2ULP and absolute error<=2^-22*max(1,abs(nativeRatio)), with exact alpha 1 and
exact upstream metadata. The measured matrix had zero exact-word differences and zero violations,
including the ratio cases (maximum 0ULP / absolute 0). The declared ratio bound
remains 2ULP with scaled absolute error; this observation does not promote the
ratio consumer to a universal exact contract.
Exact-word differences and contract violations are recorded separately. A
bounded ratio result grants no arbitrary downstream graph tolerance.

### Earlier failure detection and lower verification overhead

All six browser-proof families now use frozen family descriptors from their
already-pinned protocol modules: Pixel, Float2, default texture fields, Vector
Math, Image Info and static Switch. Runners/readers share their own status
constants. Parsed assembly checks reject copied labels, missing/foreign imports
and comment-only substitutes. Strict native/Final schema tests reject missing,
extra, duplicate and cross-family cases, wrong identities and failed/refused
statuses. Both new matrix entrypoints run preflight before any output/native
transaction. Sixteen focused tests passed before the corresponding expensive native/GPU
phases,
including subprocess controls proving all six entrypoints stop before a fake
capture/native executable can run. Historical Texture report vocabulary remains
compatible; its native/source/case closure stays distinct from Float2. Before
Image Info capture, a copied negative-control reader still expected the
Procedural Texture diagnostic family. A protocol-owned Image Info validator now
requires its exact eight refusal names and own diagnostic family; focused tests
reject missing/duplicate and foreign-family controls. Its matrix runs those
checks before capture. This caught another harness assembly error without a
native/browser recapture; share negative-control contracts as well as pass
status constants.

Pixel, Float2 and default texture-field matrices now use one fresh parent-owned
runtime transaction. Each browser child receives an explicit manifest path and
SHA256 and fully revalidates compiler inputs/resolution probes,
source/dist/build/snapshot/maps/vendor bytes and helper/config/package pins.
There is no automatic persisted-snapshot discovery or numerical/native reuse.
Standalone callers retain independent capture when neither transaction variable
is supplied. Partial pins, missing manifests, drift and source-mode attempts
refuse. Closing readers independently emit the whole current program again and
require exact transaction/compiler/archive closure before writing a receipt.

A serial CPU-only measurement on the isolated 172-module production program
(base `46c8cd5`)
reduced compiler attestation overhead from 19.807s to 5.981s (69.80%) and whole
program emissions from 9 to 2, retaining the fresh independent closing emission.
The optimized cost includes capture, eight complete child revalidations and
closing checks. Identical source/emitter fingerprints were required. This is
verification overhead only, not artist export latency, rendering performance or
node numerical evidence. The new Vector Math/Image Info numerical matrices
retain their own frozen capture paths; the measurement does not claim their
whole-job runtime improved by that percentage.

### Installation checks and remaining artist-scene gaps

The coordinated local checks passed 1,520 SDK tests with five optional skips,
98 release-policy checks,119 Node pipeline tests and seven Python audit tests;
the expanded six-family preflight also passed its sixteen focused checks. The
packed SDK contains 803 files and compiled in Vanilla and R3F consumers. A fresh
empty-cache install verified archive integrity, CLI version, root import and
browser compilation. These are local package/install checks, not a release or
real-user installation study. No PR, publication or hosted workflow is involved.

Fresh read-only triage of the three pinned official Blender demos still finds
Radial Tiling, animated/repeat transport and Cycles normal/bake-channel gaps.
That triage earns no new Final publication or numerical parity credit. Broader
image domain/window/origin algebra, remaining native casts and independently
budgeted composed fields remain reusable prerequisites. Subsequent ports should
keep new provenance/admission decisions ahead of the source freeze and run
cheap assembly/schema checks before the serial native/browser proof queue.

## 2026-11-13 — Static string controls, regular Radial Width, bounded Repeat and Cycles normal carriers

All four independent integrated closures share runtime fingerprint
`8c855569c8cff23d65d829c4c34427f4b0d6d1b3b602245b21b67bd7a9552627`.
These are bounded qualifications, not complete implementations of every native
node mode or arbitrary composed scenes. Blender5.3 remains the exact
`02f0899d78e3` macOSarm64 source profile. The retained full native inventory was
not recaptured by this classification refresh.

- Static strings: nine classes in each shader/compositor context, host-only
  UTF8 folding feeding exact scalar controls,4096-byte/128-visit/depth16 bounds.
  Full pinned one-codepoint Unicode casing (666upper/669lower changes), typed
  groups/reroutes/mutes, empty/missing/nonoverlapping Find and source-layout
  imports are checked.272native graphs (269production),55actual saved Finals,
  1308browser cases,334848Float32 words and59fresh Python prefixes closed with
  zero word differences.36logical text cases per source context use separate
  native Length and whole-Find witnesses; these are not separate covered nodes.
  CPU/GPU-authored compositor constants report CPU-MF and null GPU metadata;
  actual shader scalar transport reports EEVEE Metal. No runtime GPU string
  payload, glyph/layout, implicit numeric-position or animation credit.
- Radial: shader/compositor Segment Width only, literal integer Sides2..64,
  Roundness1 and both Normalize states; only the proven irrelevant Vector
  dependency is pruned.268native compositor graphs,252actual shader-atlas cases,
  18saved Finals and1144browser case pairs closed. Each pair independently
  compares256words in each path:292864words/path.50688compositor and46080shader
  exact-word differences remain within the predeclared2ULP AND absolute2^-22
  gate; measured maximum1ULP/2.9802322387695312e-8, zero violations.20fresh Python
  prefixes, actual APIs/profiles, resize and ownership checks closed.
- Repeat: paired shader Input/Output, exact fixed counts0..64 and1..4independent
  Float/Vector states; own-state copy/add/sub and literal/native-counter steps.
  Positive counts require bounded literal seeds.49native graphs,11saved Finals,
  240browser cases/61440words and13fresh Python prefixes closed with zero word
  differences. Actual shaders have one loop for positive counts, zero for count0,
  and stay within128KB. Source/profile/type/cost/cancellation/deep/cyclic guards
  run before deferred graph work. UV fields, including authored clamp+SNAP, remain
  refused: small producer differences can cross SNAP boundaries. Cross-state
  native assignments, nonlinear/dynamic loops and real material timeline
  transport remain independent work; the original Mandelbrot is unchanged.
- Cycles baking: actual owned Cube wood plus an explicitly labelled active-coat
  derivative,2material exports/3normal fields,5bake calls,8browser cases and
  12direction diagnostics. Separate Normal/Coat PNG bindings, native render-
  evaluated owner geometry, exact nonzero Mikk/UV triangle association and source
  restoration are checked. Actual zero-margin surface masks gate direction;
  expanded margins retain the full data quantization gate. Independent PNG CRC/
  filter decode and producer artifact manifests close the actual GLB/program/
  native/report bytes against both Metal/SwiftShader APIs and fresh runtime
  emission. Maximum Normal/Coat surface errors remain0.3251/0.3363degrees.
  This earns zero live-node credit. Floor exceeds the2M-triangle receiver budget;
  Lighting-atlas composition refuses before mutation. Full-scene lighting,
  filtering/LOD and original Cube acceptance remain unqualified.

The source/RNA/topology-only [Radial correction](../experiments/radial-segment-width/demo-controls.md)
shows its Map Range is STEPPED, Steps1: map=4+4*floor(2*r), followed by
sides=(map>4?map:3). The authored mesh bounds imply discrete Sides3/8/12.
The earlier inference of a linear/fractional field was incorrect. Width-only
admission still does not cover computed Sides or Segment Coordinates. This
zero-render derivation earns no numerical or scene acceptance credit.

Pipeline fixes reject extra Python actions, declare exact per-family native
script censuses, guard automatic native catalog observation, and move schema
preflight before output/native work. Radial/Repeat matrices share explicitly
pinned runtime transactions and retain fresh closing emissions. Unicode table
regeneration has a read-only check. Realistic stripped Final projections and
uninitialized-GPU host metadata failures are now regression controls. A float
modulo carrier signed zero was caught and replaced with existing integer
arithmetic outside the string operators; no output tolerance was widened.

The source tree passes1530SDK tests with5optional skips,98release-policy checks,
123Node pipeline tests plus8Python audit tests, and local packed/Vanilla/R3F and
fresh-cache install checks. Later metadata-only changes receive focused checks.
All22new context/node entries are5.3-only partial overrides. Only the8measured
Case/Find menu values acquire5.3partial enum scope;4.2/5.2categories and enum
coverage remain unchanged. Target totals are46supported,114partial,14structural,
158unsupported (332target nodes); no full-node completion claim.


## 2026-11-13 — Practical compositor Blackbody source reuse

The new compositor Blackbody route uses the actual native IMB CPU-MF path for
all single-value units, including GPU-authored compositor settings. Every stored
Float32 literal/Value/reroute/group temperature800..12000 is admitted; no artificial
input grid. The actual bundled Linear Rec709 configuration and coefficient
registry are hash-pinned, and the native identity color-transform bypass is
retained. Fields, arbitrary computed/animated temperatures and other working
spaces remain named refusals. Existing shader spectral behavior retains direct
division/LUT staging; the new route explicitly stages1/T before multiplication.

The predeclared source-error envelope is32u*S(T) AND absolute2^-15, with exact
alpha1 and independent non-half-exact HDR calibration. It accounts for permitted
GPU primitive rounding and cancellation, rather than claiming a fixed ULP error
near real zeros. The complete integrated matrix closed76native graphs
(74production),32saved Finals,432browser cases/110592words and35fresh Python
prefixes.3840exact-word differences, max2350ULP near cancellation and maximum
absolute1.1920928955078125e-7, satisfy both gates with zero violations.48resize/DPR
frames and actual Metal/SwiftShader WebGPU/WebGL2 are included. The selected
polynomial produces no shader loops or port-owned textures/targets;3actual Final
lifecycle cycles restore caller ownership and the independently warmed DFG cache.
Runtime fingerprint11e35e06803acf14dcac865edc6e670fb267e4d7af2b2779c2b11477ee674611.

Shared native script censuses and runtime transactions were reused. Realistic
stripped Final records, host-only backend metadata, independent AST artifact
closure and exact source/profile/working-space refusals run before expensive
proof phases. The shared spectral refactor passes all1533SDK tests plus5optional
skips and98release-policy checks. One5.3-only compositor entry becomes partial:
46supported,115partial,14structural,157unsupported. Existing numeric receipts
remain observations at their own source/runtime snapshots; this new receipt
does not relabel all retained ports as freshly replayed.


## 2026-11-13 — Exact Match String and bounded INT text conversions

The combined frozen ROOT string transaction adds three native classes in each
shader/compositor context: Match String, String to Value in INT mode, and Value
to String in INT mode. All six entries are partial overrides for the pinned
Blender5.3.0 build02f0899d78e3 macOS arm64 source profile. Earlier version
classifications and enum coverage are unchanged. Match's three menus and each
conversion's INT mode acquire only partial enum scope; FLOAT modes stay refused.

Match compares exact UTF8 bytes with Starts With/Ends With/Contains, preserving
case and combining-mark distinctions. Nineteen logical cases cover native menus,
empty text/key, the4096-byte boundary, separately bound groups and reroutes.
Its unchanged native Boolean Result drives an existing explicit Boolean Switch
with INT false0/true1 before the independent byte carrier.

Ten parser and seven standalone formatter cases cover bases2..36, signed32
endpoints and overflow, UTF8 suffix/prefix behavior, literal and shared producer
chains, native group bindings, sign-aware zero padding and the4096-byte output
boundary. Parser Value remains exact typed INT: its actual connected endpoint
feeds a native decimal formatter and independent Length/whole-Find witnesses;
consumed Length is a separate bounded witness. Standalone formatter endpoints
prevent parse/format errors from cancelling. No approximate Float32 carrier,
golden-driven rewrite, new Compare route or runtime text opcode is introduced.
Source tree animation, fields, unqualified computed inputs, implicit casts and
FLOAT modes retain named refusals.

The [fresh full-family receipt](../experiments/static-string-family/evidence.json)
closes458native graphs (455production),112actual saved Final exports,
2280built-browser case-runs,583680Float32 words and116fresh guarded Python
prefixes with zero word differences. All twelve static string classes were
replayed:150shader graphs/36Finals,154CPU-authored compositor graphs/38Finals,
and154GPU-authored compositor graphs/38Finals. Native host evaluation and
CPU-MF compositor scalar transport are distinct from the actual EEVEE Metal
shader scalar carrier. Actual Metal and SwiftShader WebGPU/WebGL2 paths,
caller resource ownership, adapter refusal and stripped Final artifact bindings
are checked. The independently re-emitted runtime fingerprint is
`fc842bc653dd7505aa2c54a0e0ac54dd28131f197f76eb1291484f9c29204959`.

All eighteen prior static-string entries now reference this same current
full-family receipt and fingerprint; their previously admitted limits and modes
remain intact. Counts are family totals, not per-entry or per-witness node credit.
The six new entries bring the retained5.3 classification to46supported,
121partial,14structural and151unsupported context/node pairs out of332.
The metadata-only audit preserves all4.2/5.2 classifications and native enums.
The separate Radial Segment Coordinates candidate is still pending its own
closed numerical transaction and receives no support or original-demo credit
from this string matrix. Artist-useful fields, general runtime strings and
complete node parity remain unfinished.

## 2026-11-13 — Static Radial Segment Coordinates on measured M5 Pro WebGL2

The existing partial shader Radial entry now adds Segment Coordinates for the
pinned Blender5.3.0 build02f0899d78e3 macOS arm64 EEVEE Apple M5 Pro Metal source.
The runtime scope is actual WebGL2 ANGLE Apple M5 Pro Metal, static normal/+0
Float32 literal XY in[-2,2], literal Sides3/8/12, Roundness1 and both Normalize
states. No node count changes: compositor Coordinates, prior versions and the
older Width profiles/verification remain unchanged.

The native input is two-component; its output is three-component
`(phase,radius,0)`. Group/reroute boundaries preserve explicit width semantics.
A public RNA Float32 foreach_get buffer preserves raw subnormal words across
GPU initialization even when ordinary promoted reads become zero. The new
source guard checks those raw sign/exponent bits and rejects negative-zero or
subnormal XY. Scalar means, image/UV/Object fields, arithmetic vectors and
computed Sides remain named refusals.

The [closed receipt](../experiments/radial-coordinates-static/evidence.json)
records410 raw cases, eight actual saved Final scenes, three install/dispose
cycles per Final and three physical resize/DPR frames. All112596 observed
browser words match the independent native F32 kernel reference. Actual EEVEE
material/film controls separately cover the eight ordinary/group settings,
with16 coordinate magnitudes,16 sign witnesses,16 grid-residue witnesses and
two independent carrier controls. Material phase differs by at most
3.5762786865234375e-7 within the predeclared2^-18 gate; radius difference is zero.
This material stage is not relabelled bit-exact. Eleven fresh native Python
prefixes and all five submitted GLSL role pins close with the independently
emitted runtime fingerprint
`fc842bc653dd7505aa2c54a0e0ac54dd28131f197f76eb1291484f9c29204959`.

Actual Final tests verify shipped programs, install them on the actual GLTF
meshes and expose their installed colorNode for channel acceptance. Source
materials/callbacks and exact actual zero-or-known-DFG baseline identities are
restored. These checks do not establish general PBR or full-scene appearance.
WebGPU and both software API paths have six raw/Final named refusals. Preview
Studio defaults to WebGPU, so this measured path needs explicit
`?backend=webgl2`; no default-preview acceptance is claimed. The original
Radial demo's computed STEPPED Sides and field coordinates remain unsupported.
The new receipt supersedes the earlier pending-candidate note for this static
slice only; the broader cross-profile/seam counterexamples stay research.

## 2026-11-13 — Exact origin constant and fresh Radial source lineages

The existing partial shader Radial entry now folds only exact stored positive
zero XY, literal Sides 3/8/12, Roundness 1 and either Normalize state into existing
`const_vec3`. Normalized output is `(.5,0,0)`; otherwise it is `(0,-1,0)`.
The native origin assignment overwrites phase explicitly; discarded rotation
can remain NaN. Source emission traps GPU initialization/platform queries and
records zero calls. No Radial kernel, uniform, adapter guard or fresh renderer
requirement is needed for this constant. **Native defaults Sides 5 and Roundness
0 remain unsupported.** This is not general default-node support.

The [origin receipt](../experiments/radial-origin/evidence.json) closes six actual
native material settings, 36 magnitude/sign/residue witnesses, two independent
carrier controls and six saved Final sources. Across Metal/SwiftShader and both
actual WebGPU/WebGL2 APIs, 24 raw plus 24 Final case-runs, 72 install/dispose
cycles and 12 resize/DPR frames compare 30,544 words with zero differences.
Eight source refusals retain negative-zero/subnormal, branch, animation, mute
and vector-mean restrictions. The owned reversible positive carrier is checked
only after raw tuples; it does not alter the native Radial inputs or body.

The [M5 static receipt](../experiments/radial-coordinates-static/evidence.json) was
also recaptured on the union source: 410 source cases now comprise 404 nonzero
cases and six folded origins. Its eight nonzero Finals, 112,596 exact raw/Final
words, six nonzero adapter refusals and separately bounded actual EEVEE material
phase error remain explicit. Nonzero coordinates still need M5 Pro WebGL2 and
`?backend=webgl2`; only the exact origin condition gains the measured portable
runtime route. No original-demo or general default-preview scene acceptance is
claimed, and no context/node count changes.

Both fresh Radial transactions share 121 SDK/addon Python inputs at source
fingerprint `d75965928da3a499c84b9e19128748dc294e52a7b39589f5ad7ffb84645d608b`;
each retains its own fixture and qualification hashes. Their JavaScript runtime
fingerprint remains `fc842bc653dd7505aa2c54a0e0ac54dd28131f197f76eb1291484f9c29204959`.
This closes those two source lineages only. Earlier Width, compositor, legacy
and unrelated node proofs retain their original captured snapshots; matching
JavaScript fingerprints do not imply that every other port was freshly tested.
