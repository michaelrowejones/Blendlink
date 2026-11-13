# Field proof compiler attestation throughput

Pixel INT2, floating Image Coordinates and compositor texture-field matrices now
capture one fresh explicitly pinned runtime transaction before their native
queue. Each of the eight CPU/GPU × Metal/SwiftShader × raw/Final browser children
loads that manifest through the existing `loadRuntimeTransaction` helper. The
parent passes both its exact path and SHA256; each child independently rechecks
all compiler inputs/resolution probes, source/dist/build inventories, snapshot,
source maps, vendor bytes and helper/package/config bytes. It then uses the exact
validated shared immutable runtime directory. No persisted snapshot is searched
for or discovered automatically.

Every native render, saved Final export, numerical/browser case, resize/refusal,
resource check and missing-adapter control still runs. Neither numerical outputs
nor native captures are cached. Only repeated whole-program compiler emission
and identical per-child runtime/vendor copies are removed. The kernels,
protocol/case fixtures and numerical gates are unchanged.

The closing reader requires the same explicit transaction pair, freshly emits
the whole current TypeScript program with its compiler trace, and compares that
closure with the captured transaction and every browser receipt. The existing
closed archive reader still checks exact modules, source maps, vendor and local
fixture inventories. Closing revalidation checks the full transaction again
before writing the compact receipt. A shared-mode report cannot silently fall
back to standalone archival validation.

Standalone `run.mjs` and `verify.mjs` callers retain their original independent
snapshot/emission behavior when neither transaction environment variable is
supplied. Supplying only one variable, a missing manifest, wrong digest,
source/config/compiler/snapshot drift or a transaction for source-mode execution
refuses. A valid unrelated snapshot on disk does not change standalone behavior.
The transaction helper's `mkdir` ownership check rejects reusing a matrix's
runtime transaction directory.

The no-GPU [measurement](evidence.json) uses the actual independently built
172-module production program under Node24.22.1 on macOSarm64. Eight independent
snapshot/vendor captures plus fresh closing emission used19.807s. One traced
transaction capture, eight full child revalidations, and a fresh traced closing
emission with closing revalidations used5.981s: a69.80% reduction in this compiler
attestation-only sample. Whole-program emissions fell from9 to2; the independent
closing emission remains mandatory. Identical production source/emitter
fingerprints are asserted across both sequences. This is one serial overhead
sample, with zero native/browser/GPU work and zero numerical qualification
credit; it makes no artist-export or frame-time speed claim.

Reproduce with Node24 and an independently built frozen SDK, using a fresh
output directory:

```sh
npm run build --workspace=scenetoweb
node experiments/field-proof-throughput/profile.mjs \
  artifacts/verification-field-proof-throughput-fresh
node --test scripts/lib/field-proof-throughput.test.mjs \
  scripts/lib/runtime-transaction-snapshot.test.mjs \
  scripts/lib/browser-proof-contract.test.mjs
```

The new runner-level tests execute real setup against a synthetic tiny SDK and
schema packet, with Vite and Playwright hard-stubbed before any browser startup.
They prove explicit selection, default standalone behavior despite an existing
valid snapshot, missing/wrong pins and manifest refusals, source drift and source
mode refusal. Synthetic reports deliberately end in `failed` and earn no
qualification. Existing helper tests cover changed/missing declarations,
package/config/build/source/dist/maps/vendor/snapshot bytes, added modules and
resolution shadowing, missing pins and reused directories. The pipeline includes
the runner tests.

Freeze all production source/dist/compiler/package/helper and numerical fixture
inputs before starting a matrix; keep them unchanged through its closing reader.
The parent-owned transaction must remain present for independent archival
validation. These runner/reader edits intentionally change future source pins.
Existing receipts remain immutable at their captured revision. Fresh combined
native/Final/browser matrices are required after integration; this CPU-only
experiment does not requalify any node.
