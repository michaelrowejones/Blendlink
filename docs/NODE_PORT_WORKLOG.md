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

## 2026-11-14 — CPU Box Mask with integer rectangle bounds

The new partial Blender 5.3 compositor Box Mask slice covers all four native
Operation menus with static unlinked parameters and Rotation raw+0. It retains
native defaults and strict empty/boundary behavior. Position [-2,2], Size [0,2],
Mask/Value [0,1], and zero-or-magnitude>=2^-16 bounds keep admitted F32 arithmetic
normal. Negative-zero/subnormal/nonfinite values, fields/links, animation,
rotation, borders/crops and spatial consumers including Flip remain named refusals.
Only CPU source compositing is qualified; no Blender GPU, EEVEE shader/material,
Ellipse, AA, other-version or arbitrary-composition claim is added.

Public native `from_socket` copies recover scalar raw words through homogeneous
FLOAT buffers without scalar-promotion loss, original-socket initialization,
FPU changes or source edits. Both private groups are cleaned in `finally`.
Repeated read-only ownership controls and raw-word controls precede actual CPU
references. Historical failed getter probes and test-only initializer leaks stay
research; the production reader never calls `init_socket`.

The runtime caches one physical extent, scans two ordered-F32 axes in O(W+H),
and uses integer shader texels/interval comparisons with precomputed branch
values. No shader epsilon, input quantization, mask texture, added pass or
per-frame readback is introduced. Cache updates are atomic after validation;
a result VarNode preserves the guard even for optimized allzero/constant outputs.
A separate Node 24.22.1/M5 Pro host measurement observed a 4K reclassification
median near 0.009ms; this is not a browser/GPU/FPS or native-Blender speedup result.

The [closed Box receipt](../experiments/compositor-box-mask/evidence.json) records
40 actual CPU graphs,12 actual saved Final scenes,208 browser case-runs,
98,592 exact Float32 words,96 physical resize/DPR frames and144 Final lifecycle
cycles, with zero differences. Both actual WebGPU/WebGL2 APIs pass on observed
Metal and SwiftShader. Allzero/constant/default invalid extents refuse and
recover; source material/callback and actual independent baseline cache identities
are restored. Scalar-to-RGBA alpha1 is exact. The actual native carrier is Cycles
CPU; FULL/AUTO requests are recorded separately from CPU Float32 result storage.

This fresh transaction closes 125 native source inputs and 13 actual Python
prefixes at runtime fingerprint
`29a553a8c01a0541324fa23100e0ac2593dcfc66a85841a6dd58be46698a66dd`.
Native qualification hash is
`4c661947a0e865c43dcebe41a756144e53c2ece670d35dfde0511f6321cf86e0`;
Final proof hash is
`399161371048af4c718fe74d55eb414283c3b920e59eab3fd5a34f467a1484c4`.
Only Box's Blender 5.3 override changes classification. Older versions, shader
and unrelated compositor entries/counts retain their prior state; this is not a
claim that other ports were freshly recaptured. Root owns coverage regeneration.


## 2026-11-14 — Static CPU compositor Matrix family, after DAG guard correction

Combine Matrix, Transpose Matrix and Separate Matrix gain partial Blender 5.3
CPU-compositor admission for typed static copy/permutation islands terminating
in Separate Float outputs. MATRIX stays opaque inside Python; existing `value`
operations carry exact Float outputs. The source registry, three native class
IDs, evaluation entry point and actual compositor caller are explicit audit
contracts. Older versions retain their classification. Shader/EEVEE,
GPU-authored, Matrix arithmetic/fields, Quaternion and generic registered
CPU-MF support remain unqualified.

Normal finite Float32 and positive zero are admitted before scalar promotion;
stored negative-zero/subnormal controls refuse. The bounded resolver retains
source/group ancestry, literal words, selected branches, scene/frame and
ownership checks. One extraction-owned evaluation yields all 16 components
from a private one-point Geometry Nodes CPU-MF carrier. Only these reviewed
copy callbacks have same-builder equivalence, independently checked against
actual CPU compositor FULL EXR32 output.

Review held promotion when recursive tuple recipe hashing and shallow cached
source records exposed a shared-DAG cost/depth escape. Flat integer recipe
references now bound hashing work, and cached records retain complete source
hop heights including non-recipe group/reroute/selector edges. Explicit source,
record and recipe-depth limits reject over-budget graphs before evaluation.
The policy passes 8 positive invariants and 12 refusal categories, including
actual compositor RGB cache warming, reroute-only depth, broad-source cost and
independently instrumented descendant hash-work controls. The pre-correction
receipt remains historical only; no node classification was promoted from it.

