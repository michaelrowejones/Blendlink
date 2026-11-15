# Maintaining Blender node ports

The porting pipeline automates change detection, focused native discovery,
work packets and repeatable verification. It does not promote a generated
scaffold or an unqualified Blender build to supported status.

EEVEE remains the reference for live shading. Compositor CPU/GPU execution is
an independent contract. Cycles generally uses deliberate baking; an automatic
engine switch still needs evidence that it preserves the channel.

New port development now focuses on Blender **5.3.0** first. Qualify a bounded
5.3 implementation before optional backports; preserve existing older-version
contracts and run their regressions when shared code changes. The
[node tracker refresh](NODE_TRACKER_REFRESH.md) keeps priorities and the Google
Sheet aligned with audited coverage rather than unpromoted research.

Current development uses local verification and ordinary checkpoint pushes,
without pull requests or hosted workflow dispatch. The
[batch worklog](NODE_PORT_WORKLOG.md) records the branch, investigation budgets
and reusable bottlenecks. This temporary working policy does not weaken the
native/Final/browser evidence required for support claims.

Compile-time forwarding ports declare `compileTime` with an actual compiler
function, its native-node constant set, and the relevant call sites. They keep
`runtimeOps` empty because they forward existing expressions. The coverage audit
checks those compiler references instead of requiring an invented GPU opcode.
Live classifications in version overrides require the same evidence as base
classifications. This route metadata describes implementation, not qualification;
native, saved Final and actual browser proofs still determine the supported slice.

## Runtime strategy selection

Use automation for native source/dependency discovery, structural contracts,
reference generation and shared proof transport. Choose the runtime separately
per output, static mode, source precision profile and actual backend. Preserve
the current qualified implementation until a replacement passes independent
correctness and its declared performance budget on the same workload.

The [canonical bridge](../experiments/shader-kernel-bridge-next/README.md) provides
a fast implementation/reference starting point for pure shader functions, not
a universal runtime replacement. The paired Noise/Voronoi experiment found
generic native wrappers slower than the existing TSL. Output selection improved
them but retained regressions. Request only live outputs (Noise exposes an
actual `compute_color` flag), specialize proven static modes and deduplicate
common helpers before considering manual arithmetic changes. Keep every generic
baseline and failed numeric result unchanged.

Full-color Noise and dependent graphs require a separate contract from Fac-only
Noise. Tiny differences in source-static offsets can amplify downstream. Use
the [staged diagnostic](../experiments/noise-offset-fma-diagnostic/README.md)
before writing another hash/RNE/FMA primitive. Proven fixed helper inputs may
use [source-pinned observation tables](../experiments/native-shader-constant-table-pilot/README.md)
as an experiment; those six observations do not qualify a general constant folder.

## Workflow

1. **Discover upstream.** Resolve an official daily archive, its checksum, and
   its full source commit/tree. Acquire a matching native binary and verify its
   actual version/build identity.
2. **Detect impact.** Compare native catalogs and source snapshots. Track node
   implementations, shader symbols, quoted includes, shared routing, image
   storage/backend code, build settings and declared out-of-line dependencies.
   New unprobed builds and unresolved shared changes require requalification.
3. **Create work.** Produce a digest-linked queue and `TASK.md` packets. Actual
   node creation determines shader/compositor availability; registration strings
   are discovery candidates. Source-only scans cannot infer node removals.
4. **Probe and implement.** Generate a focused probe from the same authoritative
   collector used by the full inventory. Review native evaluation stages,
   storage, undefined controls and enforceable input limits before writing the
   adapter. Focused schemas always grant zero numerical credit.
5. **Verify.** Run the declared port transaction: build, native references,
   actual Final artifacts, production browser builder, both requested APIs,
   refusal and ownership checks. Record inputs, actual identities, logs and a
   result. Update capability claims after the evidence is reviewed.

The execution registry includes **Squeeze**, bounded **Float to Integer**,
fixed/default-field **White Noise**, **mono Switch View**, and CPU **Wave axis**
transactions. Each adapter owns its source identity, native receipts, actual
saved Final sources and browser census. These are separately qualified slices,
not complete node or cross-backend coverage. Float to Integer records its CPU-MF
evaluator explicitly, including single values in GPU-authored compositing;
this does not qualify native GPU numerical execution. Unknown adapters refuse.

Native implementation and actual fixture dependencies are pinned separately.
Editing an unrelated add-on test does not invalidate the Float to Integer
transaction; editing its shared oracle does. Runtime source fingerprints remain
strict. Prefer immutable worktrees for concurrent implementation so builders and
proofs cannot overwrite one another's source or distribution files.

