# Next demo corpus: provenance, topology, and staged dogfood, 2026

Research date: 2026-07-22

## Decision

Use all three files, but do not call them interchangeable demo scenes.
They exercise three different compiler boundaries:

1. **`pip_shader.blend` should become the next permanent conformance target.**
   It is tiny, officially CC-BY 4.0, and proves whether Blendlink refuses an
   animated EEVEE-only material honestly. It is initially a negative test, not
   a visual-success showcase.
2. **`TrapX - Stylized Painting Shader.blend` should be the next private visual
   material experiment.** One static mesh isolates a complex but
   Cycles-evaluable graph. Its view-dependent branches make it a fixed-camera
   or explicitly selected-socket experiment, not an orbit-safe automatic
   conversion. No source or derived visual asset should be committed until a
   redistribution license is recovered from the creator.
3. **`blender-282.blend` should immediately become an unsupported-content
   diagnostic case, but not the next conversion implementation.** Its artistic
   identity is 29 animated Grease Pencil objects that Blender's installed glTF
   exporter emits as empty nodes. Supporting it faithfully would be a distinct
   Grease Pencil transport project, not a small material-compiler extension.

This is an evidence ladder: first prove a truthful refusal on a redistributable
fixture, then prove one bounded material success privately, then keep the much
larger Grease Pencil capability cliff loud. It fits Blendlink's product boundary
better than choosing the visually richest file first and quietly flattening or
dropping what makes it distinctive.

No package code or source `.blend` was changed during this research. All stock
glTF exports, renders, and conversion probes were written only to temporary
paths and removed. The only retained artifact is this record.

## Evidence identity and provenance

| Local file | Bytes | SHA-256 | Provenance and license conclusion |
| --- | ---: | --- | --- |
| `TrapX - Stylized Painting Shader.blend` | 41,863,981 | `D32731C7983E59546893BCC7FD4EF5C14532B0B2E782F63FA7EF9ED4FAAFB6AE` | Windows download metadata identifies a `files.gumroad.com` attachment and a Gumroad referrer. An embedded note identifies Nikolaj / Mr. TrapX and requests credit. The material group is named `Stylized Painterly Shader - TrapX`. The former product URL now returns 404 and neither the file nor the surviving creator page supplies a formal redistribution license. **Local evaluation only; do not publish derivatives.** |
| `blender-282.blend` | 6,998,679 | `13F0705E9E05D98A70471C7AC73CDC4E42C9513CD7E2A482503F770CC631D458` | Byte-for-byte identical to the current [official Blender 2.82 splash gallery download][blender-282-gallery]. The gallery labels it `cc-by-sa`; the embedded `Text` datablock says `Credits: Andry Rasoahaingo - License CC-BY-SA 3.0` and links `dedouze.com`. |
| `pip_shader.blend` | 1,549,391 | `60AFB3EEB71131F9D7DF942901CC3A5311C64A12BEDC4EDF9BC1932386AB2B63` | Same object, material, node-group, and driver inventory as Simon Thommes' official `pip_shader.blend`, but resaved by Blender 5.1.30 and therefore not byte-identical. The [official Blender Studio asset][pip-asset] labels both the asset and attachment CC-BY 4.0, identifies Simon Thommes, explicitly invites use of the shader/node groups, and confirms commercial use under that license. |

Additional provenance checks:

- The current Blender gallery file for 2.82 is exactly the local file. An older
  `https://download.blender.org/demo/Blender-282.blend` is 6,710,528 bytes,
  SHA-256
  `D566EEC833F933762DAA206B57BBC3E05EF38BBDF0AACD373AE68818F0B404E7`,
  and leaves four tram-station textures external. The current gallery/local
  file packs those four images. Its topology counts otherwise match the older
  official file.
- The official Pip attachment is 1,233,020 bytes, SHA-256
  `B62B5A38350E80626DE5593CD1E1BA79664849DC55CDB9B20B396BC2A27A1C26`,
  and was saved by Blender 2.90.2. The local 5.1 resave retains the same nine
  objects, two materials, eight node groups (seven shader groups plus the
  compositor tree), and three driver records.
- The TrapX file's download metadata proves how this copy arrived, not what
  rights accompanied it. Gumroad's current terms leave end-user license terms
  to the seller. A request for attribution is not by itself permission to
  redistribute the source, packed third-party images, generated textures, GLB,
  or screenshots. The former product and storefront both returned 404 on the
  research date.