The [post-fix receipt](../experiments/compositor-static-matrix/evidence.json)
freshly closes 14 native graphs, 6 actual saved Finals, 80 browser case-runs and
5,120 primary Float32 words with zero differences or contract violations. Both
actual WebGPU/WebGL2 APIs pass on Metal and SwiftShader. Separate comparisons
cover 48 resize/DPR frames; 72 Final lifecycle cycles restore source material,
callback and renderer cache identities. The source inventory is 129 inputs and
8 actual Python cache prefixes, at runtime fingerprint
`819e83b39bd016d505507cebfc1dff6c47e343669dc2d9f6126dee7d65955499`.
Native/Final hashes are
`e9ff5da0f96a0dc5231c390e9bf09a83d506b9fdd30b307457f5a68e4216b4fd` /
`eaf94b09423aebe23be39835c651b9bf7199643dcaf3671094eb8f322ada9f64`.
All unrelated port verification snapshots remain untouched. Root owns retained
coverage regeneration after the pending Box/Ellipse replays; no catalog or
coverage artifact is regenerated in this metadata change.


## 2026-11-14 — Box replay on the final budget-fixed union

The [fresh Box receipt](../experiments/compositor-box-mask/evidence.json) now
closes the final budget-fixed union source: 40 CPU graphs, 12 actual saved
Finals, 208 browser case-runs and 98,592 primary Float32 words with zero
word differences or contract violations. It also retains 96 separately compared
resize/DPR frames, 144 Final lifecycle cycles and 13 actual Python prefixes.
The source inventory is 128 inputs at runtime fingerprint
`819e83b39bd016d505507cebfc1dff6c47e343669dc2d9f6126dee7d65955499`.
Native/Final hashes are
`5900437fcbef2f21e0eb959fffbf59692a6819ad53ca14cbbcf02af5e9497b6b` /
`2e7a52bb799afe5ea73ff716bee65bd772b4c4b8ee52c404fe784c625b85332d`.

Only Box's receipt and verification lineage change. Its category/version
override, menu coverage, bounds, mathematical contract and scope text remain
unchanged. All other capability entries and proof snapshots are untouched;
this is not an all-ports freshness claim. Root owns the final retained coverage
refresh after Ellipse's separate qualification.

## 2026-11-14 — CPU Ellipse Mask with integer row bounds

The [fresh post-fix root receipt](../experiments/compositor-ellipse-mask/evidence.json)
qualifies one partial Blender5.3 CPU compositor entry for the measured macOS
arm64 build02f0899d78e3. It closes108 native graphs,16 actual saved Finals,
496 browser case-runs and235,856 primary Float32 words with zero word differences
or contract violations. Both requested actual WebGPU/WebGL2 APIs pass on Metal
and SwiftShader. Separate checks cover144 resize/DPR frames,192 Final lifecycle
cycles and17 actual Python cache prefixes. Its141-input source inventory closes
runtime fingerprint
`819e83b39bd016d505507cebfc1dff6c47e343669dc2d9f6126dee7d65955499`,
shared by the fresh Matrix and Box union replays. Native/Final hashes are
`cd6262891468348e0f054fac6fac24ea418675443357dc89fa4d695ef50775f7` /
`3beada59f6fe59a770a23128c0019c11c70b5083174f97cab9affded5a2e1659`.

The route admits fixed unlinked literals, positive-zero rotation and all four
native mask operations within the recorded bounds. Host classification preserves
the pinned worker's separate Float32 products/add/sqrt. One cached extent uses
O(width+height log width) work to produce inclusive integer row intervals; the
shader loads signed integer bounds rather than recomputing a floating boundary.
Zero Size shares scalar Mask for every operation and enters single-value
scheduling; equal-valued nonzero native masks remain fields. The native
ImageInfo scheduling research remains separate and grants no new ImageInfo edge.

Review exposed two admission issues before qualification: a copied source-kind
filter, and a memory-only64-node budget that did not bound shader samplers.
Shared class/kind/domain contracts now prevent copied family filters. Final
admission permits at most one varying64KiB row table; zero/equal-value/identity
nodes spend none. The compositor uses a closed texture-free pointwise-kind list,
excluding Render Layers/Image, curves/ramps and spatial producers. Source and
runtime presentation admission cap combined row plus display LUT lookups at8,
and extra post-LDR registrations refuse until their samplers are accounted for.
Native source policy covers actual OCIO7/8-LUT lowering; both actual browser APIs
check the last valid one-table graph and first invalid two-table graph before
resource allocation. These limit checks add no display-color numerical claim.

