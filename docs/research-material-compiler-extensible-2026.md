# Extensible staged material compiler, 2026

Research date: 2026-07-22

## Decision

Build one deep, Blender-side **Material Compiler** module with a two-phase
interface:

```python
plan = plan_materials(scene, export_objects, purpose="final")
result = realize_materials(scene, export_objects, plan)
```

`plan_materials` is the shared, non-mutating interface for the add-on and the
headless exporter. `realize_materials` is called only in Blendlink's disposable
export process, after the complete plan has no blocking errors. Callers do not
choose transforms, edit nodes, run Cycles, manage images, or interpret rule
priority.

Inside the module, a closed registry of proposal rules can recognize new graph
families without changing either caller. A rule may produce only one of four
terminal outcomes:

1. keep the stock glTF material;
2. construct a proven stock glTF PBR or `KHR_materials_unlit` graph on a private
   material copy;
3. materialize an explicitly selected, Cycles-evaluable color/value field with
   an Emit bake, then construct a stock glTF material; or
4. refuse with an artist-readable reason and fix.

Rules propose a small closed portable-material description. They never mutate
Blender data, call `bpy.ops.object.bake`, write images, modify the GLB, or emit
runtime shader code. Central execution owns those effects and delegates all
bake mechanics and image writes to the one canonical
[`bakelib.py`](../packages/blendlink/blender/bakelib.py). This preserves the
repository's single-source rule for bake primitives.

Do **not** expose arbitrary Python rule registration as a public product
interface yet. It would be a hypothetical seam with one implementation, make
rule ordering and cache identity third-party concerns, and let an unversioned
plug-in silently change Final output. The internal registry is radically
extensible for Blendlink's recognized transforms while the external interface
stays deep. Revisit a public extension seam only when two real external rule
providers exist and can be versioned, fingerprinted, and tested against the
same contract.

The first implementation should support only:

- stock glTF pass-through;
- provable constant unlit lowering;
- provable named vertex-color unlit lowering, resolving “active” to an exact
  attribute name during planning; and
- explicit selected-socket Cycles Emit materialization with opaque output.

Alpha is a separate semantic channel. A non-opaque material without a proven
constant, named vertex-color alpha, or explicitly selected alpha source must
refuse. It must never become opaque merely because the color route succeeded.

This compiler remains an asset compiler, not a renderer. Its outputs are
ordinary glTF PBR/unlit factors, vertex colors, and textures. The website keeps
ownership of its route, Canvas, renderer, presentation, and deployment.

## Evidence and exact versions inspected

### Installed implementation

The local implementation inspected is Blender **5.2.0 LTS**, build hash
`fbe6228777e7`, built 2026-07-14. Its bundled official glTF exporter reports
version **5.2.39** in:

`C:\Program Files\Blender Foundation\Blender 5.2\5.2\scripts\addons_core\io_scene_gltf2\__init__.py`

The relevant installed files and SHA-256 identities are:

| File | SHA-256 |
| --- | --- |
| `__init__.py` | `0CD8903BD1A72EF1EDBD728BEE70D24A3ECC93C9901DB68927B00910BB38BE70` |
| `blender/exp/material/materials.py` | `F0678496E6762566727FC9C76264C7D7665B2F22DEE4671B63CFEFE968ED5C31` |
| `blender/exp/material/unlit.py` | `71A8DC2FDCB0B05EC4F4C52C15607B45F08B69F1553FDF6ABFAF891815FE5AA4` |
| `blender/exp/material/pbr_metallic_roughness.py` | `1ECDD7CAA392D58234C444A428E2C4D8D6D4B673CA9CF5630FF50C6A94A04D56` |
| `blender/exp/primitive_extract.py` | `F3CA65FEC33FA15B0360A1621EC621D74CBBF7E42AB25405AA2CD8B798933261` |

Runtime evidence is from Three **0.184.0**, the package's installed and declared
version. The Blendlink package is **0.8.0**. The retained Splash GLB identifies
`Khronos glTF Blender I/O v5.2.39` as its generator.

Direct RNA introspection in this Blender build found:

- `bpy.ops.object.bake(type=...)` includes `EMIT` and accepts
  `target`, `margin`, `margin_type`, `use_clear`, and `uv_layer`;
- Blender nodes support ID properties; and
- the stock glTF operator defaults are `export_vertex_color="MATERIAL"`,
  `export_all_vertex_colors=True`, and
  `export_active_vertex_color_when_no_material=True`.

These exact installed-source facts matter more than a generic exporter
description. `materials.py` first calls `detect_shadeless_material`; when that
matches, it emits `KHR_materials_unlit`. Otherwise it gathers PBR Base Color,
Alpha, Metallic, Roughness, Emissive, Normal, Occlusion, and recognized KHR
extensions from specific sockets. `pbr_metallic_roughness.py` falls back to
white when no recognized Base Color factor is found. `unlit.py` recognizes a
narrow color-to-output shape with optional transparent/light-path wrappers.
The upstream official exporter source follows the same model: material output
is constructed from graph arrangements the exporter recognizes, not from an
arbitrary shader graph. [Official Blender/Khronos glTF exporter][gltf-exporter]