## Comparative value

| Target | Core authored feature | Stock GLB result | Best Blendlink value now | Main reason not to overreach |
| --- | --- | --- | --- | --- |
| Pip | Frame-driven, camera/object-aware painterly EEVEE material | A loadable 909,516-byte GLB with two plain emissive materials, no textures, and no animations | Permanent refusal and material-animation fixture; later, an explicit static selected-socket experiment | `Shader to RGB` is EEVEE-only and the visible procedural pattern genuinely changes with frame |
| TrapX | Static layered painterly Cycles material on one sphere | A loadable 5,242,288-byte GLB containing one image and an approximate PBR/normal material; most layered shading is gone | Private fixed-camera Appearance or selected-socket materialization experiment | Fresnel, transparency, glass, mixed shaders, and unknown redistribution rights |
| Blender 2.82 splash | Hybrid 3D plus animated Grease Pencil tram scene | A loadable 2,509,620-byte GLB whose 29 Grease Pencil objects are all empty nodes | Unsupported-renderable gate, export-loss evidence, and a transform-versus-geometry audit regression | A faithful result needs stroke/fill/opacity/depth/animation transport, not a mesh-export tweak |

The ranking is about diagnostic leverage and bounded implementation, not
artistic quality. Blender 2.82 is the richest scene and the worst first target:
it combines unsupported Grease Pencil, animated drawings, older material
migration, lights, curves, and ordinary transform animation. A pass or failure
would not localize one compiler decision.

## TrapX: actual topology and compatibility

### Read-only inventory

- Saved by Blender 3.6.11; opened with Blender 5.2.0 LTS.
- Cycles scene, Standard view transform, frame range `0..0`.
- 5 scene objects: one mesh (`Icosphere`), one font, one camera, and two lights.
- 7 materials and 47 images; 45 images are packed.
- No actions, armatures, or render-visible Geometry Nodes modifiers.
- The active object/material binding is `Icosphere -> Showcase`.

`Showcase` has 56 nodes reachable from its active Surface output. The important
family is one nested `Stylized Painterly Shader - TrapX` group with:

- two Add Shader and two Mix Shader nodes;
- six Mix nodes;
- Fresnel, three Voronoi textures, Bump, Normal Map, Transparent, Glass,
  Emission, and Principled branches;
- two image dependencies: `among us.png` and `painting texture6.png`.

Blendlink's current analysis correctly reports **Needs Bake**. Cycles can
evaluate the active graph, so this is not the same blocker as an EEVEE
`Shader to RGB` material. It is nevertheless view-dependent: the active
Fresnel, transparency, and glass behavior cannot be flattened once and then
called orbit-safe.

The file also contains four CamFx materials and many packed 2K bokeh/lens-dirt
images. Two CamFx image datablocks are missing:

- `bokeh_demisphere.jpg`
- `Lens_dirt_6.jpg`

Those missing images are not reachable from either render-visible object's
material. No CamFx geometry is present in the scene, and the active compositor
contains Render Layers, two Lens Distortion nodes, and Glare rather than those
image datablocks. They should be reported as orphaned/add-on residue, not
silently converted into a blocker for compiling `Icosphere`. This is a useful
test of dependency reachability and artist-readable missing-asset messages.

### Implemented CamFx dependency classification

The original collector used Blender's global
`bpy.utils.blend_paths(absolute=True, packed=False, local=False)`. Blender's
API defines that call as all external files referenced by the loaded `.blend`,
not the narrower current export graph.[blender-blend-paths] The reverse proof
uses `BlendData.user_map`, whose documented result maps datablocks to every ID
datablock using them.[blender-user-map] On the
untouched TrapX source, Blender 5.2 returns exactly the two absolute missing
CamFx paths above. Both Image datablocks report one user. Reverse ownership is
`bokeh_demisphere.jpg -> .CAMFX BOKEH -> .CamFx Bokeh` and
`Lens_dirt_6.jpg -> .CAM FX LENSDIRT -> .CamFx LensDirt`; neither owning
Material is bound to an exported render-visible source or evaluated object.

Two implementation designs were compared:

1. **Filter unreachable paths out.** This removes warning noise and cache
   churn, but also erases the only manifest evidence that the `.blend` retains
   broken addon references. It would make artist cleanup harder and turn a
   deliberate classification into a silent skip.
