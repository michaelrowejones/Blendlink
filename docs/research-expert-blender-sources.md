# Expert Blender sources: lessons for an artist-first web compiler

Research date: 2026-07-19

## Executive conclusion

The expert material supports Blendlink's direction, but it also suggests an important constraint: **do not promise to export arbitrary Blender creativity unchanged**. Expert Blender artists routinely combine four fundamentally different kinds of work:

1. ordinary meshes, transforms, UVs, PBR materials, cameras, lights, and skeletal or morph animation;
2. procedural construction that can be evaluated into ordinary geometry;
3. authored data and parameters that should remain editable or interactive;
4. view-dependent shading, compositor effects, simulations, and procedural animation that have no direct glTF representation.

The artist-friendly answer is a **capability-aware compiler**, not a larger export form. Blendlink should inspect a scene, explain which route it will take for every important object and effect, and offer an intentional choice where more than one route is valid:

- **Preserve** portable scene data and GPU instances.
- **Realize** static Geometry Nodes results into meshes.
- **Bake** stable high-frequency appearance into textures or atlases.
- **Translate** a curated set of stylized effects into small Three.js runtime recipes.
- **Cache or proxy** topology-changing animation and simulation.
- **Block with a useful diagnosis** when none of those routes can preserve the artist's intent.

This is more valuable than checkbox parity with another engine. The sources repeatedly show that excellent work comes from a small number of exposed artistic controls, non-destructive iteration, reusable layers, and deliberate cheats. Blendlink's opportunity is to make those qualities survive the journey to the web.

## Method and limits

This report surveys primary material by Blender artists, technical artists, and production teams: their own blogs, talks, videos, files, and product documentation. It excludes generic SEO tutorials and tutorial aggregators. Official Blender, glTF, and Three.js documentation is used only to establish the portability boundary.

This is design research, not market sizing. A beautiful technique is not automatically a product requirement. Items below are ranked by recurrence, portability, and fit with a Blender-to-Three.js workflow. The companion investigation of *A Version of Reality* is intentionally not duplicated here.

## Actionable technique ledger

This is the decision-making core of the report. The summary table is ranked by probable value to a solo Blender artist building a polished Three.js site, not by technical novelty. The detailed entry numbers are stable ledger IDs, so later research can reprioritize them without renumbering references. “Requirements” describes the Blender-side evidence Blendlink must inspect. “Route” uses the compiler vocabulary defined above. Every **Prototype** entry has a deliberately small validation scene so it can become an automated fixture if the experiment succeeds.

### Priority summary

| Rank | Gem | Route | Recommendation | Why now |
| ---: | --- | --- | --- | --- |
| 1 | Unsupported procedural-material bake with layer preservation | Bake + Runtime | **Prototype** | Material mismatch is common, visible, and currently mysterious to artists. |
| 2 | Artist-authored Web Look Rig | Preserve + Runtime | **Prototype** | Turns Blender controls into usable website controls without engine-style components. |
| 3 | Camera-contract-aware toon rims and outlines | Bake or Runtime | **Prototype** | A high-impact stylized feature with a crisp fixed-camera/free-camera decision. |
| 4 | Separate authored UVs, bake UVs, lighting, and high-frequency detail | Preserve + Bake | **Prototype** | Directly protects the atlas detail that motivated Blendlink. |
| 5 | Non-destructive Geometry Nodes freeze with cost report | Realize | **Prototype** | Makes a huge class of static procedural art usable immediately. |
| 6 | Instance-preserving procedural generators | Preserve | **Prototype** | Large wins for foliage, repeated details, and download/runtime cost. |
| 7 | Topology-aware invalidation of UVs, bakes, morphs, and caches | Block | **Prototype** | Prevents expensive, silent corruption and loss of artist edits. |
| 8 | Website safe zones and seamless-loop validation | Preserve + Runtime | **Prototype** | Directly solves hero-background composition rather than generic 3D export. |
| 9 | Camera-distance haze as a lightweight web look | Runtime | **Prototype** | Cheap, common, art-directable depth without volumetrics. |
| 10 | Interactive emissive trail recipe | Runtime | **Prototype** | A compelling interactive effect that glTF animation cannot express. |
| 11 | Ambient swarm from morph variation and a target-following flock | Runtime | **Prototype** | Adds disproportionate life to small scenes from a tiny artistic setup. |
| 12 | Curve-driven speed lines and ribbons | Runtime | **Prototype** | Generalizes to motion graphics, hero flourishes, and scroll-driven effects. |
| 13 | Pixel-art presentation recipe | Runtime | **Prototype** | Clear authored constraints; small implementation surface; distinctive results. |
| 14 | Irregular-input diagnostics for procedural generators | Realize / Block | **Prototype** | Makes failures actionable on real artist geometry rather than ideal examples. |
| 15 | Brushstroke control geometry with selectable output | Realize / Bake / Runtime | **Backlog** | Valuable but needs a narrower first style and deformation contract. |
| 16 | Finite point/curve cache for procedural simulation | Cache | **Backlog** | Useful, but format and payload economics need proof. |
| 17 | Volume-to-mesh procedural freeze with quality budget | Realize | **Backlog** | Supports striking forms but can create extreme geometry unexpectedly. |
| 18 | Export author-camera culling as deleted geometry | Block | **Reject** | Incorrect for interactive cameras; runtime Three.js should own visibility. |
| 19 | General Geometry Nodes or Blender shader runtime compiler | Block | **Reject** | It would turn Blendlink into a renderer/runtime and still fail on arbitrary graphs. |

### 1. Semi-procedural material translation with preserved layers