The exporter also has a consequential vertex-color behavior. With
`export_vertex_color="MATERIAL"`, a vertex-color node found in a recognized
material selects the named Blender color attribute and emits it as the
primitive's used `COLOR_n`. If no material consumes a color attribute but
`export_all_vertex_colors=True`, `primitive_extract.py` may reserve a synthetic
`COLOR_0` so the otherwise exported attributes do not unintentionally tint the
material. A lowering rule must therefore construct a recognized material graph
that names the intended attribute; merely preserving `COLOR_1` or changing the
active layer is not enough.

### Standards and official contracts

The Blender manual describes the exporter as supporting core metal/rough PBR
and shadeless `KHR_materials_unlit`, constructing the result from Blender nodes
it recognizes. It specifically documents Base Color through Principled and the
supported unlit graph arrangement. [Blender glTF manual][blender-gltf]

Core glTF defines Base Color as the product of factor, texture, and `COLOR_0`
when present; material alpha mode controls how alpha is interpreted.
[glTF 2.0 material specification][gltf-spec] `KHR_materials_unlit` reuses that
same Base Color and alpha contract while ignoring lighting-related PBR
properties. Alpha coverage and `doubleSided` still apply. It is ratified and is
explicitly intended for stylized or already-lit imagery.
[KHR_materials_unlit][gltf-unlit]

Cycles baking requires UVs and an active Image Texture or Color Attribute
target. Margins exist to protect UV seams under filtering and mipmapping.
[Blender Cycles baking][cycles-baking] Blender's node model also distinguishes
color/value fields from shader outputs: shaders describe light interaction,
while Emission turns a color into a shader. [Blender shader-node
introduction][shader-intro]

`Shader to RGB` is EEVEE-only and does not work in Cycles; it evaluates the
lighting of its input BSDF before converting it to color.
[Blender EEVEE node support][eevee-support] Therefore a selected-socket rule
may accept a Cycles-safe field *upstream* of a `Shader to RGB` node, but must not
claim or attempt to bake the `Shader to RGB` result through Cycles. Compatibility
must be computed from the selected socket's upstream dependency subgraph, not
from every node reachable from the material's active Surface.

### Existing Blendlink and Splash evidence

Current diagnosis lives in
[`procedural.py`](../packages/blender-addon/procedural.py). It walks only the
active Surface graph and reports stock-glTF portability separately from Cycles
Appearance compatibility. Current Appearance orchestration in
[`export_scene.py`](../packages/blendlink/blender/export_scene.py) freezes
separate evaluated receivers, temporarily attaches bake targets to their exact
material graphs, runs one native multi-object Cycles Combined bake, and
rebuilds generated unlit materials. Canonical graph fingerprinting, target setup, coverage,
packing, saving, and proxy ownership live in
[`bakelib.py`](../packages/blendlink/blender/bakelib.py).

The retained Splash evidence is documented in
[`research-demo-material-portability-2026.md`](research-demo-material-portability-2026.md):

- final GLB SHA-256
  `F8F4DDC858D1F987A92E5F1B7942E146A9432BDBC8CE27B4D3978E4295FAF7A3`;
- 33 of 33 used final materials and all 1,100,070 rendered triangles have
  **Needs Bake** source diagnostics;
- the GLB has no image, texture, or meaningful PBR/unlit payload;
- 29 used source materials are blocked from current Cycles Appearance by
  `Shader to RGB`; and
- the browser result is entirely grayscale while the Blender reference has
  substantial chroma.

A fresh, read-only Blender 5.2 inspection of the retained 120-frame derivative
also established:

- `DP-SkyPaint.MAT` has an outer Group `Result` RGBA output feeding the active
  Material Output and an Emission Viewer;
- `Outline` variants contain shared group output plus transparent/light-path
  wrapping;
- `Bush.006` includes Fresnel, Color Ramps, Object Info Random, Object
  coordinates, Noise, and multiple named vertex-color nodes; and
- exported bindings use heterogeneous color attributes such as `Col`, `Color`,
  `Color.001`, and `Attribute`, on both Point/Float and Corner/Byte domains.

That is direct evidence against a scene-wide “make the active color layer
`COLOR_0`” switch. The intended source is material-and-binding specific. It
must be resolved and validated for every exported mesh binding.

## Product and implementation constraints

Any interface must satisfy all of these constraints:

1. **Stock runtime output.** No custom Three shader, runtime node interpreter,
   generated website material installer, or Blendlink-owned renderer.
2. **No guessed semantics.** Automatic rules are limited to transformations
   whose output meaning is proven. Approximate transforms require explicit
   artist intent and name their loss.
3. **Explicit selected-socket materialization.** The artist selects the exact
   color/value source. Blendlink never picks the “best looking” socket.