2. **Retain every path with an additive, conservative reachability result.**
   Proven unbound-Material residue remains in `externalDependencies` with
   `reachable: false` and `reachabilityReason: "unbound-material"`; the CLI
   explains that it cannot affect this build. All absent or ambiguous results
   retain the existing loud "may render differently" warning and unchanged-
   scene invalidation. This is the implemented design.

A general reverse dependency graph was also considered and deferred. Blender
paths include libraries, fonts, caches, sequences, movie clips, and addon data;
claiming complete semantic reachability for all of them would require exporter-
and bake-specific dependency semantics that this evidence does not establish.
The implemented proof is intentionally smaller: local `FILE` Images only;
every direct ID user must be its owning Material or belong to that Material's
tree closure; no source or evaluated export material may own it; and active
World, compositor, light-data, or modifier node graphs must not reach it.
Multiple Image datablocks sharing a path must all pass. Evaluation/API
uncertainty falls back to reachable.

The real headless fixture proves that an unbound missing Material image is
classified as residue, while a bound missing image and active World image stay
reachable; assigning that same residue Material to the exported mesh makes it
reachable on the next collection. Running the classifier against the untouched
private TrapX file now emits exactly two entries, both non-impacting with the
`unbound-material` reason. No source, derived artwork, GLB, or screenshot is
stored in the repository. A fresh private Preview compile then completed in
3.0 seconds with a 5,103 KiB / 1,280-triangle payload and one grouped message:
"2 unused Blender image references are missing" followed by the two exact
CamFx paths and "they cannot affect this build." The ordinary no-recipe and
light-portability warnings remained separate and Blender's successful sentinel
continued to outrank its known shutdown crash.

### Stock export evidence

Blender 5.2's stock exporter finished before Blender later crashed during
shutdown (the repository already treats the sentinel/result artifact as
authoritative in this known pattern). The temporary GLB contained:

- 2 mesh nodes (`Icosphere` and the font converted to a mesh);
- 2 materials;
- one embedded image, `painting texture6`;
- a base-color texture and normal texture using that image;
- no animation.

That is meaningful fallback payload, but it is not the painterly surface. It
proves why “stock export produced a material” is weaker than an appearance
claim.

### Acceptance criteria for the private experiment

1. Only `Icosphere/Showcase` enters nonportable material work; the font's exact
   material stays on the stock route, and the CamFx images are classified
   separately as unreachable residue.
2. The default orbit-capable route refuses to call the full result portable.
   A fixed-camera route must name the exact authored camera and record the loss
   of view-dependent response.
3. A selected-socket route must identify a Color/Value output upstream of any
   view/ray-dependent branch. It must never imply that a baked base color
   preserves Fresnel, glass, transparency, or compositor glare.
4. The generated GLB must contain the claimed image/material payload, and a
   browser render at the authored camera must be compared with a retained local
   Blender reference using an artist-approved threshold. A second view must
   demonstrate the documented limitation rather than hide it.
5. Source hash, authored materials, image datablocks, camera, compositor, and
   render settings are identical before and after both success and forced
   failure.
6. Keep `.blend`, GLB, generated textures, and visual captures outside the
   repository until a real license is recovered. Metrics and failure text can
   be recorded without redistributing the artwork.

## Pip: actual topology, animation, and security boundary

### Read-only inventory

- The official file was authored in Blender 2.90.2. The local copy was saved by
  Blender 5.1.30 and opens in Blender 5.2.0 LTS.
- EEVEE scene, Filmic view transform, frames `1..250`, 24 fps, 1024 square.
- 9 objects: one sphere, one camera, three lights, and four empties.
- 2 materials, no images, no actions, no armature, and no Geometry Nodes.

Both sphere materials are deliberately nonportable painterly graphs:

| Material | Reachable nodes | Important dependencies |
| --- | ---: | --- |
| `MAT-shell` | 151 | 10 group instances, two Shader to RGB nodes, procedural Noise/White Noise, Geometry, Object Info, Layer Weight, attributes, transparency, and an animated `SH-Seed` group |
| `MAT-shell_solid` | 140 | The same core `SH-Seed`, toon, rim, camera-coordinate, texture, and noise groups without the outer transparent mix |

Both are **Needs Bake**, and both are blocked from Cycles Appearance by
`Shader to RGB`. Blender documents this node as EEVEE-only. This is exactly the
kind of graph for which a generic “bake it” remedy would be false.

