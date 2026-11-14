# Browser proof assembly preflight

Pixel INT2, floating Image Coordinates, compositor texture fields, Vector Math,
Image Info, Radial Width, static strings, static Repeat and static Switch proofs now export a tiny frozen versioned contract from their existing
`protocol.mjs`. Each numerical runner and closed reader consumes the same pass
token. Native/Final status checks consume the same family descriptor. No shared
un-pinned import was added to numerical runners/readers: their existing protocol
SHA256 pins close the actual contract bytes.

Texture keeps its historical `PASSED_FLOAT_COORDINATE_BUILT_PROOF` report label.
That label alone never establishes family identity. Native/Final statuses,
closed case censuses, saved publications, source/fixture/runtime/vendor/map pins
and all numerical gates remain independent and unchanged. Other families cannot
supply the same token to acquire Texture qualification.

Before any native launcher, capture or runtime attestation, the eight matrix
entrypoints and Switch suite run the fast assembly check and schema tests. The
assembly check parses JavaScript using the installed TypeScript compiler; a
comment, unrelated import or copied status string cannot satisfy it. Per-family
contracts refuse missing/extra fields, wrong versions and cross-family copies.
Protocol fixtures reject omitted/extra/duplicate cases, foreign-family results,
failed/refused statuses, wrong source/build pins and failed source preservation.
A subprocess regression tampers each registered assembly and requires refusal
before an output/native transaction is created; its fake native executable must
remain uncalled.

Run the cheap check independently before scheduling expensive work:

```sh
node scripts/check-browser-proof-contracts.mjs
node --test scripts/lib/browser-proof-contract.test.mjs \
  experiments/static-switch-family/protocol.test.mjs
```

`test:node-pipeline` includes the common contract tests. The common fixtures use
exported case builders from the exact protocol being checked; the protocol's
explicit census and the independent closed numerical reader still enforce their
full expected counts. Changing Pixel or another family's scope requires updating
that family's case builder/counts and its native/export/browser/reader fixtures.
It does not mean changing shared numerical tolerances.

This is tooling/schema validation with zero numerical qualification credit.
Direct low-level capture commands are still available for research; the matrix
and suite entrypoints are the enforced end-to-end preflight path. Tests do not
start Blender or a real browser/GPU. Their subprocess control uses a fake native
executable only.

Existing compact receipts are immutable observations at their pinned source
revision. Their historical vocabulary is retained, and archival replay uses that
revision. These harness edits intentionally change future runner/protocol source
pins: no old report is rewritten or accepted as a fresh numerical replay, and
current-source validation continues to reject stale pins. Run a fresh full matrix
after the next combined production freeze.

## Native invocation censuses

New closed readers can reuse `validateNativeArchive` with an `expectedScripts`
array containing exact `{path, invocations}` records for every non-Final Python
script. A family with two reference scripts need not run a redundant third
reference to fit the older helper. Counts must be positive integers, paths must
be unique, and the archive must contain exactly the declared invocations plus
the separately checked saved Final sources. Each Python invocation must contain
one fresh guarded prefix and one reviewed script; unknown scripts, extra Python
actions and expression/text substitutions refuse. All existing byte, executable,
cache-disposal and source-preservation checks still run.

Retained readers without this option keep their historical three-reference and
one-policy census. This API does not relax a numerical gate, qualify an archived
research run, or permit reuse of a stale fixture/runtime snapshot. The helper's
synthetic archive controls and actual guarded Blender test exercise both paths.
