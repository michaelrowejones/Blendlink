# Minimal staged material compiler, 2026

Research date: 2026-07-22

Implementation status: the recommended plan plus scoped-executor seam is now
package code for exact constant and direct color-attribute selected fields.
Realization uses compiler-private VEC4 carriers and an atomic final-GLB
`COLOR_0` rewrite to survive Blender 5.2's proven multi-material color lookup
failure. Blender attests generated bindings and numeric ranges, and the final
document repeats that proof after resize/KTX2/Meshopt while rejecting private
semantic leakage. Selected-socket Emit, existing-image transport, and broader
complete-surface rules remain future work. See the
[implementation and Splash evidence](research-demo-material-portability-2026.md#selected-field-implementation-and-fresh-dogfood).

## Decision

Build one deep Blender-side **Material Compiler** module with two entry points:

```python
plan = plan_materials(scope: MaterialCompileScope) -> MaterialPlan

result = with_compiled_materials(
    plan: MaterialPlan,
    emit: Callable[[], T],
) -> MaterialCompilation[T]
```

`plan_materials` is the shared, mutation-free interface used by the add-on's
Fidelity UI, `blendlink plan`, Preview, and Final. `with_compiled_materials`
revalidates that plan, installs only private export/bake material copies, runs
the existing export continuation exactly once, verifies the emitted material
payload, and restores everything in `finally`.

The module has exactly three outcomes for every used material binding:

1. **Stock glTF**: leave an already portable material alone, or apply one
   fingerprinted lowering whose complete semantics are provably representable
   as a stock Blender glTF PBR/unlit graph.
2. **Selected socket**: only after the artist marks an exact color output,
   validate that output's own dependency graph for Cycles, bake it through a
   private Emission proxy and the Emit pass, and publish an ordinary unlit
   base-color texture. Transparent material families also require a provable
   constant/vertex alpha or an explicit alpha output.
3. **Refused**: do not guess a node, discard an unhandled alpha branch, run an
   EEVEE-only node through Cycles, or silently emit white glTF defaults.

This is a compiler pass, not a new runtime material system. The website still
owns Three.js, its Canvas, lighting, route, post-processing, and deployment.
The final product remains ordinary glTF/GLB plus Blendlink's existing owned
companions. Khronos defines glTF as a runtime-neutral delivery format, and its
ratified `KHR_materials_unlit` model consumes only base color, alpha, and vertex
color while ignoring lighting. [glTF 2.0 specification][gltf-spec]
[KHR_materials_unlit][khr-unlit]

## Why this is the smallest useful seam

Today the knowledge is spread across several shallow locations:

- [`procedural.py`](../packages/blender-addon/procedural.py) classifies the
  active Surface graph and independently reports Cycles Appearance blockers;
- [`export_scene.py`](../packages/blendlink/blender/export_scene.py) selects
  the export scope, builds private bake proxies, calls Cycles, rebuilds baked
  unlit materials, invokes Blender's exporter, and reports warnings;
- [`bakelib.py`](../packages/blendlink/blender/bakelib.py) correctly owns all
  bake mechanics and state-safe image writes;
- the TypeScript audit detects a completely collapsed final payload after the
  GLB exists.

Deleting a pass-through wrapper would leave that complexity where it is. By
contrast, deleting the proposed Material Compiler would force callers to
reimplement graph matching, binding-specific vertex-color resolution, selected
socket validation, alpha policy, private-copy ownership, stale-plan detection,
bake ordering, cleanup, and final payload verification. That deletion test is
why this is a deep module.

The **seam** belongs immediately inside Blender, after Blendlink has computed
the real export scope and before any material bake or stock glTF export. It
must span planning through emission; putting the seam only around graph
inspection or only around `bpy.ops.object.bake` would leave the correctness
contract split across callers.

## Interface

The following types are illustrative and intentionally internal to the
Blender package. They are the complete caller-facing interface; graph matcher
registries, proxy builders, bake targets, temporary images, and glTF parsing
stay in the implementation.

```python
from dataclasses import dataclass
from typing import Callable, Generic, Literal, TypeVar

T = TypeVar("T")

@dataclass(frozen=True)
class MaterialCompileScope:
    scene: bpy.types.Scene
    objects: tuple[bpy.types.Object, ...]  # exact active glTF export scope
    tier: Literal["preview", "final"]
    plan_only: bool
    output_glb: str
    # Existing Appearance atlas/layout facts, or None. No new resolution
    # configuration is introduced for the first selected-socket implementation.
    appearance: AppearanceBakeContext | None

@dataclass(frozen=True)
class SocketRef:
    material: str
    node: str                 # display/error identity only
    socket_identifier: str   # resolved from the marked node at plan time
    semantic: Literal["baseColor", "alpha"]

@dataclass(frozen=True)
class MaterialDecision:
    material: str
    objects: tuple[str, ...]
    route: Literal["stock", "selectedSocket", "refused"]
    proof: str
    losses: tuple[str, ...]
    source_fingerprint: str
    source: SocketRef | None
    alpha: SocketRef | None

@dataclass(frozen=True)
class MaterialPlan:
    source_fingerprint: str
    decisions: tuple[MaterialDecision, ...]
    diagnostics: tuple[MaterialDiagnostic, ...]
    errors: tuple[ArtistReadableError, ...]
    warnings: tuple[ArtistReadableWarning, ...]

@dataclass(frozen=True)
class MaterialCompilation(Generic[T]):
    plan: MaterialPlan
    emitted: bool
    value: T | None
    generated_files: tuple[MaterialArtifactEvidence, ...]
    gltf_evidence: tuple[CompiledMaterialEvidence, ...]

def plan_materials(scope: MaterialCompileScope) -> MaterialPlan: ...

def with_compiled_materials(
    plan: MaterialPlan,
    emit: Callable[[], T],
) -> MaterialCompilation[T]: ...
```

The `emit` continuation is an in-process dependency, not a public extension
port. In production it is the existing bake/export body. In tests it can be a
small function that inspects installed private materials or deliberately
raises. The executor owns the continuation's lifetime, so no caller can forget
to release a proxy or leave a private material bound after an exception.

### Authoring interface

Do not add a website config object or a general shader-language schema.
Provable stock lowering needs no artist setting. An explicit selected-socket
route uses two namespaced properties written by an add-on operator on the
selected top-level material node:

```python
node["blendlink_material_base_color"] = output_socket.identifier
# Optional, and required when the material is not provably opaque:
node["blendlink_material_alpha"] = alpha_socket.identifier
```

The add-on should present this as **Use Selected Output as Website Base Color**
and **Use Selected Output as Website Alpha**. Artists should never type the
identifier. The marker lives on the node, so renaming the node does not break
the selection. A read-only Blender 5.2 probe against the retained Splash source
confirmed that `Node` accepts namespaced ID properties, while `NodeSocket`
rejects them with `TypeError: id properties not supported for this type`.
`NodeSocket.path_from_id()` and `NodeTree.path_resolve()` work, but storing that
RNA path on the material would make node renames part of the interface. The
node marker is therefore the smaller and more stable authoring seam.
[Blender Node API][blender-node-api]

Initially accept markers only on the material's top-level node tree. A socket
inside a shared node-group datablock would silently change the intent of every
group user. An artist may instead mark the corresponding output on the
top-level group instance. Multiple base-color markers, multiple alpha markers,
a missing identifier, or a shader-typed selected output are hard authoring
errors.

## Semantics and proof rules

### Stock glTF route

The installed Blender 5.2 exporter first tries its shadeless detector, then
gathers PBR channels. Its `gather_color_info` recognizes a deliberately small
expression: constant factor multiplied by a color attribute and/or texture.
Its unlit detector recognizes a color socket, optional camera-ray trick, and
optional Transparent mix. Blendlink should target those exact installed
patterns rather than maintain a second glTF material serializer.
[official exporter material gatherer][exporter-materials]
[official exporter unlit detector][exporter-unlit]
[official exporter node search][exporter-search]

The first matcher set should be deliberately narrow:

- already Exact stock Principled or stock unlit: unchanged;
- constant color with only exactly evaluable constant color operations:
  generate a private recognized unlit graph;
- one named or binding-resolved active vertex-color source, optionally
  multiplied by a constant factor, with provable opaque/constant/vertex alpha:
  generate a private recognized unlit graph;
- any unfamiliar node, topology, dynamic input, or alpha branch: matcher miss,
  not best effort.

Proof is structural, not based on a material name and not based on a rendered
pixel sample. A matcher fingerprints node types, links, group interfaces,
socket identifiers, constants, color-space facts, alpha policy, and every
binding-specific mesh attribute it relies on. A changed graph simply no longer
matches.

Vertex color must be resolved per material **binding**, not per material. The
Splash's top-level `ShaderNodeVertexColor` nodes have an empty `layer_name`,
which means the active/render color attribute is selected by each mesh. The
retained file contains objects where that resolves to `Attribute`, `Color`, or
`Color.001`. A shared generated material may therefore need to be forked by
`(source material, resolved color layer, alpha policy)`, just as current
Lighting materials are already forked by complete runtime binding identity.
The installed exporter itself records whether color selection is named or
active and later emits vertex-color information per primitive; the compiler
must preserve that distinction. [official exporter node search][exporter-search]

The output language is ordinary stock glTF only. The Blender exporter manual
documents Metal/Rough PBR and `KHR_materials_unlit`, and says it constructs the
glTF material from recognized Blender node arrangements. It also documents
that custom properties become unnamespaced `extras`, another reason not to
ship an arbitrary material program there. [Blender glTF exporter manual][blender-gltf]

### Selected-socket route

The marker is explicit artistic intent to preserve one field, not a request to
guess at the whole EEVEE result. The planner walks backward from only the
marked socket and reports its dependencies separately from the active Surface
graph.

For the first implementation, selected-socket materialization requires an
existing Blendlink Appearance atlas. That gives it an already sized, packed,
validated, delivery-aware UV target and avoids adding another resolution or
asset schema. Realtime-only scenes receive a direct fix: choose Hybrid and an
Appearance atlas, simplify to a stock material, or keep an application-owned
adapter.

Execution uses private material copies on separate evaluated carrier receivers,
preserving each source object's shader context:

1. Preserve the source socket link on the private copy.
2. Replace only the private active Surface with that color connected to an
   Emission shader.
3. Add/select the private target Image Texture.
4. Bake `EMIT` on the committed atlas UV.
5. Keep semantic alpha in a separate bake/image from the coverage mask, then
   combine it only after margin/coverage processing.
6. Feed the resulting atlas through the existing generated unlit material
   path and stock Blender exporter.

Blender's Cycles manual requires a UV map and an active Image Texture or Color
Attribute target, and describes margin as protection against filtering and
mipmapping seams. [Blender Cycles baking manual][blender-baking] Bake setup,
coverage, alpha combination, Standard/None/0 saves, post-lossy constant
backgrounds, denoise, packing, and proxy ownership therefore remain in
`bakelib.py`, exactly as the repository rule requires. The Material Compiler
orchestrates those primitives; it must not copy them.

`Shader to RGB` is EEVEE-only and does not work in Cycles. A marked dependency
subgraph that reaches it is refused even if another branch of the material is
Cycles-compatible. [Blender EEVEE node support][blender-eevee-nodes] Other
initial hard blockers should include shader-typed outputs, camera/light-path
dependence, AO/shadow results, unsupported volume, missing/overlapping atlas
UVs, or unresolved transparency. UV-driven procedural color and vertex color
may be admitted matcher by matcher after a real headless Emit test.

An explicit socket route does **not** claim to preserve Shader-to-RGB lighting,
AO, shadows, world interaction, Filmic, curves, film grain, lens distortion,
or any compositor result. Those losses ride the decision and remain visible in
the add-on and manifest diagnostics.

## Invariants, ordering, and errors

The interface contract includes these invariants:

1. **Exact scope.** Inspect only objects the current glTF export will include,
   after `-noimp` removal and the real collection/selection/visibility policy.
2. **Authored evidence first.** Capture source diagnostics and graph/binding
   fingerprints before installing private materials.
3. **Explicit before inferred.** A valid selected-socket marker is honored
   before automatic lowering. An invalid marker is an error; it never falls
   through to a guessed matcher.
4. **Whole-plan preflight.** Resolve every material, alpha source, UV, dynamic
   risk, and output path before the first mutation or Cycles job.
5. **No stale execution.** `with_compiled_materials` recomputes the complete
   source fingerprint. A changed graph, binding, active color layer, UV, or
   marker invalidates the plan and asks the caller to re-plan.
6. **Private state only.** Never alter an authored material, node tree, image,
   object binding, scene render setting, or saved `.blend`. All generated
   materials/images/proxies are tagged and removed in `finally`.
7. **Atomic emission.** The continuation runs once, only after every planned
   material is ready. Files are written to temporary paths and promoted only
   after nonempty/hash/payload checks succeed.
8. **No alpha guessing.** A transparent/mixed surface without a proven or
   explicitly selected alpha source is refused. Coverage alpha and semantic
   alpha are separate internal images.
9. **Stock output.** Final material success means the exact GLB contains the
   promised `pbrMetallicRoughness`, texture/vertex-color inputs, and, where
   chosen, `KHR_materials_unlit`; a successful Cycles call alone is not proof.
10. **No runtime ownership.** The compiler emits assets and evidence only. It
    does not install Three materials, shaders, lights, or a Canvas policy.

Errors should be typed internally but rendered as direct artist fixes:

| Error | Example message / fix |
| --- | --- |
| Invalid selection | `DPM: two Website Base Color outputs are marked. Keep one marker.` |
| Missing socket | `Sky: marked output "Color_2" no longer exists on node "Paint". Select it again.` |
| Wrong socket type | `Bush: selected output is a Shader; choose a Color or Value output upstream of Shader to RGB.` |
| Cycles blocker | `Bush.006: selected Base Color reaches Shader to RGB, which EEVEE alone can evaluate. Select an upstream color socket.` |
| Alpha unresolved | `Outline: the Surface mixes Transparent BSDF but no portable or selected Website Alpha exists.` |
| No bake target | `Sky: selected-socket materialization needs a Hybrid Appearance atlas with valid UVs.` |
| Binding ambiguity | `DPM: active vertex color resolves differently across users; Blendlink will fork these bindings` (evidence), or refuse if a binding has no valid layer. |
| Stale plan | `Material graph/UV evidence changed after planning; run Preview/Publish again.` |
| Execution failure | Include the material, object/atlas, bake stage, and Blender stderr tail. |
| Payload mismatch | `Compiled unlit material exported without KHR_materials_unlit/base color; exporter 5.2.39 did not recognize the generated graph.` |

Preview may surface untreated nonportable materials as loud diagnostics when
the emitted GLB still has meaningful fallback payload. Final retains the
existing hard failure for complete payload collapse. An invalid explicit
marker, a requested selected-socket route that cannot execute, or a compiler
claim contradicted by the final GLB is always an error in both tiers.

## Usage

The exporter remains small:

```python
scope = MaterialCompileScope(
    scene=bpy.context.scene,
    objects=tuple(diagnostic_export_objects(...)),
    tier="preview" if settings.get("draft") else "final",
    plan_only=bool(settings.get("planOnly")),
    output_glb=out_path,
    appearance=current_appearance_context_or_none(),
)
plan = material_compiler.plan_materials(scope)

if plan.errors:
    raise SystemExit(format_material_errors(plan.errors))

if scope.plan_only:
    return write_plan(plan)

compiled = material_compiler.with_compiled_materials(
    plan,
    emit=lambda: run_existing_bake_and_gltf_export(),
)
sidecar["diagnostics"]["materials"] = compiled.plan.diagnostics
```

The add-on calls only `plan_materials` for its Fidelity cards. It does not run
Cycles merely to draw UI. A material node operator writes/clears the marker,
invalidates the existing sync status, and immediately re-plans.

## Hidden implementation

The module implementation should hide:

- normalized active-Surface and target-socket traversal through nested groups;
- complete graph/binding fingerprints and matcher registry;
- constant color evaluation;
- named/active vertex-color resolution on evaluated export meshes;
- binding partitioning and private material forking;
- exact construction of Blender 5.2-recognized PBR/unlit graphs;
- selected target dependency classification;
- Appearance-atlas membership and UV preflight;
- private Emission/alpha proxy construction;
- calls into canonical `bakelib.py` bake/save/coverage/packing primitives;
- generated-image/material/object cleanup;
- final GLB JSON/material/primitive audit and evidence construction;
- conversion of typed failures into existing JSON-safe diagnostics.

These are internal seams for tests, not extra external entry points. In
particular, do not expose a matcher callback registry or a generic
`Node -> glTF` visitor. New portable families should be code-reviewed compiler
implementations with fixtures, not website/user plugins that can claim
portability without proof.

## Dependency strategy

Using the codebase-design dependency categories:

- **In-process:** graph traversal, fingerprints, matcher decisions, binding
  partitioning, diagnostic construction, and final GLB JSON inspection. Test
  these directly through `plan_materials` and the result of
  `with_compiled_materials`; no adapter is needed.
- **Local-substitutable:** Blender node evaluation, Cycles Emit, Image Texture
  targets, stock glTF export, and file output. The stand-in is an actual
  headless Blender process with tiny generated `.blend` fixtures. Blendlink
  already has this harness. Keep this seam internal; exposing a `BakePort`
  would be hypothetical because there is only one production implementation.
- **In-process continuation:** the current exporter body passed as `emit`.
  Tests provide a second concrete continuation (inspection/failure), so this
  is a real seam without inventing a remote protocol.

There are no remote dependencies and no application runtime adapter. Blender's
installed exporter remains the output authority, and Three's installed r184
`GLTFLoader` already maps `KHR_materials_unlit` to `MeshBasicMaterial`.
[Three r184 GLTFLoader][three-unlit]

## Design comparison

### Variant A — plan plus scoped executor (recommended)

Interface: the two functions above.

**Depth:** high. Two calls cover add-on preflight, CLI plan, private lowering,
Cycles materialization, continuation lifetime, cleanup, and artifact proof.

**Locality:** high. All source-selection semantics and all material mutation
live together. `bakelib.py` remains the separate canonical mechanics module.

**Seam placement:** correct for both callers. The add-on stops after the pure
plan; the exporter crosses the executor seam. The executor revalidates the
fingerprint, eliminating the otherwise dangerous time gap.

**Cost:** the plan/result types are richer than a single imperative function,
and the executor must reject stale plans. That cost purchases a fast UI and a
natural interface-level test surface.

### Variant B — one context manager

```python
with compile_materials(scope) as compilation:
    run_existing_bake_and_gltf_export()
```

**Depth:** superficially higher because it has one entry point and naturally
owns cleanup.

**Locality:** good for export, weak for the add-on. The UI either enters a
mutation-capable context merely to inspect a plan or needs a second hidden
planner, recreating split knowledge.

**Seam placement:** too late for mutation-free Fidelity UI and `plan --json`.
It also makes `planOnly` an execution-mode flag on an otherwise transactional
interface.

**Decision:** reject. Fewer method names do not compensate for lower leverage
across the two real callers.

### Variant C — public rule registry plus separate bakers

```python
register_lowerer(node_matcher, material_writer)
register_socket_baker(name, baker)
```

This stays within three entry points but is shallow: every extension author
must understand graph traversal, alpha, binding scope, UV ownership, exporter
patterns, and verification. It moves correctness out of the module, weakens
locality, and invites application/runtime-specific materials. Reject it until
there are two independently proven non-core adapters; today there are none.

## Migration without a manifest reshape

No scene-manifest shape change is required for the first implementation:

1. Keep `schemaVersion: 1` and the existing material diagnostics array.
2. Add only optional fields to an existing material record, for example:

   ```json
   {
     "material": "DPM",
     "status": "approximated",
     "materialCompilation": {
       "route": "stock",
       "proof": "unlit-active-vertex-color-v1",
       "losses": []
     }
   }
   ```

   Optional additive fields are permitted by the repository's current schema
   discipline; readers that do not know the field continue to enforce the
   existing version.
3. Selected-socket output uses the existing Appearance atlas files and the
   existing generated unlit material/runtime path. Do not add a new companion
   kind or website loader.
4. The node markers are namespaced Blender authoring properties and are not a
   manifest schema. Generated private materials must remove/avoid exporting
   compiler-only markers in glTF `extras`.
5. Keep `applicationMaterialAdapter` as the explicit website-owned escape
   hatch. It does not become a compiler rule and cannot mark a lowering as
   verified.
6. Initially enable automatic portable lowering only for matcher fixtures with
   exact artifact proof. Selected-socket execution is opt-in by its marker.
   Untreated materials retain today's visible diagnostics and collapse gate.

If a future release needs runtime-selectable material layers, dynamic baked
material states, or a new asset relationship, that is a separate manifest
design and may require a schema bump. It is not smuggled into this pass.

## Concrete verification plan

Treat the interface as the test surface; avoid tests that reach through it to
assert private node names.

### Fast planner fixtures

- unchanged exact Principled and stock unlit materials produce `stock` with no
  private rewrite;
- a fingerprinted constant outline family lowers to stock unlit;
- a fingerprinted vertex-color family resolves named and active color layers
  per binding and partitions divergent bindings;
- a single changed link/node/constant invalidates the matcher and returns a
  named refusal;
- duplicate marker, stale socket identifier, Shader output, nested shared-tree
  marker, missing color attribute, and unresolved transparent alpha each return
  one exact artist-readable error;
- target-local traversal accepts an unrelated unconnected `Shader to RGB` node
  but rejects when the marked socket reaches it;
- `plan_materials` is byte-for-byte deterministic and leaves the complete
  Blender scene/material/object inventory unchanged.

### Headless Blender 5.2 fixtures

- export constant and vertex-color lowerings, then inspect the GLB for the
  expected `pbrMetallicRoughness`, `KHR_materials_unlit`, primitive `COLOR_0`,
  base-color factor, alpha mode, and non-white attribute values;
- bake a marked UV-driven procedural color with Cycles `EMIT`; assert constant
  corners, nonempty coverage, expected island padding, and a visibly different
  two-state fixture where appropriate;
- bake explicit scalar alpha separately, combine it after coverage processing,
  and verify cutout/blend silhouettes in Chromium;
- share one source material between Realtime and selected-socket objects;
  assert that only the compiled binding changes and that the source remains
  structurally identical;
- deliberately raise inside `emit`; assert source bindings/settings and the
  entire private object/material/image/scene inventory restore with no leak;
- modify a marker/UV after planning; assert stale-plan refusal before Cycles;
- use a linked/read-only material and get a loud make-local/override fix;
- run plan-only and prove no Cycles job or output file occurs;
- package the add-on/tarball and repeat through the installed copy, not only the
  source checkout.

Every bake-related test must also satisfy the repository's existing full bar:
build, Vitest, real tools, packed Vanilla/R3F consumers, add-on headless/archive,
and the two-state baked appearance/lighting e2e.

### Splash dogfood sequence

Use only the retained derivative, never overwrite the downloaded source:

1. Lower the simplest Outline constants/unlit vertex-color family and verify
   its alpha before broadening the matcher.
2. Lower one DPM binding through its resolved active vertex color. The retained
   source proves active color selection varies per mesh, so validate binding
   partitioning rather than force one scene-wide layer.
3. Mark a Cycles-compatible upstream output on `DP-SkyPaint.MAT`, bake it via
   Emit into an Appearance atlas, and leave the EEVEE-only lit result explicitly
   out of scope.
4. Keep untreated Bush/DPM families refused or loudly diagnosed. Do not weaken
   the collapse gate merely because some materials gained payload.
5. Verify the exact GLB contains real color payload and that affected primitive
   coverage/triangle counts match the plan; then run production Chromium and a
   visual comparison at the authored camera plus at least one revealing second
   view.

The retained source is
`artifacts/release-dogfood/blender-4-splash/fixtures/blender-4.0-splash-120f.blend`,
SHA-256
`7CD0993A56E55379DDDF2EFB786597061CCD78215C4207AC0B4E1EA4C666E050`.
Its current GLB is 39,659,276 bytes, contains 1,100,070 rendered triangles and
335 draws, and has no image/texture/GPU-texture payload. All 42 export-scoped
source material diagnostics are Needs Bake and 29 are Cycles Appearance
blocked. The exact GLB hash is
`F8F4DDC858D1F987A92E5F1B7942E146A9432BDBC8CE27B4D3978E4295FAF7A3`.
See the retained [Splash portability record](research-demo-material-portability-2026.md)
and [private save evidence](../artifacts/release-dogfood/blender-4-splash/evidence/private-save-stage.json).

## Exact installed evidence

Inspected locally:

- Blender `5.2.0 LTS`, build hash `fbe6228777e7`, built 2026-07-14;
- bundled glTF exporter `(5, 2, 39)` at
  `C:\Program Files\Blender Foundation\Blender 5.2\5.2\scripts\addons_core\io_scene_gltf2`;
- exporter SHA-256:
  - `__init__.py`: `0CD8903BD1A72EF1EDBD728BEE70D24A3ECC93C9901DB68927B00910BB38BE70`;
  - `materials.py`: `F0678496E6762566727FC9C76264C7D7665B2F22DEE4671B63CFEFE968ED5C31`;
  - `unlit.py`: `71A8DC2FDCB0B05EC4F4C52C15607B45F08B69F1553FDF6ABFAF891815FE5AA4`;
  - `search_node_tree.py`: `0C037D078DB37DA3B6D65054206A9F55D19FA5F8CA6542F5ADD614230C39F7E9`;
- Three npm `0.184.0`; its `GLTFLoader` declares
  `KHR_materials_unlit` support and returns `MeshBasicMaterial` for it;
- Blendlink package `0.8.0` in this workspace.

The read-only Splash probe also established:

- `DPM` and `DP-SkyPaint.MAT` each expose a top-level active vertex-color node
  with empty `layer_name` and a top-level group output that can be selected;
- `DPM`'s full Surface path reaches `Shader to RGB`, AO, procedural texture,
  and transparency, while its upstream vertex color is independently
  selectable;
- `DP-SkyPaint.MAT` uses active `Col` on its mesh and has a procedural group
  output that is a candidate for target-local Cycles validation;
- `Outline` has a smaller Hue/Saturation/Transparent family but still requires
  explicit alpha proof;
- `Node` custom properties work, `NodeSocket` custom properties do not, and
  socket identifiers/path resolution are available in this exact install.

## Primary sources

- [Blender glTF exporter manual][blender-gltf]
- [Official Khronos/Blender material gatherer][exporter-materials]
- [Official Khronos/Blender unlit detector][exporter-unlit]
- [Official Khronos/Blender node-search and vertex-color gatherer][exporter-search]
- [Blender Cycles baking manual][blender-baking]
- [Blender EEVEE-only node support][blender-eevee-nodes]
- [Blender Python `Node` interface][blender-node-api]
- [Khronos glTF 2.0 specification][gltf-spec]
- [Khronos `KHR_materials_unlit` specification][khr-unlit]
- [Three r184 `GLTFLoader` unlit implementation][three-unlit]

[blender-gltf]: https://docs.blender.org/manual/en/5.1/addons/import_export/scene_gltf2.html
[exporter-materials]: https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/addons/io_scene_gltf2/blender/exp/material/materials.py
[exporter-unlit]: https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/addons/io_scene_gltf2/blender/exp/material/unlit.py
[exporter-search]: https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/addons/io_scene_gltf2/blender/exp/material/search_node_tree.py
[blender-baking]: https://docs.blender.org/manual/en/5.0/render/cycles/baking.html
[blender-eevee-nodes]: https://docs.blender.org/manual/en/5.0/render/eevee/limitations/nodes_support.html
[blender-node-api]: https://docs.blender.org/api/5.0/bpy.types.Node.html
[gltf-spec]: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
[khr-unlit]: https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_unlit/README.md
[three-unlit]: https://github.com/mrdoob/three.js/blob/r184/examples/jsm/loaders/GLTFLoader.js#L791-L823
