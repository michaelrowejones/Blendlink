# Partial Appearance surfaces, 2026

Research date: 2026-07-22

## Decision

Blendlink should support an Automatic mesh whose **used** material slots divide
into static Appearance receivers and Realtime surfaces, but it should not split
the authored object into public child nodes. Keep the authored Blender object as
one glTF node and use glTF's existing mesh-primitive/material seam for final
bake ownership.

The compiler should create face-filtered, disposable atlas carriers internally,
pack and bake only the eligible faces, transfer the resulting atlas UV corners
back to the evaluated export mesh, and replace only eligible material bindings
with generated unlit Appearance materials. Generated materials carry namespaced
material extras identifying their atlas, output, and UV channel. The runtime
resolves those material tags before its legacy object-level tags.

This is an internal compiler improvement. It adds no artist configuration and
does not change the application's route, Canvas, object identity, hierarchy,
loading UI, renderer, or deployment ownership.

Do not claim the Cube Diorama picture-frame issue fixed by partial baking alone.
Its surviving glass material also collapses to an opaque default glTF material;
it needs a separately proved alpha/material route or must remain a loud fidelity
limitation.

## Evidence status

- **Inspected:** Blendlink's current object-level dynamic classification, atlas
  preparation, material rebuilding, glTF output, and Three r184 runtime binding.
- **Inspected:** the actual Cube Diorama Appearance fixture in Blender 5.2.0 LTS
  and its current final GLB.
- **Supported by primary sources:** glTF meshes are arrays of primitives and a
  primitive owns one material; Blender 5.2's exporter already partitions mesh
  triangles by `material_index` and exports material custom properties as
  `extras`; Three r184 loads multiple primitives as child meshes of one group,
  copies material `userData` through loader material clones, and supports texture
  channels `0..3`.
- **Design only:** no production code has been changed for partial surfaces.
- **Prototype required:** a minimal mixed-surface fixture should prove the whole
  bake/export/load/state path before production changes or Cube dogfooding.

## What is failing today

[`procedural.automatic_dynamic_reason`](../packages/blender-addon/procedural.py)
returns as soon as any object material slot has a Realtime reason. Then
[`render_meshes`](../packages/blendlink/blender/export_scene.py) excludes the
whole object from atlas preparation. Later, the Material Compiler also excludes
or includes whole object pointers according to the same predicate. Runtime bake
ownership is found only from object/ancestor extras in
[`bakedRecipe.ts`](../packages/blendlink/src/bakedRecipe.ts).

That object-wide policy is safe but unnecessarily coarse. It treats one
transparent face as evidence that every opaque face on the object must retain a
stock glTF material.

### Actual Cube Diorama frame structure

The inspected fixture is
`artifacts/release-dogfood/cube-diorama/fixtures/cube-diorama-web-appearance.blend`.
All five picture frames are one mesh object each with multiple used material
slots:

| Object | Artwork | Frame | Glass | Current Automatic reason |
| --- | ---: | ---: | ---: | --- |
| Picture Frame - 1 Apple Imitation | 1 polygon | 89 polygons | 1 polygon | Armature modifier |
| Picture Frame - 2 Mountains Spring | 1 | 30 | 1 | glass viewport alpha below one |
| Picture Frame - 3 Windmill X | 1 | 42 | 1 | glass viewport alpha below one |
| Picture Frame - 4 Shells in the Sand | 1 | 38 | 1 | glass viewport alpha below one |
| Picture Frame - 5 Francks Razor | 1 | 130 | 1 | glass viewport alpha below one |

The shared `picture_frame_glass` material has viewport alpha
`0.14282512664794922`. Frames 2-5 have no Action, constraint, shape key, or
deforming modifier; their only modifier is the static Auto Smooth Geometry
Nodes migration. Frames 1-2 have four edges shared across different material
indices, while frames 3-5 have none. Therefore a loose-part or connected-island
heuristic is not a general solution; the plan must partition evaluated faces by
used material binding.

Frame 1's Armature modifier has no target object. A position/topology/material
hash of its source and evaluated mesh was identical in Blender 5.2. This is a
separate conservative-classification false-positive candidate, not evidence
that all targetless or all Armature cases should be ignored without a focused
rule and test.