4. **Separate color and alpha.** A successful color transform cannot erase
   authored transparency, clipping, or double-sided behavior.
5. **Private mutation.** Plan in the live file without mutation. Clone and
   transactionally mutate only the disposable export scene. Shared materials,
   node groups, meshes, and Realtime bindings must keep their ownership.
6. **Canonical bake mechanics.** All target creation, Emit configuration,
   coverage, alpha packing, color management, file save, and proxy mechanics
   are implemented once in `bakelib.py`.
7. **Loud failure.** Missing attributes, ambiguous node IDs, unsupported
   dependencies, UV overlap, rule conflicts, alpha uncertainty, output payload
   collapse, and post-export mismatch are blocking results, never fallbacks.
8. **Deterministic identity.** Rule ID/version, exact source reference, graph
   and attribute bytes, external image bytes, Blender version, bake settings,
   and compiler implementation participate in plan/job fingerprints.
9. **No casual schema reshape.** Initial intent lives in namespaced Blender
   material/node properties. Existing manifest diagnostics gain optional
   additive fields only. The generated runtime interface does not change.
10. **Application ownership.** `applicationMaterialAdapter` remains an explicit
    website-owned escape hatch. It is not a compiler rule and does not make an
    absent material payload valid compiler output.

Dependencies are **in-process** graph analysis and **local-substitutable**
Blender execution. The actual local stand-in is headless Blender with tiny
fixtures, not a hand-written fake renderer. No remote or true-external
dependency belongs at the Material Compiler interface.

## Designs compared

### Design A: public priority-based plug-in registry

```python
register_material_rule(rule, priority=100)
compile_material(material, context)
```

Every add-on or project could register a matcher and transform. The highest
priority match would win.

This maximizes theoretical flexibility but produces a shallow interface. A
caller or plug-in author must understand Blender graph traversal, export scope,
mutation lifetime, bake targets, ordering, conflicts, cache identity, alpha,
and generated-output verification. Priority makes behavior registration-order
dependent, and a plug-in upgrade can silently change Final bytes. Testing would
require every external rule/environment combination. It also invites arbitrary
node-to-runtime translation, which conflicts with the product boundary.

**Depth:** low. **Locality:** low. **Seam:** placed too early, at Blender graph
implementation details. **Decision:** reject for now.

### Design B: one ordered `if/elif` compiler

```python
def compile_material(material, directive):
    if is_stock_gltf(material): ...
    elif is_vertex_color_family(material): ...
    elif directive.socket: ...
    else: refuse(...)
```

This is initially simple and keeps effects centralized. Its external interface
can be small, but extension requires editing one growing decision tree. Match,
evidence, output construction, and error prose tend to interleave. “First
match wins” becomes hidden ordering, overlapping recognizers are difficult to
detect, and testing individual future graph families encourages tests past the
module's interface.

**Depth:** medium initially, falling as cases grow. **Locality:** one file but
poor conceptual locality. **Seam:** correctly Blender-side, but rule overlap is
not an explicit concept. **Decision:** acceptable spike, not the production
shape.

### Design C: closed proposal rules plus central two-phase executor

```python
plan = plan_materials(scene, objects, purpose="final")
result = realize_materials(scene, objects, plan)
```

Rules receive immutable graph/binding facts and return declarative proposals.
The planner validates directives, collects proposals by stage, rejects
conflicts, and creates one complete JSON-safe plan. The executor consumes only
that plan, rechecks its source fingerprint, constructs private Blender data,
delegates bake primitives to `bakelib.py`, and verifies the stock glTF payload.

Adding a future recognized transform means adding one internal rule that emits
the same closed portable description. Add-on, exporter, TypeScript runtime, and
website callers do not change. Rules cannot bypass alpha policy, image saves,
cache identity, or verification.

**Depth:** high. **Locality:** high; recognition is per rule, policy and effects
remain central. **Seam:** after Blender graph inspection but before mutation and
stock glTF gathering. **Decision:** recommend.

## Recommended interface

The external interface is deliberately Pythonic and small. Type sketches below
are normative about shape and invariants, not a requirement to expose these
exact classes publicly.

```python
Purpose = Literal["inspect", "preview", "final"]

@dataclass(frozen=True)
class MaterialPlan:
    plan_version: Literal[1]
    purpose: Purpose
    source_fingerprint: str
    decisions: tuple[MaterialDecision, ...]
    warnings: tuple[MaterialIssue, ...]
    errors: tuple[MaterialIssue, ...]

@dataclass(frozen=True)
class MaterialResult:
    plan_fingerprint: str
    decisions: tuple[RealizedDecision, ...]
    generated_materials: tuple[str, ...]
    generated_images: tuple[str, ...]
    warnings: tuple[MaterialIssue, ...]

def plan_materials(
    scene: bpy.types.Scene,
    objects: Iterable[bpy.types.Object],
    *,
    purpose: Purpose,
) -> MaterialPlan: ...

def realize_materials(
    scene: bpy.types.Scene,
    objects: Iterable[bpy.types.Object],
    plan: MaterialPlan,
) -> MaterialResult: ...
```