Fresh Final/browser proof also checks first draw, larger/smaller physical sizes,
DPR, invalid→valid recovery without cache/data/version mutation, texture lifetime,
optimized all-zero guards, source IR ownership and repeated material/callback
restoration. Isolated prototype and failed-run records remain historical; the
qualified transaction captured new native references and sources after fixes.
No EEVEE/material, native GPU-authored, linked field, animated, rotated,
other-platform, arbitrary scene-compositing or whole-scene appearance claim is
made. All nodes are not ported or polished yet.

The integrated local gates passed1,561 SDK tests with6 optional skips,98 release
policy tests,135 node-pipeline tests and8 Python audit tests. The871-file package,
Vanilla/R3F/dogfood consumers, fresh empty-cache installation and two actual
source-addon registration/connected-preview cycles passed. These checks support
this checkpoint's integration and installation; they do not extend numerical
coverage. This metadata change adds only the Ellipse5.3 override and exact proof
lineage. Older entries/versions and all other proof snapshots remain unchanged;
root owns the retained coverage refresh and spreadsheet publication.

## 2026-11-14 — CPU static Quaternion / Rotation normalization islands

The [fresh root receipt](../experiments/compositor-static-rotation/evidence.json)
qualifies two partial Blender 5.3 CPU compositor entries: Quaternion to Rotation
and Rotation to Quaternion, only as an explicit linked static chain with reviewed
Float endpoints. The transaction closes 72 native graphs, 144 independently
compared endpoint words, 12 unchanged saved Final scenes, 336 actual browser
case-runs and 21,504 primary Float32 words with zero word differences or contract
violations. Actual WebGPU and WebGL2 via WebGPURenderer both pass on measured
Apple Metal and SwiftShader. Separate checks cover 48 resize/DPR frames, 144 Final
apply/dispose cycles and 14 fresh native Python cache prefixes.

Each original Float32 component is raw positive zero or has magnitude between
2^-16 and 4. Native public-API copies preserve scalar words before Python promotion.
The unchanged native normalization callback is independently checked against CPU
compositor FULL EXR32; a private one-point Geometry Nodes CPU-MF carrier returns
all four raw endpoint words once per island. All-zero identity and signed/scaled
basis vectors have manual word goldens; non-half and mixed-minimum controls cover
ordinary normalization. Sign canonicalization is not silently introduced. Opaque
ROTATION and its native Euler-backed unlinked defaults are not runtime values.
Only literal Float defaults/Value and reviewed instance-bound groups, reroutes,
actual same-type native bypass and static Float selectors enter this route.
Computed/recombined components, Rotation selectors, implicit casts, fields,
animation, GPU-authored compositor and shader/EEVEE contexts remain refused.

The new evaluator reuses the fixed flat-ID traversal/raw-reader/ownership
infrastructure with a separate profile and cache; Matrix copy-only admission is
unchanged. Source 64 instances, 16 source/recipe depth, 2048 visits/records and 16
evaluated-island bounds apply. Cached subtree height includes non-recipe edges.
The fixed 8-node private carrier is removed in finally, preserves authored
ownership/frame/selection, and emits existing VALUE constants. No new browser
Rotation opcode, texture, pass, readback or per-frame native work is introduced.

The first root transaction's numerical phases passed but its reader caught a
Python/JavaScript Float-format-derived policy ID mismatch. That failed archive
remains retained with no completed qualification credit. Stable literal
scale-min/scale-max IDs, actual-producer AST regression and immediate native
policy validation now precede expensive references/exports; the qualified replay
captured new inputs and saved sources rather than rewriting old receipts.

The 131-input snapshot closes native/Final hashes
`8fdd0137cde54d8c727f98c0545e69d722d1f785e3e047c3c4a62ab85531ccb0` /
`bc98225e8e2552e1624a5967efc0de72481a8de3419b1d971058e66c6dcef0bf`,
at runtime fingerprint
`819e83b39bd016d505507cebfc1dff6c47e343669dc2d9f6126dee7d65955499`.
These totals are shared by the two classes. All prior capability entries,
versions and Matrix/Box/Ellipse/other-port numerical snapshots remain unchanged;
a shared runtime fingerprint is not an all-ports freshness claim. P0 priority for
the five Matrix/Quaternion infrastructure IDs reflects measured implementation
reuse, not artist-popularity evidence. Root owns retained coverage regeneration
and tracker publication.

Integrated local checks passed 1,561 SDK tests with 6 optional skips, 98 release
policy tests, 136 pipeline tests and 8 Python audit tests. The 874-file package,
fresh empty-cache install and two source-addon registration/preview cycles pass.
These integration checks grant no additional numerical or whole-scene credit.