The current final GLB already contains one node and 3-4 glTF primitives per
frame, exactly matching the used material slots. However, each artwork material
(`appel_imitation_picture`, `mountains_spring`, `windmill_x`,
`shells_in_the_sand`, and `poster_franks_razor`) contains an empty
`pbrMetallicRoughness` object. `picture_frame_glass` is also empty and has no
`alphaMode`. The glTF defaults are therefore rendered instead of the artwork
and authored glass. This explains the white picture content in the retained
browser evidence.

## Designs compared

### Design A: split the final Blender object into public baked and Realtime nodes

Create two export objects, delete the opposite face sets, and parent both below
an Empty or make one the child of the other.

This reuses the current object-level runtime binding and allows each subset to
use atlas UV channel zero. It is mechanically attractive but puts compiler
implementation details into the application-facing scene. It changes node
type, child lists, bounds, raycast targets, collection membership, generated
node names, and potentially animation/NLA/component ownership. Keeping the
original mesh as one half merely makes its geometry an arbitrary subset of what
the developer believes the object represents.

**Decision:** reject as the default final representation. A private object split
is useful inside the bake implementation, not at the glTF/application seam.

### Design B: one final node, primitive-scoped material bake ownership

Keep the evaluated mesh and all its material-indexed primitives on the authored
node. Build disposable, face-filtered carriers for atlas layout and baking.
Copy the packed UVs back to matching source corners. Replace only baked material
slots with generated unlit atlas materials and tag those materials in glTF
`extras`.

This aligns with the standard transport. The glTF specification defines a mesh
as an array of primitives and specifically identifies material assignment as a
reason to split a mesh into primitives. Blender's exporter already constructs
primitive indices from triangle material indices, so Blendlink does not need to
fork or reproduce that exporter. Three's `GLTFLoader` already creates one child
mesh per primitive while keeping the glTF node transform/name/extras on their
common group.

The implementation is deeper than Design A: it must own corner provenance,
UV-channel allocation, per-binding material copies, and runtime material
metadata. That complexity is private and pays back across every mixed-material
asset without adding artist or developer configuration.

**Decision:** recommend.

### Design C: bake portable PBR material fields instead of scene Appearance

Bake selected base color, roughness, metallic, normal, and alpha fields to the
object's material UVs, then keep every primitive under realtime lighting.

This can support moving or deforming geometry because the texture moves with
the surface. It is valuable for the Material Compiler, especially where a
procedural material otherwise collapses in stock glTF. It does not capture the
selected-camera Appearance result, scene lighting, cast shadows, AO, or the
transparent compositing of the original frame. Object/Generated coordinates
also make shared-material outputs binding-specific.

**Decision:** complementary future path, not the replacement for partial
Appearance surfaces.

## Recommended module and seam

Add a pure, JSON-safe `SurfaceBakePlan` keyed by the Material Compiler's existing
binding identity `(object_name, slot_index)`. Its small interface should answer
one question for every **used evaluated** surface binding: `appearance`,
`lighting`, or `realtime`, with the exact reason and object-level constraint.

Illustrative shape, not a committed schema:

```python
@dataclass(frozen=True)
class SurfaceBindingPlan:
    object_name: str
    slot_index: int
    material_name: str | None
    disposition: Literal["appearance", "lighting", "realtime"]
    reason: str | None

@dataclass(frozen=True)
class ObjectSurfacePlan:
    object_name: str
    geometry_reason: str | None
    bindings: tuple[SurfaceBindingPlan, ...]

def plan_bake_surfaces(
    objects,
    *,
    output: Literal["appearance", "lighting"],
    fixed_camera_appearance: bool,
) -> tuple[ObjectSurfacePlan, ...]: ...
```

The interface is inspection-only. `procedural.py` should own the classification
facts and artist-facing reasons. `export_scene.py` orchestrates the plan with
atlas and Material Compiler planning. Every mesh/UV/image/proxy mechanic remains
in canonical `bakelib.py`.

An internal `bakelib.py` implementation should return prepared face carriers
and hide loop-provenance transfer and cleanup. Do not expose BMesh, temporary
object names, carrier attributes, or pack ordering through the plan interface.