Interface invariants:

- `objects` is the already resolved export scope, including collection and
  render-visibility policy. The compiler never scans all material datablocks.
- `plan_materials` performs no mutation and returns all failures together.
- a plan has one decision for every used material binding; no implicit
  “unmatched means stock” behavior exists;
- `realize_materials` refuses a plan with errors, a different export scope, a
  changed source fingerprint, or a different compiler/Blender identity;
- realization is all-or-nothing for its Blender mutations and output files;
- `inspect` may report candidate routes but never materializes; `preview` and
  `final` use the same decisions and differ only in explicitly declared
  quality settings, never in semantics; and
- success means the generated stock material payload was observed in the
  exported GLB. A successful Blender node rewrite alone is not success.

The interface is the test surface. Tests pass fixture scenes through these two
functions and assert decisions, issues, generated glTF semantics, and source
state. Tests do not call individual match helpers.

## Internal rule and portable-description types

The internal rule seam exists so recognized transforms vary without exposing
that variability to callers:

```python
RuleStage = Literal["stock", "portable", "explicit", "refusal"]
Fidelity = Literal["exact", "field-preserved", "approximated"]

@dataclass(frozen=True)
class MaterialFacts:
    source: MaterialIdentity
    directive: MaterialDirective
    graph: GraphFacts
    bindings: tuple[BindingFacts, ...]
    animation: AnimationFacts
    external_dependencies: tuple[FileEvidence, ...]

@dataclass(frozen=True)
class RuleProposal:
    rule_id: str
    rule_version: int
    stage: RuleStage
    fidelity: Fidelity
    evidence: tuple[str, ...]
    limitations: tuple[str, ...]
    output: PortableMaterial | Refusal

class MaterialRule(Protocol):
    rule_id: str
    rule_version: int
    stage: RuleStage

    def propose(self, facts: MaterialFacts) -> RuleProposal | None: ...
```

`PortableMaterial` is intentionally **not** a general shader intermediate
representation. It can describe only stock glTF material semantics and fields
that central execution knows how to materialize:

```python
@dataclass(frozen=True)
class PortableMaterial:
    model: Literal["pbr", "unlit"]
    base_color: FieldSource
    alpha: AlphaSource
    alpha_mode: Literal["OPAQUE", "MASK", "BLEND"]
    alpha_cutoff: float | None
    double_sided: bool
    metallic: FieldSource | None = None
    roughness: FieldSource | None = None
    normal: FieldSource | None = None
    emissive: FieldSource | None = None

FieldSource = Constant | NamedVertexColor | ImageTexture | CyclesEmitField
AlphaSource = Opaque | Constant | NamedVertexColorAlpha | CyclesEmitField

@dataclass(frozen=True)
class CyclesEmitField:
    source: NodeOutputRef
    target: Literal["baseColor", "alpha", "emissive"]
    dependency_fingerprint: str
    uv_contract: MaterialUvContract
```

This closed vocabulary is the main guardrail. A rule can recognize arbitrarily
complicated authored input, but it must reduce that input to an interoperable
material result or refuse. It cannot smuggle a custom GLSL/TSL program through
the plan.

### Artist intent and selected socket identity

Initial intent should be stored in native Material/Node data with namespaced
properties, not in website configuration and not in a new manifest shape:

```text
Material.blendlink_material_route
    absent | "auto" | "stock-only" | "socket-emit" | "refuse"

Material.blendlink_material_source_path
    internal serialized list of stable node IDs from the material root

Material.blendlink_material_source_socket
    exact output socket identifier

Node["blendlink_material_source_id"]
    generated stable UUID used by the path
```

The add-on presents ordinary artist controls such as **Automatic**, **Keep
Stock glTF**, **Bake Selected Color**, and **Do Not Compile**. The serialized
path is hidden implementation data.

An output reference is `(group-instance path, node ID, socket identifier)`, not
`(node name, socket display name)`. Names are editable and nested node groups
may be instantiated more than once with different inputs. Duplicate IDs caused
by duplicating a node are detected and block until the add-on explicitly
repairs them. A stored reference that no longer resolves never falls back to a
similarly named socket.

For the first implementation, the UI may restrict selection to an output in
the active material's root node tree. The persisted type already supports a
group-instance path so nested selection can be added later without changing
the compiler interface. Nested realization must copy-on-write every shared
group along that exact instance path; it must never add an output to a shared
authored node group.

“Active vertex color” is also resolved at plan time to a concrete attribute
name for each binding. The plan fingerprints its domain, data type, length, and
bytes. If objects sharing one material resolve to different attributes, the
rule must either prove a private per-binding material/mesh split or refuse; it
must not let the stock exporter choose one implicitly. The installed exporter
itself warns about multiple materials selecting incompatible vertex colors,
so that case belongs in preflight.

