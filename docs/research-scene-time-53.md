# Blender 5.3 Scene Time: source and clock ownership research

This is research only, against Blender `5.3.0` revision
`02f0899d78e374b63e7181d9061e1f7ab03419cc`. It adds no implementation,
capability promotion, numerical qualification, saved Final, live-clock or
appearance credit. Primary source URLs, byte lengths and SHA256 pins are in
[the source manifest](../experiments/scene-time-research/sources.json).
The local-code audit below targets SceneToWeb `6b6c2eb9`.

## Native APIs and three different arithmetic contracts

Both `GeometryNodeInputSceneTime` (shader/geometry) and
`CompositorNodeSceneTime` have no inputs and expose `Seconds` and `Frame`
outputs of native FLOAT socket type. The same geometry/shader node identifier
does not imply identical host/engine arithmetic.

Let `F32` denote the source-level Float32 rounding/storage boundary, `c` the
integer scene frame, `u` the stored Float32 subframe, `b` the stored Float32
`fps_base`, `p` the integer `fps`, and `m` the Float32 frame-remap `framelen`.
These source formulas still require actual native word captures before a port
can claim numerical qualification.

| Context | Frame | Seconds |
|---|---|---|
| EEVEE shader | `f = F32(F32(c) + u)` | `F32((double(b) * double(f)) / double(p))` |
| Geometry execution | `t = F32(F32(F32(c) + u) * m)` | `F32(double(t) / (double(p) / double(b)))` |
| Compositor | `f = F32(c)` | `F32(f / F32(F32(p) / b))` |