The current real Final path calls `compute_bake_plan()` and then
`run_baked_mode()`, and each call prepares/finalizes geometry. A carrier cannot
be generated twice or copied from a stale first pack. Production work must
either make one prepared atlas transaction feed both the JSON plan and the bake,
or make preparation explicitly idempotent with a verified registry. A single
prepared transaction is the stronger design because its plan evidence then
describes the exact geometry and UVs consumed by the bake.

### Ordering

1. Apply the existing explicit object intent first.
   - Realtime: every binding remains Realtime.
   - Baked: preserve the existing whole-object forced-bake behavior and its
     warning.
   - Automatic: continue below.
2. Determine object-level geometry motion/deformation before changing data. Any
   animation, parent/constraint motion, skin, shape key, time-dependent
   topology, particle system, or unproved modifier keeps the complete object
   Realtime.
3. For geometry-stable objects, freeze evaluated geometry once, then inspect
   only material indices used by evaluated polygons. An unused unsafe slot must
   not exclude valid surfaces; a modifier-created used material must not escape
   classification.
4. Apply the current output-specific material policy per used binding. Fixed-
   camera Appearance may admit only the already-approved opaque camera-dependent
   cases. Alpha, transmission, volume, Light Path branching, and unproved
   material animation remain Realtime.
5. For a mixed object, create a private mesh carrier containing only baked
   polygons. Preserve a private source-loop index on each surviving corner.
6. Stage, validate, weight, and pack atlas UVs on carriers. Copy final packed UV
   values back to the matching corners of the evaluated export mesh.
7. Bake the carrier objects as separate native receivers in one shared image
   call. Hide the full export object during the job so
   it cannot double-occlude. Realtime faces are absent from the carrier and do
   not become permanent shadows, bounce, reflection, or coverage.
8. Replace only baked slots with private generated materials. Do not mutate a
   source material shared by Realtime bindings.
9. Export one authored node with its normal material-indexed primitives.
10. Attest the final GLB's node identity, primitive/material ownership, material
    extras, `KHR_materials_unlit`, image binding, and texture coordinate index.

## Runtime material contract

Generated baked materials should carry:

```json
{
  "blendlink_atlas": "main",
  "blendlink_bake_output": "appearance",
  "blendlink_atlas_uv": 1
}
```

These are material `extras`, not a new glTF extension. The glTF specification
explicitly permits application-specific material extras, Blender 5.2 exports
Material custom properties when `export_extras` is enabled, and Three r184 puts
those extras in `Material.userData`.

Runtime binding becomes material-first:

1. validate and use complete material-level Blendlink metadata;
2. on a node marked `blendlink_partial_bake`, treat an untagged material as
   Realtime rather than inheriting an ancestor atlas;
3. otherwise retain the current object/ancestor lookup as the legacy and full-
   object path.

`blendlink_atlas_uv` is required for a mixed Appearance binding because the
source UVs must remain available to Realtime primitives. Three r184 supports
texture channel `0` (`uv`) through `3` (`uv3`). The existing texture cache
already keys Lighting textures by channel; Appearance state, preload, promotion,
light-group layer, clone, and disposal paths should use the same channel-aware
mechanism.

## Invariants and loud refusals

1. The saved `.blend` and authored datablocks are never modified. All carriers,
   material copies, tags, and UV changes live in the disposable export process.
2. The authored node name, stable ID, hierarchy, transform, action/NLA target,
   visibility owner, and component/interactivity owner do not change.
3. Automatic partial baking is permitted only when local geometry and its world
   placement are static under the existing policy. No skin/morph/topology
   partition is inferred.
4. Classification uses evaluated, used material bindings. Invalid material
   indices or an uninspectable evaluated binding fail loudly.
5. Cross-material shared edges are valid. Selection is by face material index,
   never loose parts or connectivity.
6. Carrier-to-export UV provenance is one-to-one for every surviving loop. A
   missing, duplicated, or changed loop identity blocks before baking.
7. Pinned authored atlas UVs retain their current validation and ownership.
8. Realtime faces consume no atlas area and receive no atlas material or state
   swap.
9. Realtime faces are excluded from permanent Appearance contributions. If that
   omitted shadow/bounce matters, diagnostics name the approximation; Blendlink
   does not bake it and render it again at runtime.
10. Every generated baked material is private to the complete binding identity
    `(source material, output, atlas, UV channel)`. A material cannot silently
    span incompatible owners.
