# Next static compositor context: mono Switch View

Research only: no SDK, source extractor, runtime, capability or support changes. Of the three candidates, `CompositorNodeSwitchView` in a fixed mono context has the clearest bounded next port. Eight actual native CPU compositor renders independently close 3,744 RGBA words with zero differences. The guarded archive, source pins, raw images and strict research closure remain in the owned local artifact directory identified by `receipt.json`; this grants no Final/browser credit.

## Candidate comparison

| Candidate | Pinned semantics | Main remaining work |
| --- | --- | --- |
| Switch View | Empty context view name shares the actual first native input; named views select that identifier. | Admit explicitly mono CPU source context, validate actual ordered input/output schema, and traverse only the selected dependency. No new numerical kernel. |
| Input Rotation | Stored EulerXYZ is converted directly to a constant native Quaternion. | Existing bounded Euler MF/hash evaluator is reusable, but safe raw reading of the node's Euler property remains unresolved. Do not promote Python float getters or copy arbitrary source trees. |
| Input Integer Vector | CPU returns an exact int2 or int3 constant; GPU currently uploads a float3. | RNA preserves full signed INT32 exactly, but default3D / 2D typed edges and conversion contracts need explicit work. GPU source semantics cannot be inferred from CPU. |

Primary full revision is `02f0899d78e374b63e7181d9061e1f7ab03419cc`. `sources.json` pins primary URLs, SHA-256 values and byte counts for all three nodes and compositor context/operation implementations. Native RNA observations confirm the Integer Vector property changes width with `vector_dimensions`: int3 values `[-2147483648,16777217,2147483647]` are exact Python integers; switching to2D exposes exactly the first two. This is a property/schema observation, not a port or integer conversion proof.

## Switch View source and native observations

Pinned `node_composite_switch_view.cc` lines29–40 declare RGBA inputs in the stored Scene's enabled view order; lines44–49 bind a hidden Scene ID when creating the node. Lines62–70 share actual input0 when `get_view_name()` is empty and otherwise share the named input. `COM_context.hh` lines96–98 defines empty as non-multiview; the base context implementation returns empty, while the offline render context forwards its current input view name.

The node exposes no Scene ID property through its actual RNA. A future mono implementation should therefore follow **actual native input0**, without guessing a `left` label, reconstructing a foreign owner ID or choosing from a different scene's current view list. Disabled and renamed views really change the input identifiers in the observed node schema. The source operation ignores the hidden owner for its empty-view fallback.

Eight CPU controls, all physical13×9, passed exact raw-word comparisons:

- Default left/right inputs select `left`.
- Disabled first view exposes/selects `right`.
- Renamed first enabled view selects the actual `Artist right` identifier.
- Scene Time linked only to the inactive second branch does not change the first output.
- A group/reroute producer on the first branch passes its literal through.
- An existing full-frame image field passes every controlled pixel through.
- Selected single RGBA followed by Image Info reports default Dimensions `(0,0,0,1)`.
- Selected full-frame Image followed by Image Info reports `(13,9,0,1)`.

The Image Info controls are scheduling/domain observations, not a new Image Info producer qualification. The inactive-Time result establishes output independence only; the probe does not instrument native scheduler execution counts or claim that Blender avoids computing every unused node. A source port may prune noncontributing branches under the fixed selection while still requiring selected-branch dependencies to pass their own contracts.

## Bounded next proposal

Add a small compile-time selector at the existing compositor traversal's structural group/reroute/static-selection seam. For pinned Blender5.3 CPU source, require mono render intent (`use_multiview=False`), a native SwitchView RGBA Image output, at least one enabled/available RGBA input with unique identifiers and the existing static tree/animation checks. Select the actual first socket and use the existing input walker, conversions, source ownership and budgets. Let native mute bypass run through the existing earlier handler. Retain selected single-value versus field identity; do not rasterize a constant into a synthetic image.

Named/stereo/multiview contexts, empty/stale/unknown schemas and unresolved context ownership must named-refuse. Add source snapshots for mono flag and actual selected socket/schema as needed; do not invent a hidden Scene-ID RNA binding. Add actual source controls for inactive unsupported/animated branches versus selected refusal, group/reroute/mute, changed view flags/names, no-input refusal and source preservation. Fresh actual saved Final and both browser APIs/profiles should prove the selected graph without importing unused dependencies. No view runtime clock, new shader opcode, texture, pass or per-frame native work is needed for this slice.

```sh
node experiments/switch-view-feasibility/run.mjs artifacts/verification-switch-view-NEW
node experiments/switch-view-feasibility/close.mjs artifacts/verification-switch-view-NEW
```

The first native transaction retained eight successful pixel controls but then failed its unrelated Integer Vector schema inspection by trying to assign3 components while in2D mode. Its incomplete archive/log stay separate and grant no qualification. A fresh corrected transaction reran all controls and closed successfully. No original demos/private user scenes were opened, no Floor meshes were evaluated, and no GPU initialization was requested.