- **Primary source:** Simon Thommes, [Procedural Shading: Fundamentals and Beyond](https://studio.blender.org/training/procedural-shading/5f0759d7f11c51bf02b95f91/), especially its semi-procedural, PBR-map generation, parametrization, node-group, and de-tiling examples; also Rik Schutte's [Color Void production process](https://studio.blender.org/blog/color-void-production-process/), which uses emission, Shader to RGB, gradients, reflection shapes, and artist controls.
- **Technique:** Separate reusable or low-frequency controls from unsupported high-frequency shader detail. Bake the latter to PBR/unlit textures or masks while retaining a small supported runtime layer such as tint, rim strength, gradient position, or reflection shape.
- **Artist problem:** A beautiful Blender material either exports as a flat approximation or forces the artist to flatten everything, sacrificing variation and art direction.
- **Blender requirements:** Inspect the active material output, node types, coordinate sources, image textures, UV maps, object/empty dependencies, drivers, and named custom properties. Identify supported glTF PBR subgraphs versus procedural islands.
- **Portable route:** **Bake + Runtime**. Preserve standard images/factors; bake unsupported branches; optionally map recognized masks/controls to a curated Three.js material recipe.
- **Expected Blendlink benefit:** A visual “what survives” breakdown, fewer surprise materials, smaller bakes than indiscriminate flattening, and retained website controls.
- **Limitations:** Arbitrary node equivalence is impossible; object/generated coordinates need a declared bake space; view-dependent nodes may require a camera contract; baking tileable detail into an atlas can destroy repetition and resolution.
- **Minimal validation scene:** One UV sphere with a Principled base texture, procedural Noise→ColorRamp roughness, object-coordinate vertical gradient, empty-driven highlight mask, and animated tint custom property. Compile it into base/ORM plus two typed runtime controls and compare four reference views.
- **Recommendation:** **Prototype.** This should become the first capability-report fixture and establish the Preserve/Bake/Runtime split.

### 2. Web Look Rig: one artist-facing control surface for a scene

- **Primary source:** Simon Thommes, [Cartoon Character Shading with Geometry Nodes](https://studio.blender.org/blog/cartoon-character-shading-with-geometry-nodes/), “Lighting Rigs”; the production used properties on a rig object to control shader-facing view-layer properties across assets.
- **Technique:** Designate an Empty or Collection as a look rig. Namespaced properties with types, ranges, descriptions, defaults, and animation become generated uniforms, variants, or application bindings.
- **Artist problem:** A solo artist can build the look in Blender but must ask a developer to recreate scattered values in code, and later tweaks drift between Blender and the website.
- **Blender requirements:** A `blendlink_*` rig marker; namespaced ID properties and UI metadata; driver/animation inspection; references from materials, lights, world, or Geometry Nodes; stable property IDs independent of display labels.
- **Portable route:** **Preserve + Runtime**. Values and keyframes enter the manifest; generated Three.js/R3F bindings update supported destinations.
- **Expected Blendlink benefit:** Blender remains the art-direction source of truth while the output stays ordinary user-owned Three.js code and data.
- **Limitations:** Do not reproduce Blender Studio's self-running “viral” Python pattern. Only explicitly supported destinations should compile; arbitrary drivers and Python expressions remain unsupported.
- **Minimal validation scene:** An Empty named `Web Look` controls fog density, rim color/width, key-light intensity, and paper-grain amount on two objects. Rename the Empty, animate one property, and verify stable IDs, typed ranges, preview parity, and generated bindings.
- **Recommendation:** **Prototype.** This is a compact, differentiating bridge between artists and custom sites.

### 3. Camera-contract-aware toon shading, inner outlines, and rims

- **Primary source:** Simon Thommes, [Cartoon Character Shading with Geometry Nodes](https://studio.blender.org/blog/cartoon-character-shading-with-geometry-nodes/). The setup flattens geometry in camera space, identifies silhouette edges, computes distance data, and derives inner outlines, directional rims, and simplified toon normals; the author documents camera dependence, mesh-resolution needs, limited line thickness, and frame-to-frame popping.
- **Technique:** Treat stylized silhouette effects as a family with two implementations: camera-locked baked/mask data for fixed views, or a curated Three.js view-dependent outline/rim/toon shader for moving cameras.
- **Artist problem:** Generic cel shading often looks cheap, while sophisticated Blender NPR work silently vanishes or breaks when the website camera moves.
- **Blender requirements:** Camera dependency, declared camera contract, mesh density, outline/rim parameters, color sources, material transparency, skinning/morphing, and whether the authored result is inside-outline, geometry-line, or post-process line art.
- **Portable route:** **Bake** for a fixed camera; **Runtime** for constrained/free cameras. Never imply that the original Geometry Nodes graph is executing on the web.
- **Expected Blendlink benefit:** A polished high-value style with an honest authoring decision and previewed movement envelope.
- **Limitations:** Screen-space outlines have different occlusion and transparency failure modes; normal-based rims do not exactly reproduce silhouette distance fields; thick lines, intersecting meshes, and animated poses need temporal tests.
- **Minimal validation scene:** A subdivided organic head plus cube, both static and skinned variants; test fixed camera, ±8° constrained orbit, and free orbit. Compare Blender reference frames at five angles and an animation frame sweep; flag popping and parity error.
- **Recommendation:** **Prototype**, beginning with runtime inner rim + quantized toon and a fixed-camera warning. Defer full silhouette-distance equivalence.

### 4. Non-destructive Geometry Nodes freeze with an evaluated-cost report

- **Primary source:** Arts 'n Science, [Scaffold Generator](https://artsnscience.eu/scaffold-generator/), which exposes a simple edge skeleton and modifier inputs while internally building reusable procedural groups; and [Remnants of Earth's First Civilization](https://artsnscience.eu/behind-the-scenes-remnants-of-earths-first-civilization/), where a volume-generated artifact is evaluated, applied, and cleaned.
- **Technique:** Evaluate static procedural geometry in a temporary copy, preserve the artist's source node tree, and report the actual export result before committing: instances, realized vertices, triangles, materials, attributes, and bounds.
- **Artist problem:** “Apply modifiers” is destructive and gives no warning when one parameter explodes a web asset from thousands to millions of triangles.
- **Blender requirements:** Evaluated depsgraph mesh, modifier animation/dependencies, simulation zones, instances, named attributes, material slots, source/evaluated bounds, and parameter metadata.
- **Portable route:** **Realize**, but only in derived export data. Preserve eligible instances separately under ledger item 5.
- **Expected Blendlink benefit:** Most static Geometry Nodes art becomes immediately usable without asking artists to make destructive duplicates.
- **Limitations:** Evaluation can be slow or memory-heavy; generated topology may be nondeterministic; loose curves/points need material and representation choices; some modifiers depend on render frame or camera.
- **Minimal validation scene:** One edge-driven scaffold with floor count and section length, containing curves, instances, captured Boolean attributes, and one deliberately dangerous “detail” input. Verify source immutability, deterministic hashes, parameter-to-cost deltas, and loud budget failure.
- **Recommendation:** **Prototype.** It is foundational and broadly useful.

### 5. Preserve procedural instances instead of realizing repeated detail

- **Primary source:** Arts 'n Science, [Scaffold Generator](https://artsnscience.eu/scaffold-generator/), which deliberately uses the Instance domain and realizes later only where required; Erindale's [Toolkit](https://erindale.gumroad.com/p/geometry-nodes-toolkit-upgrade-and-free-mini-course), which groups arrays, generators, culling, and instancing tools for artists.
- **Technique:** Recognize compatible repeated meshes and preserve their transforms as GPU instances, while explaining exactly which per-instance differences prevent preservation.
- **Artist problem:** Foliage, bolts, panels, windows, brush cards, and repeated props look lightweight in Blender but become enormous GLBs or hundreds of draw calls after naive export.
- **Blender requirements:** Instance source identity, transforms, material compatibility, negative scale, hierarchy, per-instance attributes, animation/deformation, collection instances, and realization points in the node graph/evaluated output.
- **Portable route:** **Preserve** via `EXT_mesh_gpu_instancing` where eligible; otherwise **Realize** with a cost warning.
- **Expected Blendlink benefit:** Smaller files, lower memory, and scalable environment detail without requiring artists to understand a glTF extension.
- **Limitations:** Per-instance material variation, nested animation, unique lightmaps, and object-specific semantic bindings may force splitting or realization. Baked lighting on repeated objects needs a deliberate strategy.
- **Minimal validation scene:** A 10×10 tree scatter with shared mesh/material, per-instance color attribute, two negative-scale instances, and one animated instance. Produce eligibility groups and compare file size, draw calls, transforms, and visual output against realization.
- **Recommendation:** **Prototype.** Make the failure explanation as important as the success path.

### 6. Website composition safe zones and seamless procedural loops

- **Primary source:** Tom Rethaller/BeTomorrow, [Creative Dev: Procedural Animation Using Blender Geometry Nodes](https://www.betomorrow.com/en/blog/creative-dev-procedural-animation-blender-geometry-nodes). The team used a systematic procedural recipe for related site animations, periodic inputs for reliable loops, and lighting/DOF adjustments to keep overlaid text legible.
- **Technique:** Author the scene against real breakpoint crops and DOM content safe zones; validate that periodic animation endpoints and reference frames form a clean loop.
- **Artist problem:** A hero looks good in Blender but important forms sit behind copy on the website, crop badly on mobile, or visibly jump when its background loop restarts.
- **Blender requirements:** One or more export cameras, target aspect ratios/DPR, safe-zone rectangles, focal subject, declared loop frame range, actions/drivers, and optional page-background color.
- **Portable route:** **Preserve + Runtime**. Export camera/composition metadata and animation clips; application adapters consume breakpoint and loop intent.
- **Expected Blendlink benefit:** It connects Blender work to the actual webpage rather than merely placing a canvas on top of it.
- **Limitations:** Blendlink cannot know final typography/layout without integration data; visual loop equivalence is renderer-sensitive; DOF may be too expensive or undesirable on low-end devices.
- **Minimal validation scene:** One 120-frame sine-driven procedural sculpture, a deliberately non-looping light, and desktop/mobile safe zones. Check numeric endpoints, render first/last frame differences, and overlay both crops in Blender and local preview.
- **Recommendation:** **Prototype.** Begin with guides plus numeric loop validation; visual comparison can follow.

### 7. Camera-distance haze instead of volumetrics

- **Primary source:** Arts 'n Science, [Remnants of Earth's First Civilization](https://artsnscience.eu/behind-the-scenes-remnants-of-earths-first-civilization/). The artist fakes atmospheric haze with camera-distance material data rather than simulating volume.
- **Technique:** Map camera distance through artist-authored near/far/falloff/color controls and blend toward a haze color in a material or scene-level fog pass.
- **Artist problem:** Depth and scale are essential to a beautiful hero, but Blender volumes are costly and do not export through ordinary glTF.
- **Blender requirements:** Active camera, scene scale, distance mapping, haze color, affected material/object set, background/environment, transparency, and camera movement contract.
- **Portable route:** **Runtime**, usually Three.js fog or a shader chunk; **Bake** only for a completely fixed camera.
- **Expected Blendlink benefit:** A cheap, art-directable depth cue that reproduces a common professional cheat.
- **Limitations:** Scene fog and per-material haze differ on transparent/emissive objects; physical aerial perspective is more complex; fixed world-unit distances can break across scene scale changes.
- **Minimal validation scene:** Five colored objects from 1–50 m, one transparent card, one emissive object, and an animated camera. Compare Blender material haze against Three.js linear/exp2 and custom falloff; store the closest supported mapping.
- **Recommendation:** **Prototype.** Small surface area and high visual return.

### 8. Interactive emissive trail recipe

- **Primary source:** Polyfjord, [Procedural Trail Simulation in Blender 4.4](https://www.patreon.com/polyfjord/posts/new-tutorial-in-128112747). The source effect uses Geometry Nodes to create an emissive trail following an Empty and can drive that Empty from real-time mouse input.
- **Technique:** Convert artistic trail intent into runtime parameters: source object/socket, lifetime, sample spacing/rate, width curve, color/emission gradient, tiling, smoothing, noise, and point cap.
- **Artist problem:** Trails are natural for cursor, scroll, or object interaction on a website, but the Geometry Nodes simulation cannot be represented as a glTF clip.
- **Blender requirements:** Marked source object/socket, curve/profile settings, trail material, time/lifetime, simulation zone detection, input driver, and preview motion action.
- **Portable route:** **Runtime** with generated user-owned Three.js helper/data; optionally **Cache** for a fixed authored performance.
- **Expected Blendlink benefit:** Artists can shape an interactive effect in Blender without rewriting it from scratch in TypeScript.
- **Limitations:** Runtime output will be an analogous recipe, not node-for-node parity; fast movement, frame-rate variance, transparency sorting, bloom, and mobile fill rate need budgets.
- **Minimal validation scene:** An Empty following a figure-eight clip with two trail presets, then mouse-driven in preview. Compare silhouette, lifetime, width/color ramps, endpoint motion, memory cap, and 30/60/120 Hz behavior.
- **Recommendation:** **Prototype** as the first interactive effect recipe.

### 9. Curve-driven speed lines, ribbons, and repeating tunnel strokes

- **Primary source:** Rik Schutte, [Color Void Production Process](https://studio.blender.org/blog/color-void-production-process/). Speed lines copy a track curve, use noise for offset/length, and Proximity to draw near the car; tunnel strokes derive from a tube, delete points in a repeating pattern, convert to curves, and repeatedly trim them to imply motion.
- **Technique:** Preserve simple guide curves and compile generated strokes into animated ribbons/lines whose density, length, offset, speed, proximity target, color, and width are art-directable.
- **Artist problem:** Motion-graphics flourishes are easy to author procedurally in Blender but costly or impossible to carry as changing mesh topology.
- **Blender requirements:** Source curves, target/proximity object, curve attributes, material/emission, trim animation, width profile, repetition/noise parameters, and declared maximum visible segments.
- **Portable route:** **Runtime** for interactive/continuous motion; **Realize** for a static stroke field; **Cache** only for an authored finite sequence.
- **Expected Blendlink benefit:** A reusable family of stylized motion effects for hero scenes, scroll transitions, portals, roads, and product accents.
- **Limitations:** Blender node graphs vary widely; only an explicitly annotated recipe should translate. Line width and blending differ across WebGL implementations; alpha overdraw can dominate performance.
- **Minimal validation scene:** A Bezier track, moving target, proximity-limited yellow lines, a noise-offset ribbon, and a looping trim tunnel. Test fixed animation, scroll-driven time, mobile segment cap, and first/last-frame parity.
- **Recommendation:** **Prototype** after the basic trail recipe, reusing its curve renderer and material controls.

### 10. Pixel-art presentation with a declared pixel grid

- **Primary source:** Rik Schutte, [Exploring 3D Pixel Art in Blender 4.2](https://studio.blender.org/blog/3d-pixel-art-in-blender/). The experiment combines Eevee pixel size, disabled antialiasing, Grease Pencil pixelation, screen-space Bayer texture, and constant ColorRamp steps, and documents camera/grid alignment and interpolation problems.
- **Technique:** Declare a logical render resolution and pixel grid; quantize color/value, use nearest sampling, and optionally apply ordered dithering. Preview exact CSS scaling and breakpoint behavior.
- **Artist problem:** A low-resolution style becomes soft, shimmers, or changes pixel size when the website canvas, DPR, camera, or post-processing differs from Blender.
- **Blender requirements:** Pixel size/logical resolution, camera contract, antialiasing intent, palette/quantization steps, Bayer size, Grease Pencil presence, image filtering, and output aspect ratios.
- **Portable route:** **Runtime** post-processing plus texture/material settings; selectively **Realize/Bake** Grease Pencil details.
- **Expected Blendlink benefit:** Reproducible pixel scale from Blender preview to browser, including mobile/high-DPI screens.
- **Limitations:** Camera motion creates unavoidable subpixel instability without snapping or temporal rules; CSS scaling must remain integer for crisp pixels; Grease Pencil pixels and scene pixels may use different grids.
- **Minimal validation scene:** Fixed-camera campfire-style diorama with one moving object, Grease Pencil accent, 4-level palette, 4× Bayer pattern, and desktop/mobile logical resolutions. Verify nearest scaling, grid alignment, camera-pan shimmer, and screenshot parity.
- **Recommendation:** **Prototype.** Keep it an opt-in presentation profile, not a general material translator.

### 11. Brushstroke control geometry with selectable output representation

- **Primary source:** Simon Thommes, [Basic Draw Layer](https://studio.blender.org/training/stylized-rendering-with-brushstrokes/basic-draw-layer/) and [New Custom Brushstroke Styles](https://studio.blender.org/blog/new-custom-brushstroke-styles/). The workflow combines precise drawn strokes with procedural generation and reusable/custom brush styles.
- **Technique:** Preserve the simple artist-authored curves and compile generated strokes as tubes, camera-facing ribbons/cards, packed texture overlays, or baked surface color depending on parallax and deformation needs.
- **Artist problem:** Painterly Blender scenes depend on strokes that ordinary GLB export either balloons into geometry or loses entirely.
- **Blender requirements:** Curve/Grease Pencil source, stroke style, profile, material/texture, surface attachment, grooming/deformation, camera contract, animation, and desired parallax.
- **Portable route:** **Realize**, **Bake**, or **Runtime** by an explicit per-layer choice.
- **Expected Blendlink benefit:** Painterly art can remain editable in Blender while output cost stays proportional to how the site actually uses it.
- **Limitations:** Stroke systems are diverse; transparency and overdraw are expensive; deformed surface attachment is harder than static cards; no universal automatic route will be correct.
- **Minimal validation scene:** Ten hand-drawn strokes on a static hut and five on a deforming flag; compile tubes, ribbons, and baked-overlay variants. Compare download, draw calls, parallax, deformation fidelity, and atlas detail.
- **Recommendation:** **Backlog.** First prototype one camera-facing ribbon style after the general curve runtime exists.

### 12. Topology-aware invalidation and retopology lock

- **Primary source:** Julien Kaspar, [Layered Sculpting for Einar](https://studio.blender.org/blog/layered-sculpting-for-einar/). The production found that changing retopology after sculpt layers were stored forced costly reprojection and cleanup; baking methods were unstable and some workflows required extreme memory.
- **Technique:** Fingerprint topology and dependencies for every artist-edited or expensive derived artifact, then block silent reuse when the source changes.
- **Artist problem:** An artist tweaks geometry and unknowingly ships stale UVs, atlas pixels, morphs, sculpt-derived normals, or animation caches—or loses carefully edited derived data during regeneration.
- **Blender requirements:** Stable object ID, vertex/loop/polygon topology hash, modifier/evaluated hash, UV-layer hash, material/bake dependency hash, shape keys, armature, authored atlas UV status, and cache provenance.
- **Portable route:** **Block** stale output with explicit Rebuild, Reproject, Keep Source, or Duplicate-and-Compare remedies.
- **Expected Blendlink benefit:** Trust. The compiler protects irreplaceable work and explains why an output became stale.
- **Limitations:** Some harmless edits change hashes; evaluated topology can be expensive to calculate; automated reprojection is not always safe and should not be implied.
- **Minimal validation scene:** Mesh with authored atlas UV, normal/AO bake, one shape key, and a cached procedural effect. Test transform-only edit, material edit, vertex-position edit, edge split, modifier reorder, and object rename; verify only true dependencies invalidate.
- **Recommendation:** **Prototype.** This belongs in core compiler correctness, not a later optimization phase.

### 13. Finite point/curve cache for procedural simulations

- **Primary source:** Arts 'n Science, [Simulating Slime Mold in Blender](https://artsnscience.eu/slime-mold/), where particles deposit, sense, diffuse, and decay a trail field; and Clay Hunter Welch, [Procedural Animation: the Plexus Effect](https://clay-hunter-welch.com/procedural-animation-the-plexus-effect/), where proximity/height rules create animated connections.
- **Technique:** Sample a finite procedural performance into compact point positions, widths/ages/colors, curve endpoints, or event data instead of a full mesh per frame.
- **Artist problem:** Procedural animation is visually compelling but transform/morph clips cannot represent changing point populations or connections, and Alembic-like mesh caches are too large for small websites.
- **Blender requirements:** Simulation zone/cache, frame range/rate, stable or unstable point IDs, attributes, connection rules, interpolation tolerance, loop intent, bounds, and maximum population.
- **Portable route:** **Cache** into a Blendlink-defined user-owned binary/JSON contract rendered by a thin Three.js adapter.
- **Expected Blendlink benefit:** A middle path between freezing one frame and rebuilding an entire simulation runtime.
- **Limitations:** This adds a non-glTF artifact; changing topology complicates interpolation; payload and decode cost may still be too high; accessibility/reduced-motion variants are needed.
- **Minimal validation scene:** 200 particles with stable IDs plus a 20-particle birth/death subset and proximity connections over 120 frames. Compare raw mesh sequence, point cache, curve/event cache, compression, decode, interpolation, and loop seam.
- **Recommendation:** **Backlog** until a real target scene justifies the format. Prototype only as an experiment, not a public contract.

### 14. Volume-to-mesh procedural freeze with a quality budget

- **Primary source:** Arts 'n Science, [Remnants of Earth's First Civilization](https://artsnscience.eu/behind-the-scenes-remnants-of-earths-first-civilization/). The artifact uses texture-driven volume density converted to mesh; the author chose a 250–300 resolution balance, reported multi-second evaluation, applied the result, and manually removed floating pieces.
- **Technique:** Evaluate volume-generated geometry at a chosen preview/final resolution, isolate disconnected components, simplify, and report geometry/normal/UV consequences before export.
- **Artist problem:** Volume-to-mesh is a powerful route to intricate stylized forms but hides explosive polygon growth and often creates floating debris or unwrapped surfaces.
- **Blender requirements:** Volume resolution/voxel size, source field, component sizes, evaluated triangle count, bounds, normals, material coordinates, cleanup rules, simplification tolerance, and UV/bake plan.
- **Portable route:** **Realize**, followed by optional decimation and **Bake** for procedural material detail.
- **Expected Blendlink benefit:** Artists can use expressive implicit modeling while seeing exactly what the website will pay.
- **Limitations:** Quality loss from decimation is style-dependent; UV creation may be poor; resolution changes alter topology and invalidate bakes; evaluation may exceed consumer hardware.
- **Minimal validation scene:** Noise-driven cylindrical volume at three resolutions with two floating components, slope material, and target silhouette camera. Measure evaluation, memory, triangles, decimation error, UV density, and screenshot difference.
- **Recommendation:** **Backlog.** Core static freeze and budget reporting should land first.

### 15. Author-camera culling must not become export deletion

- **Primary source:** Erindale, [Easy Camera Culling with Geometry Nodes](https://www.youtube.com/watch?v=Maqs85Lgj5Y) and [Camera Culling and LODs](https://www.youtube.com/watch?v=7J-bpAvImfs). These are useful Blender authoring/render optimizations built around a camera.
- **Technique:** Use camera/frustum/distance fields to reduce generated scene detail while authoring or rendering.
- **Artist problem:** An artist expects a large procedural environment to stay efficient, but a website may have a different or interactive camera.
- **Blender requirements:** Detect camera/object-info dependencies, culled branches, LOD selection, export camera contract, and whether hidden population still exists upstream.
- **Portable route:** **Block** destructive fixed-camera deletion unless the project declares a fixed camera. For interactive scenes, preserve sources/instances and generate runtime LOD/culling metadata instead.
- **Expected Blendlink benefit:** Prevents mysteriously missing scenery while still capturing LOD intent.
- **Limitations:** Reconstructing upstream populations from an already-culled evaluated mesh may be impossible; runtime LOD thresholds need screen-space calibration.
- **Minimal validation scene:** Forest generated beyond one Blender camera frustum, with a second website camera moving behind it. Confirm the compiler blocks evaluated deletion, preserves instances, and emits runtime LOD thresholds; allow fixed-camera export only when explicit.
- **Recommendation:** **Reject** camera-culling-as-deletion as a default. **Backlog** annotation of runtime LOD intent.

### 16. Do not build a general Geometry Nodes or shader runtime compiler

- **Primary source:** The limitations are visible across Simon Thommes' camera-specific [Wing It! shading](https://studio.blender.org/blog/cartoon-character-shading-with-geometry-nodes/), Arts 'n Science's stateful [slime-mold simulation](https://artsnscience.eu/slime-mold/), and Polyfjord's interactive [trail simulation](https://www.patreon.com/polyfjord/posts/new-tutorial-in-128112747): superficially similar “node effects” depend on entirely different geometry, state, camera, renderer, and interaction semantics.
- **Technique:** Node graphs compose arbitrary data processing, simulation, geometry, shading, and renderer-specific behavior.
- **Artist problem:** “Export my nodes” sounds like the least-friction promise.
- **Blender requirements:** In practice, full node semantics, dependency graph, simulation state, shader model, texture sampling, derivatives, precision, compositor, Python, drivers, and Blender-version compatibility.
- **Portable route:** **Block** the universal promise. Use explicit Preserve/Realize/Bake/Runtime/Cache routes and a small reviewed recipe library.
- **Expected Blendlink benefit:** Focus remains on dependable artist outcomes rather than an incomplete second Blender runtime.
- **Limitations:** Some users will still request arbitrary node execution; recipe coverage grows slowly and needs visual regression fixtures.
- **Minimal validation scene:** The three primary-source classes above are the falsification set. If one generic translator cannot preserve their meaning without embedding Blender-like runtime systems, the boundary is confirmed.
- **Recommendation:** **Reject.** This is a product guardrail, not a missing feature.

### 17. Ambient swarm from morph variation and a target-following flock

- **Primary source:** Ian Hubert, [Animate Moths in Blender — Lazy Tutorials](https://www.youtube.com/watch?v=imkSdlbXB_U). Hubert models one wings-down moth, adds a wings-up shape key with a noisy F-curve, duplicates variants with offset noise, emits the collection as particles, uses Boids physics, and gives the flock a Follow Leader rule targeting a lamp.
- **Technique:** Reduce a convincing ambient swarm to one cheap deforming asset, phase/shape variation, repeated instances, a target, and a handful of flock controls such as speed, turn rate, separation, and attraction.
- **Artist problem:** Small website scenes often feel sterile, yet hand-animating dozens of secondary creatures or motes is unreasonable.
- **Blender requirements:** Source collection, base/morph mesh compatibility, noisy shape-key animation, particle/Boids settings, leader target, birth/lifetime, mass/speed/angular velocity/personal space, instance count, and material.
- **Portable route:** **Preserve** the source mesh/morph and **Runtime** a lightweight target-following swarm recipe. A fixed performance could alternatively use **Cache**.
- **Expected Blendlink benefit:** High perceived life from tiny source assets, artist-tuned in Blender and driven by a cursor, light, scroll target, or scene socket on the web.
- **Limitations:** Runtime Boids will not reproduce Blender deterministically; avoidance and flock settings differ; dozens of independently skinned/morphed meshes may be expensive; reduced-motion behavior is necessary.
- **Minimal validation scene:** Six moth variants sharing one mesh and one wing morph, a lamp leader moving on a loop, and 50 emitted instances. Compare broad flock envelope, phase diversity, attraction/separation, GPU-instanced rendering, 30/60 Hz stability, and a reduced-motion mode that freezes or lowers population.
- **Recommendation:** **Prototype.** Build on the instance and runtime-recipe foundations; do not attempt to export legacy Blender particle simulation itself.

### 18. Irregular-input diagnostics for procedural generators

- **Primary source:** Gabriel Stones, [Roof Generator Experiments 01 — Blender Geometry Nodes](https://gabrielstones.com/blog/qgGV/roof-generator-experiments-01-blender-geometry-nodes). Stones tests irregular building blocks and bevelled corners, extracts the top plane, finds the longest roughly parallel edges, bisects/extrudes/booleans a roof, drives its apex by proximity, and documents failure on non-parallel edges and non-flat roof planes.
- **Technique:** Express a procedural tool's input assumptions explicitly and diagnose the specific violated assumption on the artist's geometry.
- **Artist problem:** Real source meshes are bevelled, non-rectangular, open, non-manifold, unevenly scaled, or ambiguously oriented. A generic “modifier/export failed” message leaves artists unable to repair them.
- **Blender requirements:** Modifier inputs, mesh manifold/boundary state, face orientation, transforms, edge-angle distribution, disconnected components, attribute presence/domain, and generator-specific declared preconditions.
- **Portable route:** **Realize** when the evaluated output is valid; otherwise **Block** with highlighted geometry and a concrete remedy.
- **Expected Blendlink benefit:** Preflight becomes an artist tool rather than a developer log, and fixtures reflect real production geometry instead of cubes.
- **Limitations:** Blendlink cannot infer every custom node group's intended contract. Generic checks can identify symptoms; richer checks require optional annotations on node-group inputs/outputs.
- **Minimal validation scene:** Five roof footprints: clean rectangle, bevelled rectangle, concave L, non-planar outline, and open/non-manifold outline. The report must isolate the offending edges/faces, explain which assumption failed, and still compile valid cases.
- **Recommendation:** **Prototype** generic mesh/input diagnostics and a small annotation contract; **Backlog** generator-specific rules.

### 19. Separate authored UVs, bake UVs, lighting, and high-frequency detail

- **Primary source:** Blender Studio/Aidy Burrows, [UV Final Layout](https://studio.blender.org/training/game-asset-creation/56041551044a2a00d0d7e08e/), [Cord Baking and Multiple UV Sets](https://studio.blender.org/training/game-asset-creation/56041551044a2a00d0d7e096/), and [Baking All Layers Down to One](https://studio.blender.org/training/game-asset-creation/56041551044a2a00d0d7e09d/). The course treats shared-image UV layout, AO/normal/base-color baking, multiple UV sets, layered painting, and final flattening as distinct but connected decisions.
- **Technique:** Keep the artist's material/detail UVs separate from non-overlapping bake/light UVs; preserve tileable high-frequency images and tangent normals while atlasing lower-frequency baked light or flattening only the layers that need it.
- **Artist problem:** A one-atlas solution can needlessly destroy texel density, texture repetition, hand-edited UVs, normal detail, and later editability—the exact failure mode motivating Blendlink's atlas redesign.
- **Blender requirements:** Every UV layer and active/render designation, overlap/distortion/degenerate checks, per-material coordinate source, tangent-normal dependencies, image resolution/filtering, texel density, island ownership/pins, bake channel frequency, and runtime texture-slot budget.
- **Portable route:** **Preserve + Bake**. Preserve authored material UVs/images; create or use an editable bake UV; emit separate detail/PBR and light/baked-state textures, packing channels only where semantics and filtering agree.
- **Expected Blendlink benefit:** Better visual detail at equal payload, editable atlas layouts, safer rebakes, and a plan that explains why an image is shared, tiled, atlased, or left alone.
- **Limitations:** Additional textures and UV sets cost memory and bindings; Three.js lightmap conventions may require a specific UV set; compression artifacts differ across color, normal, mask, and lighting data; mip padding remains essential.
- **Minimal validation scene:** Three objects sharing a 512² tileable detail texture, each with authored overlapping material UVs, unique non-overlapping bake UVs, tangent normals, and two lighting states. Compare one flattened atlas against separated detail + light atlases for payload, GPU memory, achieved px/m, mip seams, and screenshot detail.
- **Recommendation:** **Prototype immediately.** This fixture should gate atlas architecture and prevent regressions toward destructive flattening.

## Ranked source map

| Rank | Source | Why it is high signal for Blendlink |
| ---: | --- | --- |
| 1 | [Simon Thommes and Blender Studio](https://studio.blender.org/blog/cartoon-character-shading-with-geometry-nodes/) | Production-tested stylized rendering, procedural shading, Geometry Nodes as artist tooling, downloadable examples, and candid failure analysis. |
| 2 | [Arts 'n Science](https://artsnscience.eu/) | Detailed first-person technical breakdowns covering procedural generators, simulations, landscapes, materials, performance ceilings, and artistic cheats. |
| 3 | [Erindale](https://erindale.gumroad.com/) | A technical director's reusable Geometry Nodes vocabulary, with artist-facing groups for curves, falloffs, fields, generators, mapping, masks, utilities, culling, LOD, and instancing. |
| 4 | [Ian Hubert's Lazy Tutorials](https://www.youtube.com/@IanHubert2) | Strong evidence for a workflow built around perceptual impact, camera-aware shortcuts, projection, instancing, and rapid iteration rather than technical purity. |
| 5 | [Clay Hunter Welch](https://clay-hunter-welch.com/procedural-animation-the-plexus-effect/) | A veteran Pixar technical artist documenting compact procedural animation systems and the final polish layers that make them read. |
| 6 | [BeTomorrow creative development](https://www.betomorrow.com/en/blog/creative-dev-procedural-animation-blender-geometry-nodes) | A real website use case connecting brand art direction, Geometry Nodes, looping motion, text legibility, and late-stage non-destructive iteration. |
| 7 | [Gabriel Stones](https://gabrielstones.com/blog) | Honest work-in-progress writing about procedural generators, greyboxing, irregular inputs, limits, and negotiating the feature list of an artist tool. |
| 8 | [Polyfjord](https://www.youtube.com/c/Polyfjord/videos) | Accessible procedural animation and simulation with artist-controlled inputs, including interactive trail generation. |
| 9 | [Blender Studio's Game Asset Creation course](https://studio.blender.org/training/game-asset-creation/56041551044a2a00d0d7e089/) | A useful baseline for UVs, multiple UV sets, AO/normal/base-color baking, layered painting, LODs, and export as one coherent asset workflow. |

## What the strongest sources teach us

### 1. Simon Thommes and Blender Studio: stylization is a stack of controllable layers

The *Wing It!* character look was not one magic toon shader. It combined hand-painted base color, procedural patterns, fake reflections, toon shading, fake rim lights, outlines, paper texture, subsurface scattering, and modified normals. Geometry Nodes generated surface attributes for the shader, including camera-dependent distance fields derived from silhouettes. The article is unusually valuable because it states the limitation plainly: the outline and rim data is calculated for a particular camera and the illusion breaks when the view changes. It also describes temporal cleanup as a production requirement because small impurities flicker from pose to pose. [Cartoon Character Shading with Geometry Nodes](https://studio.blender.org/blog/cartoon-character-shading-with-geometry-nodes/)

That leads to several concrete Blendlink ideas:

- Treat stylized appearance as named layers rather than flattening everything into one opaque bake.
- Detect camera-dependent Geometry Nodes inputs and label the result **view-dependent**.
- For a fixed website camera, offer a camera-locked bake with an explicit safe movement envelope.
- For an interactive camera, translate supported layers such as rim, quantized light, outlines, paper grain, and fake reflection masks into runtime uniforms/passes.
- Export authored mask attributes or bake them to compact channels; show a preview of what data will survive.
- Add temporal validation for animated stylized effects: render or sample several frames and identify line popping, changing topology, or attributes that appear/disappear.

The production also shows a useful control pattern. Lighting-rig properties drove many linked shading parameters without duplicating controls across objects. Blendlink could recognize a designated **Web Look Rig** and expose its custom properties as typed runtime uniforms, variants, or animation channels in the generated manifest.

Blender Studio's brushstroke workflow reinforces the same product shape. The Draw layer combines precise manual stroke placement with procedural complexity, while brush styles are reusable and customizable. [Basic Draw Layer](https://studio.blender.org/training/stylized-rendering-with-brushstrokes/basic-draw-layer/) [Custom Brushstroke Styles](https://studio.blender.org/blog/new-custom-brushstroke-styles/)

The portable lesson is not “export Blender brushstrokes automatically.” It is **keep the artist's simple authored control geometry, then choose a web representation for the generated complexity**. Curves may become tubes, ribbons, instanced cards, baked texture layers, or a runtime stroke recipe. Blendlink should let the artist inspect that choice before compilation.

Blender Studio's production write-ups are also candid about workflow failures. Its layered-sculpting investigation reports unstable baking, huge memory requirements, topology changes that forced costly reprojection, and the need to lock retopology before final detail layers. [Layered Sculpting for Einar](https://studio.blender.org/blog/layered-sculpting-for-einar/)

Blendlink should therefore track more than file timestamps:

- topology fingerprints for authored UVs, baked layers, morph targets, and cached effects;
- dependency explanations such as “this atlas is stale because the source topology changed”;
- a clear distinction between regenerable derived data and irreplaceable artist edits;
- non-destructive preview compilation before committing a new bake.

### 2. Arts 'n Science: expose the generative skeleton, budget the evaluated result

The scaffold generator starts from editable edges and exposes the floor count, height, depth, and section length in the modifier instead of asking the artist to edit its node graph. Internally, it is decomposed into reusable groups, preserves instances while practical, captures semantic attributes such as ladder placement, and only realizes them where later processing requires it. [Scaffold Generator](https://artsnscience.eu/scaffold-generator/)

This is an excellent model for Blendlink's Geometry Nodes treatment:

- Surface modifier inputs as an **Artist Parameters** summary without reproducing the node editor.
- Preserve named inputs, defaults, min/max ranges, descriptions, and animation state in the manifest.
- Report procedural cost both before and after realization: instances, realized vertices, triangles, materials, attribute bytes, and estimated draw calls.
- Recognize semantic attributes and offer an explicit mapping to vertex data, object metadata, runtime parameters, or discard.
- Warn when a harmless-looking parameter change crosses a web budget.

The site's artifact breakdown gives a rare numerical example: a volume-to-mesh result at resolution 250–300 took seconds to evaluate and was then applied and cleaned up. It also uses slope masks, randomized texture-island rotation to hide tiling, camera-distance haze instead of true volumetrics, instanced low-poly figures for scale, and alpha-masked planes to fake cloud shadows. [Remnants of Earth's First Civilization](https://artsnscience.eu/behind-the-scenes-remnants-of-earths-first-civilization/)

These suggest practical compiler features:

- A **procedural freeze preview** that evaluates modifiers in a copy, reports the cost, and never destroys the artist's node setup.
- Slope, curvature-like, position, proximity, and camera-distance masks as first-class bake channels.
- A diagnostic for Blender-generated coordinates or unsupported procedural textures with choices to bake, replace, or map to a supported runtime recipe.
- Lightweight effect recipes for height/slope material blends, distance haze, alpha cloud shadows, and randomized tile transforms.
- A scene-scale sanity check so distance-based effects can be reproduced consistently in Three.js.

The slime-mold article is also a useful boundary case. Its appearance emerges from a simulation state: particles sense a trail field, deposit energy, and the field diffuses and decays. That is not ordinary glTF animation. [Simulating Slime Mold](https://artsnscience.eu/slime-mold/)

Blendlink should identify Geometry Nodes simulation zones and present honest routes: freeze one frame, bake a finite cache, export a reduced point/curve cache, or rebuild a specifically supported simulation at runtime. “Apply modifiers” is not an adequate explanation.

### 3. Erindale: artists benefit from a vocabulary of small, composable tools

Erindale describes the toolkit as procedural tools that empower artists. The field-era version contains groups organized into curves, falloffs, fields, generators, mapping, masks, and utilities; earlier versions emphasized camera culling and LOD before expanding into arrays and instancing. [Erindale Toolkit overview](https://erindale.gumroad.com/p/geometry-nodes-toolkit-upgrade-and-free-mini-course) [Camera Culling and LODs](https://www.youtube.com/watch?v=7J-bpAvImfs)

The design lesson is important: Blendlink should not grow into a second Geometry Nodes library. It should define a small vocabulary of **export meanings** that can be attached to any artist's nodes:

- static generator;
- repeated/instanced asset;
- LOD source or LOD selector;
- visibility/culling helper;
- material or bake mask;
- runtime parameter;
- animation/cache source;
- authoring-only helper.

This vocabulary can drive compilation without forcing the artist to adopt proprietary node groups. An optional Blendlink node library could annotate those meanings automatically, but ordinary Geometry Nodes setups should remain usable.

Camera culling inside an authored Blender scene is not equivalent to web runtime culling. Blendlink should detect it and avoid destructively exporting only what one authoring camera sees unless the scene is explicitly a fixed-camera experience. For interactive scenes, it should retain the population and let Three.js frustum/LOD logic operate at runtime.

### 4. Ian Hubert: optimize for the image and the iteration loop

Ian Hubert's work is less like a reference manual and more like a sustained demonstration that convincing worldbuilding often comes from projection, duplication, constrained camera choices, reusable pieces, and aggressive perceptual shortcuts. The compact [Lazy Tutorials](https://www.youtube.com/@IanHubert2) include procedural creature motion such as [Animate Moths](https://www.youtube.com/watch?v=imkSdlbXB_U) and repeated demonstrations of getting a readable result without building an academically complete asset.

The Blendlink takeaway is a workflow principle:

> Ask what the camera and interaction actually require before spending texture memory, topology, bake time, or runtime code.

Concrete features:

- Let the artist declare the camera contract: fixed, constrained orbit, or free camera.
- Preview the real website crop, safe areas, DPR, and target device while still in Blender.
- Optimize by projected importance, not only world-space surface area: screen coverage, distance, focus, and camera range should influence atlas density and LOD.
- Support camera-projected and card-based elements intentionally, with warnings only when the declared camera can expose the trick.
- Offer **hero**, **supporting**, and **background** quality roles that affect bake density, compression, LOD, shadows, and update frequency together.

This is also a useful pushback against indiscriminate “feature parity.” A technically exhaustive panel makes the artist decide implementation details too early. Blendlink should ask about artistic constraints and derive most transport settings.

### 5. Clay Hunter Welch: procedural motion still needs a finishing stack

Welch's Plexus piece builds relationships between procedural particles according to an artistic rule, adds constraints so antennae seat correctly, then finishes the result with lighting, depth of field, volumetric fog, bloom, baked irradiance, dust, and motes. [Procedural Animation: the Plexus Effect](https://clay-hunter-welch.com/procedural-animation-the-plexus-effect/)

The lesson is that “export the animation” is too narrow. Blendlink should describe the complete presentation stack and identify which layers are geometry, material, lighting, camera, and post-processing.

Potential features:

- A generated **look manifest** listing tone mapping, exposure, bloom intent, fog, depth of field, environment, and baked-light contribution.
- A web preview that can compare Blender reference frames with Three.js output and isolate mismatches by layer.
- Runtime recipes for common lightweight polish such as bloom, distance fog, depth of field, additive motes, and emissive trails.
- A warning when an effect exists only in Blender's compositor and therefore is absent from the GLB.

### 6. BeTomorrow: a web scene is composed with the page, not merely embedded in it

BeTomorrow used a systematic Geometry Nodes recipe so five website animations could be different while sharing a visual language. Periodic mathematical inputs guaranteed loops. Because the animations sit behind text, the team darkened text-heavy regions and used depth of field to preserve legibility. Non-destructive controls allowed structural changes with a brand designer very late in production. [Creative Dev: Procedural Animation Using Blender Geometry Nodes](https://www.betomorrow.com/en/blog/creative-dev-procedural-animation-blender-geometry-nodes)

This source is directly applicable to Blendlink:

- Add a **Website Composition** camera overlay with breakpoint crops and content safe zones.
- Let safe zones influence lighting/bake diagnostics without silently modifying the art.
- Validate seamless loops by comparing endpoints for transforms, morph weights, parameters, and optionally rendered reference frames.
- Preserve a small set of meaningful art-direction parameters as named variants instead of baking every exploration into a separate asset.
- Support multiple compositions from one `.blend`: desktop/mobile crops or a small family of related hero scenes.

### 7. Gabriel Stones: irregular inputs and honest limits define the quality of an artist tool

Stones' roof-generator write-up starts from an actual greyboxing need, tests irregular and bevelled building footprints, explains each geometric step, lists limitations, and explicitly asks which features are necessary versus merely nice to have. The work ultimately moved to Houdini because the target workflow needed Unreal brush support, not because the Geometry Nodes result was visually inadequate. [Roof Generator Experiments](https://gabrielstones.com/blog)

Two product principles follow:

- Diagnostics should use the artist's object and explain the failing assumption: open boundary, non-manifold input, unexpected corner angle, unapplied scale, unstable topology—not “export failed.”
- Every Blendlink feature should name its supported input contract and test irregular real scenes, not only ideal cubes.

It also reinforces the need to distinguish the generated visual result from the downstream editing representation. Sometimes a realized mesh is correct; sometimes preserving a level-design primitive or procedural control is the whole point.

### 8. Polyfjord: interactive procedural effects need a route other than glTF clips

Polyfjord's procedural trail uses a Geometry Nodes simulation driven by an animated empty, including a workflow where mouse input drives the control object. [Procedural Trail Simulation](https://www.patreon.com/polyfjord/posts/new-tutorial-in-128112747)

This is exactly the kind of effect artists will reasonably expect to see on an interactive website, but glTF cannot carry the underlying simulation logic. Blendlink should provide a curated recipe for trails—source object/socket, lifetime, sampling rate, width curve, color/emission, noise, and maximum points—rather than asking artists to recreate it in TypeScript. The recipe should still produce plain Three.js-facing data and code, not require a proprietary engine runtime.

### 9. Game-asset fundamentals still matter

Blender Studio's game-asset curriculum treats modeling, UV layout, AO/normal/base-color baking, multiple UV sets, layered painting, LOD creation, and export as one connected workflow. [Game Asset Creation](https://studio.blender.org/training/game-asset-creation/56041551044a2a00d0d7e089/)

Blendlink's atlas work should respect this continuity:

- Preserve authored UVs and explain when a separate bake UV set is needed.
- Detect overlap, inverted/degenerate islands, insufficient padding, inconsistent texel density, and tangent discontinuities before a costly bake.
- Keep high-frequency normals and material detail separate from low-frequency baked lighting when combining them would cause needless loss.
- Show the compression and mip cost of padding, alpha, normal maps, and additional atlases—not just atlas occupancy.

## The actual portability boundary

The official Blender exporter can evaluate modifiers, export experimental Geometry Nodes instances, emit `EXT_mesh_gpu_instancing`, export UVs/normals/tangents, and export mesh attributes whose names begin with an underscore. This means some Geometry Nodes work is more portable than a naive “bake everything” approach suggests. [Blender 5 glTF export options](https://docs.blender.org/manual/en/5.0/addons/import_export/scene_gltf2.html)

However, Blender's node materials are much broader than glTF materials. The exporter recognizes specific PBR/unlit arrangements and image textures; Blender's general procedural shader graph does not become portable shader code. [Blender glTF materials](https://docs.blender.org/manual/en/3.3/addons/import_export/scene_gltf2.html) [Shader export constraints](https://docs.blender.org/manual/en/3.1/addons/import_export/node_shaders_info.html)

Core glTF animation targets node translation, rotation, scale, and morph weights. It does not represent changing topology, arbitrary Geometry Nodes graphs, simulations, material-node parameters, or compositor graphs. [glTF 2.0 animation specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#animations)

Three.js `GLTFLoader` supports GPU instancing, Basis/KTX textures, mesh compression, unlit and many PBR material extensions, and a plugin mechanism. These are strong portable building blocks; Blendlink should compose them rather than replace them. [`GLTFLoader`](https://threejs.org/docs/pages/GLTFLoader.html)

### Technique routing matrix

| Blender technique | Default web route | Important caveat |
| --- | --- | --- |
| Static Geometry Nodes mesh generation | Evaluate in a copy and export mesh | Report evaluated triangle/attribute/material cost and retain source node graph in `.blend`. |
| Repeated compatible instances | `EXT_mesh_gpu_instancing` | Fall back when per-instance materials, hierarchy, deformation, or unsupported attributes require it. |
| Procedural PBR material | Bake unsupported parts into PBR textures | Preserve reusable/tileable textures where atlasing would reduce detail or destroy repetition. |
| Named geometry/shader attributes | Export or bake only explicitly retained attributes | Attribute domain/type/interpolation and byte cost must be visible. |
| Fixed-camera rim/outline/fake reflection | Camera-locked bake or generated mask | Invalid when the web camera leaves the authored envelope. |
| Free-camera toon/rim/outline | Curated Three.js shader/pass recipe | Requires visual parity testing; do not imply raw Blender nodes are exported. |
| Grease Pencil / brushstroke layers | Curves, ribbons/cards, texture layer, or bake | Route depends on required parallax, deformation, and camera freedom. |
| Transform/armature/shape-key animation | glTF animation clips | Loop behavior and clip orchestration live in application metadata, not core glTF. |
| Simulation or animated topology | Freeze, finite cache/proxy, or supported runtime recipe | Potentially large; must estimate download, decode, memory, and update cost. |
| Volumes, Cycles-only effects, Shader to RGB | Bake, cards/slices, or handcrafted runtime effect | Mark as Blender-only until a specific translator exists. |
| Compositor effects | Three.js post stack or omitted with warning | Preview must expose the difference. |

## Recommended product capabilities

### P0: make the compiler explain itself

1. **Scene capability report**
   - Per object/material/effect: Preserve, Realize, Bake, Runtime Recipe, Cache, Authoring Only, or Unsupported.
   - One sentence explaining the choice and the consequence.
   - Estimated geometry, texture, animation, memory, and draw-call impact.

2. **Reference-frame parity view**
   - Capture one or more Blender reference frames.
   - Compare them against the local Three.js preview.
   - Toggle geometry, base color, baked light, dynamic light, outlines, fog, bloom, and tone mapping to localize differences.

3. **Geometry Nodes preflight**
   - List modifiers, simulation zones, instances, named attributes, animated inputs, camera dependencies, and evaluated costs.
   - Never apply or mutate the artist's source objects.

4. **Appearance-loss diagnostics**
   - Detect unsupported shader nodes, compositor-only effects, generated/object coordinates, Shader to RGB, volumes, and camera-dependent data.
   - Offer relevant remedies instead of a generic warning.

5. **Topology dependency tracking**
   - Fingerprint source/evaluated topology and associate it with UV layouts, bakes, morphs, and caches.
   - Block silent reuse of stale derived data.

### P1: provide a small library of high-value translations

1. **Web Look Rig**: export selected Blender custom properties as typed uniforms/variants with ranges and descriptions.
2. **Stylized material layers**: unlit/base texture, quantized light, rim, inner/outer outline, matcap/fake reflection, paper/grain overlay, slope/height/proximity masks.
3. **Presentation effects**: fog, bloom intent, depth of field, alpha cloud shadows, emissive particles/motes.
4. **Interactive recipes**: trails, simple curve ribbons, sockets/follow targets, and parameter-driven variants.
5. **Website composition overlays**: desktop/mobile aspect ratios, safe zones, focal point, text regions, and constrained-camera envelope.
6. **Loop validation**: numeric endpoint tests and optional visual seam comparison.

### P2: deeper procedural preservation

1. Preserve eligible Geometry Nodes instances as `EXT_mesh_gpu_instancing` with a fallback explanation.
2. Map selected named attributes to custom vertex attributes or packed textures.
3. Export multiple parameterized variants from one procedural source without duplicating shared data.
4. Add finite point/curve cache formats for effects where a full mesh cache is wasteful.
5. Explore material graph pattern recognition only after the curated runtime recipes have proven valuable.

## Example artist-facing diagnoses

Good diagnostics describe intent, evidence, and remedy:

> **Ink outline depends on Camera_Main.** It will match only within the declared 8° orbit. Keep the camera constrained, bake the fixed view, or use the Web Outline recipe for a free camera.

> **Forest realizes 184,320 repeated trees into 38.2M triangles.** The instances are eligible for GPU instancing if `WindStrength` is moved from per-instance material data to a shared runtime parameter.

> **RockMaterial uses Noise Texture → ColorRamp.** glTF cannot carry that node graph. Bake it at 512 px/m, retain it as a tileable texture, or translate the slope mask into the Web Terrain recipe.

> **Trail_GN changes topology over frames 1–120.** Transform animation cannot preserve it. Freeze frame 60, compile a 4.8 MB point cache, or use the interactive Web Trail recipe.

> **Main atlas cannot meet the hero's detail target.** `Face` would fall from 768 to 311 px/m. Move it to its own atlas, reduce lower-priority objects, or explicitly accept the lower density.

## Pushback and guardrails

Mining expert artists is a strong ongoing input, but it can become an attractive distraction. Three guardrails keep it productive:

1. **Do not implement a technique because it is impressive.** Require a recurring artist job, a plausible portable representation, and a reference scene that can become a regression test.
2. **Do not turn Blendlink into a renderer.** Curated Three.js recipes are appropriate when they preserve common artistic intent; a general Blender shader compiler or Geometry Nodes runtime is a different product.
3. **Do not expose one checkbox per discovered trick.** Group techniques under artist concepts—camera contract, presentation layer, quality role, portability route—and derive lower-level settings.

A useful research-to-product loop would be:

1. collect a primary-source technique and its `.blend` or reproducible scene;
2. classify it with the routing matrix;
3. prototype the smallest preservation route;
4. compare Blender and Three.js reference frames;
5. test the UI with an artist who did not build the feature;
6. keep it only if it reduces real handoff work.

## Bottom line

The expert sources do reveal a promising hole: artists have extraordinary procedural and stylized capabilities inside Blender, while web pipelines usually reduce the handoff to “supported glTF or not.” Blendlink can occupy the missing middle by understanding artistic intent well enough to choose and explain a preservation strategy—without becoming a cloud, engine, or second scene editor.

The ledger points to a concrete first tranche rather than broad feature parity: prototype **semi-procedural material routing**, **separate authored/detail/light UV workflows**, the **Web Look Rig**, and **non-destructive Geometry Nodes freeze/cost reporting** as shared compiler foundations. Use the outline, haze, trail, swarm, and pixel-art scenes as the first style-specific experiments. Every promoted gem should ship with its minimal validation scene as a regression fixture; otherwise it remains research, not a product feature.
