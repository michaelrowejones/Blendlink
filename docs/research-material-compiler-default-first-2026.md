# Default-first portable material compilation, 2026

Research date: 2026-07-22

Status: the constant and vertex-color selected-field core is implemented and
locally verified. Existing-image and Cycles Emit transports remain future work.

## Decision

Add one deep **Material Compiler** module at the Blender export seam. Its
default is still to preserve the artist's active Surface graph through
Blender's stock glTF exporter. It may automatically lower a graph only when it
can prove that the complete active Surface is equivalent to a small standard
glTF normal form. When that proof is impossible, the artist can identify the
intended intrinsic web color through a visible, disconnected **Blendlink Web
Color** sink node. The compiler chooses the cheapest faithful transport for
that selected field: a factor, `COLOR_0`, an existing image, or a Cycles Emit
materialization on the existing Appearance-atlas path.

The source selection is explicit; the transport choice is implementation. A
materialized selected field must be reported as **Selected field**, never as
full Blender-surface parity. `Shader to RGB`, lighting, AO, shadows, Filmic,
and compositor treatment do not become part of that claim unless a later,
separately evidenced compiler path supports them.

Do not add a material-name-to-node-name mapping to `blendlink.config.mjs`, do
not persist node/socket names, and do not add a website runtime shader. The
compiled output remains ordinary glTF PBR or
[`KHR_materials_unlit`][khr-unlit], so the website retains its route, Canvas,
renderer lifecycle, loading UI, framework, analytics, and deployment.

## Implementation update

Blendlink now has one package-owned `material_compiler.py` with a read-only
plan followed by scoped realization around the stock glTF exporter. Plan-only,
Preview, and Final use the same decisions. The implemented selected-field
normal forms are an unlit constant factor and an unlit direct Color/Alpha
attribute. Unknown conversions, missing or evaluated-only attributes,
unsupported binding types, ambiguous markers, and unproved transparency block
before export with an artist-readable fix.

The implementation uncovered a Blender 5.2 exporter failure that the earlier
single-material prototype did not exercise. When two material slots selected
the same color layer, the installed `primitive_extract.py` constructed a second
lookup key such as `AttributeAttribute` instead of reusing the first
`COLOR_0`. Its `export_all_vertex_colors` fallback could then overwrite the
material-to-color mapping with another layer. The affected primitive was
syntactically valid but its `COLOR_0` values were all white. Setting
`export_all_vertex_colors=False` fixed only one of the two slots, so that flag
alone was rejected as a correctness strategy.

Blendlink now materializes each selected source layer as a compiler-private
VEC4 carrier attribute on the disposable mesh and asks the stock exporter to
preserve custom attributes. After export, the compiler atomically rewrites each
generated-material primitive to point standard `COLOR_0` at its exact carrier
accessor, removes every private carrier semantic, and only then attests the
GLB. This keeps Blender's primitive splitting and accessor construction while
not trusting its broken per-material color lookup. No
`_BLENDLINK_WEB_*` semantic is allowed to escape into the final artifact.
The compiler records whether custom-attribute export was already application
intent. When it enables that exporter option only for its carrier, it strips
unrelated custom semantics afterward; when the application explicitly requested
custom attributes, those application-owned semantics are retained.

The Blender-side attestation proves exactly one generated material, no shipped
source fallback, `KHR_materials_unlit`, base-color factor, alpha mode,
double-sided state, binding and mesh ownership, primitive count, `COLOR_0`
presence/type/count, finite values, and the selected numeric range. The
TypeScript final-document pass repeats those facts after image resizing, KTX2,
and optional Meshopt. A transform that drops, changes, whitens, or rebinds the
selected data therefore blocks publication instead of leaving stale evidence
in the manifest.

Headless Blender regression coverage includes two material slots sharing one
source color layer, multiple selected source layers, shared meshes, collection
instances, shape keys/actions, generated-material setup failure, exporter
omission, cleanup failure, and both sides of custom-attribute ownership. The
planner also refuses selected materials that exist only through evaluated
Geometry Nodes on non-Mesh/Curve bindings. Focused real Blender 5.1 and 5.2
suites pass. This is implementation evidence for the direct factor/vertex
routes; it is not evidence for selected-socket Emit, arbitrary graph lowering,
or complete EEVEE appearance.

## Why this seam is the right one

The artist's material graph is where intent exists. The disposable background
Blender export scene is where graph inspection, private substitution, UV
materialization, and stock glTF export can occur without mutating that intent.
The GLB is where application ownership begins.

That gives the Material Compiler one external interface:

```python
def compile_export_materials(
    bindings: Sequence[ExportMaterialBinding],
    context: MaterialCompileContext,
) -> MaterialCompileReport:
    """Return generated bindings/assets/evidence or loud blocking issues."""
```

