# Read-only upstream Blender node watch

The daily/manual workflow observes upstream source and actual Blender node schemas. It creates artifacts only. It cannot change capability claims, run an unreviewed implementation, grant production credit, merge changes, or post PRs/issues/comments. Pull requests run fast fixture/protocol tests without downloading Blender.

```sh
node scripts/watch-blender-nodes.mjs \
  --config config/blender-node-watch.json \
  --cache-dir /absolute/archive-cache \
  --output artifacts/blender-node-watch
```

`--output` must be a new directory. An optional `--discovery FILE` consumes one already resolved official discovery document; the workflow uses this to key its archive-only cache. The observer otherwise calls discovery once itself. It uses only the fixed official Blender Git origin and resolved full commit/tree identities. Source checkouts live in its private `.work` directory, use a sparse source scope, disable ambient Git overrides and LFS smudging, and must have the requested exact HEAD/tree/origin and clean state. Pointer changes remain source observations, not asset qualification.

The checked-in baseline pins actual Blender5.3 source02f0899d78e374b63e7181d9061e1f7ab03419cc/treee05e50cc9d58ca09b36a8ed9352c489092436fe1 and the reviewed native catalog `docs/node-coverage/blender-5.3.0.json`. Its source snapshot is recomputed from a fresh owned official checkout; the multi-megabyte snapshot is not committed. The baseline is intentionally stable until reviewed evidence justifies an update, so repeated daily reports may contain the same outstanding work.

The observer first captures a target source-only snapshot/diff. That preliminary artifact cannot infer native node removals. Whenever the source commit changes, it acquires the matching official Linux binary, rehashes downloaded/cached archive bytes, checks actual `--version`, then runs `audit-node-coverage.py --catalog-output` in isolated factory Blender. This happens even when the watched source bytes are unchanged. Catalog build/version must match the acquired executable before final source/native comparison.

Final artifacts include exact discovery/acquisition identity, baseline/source-only/final snapshots, actual target catalog, preliminary and final work queues, generated `TASK.md` packets and zero-admission scaffolds, an unqualified verification plan, plus per-command argv/status/stdout/stderr and a report. Commands use argv arrays; config cannot introduce executable commands. Failures retain completed source-only findings and the failing phase. Source checkouts/extracted binaries remain local `.work` scratch and are excluded from uploads.

`verification-plan.json` lists affected registered ports. A missing target-version profile becomes `needs-target-profile`; an existing declared profile becomes `needs-fresh-qualified-verification`. Both have zero production cases/credit. A catalog establishes actual creation/schema, not EEVEE evaluation, source precision, saved asset transport, browser fidelity, or Final/Preview behavior. Those remain separate reviewed port proofs. No numerical proof is cached or reused.

A fresh hosted Linux end-to-end run is required before claiming that the new daily archive/source combination completed this observer. Unit tests use explicit fake source/native identities to test sequencing and protocol behavior; they are not that hosted proof. A temporary QA push trigger may be added on `codex/qualify-node-port-pipeline` in a separate commit; it is excluded from the permanent daily/manual recipe.