### Integrated Euler and scene-frame transaction, 2026-11-14

The new positive literal EulerXYZ construction route uses Blender's actual CPU
callback, an opaque Rotation island and existing scalar runtime constants. A
fresh closed transaction at
`artifacts/verification-next11c-static-euler/qualified.json` records 62 native
graphs, 124 component comparisons and 124 independent pre-Float-store hash
comparisons, eight pathology calibrations, 194 tiny CPU renders, 12 unchanged
saved Final sources, 296 actual browser cases, 18,944 primary words, 48 resize
frames and 144 apply/dispose cycles across Metal and SwiftShader WebGPU/WebGL2.
Every compared word matches. Fourteen fresh Python prefixes closed. This is
partial Blender 5.3.0 build `02f0899d78e3`, macOS arm64 CPU compositor support;
Input Rotation, linked/computed Euler inputs, fields and other source profiles
remain unqualified. Original quaternion normalization keeps its separate proof.

The final source-closure check now rereads all extraction-owned static-family
caches before accepting a graph, catching a later private evaluator's handler
mutating an already-emitted earlier family. Native policy checks include these
cross-family mutations. The rebuilt Matrix regression passed 14 native graphs,
six saved Final exports and 80 browser cases/5,120 exact words. Quaternion
regression passed 72 native graphs, 12 Final exports and 336 browser cases/21,504
exact words. Their new local receipts are
`artifacts/verification-next11b-matrix-regression/qualified.json` and
`artifacts/verification-next11c-quaternion-regression/qualified.json`; historical
checked-in family receipts retain their original captured source lineages.

Proof failures are retained rather than repaired in place. The first staged
scene-frame run completed native image references but collided with its earlier
source archive directory. Its successor used separate archives and then caught
a production inner Ellipse validator discarding complete graph context; neither
run earns scene-frame qualification. Closed readers also now reject missing or
mismatched API/profile attestation and altered frame dimensions. Resource
baselines begin before direct port allocation so a leaked texture cannot become
an accepted baseline. A quaternion regression interrupted by an overlapping
root build is retained as failed; the fresh frozen `next11c` transaction above
passed. Build/artifact mutations must wait for open transactions to close.

Renderer calibration lifecycle tests cover saved original dispose functions,
texture-manager allocation-epoch resets and replacement of a still-live manager.
Certificates expire on device/context/dispose/manager changes, and retained
physical allocations are destroyed manually only when the captured original
manager lost its allocation epoch. This avoids both stranded resources and
double destruction. These lifecycle checks do not grant numerical port credit.

The scene-frame investigation separates the new linear compositor contract from
the existing display projection contract. The `next11r3` attempt found that an
exact CPU To Straight/division witness is not an exact GPU Raw-display oracle.
Pinned Blender display source instead uses reciprocal/multiply stages around
OCIO; the actual Raw OCIO processor is a no-op, but its alpha wrapper is not a
word no-op. No production identity shortcut or integer division kernel was
introduced. `raw-display-sources.json` records the exact upstream revision,
paths and hashes. The source-derived reciprocal audit retains the earlier
actual-native division witness as a diagnostic, rather than replacing its
bytes or claiming a direct C++ display-wrapper call.

`next11r4` retained an additional failed exact-zero display gate: the difference
was only 1.1754943508222875e-38 with exact alpha. Exact finite-zero display bits
exceed the existing display projection contract. The new transaction keeps
all direct and actual installed linear compositor words exact, and separately
audits display against the pre-existing clamped RGB maximum absolute error
3e-5 from the EEVEE look suite. Display word/zero differences, unclamped error
and ULP distance remain visible; they do not become zero in the receipt.
The actual installed compositor node is sampled after each Final frame by an
owned test-only quad, preserving that frame's cached ScenePass. This adds no
production pass or readback.

The `next11r5` Metal measurements pass both browser APIs: 32 saved-Final cases,
37,440 direct and 224,640 installed linear words with zero differences, plus
96 installation/disposal cycles. Raw display has 11,838 differing words across
its repeated audits, including 10,530 finite-zero differences; maximum absolute
error is 7.450580596923828e-9. Maximum ULP distance is 8,388,608 because of the
tiny finite/zero cases, not a bit-exact display result. The software WebGPU
phase refuses its HalfFloat decoder because NaN/sign/encoding words differ
from the declared model. A positive Metal result is not software coverage.