Two nested node trees have simple `frame` drivers:

- `SH-Seed -> nodes["Value.001"].outputs[0].default_value`
- `UT-texture -> nodes["Value.001"].outputs[0].default_value`

Those are valid Blender simple expressions even when Python auto-execution is
off. They are also non-transform material animation, which core glTF/Three does
not reproduce. Current `pointer_animation_issues` does catch the material use
on `Sphere`; the generic audit lists the node-group owners but does not explain
the visual consequence prominently enough.

A separate Empty rotation driver uses
`frame/bpy.context.scene.frame_end*2*pi`. Blender refuses that expression when
opening the downloaded file with auto-execution disabled. Blender's manual
recommends driver variables instead of direct Python data access and documents
why untrusted `.blend` Python is disabled. Blendlink must report this condition;
it must not enable auto-execution on the artist's behalf.

The file contains `cloudrig.py.004` and `rig_ui.py.004` text datablocks, but
both have `use_module = false` and there is no armature. They remained inert in
the probes. A compiler must continue treating embedded text as data, never as
an invitation to run it.

### The animation is visibly material

Three temporary 122x122 EEVEE renders were captured at frames 1, 125, and 250
with auto-execution still disabled. The invalid Empty driver therefore remained
invalid while the simple material drivers evaluated normally.

| Comparison | Mean absolute RGB error (0..1) | RGB channels changed by more than 1/255 |
| --- | ---: | ---: |
| frame 1 vs 125 | 0.01332 | 34.64% |
| frame 125 vs 250 | 0.01589 | 35.69% |
| frame 1 vs 250 | 0.01285 | 34.39% |

These are not visual-acceptance thresholds. They are evidence that silently
freezing frame 1 would remove authored behavior.

### Stock export evidence

The temporary stock GLB was 909,516 bytes. It contained the sphere and empties,
two materials reduced to plain white and gray emission factors, no textures,
and no animations. The export was technically loadable and artistically
collapsed. This should be a hard failure unless an explicit material
compilation or application-owned adapter supplies and verifies a replacement.

### Acceptance criteria for permanent dogfood

1. The untouched official/local source produces a deterministic plan that
   names both EEVEE-only graphs, the two material-frame drivers, and the invalid
   direct-Python Empty driver.
2. Default Preview/Final never labels the stock white/gray GLB faithful. Final
   refuses payload collapse with `Sphere`, material names, and the concrete
   `Shader to RGB`/animation reasons.
3. No Blendlink command enables Python auto-execution. A derivative may replace
   the Empty expression with a simple expression or explicit driver variable,
   but that change must be recorded and must not be presented as a compiler
   repair.
4. A static-frame experiment requires an explicit freeze decision and records
   the selected frame plus the lost frame-driven material behavior. It may only
   bake a target-local socket that Cycles can actually evaluate.
5. Full animated parity remains future work unless a bounded representation is
   designed and browser-verified. Blendlink must not create a general EEVEE
   interpreter or website shader engine to pass this fixture.
6. A committed derivative or screenshot carries attribution to Simon Thommes
   and Blender Studio, links the source asset, and includes CC-BY 4.0. Record
   both official and local hashes so a Blender-version resave is not mistaken
   for the original byte stream.

### Implemented permanent refusal fixture

`packages/blender-addon/tests/pip_refusal_check.py` now owns a real-Blender
conformance test for the highest-confidence Pip boundary. The adjacent
`fixtures/pip-refusal.json` and `pip-refusal.license.md` retain Simon Thommes /
Blender Studio attribution, CC-BY 4.0, the official attachment identity, and
the inspected Blender 5.1 resave identity. The repository does **not** copy
either `.blend`: the test constructs a minimal scratch graph with the exact
`Sphere`, `MAT-shell`, `MAT-shell_solid`, `SH-Seed`, `UT-texture`, and invalid
`Empty` driver names, but no Pip artwork, geometry, textures, or complete
shader implementation.

The focused Blender 5.2 gate proves that:

- both used materials are independently planned as **Needs Bake**, name
  reachable `Shader to RGB`, and carry the concrete EEVEE-only / Cycles
  Appearance blocker;
- the two `frame` node-group drivers remain explicit evidence and make
  `Sphere` non-static;
- connected Preview and Final receive an artist-named hard refusal for **both**
  material slots through the property-animation policy, while the private
  authoring Preview says exactly which Blender frame it froze;