The EEVEE shader uses `BKE_scene_frame_get`, then the exact multiply-before-divide
`FRA2TIME` macro. It includes subframe and does not apply `framelen`.
[EEVEE material upload](https://github.com/blender/blender/blob/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/draw/engines/eevee/eevee_material.cc#L115)
feeds the shader's
[uniform accessor](https://github.com/blender/blender/blob/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/draw/engines/eevee/shaders/eevee_nodetree_lib.bsl.hh#L1047).
The conversion macro is in
[DNA_scene_types.h](https://github.com/blender/blender/blob/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/makesdna/DNA_scene_types.h#L3076).

Geometry execution uses `BKE_scene_ctime_get`, which includes remapping, then a
double-precision frame-rate ratio. The shader path instead sets
`GPU_MATFLAG_SCENE_TIME` and delegates to engine uniforms.
[Node implementation](https://github.com/blender/blender/blob/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/nodes/geometry/nodes/node_geo_input_scene_time.cc),
[scene frame/time helpers](https://github.com/blender/blender/blob/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/blenkernel/intern/scene.cc).

The compositor obtains an integer frame and performs its frame-rate division in
Float32. It ignores subframe and `framelen` in this operation.
[Compositor node](https://github.com/blender/blender/blob/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/nodes/composite/nodes/node_composite_scene_time.cc),
[compositor context](https://github.com/blender/blender/blob/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/compositor/intern/context.cc#L70).
Do not replace all three with `frame / (fps / fps_base)`, or use
`scene.frame_current_final` as a universal Frame value.

## Existing SceneToWeb hooks and missing ownership

`export_scene.collect_sidecar` publishes combined `fps` and marker seconds
rounded to four decimal places. It does not retain enough raw timing metadata
for these arithmetic contracts. `nla_sequence.collect_track` subtracts the first
strip's source-frame origin and rounds seconds to six decimal places; the
published sequence omits that origin.

`runtime.startCompiledScenePlayback` and `animationSequence.startAnimationSequence`
already own update, pause, seek, loop, synchronous state subscriptions, frame
requests and disposal. `threeRuntime` calls playback update before rendering.
These are useful lifecycle seams, but their state time is relative to a clip or
sequence. They are not an absolute Blender scene clock, and a scene with no
exported animation returns no playback transport. Multiple independent clips,
looping and trimmed/reversed NLA strips make a guessed mapping ambiguous.
Negative seeks are refused. `threeWebgpuPostPipeline.render(deltaSeconds)`
currently ignores that argument; it is not an existing compositor clock.

A later live model needs explicit owner-scene origin, raw fps/base and source
frame/subframe metadata, a policy for loop/clip switches, and a clock-only path
for effects in scenes without clips. It should update shared material/compositor
uniforms from one owned scene state. It must not use renderer wall time, a global
TSL timer, rounded markers, or one arbitrary clip's local action time.

## Suggested first bounded port and negative cases

An explicit fixed-frame model can fold existing scalar constants without new
runtime operations. Admit it only for a labelled private authoring-preview
freeze or a separately declared still/frame-capture export intent. Connected
previews and ordinary animated Final exports must refuse a silent freeze.
Preserve the existing distinction in `enforce_pointer_animation_policy` between
private inspection and publication.

A reachable Scene Time node is time-dependent without any keyframes on its
owner. Future dependency tracking must retain that fact across actual group
instances, reroutes and material channels; keyed-owner checks alone are
insufficient. Static branch pruning may exclude a genuinely unselected branch,
but arbitrary multiplication by zero must not become an unproved dependency
pruning rule. Animated fps/base/remap or an unidentified source scene requires
separate admission or a named refusal.

Before any promotion, use both outputs over frame zero/one/negative/legal upper
bounds, quarter/half subframes, fps 24/30 and native stored `fps_base=1.001`, and
nontrivial frame remapping. Confirm the deliberate compositor-vs-shader
subframe/remap differences. Include direct/group/reroute, changing frame/fps
invalidating a captured program, exact source bytes, saved Final and both browser
APIs under the declared still intent. A later live matrix must additionally cover
pause, seek, restart, loop seams, clip switches, no-clip scenes, clock-owner loss,
disposal, preview pause/inspection, resize/DPR and independent scene instances.
Values outside actual RNA limits are private arithmetic controls only.

## Bake/freeze admission audit

The dedicated channel baker currently refuses an unsupported Time dependency:
`procedural._classify_channel` leaves `GeometryNodeInputSceneTime` as `unknown`,
and `_plan_material_bake.route_bake` rejects unknown routing. Its `animated` flag,
however, remains false for an unkeyed Time node. The node is also absent from
`engine_fallback._ENGINE_SENSITIVE`; neither detail should be mistaken for a
qualified static or cross-engine time contract. The selected-field materializer
also rejects Time through its unqualified-node allowlist. Compositor extraction
has no Scene Time implementation and takes its unsupported-node path. Ordinary
automatic material planning is weaker than a publication refusal: when no
channel has a program, `_plan_tsl_program` can return `preserved/stock` with a
named unproven-program issue, while `MaterialPlan.errors` collects only blocked
decisions. The owned Time audit returned no hard errors on this route. No stock
GLB or rendered appearance was inspected, so this is not a measured white-image
counterexample or successful publication claim.

The general Appearance-atlas route has a concrete gap: `material_realtime_reason`
and `material_pointer_animation_reason` do not recognize an unkeyed shader Scene
Time dependency. `dynamic_reason` therefore returns no reason for a static
opaque mesh with Time feeding Principled Base Color. `render_meshes` includes it
as an Automatic bake receiver. A Hybrid recipe can then select baked mode, and
`plan_export_materials` excludes the Appearance-owned mesh from channel
compilation before the unknown-node refusal can protect it. `run_baked_mode`
can capture its current appearance without a separately declared frame capture.
This concerns automatic ownership inside Hybrid/Appearance, not permission to
remove an artist's deliberate explicit Baked override.

A follow-up guard should detect reachable shader Time dependencies before
Automatic atlas ownership, return a named realtime/freeze reason, and keep
ordinary Final/connected preview blocked until there is live clock support or
explicit reviewed capture intent. Reuse that dependency result in selected-field
and material-channel capture checks; preserve explicit Baked intent and its
warning policy. If a graph remains unsupported in Realtime, surface that refusal
rather than silently route it back to an atlas. Check selected/unselected
selectors, groups, unlinked Time nodes, owner keyframes, private preview and
explicit Baked overrides before changing policy. No guard was implemented by
this research checkpoint.

A bounded owned Blender 5.3 no-render query confirmed the Appearance admission
chain under both `CYCLES` and `BLENDER_EEVEE`: frame range1–250, no Action/driver
or explicit `blendlink_dynamic` override, one quad and Time Frame feeding an
opaque Principled Base Color. It observed null realtime/pointer/dynamic reasons,
`routing=unknown` with `animated=false`, membership in Automatic bake receivers,
and an empty Appearance compilation scope with no plan errors. It performed no
atlas preparation, bake, render, export or source save. This is admission
evidence only. The temporary research query/log are outside committed
fixtures; the proposal above must receive its own regression and publication
proof when implemented.

## Follow-up admission guard (no clock implementation)

`material_time.py` now inspects the actual source-engine output and contributing
shader sockets before Automatic Appearance ownership. It follows native group
instance socket identifiers, reroutes and muted-node bypasses, and reuses the
qualified static selector/Repeat dependency rules. Unlinked Time nodes,
engine-inactive outputs, unused group inputs and proven inactive selector
branches do not force refusal. Traversal uncertainty has a named refusal rather
than permission to freeze a clock.

Ordinary Final and connected previews reject a reachable unsupported shader
Scene Time dependency with `material.scene-time-clock-unproven`. An explicit
`blendlink_dynamic=False` override permits a current-frame freeze only when the
object is an actual Baked Appearance receiver; Lighting, excluded receivers and
Automatic ownership cannot inherit that permission. Private authoring inspection
requires both `draft=True` and `authoringPreview=True` and retains an explicit
diagnostic warning; stock unsupported-node shading earns no appearance credit.

A selected Web Color field is an existing artist authorization to replace its
discarded downstream response. The guard first keeps the original temporal
Surface out of Automatic Appearance capture, then admits this exception only
after the actual selected-field lowering survives on the same object/material
binding and the selected Color/Alpha dependencies contain no Time. A marker
alone, stale marker or selected field upstream of Time cannot authorize stock
fallback or a hidden automatic frame capture.

Material-use inspection never evaluates geometry. Ordinary unmodified meshes
reuse the allocation-free used-slot helper. Source-index-preserving chains use
source face slots conservatively; generated-material chains recursively inspect
referenced objects, collections/children/instances and node groups, including
Blender 5.3 `modifier.properties.inputs.<socket>.value` ID bindings. Potential
temporal materials with unproven render-used reachability refuse by name.
The census is limited to 4096 referenced IDs; shader traversal has 4096 visits,
4096 group trees and group depth32 limits. Native material identity is retained
across linked/local IDs sharing the same short name.
The selected-field replacement exception conservatively refuses ambiguous short
names because existing downstream carrier helpers have not qualified linked-ID
disambiguation; an unambiguous source binding alone is insufficient shipping
evidence for that case.

The owned Blender 5.3 regression is
`packages/blender-addon/tests/scene_time_admission_check.py`; it exercises both
EEVEE and Cycles without rendering, baking, exporting or implementing clock
arithmetic. The existing `experiments/cycles-normal-bake/budget_preflight_check.py`
also passes: the original Cube Floor's 8,388,608 render triangles still produce
the early resource refusal without evaluating that mesh. These are admission
and ownership checks, with zero live-node or numerical qualification credit.