The final optional-full-graph Ellipse ABI also passes the fresh standalone
regression at `artifacts/verification-next11d-ellipse-regression/qualified.json`:
108 native graphs, 16 Final exports, 496 browser cases, 235,856 primary exact
words, 144 resize frames and 192 lifecycle cycles. Packaging at that build
contains 886 files, 2,717,586 packed and 12,291,523 unpacked bytes; independent
Vanilla/R3F tarball consumers and the package-identity check pass. Focused
mask/frame tests pass 26 cases with one optional native skip. These are local
validation records, not a release or an all-ports freshness claim.


### Exact current-frame Ellipse composition and decoder admission, 2026-11-14

The fresh closed admission transaction at
`artifacts/verification-next11r5-scene-mix/qualified-admission.json` qualifies a
bounded artist workflow: one direct current-scene/view-layer Image or Alpha,
one static binary Add Ellipse0/1 and one modern Color/MIX with an unlinked raw
positive-zero/normal≤1 RGBA background. Either Mix operand side is covered.
The current HalfFloat/MSAA0 physical frame is renderer-owned, with no extra
registered effects and a frame1 + row1 + display≤6 sampler budget. Native
source remains the unchanged RenderLayers graph; actual Three frame words
enter a separate owned CPU Image oracle. This proves composition of the same
Three frame, not Three PBR versus Cycles or original-demo acceptance.

Eight saved Final sources and64 captured CPU image oracles/192 actual renders
close10 fresh Python prefixes. The32 credited Metal WebGPU/WebGL2 cases
compare37,440 direct and224,640 actual installed-Final pre-display F32 words
exactly, with zero differences and96 apply/dispose cycles. Test-only sampling
of the installed private compositor node retains its real current ScenePass;
no product node or pixels are patched. Source materials/callbacks and the
independent pre-port texture identities are preserved.

Both SwiftShader APIs explicitly refuse the admitted HalfFloat NaN decoder
model: raw half0x7c01 becomes F32 0x7f802000 rather than0x7fc00000. The separate
negative archive attests each actual API/profile and closes prior-state, prior-
pixel and texture cleanup controls. These tuples receive zero numerical or
support credit for scene-frame composition. Existing standalone integer-row
Ellipse support on SwiftShader retains its separate historical proof.

Display precision remains separate. Primary pinned Blender5.3 CPU display
source uses a rounded reciprocal/multiply wrapper, unlike the initial synthetic
ToStraight component-division witness. The corrected source-derived witness
calls the actual asserted-identity OCIO CPU processor but is not a direct call
to Blender's C++/GPU display wrapper. The repeated Raw audit records11,838 word
differences,10,530 finite-zero differences, maximum8,388,608 ULP and maximum
absolute/clamped error7.450580596923828e-9, under the pre-existing clamped
OCIO/PNG3e-5 display projection contract. Alpha and nonfinite classes match.
No bit-exact or zero-bit Final display claim or global display promotion is
made, and every linear compositor word stays exact. The old strict r3 display
failure and r4 finite-underflow restriction failure remain retained.

One-time renderer/device/context/manager-epoch calibration owns temporary
resources and restores borrowed state before awaiting readback. It does not
read pixels per frame. The qualified run observed7ms/16.4ms Metal WebGPU/WebGL2
calibration after an independent scene baseline with warm driver caches, at
4MiB nominal transient storage; this is not rendering or export latency. The
row table remains64KiB. Saved-original disposal, manager resets/replacement,
map failure, cancellation and double-destroy controls close separately.

Earlier failed transactions remain intact: shared-stage archive collision;
inner Ellipse validation losing full-graph context; synthetic exact Raw display
rounding; then an overly strict finite-zero display audit. No receipt was
patched to pass. The closed evidence is checked in separately at
`experiments/compositor-ellipse-scene-mix/evidence.json`. Capability updates
append this workflow only to Ellipse and modern compositor Mix; old categories,
versions, standalone counts and receipts are preserved. All-node porting is
still unfinished.

### Portable exact scene masks and Vertex Color Alpha, 2026-11-14

The source-preserving full scene-mask transactions close at
`artifacts/verification-next13-ellipse-scene/qualified.json` and
`artifacts/verification-next13-box-scene/qualified.json`. Ellipse records 64
browser Final cases, 74,880 direct and 449,280 actual-installed linear words;
Box records 104 cases, 121,680 direct and 730,080 installed linear words. All
linear words match exactly across actual Metal/SwiftShader WebGPU/WebGL2. Box
adds no row texture and reserves one frame plus at most seven display lookups.
Zero-size Box remains a full-frame field. Existing generic Box graphs retain
their older partial contracts; malformed explicit exact markers refuse.