- evaluating the direct-Python Empty driver sets Blender's restricted-
  execution failure without Blendlink enabling Python auto-execution; and
- a temporary stock glTF export is loadable and contains both named materials,
  but contains no material animation, textures, or images. That export is
  evidence of collapse, never an accepted visual result.

This implements the durable negative gate, not the future static-frame
materialization experiment. Pixel parity, a general EEVEE interpreter, and
animated shader runtime support remain explicitly out of scope.

After the fixture passed, the same policy was run read-only against the
untouched local file with SHA-256
`60AFB3EEB71131F9D7DF942901CC3A5311C64A12BEDC4EDF9BC1932386AB2B63`.
It returned two `Sphere`
pointer blockers in material-slot order (`MAT-shell`, then
`MAT-shell_solid`), classified both materials as **Needs Bake** with blocked
Cycles Appearance, and left Blender's Python auto-execution preference false.
Blender separately emitted its expected restricted-access failure for the
`Empty` expression. This exact-source check validates the minimal fixture's
correspondence; it is not a dependency of the portable package test.

## Blender 2.82 splash: actual Grease Pencil and animation topology

### Read-only inventory

- Exact official current-gallery artifact, saved by Blender 2.82.7.
- EEVEE scene, Standard view transform, frames `23..270`, 24 fps.
- 123 scene objects:
  - 58 mesh
  - 29 Grease Pencil
  - 20 curve
  - 9 empty
  - 6 light
  - 1 camera
- 46 materials, 6 images (4 packed), 4 actions, and no armature.
- 29 Grease Pencil objects contain 75 layers and 326 stored drawing frames.
  Twenty-six objects have drawings at more than one frame, totaling 10,416
  strokes across stored drawings. `girlgpencil` alone has 89 layer frames and
  2,459 strokes across those drawings.

The embedded scene note identifies the scene as the animated Tram Blender 2.82
splash and supplies the Andry Rasoahaingo / CC-BY-SA 3.0 attribution.

The ten modifiers reported as Geometry Nodes are all the same Blender 5.x
`Auto Smooth` compatibility node group. They are generated when the old file
is opened; this is not a scene built around authored Geometry Nodes.

Before the 2026-07-22 follow-up, Blendlink classified `trainDoorL` as a
`Cache` candidate because the object has a location action and also has the
converted Auto Smooth modifier.
The node group itself uses no Scene Time, simulation, camera, animated node
group, object, or collection input. Its evaluated local mesh is identical at
the sampled frames; only the object transform is animated, which core glTF
already supports. This is an overly conservative coupling between transform
animation and geometry evaluation. The scene is a strong regression case for
separating transform F-curves from modifier-input/data animation.

### Implemented transform-versus-geometry correction

The untouched source confirms the narrow case rather than merely resembling
it. Blender 5.2 migrates `trainDoorLAction` to a layered Action with the
`OBLegacy Slot` slot and exactly three F-curves, all on `location`. The active
`Auto Smooth` node group contains no Scene Time, simulation, camera, Object,
Collection, or animated node-group dependency. Its node types are the shade
smooth, edge smooth, mesh edge-angle, compare, boolean, and group input/output
family. `Solidify` is the only other render modifier.

Before the correction, live analysis returned blocking route `Cache` and an
irrelevant 428,544-byte position-cache estimate. After the correction,
`full=True` returns nonblocking route `Realize`, carries no morph-cache
estimate, and explicitly says that location animation remains separate core
glTF transform animation. Evaluated local samples at frames 23, 204, and 270
are byte-evidence identical:

| Channel | Hash at all three frames |
| --- | --- |
| Topology | `ea78be26f86e2a6b` |
| Position | `9e19f33f24fe7352` |
| Appearance | `4e013078be921349` |
| Corner normal | `0bdd17537be6f8fd` |

The implementation is deliberately data-path aware rather than an `Auto
Smooth` name exception. It reads legacy F-curves and Blender 4.4+ layered
Action channelbags for the active slot and effective NLA strips. Object
`location`, rotation, and `scale` paths remain core glTF transform animation;
custom properties, modifier input paths, unknown Action representations,
shape-key/data animation, animated node groups, and explicit Object/Collection
dependencies remain conservative geometry-time sources. Automatic web
rendering still identifies the moving object as Realtime, so separating local
mesh realization does not freeze its transform or make it eligible for a
static lightmap.

