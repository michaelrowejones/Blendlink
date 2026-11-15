# Native-reference stage cache pilot

Research-only prototype based on published `5128f94dca6163047e35d1b6106b310974afd790`. It changes no SDK, production manifest, reader, acceptance gate or Sheet. No Blender process, native render, browser or GPU job is launched. No numerical/support credit is earned.

The importer accepts **only** the SHA-pinned Integer Vector3 next56 report and byte-identical closed receipts. It independently rechecks all 4,096 native words (16 graphs, including one calibration), typed constructor identity/values, original saved scene pins, 150 captured Python/addon/reference source pins, all six pinned Blender C++ source files, the actual Blender executable identity and the complete guarded native archive. Those historical references remain historical; this is not a new qualification.

The native-reference key includes the exact native identity, upstream revision/source pins, native settings, captured source pins, case descriptors and validator/cache-schema code hashes. It deliberately excludes a runtime revision. This is a conservative native-source closure, not a claim that all 150 sources are semantically necessary. A separate final-acceptance plan binds the current runtime key and a fresh nonce; it always returns `reuse:false` and requires current source admission, actual saved Final/public install, the shared installed canary, browser gates and an independent close. It cannot be stored in this native-only cache.

Cache reads rehash every plain owned artifact and enforce the exact file census. Equal-byte symlink aliases, missing/truncated/extra files, dependency substitution and modified bytes refuse. Integrity failures are hard errors, not benign misses. Imports use a private temporary directory and publish the manifest last; failed imports leave no published entry. The deliberate bad cached copy is retained in its own temporary namespace; the original evidence is read-only.

## Observed bounded result

The final r2 demonstration imported 41 artifacts /826,761 bytes from the retained corpus:

| Stage | Observed time |
|---|---:|
| Full retained-input/source/schema/word/archive/native-binary validation | 265.89 ms |
| Cold cache lookup (miss) | 0.33 ms |
| Copy and verify the already-validated reference bytes | 17.78 ms |
| Warm cache-only lookup and content verification | 5.69 ms |
| Runtime-only counterfactual, same verified native reference key | 5.56 ms |

Native binary, upstream source, reference code and settings mutations all missed. Tampered bytes failed. Both different runtime acceptance plans still required fresh acceptance.

**The 5.69 ms hit does not include the 265.89 ms input/identity revalidation.** A future checkpoint service could attest those inputs once and explicitly share the immutable result. It may not silently skip integrity checks. These are single local, warm-filesystem observations, not a benchmark or an end-to-end speedup claim. The runtime mutation is an in-memory byte/key counterfactual; the SDK was not edited and no modified runtime was rendered. The pilot tests cache selection, not semantic equivalence of arbitrary runtime changes.

## Run

```sh
node --test experiments/port-stage-cache-pilot/stage-cache.test.mjs
node experiments/port-stage-cache-pilot/pilot.mjs \
  --evidence /absolute/path/to/verification-integer-vector3-next56-manifest \
  --upstream /absolute/path/to/verified-Blender-source-root \
  --output /absolute/path/to/fresh-pilot-report.json
```

The upstream root must contain the six exact repository-relative files listed in `experiments/compositor-int-vector3/sources.json`, revision `02f0899d78e374b63e7181d9061e1f7ab03419cc`. All are hashed before use. The retained native executable and its archived Node identity must still match. The pilot refuses any different retained report, even another valid qualification. Reports use exclusive creation; use a fresh name.

`evidence.json` pins the actual final report, scripts, exact stage key, observations and zero-credit limits. The first r1 report and both deliberately damaged cache namespaces remain machine-local, unchanged. Full-tree compiler/build/package/vendor attestation remains a separate requirement for every current SDK checkpoint.

## Shared public-install canary

Reuse Root's separate `experiments/port-speed-pilot` wrapper around the existing Vector Rotate `diagnose-final` and independent close. Do not copy another matrix here. That wrapper uses the retained actual saved scene to exercise real producer scheduling, caller state, installed linear/display separation and cleanup. The cache supplies only expected native bytes; it never supplies a passing canary or a Final acceptance receipt. A current shared-runtime change still requires the relevant real-install regressions before full numerical acceptance. No canary is launched by these scripts.