Pair each port's numerical proof with the [performance protocol](NODE_PORT_PERFORMANCE.md):
bounded structural analysis, actual scene coverage, observed browser timings,
and repeated install/dispose checks. These remain separate evidence; neither a
small graph nor a fast fallback carrier qualifies a port's source appearance.

## Catch fixture errors before expensive proof

Choose an existing reference surface before constructing another fixture:

| Evaluated behavior | Reusable starting point | What it does not establish |
| --- | --- | --- |
| Pure native shader function, exact Float32 storage | [Direct native GPU oracle](../experiments/native-f32-oracle-research/README.md), [Radial integration](../experiments/radial-f32-oracle/README.md) | Python GPU/create-info differs from EEVEE material context; retain a smaller actual-material crosscheck |
| Native CPU single values / constant islands | `packages/blendlink/blender/compositor_static_matrix.py` and existing typed constructor families | Varying fields, hidden coordinates and time dependencies are not constant folding |
| Actual installed scene, scheduling and cleanup | [Early Final canary](../experiments/port-speed-pilot/README.md) | A retained scene check is not a fresh export or full family qualification |
| Structural packets and case inventories | [Generated contracts](../experiments/operator-contract-pilot/README.md) | Existing semantic and independent numerical gates remain authoritative |

Blender 5.3's `gpu.init()` supports background direct `RGBA32F` capture. Reuse
the calibrated framebuffer surface for pure-kernel regression instead of
encoding every kernel output through half-float EEVEE film. Direct shader
capture preserves more information but has a different source/compiler context.
Actual EEVEE material checks still cover node defaults, conversions, geometry,
fusion and transport; calibrated carriers remain appropriate when that specific
material Float32 claim is needed. Do not relabel a direct-kernel capture as an
EEVEE node or full-scene proof.

For mechanically imported libraries, the [compiler bridge](../experiments/shader-kernel-bridge-pilot/README.md)
and [incremental update planner](../experiments/shader-update-plan-pilot/README.md)
are experimental starting points. Reuse canonical dependency metadata and
shared tool identities; a changed compiler invalidates every dependent family.
These experiments grant no automatic support and do not replace closed readers.

Run `npm run test:node-pipeline` before native/browser jobs. Its explicit
protocol variants run in separate Node processes so import-time mode caches
cannot make one variant accidentally exercise another.

Start with actual no-render RNA controls. Use the retained native catalog to
check socket/menu/precision names, then exercise the real stored defaults and
refusals with a fresh guarded Python prefix. Guard render/GPU entry points when
claiming a no-render policy. Host mocks alone do not establish Blender's schema.

Validate every captured native program's hash and semantic schema before Final
export, then validate actual exported program schemas before browser work.
JSON member order is not part of that schema: compare exact key sets and reject
missing/extra fields. The Wave capture/export stages implement this ordering.
Independent closing readers must still repeat the complete checks.

Select and inspect the actual browser profile before a large matrix. On the
pinned current macOS setup, the established Metal runners set
`BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium`; the default Playwright headless shell
can expose SwiftShader. Software runs explicitly select SwiftShader and clear
that channel override. Requested flags never substitute for observed adapter/API
identity. Preserve a mismatched run as failed and use a fresh namespace.

Keep GPU jobs serial. Independent CPU-only source policies can run concurrently
when each owns its native launcher, import prefix, source snapshot and outputs,
and demonstrates that it does not initialize a GPU or render. Freeze each
candidate's inputs before numerical capture; merge shared-owner changes in
batches and run affected family regressions on the union.

## Commands

Use Node 24 and the locked repository dependencies. These are maintainer tools.

```sh
npm run nodes:discover-build -- --output artifacts/node-pipeline/discovery.json

npm run nodes:snapshot -- \
  --source-dir /path/to/reviewed/blender-source \
  --catalog docs/node-coverage/blender-5.3.0.json \
  --output artifacts/node-pipeline/baseline.json

npm run nodes:diff -- \
  --before artifacts/node-pipeline/baseline.json \
  --after artifacts/node-pipeline/candidate.json \
  --ports-dir node-ports \
  --output artifacts/node-pipeline/queue.json \
  --packet-dir artifacts/node-pipeline/tasks

npm run nodes:scaffold -- \
  --queue artifacts/node-pipeline/queue.json \
  --work-item artifacts/node-pipeline/tasks/ITEM_ID/work-item.json \
  --output artifacts/node-pipeline/candidates/ITEM_ID

npm run nodes:verify -- squeeze --profile mac-52 \
  --blender /absolute/path/to/Blender --dry-run

npm run nodes:verify -- squeeze --profile mac-52 \
  --blender /absolute/path/to/Blender \
  --evidence artifacts/verification-node-port-squeeze

npm run nodes:verify -- float-to-int --profile mac-53 \
  --blender /absolute/path/to/Blender \
  --evidence artifacts/node-ports/float-to-int/fresh-transaction
```

