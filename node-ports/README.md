# Manifest-selected node verification

`test-node-port.mjs` selects a declared source/build profile, builds once, owns a
fresh evidence directory, and checks the declared inputs again before allowing
qualification. It never reuses numerical proof. The source watcher discovers
all JSON manifests in this directory; a changed upstream dependency or native
revision queues fresh verification, with zero automatic support promotion.

Two compositor manifests use **family-owned matrices**:

| Manifest | Source | Complete native / Final / browser census |
| --- | --- | --- |
| `compositor-white-noise` | Fixed-input Blender 5.3 CPU compositor White Noise | 44 / 12 / 224 |
| `mono-switch-view` | Static mono Blender 5.3 CPU Switch View input0 selection | 8 / 8 / 64 total; 7 / 7 / 56 production, plus calibration |

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