## Registration, ordering, and conflicts

Registration is internal and build-time:

```python
RULES = validate_rule_registry((
    StockGltfRule(),
    ConstantUnlitRule(),
    NamedVertexColorUnlitRule(),
    SelectedSocketEmitRule(),
    RefusalRule(),
))
```

Rules use stable namespaced IDs such as:

- `blendlink.stock-gltf`
- `blendlink.unlit.constant`
- `blendlink.unlit.vertex-color`
- `blendlink.cycles-emit.selected-field`
- `blendlink.refuse.nonportable`

The registry rejects a duplicate `(rule_id, rule_version)`, an unknown stage,
or a rule able to emit an unknown portable field type. Registration order is
not policy and cannot select a winner.

Selection proceeds in these deterministic stages:

1. Validate the artist directive and selected source reference.
2. For `stock-only`, consider only the stock rule; refuse if stock output is
   not truthful.
3. For `socket-emit`, consider only the explicit selected-field rules. No
   automatic rule may replace the artist's chosen field.
4. For absent/`auto`, accept stock when the existing graph is already proven
   portable. Otherwise collect semantics-preserving portable proposals.
5. If no allowed rule proposes, use the refusal rule.

Within one stage, the planner evaluates every rule. Exactly one semantic
proposal may remain. Multiple byte-identical proposals may be coalesced while
retaining all evidence; two different outputs are a blocking
`material.rule-conflict`. There is no numeric priority and no first-match
behavior. A new rule therefore cannot silently steal a graph family from an
old rule.

Rule versions and the complete registry identity participate in plan and bake
fingerprints. Current `run_baked_mode` hashes only `export_scene.py` and
`bakelib.py` into its pipeline signature; implementation must add the Material
Compiler module/rule registry identity. Current bake dependency fingerprints
already cover node topology, socket defaults, images, evaluated mesh
attributes, and external files conservatively, but selected-source IDs,
directive bytes, rule version, and target channel must also be explicit inputs.

## Initial rule semantics

### `blendlink.stock-gltf`

Accept only when the current export-scoped analyzer proves that the active
material graph has a stock representation at the chosen fidelity policy. It
does not mutate the graph. “Exact” still means parameter representation, not
pixel identity across renderers.

### `blendlink.unlit.constant`

Recognize a color/value source only when the result is a literal constant under
a small, separately tested evaluator. Do not begin with an open-ended constant
folder across arbitrary nodes. Construct a private shadeless graph known to the
installed stock exporter and require the final GLB to contain
`KHR_materials_unlit` plus the expected factor and alpha/double-sided state.

### `blendlink.unlit.vertex-color`

Recognize a direct named vertex-color color source, optionally multiplied by a
literal constant, only when every binding has the exact attribute and a
compatible alpha contract. Construct a private shadeless graph that names that
attribute. Verify the final primitive uses nontrivial `COLOR_0` data and the
material has `KHR_materials_unlit`.

Do not equate “a color attribute exists” with a match. Domain conversion,
missing values, multiple material slots selecting incompatible attributes,
evaluated-geometry attribute loss, and alpha differences are refusal cases
until explicitly supported.

### `blendlink.cycles-emit.selected-field`

This rule is eligible only for the explicit `socket-emit` directive. It walks
upstream from the selected output and rejects:

- shader-typed output instead of color/value;
- `Shader to RGB`, or another node unavailable to Cycles, in the selected
  dependency subgraph;
- time/driver/material-property animation not deliberately frozen by a stated
  contract;
- camera, incoming ray, AO, shadow, screen-space, or compositor dependence;
- Object/Generated/Position/Normal dependence whose semantics would change
  under the selected receiver/UV execution route;
- unresolved images, sequences, UDIM volatility, OSL, or other untracked file
  dependencies;
- absent/non-injective target UVs or insufficient margin; and
- unresolved alpha.

The rule may ignore an EEVEE-only node that is downstream from, or unrelated
to, the selected source. This is what makes an upstream intrinsic-color bake
truthful even when the complete Splash surface is not Cycles-compatible.

Central execution clones the material, connects the selected color/value to a
private Emission surface, installs the canonical active target, and runs an
`EMIT` bake. For color plus alpha it runs separately attested channel jobs and
packs them centrally; a rule never writes an image. Saved color bytes follow
Blendlink's Standard/None/0 contract through the private save scene, and
uncovered texels receive the existing one-constant background only after every
lossy stage. The output becomes an ordinary stock unlit or PBR texture and is
embedded by the stock exporter for the initial implementation, avoiding a new
companion-asset manifest contract.

This route promises only the selected field. Its diagnostic must state that it
does not preserve downstream Shader-to-RGB lighting, AO, cast shadows, Filmic,
view curves, compositor film grain, or chromatic dispersion.

## Atomic realization and safe mutation

`realize_materials` owns a transaction with these phases:

1. Re-resolve export scope and recheck the plan fingerprint.
2. Preflight every rule, source, attribute, UV, output path, image budget, and
   alpha requirement for the complete scene.
3. Clone every affected material and any mesh/node-group that requires unique
   ownership. Do not bind clones yet.
4. Build all stock graphs and Emit proxy graphs on those private copies.
5. Run all required bake jobs through `bakelib.py`; save to staging paths and
   validate coverage/nonempty bytes.
6. Bind generated materials only after every job succeeds.
7. Run the stock glTF exporter.
8. Inspect the exact GLB and require the planned PBR/unlit, texture,
   `COLOR_0`, alpha, and source-provenance payload.
9. Publish staged files atomically. On any exception, restore bindings and
   remove private datablocks/staging files in `finally`.

The source `.blend` is already opened in a disposable background process, but
transactional ownership is still required. A material can be shared by a
Realtime object and a compiled object, node groups can be shared across
materials, and tests need to prove that a failed job does not contaminate a
later job in the same process.

Generated material extras should carry optional namespaced provenance such as
`blendlink_source_material` and `blendlink_material_rule`. These extras are not
required by the runtime; they let post-export verification map renamed private
materials back to source diagnostics without relying on Blender's `.001`
suffixes.

## Error interface

Every issue has a stable code plus artist-readable text:

```python
@dataclass(frozen=True)
class MaterialIssue:
    code: str
    severity: Literal["warning", "error"]
    material: str
    used_by: tuple[str, ...]
    affected_draws: int | None
    affected_triangles: int | None
    problem: str
    evidence: tuple[str, ...]
    fix: str
```

Initial blocking codes should include:

- `material.source-missing`
- `material.source-ambiguous`
- `material.source-type-unsupported`
- `material.rule-conflict`
- `material.rule-registry-invalid`
- `material.cycles-node-unsupported`
- `material.source-view-dependent`
- `material.source-animated`
- `material.attribute-missing`
- `material.attribute-binding-conflict`
- `material.uv-missing`
- `material.uv-overlap`
- `material.alpha-unresolved`
- `material.external-dependency-missing`
- `material.plan-stale`
- `material.bake-empty`
- `material.output-mismatch`
- `material.no-portable-route`

Examples:

> `Bush.006`: Bake Selected Color is blocked because the selected `Result`
> depends on Object Info Random and Object coordinates across unrealized
> Geometry Nodes instances. Realizing those instances would change their
> random identity. Select an upstream named color
> attribute, author UV-stable color, or keep this material application-owned.

> `Outline.001`: the planned `Color.001` field is absent on 3 of 14 exported
> mesh bindings. No fallback attribute was chosen. Add that attribute to the
> named meshes or assign a separate material.

> `DP-SkyPaint.MAT`: material output verification failed. The plan required
> `KHR_materials_unlit` with a Base Color texture, but the final GLB material
> contains neither. The staged artifact was not published.

## Usage

### Add-on inspection

```python
plan = material_compiler.plan_materials(
    scene,
    validation.visible_export_objects(scene),
    purpose="inspect",
)
cards.extend(material_cards(plan))
```

The Material panel shows the selected route, rule ID/version, exact source,
what is preserved, what is intentionally omitted, and every blocking binding.
The caller does not interpret node types.

### Headless export

```python
objects = export_scope(scene, settings)
plan = material_compiler.plan_materials(scene, objects, purpose="final")
if plan.errors:
    raise RuntimeError(format_material_errors(plan.errors))

material_result = material_compiler.realize_materials(scene, objects, plan)
export_with_stock_gltf(...)
verify_material_result(material_result, out_glb)
```

The actual implementation may place final-GLB verification inside
`realize_materials` by accepting a central export callback. It should not make
the stock exporter or filesystem a caller-configurable strategy; there is one
production implementation and one real headless test route.

### Adding a future recognized transform

A future Hue/Saturation-over-named-vertex-color rule implements
`MaterialRule.propose`, proves the exact supported node topology and parameter
range, and returns an unlit `PortableMaterial`. It cannot alter execution or
runtime code. If it overlaps the existing vertex-color rule but proposes a
different result, the fixture fails with `material.rule-conflict` until the
recognizers are made disjoint or the proposals become identical.

## Dependency strategy and adapters

| Dependency | Category | Strategy |
| --- | --- | --- |
| active-graph and selected-subgraph inspection | In-process | Keep inside the Material Compiler; immutable facts feed rules |
| rule registry and conflict policy | In-process | Private implementation; test through `plan_materials` |
| private material/node/mesh construction | Local-substitutable | Execute in headless Blender fixtures; no external port |
| Cycles Emit execution | Local-substitutable | Real Blender/Cycles fixture is the stand-in; GPU/CPU is an execution detail |
| packing, coverage, save, alpha merge | Local-substitutable | Canonical `bakelib.py`; do not create a second adapter or copy |
| stock glTF serialization | Local-substitutable | Bundled official exporter; verify exact GLB output |
| website renderer | Outside the module | No dependency; output is ordinary glTF |

