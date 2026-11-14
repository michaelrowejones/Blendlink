# Shared row-table pre-upload failure control

This is CPU-only negative research against the unchanged production `OwnedCompositorRowTable` at union `e9f36a1`. It imports that TypeScript source directly with Node 24, uses Three r184's actual `Textures` and `Info` classes, and substitutes explicit backend handle counters. It creates no GPU renderer, browser, Blender process, native shader, or numerical support claim.

Twelve controls distinguish both backend APIs, normal operation versus an exception after handle creation or during upload, and immediate disposal versus retry without an intervening owner disposal. Four normal controls retire their one handle exactly once. On both APIs:

- Creation allocates and throws before `texture.onUpdate`: retry overwrites the first handle, and final disposal leaves destruction counts `[0, 1]`.
- Immediate owner disposal after either creation or upload throws before `onUpdate`: destruction counts remain `[0]`.
- Upload failure followed by retry completes the same allocation and retires it once. This positive control distinguishes the two paths.

The current row owner captures its physical handle only from `onUpdate`. That callback is not reached for either failure above. `validate()` does not discover a previous uncaptured allocation, and `dispose()` calls release without a late capture. These are ownership failures, separate from the already-tested post-`onUpdate` format/schema refusal path.

The minimal proposed fix is an ownership-only capture operation using the original pinned manager WeakMap/backend/context. It must discover and retire a partial allocation before a retry can overwrite it and before disposal marks the owner dead. Partial allocations have no native `onDispose` listener or `Info.createTexture` count, so they require exact manual cleanup and must not decrement uncreated counters. Borrowed default placeholders must remain untouched. Numerical builders, source admission, actual row data, dimensions, sampling-node invariants and update timing need no change.

To reproduce the historical negative result, first check out research commit `edc06eb` (whose row-owner bytes match union `e9f36a1`). Run in a fresh directory with that checkout's dependencies installed:

```sh
PATH=/tmp/mrj-tooling:$PATH node --experimental-strip-types \
  experiments/research/row-upload-retry/probe.mjs \
  artifacts/verification-row-upload-retry-fresh
```

`receipt.json` pins the retained raw report and all source dependencies. Its support credit is zero. It is not a regression assertion for a future fixed row owner: the probe deliberately asserts the observed negative result so that the failure cannot silently disappear from the historical record.


## Minimal fix and actual API control

Commit `0bd2e7e` factors ownership capture from upload validation. It discovers the original manager epoch's actual nondefault handle without creating map entries, retires an incomplete prior generation before retry, and captures a previously unseen partial before disposal. Numerical builders, row values, dimensions, source/domain admission, sampling binding checks and context conditions remain unchanged. The native upload callback still performs its existing numerical/format/schema validation separately.

All 52 focused row/axes/upload/binding/Wave/Noise host tests and TypeScript checking pass. The native-manager tests cover the original 12 cases plus original-epoch cleanup after manager reset and borrowed default preservation. The fixed isolated SDK build then passed four actual browser API/profile tuples: Metal and SwiftShader, each WebGPU and WebGL2. There were 28 actual controls and 36 distinct native R32F table handles, each retired exactly once. Constant recovery pixels stayed `.25, .25, .25, 1`; shader, device and page errors were empty. Original saved renderer disposal was exercised with an externally supplied WebGPU device. The actual texture handle destruction primitive was observed, including explicit fallback paths.

`actual-receipt.json` pins that separate positive report, source/test fixtures, actual adapter identities and the independent built-runtime archive closure. It does not overwrite `receipt.json` or promote the old negative evidence. These ownership controls grant no node support or general numerical coverage. Other node families retain their own existing proof lineages.

Only with the coordinated GPU window, run the built isolated control in a fresh directory:

```sh
PATH=/tmp/mrj-tooling:$PATH npm run build --workspace scenetoweb
PATH=/tmp/mrj-tooling:$PATH node \
  experiments/research/row-upload-retry/gpu-control.mjs \
  artifacts/verification-row-partial-actual-fresh
```


## Follow-up reset and destructor review

The first fix and its 28 actual controls remain retained above. Independent review then found three further cleanup failures in that source snapshot: a late GL partial could be deleted through a replacement context, an observer resetting the manager after native disposal caused double destruction, and native delegation could delete an added borrowed MSAA texture or skip an owned handle after its default flag changed. Commit `a6c382c` retains a separate five-case CPU negative report using the actual Three texture manager and WebGPU native destructor. Check out that commit to repeat `late-cleanup-probe.mjs`; the script deliberately requires the historical failure and grants zero support credit.

The narrow follow-up `0a1b593` pins the original GL token for late ownership capture, uses the retained original WeakMap as proof of native consumption, and restricts delegation to the row's nondefault, no-MSAA, no-render-target native footprint. Manual fallback deletes only the original owned handle field and preserves added borrowed entries. Numerical builders, row bytes, source models and existing validation conditions remain unchanged.

All 62 focused host tests and TypeScript checking pass, including real Three native destructor controls. A fresh isolated build then passed 46 actual controls across Metal and SwiftShader, both WebGPU and WebGL2. All 54 owned R32F handles retired exactly once. Additional controls exercise observer reset before and after native cleanup, real borrowed WebGPU MSAA / WebGL FBO handles, mutated default flags, and an actual second GL context after a late partial and original renderer disposal. The replacement context received zero texture deletions from owner cleanup. Error reports are empty. `late-cleanup-actual.json` pins this fresh raw report, current source and fixture bytes, actual API identities and independently emitted runtime/vendor/fixture archive closure.

Both earlier positive and negative receipts remain unchanged. This is an isolated resource-ownership proof; it does not refresh every other port, qualify the unmerged node prototypes in its source checkout, or alter capability counts. A resource-only published SDK may carry the two row cleanup commits without any prototype dispatch changes.
