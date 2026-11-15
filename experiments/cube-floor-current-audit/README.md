# Original Cube Floor: current normal-bake bottleneck

This is source-only research, not a new node port, bake, Final export, proxy,
optimization or appearance qualification. The original official Cube remains
unchanged (`a9906942c7100612cdcbc086b31179c96d1125c034140b39a87b9fe9fe65ab7e`).
The fresh owned Floor inspection never links that object into the scene and
refuses actual render, bake and GPU initialization calls, plus the current
evaluated-depsgraph/material-use/materialized-hash allocation seams.
After guard canaries, all activity counters remain zero. Source mesh arrays,
material bindings, modifier settings and original file bytes remain unchanged.

## What is blocked now

The five-material/six-Normal-or-Coat-Normal refusal in the historical official
corpus receipt predates the existing Cycles normal workflow. Do not repeat it
as the current blocker. The retained current planner triage reports four lowered
materials (Concrete, Plaster - Teal, Wood 6, Wooden Bars), one preserved stock
material, and one blocked material (Boards - Basketweave). Their lowerings are
plans; they do not establish completed full-scene bakes or publication.

The retained current actual Final attempt refuses Floor before publication.
This fresh source-only audit independently reproduces the same named planning
refusal. Its 4,096 source quads and render SIMPLE subdivision level 5 require
exactly 8,388,608 triangles, above the 2,000,000 static normal-receiver limit.
Viewport level 4 is a different scope and still has 2,097,152 triangles. No
viewport mesh is substituted and no resource limit is changed.

The five relevant planner/bake/export files in this audit byte-match the frozen
joint SDK at inspection time; their exact hashes are retained in evidence.json.
This is not an all-current SDK or fresh full-scene Final qualification.

## Actual consumed source fields

Floor has 4,225 vertices, 8,320 edges, 4,096 smooth planar quads, one DATA material
slot, active-render `UVMap`, and one SIMPLE modifier (`PRESERVE_CORNERS`, viewport
4, render 5). Its Principled root is inside `SH-Boards.Basketweave`, through
actual artist group `Group.001`.

Only Base Color and Normal have contributing linked graphs. Both read the same
packed 1,024 × 1,024 sRGB image `boards_basketweave` through active `UVMap`, with
Linear/FLAT/REPEAT image sampling. The packed image SHA is
`f4707e07fbaecb37cdd88cac8553e29e97f0d26706bed5a2cc45cdf88203ebb1`.
Normal includes Bump, Strength 1, Distance approximately .02, Filter Width 1.
There is no contributing Generated/Object Info/Geometry/named-attribute source
in this Floor material. This narrows its dependencies, but does not prove
subdivision removable.

The earlier exact-same-original source inspection found UVs are not exactly
affine: maximum global affine residual `1.054399790878513e-5`, and maximum
per-face bilinear cross term `5.960464477539062e-7`. Those are actual source-array
measurements retained separately, not newly measured here. The older synthetic
`0.0625` counterexample is not a Floor measurement. Consequently, planar
geometric coincidence alone cannot certify the consumed UV/bump field,
derivatives or tangent basis unchanged. A small residual is not zero-loss.

## Reuse the existing workflow

`material_compiler.py` already routes unsupported static Cycles Normal and
active Coat Normal to distinct native NORMAL passes, forces owner-specific
unique receivers, and retains proved companion channels. A proven zero Coat
Weight skips its dormant Coat Normal. That is why the old sixth Coat Normal
refusal is absent from the current original plan; active coat has an explicitly
separate existing derivative test, not silently credited to the original.

`bakelib.configure_normal_bake` uses tangent-space POS_X/POS_Y/POS_Z and disables
selected-to-active. The installed private receiver captures render modifier
settings and original object/Generated context. The current carrier gate checks
native bake UV/Mikk geometry associations, separate base/coat maps, actual saved
PNG quantization and surface direction, then restores source state. Its Wood 6
carrier proof is bounded transport evidence, not whole-scene lighting parity.
There is no missing generic NORMAL API to implement for this Floor.

## Next decision

A future automatic zero-loss lowering must prove the whole consumed field,
not just flat positions. A very narrow certificate could require a regular
oriented planar mesh, identical smooth normals/material IDs, no animation,
shape keys or other topology modifiers, and exactly preserved UV interpolation
and tangents for every consumed UV layer under the actual SIMPLE/UV-smoothing
algorithm. It must also reject topology-dependent shader inputs, preserve all
other consumed attributes and exported/live companion fields, and retain a
source/target dependency identity. The real Floor fails the available exact UV
precondition. Do not add automatic modifier removal or Decimate here.

The smallest existing-policy artist action is to review changing Floor's render
subdivision from 5 to 3, producing 524,288 triangles under the current budget.
That is an explicit derivative requiring native appearance comparison; it is
not an accepted export or a fidelity guarantee. Level 4 alone remains above the
budget. Keep the original file and current refusal intact.

If this workflow needs to be automated, the next implementable route is an
**explicit reviewed low receiver**, with separate source-evaluation and
receiver/export budgets. It would retain the authored high source, bake from
that source into the lower receiver's actual tangent/UV basis, and bake any
companion field whose authored UV mapping changes. This needs new high-to-low
projection/visibility, cache identity, source preservation and appearance proof;
merely calling the existing same-receiver NORMAL function on a flat proxy is
insufficient. It also does not remove the original high-source allocation cost.
No larger source budget or proxy selection is introduced by this research.

Meaningful controls before either implementation:

- Admit an exact affine-UV planar synthetic case only after native fine/coarse
  position, UV, normal, tangent, handedness and consumed-field equivalence.
- Refuse the same plane with one nonaffine UV corner, UV seam/smoothing change,
  negative/nonuniform transform, custom normal, material-ID change or a
  Geometry/Generated/attribute dependency unless separately proven.
- Use the actual original Floor as a negative source-only regression: exact
  budget diagnostic, zero evaluated-mesh allocation, unchanged mesh/material/
  modifier/image ownership, and unchanged original SHA.
- For a reviewed proxy, require separate source/target fingerprints, explicit
  tangent-basis capture, no cross-owner dedupe, correct base/coat slot bindings,
  projection coverage controls, independent high-source appearance comparison,
  and restoration on success, failure and cancellation.

## Reproduce the source-only audit

With Node 24, from an isolated checkout and a new directory:

```sh
node experiments/cube-floor-current-audit/run.mjs \
  artifacts/verification-original-floor-current-source-fresh \
  /absolute/path/to/pinned/cube_diorama.blend
```

The shared guarded launcher uses a fresh native Python cache prefix and archives
its actual invocation and executable identity; the closing reader checks that
archive, the exact input census, original SHA and zero activity metrics. This
runner never builds the SDK, renders, bakes, evaluates Floor or writes a blend.
Primary SIMPLE/UV/tangent source links and hashes are in sources.json.
The failed r3 canary remains retained: patching `bpy.types.Object.evaluated_get`
did not intercept native RNA lookup. R4 tests explicit current allocation seams
and the actual context wrapper instead; it does not claim universal native
method interception. Existing
normal carrier and historical official-demo receipts are left verbatim.