11. A mixed object must have a free Three-supported texture coordinate channel
    after retaining every source UV channel required by its Realtime materials.
    If channels `0..3` are all required, Automatic falls back to whole-object
    Realtime with a named reason.
12. Default embedded maps and every external state/layer map use the same
    attested texture channel.
13. Material metadata survives Blender export, Blendlink optimization, and
    `GLTFLoader` material cloning. Final verification checks it after all
    transforms.
14. The Material Compiler plans only Realtime bindings on a mixed Appearance
    object. Appearance-owned bindings must not be lowered a second time.
15. Partial baking is not an alpha translator. A surviving Realtime material
    that collapses in stock glTF remains a reported or blocking material issue.

## Prototype and test plan

Prototype this before changing the Cube fixture. Generate a tiny two-material
mesh with shared boundary vertices, one opaque procedural material, one portable
transparent material, a stable ID, a static parent transform, two authored UV
sets, and two Appearance states. Put an ordinary animation clip on a second
otherwise equivalent fixture object; that object must take the existing
whole-Realtime route, proving the new classifier does not partially freeze an
animated transform.

The prototype passes only if:

- the input `.blend` hash is unchanged;
- the partial fixture's final GLB has one node with the same name, ID, and
  hierarchy, and two primitives;
- the animated fixture remains wholly Realtime and its animation target is
  unchanged;
- only the baked primitive references a generated `KHR_materials_unlit`
  material with complete material extras and the expected nonzero `texCoord`;
- the Realtime primitive retains its original material and UV payload;
- only baked faces contribute atlas occupancy and coverage;
- switching state changes only the baked material map;
- transparent rendering, root-object lookup, visibility, sibling transform
  animation, and interaction/raycast behavior still work in Chromium;
- disposal restores application-owned materials/textures and frees only
  Blendlink-owned state textures.

Production coverage should then add:

- pure classification tests for unused unsafe slots, explicit intent,
  fixed-camera eligibility, geometry motion, and channel exhaustion;
- headless carrier tests for shared edges, pinned UVs, custom split normals,
  negative scale, static modifiers, evaluated material assignment, shared Mesh
  datablocks, and cleanup failures;
- runtime tests for material precedence, the partial-node inheritance barrier,
  legacy object fallback, channel-aware state/preload/layer/clone/dispose, and
  incompatible shared materials;
- final GLB attestation before and after texture/Meshopt transforms;
- a two-state Playwright screenshot with a transparent overlay and root-level
  transform/interaction assertions;
- Cube Diorama dogfood showing four partial frame plans, the separate null-
  target Armature decision for frame 1, exact remaining glass limitations, and
  fresh Blender/browser/diff images rather than a metric-only claim.

## Primary sources and local source anchors

- [Khronos glTF 2.0 mesh primitives](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#meshes)
- [Khronos glTF material extras](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#reference-material)
- [Khronos glTF texture coordinate selection](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#reference-textureinfo)
- [Official Blender glTF primitive extractor](https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/addons/io_scene_gltf2/blender/exp/primitive_extract.py)
- [Official Blender glTF material-extra gathering](https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/addons/io_scene_gltf2/blender/exp/material/material_utils.py)
- [Three r184 `GLTFLoader`](https://github.com/mrdoob/three.js/blob/r184/examples/jsm/loaders/GLTFLoader.js)
- [Three r184 `Texture.channel`](https://github.com/mrdoob/three.js/blob/r184/src/textures/Texture.js)
- [Three r184 material clone/userData behavior](https://github.com/mrdoob/three.js/blob/r184/src/materials/Material.js)
- Installed Blender exporter inspected at
  `C:\Program Files\Blender Foundation\Blender 5.2\5.2\scripts\addons_core\io_scene_gltf2`
  (the retained GLB reports generator `Khronos glTF Blender I/O v5.2.39`).
- Installed Three inspected at `node_modules/three`, version `0.184.0`.
- Current Blendlink source anchors:
  [`procedural.py`](../packages/blender-addon/procedural.py),
  [`bakelib.py`](../packages/blendlink/blender/bakelib.py),
  [`export_scene.py`](../packages/blendlink/blender/export_scene.py), and
  [`bakedRecipe.ts`](../packages/blendlink/src/bakedRecipe.ts).