SwiftShader is admitted by a second complete decoder model after independent
research replayed 9,437,184 native CPU/browser words, including 294,624 quieted
NaN payload words, with zero differences. The model preserves sign, fraction
and signaling/quiet bit in Half-to-Float decoding. Calibration matches one
whole table and orientation; mixed/unknown mappings still refuse. The old
canonical-only Metal receipt and both historical software refusals are retained
verbatim. No binary arithmetic kernel changed. Source snapshots in these
receipts precede the later malformed-spatial diagnostic correction; they are
not a claim that all ports were refreshed at the current checkout.

Vertex Color Alpha closes at
`artifacts/verification-next14r6-vertex-alpha-union/qualified.json`: eight
source graphs, 24 EEVEE gold frames, eight unchanged saved Final sources, 64
raw/Final browser cases, 1,048,576 primary words, 192 resize frames and 192
installation/disposal cycles, across both APIs on Metal and SwiftShader. Raw
Float32 source-to-scalar transport and indexed source-corner associations are
exact. Field RGB uses the predeclared 2^-10 absolute gate against actual native
EEVEE half-film output: maximum error 0.00048828125, zero violations, exact
alpha-one output. Its 574,488 differing RGB words are explicitly reported, not
called bit-exact field output. Ten actual Python prefixes closed.

The new private scalar survives authored normal Meshopt optimization. Actual
decoded post-optimization owner/material/corner digests must match the source.
Only declared Alpha semantics bypass generic quantization; POSITION protection
is an explicit asset-wide fallback with a one-million unique-position budget
and three-million checked-corner budget. Ordinary normal, color and UV policies
are preserved. Per-draw validation checks immutable attribute/index/schema
versions and empty primitive groups in constant time. Large unrelated IR
payloads do not acquire new traversal-budget refusals.

Initial scope is static FLOAT_COLOR POINT/CORNER on the pinned Blender 5.3
macOS-arm64 EEVEE Metal source profile. BYTE_COLOR, deformation, instances,
clocks, source signed zero/subnormals/HDR and ambiguous coincident triangles
remain unqualified. Explicit Alpha programs with non-unit or unknown physical
COLOR_0 alpha refuse before publication/mutation, avoiding double opacity.
The default exporter's fake white COLOR_0 has exact unit alpha and is safe.
The scoped ownership adapter remains a separate research/implementation lane.

Retained Alpha failures distinguish fixture problems from numerical ports:
an interpolated world-position orientation control was replaced by an exact
fragment-coordinate control; raw stock selection now includes the authored
camera; favicon/HTTP requests remain checked; and a SwiftShader seam sample
selected a different source material than native EEVEE. Independent flat
owner/material ID draws proved the latter before any Alpha evaluation. The
new dyadic rectangle guarantees at least half a physical pixel of seam
clearance for every tested size/owner, with unchanged Alpha inputs, camera,
all-pixel/edge/seam gates and no repaired outputs. Arbitrary cross-engine edge
coverage is not credited. Browser-only diagnostics use a separate fresh
namespace and cannot publish a qualification pass token; original failures
and references remain intact. Shared parsed preflight now includes both
Euler and Alpha schemas and rejects status drift before native startup.

### Named Attribute Alpha and shared proof variants, 2026-11-14

Named GEOMETRY Attribute Alpha now reuses the qualified FLOAT_COLOR scalar
carrier and browser operation. The first scope requires an explicit present
POINT/CORNER layer on the same bounded static surface Mesh and pinned EEVEE
source profile. Exact lowercase `temperature` refuses: Blender replaces its
Attribute alpha with one. The reserved `color` name is admitted only under
the surface-Mesh contract; its EEVEE volume callback has different behavior.
Independent sibling-node research retained that distinction and measured
81,920 matching native words plus the expected temperature counterexample.

The full transaction is
`artifacts/verification-next15-attribute-alpha/qualified.json`: nine native
graphs, 27 EEVEE field frames plus the independent ramp, nine saved Final
sources, 72 browser cases and 1,179,648 primary words across actual Metal and
SwiftShader WebGPU/WebGL2. Raw scalar and indexed source associations remain
exact through authored normal Meshopt optimization. Rendered RGB uses the
declared EEVEE half-film comparison: 667,434 differing words, maximum absolute
error 0.00048828125, zero 2^-10 gate violations and zero alpha-one mismatches.
The transaction includes 216 resize frames, 216 install/dispose cycles and
12 fresh Python prefixes. Runtime snapshot
`ebd0ac5c9e4fe79571cb1655519ca61008e2ca1a9562f40ae3f29a4eb3e3a855`
and reader `04d2f670ec4dc05706c3012b3b316342df591db62022a6d0d04771264a567407`
identify this evidence; subsequent wording edits do not relabel it.