The separation is also graph- and stack-bounded: `Self Object` keeps the
transform coupled to Geometry Nodes, and unproven modifier types retain the
conservative route. The initial proven local-space stack is Geometry Nodes plus
the source scene's `Solidify`; this avoids turning the targeted compatibility
repair into a blanket claim about Boolean or object-coordinate modifiers.

The registered real-Blender addon suite now contains both sides of the
regression: a 248-frame Solidify + Auto Smooth-like host with location keys is
`Realize`; an NLA-only transform host follows the same route; adding a
namespaced non-transform animated control restores the finite-range blocker;
and `Self Object` preserves the conservative dependency. The full registered
suite passed on Blender 5.2.0 LTS. A read-only whole-scene audit of the
untouched official file then reported all 10 compatibility Geometry Nodes
objects as `Realize`, with no current-frame procedural blocker. This fixes only
the false geometry-cache route; it does not weaken the 29 Grease Pencil
renderable blockers described below.

Material fidelity is a second-order issue here. Eight materials use the common
EEVEE `Shader to RGB` family and are Cycles Appearance blocked, while many old
Principled materials are merely approximated after version migration. Fixing
those materials would still leave the defining Grease Pencil artwork absent.

### Stock export evidence

The Blender 5.2 stock export finished and produced:

- 2,509,620 bytes;
- 123 nodes, 68 meshes, and 12 glTF materials;
- three animation clips (`girldummyAction`, `traindummyAction`, and
  `trainDoorLAction`);
- warnings for two unsupported Area lights, empty mesh primitives, and active
  vertex colors not used by recognized material graphs.

All 29 Grease Pencil object names exist in the glTF node list, but **none has a
`mesh` property**. They are hierarchy placeholders only. This follows the
installed exporter source: `__gather_mesh` handles Curve/Surface/Font specially
and otherwise returns `None` for object types other than Mesh and PointCloud.
The public glTF manual likewise lists meshes as the renderable geometry
contract and warns that non-mesh data is not preserved.

A temporary Blender 5.2 `Object -> Convert -> Mesh` probe on the static
`housebigtop` drawing did not solve the problem: it produced 15,113 vertices
and 14,683 edges, but zero polygons and no materials. That is stroke centerline
data, not a rendered equivalent of fills, thickness, opacity, or layering.

### Acceptance criteria and future boundary

Immediate diagnostic acceptance:

1. Export planning identifies all render-visible unsupported object types and
   counts them before invoking glTF. A Final build with 29 nonempty Grease
   Pencil objects must fail; a loadable GLB with 29 empty nodes is not success.
2. The message names representative objects and says what will be lost. It
   offers explicit choices: publish a validated still/proxy derivative, remove
   them from export scope, or wait for a dedicated supported adapter.
3. The Auto Smooth conversion remains a still realization. `trainDoorL` keeps
   ordinary transform animation and is not sent to a geometry cache merely
   because the object owns an action.
4. Area-light and unrecognized vertex-color warnings remain visible after the
   dominant Grease Pencil blocker is addressed; one failure must not conceal
   the next consequence.

Any future Grease Pencil adapter must separately prove:

- strokes and fills;
- authored thickness, caps, opacity, vertex/fill colors, and depth order;
- layer visibility, masks, and relevant modifiers;
- all nonempty drawings at revealing frames including 23, 126/166, 204, and
  248;
- 26 animated drawing objects are not silently frozen;
- browser bounds, triangle/draw/texture cost, and visual comparison at the
  authored camera.

If satisfying that list requires a bespoke renderer, animation runtime, or
visual-scripting system, Blendlink should keep the scene unsupported. A
fixed-camera raster/video or an artist-authored mesh proxy can be a deliberate
website asset, but must not be mislabeled as a general Blender-scene compile.

Redistributed source copies, converted GLBs, and curated visual adaptations
must attribute Andry Rasoahaingo / Dedouze, link the source, and preserve the
CC-BY-SA 3.0 terms (or a license officially compatible with that license). Keep
the license and attribution next to retained dogfood artifacts rather than only
inside a research note.

## Empty helper/template fixture and publication refusal

A separate local Poly Haven HDRI template exposed a smaller but release-level
failure. Its active file contained zero objects and one grouped World, plus two
missing external dependencies. The previous pipeline could still emit a
132-byte GLB and continue as though a visible website scene had been compiled.
That is useful plan/library input, but it is not a publishable Three.js scene.

