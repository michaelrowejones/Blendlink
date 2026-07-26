# aVersion of Reality technique ledger for Blendlink

Research date: 2026-07-19

## Purpose

This is a technique-mining ledger, not a product-positioning document. It extracts concrete Blender techniques from aVersion of Reality, classifies how each could cross the Blender-to-Three.js boundary, and gives Blendlink a falsifiable next action.

The sources are the artist's own posts and videos plus current official Blender and glTF documentation. Recommendations are engineering judgments, not claims made by the artist.

## Representation vocabulary

- **Preserve** — carry ordinary evaluated geometry, normals, UVs, textures, armatures, morphs, animation, or metadata through glTF.
- **Realize** — evaluate Blender procedural construction into ordinary geometry or attributes before export.
- **Bake** — materialize appearance or data into textures on an artist-owned UV layout.
- **Runtime** — emit a small, documented, user-owned Three.js shader/control adapter.
- **Cache** — convert time-dependent Blender evaluation into supported animation data or a bounded baked sequence.
- **Block** — reject export because a faithful portable result has not been selected.

Blender's glTF exporter supports a bounded Metal/Rough PBR and unlit material model plus documented extensions; it does not serialize arbitrary Blender shader or Geometry Nodes graphs. Standard animation export covers object/bone transforms and shape-key values, while custom properties can be exported as application-specific `extras`. [Blender glTF exporter manual](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html) The classifications below stay inside that boundary or call out the small runtime adapter required to cross it.

## Priority ledger

### T01 — UV-space EEVEE materializer