The shared harness keeps the original eight-scene Vertex Color default and
selects the nine-scene Attribute family explicitly. Source programs must retain
the named field leaf, and the closed reader checks the family-specific source,
policy, Final, browser and ownership census. Only Attribute's Blender 5.3
override expands; base and legacy scopes, categories and enum records remain
unchanged. This is a field port, without explicit-opacity or whole-material
appearance credit. The separately certified opacity adapter is undergoing its
own installed-diffuse proof.

The combined SDK passes 1,620 unit tests and 98 release-policy checks, 138
pipeline tests and eight Python coverage checks. Actual guarded source-addon
registration/preview and both Alpha source policies pass on the union. The
897-file tarball builds independent Vanilla and React Three Fiber consumers;
the empty-dependency fresh-install check verifies archive integrity, root
import and browser compilation. Package checks run after the build finishes,
because asset copying replaces the bundled add-on tree during a build.

### Certified opacity and a new compositor White Noise context, 2026-11-14

The scoped opacity adapter closes independently at
`artifacts/verification-next17r4-opacity-union/qualified.json`: four unchanged
saved artist scenes, 48 actual Final installation cycles and 288 synthetic
Standard/Physical controls on Metal/SwiftShader WebGPU/WebGL2. All 344,064
diffuse RGBA words match exactly. Actual material and source-keyed mesh tags
must agree with the original complete RGB/Alpha channels and physical scalar
binding before a mesh-bound certificate is minted. Only that certificate
selects the scoped class; old untagged programs retain the earlier refusal.
The complete RGB program owns color once and explicit Alpha owns opacity
once. The native alpha-test/hash/opaque stages remain in Three's setup.

Every measured Final sample retained two source draws and two installed draws
(48 samples, delta zero); the synthetic FrontSide controls used one draw.
This does not claim one-pass transparent Final rendering. The adapter adds no
texture, pass, readback or per-draw buffer scan. Source material/map properties
and callbacks, renderer texture identities, and clone-local graph/cache state
are restored. Ordinary application cloning/copying now preserves the private
ownership flag, with no opt-in from lookalike public carrier properties.

Earlier failed fixtures remain separate: unblendable Float32 source warmup
and an auto-reset draw meter, then an expected texture RGB value that omitted
the already-qualified EEVEE float data-image unassociation. The unchanged
authored [1,0,1,0.125] input independently derives RGB [8,0,8]; all published
texels and its storage/profile stages are checked before browser execution.
The r3 closure predates the clone polish; r4 carries its own runtime snapshot
`7b1700db87eb6a68335d7fb1eb5605e5d08bc4e45a2361cda9473783d1555472`.
There is no native transparency, dither or whole-BSDF parity credit, and the
actual fixture has zero external image assets.

CPU compositor White Noise closes at
`artifacts/verification-next18-white-noise-union/qualified.json`: 44 native
graphs, 12 unchanged saved Final sources, 224 raw/Final browser cases, 14,336
primary words, zero differences, 48 resize frames, 144 lifecycle cycles and
14 fresh Python prefixes. 1D–4D Value/Color reuse the existing Jenkins shader
hash arithmetic with a separate CPU source model. Inputs require original
stored normal Float32/+0 words and explicit fixed typed bindings; native
negative zero/subnormal witnesses are retained but refused before promotion.
Private homogeneous socket storage is removed in finally. No native MF/hash
folding or new port texture/pass/readback is introduced. The independent
native Image Info 0×0 observation is a control, without a new Image Info port.
Default implicit Uniform coordinates, computed/field seeds and GPU-authored
sources remain unqualified. Only the new Blender 5.3 compositor override
changes category: 46 supported, 130 partial, 142 unsupported, 14 structural.

### Mono Switch View and World classification corrections, 2026-11-14

Mono CPU Switch View closes at
`artifacts/verification-next20r4-mono-view/closed-receipt.json`. The eight native
and saved Final scenes comprise seven Switch View graphs and one independent
calibration. Across actual Metal/SwiftShader WebGPU/WebGL2, 64 raw/Final cases
compare 16,384 words with zero differences; the node-only subset is 56 cases
and 14,336 words. Ten fresh Python prefixes close. Native input0 is selected
under the pinned static current-scene mono CPU context, including disabled or
renamed views, groups/reroutes and an inactive Scene Time branch. The selected
constant/image/reference domain survives without a new runtime opcode. The
Render Layers-to-Image Info case uses its existing INT_VECTOR2 conversion;
single-value Image Info remains unqualified.