Two gate locations were compared:

1. reject a `.blend` from Blender-side object counts before export;
2. inspect the exact fully transformed staged GLB's default scene immediately
   before atomic publication.

The second design is implemented. Source counts cannot prove what collection
scope, evaluated modifiers, instancing, exporter filtering, or later optimizers
actually left in the default scene. `auditCompiledSceneArtifact()` now requires
at least one renderable mesh primitive reachable from that final default scene.
It deliberately does not use triangle count: points and lines remain legitimate
renderable primitives. Mesh definitions that exist only in a non-default asset-
library scene do not satisfy the gate.

The refusal explains that cameras, lights, Worlds, and helpers do not create
visible geometry; tells the artist to make non-empty evaluated mesh geometry
render-visible and not excluded by `-noimp`; and directs intentional helper or
asset-library files to `blendlink plan`. Plan-only inspection therefore remains
available, while Final compilation and later `verify` cannot publish the empty
artifact. The final staged audit runs before any generated file can replace the
last known-good website artifact set.

This behavior is implemented and verified by final-document fixtures for an
empty default scene, a mesh reachable only from a non-default scene, and a
valid point primitive, plus the real Blender empty-scene fixture. It is a
publication-integrity claim, not evidence that a nonempty scene is visually
good.

## Sequencing designs compared

### Design A: visually impressive first

Order: TrapX, Blender 2.82, Pip.

This can create a striking screenshot quickly, but the first result cannot be
retained safely without TrapX license evidence. The second immediately demands
a new Grease Pencil transport system. Pip arrives last even though it is the
smallest, clearest, and best-licensed material-boundary fixture.

**Decision:** reject. It optimizes for a demo image rather than confidence in
the compiler contract.

### Design B: evidence ladder

Order: Pip refusal, TrapX private bounded success, Pip explicit static
materialization, Blender 2.82 unsupported gate; reconsider a Grease Pencil
adapter only after those contracts are stable.

This starts with a fixture that can live in tests, then isolates the first
visual compiler success, then returns to the legally reusable animated material
for an opt-in static experiment. The final scene proves Blendlink can say “not
yet” before it silently deletes most of an artist's work.

**Decision:** use this order.

## Concrete staged plan

### Stage 0 - retain read-only evidence now

- Record the hashes and license/attribution files beside any future ignored
  dogfood derivative.
- Add corpus inventory expectations to the dogfood runbook: object/material/
  driver counts, not source binaries where licensing forbids them.
- Preserve the three temporary stock-export outcomes in test assertions or
  generated evidence, clearly labeled as stock-export evidence rather than
  accepted Blendlink output.

### Stage 1 - Pip as a permanent refusal fixture

- Add an official CC-BY copy or a minimal attributed derivative in the fixture
  location appropriate for large/binary assets.
- Assert the material-animation, EEVEE-only, invalid-driver, and payload-
  collapse consequences above.
- Browser verification should assert that an explicitly acknowledged fallback
  is nonblank only if the application supplies one; it must not convert a
  stock white sphere into a fidelity pass.

### Stage 2 - TrapX private material-compiler spike

- Work only from a copied, ignored derivative and retain source-hash checks.
- Compare full fixed-camera Appearance against an explicit upstream
  selected-socket Emit route. Both must use package-owned material compiler
  planning/execution and canonical `bakelib.py` primitives.
- Choose the route with the smallest honest loss surface; do not add a general
  shader translator for this scene.
- If the creator supplies redistributable terms later, promote a documented
  derivative. Otherwise retain only numerical evidence and conclusions.

### Stage 3 - Pip explicit static-frame dogfood

- On an attributed derivative, rewrite or remove the invalid Empty Python
  driver only if it is proven relevant, recording that authored change.
- Require an explicit frame and target socket. Verify texture/material payload
  and compare Blender/browser at that frame.
- Preserve a second-frame check that fails or is labeled unsupported, proving
  the compiler did not erase the animation from its own evidence.

### Stage 4 - Blender 2.82 diagnostic gate

- The transform-versus-geometry Auto Smooth regression is implemented and
  verified against the untouched official file. Land unsupported-renderable
  detection before attempting any conversion.
- Keep the exact official scene as external/ignored dogfood if repository
  ShareAlike policy is not established; otherwise include attribution and
  license beside it.
- Treat a Grease Pencil implementation as a separately designed feature with
  the acceptance matrix above. It is not required to declare the material
  compiler releasable.

