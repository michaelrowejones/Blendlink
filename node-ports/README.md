# Manifest-selected node verification

`test-node-port.mjs` selects a declared source/build profile, builds once, owns a
fresh evidence directory, and checks the declared inputs again before allowing
qualification. It never reuses numerical proof. The source watcher discovers
all JSON manifests in this directory; a changed upstream dependency or native
revision queues fresh verification, with zero automatic support promotion.

Automatic executions hold an exclusive lease for the checkout from entry until
verification and cleanup finish. A second execution against the same canonical
checkout retains a zero-command refusal before building or launching Blender;
its report identifies the owner record. Separate worktrees remain independent,
and dry runs do not acquire a lease. An interrupted process leaves its lease for
explicit inspection rather than silently taking over a possibly active build.
Only remove that identified lease after confirming its owner and child jobs have
ended. Manual build commands and standalone family scripts do not use this
entrypoint, so coordinate those and the cross-worktree GPU queue separately.

These compositor manifests use **family-owned matrices**:

| Manifest | Source | Complete native / Final / browser census |
| --- | --- | --- |
| `compositor-noise-default-field` | Default-input Blender 5.3 CPU compositor Noise, bounded RGB contract | 41 / 8 / 136 |
| `compositor-wave-axis` | Axis Blender 5.3 CPU compositor Wave | 149 / 20 / 640 |
| `compositor-white-noise-default-field` | Default-input Blender 5.3 CPU compositor White Noise | 63 / 8 / 248 |
| `compositor-white-noise` | Fixed-input Blender 5.3 CPU compositor White Noise | 44 / 12 / 224 |
| `mono-switch-view` | Static mono Blender 5.3 CPU Switch View input0 selection | 8 / 8 / 64 total; 7 / 7 / 56 production, plus calibration |
| `compositor-blank-image` | Static finite Blender 5.3 CPU compositor Blank Image | 26 / 8 / 136 |
| `compositor-displace-single` | Terminal Blender 5.3 CPU Displace, actual source and same-pixel oracle kept separate | 320 renders for 160 inputs / 16 / 160 numerical frame cases |

The Blank Image adapter passed a fresh complete automatic transaction on the
joint runtime, including a byte-identical independent second close. Its closed
reader requires exact native linear words, all 272 resize
frames, 96 lifecycle cycles and ten unique native prefixes; actual Raw display
has a separate existing clamp01 absolute 3e-5 audit.

Displace also passed its full fresh automatic transaction and byte-identical
independent second close. Its sixteen admitted saved graphs are not counted as 160
source-graph ports: 160 separate browser scene-pass inputs feed the explicitly
source-unadmitted native Image oracle. The adapter owns `proof/` and its adjacent
`proof-source-policy/` within the outer evidence directory, runs the fresh matrix
once, re-runs its authoritative reader, and checks all three native archive
identities against the outer actual executable. It preserves exact linear words
and the separate existing Raw display audit.

Large Displace readbacks stream as exact binary packets into an exclusively
owned archive. The transport validates frame/API/role, byte count and SHA-256;
the independent reader still checks every original raw file and all thirteen
roles. This removes the large CDP array serialization failure without dropping
comparisons or relaxing a gate. Earlier failed namespaces remain zero credit.

These scheduling adapters run the existing native, Saved Final, Metal and
SwiftShader, WebGPU and WebGL2 proof exactly once. Their registered ownership
mode passes the actual raw Blender executable to the family's own fresh native
launcher. The outer runner still hashes/queries that executable and checks the
exact source version/build. It does not create a second native guard or launch
redundant browser identity probes. Legacy Squeeze and Float to Integer ownership
and profile scheduling remain unchanged.

After the complete matrix, the adapter independently reruns the family's closed
reader. This rechecks source/native/Final/fixture/runtime/vendor hashes, actual
API/profile identity, complete nonzero case census, and a fresh whole-program
compiler emission. The family launcher identity must match the outer actual
native identity byte for byte. The mono reader receives the explicit owned
transaction path and the digest already pinned by its original closed receipt;
it does not discover a cached snapshot. Native/Final receipts and that transaction
manifest are frozen across independent closure. The calibration graph never
becomes a Switch View production graph.

Plan without building, launching, hashing Blender, or creating evidence:

```sh
node scripts/test-node-port.mjs compositor-white-noise --profile mac-53 --dry-run
node scripts/test-node-port.mjs mono-switch-view --profile mac-53 --dry-run
```

To execute, provide the actual declared Blender executable and a fresh evidence
directory instead of `--dry-run`. Execution is intentionally expensive and
should be serialized with the native/GPU proof queue. A future Blender version
needs an explicitly reviewed source profile; a matching node name or unchanged
socket schema grants no equivalence.

The initial integration passed CPU-only scheduling, synthetic adapter mutations
and dry-runs. Both actual manifest entrypoints subsequently completed fresh full
native/browser transactions; their exact historical snapshot receipts are in
[the pipeline proof record](../experiments/node-port-pipeline/README.md).
This verifies the bridge without adding node coverage. Retained compact receipts
used as schema fixtures in CPU tests still provide **zero fresh numerical credit**.

White Noise manifests explicitly list executable case/contract/source JSON.
Retrospective `evidence.json` and pilot records are outputs, so recording a
successful run does not invalidate its own executable-input digest or queue
it again. Changes to the actual case files still require fresh verification.
The strict readers continue to validate the generated native/Final/runtime
archives independently; this boundary does not permit numerical proof reuse.