There is no benefit in an external `BakeBackend` interface today. A fake that
returns pixels cannot validate Blender node evaluation, UV targeting, or the
stock exporter. Internal tests may use a recording executor to force rollback
branches, but that is an internal seam; the behavior contract remains proven
with real headless Blender.

## Module placement and hidden implementation

Recommended ownership:

- `packages/blender-addon/material_compiler.py`: the deep module, graph facts,
  directive resolution, internal rules, conflict policy, plan/result/error
  types, private graph construction, transaction orchestration, and final
  material-payload attestation;
- `packages/blendlink/blender/bakelib.py`: the only implementation of Emit bake
  configuration, target plumbing, material proxy mechanics, UV/coverage,
  channel packing, Standard/None/0 writes, background flatten, and cleanup;
- `packages/blender-addon/procedural.py`: delegates material diagnostics to
  `plan_materials`; retains geometry/procedural analysis instead of keeping a
  second material classifier;
- `packages/blendlink/blender/export_scene.py`: resolves export scope, invokes
  the two public functions, and reports results; it does not grow rule logic;
- `packages/blendlink/scripts/copy-assets.mjs`: copies
  `material_compiler.py` beside the exporter, like the existing shared add-on
  modules; and
- TypeScript: reads optional diagnostic evidence and continues to verify the
  exact final GLB. No runtime material installer is generated.

This passes the deletion test: deleting the module would spread graph
recognition, selected-source identity, rule conflicts, mutation ownership,
Emit orchestration, and output attestation back across add-on validation and
the exporter. Its small interface earns substantial leverage and keeps changes
local.

## Manifest and migration plan without reshape

The current manifest contract is `schemaVersion: 3` and is additive-only
within that version. Initial implementation does not add a required top-level
field and does not change the generated runtime binding.

1. Add optional fields to each existing
   `sceneDiagnostics.materials.records[]` item:

   ```json
   {
     "compilation": {
       "status": "stock | lowered | materialized | refused",
       "rule": "blendlink.unlit.vertex-color",
       "ruleVersion": 1,
       "fidelity": "exact | field-preserved | approximated",
       "sourceFingerprint": "...",
       "limitations": []
     }
   }
   ```

   Missing `compilation` means a pre-feature manifest. This is additive and
   does not require a schema bump.

2. Store new authoring intent only in namespaced Material/Node properties in
   the `.blend`. Do not add website config keys or a runtime requirement.

3. Tag generated glTF material extras with optional namespaced provenance.
   Core glTF permits application-specific `extras`; readers that do not know
   them ignore them. [glTF extension guidance][gltf-extensions]

4. Existing files with no directive remain `auto`: stock exact materials pass,
   only proven automatic rules run, and every other graph retains the current
   loud **Needs Bake**/collapse behavior.

5. Keep `applicationMaterialAdapter` unchanged. A successful lowering should
   make Splash's collapse acknowledgement unnecessary; an adapter remains an
   explicit application-owned alternative, not a migration fallback.

If future work needs a required material artifact graph outside the GLB or
changes the meaning/shape of existing diagnostic fields, that is a manifest
schema change and must bump `schemaVersion` rather than hiding behind this
additive migration.

## Concrete verification plan

### Planner interface tests in real Blender

Create tiny materials and assert only through `plan_materials`:

1. stock Principled returns `blendlink.stock-gltf`;
2. direct constant color returns `blendlink.unlit.constant`;
3. direct named vertex color returns `blendlink.unlit.vertex-color` with the
   concrete attribute name and bytes fingerprint;
4. unknown Mix/Shader graph refuses;
5. two overlapping non-identical proposals produce `material.rule-conflict`
   independent of registry order;
6. duplicate rule IDs fail registry construction;
7. missing, duplicated, renamed, and wrong-type selected outputs refuse;
8. a selected Cycles-safe upstream color succeeds even when a downstream
   `Shader to RGB` exists;
9. selecting the `Shader to RGB` output refuses;
10. camera, Light Path, AO, Object Info Random, Object/Generated coordinates,
    and animated selected dependencies refuse under the initial route;
11. a named color attribute missing on one binding refuses the whole material;
12. incompatible per-material vertex-color choices on one mesh refuse;
13. non-opaque input without proven alpha refuses; and
14. export collection/render visibility limits the diagnosis to actual scope.

### Realization tests in real Blender

1. constant and vertex-color rules export stock `KHR_materials_unlit`;
2. meaningful source data is the used `COLOR_0`, not the synthetic white
   placeholder; decode and assert nonconstant values;
3. an explicit color source bakes through `type="EMIT"` to the expected UV and
   exports a Base Color texture;
4. alpha Mask/Blend fixtures preserve alpha mode, cutoff, coverage, and
   double-sided state, or refuse when unresolved;
5. source material, node tree, group, mesh attributes, selection, active
   object, render engine, color management, output format, and scene inventory
   are structurally identical before/after plan and after a forced failure;