The failed EXR fixture, uninitialized GPU metadata query and noisy Cycles
calibration remain separate. The replacement varying field uses an already
admitted packed PNG; its actual normalized source pixels are pinned. CPU-only
metadata explicitly claims no initialized/evaluating native GPU. A diagnostic
namespace recorded the original Cycles denoising/adaptive settings, proved an
exact declared compositor-constant calibration and checked all eight raw cases
on both Metal APIs with zero qualification credit before the fresh r4 matrix.
The original selector family's 71-case/30-Final, three-context corpus and
receipt remain unchanged. Only Switch View's Blender 5.3 context gains partial
support: totals are now 46 supported, 131 partial, 141 unsupported and 14
structural; legacy categories and enums are preserved.

The existing constant World classifier now omits a selected linked Volume and
uses Blender's own engine-target World Output selection, including ALL
fallback. The global active-output RNA flag can select a Cycles output while
EEVEE uses another output in the same tree. Actual guarded no-render controls
cover matching/wrong/mixed targets, Volume and explicit website ownership.
Unknown shader engines conservatively omit this evidence. These corrections
do not yet promote Background or World Output or claim full environment/BSDF
parity; their separate background-only qualification is in progress.

The updated package passes 1,625 unit tests and 98 release-policy checks.
Independent Vanilla and React Three Fiber consumers compile its 906-file
tarball. Evidence remains tied to each recorded source/runtime snapshot,
rather than claiming all retained ports were numerically refreshed together.

The launcher now canonicalizes its owned directory before writing identities
or configuration, avoiding false archive escapes through macOS /tmp aliases.
Alias/canonical archive validation still rejects real child escapes, changed
bytes and substituted links. Nine focused host tests pass; an actual guarded
Blender World-policy invocation through an aliased parent also closes with
one fresh prefix and zero numerical credit. The expanded pipeline passes 140
Node tests plus eight Python coverage tests; the fresh package-install and
six tracker checks pass.

Field research exposed a separate SwiftShader wide-uint-to-Float32 rounding
difference after coordinate and integer hash words matched exactly. Both
SwiftShader APIs reproduce it with a dynamic unsigned uniform. Literal
conversion and the actual fixed-input compositor route with the exact failed
seed pair pass on all four backend/profile tuples, and native CPU matches
that fixed seed. The admitted fixed-input scope is unchanged; fields remain
unqualified. An explicit ties-to-even integer-rounding construction matches
all 4,294,967,296 uint32 inputs in an exhaustive CPU experiment without
changing rounding mode. This is mathematical/backend preparation, not a
new shader, node or field qualification. Original failures and generated
shader/source hashes remain under the field-research evidence.

### Constant World background qualification and shared source guards, 2026-11-14

The constant World background route closes in
`artifacts/verification-next24r4-constant-world/qualified.json`. Five native
graphs produce 15 reference frames, and seven actual saved Finals include
Film Transparent and website-owned background controls. Across all four
Metal/SwiftShader WebGPU/WebGL2 tuples, 180 linear/Final frame pairs and
60 installation cycles compare 393,408 browser words. All declared bounds
pass; general colors are not word-exact (maximum linear error
0.00019532442092895508). Alpha, black and declared dyadic cases are exact.
This qualifies visible constant backgrounds, without IBL, HDRI or full BSDF
parity. The owned six-face constant cube avoids the upstream equirectangular
background conversion's orphaned depth target. Each helper retains the
existing 32 KiB environment source and adds 96 logical GPU bytes of cube
pixels; physical allocation size is not claimed. Cleanup and application
ownership controls pass. Failed transactions and diagnostic receipts remain
separate. Background and World Output gain only Blender 5.3 partial support:
46 supported, 133 partial, 139 unsupported and 14 structural contexts.

Shared compositor group-interface checks now reject implicit field defaults
that would otherwise be substituted with literals. Contributing interface
and recorded selector/string policies are rechecked after source evaluation.
Native no-render controls cover 27 admitted and 17 refused group cases;
these are source-policy controls, not numerical or new-node credit. The
fixed-input White Noise qualification remains separate from default-field
research, and its stricter group-interface controls are retained.

The White Noise and mono Switch View node-port manifests have each completed
an actual stable end-to-end matrix. Their archived reports retain their own
source snapshots and explicitly disable automatic support promotion. The
pipeline now runs 155 Node checks and 11 Python audit checks. Current package
validation passes 1,626 unit tests, 98 release-policy checks, and independent
Vanilla/React Three Fiber consumer compilation from the 911-file tarball.
Default-coordinate White Noise remains an isolated candidate pending review
and full production qualification; experimental exact hashes do not grant
field support.