`bindings` contains only the actual active-Scene, active-View-Layer export
scope. `context` is compiler-owned and carries the existing atlas plan, bake
quality, artifact staging directory, and Blender/exporter version. Callers do
not choose graph walkers, generated-node shapes, bake passes, image packing,
or cache keys.

This is a deep module: one interface hides graph normalization, exact-family
matching, source-marker resolution, direct glTF lowering, Cycles compatibility,
per-binding material copies, alpha packing, cache invalidation, stock-exporter
verification, and artist-readable diagnostics. Deleting it would spread those
rules across the add-on UI, `procedural.py`, `export_scene.py`, config parsing,
and website adapters; its **Depth** is therefore real.

## Installed versions and exact inspected sources

- Blender: `5.2.0 LTS`, build hash `fbe6228777e7`, built 2026-07-14.
- Bundled glTF exporter: `Khronos glTF Blender I/O v5.2.39`, installed at
  `C:\Program Files\Blender Foundation\Blender 5.2\5.2\scripts\addons_core\io_scene_gltf2`.
- Three: npm `0.184.0`; the installed loader is
  `node_modules/three/examples/jsm/loaders/GLTFLoader.js`.
- Blendlink dogfood package: `0.8.0`; retained tarball SHA-256
  `AEDCC65DA7D527DECE05EDB14FC903C6B147BF5CE14089ECE94FEFA8AE0A2B89`.
- Splash derivative: SHA-256
  `7CD0993A56E55379DDDF2EFB786597061CCD78215C4207AC0B4E1EA4C666E050`.
- Splash compiled GLB: SHA-256
  `F8F4DDC858D1F987A92E5F1B7942E146A9432BDBC8CE27B4D3978E4295FAF7A3`.

The exact installed exporter source was inspected, not inferred from an old
manual:

- `pbr_metallic_roughness.py:63-125` looks for recognized Base Color and Alpha
  sockets, gathers constants or color attributes, and otherwise falls back to
  white. The corresponding first-party source is
  [Khronos glTF-Blender-IO's PBR gatherer][gltf-pbr-source].
- `search_node_tree.py:454-499,725-746` recognizes constant multiplication and
  named or active Vertex Color/Attribute nodes. A blank color-attribute name
  means the mesh's active render color attribute. The corresponding source is
  [the official node-tree search implementation][gltf-search-source].
- `unlit.py:15-67,70-119` recognizes a deliberately narrow shadeless graph and
  optional transparent mix. The corresponding source is
  [the official unlit gatherer][gltf-unlit-source].
- `primitive_extract.py` decides which mesh color attribute becomes `COLOR_0`.
  The installed 5.2.39 path around lines 641-642 can construct a repeated
  attribute key for a later material slot, while the fallback around lines
  824-840 can replace the material mapping when all vertex colors are exported.
  A real two-slot Splash binding proved that the result can be an all-white
  `COLOR_0`; this is the reason for Blendlink's private carrier and exact
  numeric attestation. See [the official primitive extractor][gltf-primitive-source].

The Blender manual likewise says the exporter constructs Metal/Rough PBR or
unlit materials from node arrangements it recognizes, and documents Material,
Active, Name, and None vertex-color export modes.
[Blender glTF exporter manual][blender-gltf]

The output contract is standards-backed. Core glTF defines `COLOR_n` as a
linear RGB/RGBA multiplier and says `COLOR_0` multiplies base color. RGB in a
base-color texture is sRGB encoded while its alpha is linear coverage.
[glTF 2.0 geometry and material specification][gltf-spec] The ratified unlit
extension uses base color, alpha, and vertex color while ignoring lighting;
it explicitly cites stylized hand-drawn work as a use case.
[KHR_materials_unlit][khr-unlit] Three r184 maps that extension to
`MeshBasicMaterial` and enables vertex colors when `COLOR_0` is present.
[Three r184 GLTFLoader][three-loader]

## Current Splash evidence

The retained artifact is not merely imperfect. It has complete material
payload collapse:

- 42 export-scoped source material records are all **Needs Bake**;
- 29 are blocked from current Cycles Appearance by `Shader to RGB`;
- all 33 materials used by the GLB and all 1,100,070 rendered triangles are
  affected;
- the GLB contains zero images, zero textures, no meaningful PBR factors, no
  emissive payload, and no unlit extension;
- the stock exporter therefore created white-default materials, and the
  retained browser image is entirely grayscale.

The exact final-artifact families are:

| Family | Rendered triangles | Share | Relevant recovery |
| --- | ---: | ---: | --- |
| Bush + Fresnel/Shader-to-RGB family | 717,417 | 65.22% | explicit upstream intrinsic field first; full stylized shading remains unsupported |
| DPM/roof/plant Shader-to-RGB family | 231,622 | 21.06% | selected active/named vertex color can lower directly where the artist accepts base color |
| Outline family | 105,170 | 9.56% | exact constant/attribute unlit normalizer where full alpha semantics are proven |
| `DP-SkyPaint.MAT` | 42,632 | 3.88% | explicit `Group.Result` color through Cycles Emit on its one bound mesh |
| remaining variants | 3,229 | 0.29% | refuse until separately classified |

The material `DPM` alone covers 48,902 triangles. Its root blank Vertex Color
node feeds the stylized group's `input`; every inspected bound mesh has a
render color attribute. Choosing that upstream node does not reproduce
Shader-to-RGB/AO/noise/grain, but it is an understandable artist choice for an
intrinsic base-color publication and avoids a texture bake.

The active Outline graph is a small nested unlit color/transparency group, but
not every Outline is identical. `Outline` is an opaque constant dark color;
`Outline.001` drives transparency from a separate `Color.001` attribute. The
latter cannot be called exact until the compiler proves Blender's color-to-
factor conversion and packs the selected alpha into export-owned `COLOR_0`
RGBA on a mesh copy. Matching a family name is not sufficient.

`DP-SkyPaint.MAT` has one exported binding and a top-level `Group.Result`
color output. Its dependency graph is Cycles-compatible, even though it uses
procedural Object coordinates, noise, Voronoi, ramps, and HSV. This is the
best first explicit socket-bake case because it avoids shared-material and
per-object Object Info ambiguity.

The deeper diagnosis and artifact identity are retained in
[`research-demo-material-portability-2026.md`](research-demo-material-portability-2026.md).

## Fresh local prototypes that preceded implementation

Three Blender 5.2 prototypes were run against the installed exporter during
the initial research. They remain useful design evidence, but the direct
constant and vertex-color paths described above are now production package
code. The prototype's single-material success was not sufficient evidence for
multi-material meshes; the later regression is what found the exporter defect.

### Persistent source marker

An input-only Shader Node Group instance was created with `Base Color` and
`Alpha` inputs, no outputs, and the namespaced node property
`blendlink_material_source_version = 1`. A Color output was linked into it,
the `.blend` was saved and reopened, and Blender preserved:

```json
{
  "version": 1,
  "inputs": [
    ["Base Color", "Socket_0", true, [["Color", "Color"]]],
    ["Alpha", "Socket_1", false, []]
  ],
  "outputs": 0,
  "tree": "Blendlink Web Color"
}
```

This is a stronger persistent reference than `(node.name, socket.name)`:
renaming either endpoint does not break a Blender node link, and the artist can
see the selected source in the Shader Editor.

### Direct vertex-color lowering

A generated private material connected a blank Vertex Color node to Background
and Material Output, while retaining a disconnected Web Color marker. The
stock exporter produced:

```json
{
  "asset.generator": "Khronos glTF Blender I/O v5.2.39",
  "extensionsUsed": ["KHR_materials_unlit"],
  "primitive.attributes": { "POSITION": 0, "NORMAL": 1, "COLOR_0": 2 },
  "material.extensions": { "KHR_materials_unlit": {} }
}
```

The marker did not pollute the exported material. More importantly, the
artist's real color attribute became `COLOR_0`; the exporter did not create the
white placeholder that caused the Splash symptom.

### Direct alpha lowering

A second private material used the exporter's recognized Transparent + color
mix, with the same vertex-color RGB and alpha. The result retained
`KHR_materials_unlit`, meaningful `COLOR_0`, and added
`material.alphaMode: "BLEND"`. This proves the smallest direct RGBA path. It
does not yet prove separate-attribute packing, alpha cutoff, sorted blended
layers, or Splash silhouettes; those remain required acceptance tests.

The existing controlled EEVEE/Cycles experiment independently measured a
Cycles Emit bake of portable color at 256 px: 0.008 s, flat-region RMSE
0.000411 against the EEVEE raster result, with edge differences deliberately
excluded. It also proved that EEVEE can capture Shader to RGB, but did not prove
margins, alpha, coordinate dependencies, or production integration.
[`eevee-uv-materializer-prototype`](../experiments/eevee-uv-materializer-prototype/README.md)

The retained Splash private-save test proves that `bakelib.py` can write PNG
and EXR without structurally changing the artist's FFMPEG/Filmic scene or
leaking the private save scene.
[`private-save-stage.json`](../artifacts/release-dogfood/blender-4-splash/evidence/private-save-stage.json)

## Design alternatives

### A. Visible Web Color sink node — recommended

**Interface.** The artist links `Base Color` and optionally `Alpha` into one
input-only node. A single namespaced version property identifies the node;
Blender links identify the sockets. No website config is required.

**Usage.** Select a source node/output and click **Use as Web Color** in the
Blendlink Shader Editor panel, or connect it manually to the visible sink. The
Material Properties panel reports the computed result: **Direct constant**,
**Direct vertex color**, **Bake selected field**, or a blocking reason.

**Implementation hidden behind the seam.** Graph normalization, exact-family
matching, factor/attribute extraction, private material construction, alpha
packing, Cycles Emit, atlas use, and stock-GLB verification.

**Depth and Leverage.** The artist learns one semantic action: identify the
field that should be web color. The compiler can improve transport later
without changing authored intent. The same implementation pays back in the
add-on, CLI, preview, publish, verification, and every application.

**Locality.** Intent stays with the material in Blender. All lowering and bake
behavior stays in the package. The website receives only portable assets.

**Seam placement.** Correct: artist graph → disposable compiler → standard
GLB. The marker is invisible to the active Surface and to the runtime.

**Tradeoff.** It adds one visible scratch/sink node. That is useful clutter: it
shows exactly what will publish. Linked library materials must be made local or
overridden before the marker can be authored.

### B. Material properties storing node and socket strings

**Interface.** Material Properties exposes a route enum and stores
`blendlink_material_node`, `blendlink_material_socket`, and alpha equivalents.

**Usage.** Pick a node and socket from dropdowns. The graph remains visually
unchanged.

**Implementation hidden.** Similar compiler work to A, plus reference repair,
rename handling, group-path serialization, and ambiguity resolution.

**Depth and Leverage.** The panel looks compact, but the interface is shallow:
artists and tests must understand names, nested group paths, socket labels
versus identifiers, and repair rules.

**Locality.** Worse than A. A graph edit and its hidden string reference can
drift separately. Duplicating a node or group creates ambiguous identities.

**Seam placement.** Material-local, but beside rather than in the graph that
defines the value.

**Decision.** Reject. The local save/reopen prototype demonstrates that a real
node link already solves the reference problem more robustly.

### C. Website config mapping material names to graph paths

**Interface.** A scene config adds a mapping such as
`materials: { DPM: { color: { node: "Color Attribute", output: "Color" } } }`.

**Usage.** A developer edits JavaScript rather than the `.blend`.

**Implementation hidden.** Very little; callers must know Blender names and
lowering choices.

**Depth and Leverage.** Low. The interface exposes compiler mechanics and
grows with every channel, alpha mode, group path, material family, and bake
exception.

**Locality.** Poor. Artistic intent lives in the website repository, breaks on
Blender renames, and is invisible to the artist. A copied `.blend` loses its
publication decision.

**Seam placement.** Wrong for the product. Scene config owns deployment and
integration, not material semantics.

**Decision.** Reject as a core path. The existing explicit
`applicationMaterialAdapter` remains the correct application-owned escape
hatch when the site truly replaces materials at runtime.

## Recommended public authoring surface

### Material Properties: consequence-first status

Extend the existing **Blendlink Web Material** panel. Do not lead with modes.
Lead with the outcome:

```text
Needs Bake
Shader to RGB cannot run in the current Cycles Appearance bake.

Web Color
  Recommended source: Active Vertex Color "Attribute"
  [Use for Website]

Result: Direct vertex color · unlit · no texture bake
This publishes the selected color field, not Shader-to-RGB lighting/AO/grain.
```

For a complex selected field:

```text
Web Color: Group → Result
Result: Bake selected field · Appearance atlas "main" · Cycles Emit
Frozen inputs: Object coordinates
[Select Source Node] [Clear Web Color]
```

For a blocker:

```text
Cannot materialize "Shader to RGB → Color" with Cycles.
Choose an upstream Color output before Shader to RGB, keep the material
application-owned, or use a separately proven EEVEE materialization route.
```

Only a high-confidence candidate receives **Use for Website**. A candidate is
not silently accepted. For DPM, the compiler may recommend the blank Vertex
Color because it is a direct root input and exists on every affected binding;
the artist click explicitly accepts dropping the downstream stylized layers.

### Shader Editor: semantic source selection

Add a small Blendlink sidebar section:

1. select a node;
2. choose one of its color/value output sockets;
3. click **Use as Web Color** or **Use as Web Alpha**;
4. Blendlink creates/reuses the input-only sink and links the chosen output.

The operator's socket dropdown is ephemeral UI. The saved Blender link is the
contract. Shader outputs are not eligible; the artist must choose a color or
value field. Nested values must be exposed through the material's root group
output before selection, which keeps shared node-group edits deliberate.

The node instance carries only:

```python
marker["blendlink_material_source_version"] = 1
```

All authored custom properties remain `blendlink_*`. The group datablock name
and node label are presentation, not identity. Exactly one marker is permitted
per material. `Base Color` is required; `Alpha` defaults to 1.

### Developer surface

No new runtime interface and no required config key. Developers continue to:

```bash
blendlink preview --blend scene.blend
blendlink publish sceneName
blendlink verify sceneName
```

CLI and browser verification should report how many used materials were
preserved, lowered directly, materialized, or blocked. Generated code still
loads the same GLB and existing companion assets. Standard Three/R3F consumers
need no adapter because r184 already handles unlit materials and vertex color.

If application code intentionally owns the appearance, the existing config is
still explicit and separate:

```js
applicationMaterialAdapter: {
  acknowledgePayloadCollapse: true,
  description: "Workbench stylized material adapter",
}
```

That acknowledgement must not become a material compiler input.

## Interface types and outcomes

These are compiler-domain types, not a proposed manifest reshape:

```python
@dataclass(frozen=True)
class WebColorIntent:
    material: str
    color_link: NodeLink
    alpha_link: NodeLink | None
    marker_version: int

class MaterialOutcome(Enum):
    PRESERVED = "preserved"          # stock active Surface
    LOWERED = "lowered"              # exact portable normal form
    MATERIALIZED = "materialized"    # explicit selected field → texture
    BLOCKED = "blocked"

class MaterialTransport(Enum):
    STOCK = "stock"
    FACTOR = "factor"
    VERTEX_COLOR = "vertexColor"
    IMAGE = "image"
    ATLAS_TEXTURE = "atlasTexture"

@dataclass(frozen=True)
class CompiledMaterialBinding:
    source_material: str
    outcome: MaterialOutcome
    transport: MaterialTransport | None
    fidelity: Literal["full-surface", "selected-field"]
    generated_material: bpy.types.Material | None
    issues: tuple[MaterialCompileIssue, ...]
```

The external function returns a report rather than printing or silently
mutating. `export_scene.py` owns applying successful generated bindings inside
the already disposable export scene. Tests exercise the same interface.

## Compilation policy

### 1. Preserve

If the existing diagnostic is Exact or a deliberate useful Approximation,
leave the material to the stock exporter. A marker is unnecessary.

### 2. Automatic exact lowering

Without a marker, lower only when the *complete active Surface* normalizes to a
proved glTF form. Initial normal forms should be intentionally small:

```text
UnlitColor := Constant
            | ColorAttribute(active-or-named)
            | Constant × ColorAttribute(active-or-named)

Alpha := Opaque
       | same/named ColorAttribute alpha
       | proved clip comparison with constant cutoff
```

Match link topology, node types, socket values, and active output—not material
or node names. Traverse nested groups but ignore disconnected scratch nodes.
Every bound evaluated mesh must satisfy the selected attribute contract. A
separate alpha attribute is packed into export-owned RGBA `COLOR_0` on the
private mesh copy only after its conversion semantics are numerically proven.

Each normalizer is an internal implementation with `match → normalized value
→ generated stock graph → post-export assertion`. Do not expose a public
normalizer/plugin interface yet: there is one production adapter and therefore
no evidenced external seam.

### 3. Explicit selected-field lowering

With a Web Color marker, the source selection is artist intent. The compiler
tries in order:

1. constant factor;
2. active/named vertex color, optionally multiplied by a constant;
3. an already portable image/UV graph;
4. Cycles Emit materialization on the existing Appearance-atlas path.

Moving between these transports does not change what the artist selected, so
it is safe for the compiler to choose. The report still says whether the
result represents the complete surface or only the selected field.

### 4. Explicit socket materialization

Only Color or Value sockets are valid. The implementation copies the material,
finds the copied marker link, and connects that upstream socket to a private
Emission shader and active Material Output. It never edits a nested shared node
group or the source material. The bake target and UV live only in the private
copy/proxy.

Use Cycles' Emit bake, whose documented target is the active Image Texture or
Color Attribute on a UV-mapped mesh.
[Blender Cycles baking][blender-baking] `Shader to RGB` is EEVEE-only and does
not work in Cycles, so any selected dependency path reaching it blocks.
[Blender EEVEE node support][blender-eevee]

Color and alpha require separate truth:

- bake RGB through Emission into a float buffer;
- when Alpha is selected, bake it as a scalar/grayscale field;
- combine alpha only through canonical `bakelib.py` mechanics;
- save base-color RGB with the established Standard/None/0 sRGB contract and
  alpha as linear coverage;
- apply canonical constant background, margin, coverage, and delivery stages;
- emit a standard unlit base-color texture.

Do not copy any save, alpha, packing, or background primitive out of
`bakelib.py`.

The first production materialization constraint should be deliberately narrow:
one static exported binding, a valid committed Appearance-atlas UV, no animated
dependency, and a Cycles-compatible selected subgraph. This admits
`DP-SkyPaint.MAT` while native separate receivers preserve Object Info,
Generated coordinates, and per-object random values. Unrealized Geometry Nodes
instance identity remains a blocker until a dedicated route proves it.

### 5. Refuse

If no exact automatic route exists and no explicit Web Color is selected,
preserve the current Needs Bake warning and final collapse gate. If a selected
field cannot compile, block that publication; never fall back to white, choose
another socket, or switch to an EEVEE renderer silently.

## Invariants

1. **Artist state is source.** Automatic compilation never writes the `.blend`.
   The add-on operator changes only the marker link as an explicit user edit.
2. **Private mutation only.** Generated materials, packed attributes, bake
   targets, outputs, scenes, and UV adjustments exist in the disposable export
   process.
3. **Active export scope only.** Excluded material datablocks cannot create
   warnings, work, or assets.
4. **No guessed artistic source.** Recommendations may be offered; only a
   proven complete-surface normalizer is automatic. An intrinsic fallback
   requires the artist's marker.
5. **One marker per material.** Zero means default behavior; more than one is
   ambiguous and blocks.
6. **No Shader socket.** Web Color and Alpha accept Color/Value only.
7. **Full-surface and selected-field claims are distinct.** Direct transport
   does not imply full fidelity.
8. **Cycles compatibility follows the selected dependency graph.** A
   Shader-to-RGB node elsewhere in the material does not block an upstream
   selected vertex color; one upstream of the marker does.
9. **Attribute coverage is complete.** Every used evaluated binding must have
   the active/named attribute with supported domain/type, or compilation
   blocks with object names.
10. **Alpha is never inferred from viewport appearance.** Missing alpha is
    opaque. Authored transparency requires a selected/proved field.
11. **Animation is not frozen silently.** An animated selected value blocks
    static materialization until an explicit finite-state/runtime route exists.
12. **Generated GLB is the authority.** Post-export audit must see the expected
    factor/texture/`COLOR_0`/unlit/alpha payload, binding ownership, and numeric
    color range before success. Presence alone is not evidence: an all-white
    accessor can be a broken exporter result.
13. **Atomic artifact publication.** A failed compile keeps the last complete
    artifact set; partial textures or bindings never replace it.
14. **Successful cache entries only.** Cache identity includes source material
    graph fingerprint, marker links and values, evaluated geometry/UV and
    attributes, bake settings, Blender version, exporter version, and compiler
    implementation version.
15. **Application ownership remains intact.** No Canvas, route, loader, tone
    mapping, post-processing, or website material adapter is installed.

## Errors and recovery

Use stable internal issue codes plus complete artist-readable text. Codes need
not become public manifest schema in the first implementation.

| Issue | Artist-facing message and recovery |
| --- | --- |
| `MATERIAL_SOURCE_AMBIGUOUS` | “Material X has 2 Blendlink Web Color nodes. Keep one source marker.” Select both nodes. |
| `MATERIAL_COLOR_UNCONNECTED` | “Web Color is not connected. Connect a Color/Value output or Clear Web Color.” Select the marker. |
| `MATERIAL_SOURCE_SHADER_SOCKET` | “A Shader output cannot become base color. Choose an upstream Color output.” Select the offending source. |
| `MATERIAL_CYCLES_BLOCKED` | “Selected color reaches Shader to RGB, which is EEVEE-only. Choose the upstream Color Attribute/group color, use a separately proven EEVEE route, or keep the material application-owned.” |
| `MATERIAL_ATTRIBUTE_MISSING` | “Active color `Attribute` is missing on 3 exported meshes: …” Offer Select Objects; never substitute white. |
| `MATERIAL_ALPHA_UNPROVEN` | “This material is transparent, but its web alpha is not representable yet. Connect Web Alpha or make the material explicitly opaque.” |
| `MATERIAL_UV_INVALID` | Reuse atlas preflight's object/island/zero-area wording and controls; do not start a doomed bake. |
| `MATERIAL_SHARED_DEPENDENCY` | “Selected field depends on per-object data across N bindings; the current materializer cannot preserve it.” Suggest direct attribute lowering or split/local materials. |
| `MATERIAL_ANIMATED_FIELD` | Name the animated node/property and require a runtime/state route. |
| `MATERIAL_POST_EXPORT_MISMATCH` | “Compiler expected `COLOR_0`/unlit texture, but the final GLB omitted it.” Include exporter version and block. |

Recovery uses the existing save-driven workflow. Fix the graph/UV/attribute,
save, and Preview retries. A **Retry Website Preview** action may call that same
compile; it must not create a second material-specific state machine. The last
good preview remains visible on failure. A successful changed source key
invalidates only affected material/atlas jobs.

## Hidden implementation and internal seams

The module may be internally composed, but these are not public interfaces:

1. `inspect_material_intent` resolves the active Surface and optional marker.
2. `normalize_portable_surface` returns a small semantic normal form or a
   proof of non-match.
3. `classify_selected_field` returns direct transport, materialization, or a
   blocker with dependency evidence.
4. `build_private_export_material` creates only stock-exporter-recognized
   node arrangements.
5. `materialize_selected_field` uses existing atlas UV/quality and canonical
   `bakelib.py` primitives.
6. `audit_emitted_binding` validates exact final GLB payload.

Graph inspection is an **in-process** dependency. Blender execution, Cycles,
the filesystem staging directory, and the bundled glTF exporter are
**local-substitutable** dependencies: headless fixture scenes and temporary
artifact directories exercise the real implementation. They justify internal
seams, not a public port. There is no remote dependency.

The stock glTF exporter is the production adapter at the output seam. The
fixture exporter invocation is the test adapter only in the broad sense that
it supplies local inputs; do not wrap the exporter in a speculative public
plugin interface. Likewise, keep family normalizers private until two genuine
external implementations exist.

The **Interface is the test surface**: tests call
`compile_export_materials`, then inspect returned issues and exact GLB output.
Replace narrow tests that assert private node names with behavior tests at that
interface once the module exists.

## Implementation and dogfood status

1. **Implemented:** marker validation plus exact constant and direct
   active/named vertex-color unlit normal forms. Plan and realization share one
   module and unknown conversions refuse.
2. **Implemented and headless-verified:** private object/material/mesh mutation,
   shared-mesh ownership, compiler-private color carriers, atomic `COLOR_0`
   rewrite, complete restoration, and final numeric attestation.
3. **Dogfood-verified:** a disposable DPM-only Splash derivative lowers one
   selected field; an all-fields derivative lowers 33 explicitly selected
   materials (30 vertex-color, 3 factor). Both publish ordinary unlit glTF and
   pass production browser transport/render checks.
4. **Measured, not parity:** the all-fields selection improves the retained
   visual comparison from the stock MAE/RMSE `0.1813311`/`0.2640845` to
   `0.1611896`/`0.2352268`, but almost every pixel still differs. These fields
   deliberately omit Shader-to-RGB lighting, AO, shadows, Filmic, and the
   compositor.
5. **Future:** implement the narrow one-binding Cycles Emit path, then test an
   explicit procedural selected socket such as `DP-SkyPaint.MAT → Group.Result`
   at multiple views. Existing-image transport and separately proved alpha-mask
   silhouette acceptance also remain open.
6. **Future:** expand material families only through explicit artist intent or
   a proven complete-surface rule. Do not automatically mark every
   Shader-to-RGB graph because a neighboring upstream field happens to exist.

## Test matrix

### Module interface tests in headless Blender

- automatic constant full Surface → unlit factor;
- automatic active and named vertex color → actual `COLOR_0`;
- constant × color attribute → correct factor and `COLOR_0`;
- RGBA vertex color → correct RGB, alpha coverage, and `BLEND`/`MASK` result;
- separate alpha attribute → private packed RGBA values, source mesh unchanged;
- nested exact unlit group → lower independent of group/node names;
- one unexpected node/link/value → exact normalizer refuses rather than nearly
  matching;
- unused Shader-to-RGB scratch node → no blocker;
- selected field upstream of Shader to RGB → direct or Emit allowed;
- selected field downstream of Shader to RGB → named Cycles blocker;
- missing attribute on one of many bound meshes → all affected object names;
- two markers, unlinked marker, Shader output, linked-library material → loud
  deterministic issues;
- material/node rename and `.blend` save/reopen → marker link still resolves;
- undo/clear operator → no stale properties or orphan marker groups;
- source material tree, mesh attributes, scene settings, and source `.blend`
  hash unchanged after compile;
- failed save/bake → no staged partial artifact and last good set retained;
- repeated unchanged compile → successful cache hit; graph/socket/UV/attribute/
  Blender-version changes → affected miss.

### Exact exporter tests

- generated direct graphs produce `KHR_materials_unlit`, expected factors,
  meaningful `COLOR_0`, and no fake leading white color attribute;
- generated baked graphs produce an image/texture/base-color binding and
  correct `alphaMode`;
- `GLTFLoader` r184 creates `MeshBasicMaterial` with vertex colors enabled;
- final audit attributes the recovered payload and no longer reports complete
  collapse for treated bindings;
- unknown future exporter behavior creates `MATERIAL_POST_EXPORT_MISMATCH`, not
  a successful compile.

### Splash acceptance

- original/derivative source hashes remain unchanged unless the dogfood copy is
  intentionally saved with marker authoring;
- untreated families remain loud and triangle-weighted;
- Outline silhouettes and alpha coverage match Blender reference masks at
  selected views;
- DPM selected-field output has meaningful `COLOR_0` and measurable chroma;
- Sky emits a real texture and preserves stable surface color at multiple
  camera views;
- no claim is made for Filmic, film grain, chromatic dispersion, World mix,
  Shader-to-RGB lighting, AO, or shadows;
- packed Vanilla and R3F consumers, production browser smoke, material
  collapse verification, and visual evidence all run on the exact final GLB.

## Migration without a manifest reshape

The implementation needs no manifest reshape or schema-version bump:

- marker intent remains in the `.blend`;
- generated standard material payload remains in the GLB;
- existing `sceneDiagnostics.materials.records[]` continues to carry status,
  reasons, used objects, and Cycles compatibility;
- optional schema-v1 `sceneDiagnostics.materialCompilation` evidence is added
  within manifest schema v3 to bind source/generated materials, transports,
  primitive/binding ownership, and exact final factors/color ranges;
- exact final-artifact audit already observes factors, textures, emissive,
  unlit extensions, and triangle coverage;
- older schema-v3 manifests may omit the additive evidence; current runtime
  rendering still consumes ordinary glTF rather than a Blendlink shader format.

Durable evidence is implemented as one optional compilation object rather than
reshaping every portability record. Its own schema version is 1, and it records
the source fingerprint, source/generated material names, direct transport,
primitive/binding ownership, factors, alpha/double-sided state, and attested
`COLOR_0` type/range. Typegen, final-document audit, and add-on/CLI readers agree
on that object. No runtime behavior depends on it: ordinary glTF remains the
rendering contract. Node names, socket identifiers, Blender paths, and private
carrier/normalizer IDs are not serialized.

Existing scenes migrate incrementally:

1. Exact/Approximated stock materials behave exactly as before.
2. Existing Needs Bake remains loud until an exact normalizer or marker applies.
3. Existing Appearance atlases remain Combined unless an explicit selected
   field is present and supported.
4. `applicationMaterialAdapter` remains valid and orthogonal.
5. Clearing the marker restores previous behavior with no config cleanup.

## Recommendation by Depth, Locality, and Seam

Choose design A.

- **Depth:** one semantic marker and one compile call unlock direct factors,
  meaningful vertex colors, images, texture materialization, diagnostics,
  caching, and verification.
- **Locality:** artist intent stays in Blender; compiler knowledge stays in
  Blendlink; deployment/runtime knowledge stays in the website.
- **Seam:** the marker sits at the material graph, the module at the disposable
  export scene, and the application seam remains the standard GLB.

The default-first part is not “bake everything.” It is: preserve stock glTF
when possible, automatically lower only proven full-surface forms, make the
most likely intrinsic recovery a one-click recommendation, and require an
explicit visible source for every lossy selected-field decision. That is both
artist-readable and developer-boring—the desirable outcome for an artist-first
compiler.

## Primary sources

- [Blender 5.1 glTF exporter manual][blender-gltf]
- [Blender Cycles baking manual][blender-baking]
- [Blender EEVEE supported/EEVEE-only nodes][blender-eevee]
- [Khronos glTF 2.0 specification][gltf-spec]
- [Khronos `KHR_materials_unlit`][khr-unlit]
- [Official glTF-Blender-IO PBR gatherer][gltf-pbr-source]
- [Official glTF-Blender-IO node-tree search][gltf-search-source]
- [Official glTF-Blender-IO unlit gatherer][gltf-unlit-source]
- [Official glTF-Blender-IO primitive extraction][gltf-primitive-source]
- [Three r184 `GLTFLoader`][three-loader]

[blender-gltf]: https://docs.blender.org/manual/en/5.1/addons/import_export/scene_gltf2.html
[blender-baking]: https://docs.blender.org/manual/en/5.0/render/cycles/baking.html
[blender-eevee]: https://docs.blender.org/manual/en/5.0/render/eevee/limitations/nodes_support.html
[gltf-spec]: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#materials
[khr-unlit]: https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_unlit
[gltf-pbr-source]: https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/addons/io_scene_gltf2/blender/exp/material/pbr_metallic_roughness.py
[gltf-search-source]: https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/addons/io_scene_gltf2/blender/exp/material/search_node_tree.py
[gltf-unlit-source]: https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/addons/io_scene_gltf2/blender/exp/material/unlit.py
[gltf-primitive-source]: https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/addons/io_scene_gltf2/blender/exp/primitive_extract.py
[three-loader]: https://github.com/mrdoob/three.js/blob/r184/examples/jsm/loaders/GLTFLoader.js