## What this adds to the release docket

These demos do not justify broadening Blendlink into an EEVEE clone or Grease
Pencil engine. They do justify four release-quality diagnostics:

1. **Unsupported renderable objects are a Final blocker**, not empty glTF
   nodes that pass browser smoke.
2. **Material animation is first-class evidence.** An animated node tree cannot
   be silently frozen by an otherwise successful material bake/export.
3. **Untrusted driver policy is explicit.** Blendlink reports restricted or
   invalid expressions and never enables `.blend` Python automatically.
4. **Procedural geometry time-dependence is data-path aware.** An object's
   transform action does not make a time-independent Auto Smooth graph a mesh
   cache.

The first two align directly with the proposed deep material compiler
interface: `plan_materials(scope)` must see the animated, EEVEE-only decisions
before any mutation, while `with_compiled_materials(plan, emit)` must refuse a
stale or falsely frozen execution. The Grease Pencil gate belongs beside export
scope validation, not inside material compilation.

## Exact local implementation evidence

Inspected with:

- Blender `5.2.0 LTS`, build `fbe6228777e7`, file version `5.2.44`;
- bundled glTF exporter `5.2.39`;
- installed exporter `blender/exp/nodes.py` SHA-256
  `43E09E51A9D200CEEE03E97881769F061AB5AD6D706EABA6B2CEC4F3D3B278EE`;
- current `packages/blender-addon/procedural.py` SHA-256
  `4081AADE59E3A5CEFEDF63D5C049CBCC647CBEFC904948C8015C632AD4F139B2`;
- current `scripts/audit-blend-scene.py` SHA-256
  `8F12A4DC0C815AF37F7C60F76BEEB3D83E3C5AFBD36917A43EB0BE9F1AC75C7C`.

The exact installed exporter source at
`C:\Program Files\Blender Foundation\Blender 5.2\5.2\scripts\addons_core\io_scene_gltf2\blender\exp\nodes.py`
was used alongside real temporary GLB inspection. The source inspection explains
the behavior; the resulting GLB node/mesh mapping verifies it in this install.

## Primary sources

- [Blender Studio: Pip - Shading Breakdown asset metadata][pip-asset]
- [Creative Commons Attribution 4.0 license][cc-by-4]
- [Blender Institute Archive: Blender 2.82 splash][blender-282-gallery]
- [Creative Commons Attribution-ShareAlike 3.0 license][cc-by-sa-3]
- [Blender glTF exporter manual][blender-gltf]
- [Blender EEVEE node support (`Shader to RGB` is EEVEE-only)][blender-eevee]
- [Blender driver expressions and variables][blender-drivers]
- [Blender scripting and auto-execution security][blender-security]
- [Official glTF-Blender-IO node gatherer][gltf-nodes-source]
- [Gumroad terms, including seller-supplied end-user licenses][gumroad-terms]
- [Mr. TrapX / Nikolaj creator page][trapx-bio]
- [Blender Python API: `bpy.utils.blend_paths`][blender-blend-paths]
- [Blender Python API: `BlendData.user_map`][blender-user-map]

[pip-asset]: https://studio.blender.org/projects/api/assets/2618/?site_context=gallery
[cc-by-4]: https://creativecommons.org/licenses/by/4.0/
[blender-282-gallery]: https://download.blender.org/archive/gallery/blender-splash-screens/blender-2-82/
[cc-by-sa-3]: https://creativecommons.org/licenses/by-sa/3.0/
[blender-gltf]: https://docs.blender.org/manual/en/5.1/addons/import_export/scene_gltf2.html
[blender-eevee]: https://docs.blender.org/manual/en/5.0/render/eevee/limitations/nodes_support.html
[blender-drivers]: https://docs.blender.org/manual/en/5.0/animation/drivers/drivers_panel.html
[blender-security]: https://docs.blender.org/manual/en/5.0/advanced/scripting/security.html
[gltf-nodes-source]: https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/addons/io_scene_gltf2/blender/exp/nodes.py
[gumroad-terms]: https://gumroad.com/terms
[trapx-bio]: https://bio.link/nikolaj
[blender-blend-paths]: https://docs.blender.org/api/current/bpy.utils.html#bpy.utils.blend_paths
[blender-user-map]: https://docs.blender.org/api/2.83/bpy.types.BlendData.html#bpy.types.BlendData.user_map