- **Exact source:** [How to Bake (most) Textures with Eevee in Blender](https://www.youtube.com/watch?v=wZyLNWT4spE)
- **Technique:** Duplicate a target mesh in Geometry Nodes, split its UV seams, replace vertex positions with UV coordinates, assign a bake material, and render the flattened “UV canvas” through a unit orthographic camera. Store any source attributes needed by the material before flattening. Use compositor alpha processing to fill a seam margin and a File Output node to write the texture. The video demonstrates flat material color, text, curve and Grease Pencil superimposition, stored vertex color, stored normals, simple shading derived from stored normals, and tangent-space normal decals. [UV canvas construction](https://www.youtube.com/watch?v=wZyLNWT4spE&t=55s) [orthographic capture](https://www.youtube.com/watch?v=wZyLNWT4spE&t=380s) [margin construction](https://www.youtube.com/watch?v=wZyLNWT4spE&t=660s) [normal decals](https://www.youtube.com/watch?v=wZyLNWT4spE&t=1020s)
- **Artist problem:** Cycles baking adds sampling, noise, target-node setup, and high-to-low projection machinery even when the desired result is a deterministic procedural color, decal, attribute, or normal composition. The author explicitly limits the technique to mesh-to-self materialization, decals, superimpositions, procedural textures, and related data—not general world-space lighting. [Author's video description and limits](https://www.youtube.com/watch?v=wZyLNWT4spE)
- **Blender requirements:** A non-overlapping destination UV map; Geometry Nodes `Named Attribute`, `Store Named Attribute`, `Set Position`, and `Split Edges`; an EEVEE-compatible material; an orthographic camera; compositor output and margin nodes. Current Blender 5.0 documentation still lists the relevant Geometry Nodes and named-attribute workflow, and now exposes `uv_seam` as a Boolean edge attribute, eliminating the video's Blender 4.0 workaround of copying seam state into bevel weights. [Blender 5.0 Geometry Nodes index](https://docs.blender.org/manual/en/5.0/modeling/geometry_nodes/index.html) [Blender 5.0 attributes, including `uv_seam`](https://docs.blender.org/manual/en/5.0/modeling/geometry_nodes/attributes_reference.html)
- **Portable representation:** **Bake.** The output should be an ordinary color/data/normal texture on the committed atlas UVs. The UV-canvas object and helper camera are compiler temporaries, not exported scene content.
- **Expected Blendlink benefit:** Hypothesis: a fast Preview/Final path for otherwise nonportable EEVEE procedural color, decals, masks, custom attributes, and custom-normal detail, without invoking Cycles for data that has no path-traced component. It also provides a natural materializer for artist-edited atlas layouts.
- **Risks and limitations:** Flattening changes position, derivatives, adjacency, and the surface's relationship to lights and other objects. The author shows that world-space AO and lighting do not transfer correctly without reconstructing them; high-to-low projection is possible in principle but is explicitly not demonstrated. [World-space limitation](https://www.youtube.com/watch?v=wZyLNWT4spE&t=950s) [high-to-low deferred](https://www.youtube.com/watch?v=wZyLNWT4spE&t=1225s) Overlapping/mirrored UVs are ambiguous; face-corner interpolation and seam splitting must be correct; tangent-space normals require a proven basis; EEVEE node support remains finite. [Current EEVEE node limits](https://docs.blender.org/manual/en/5.0/render/eevee/limitations/nodes_support.html) Blendlink's existing post-lossy constant-background contract must not be replaced by the video's generic compositor inpaint.
- **Validation scene:** One mesh with two material slots, asymmetric islands, one intentionally mirrored island, alpha-cutout decals, UV/object/world-coordinate procedural colors, a stored color attribute, a custom-normal attribute, and a tangent normal decal. Render source EEVEE, UV-space output, and a Cycles emission bake at 256/1024 px. Measure interior RMSE, seam delta, alpha coverage, color transform, tangent response under a rotating light, render time, and repeatability. World-coordinate/AO cases must be expected failures or explicit blocks.
- **Recommendation:** **Prototype**, narrowly as `Bake Material to Atlas (EEVEE)`. Do not use it for GI, AO, cast shadows, or as a blanket replacement for Cycles baking.

### T02 — Multi-source custom normals with a preview-to-texture final

- **Exact source:** [A Custom Normals Workflow for Clean, Stylized Toon Shading](https://www.aversionofreality.com/blog/2022/4/21/custom-normals-workflow) and [Customizing Normals Series](https://www.aversionofreality.com/blog/2022/3/19/customizing-normals)
- **Technique:** Model a clean simplified source shape independently of the deforming/render mesh; transfer its normals to the destination; add local detail-normal sources; combine the layers in world space with surface-gradient or normal-map math. Use lower-detail transferred vertex normals for interactive design, then bake the high-detail result to a normal texture. The author explicitly separates base shape, broad normal source, detail normals, and rig-driven masks. [Workflow structure and deformation strategy](https://www.aversionofreality.com/blog/2022/4/21/custom-normals-workflow)
- **Artist problem:** Hard toon boundaries magnify topology/interpolation artifacts, while a mesh optimized for deformation and silhouette rarely produces the simplified shading shapes an illustrator wants. Small deformations can also invalidate static custom-normal corrections. [Problem statement](https://www.aversionofreality.com/blog/2022/4/21/custom-normals-workflow)
- **Blender requirements:** Source and destination meshes; Data Transfer or Geometry Nodes attribute transfer; stored vector attributes; optional detail textures; a stable destination UV map. Geometry Nodes can store, transform, transfer, and pass arbitrary attributes to shaders. [Geometry Nodes capabilities used by the workflow](https://www.aversionofreality.com/blog/2022/4/21/custom-normals-workflow)
- **Portable representation:** **Preserve** evaluated split normals for rigid/static meshes; **Bake** layered high-detail normals for final quality; **Block** a supposedly deformation-safe static correction that fails representative poses.
- **Expected Blendlink benefit:** A distinctive “stylized normal compiler” could preserve an artist's clean toon shading while making its Preview/Final representation explicit. This fits the existing atlas and bake pipeline better than general shader translation.
- **Risks and limitations:** Vertex-normal previews are density/interpolation limited. A tangent-space normal texture is only correct when the application basis matches the basis used at bake time; changing destination custom normals after baking can distort the result. [Vertex-density and tangent-basis warning](https://www.aversionofreality.com/blog/2022/4/21/custom-normals-workflow)
- **Validation scene:** A toon head with a smooth proxy, nose/brow detail sources, jaw deformation, and three lighting angles. Compare source Blender, exported vertex-normal Preview, and baked-normal Final over neutral, smile, and open-jaw poses. Verify `NORMAL`/`TANGENT`, seam continuity, and silhouette-independent toon bands.
- **Recommendation:** **Prototype** immediately after T01; this is the highest-value artist technique in the corpus.

### T03 — UV-flattened meshes for predictable attribute transfer

- **Exact source:** [Custom normals: UV meshes](https://www.aversionofreality.com/blog/2022/4/21/custom-normals-workflow)
- **Technique:** Duplicate source and destination meshes, set their positions to UV coordinates, and perform proximity transfer in the common flattened domain. Because topology correspondence remains available, data can be transferred back to the original geometry. The author also uses the flattened surface as a renderable bake canvas. [UV mesh description](https://www.aversionofreality.com/blog/2022/4/21/custom-normals-workflow)
- **Artist problem:** Direct 3D proximity transfer becomes unreliable when source/destination shapes differ or topology is chosen for different purposes.
- **Blender requirements:** Corresponding UV parameterizations, topology/attribute transfer, Geometry Nodes duplicates, and a clear policy for seams and overlapping islands.
- **Portable representation:** **Bake** or **Realize** the transferred result; never export the flattened helpers.
- **Expected Blendlink benefit:** This is the generalized primitive underneath T01 and T02: it could make decal projection, custom-normal transfer, and material-layer composition predictable on editable atlas UVs.
- **Risks and limitations:** UV distortion becomes transfer distortion; overlaps are ambiguous; different source/destination unwraps need a defined mapping; discontinuities require face-corner handling.
- **Validation scene:** Transfer a circular normal/detail patch from a simple proxy onto a bent destination with uneven 3D topology but matching UVs. Compare direct 3D proximity against UV-space transfer near seams and high-curvature areas.
- **Recommendation:** **Prototype** as an internal library primitive, not a separate artist feature.

### T04 — Radial/spherical normals for stylized foliage volumes

- **Exact source:** [Stylized Tree Shader Tutorial](https://www.aversionofreality.com/blog/2022/8/7/stylized-tree-shader)
- **Technique:** Replace or blend leaf normals with radial/spherical directions so a cluster of cards reads as one clean crown; compensate for object transforms; add normal noise and surface-gradient detail; combine leaf alpha/normal textures, randomized UVs, AO modulation, and distance-from-camera masks. [Tutorial topic list](https://www.aversionofreality.com/blog/2022/8/7/stylized-tree-shader)
- **Artist problem:** Individually lit leaf cards look noisy and expose their construction instead of reading as a designed foliage volume.
- **Blender requirements:** A stable crown center or controller, evaluated custom normals, correct normal-space transforms, leaf alpha textures, and optional per-island attributes.
- **Portable representation:** **Preserve** evaluated vertex normals for rigid crowns; **Bake** high-frequency normal/color detail; **Runtime** only for camera-distance behavior that genuinely needs to change.
- **Expected Blendlink benefit:** High visual payoff for portfolio scenes with little runtime complexity. It is also a strong stress test for custom normals, instancing, alpha coverage, and KTX texture handling.
- **Risks and limitations:** Non-uniform transforms and differently transformed instances can invalidate an object-space construction. Skinning or wind deformation can separate shipped normals from the intended volume. Camera-distance masks add a runtime shader dependency.
- **Validation scene:** A crown made from instanced alpha cards under uniform and non-uniform instance scales, a rotating sun, two camera distances, and optional branch sway. Compare rigid Preserve, realized instances, and baked detail.
- **Recommendation:** **Prototype** as the first non-character stylized-normal demo.

### T05 — Surface-gradient combination of custom and tangent detail normals

- **Exact source:** [Custom normal combination](https://www.aversionofreality.com/blog/2022/4/21/custom-normals-workflow) and [Stylized Tree surface gradients](https://www.aversionofreality.com/blog/2022/8/7/stylized-tree-shader)
- **Technique:** Treat detail normals as surface gradients and combine them mathematically with a clean broad normal field, rather than naively adding RGB normal colors. This allows a modeled/procedural broad shape and texture detail to coexist. [Transferred and tangent normal combination](https://www.aversionofreality.com/blog/2022/4/21/custom-normals-workflow)
- **Artist problem:** Applying a tangent normal map after replacing base normals can distort the detail because normal and tangent axes no longer match the bake basis.
- **Blender requirements:** Explicit normal spaces, a tangent basis, vector math or node groups, and a data-texture color-space path.
- **Portable representation:** Prefer **Bake** into one validated final normal texture. Use **Runtime** only if the detail mix must remain interactive.
- **Expected Blendlink benefit:** Higher-fidelity normal atlases and a clear diagnostic for a subtle failure artists otherwise discover visually.
- **Risks and limitations:** A custom tangent implementation may not match MikkTSpace; normal textures must bypass display transforms; seams and mirrored islands need sign-correct tangents. The author calls out the compliance problem directly. [Custom tangent limitation](https://www.aversionofreality.com/blog/2022/4/21/custom-normals-workflow)
- **Validation scene:** MikkTSpace reference asset with mirrored UVs, hard seams, a custom broad normal field, and a fine checker normal. Compare Blender, generated texture, glTF validator, and Three.js under a rotating light.
- **Recommendation:** **Prototype** as part of T02; **Block** export when basis consistency cannot be proven.

### T06 — Deterministic random-per-island and random-per-object texture selection

- **Exact source:** [Random Modular Textures Tutorial](https://www.aversionofreality.com/blog/2021/4/4/random-modular-textures) and [Stylized Tree randomized UV/island topics](https://www.aversionofreality.com/blog/2022/8/7/stylized-tree-shader)
- **Technique:** Split a sheet into tiles, select a tile with random values, and vary related colors/details per object or UV island. The Reimu project uses 4D White Noise to obtain multiple values for randomized card symbols and borders. [Reimu material variation](https://www.aversionofreality.com/blog/2021/1/22/reimu-hakurei-workflow-test)
- **Artist problem:** Repeated props and foliage need variety without many manually duplicated materials or textures.
- **Blender requirements:** A modular tile atlas, a stable identity/seed domain, UV transforms or tile indices, and material preview.
- **Portable representation:** **Realize** deterministic choices into UVs, vertex/instance attributes, or atlas-tile indices; use **Runtime** only for deliberate changing variation.
- **Expected Blendlink benefit:** More organic scenes at almost no texture cost, while source-controlled seeds prevent rebuilds from visually shuffling the scene.
- **Risks and limitations:** Blender element indices are not a durable identity across topology/version changes; joining, realizing instances, or repacking can change randomness. Blender 5.0 warns that geometry element order is not guaranteed across algorithms or versions. [Geometry randomization warning](https://docs.blender.org/manual/en/5.0/modeling/geometry_nodes/inspection.html)
- **Validation scene:** 100 instanced cards and 20 foliage islands. Rename/reorder objects, alter unrelated topology, rebuild twice, realize instances, and repack atlases. Hash chosen tiles/colors by stable Blendlink ID.
- **Recommendation:** **Prototype** a stable `blendlink_*` seed materializer; do not preserve implicit Blender randomness.

### T07 — Projected texture eyes controlled by empties/bones

- **Exact source:** [Projected Texture Eyes Tutorial Series](https://www.aversionofreality.com/blog/2021/3/2/projected-texture-eyes-tutorial-series) and [Reimu eye setup](https://www.aversionofreality.com/blog/2021/1/22/reimu-hakurei-workflow-test)
- **Technique:** Keep the toon eye surface stationary and move object-projected procedural/image textures across it. Empty objects constrained to bones control iris/pupil position; gradients build masks; object-space displacement creates the eye indentation; rotation limits constrain camera tracking. [Projected eye overview and controls](https://www.aversionofreality.com/blog/2021/3/2/projected-texture-eyes-tutorial-series)
- **Artist problem:** Large spherical or concave toon eyes deform poorly and require cumbersome shape keys if geometry itself performs every expression/look direction.
- **Blender requirements:** Eye geometry, object-coordinate texture graph, controller empties/bones, constraints/drivers, masks, and sufficient subdivision for displacement.
- **Portable representation:** **Runtime** a narrow projected-eye shader with stable controller bindings; **Bake** a fixed eye pose; **Block** unsupported material drivers if neither path is chosen.
- **Expected Blendlink benefit:** A high-impact character feature that demonstrates stable semantic bindings between Blender controls and a thin Three.js shader.
- **Risks and limitations:** Arbitrary Blender material drivers are not core glTF animation; procedural node parity is not guaranteed; dynamic displacement can be expensive or alias at silhouettes; eye tracking must be constrained consistently in both runtimes.
- **Validation scene:** Two eyes with shared material, independent controllers, target tracking, limit constraints, blink shape keys, and three camera positions. Validate controller animation, projected iris position, silhouette, and close-up aliasing.
- **Recommendation:** **Prototype** only after the control-binding contract exists; otherwise **Backlog**.

### T08 — Layered hard/soft toon shading, AO, rim, gloss, and shadow hue

- **Exact source:** [Reimu materials](https://www.aversionofreality.com/blog/2021/1/22/reimu-hakurei-workflow-test) and [Miku shader structure](https://www.aversionofreality.com/blog/2019/4/9/hatsune-miku-v3)
- **Technique:** Compose hard cel shading, one or more soft shading layers, AO, conventional gloss, a boosted white rim, material-specific thresholds/roughness, and deliberate light/shadow hue shifts. Hair adds strand breakup, UV tip shading, and a projected highlight. [Reimu layer breakdown](https://www.aversionofreality.com/blog/2021/1/22/reimu-hakurei-workflow-test)
- **Artist problem:** Generic physically based response does not reproduce deliberately illustrated value grouping and color design.
- **Blender requirements:** EEVEE/Shader-to-RGB or equivalent NPR groups, light setup, per-material controls, and optional custom attributes/textures. EEVEE supports Shader to RGB but documents it as EEVEE-only. [Current EEVEE node support](https://docs.blender.org/manual/en/5.0/render/eevee/limitations/nodes_support.html)
- **Portable representation:** **Bake** the final result for static lighting; optionally **Bake** named masks/layers; **Runtime** only an explicitly supported small stylized material contract.
- **Expected Blendlink benefit:** Converts recognizable artist concepts into a portable result instead of silently degrading an unsupported graph to Principled PBR.
- **Risks and limitations:** Baking freezes light/view response; separate layers increase bytes and samplers; a runtime shader broad enough to accept arbitrary graphs becomes an engine.
- **Validation scene:** Cloth, plastic, skin, and hair swatches under key/fill/rim lights with shadow hue shifts. Compare flattened bake, four packed effect masks, and one intentionally narrow runtime toon template.
- **Recommendation:** **Backlog** the runtime shader; **Prototype** detection plus flattened EEVEE materialization through T01.

### T09 — Painter-style AOV/effect layers

- **Exact source:** [Rendering Paint Layers in Blender](https://www.aversionofreality.com/blog/2021/6/3/rendering-paint-layers), [Changing Materials By Layer](https://www.aversionofreality.com/blog/2021/7/2/changing-material-by-layer), and [Finalizing Renders With Paint Layers](https://www.aversionofreality.com/blog/2021/8/20/finalizing-renders-with-paint-layers)
- **Technique:** Output base color, shading, highlights, and related custom material contributions as independent AOV/render layers; switch material behavior per layer when needed; recombine them as a painter-like stack for corrections. [AOV layer workflow](https://www.aversionofreality.com/blog/2021/6/3/rendering-paint-layers) [final correction workflow](https://www.aversionofreality.com/blog/2021/8/20/finalizing-renders-with-paint-layers)
- **Artist problem:** NPR images often need local cleanup and additions that the renderer cannot conveniently produce; artists understand editable paint layers better than monolithic shader output.
- **Blender requirements:** AOV or render-layer outputs, known blend formulas/color spaces, optional material overrides, and a compositing preview.
- **Portable representation:** **Bake** effect layers and flatten by default; retain separate packed masks/textures only when the website actually changes them.
- **Expected Blendlink benefit:** Artist-editable web textures and optional runtime recoloring/relighting without forcing every effect into a shader graph.
- **Risks and limitations:** Layer count multiplies storage and texture sampling; blend modes and color transforms must be exact; painted corrections can become stale when UVs, pose, or lighting change.
- **Validation scene:** Four material swatches and one hero prop; emit base, hard shade, soft/AO, rim, and line/detail. Verify Blender and Three.js recomposition numerically before channel packing and KTX encoding.
- **Recommendation:** **Prototype** one four-layer recipe after T01; reject unlimited arbitrary AOV export.

### T10 — Matcap/procedural fake metallic reflections

- **Exact source:** [Faking Toon Metallic Reflections](https://www.aversionofreality.com/blog/2021/5/27/faking-metallics)
- **Technique:** Replace or augment physically reflected environment detail with reflection mapping, matcaps, or UV/layer-weight-driven graphic reflection textures. [Methods covered](https://www.aversionofreality.com/blog/2021/5/27/faking-metallics)
- **Artist problem:** Screen-space or baked reflections may be technically limited and stylistically too literal for toon materials.
- **Blender requirements:** Reflection/view-normal coordinates, matcap or procedural texture, masks, and art-directed intensity/rotation.
- **Portable representation:** **Runtime** a tiny matcap shader; **Bake** only for a locked camera.
- **Expected Blendlink benefit:** Small implementation, strong stylized payoff, predictable cost.
- **Risks and limitations:** Inherently view-dependent; differs between perspective/orthographic cameras; tangent/normal errors become visible; it is not ordinary glTF PBR.
- **Validation scene:** Convex, concave, and thin metallic forms under rotating object/camera, with a Blender reference and Three.js matcap adapter.
- **Recommendation:** **Backlog** as an optional stylized material module.

### T11 — Shot-specific projected shadows and face shading

- **Exact source:** [Reimu shot-specific adjustments](https://www.aversionofreality.com/blog/2021/1/22/reimu-hakurei-workflow-test)
- **Technique:** Replace face normals with controllable projected procedural shading for a chosen view; render cast/occlusion shadows in Cycles and window-project them in an EEVEE material. The author explicitly reports that the face setup fails from some angles and projected shadows are absent from turntables. [Documented constraints](https://www.aversionofreality.com/blog/2021/1/22/reimu-hakurei-workflow-test)
- **Artist problem:** A hero shot may need clean graphic shading and shadow shapes that general dynamic lighting does not produce.
- **Blender requirements:** A named camera, projection coordinates, baked shadow image, and rig/material controls.
- **Portable representation:** **Bake** for one declared camera; otherwise **Block**. Do not label it free-camera safe.
- **Expected Blendlink benefit:** Enables extremely polished fixed-view website heroes while making the constraint honest and testable.
- **Risks and limitations:** Breaks with camera, pose, or occluder changes; can double-shade if runtime lights remain enabled; projected data needs a defined aspect ratio and crop.
- **Validation scene:** Hero camera plus ±5°, ±15°, and mobile aspect variants; pose and light change. Record the acceptable envelope and block outside it.
- **Recommendation:** **Prototype** only as a `Hero Camera Bake` profile; **Reject** automatic use in free-camera scenes.

### T12 — Line-art combination rather than one universal line method

- **Exact source:** [Miku line-art comparison](https://www.aversionofreality.com/blog/2019/4/9/hatsune-miku-v3) and [Reimu line art](https://www.aversionofreality.com/blog/2021/1/22/reimu-hakurei-workflow-test)
- **Technique:** Combine material/normal-based lines for clean viewport-feedback with Freestyle/LANPR/Grease Pencil or authored geometry for marked edges and external contours. The author documents that post-process lines support more edge types and separate compositing but can glitch and require camera/resolution retuning; material lines are clean and art-directable but cannot reproduce every marked/external edge. [Tradeoff list](https://www.aversionofreality.com/blog/2019/4/9/hatsune-miku-v3)
- **Artist problem:** No single line technique provides clean contours, internal marked lines, viewport feedback, editable layers, and camera-independent thickness.
- **Blender requirements:** Marked edges/material masks, line renderer or Grease Pencil, camera/resolution controls, and manual cleanup as needed.
- **Portable representation:** **Bake** a fixed-camera line overlay; **Realize** artist-authored curve/mesh lines; **Block** Blender-only line systems otherwise.
- **Expected Blendlink benefit:** Honest preservation of lines for fixed 3D heroes without committing to a general NPR renderer.
- **Risks and limitations:** Resolution and distance dependence, external contour coverage, alpha ordering, and manual edits.
- **Validation scene:** Character bust at desktop/mobile resolutions and three camera distances; compare baked overlay and exported curve geometry for thickness, gaps, and silhouette behavior.
- **Recommendation:** **Backlog**. Start with diagnostics and fixed-camera bake; reject promised Freestyle/Grease Pencil parity.

### T13 — Proxy simulation/deformation meshes with rendered followers

- **Exact source:** [Reimu clothing and hair](https://www.aversionofreality.com/blog/2021/1/22/reimu-hakurei-workflow-test) and [Miku cloth workflow](https://www.aversionofreality.com/blog/2019/4/9/hatsune-miku-v3)
- **Technique:** Simulate or rig simple non-rendering cloth/cage/lattice/curve structures, bind detailed render meshes with Surface Deform/Mesh Deform/modifier stacks, then save useful results to shape keys or correct them by hand. [Reimu proxy construction](https://www.aversionofreality.com/blog/2021/1/22/reimu-hakurei-workflow-test) [Miku simple simulation mesh](https://www.aversionofreality.com/blog/2019/4/9/hatsune-miku-v3)
- **Artist problem:** Render topology is too detailed or poorly structured for stable simulation and convenient rigging.
- **Blender requirements:** Evaluated dependency graph, simulation caches, follower modifiers, hidden proxy classification, and an exportable final animation representation.
- **Portable representation:** **Realize** a static evaluated result; **Cache** to armature/shape keys/bounded sequences where supported; **Block** live time-dependent modifiers with no selected conversion.
- **Expected Blendlink benefit:** Prevents invisible helper meshes from leaking into the site and catches animation that looks correct in Blender but freezes on export.
- **Risks and limitations:** General mesh-cache export can be large; topology-changing modifiers cannot become ordinary morph targets; rebaking invalidates hand corrections.
- **Validation scene:** Thin cloth proxy driving a detailed garment, lattice-driven hair, one topology-changing node, and one shape-key cache. Check exported object set and animation across the full frame range.
- **Recommendation:** **Prototype** diagnostics and static realization; **Backlog** broad cache conversion.

### T14 — Procedural transparent shells instead of true volumetrics

- **Exact source:** [Reimu procedural shell effect](https://www.aversionofreality.com/blog/2021/1/22/reimu-hakurei-workflow-test)
- **Technique:** Layer procedural textures and displacement over multiple spherical shells to create a stylized flame/volume effect without true volumetrics. [Author's construction](https://www.aversionofreality.com/blog/2021/1/22/reimu-hakurei-workflow-test)
- **Artist problem:** A graphic energy/fire effect may not need or suit physically based volumetric rendering.
- **Blender requirements:** Shell meshes, procedural/baked textures, displacement or animated UVs, transparency, and sorting-aware preview.
- **Portable representation:** **Realize** shell geometry, **Bake** procedural textures, and optionally **Runtime** simple UV/time animation.
- **Expected Blendlink benefit:** Converts an otherwise Blender-specific effect into ordinary web geometry and textures.
- **Risks and limitations:** Transparency overdraw, sorting artifacts, mobile fill-rate, and mismatch between Blender and Three.js blend modes.
- **Validation scene:** Four nested shells against light/dark backgrounds on mobile/desktop GPU budgets; record overdraw, draw calls, sorting, and KTX alpha quality.
- **Recommendation:** **Backlog** with an explicit overdraw diagnostic.

## Focused finding: should Blendlink prototype the EEVEE method?

### What the video actually demonstrates

It does **not** add a native texture-bake operation to EEVEE. It constructs a renderable UV-space surrogate:

1. import/copy target geometry into a Geometry Nodes “UV Canvas”;
2. read its UV map and set mesh positions to those coordinates;
3. split the geometry along UV seams;
4. optionally remove a mirrored duplicate and choose a replacement material;
5. center/rotate the unit UV square for a size-1 orthographic camera;
6. render the EEVEE material with transparent film;
7. use compositor alpha erosion/inpaint to grow a texture margin;
8. write the render to disk and reload it on the source material. [Construction walkthrough](https://www.youtube.com/watch?v=wZyLNWT4spE&t=55s) [camera/output walkthrough](https://www.youtube.com/watch?v=wZyLNWT4spE&t=380s) [margin walkthrough](https://www.youtube.com/watch?v=wZyLNWT4spE&t=660s)

Any source-space value needed after flattening is stored first as an attribute. The video stores original normals, reads them in the UV-canvas material, and demonstrates both normal-derived diffuse response and a tangent normal decal. [Stored normal demonstration](https://www.youtube.com/watch?v=wZyLNWT4spE&t=830s) [normal decal demonstration](https://www.youtube.com/watch?v=wZyLNWT4spE&t=1020s)

The method is therefore best understood as **rasterizing an evaluated material/data graph over UV triangles**. It is strongest for self-materialization, decals, masks, colors, attributes, and normal composition. It is not a general surface-to-surface ray projection and it does not preserve effects that depend on the source mesh's original world position, surrounding geometry, or path-traced light transport. The author states those limits in the video and description. [Limits](https://www.youtube.com/watch?v=wZyLNWT4spE&t=950s)

### Is it current in Blender 5.x?

Yes, the core mechanism remains available, and one awkward step is now simpler.

The Blender 5.0 manual still documents the Geometry Nodes operations and named-attribute system the construction needs. It identifies UV maps as face-corner attributes and documents `uv_seam` directly as a Boolean edge-domain attribute. [Blender 5.0 Geometry Nodes](https://docs.blender.org/manual/en/5.0/modeling/geometry_nodes/index.html) [Blender 5.0 attribute reference](https://docs.blender.org/manual/en/5.0/modeling/geometry_nodes/attributes_reference.html) The video, made against Blender 4.0, copies UV seam state into `bevel_weight_edge` because it could not read seams directly; a Blender 5.x implementation should read `uv_seam` and avoid repurposing another system's attribute. [Video's seam workaround](https://www.youtube.com/watch?v=wZyLNWT4spE&t=115s)

A local headless probe against the installed Blender build produced:

```text
VERSION 5.2.0 LTS
ENGINES ['BLENDER_EEVEE']
GN_TYPES True
ATTRIBUTES [..., 'UVMap', ..., 'uv_seam']
UV_SEAM_VALUES [True, False, False]
```

The probe created a triangle, a UV layer, and one seam, then checked the current RNA node types `GeometryNodeSetPosition`, `GeometryNodeInputNamedAttribute`, `GeometryNodeStoreNamedAttribute`, and `GeometryNodeSplitEdges`. This is reproducible local evidence that the specific construction primitives exist in Blender 5.2.0 LTS; it is not a claim that the full video node group has already passed Blendlink's color, tangent, or margin contracts.

Current EEVEE still has engine-specific and unsupported shader-node behavior, so “the node group runs” is not equivalent to “every Blender material can be baked faithfully.” [Blender 5.0 EEVEE node support](https://docs.blender.org/manual/en/5.0/render/eevee/limitations/nodes_support.html) Cycles remains the documented bake path for AO, soft shadows, lightmaps, and other intensive light-transport results, using scene samples and bounces. [Blender render baking](https://docs.blender.org/manual/en/5.0/render/cycles/baking.html)

### Recommendation

**Prototype it as a constrained EEVEE materializer.** The prototype should answer four questions before it becomes a feature:

1. Does it preserve color/data transforms exactly under Blendlink's Standard/None/0 save contract?
2. Can it produce seam-safe output without weakening the existing post-lossy constant-background rule?
3. Can it produce MikkTSpace-compatible normal output across mirrored islands and custom normals?
4. Is it materially faster than the existing Cycles emission/data path on representative procedural materials after setup and image I/O?

Pass criteria:

- deterministic byte-identical output on two consecutive renders;
- interior color error below a declared tolerance against an EEVEE reference;
- no seam halo after mip generation and KTX compression;
- correct rotating-light response for tangent normals, including mirrored islands;
- at least a meaningful measured preview-time win on procedural color/decal workloads;
- loud rejection of world-space/AO/shadow cases.

If those pass, ship it as `Preview/Final > Bake Material (EEVEE)` with supported-use labels: **Color, Decal, Mask, Attribute, Normal Detail**. Keep `Bake Lighting (Cycles)` as the GI/AO/shadow path. If tangent or color correctness cannot be guaranteed, restrict the first release to color and scalar masks rather than broadening the promise.

## Recommended prototype order

1. **T01 UV-space EEVEE materializer**, initially color/mask/decal only.
2. **T02/T05 stylized normal compiler**, including tangent and deformation tests.
3. **T04 radial foliage demo** as the rigid/instanced normal stress case.
4. **T06 deterministic variation materializer** for repeated props and foliage.
5. **T09 four-layer stylized bake** with exact recomposition and visible cost.
6. **T07 projected-eye controller binding** after stable runtime controls exist.

Everything else remains a backlog item or a diagnostic until a real scene requires it. This ordering mines the artist's concrete techniques while keeping Blendlink focused on compiling them into portable, inspectable web assets rather than reproducing Blender's renderer in Three.js.
