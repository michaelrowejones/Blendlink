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

The first execution adapter is **Squeeze**. Other nodes can have dependency and
research manifests; unsupported execution adapters refuse. Expanding this
registry is the next step toward a common workflow for every port.

Pair each port's numerical proof with the [performance protocol](NODE_PORT_PERFORMANCE.md):
bounded structural analysis, actual scene coverage, observed browser timings,
and repeated install/dispose checks. These remain separate evidence; neither a
small graph nor a fast fallback carrier qualifies a port's source appearance.

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
```

The scaffold's `native-schema.py` requires `BLENDLINK_NODE_PORT_REPOSITORY` to
point to this reviewed checkout. Run it in a separate factory Blender process.
It explores actual root/group creation and reachable enum states, retains
refusals, and labels its output partial and `needsOracle`. The full-inventory
detector refuses to treat that partial output as a complete catalog.

The source snapshot checks actual Git HEAD, tracked bytes and source cleanliness.
It refuses stale digests, mismatched native catalogs and incomplete checkouts.
Keep the source checkout separate from the Blendlink working tree. The
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