6. generated PNG/EXR bytes use the existing private save scene and no private
   datablocks leak;
7. a forced second bake-job failure publishes no first-job outputs and restores
   all bindings;
8. graph, directive, attribute, external image, rule-version, or compiler-byte
   changes invalidate the job fingerprint;
9. two unchanged runs produce identical planned decisions and, where Blender's
   evaluated UV path is deterministic, identical image/GLB bytes; and
10. final GLB attestation deliberately fails when the planned unlit extension,
    texture, alpha, or provenance is removed.

### Splash dogfood sequence

Use only the disposable 120-frame derivative; keep the downloaded original
hash unchanged.

1. Lower the simplest outline/constant families to stock unlit. Verify the
   exact final material/triangle coverage moved from refused to lowered.
2. Lower one direct named/active vertex-color family. Resolve active to the
   exact attribute name per binding; require meaningful `COLOR_0` bytes.
3. Materialize one explicit upstream color field on `DP-SkyPaint.MAT` or the
   `Grid.001` binding. Do not select or claim the Shader-to-RGB lit result.
4. Add alpha only after a separate source and browser silhouette check prove
   it. Until then affected transparent families remain loud refusals.
5. Re-run exact compiled-material audit. The all-used/all-default collapse gate
   must remain active for untreated families and disappear only when actual
   payload coverage warrants it.
6. Run the production packed consumer and browser gate. Require exact asset
   HTTP/hash, live WebGL, nonblank Canvas, no page/console errors, and restored
   chroma. Treat chroma restoration as field evidence, not full Blender pixel
   parity; Filmic, compositor, AO, and Shader-to-RGB lighting remain separate.
7. Run the full add-on/headless/archive and package gates plus `git diff
   --check`.

## Tradeoffs and release boundary

The recommended design deliberately pays for a planner, closed output
vocabulary, and conflict detection before adding many transforms. That is more
implementation than an `if/elif` spike, but it yields the right leverage:

- artists see one consistent decision and fix across Blender UI and Final;
- Web Developers receive only ordinary glTF and no new runtime obligation;
- future graph-family work is local to one rule and its interface tests;
- bake/color/alpha mechanics remain centralized in `bakelib.py`;
- new rules cannot win through accidental ordering; and
- post-export evidence, rather than a successful mutation, defines success.

The boundary is equally important. This module should not grow arbitrary
procedural-node translation, EEVEE screen-space emulation, compositor
compilation, or TSL/GLSL output. A future rule is justified when it can reduce a
named, tested Blender graph family to standard glTF semantics or a deliberately
selected field. Everything else stays a loud refusal, an Appearance route when
Cycles can truthfully evaluate it, or an explicit application-owned adapter.

## Primary sources and local anchors

- [glTF 2.0 specification][gltf-spec]
- [Ratified `KHR_materials_unlit` specification][gltf-unlit]
- [Khronos glTF extension registry/guidance][gltf-extensions]
- [Blender glTF exporter manual][blender-gltf]
- [Official Blender/Khronos glTF exporter source][gltf-exporter]
- [Official PBR gatherer source][gltf-pbr]
- [Official unlit detector source][gltf-unlit-source]
- [Blender Cycles baking manual][cycles-baking]
- [Blender shader-node introduction][shader-intro]
- [Blender EEVEE node support][eevee-support]
- Current Blendlink material analysis:
  [`procedural.py`](../packages/blender-addon/procedural.py)
- Canonical Blendlink bake mechanics:
  [`bakelib.py`](../packages/blendlink/blender/bakelib.py)
- Current bake/export orchestration:
  [`export_scene.py`](../packages/blendlink/blender/export_scene.py)
- Existing material-collapse audit:
  [`compiledSceneAudit.ts`](../packages/blendlink/src/compiledSceneAudit.ts)
- Existing Final collapse policy:
  [`sync.ts`](../packages/blendlink/src/sync.ts)
- Retained Splash evidence:
  [`research-demo-material-portability-2026.md`](research-demo-material-portability-2026.md)

[gltf-spec]: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#materials
[gltf-unlit]: https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_unlit/README.md
[gltf-extensions]: https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md
[blender-gltf]: https://docs.blender.org/manual/en/5.1/addons/import_export/scene_gltf2.html
[gltf-exporter]: https://github.com/KhronosGroup/glTF-Blender-IO
[gltf-pbr]: https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/addons/io_scene_gltf2/blender/exp/material/pbr_metallic_roughness.py
[gltf-unlit-source]: https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/addons/io_scene_gltf2/blender/exp/material/unlit.py
[cycles-baking]: https://docs.blender.org/manual/en/5.0/render/cycles/baking.html
[shader-intro]: https://docs.blender.org/manual/en/5.0/render/shader_nodes/introduction.html
[eevee-support]: https://docs.blender.org/manual/en/5.0/render/eevee/limitations/nodes_support.html