The scaffold's `native-schema.py` requires `BLENDLINK_NODE_PORT_REPOSITORY` to
point to this reviewed checkout. Run it in a separate factory Blender process.
It explores actual root/group creation and reachable enum states, retains
refusals, and labels its output partial and `needsOracle`. The full-inventory
detector refuses to treat that partial output as a complete catalog.

The source snapshot checks actual Git HEAD, tracked bytes and source cleanliness.
It refuses stale digests, mismatched native catalogs and incomplete checkouts.
Keep the source checkout separate from the SceneToWeb working tree. The
generated upstream caches and work packets under `artifacts` are ignored.

## Manifest and evidence contract

`node-ports/*.json` declares the native class/context, lifecycle, direct/shared
upstream dependencies, native/runtime/SDK/test inputs, bounded argv commands,
actual source profiles and an evidence adapter. Manifests are validated before
they can select verification work. Unknown or malformed declarations refuse.

Dry-run launches no Blender process and does not hash its executable. A real
transaction records a request fingerprint, then adds the observed native and
browser identities to its evidence fingerprint. Unknown identity stays unknown.
Input changes during verification invalidate the result.

Results distinguish `qualified`, `not-applicable`, `refused` and `failed`.
Exit 0 means qualified or dry-run; exit 2 means N/A/refused; exit 1 means failure.
A successful process exit, a control-only report or zero-case N/A packet cannot
qualify a numerical port. Failures retain their logs and partial evidence.

Version 1 never skips a numerical proof using a previous result. Archive caches
are rehashed before use. Native references may be reused within one transaction
for another browser adapter only when their exact pins still validate.

## Upstream watch

The read-only daily/manual workflow discovers official builds from
[Blender's daily-build feed](https://builder.blender.org/download/daily/?format=json&v=1),
captures matching source/native inventories and uploads queues, probes and logs.
New builds remain unqualified until their port evidence passes. The scheduled
workflow becomes active after it lands on the repository's default branch.

It does not publish packages, merge code, or send messages. Agent-authored code
can consume the generated packets as a later layer; semantic math changes and
support promotion remain reviewed decisions.

## Verification of the tooling

```sh
npm run test:node-pipeline
```

Linux acquisition tests need Python's safe tar data filter (Python 3.12 or a
patched 3.11). On this Mac, tests can select Blender's bundled Python with
`BLENDLINK_TEST_PYTHON`; the scheduled Ubuntu runner supplies a suitable Python.

The pipeline has been exercised against actual Blender 5.2/5.3 source catalogs,
focused Blender 4.2/5.2/5.3 probes, and a full Squeeze transaction on the measured
macOS profile. The composed Linux observer also passed against the official Blender 5.4 alpha
build: 5,153 watched source files, 145 shader/192 compositor types, 167 review
items and 166 scaffolds. The [verification receipt](node-pipeline/verification-receipt.json)
records the archive digest and independently recomputed queue. Its numerical
porting credit is zero; observation success is distinct from node qualification.

After a reviewed port, update classifications without requiring old Blender
binaries to be downloaded again:

```sh
python3 scripts/audit-node-coverage.py --reclassify-retained --check
node scripts/export-node-tracker.mjs --output /tmp/scenetoweb-node-tracker.json
```

This mode requires content-pinned full native catalogs and unchanged reviewed
baselines. It rejects modified or focused catalogs, retains the native inventory
audit date, and records a separate classification timestamp. It performs no
native rediscovery and grants no numerical qualification by itself.

## Field-port fixture preflight

Separate source-to-runtime data transport, node evaluation, material channel
ownership and display projection contracts before recording pixels. An exact
Float32 carrier does not imply bit-exact native half-film output or native
transparency/BSDF equivalence. Test the actual optimizer and actual installed
material/pipeline, including shared owners and material splits.

Before a full capture, verify independent readback orientation, actual exported
camera presence and all HTTP assets. Use a data favicon rather than ignoring
console errors. For discontinuous fields, declare sample-to-edge clearance
independently of observed Alpha/color values; preserve all pixel and seam-band
comparisons. A flat material/owner ID draw can distinguish raster ownership
from node arithmetic without fitting the node's output.

Reuse valid native/Final inputs only while their complete pinned input census
remains unchanged. Browser-only diagnostics must use fresh output namespaces,
retain failed artifacts and have no qualification pass status or numerical
credit. Shared assembly/status preflight runs before Blender starts. Keep
unrelated IR payload admission and named refusal diagnostics unchanged when
adding new graph scans or source-family markers.
