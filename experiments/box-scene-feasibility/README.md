# Box Mask current-frame composition feasibility

This research changes no SDK or capability status. It records 16 native CPU scheduling observations, four source-only graph observations and two host tests. No actual saved Final/browser composition is qualified here.

Pinned Blender 5.3 build 02f0899d78e3 Box execute_cpu always allocates a full-domain texture. With singleton unlinked Mask, compute_domain uses the compositing context. It has no Ellipse-style zero-Size share_data early return. The CPU predicate is strict `abs(coordinate) < size/2`, so a zero axis has no inside pixels; the result is still a field. Native Box→ImageInfo observations for all 4 operations and Size (0,.5), (.5,0), (0,0), (.5,.5) return Dimensions (13,9,0,1), including zero sizes. This observation does not expand the live ImageInfo producer scope. Primary URL, SHA and relevant lines are in `sources.json`.

Existing generic Box→RenderLayers→Mix source graphs already extract and build under Box/other operations' existing **partial** contracts. The current Box domain validator rejects spatial transformations, not RenderPass; the existing generic Mix path does not claim the new exact exceptional-word composition contract. This is not a reason to blanket-refuse or regress those old graphs. The new workflow must be a separately marked exact three-op exception, with guarantees and evidence kept distinct.

## Narrow extension proposal

One direct current Scene/ViewLayer Image or Alpha, one pinned CPU Box Add/Mask 0/Value 1 and one terminal modern RGBA/MIX can reuse the calibrated physical HalfFloat/MSAA0 frame binding and unchanged binary integer word law. Unlinked literal background components retain the exact positive-zero/normal ≤ 1 gate. Zero-size Box remains field-valued; it must not inherit Ellipse's scalar-identity marker. Existing Box interval computation and result/extent guard already handle empty rectangles and constant output. No mask texture is required: one frame sampler + at most 7 display lookups fits budget 8. Additional registered effects remain outside the exact slice.

Use an explicit shared mask-family descriptor for kind/nativeclass/property-prefix/model-tag and field semantics. Preserve the old Ellipse ABI unchanged; add a distinct Box exact marker. Full-graph, source-owner, active-socket, raw-background, renderer-certificate and actual physical attachment checks remain common. The Box normalizer should mark only eligible new exact graphs and preserve existing generic partial paths outside that slice. An invalid or stale *present* exact marker must refuse rather than silently downgrade.

Do not copy another proof family. Extend the existing scene-mask staged harness with an explicit mask-family/case descriptor and one shared source/oracle/browser/reader implementation. Freeze the existing Ellipse census by default. Add Box nonzero/zero-axis/offscreen/strict-edge and portrait/DPR cases; keep generic admission observations separate. Fresh saved Final sources, independent actual Three baselines, new native Image oracles, actual installed linear words and separate Raw-display audits are required before support is claimed. The existing exhaustive binary law/two exact decoder models are foundations, not reused Final numerical credit.

This is a useful low-cost extension: Box classification stays O(W + H) only on physical resize, with integer bounds and no row texture. It does not add generic floating Mix, arbitrary images, Alpha Over, rotation, fields, Blender GPU-authoring or whole-scene look equivalence.

## Observations and ownership

The source-only probe preserves node/link/group counts and writes owned program snapshots. All four graph sizes currently report extracted [box-mask,render-pass,mix] with no new exact marker. The host test confirms ordinary generic building without a frame certificate, under its old partial scope, and empty zero-axis intervals. The native scheduling probe uses a fresh private factory scene, CyclesCPU carrier, CPU FULL compositor, raw EXR32 reads and a guarded private Python prefix. Original demos/user artifacts are untouched. Both native stages retain separate archived launcher records.

Recheck the retained owned observations without rendering:

```sh
node experiments/box-scene-feasibility/close.mjs artifacts/verification-box-scene-policy-v1 artifacts/verification-box-scene-scheduling-v1
SCENETOWEB_BOX_POLICY_REFERENCES="$PWD/artifacts/verification-box-scene-policy-v1" npx vitest run experiments/box-scene-feasibility/admission.test.ts
```

`receipt.json` pins the local closure and the underlying retained files. This is a research observation record. The reader revalidates native launcher archives, scripts, binary identities, stage files and observation censuses; it does not independently decode EXR pixels. The retained native script itself reads every output pixel and checks dimensions. No source/runtime qualification, new live node coverage or saved Final numerical credit follows from this record.
