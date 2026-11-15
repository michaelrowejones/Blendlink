# Operator structural-contract and transport pilot

**Experiment only. No production migration, new qualification or support promotion.** Base: `61df48b64b09f27d1cbf2cf0d13e9c568e839934`. All changes stay in this folder; existing SDK, protocols, native references, manifests and historical receipts remain unchanged.

## Result

One reviewed descriptor generates Python and TypeScript structural codecs and case counts for two existing families. Both codecs accept **37 actual archived native programs**, reject the same **32 targeted structural mutations**, and round-trip accepted JSON without changing its values. The shared transport rehashes the exact original program/raw files, invokes the unchanged family-specific semantic program validator, and compares **9,472 historical native words** against the existing independently authored `expectedWords` tables. This replays retained inputs; it is not a fresh native/browser qualification.

| Derived case census | Int3 | Finite ImageInfo |
|---|---:|---:|
| Native graphs / production | 16 / 15 | 21 / 20 |
| Saved Final graphs / production | 8 / 7 | 8 / 7 |
| Planned primary browser runs / production | 96 / 88 | 116 / 108 |
| Planned primary words / production | 24,576 / 22,528 | 29,696 / 27,648 |
| Planned all-read words / captures | 57,344 / 224 | 67,584 / 264 |

Browser counts are **generated plans**, not newly executed browser results. Each plan includes one calibration graph. Historical inputs come from the original Int3 next54 automatic capture and finite ImageInfo Metal pilot; `fixtures/manifest.json` retains the source qualification paths/hashes and individual copied artifact hashes. The finite pilot had no Final/software/support credit; this experiment does not add any.

## Files and correspondence

- `descriptor.mjs`: handwritten reviewed vocabulary. Shared records describe node source identity, native profile/version, typed widths, required/extra fields and bounded structural shapes. It contains no pixel equations or generated golden values.
- `generate.mjs`: derives counts directly from the unchanged existing case JSON files and emits `generated/contracts.ts`, `contracts.py`, and `counts.json`. Descriptor and case-file hashes expose stale generation.
- `runtime.ts` / `runtime.py`: shared structural engines per language, reused across both families. Strict Int32 values reject Boolean, fractional, overflow, wrong width and negative zero. Serialization validates first; it does not repair data.
- `transport.mjs`: one owned-file/hash/census/raw-word replay path for both families. The numerical comparison reads the original predeclared expected-word tables; it imports no candidate kernel or conversion arithmetic.
- `correspondence.mjs`: narrow hooks to **unchanged** `assertIntegerVectorProgram` and `assertFiniteImageInfoProgram` in `experiments/static-switch-family/protocol.mjs`. These preserve semantic typed-edge/topology checks; structural codecs do not replace them.
- `pilot.test.mjs`: nine CPU tests, including both-codec acceptance/refusal, exact independent census, legacy validator correspondence, missing/duplicate rows, hash tamper, a wrong native word even after its hash is updated, symlink escape, descriptor/case-plan drift and deterministic regeneration. A dangling typed edge deliberately passes structural decoding but fails the retained semantic policy, including through shared transport.

## Reproduce

Run with Node 24 and Python 3, without Blender or a GPU:

```sh
node experiments/operator-contract-pilot/generate.mjs
node --test experiments/operator-contract-pilot/pilot.test.mjs
node experiments/operator-contract-pilot/replay.mjs
node experiments/operator-contract-pilot/measure.mjs
```

Nine tests passed. `measurements.json` records source hashes, generated/handwritten file sizes and seven CPU timing samples. At this host run: median TS structural decoding of 37 programs **2.16 ms**; Python decoding/encoding including process startup **25.11 ms**; shared pinned replay including I/O, both structural/semantic policies and native word comparison **9.98 ms**. These are CPU replay timings, not shader, rendering, full qualification or developer-productivity measurements.

The executable pilot has **260 handwritten physical lines** including descriptors, both generic engines, generator, transport, adapters, tests and measurement tools, versus **50 generated physical lines** including the count JSON. Generated schema literals are intentionally compact; the byte counts in `measurements.json` make that formatting explicit. This is not a claim of net LOC reduction: existing implementations remain, and two small families do not amortize the new generic machinery. Future families reuse the engines/transport and add a descriptor plus semantic hook; actual development-time savings still need measurement.

## Boundaries

This proves a mechanism for sharing **structural contract and evidence plumbing**, not a universal semantic compiler. RNA alone did not produce the descriptor: native profile constants and allowed shapes were reviewed against existing source/runtime policy. Cross-field type/domain relationships, source revalidation, finite producer identity, payload decoding/deduplication, renderer lifecycle, actual backend identity and numeric precision remain in existing production/qualification layers. The pilot does not emit exhaustive static TS union types or replace the authoritative closed readers.

No native oracle arithmetic was changed or generated from the candidate. Exact current numerical gates and historical receipt bytes remain intact. No numerical reuse is authorized for future production qualification. Promoting this approach would require independently reviewing descriptors, sharing the transport inside the authoritative reader, retaining custom semantic/oracle hooks, and showing unchanged full qualification on a frozen SDK. The prospective benefit is fewer independently maintained packet/schema/census implementations, not removal of independent native or actual Final observations.
