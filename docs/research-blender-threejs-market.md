# Blender to Three.js authoring: market and product-gap research

Research date: 2026-07-19

## Executive conclusion

There is a real problem here, but **“streamline Blender to Three.js” is not by itself an open market position**. Exporting glTF, loading it in Three.js, optimizing it, generating React components/types, hot-reloading a browser, visually authoring interactions, baking lightmaps, and self-hosting are all available somewhere in the current ecosystem. Most notably, Needle Engine now provides a Blender-first web-project generator, automatic export on `.blend` save, browser refresh, optimization, self-hosted deployment, and experimental Cycles lightmapping with automatic UV generation and multiple lighting scenarios. A broad artist-friendly bridge would therefore enter an occupied category, not create one. [Needle's Blender workflow](https://engine.needle.tools/docs/blender/) [Needle lightmapping](https://engine.needle.tools/docs/blender/lightmapping) [Needle deployment](https://engine.needle.tools/docs/how-to-guides/deployment/)

A narrower gap is defensible:

> **Make a `.blend` file a typed, validated, repository-owned web-scene package for custom Three.js and React Three Fiber sites — including controllable, artist-owned baked lighting — without requiring a proprietary runtime, cloud, or second scene editor.**

The evidence supports each part of that seam:

- Blender's exporter is a strong, standards-oriented transport tool, but users still report repetitive export setup and iteration work in large scenes. [Khronos exporter issue #1038](https://github.com/KhronosGroup/glTF-Blender-IO/issues/1038) [issue #1407](https://github.com/KhronosGroup/glTF-Blender-IO/issues/1407)
- Three.js users have reported that manipulating named contents of a loaded glTF requires awkward traversal; glTF itself says user-defined names are not necessarily unique. [Three.js issue #18530](https://github.com/mrdoob/three.js/issues/18530) [glTF name contract](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#reference-name)
- Core glTF has no lightmap material slot. Three.js has a runtime `lightMap`, but authoring, binding, UV ownership, color handling, and alternate lighting remain pipeline responsibilities. This is an inference from the exhaustive core material schema, the extension registry, and Three.js's material API — not a claim that no vendor extension or engine can carry lightmaps. [glTF materials](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#materials) [glTF extension registry](https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md) [Three.js `lightMap`](https://threejs.org/docs/pages/MeshStandardMaterial.html#lightMap)
- Lightmapping users report exactly the atlas failure modes at issue here: a single atlas making UV area too small, controls that do not explain themselves, and automatic preparation preventing use of authored UVs. These reports establish recurring pain, although not its market size. [The Lightmapper issue #132](https://github.com/Naxela/The_Lightmapper/issues/132) [issue #77](https://github.com/Naxela/The_Lightmapper/issues/77)

The recommended wedge is therefore not “another exporter,” “another packer,” or “a no-code web engine.” It is the **source-controlled contract between a Blender artist and a custom web team**, with baked-lighting authoring as the technically difficult flagship workflow.

## What this research can and cannot establish

This is desk research against official documentation, specifications, first-party repositories, and first-party issue trackers. It can verify feature coverage and reveal recurring user problems. It cannot establish willingness to pay, frequency across the total market, or whether the proposed interface is preferred. Feature absence is not demand evidence; open issues are not market sizing. The final section proposes tests that can falsify the product thesis.

## The baseline pipeline is already strong

### Blender and glTF

The official Blender exporter already handles meshes, Principled/unlit materials, textures, cameras, punctual lights, animation, and custom properties in glTF `extras`. It can remember export settings in the `.blend`, and Blender 2.8+ ships the exporter by default. [Blender glTF manual](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html) [official exporter repository](https://github.com/KhronosGroup/glTF-Blender-IO)

The exporter is deliberately a glTF implementation, not a web-application contract. Custom properties are application-specific extras without a namespace imposed by glTF. Its own repository describes conversion through an intermediate glTF scene representation and tests export validity with the glTF validator. [Blender custom properties](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html#custom-properties) [exporter tests](https://github.com/KhronosGroup/glTF-Blender-IO#continuous-integration-tests)

This means Blendlink should not compete on “can export a GLB.” It should extend the official exporter with durable artistic intent, semantic validation, and web-specific derived artifacts.

### Three.js

Three.js recommends glTF as its primary asset format. `GLTFLoader` returns scenes, animations, cameras, parser state, and user data, and supports a broad set of ratified compression and material extensions. It also exposes a plugin API for application-specific extensions. [Three.js recommended model workflow](https://threejs.org/manual/en/loading-3d-models.html) [`GLTFLoader`](https://threejs.org/docs/pages/GLTFLoader.html)

The Three.js editor can import and export GLB/glTF and publish an application, but it is a separate web scene editor rather than a source-linked Blender workflow. [Three.js editor](https://threejs.org/editor/)

Three.js itself documents the remaining application seam. Its glTF tutorial inspects a loaded scene by dumping the hierarchy, then notes that application-specific path data would require a custom exporter, naming scheme, or equivalent metadata. [Three.js glTF tutorial](https://threejs.org/manual/en/load-gltf.html)

### React Three Fiber, drei, and gltfjsx

For React teams, drei's `useGLTF` removes loader boilerplate. `gltfjsx` goes much further: it turns a GLB into reusable JSX, can emit TypeScript node/material types, and can invoke glTF Transform to compress, resize, deduplicate, instance, and prune assets. Its own README explicitly identifies traversal, mutation, reuse, compression, and unnecessary node structure as problems in the raw glTF workflow. [gltfjsx](https://github.com/pmndrs/gltfjsx) [drei](https://github.com/pmndrs/drei)

Typed node/material access is therefore **not** a unique Blendlink feature. The opportunity is typed *meaning* — sockets, colliders, hotspots, curves, state names, light groups, custom properties — plus drift checks when the Blender source changes. Even here, care is required: the glTF specification does not promise unique names, and gltfjsx has reports involving duplicate-name breakage and larger-pipeline ergonomics. [glTF name contract](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#reference-name) [gltfjsx issue #28](https://github.com/pmndrs/gltfjsx/issues/28) [gltfjsx issue #134](https://github.com/pmndrs/gltfjsx/issues/134)

### Optimization and validation

glTF Transform already offers reproducible low-level editing, inspection, compression, resizing, pruning, joining, and optimization from JavaScript or a CLI. Its documentation positions it as a post-authoring tool, not a modeling tool. [glTF Transform](https://github.com/donmccurdy/glTF-Transform)

The Khronos glTF Validator already checks schema, references, buffers, accessors, animations, images, and supported extensions, with machine-readable reports and non-zero exit codes. [glTF Validator](https://github.com/KhronosGroup/glTF-Validator)

Consequently, “optimization” and “valid glTF” are commodity building blocks. Blendlink should compose them and add validation that those tools cannot know: source drift, semantic naming, duplicate roles, dynamic-versus-baked eligibility, atlas capacity, topology staleness, and runtime manifest compatibility.

## Direct competitors and substitutes

### Needle Engine: the closest competitor

Needle is the most important comparison because it challenges the broad Blendlink thesis directly. Its Blender integration can:

- generate a web project, install dependencies, and start a local server;
- re-export and refresh the browser when the `.blend` is saved;
- author interactive components on Blender objects;
- optimize and publish assets or full applications;
- self-host production builds;
- bake Cycles lightmaps with preview/final settings, per-object lightmap scale, automatic UV generation, and runtime switching between multiple lightmap scenarios. [Blender workflow](https://engine.needle.tools/docs/blender/) [components](https://engine.needle.tools/docs/blender/components) [lightmapping](https://engine.needle.tools/docs/blender/lightmapping) [manual deployment](https://engine.needle.tools/docs/how-to-guides/deployment/embedding.html)

Needle's lightmapping is currently labeled experimental and recommends backups and production testing. Its public lightmap documentation emphasizes automatic UV generation, and does not document a committed artist-editable multi-atlas layout, deterministic semantic type generation, or a full-bounce additive per-light-group contract. That is a statement about public documentation, not proof those capabilities cannot be implemented with Needle. [Needle lightmapping notice](https://engine.needle.tools/docs/blender/lightmapping#experimental-feature-notice)

Needle is self-hostable and built on Three.js, so it should not be dismissed as “cloud lock-in.” However, full Needle applications use the Needle runtime and commercial use requires a license; uploaded standard glTF assets may also be used from Three.js or React Three Fiber. [Needle API](https://engine.needle.tools/docs/api/) [licensing FAQ](https://engine.needle.tools/docs/reference/faq) [cloud asset interoperability](https://engine.needle.tools/docs/blender/upload-to-needle-cloud)

Implication: Blendlink wins only when a team specifically values **plain GLB plus user-owned TypeScript, an existing custom site architecture, CI/repository ownership, and deep baked-lighting control** more than Needle's broader integrated engine and component ecosystem.

### Verge3D

Verge3D provides a Blender exporter, browser preview, application scaffolding, visual “Puzzles” logic, an application manager, and publishing. Its official beginner workflow still describes explicitly exporting after source changes and refreshing the browser; it is an application platform built around the Verge3D runtime rather than a typed bridge into an arbitrary existing Three.js codebase. [Verge3D Blender guide](https://www.soft8soft.com/docs/manual/en/blender/Beginners-Guide.html) [project structure](https://www.soft8soft.com/docs/manual/en/introduction/Project-Structure.html)

Verge3D proves that artists want Blender-centered web tooling, but its no/low-code application-builder job is not the recommended Blendlink job. Verge3D is commercially licensed. [official store](https://www.soft8soft.com/store/)

### PlayCanvas

PlayCanvas recommends GLB upload from Blender and imports it into a separate browser editor, where it creates source and target assets. Re-uploading a file with the same name updates the existing asset; import settings can preserve material mappings and generate UVs at a configured texel density. [model import](https://developer.playcanvas.com/user-manual/assets/models/) [updating assets](https://developer.playcanvas.com/user-manual/editor/assets/importing/) [import settings](https://developer.playcanvas.com/user-manual/editor/interface/settings/asset-import/)

PlayCanvas has substantial lightmapping support. It can auto-generate UV1, determine resolution from surface area, bake HDR color/direction lightmaps, mix baked and dynamic lights, and self-host exported applications. It also documents that its runtime baker lacks global illumination and some features of specialized offline tools; external Blender lightmaps require manual upload and material assignment. [runtime lightmaps](https://developer.playcanvas.com/user-manual/graphics/lighting/runtime-lightmaps/) [external lightmaps](https://developer.playcanvas.com/user-manual/graphics/lighting/lightmapping/) [self-hosting](https://developer.playcanvas.com/user-manual/editor/publishing/web/self-hosting/)

This is a strong substitute for teams willing to move scene assembly and runtime ownership into PlayCanvas. It is not a direct answer for a developer-owned Three.js/R3F repository whose artistic source of truth must remain Blender.

### Babylon.js

Babylon's documentation recommends Blender's standard glTF exporter as one route into Babylon and also documents a Babylon-specific Blender exporter. It addresses a different runtime ecosystem. Its relevance is evidence that DCC-to-runtime workflow tooling is established, not that Blendlink should become engine-neutral immediately. [Babylon glTF export pipeline](https://doc.babylonjs.com/preparingArtForBabylon/dccToGltf/) [Babylon exporters](https://doc.babylonjs.com/features/featuresDeepDive/Exporters/)

### Blender baking and specialist UV tools

Blender already supports Cycles baking to an active image texture, bake margins for filtering/mip safety, multiple UV maps, manual refinement, and packing around pinned islands. Its manual explicitly recommends separate UVs for pre-baked lighting and notes that artists may scale important areas to receive more pixels. [Cycles baking](https://docs.blender.org/manual/en/latest/render/cycles/baking.html) [UV layout workflow](https://docs.blender.org/manual/en/latest/modeling/meshes/uv/workflows/layout.html) [Pack Islands](https://docs.blender.org/manual/en/latest/modeling/meshes/uv/editing.html#pack-islands)

Specialist tools such as UVPackmaster already offer sophisticated grouping, texel-density policies, pixel margins, locked groups, overlap checks, and custom target boxes. [UVPackmaster groups](https://uvpackmaster.com/doc3/blender/3.2.3/30-packing-modes/30-groups-to-tiles/) [packing features](https://uvpackmaster.com/doc4/blender/4.0.0/20-packing-functionalities/)

Blendlink should not try to win a general-purpose UV-packing arms race. Its value is applying enough of those concepts to a specific web-lighting contract, preserving hand-authored layouts, diagnosing quality loss, and letting specialist UV tools remain usable.

## Capability comparison

Legend: “yes” means the capability is directly documented; “partial” means it exists with a narrower scope; “not documented” is not proof of impossibility.

| Product | End-to-end Blender → browser | Typed scene access | Save/watch sync | Pipeline validation | Baked-light authoring | Multiple states / additive lights | Runtime and deployment ownership |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Blender glTF + Three.js | Partial: manual export/load | No generated types | No | glTF validity only | Manual Blender work; no core glTF lightmap slot | Not provided as a workflow | Full ownership; standard glTF |
| drei + gltfjsx + glTF Transform | Partial: begins after GLB exists | Yes, nodes/materials and JSX | No Blender watch | glTF inspect/validate/transform; no source semantics | No | No | Own app; R3F/React expected for generated JSX |
| Needle Engine | Yes | Component TypeScript; typed scene-name contract not documented | Yes | Integrated build/optimization; semantic contract not documented | Yes, experimental, automatic | Multiple scenarios documented; bounced additive layers not documented | Self-hostable, but full apps use licensed Needle runtime |
| Verge3D | Yes, with explicit export/refresh loop | Not documented | Partial | Platform build checks | General Blender/export workflow; comparable atlas contract not documented | Not documented | Self-hostable application using Verge3D runtime/license |
| PlayCanvas | Yes through upload and separate web editor | Engine/editor APIs, not Blender-generated scene literals | Re-upload updates assets | Import pipeline | Yes; runtime baker lacks offline GI | Baked/dynamic mixing; alternate baked states not documented | Self-hostable PlayCanvas application |
| Blendlink today | Yes through CLI/add-on | Yes, including semantic vocabulary | Yes, source watch | Source drift + vocabulary + manifest checks | Yes: per-atlas Cycles indirect lightmaps preserve PBR/detail UVs; explicit Combined appearance fallback | Yes: full states on either output; normalized additive light-group layers on Appearance atlases | Standard GLB + manifest + user-owned Three.js helper; no required runtime |

Sources for Blendlink's present behavior are the repository [README](../README.md), [manifest contract](MANIFEST.md), and [baked composition recipe](../packages/blendlink/src/bakedRecipe.ts).

## Evidence of user pain

The strongest first-party reports form three clusters.

### Repetition and settings ownership

- An open Blender glTF exporter request says individually selecting and exporting objects or groups with different settings becomes inefficient in big scenes and rapid tweak cycles, and proposes storing overrides on objects or collections. [Khronos issue #1038](https://github.com/KhronosGroup/glTF-Blender-IO/issues/1038)
- A studio workflow report describes repeated texture regeneration as slow, overwrite-prone, and noisy in version control. [Khronos issue #1407](https://github.com/KhronosGroup/glTF-Blender-IO/issues/1407)
- Other requests cover persistent presets and batch export for 5–20 variants. [issue #161](https://github.com/KhronosGroup/glTF-Blender-IO/issues/161) [issue #1900](https://github.com/KhronosGroup/glTF-Blender-IO/issues/1900)

Verified conclusion: a durable scene recipe and repeatable incremental export address reported workflow pain. Inference: these reports do not prove that all settings should live in the `.blend`; filesystem and deployment settings still naturally belong to the website project.

### Scene access and contract fragility

- A Three.js request describes changing loaded meshes and materials through deep traversal as messy and asks for node/material lookup maps. [Three.js issue #18530](https://github.com/mrdoob/three.js/issues/18530)
- gltfjsx's own README frames traversal, mutation, reuse, and restructuring as deficiencies in the raw workflow. [gltfjsx](https://github.com/pmndrs/gltfjsx)
- The glTF spec explicitly permits duplicate user-defined names, and gltfjsx has had duplicate-name failures. [glTF names](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#reference-name) [gltfjsx issue #28](https://github.com/pmndrs/gltfjsx/issues/28)

Verified conclusion: generated accessors and validation solve real integration problems. Product correction: Blendlink should distinguish stable semantic identity from display name. Name-derived roles may remain ergonomic, but durable IDs are needed anywhere a rename must not break application meaning.

### Atlas capacity and editability

- A Lightmapper user reports that mapping a whole world into one lightmap makes the UV surface too small, asks for multiple resolution-aware lightmaps, and cannot understand why promising atlas controls have no effect. [The Lightmapper issue #132](https://github.com/Naxela/The_Lightmapper/issues/132)
- Another user can make automatic Smart Project UVs work but cannot use their own second UV maps in the atlas workflow. [The Lightmapper issue #77](https://github.com/Naxela/The_Lightmapper/issues/77)
- Blender's own manual explains that manual island scaling is how an artist gives an important area more pixels, and that pinned islands can be protected while others pack around them. [Blender UV workflow](https://docs.blender.org/manual/en/latest/modeling/meshes/uv/workflows/layout.html) [Pack Islands](https://docs.blender.org/manual/en/latest/modeling/meshes/uv/editing.html#pack-islands)

Verified conclusion: automatic atlas generation alone is insufficient for every production scene. The proposed Main Atlas plus explicit additional atlases, visible density/capacity, and committed editable layouts are well aligned with the evidence. Inference: the exact UI still requires usability testing.

## The exact job Blendlink should own

### Primary user and situation

The primary customer is not “any Blender artist.” It is a small team or artist/developer pair building a custom, design-led Three.js or R3F site: an architectural tour, product story, museum/gallery, portfolio, branded interactive, or similarly static-heavy experience. They want Blender to remain the visual source of truth, but the website must remain a normal codebase with its own framework, deployment, interactions, and review process.

### Job statement

> When an artist changes a Blender scene used by a custom Three.js website, help the team preview the web consequences, preserve intentional baked-light detail, and regenerate a stable typed package so that the developer can integrate the scene without traversal folklore, hand-maintained glue, or adopting another engine.

### The package Blendlink owns

Blendlink should own this boundary:

```text
.blend (art + semantic recipe)
  → checked export plan
  → standard GLB + baked textures + versioned manifest + generated TypeScript
  → arbitrary Three.js / R3F website and arbitrary static hosting
```

It should not own the website's component model, router, CMS, interaction framework, hosting account, or general UV workflow.

### Product pillars

1. **Artist-visible contract.** Artistic export intent lives in Blender and explains itself there. Website paths, URLs, and CI selection remain in `blendlink.config.mjs`.
2. **Predictable scene identity.** Names remain friendly labels and a fast vocabulary, but important exported roles receive stable namespaced IDs. Duplicates, sanitized-name collisions, missing targets, and breaking renames fail before runtime.
3. **Bake quality before bake cost.** A layout-only plan shows effective px/m, content area, padding cost, unused area, largest consumers, required resolution, texture count, and estimated bake count before Cycles starts.
4. **One Main Atlas, intentional exceptions.** Every eligible mesh belongs to undeletable Main by default. `+ Atlas from Selection` is the primary escape hatch. Collection/camera/material rules are advanced templates, not the core mental model.
5. **Automatic first, editable when needed.** Automatic layouts are disposable proposals. `Edit Atlas` materializes the exact complete layout into an artist-owned UV layer, protects it, and allows Blender or a specialist UV tool to edit it. Topology changes mark it stale; nothing silently repacks committed work.
6. **No silent quality collapse.** Default fit policy preserves density and blocks an over-capacity export with choices. “Scale everything down to fit” is an explicit opt-in, not invisible behavior.
7. **Portable baked lighting.** The default GLB remains viewable without Blendlink. Alternate states and additive light groups are described by a small versioned manifest and a user-owned Three.js reference implementation, not a required runtime package.
8. **Repository-grade repeatability.** Sync, watch, CI drift verification, schema enforcement, actionable diagnostics, and deterministic plans are first-class. General glTF optimization/validation should reuse established tools.

## Recommended artist workflow

1. **Set Up Blendlink Scene** creates a scene recipe, one Main Atlas, and Preview/Final quality profiles. The panel states what will export and what is excluded.
2. **Check Scene** runs fast semantic and topology checks without baking.
3. **Build Atlas Layout** computes the real export layout without Cycles. Main reports target and achieved density, occupancy, padding, unused area, lowest-detail objects, and total runtime texture cost.
4. If Main is over capacity, the tool offers concrete decisions: increase resolution, lower target density, reduce padding, or select hero objects and choose **+ Atlas**. It does not silently reduce every object's detail.
5. **Edit Atlas** opens the full resolved layout in Blender's UV workspace with a correctly scaled checker. The visible proposal becomes the committed layout; existing islands are protected and new/unlocked islands can pack around them.
6. **Preview Bake** uses the same membership and layout at lower samples/resolution. State and light-group differences are previewable in Blender.
7. **Bake & Sync** emits repository-owned artifacts and refreshes the local website. The result explains warnings and provides the stderr tail on failure.
8. Website compilation or `blendlink verify` rejects semantic drift, stale generated artifacts, unsupported schema versions, and committed draft output.

## Validated gap

The evidence validates a gap at the intersection of four capabilities:

- Blender-native ownership of web-scene semantics and bake intent;
- typed, validated handoff to an existing custom Three.js/R3F codebase;
- production-oriented, editable atlas and offline GI workflow;
- standard, repository-owned output without a required application runtime or hosting platform.

Each capability exists separately. Needle combines more of them than any other competitor, but couples full applications to its runtime/license and publicly documents an automatic, experimental lightmap workflow rather than Blendlink's proposed committed atlas contract. gltfjsx provides excellent typed React access but begins after GLB export and does not own Blender semantics or baking. PlayCanvas and Verge3D solve broader application-authoring jobs in their own runtimes/editors. This combination is therefore a plausible gap, not a proven business.

## Non-gaps and commoditized features

Blendlink should avoid positioning these as the product:

- GLB/glTF export;
- raw node/material TypeScript types;
- `useGLTF` convenience;
- Draco, Meshopt, WebP/KTX2, resize, deduplicate, prune, join, or generic optimization;
- structural glTF validation;
- browser preview or self-hosting by itself;
- hot reload by itself;
- general-purpose UV packing;
- no-code interaction authoring;
- generic “one click Blender to web.”

These are useful table stakes or integrations, but primary-source documentation shows established solutions for all of them.

## Strategic risks

1. **Needle is moving directly into the space.** Its 2026 Blender workflow already combines hot reload, optimization, interactivity, deployment, and experimental lightmapping. Blendlink needs comparative tests, not assumptions based on older market maps.
2. **The wedge may be too narrow.** Teams that need advanced baked-light control but refuse an integrated engine may be a small segment. Only interviews and observed projects can measure it.
3. **Baking can overwhelm the rest of the value.** Cycles time, denoising, memory, color transforms, topology invalidation, and Blender-version differences create a high support burden.
4. **Portable does not mean standard.** Alternate states and additive bounced light layers are not core glTF semantics. They remain portable only if the manifest and reference code are small, stable, documented, and user-owned.
5. **Names are not identities.** A name-only typed API promises more stability than glTF provides. Stable IDs and explicit migration diagnostics are required.
6. **Multiple atlases trade quality for runtime cost.** Every atlas can multiply texture downloads, material bindings, state maps, and light-group layers. The UI must show total cost before encouraging fragmentation.
7. **Scene-owned settings create asset governance work.** They improve portability and artist ownership, but dirty `.blend` files and can conflict with multiple website targets. Build profiles should vary quality only; filesystem integration remains project-owned.
8. **Scope creep toward an engine is fatal.** An unbounded component catalog, bundled physics/runtime ownership, visual scripting, hosting, collaboration, or CMS features would put Blendlink into direct competition with Needle, Verge3D, and PlayCanvas. Focused portable intent records are compatible with the source-contract advantage only while generated output remains readable, adapters stay replaceable, and multiplayer/application-framework behavior remains outside the product.

## Falsifiable validation plan

### Problem interviews

Interview 12–15 qualified participants, ideally six artist/developer pairs, who shipped or actively maintain a custom Three.js/R3F site with Blender-authored content. Do not demo first. Ask them to screen-share their last scene change from `.blend` to production and reconstruct:

- number of manual steps and tools;
- where settings and naming rules live;
- how breaking scene changes reach the developer;
- whether and why they use baked lighting;
- the last atlas/detail failure and how it was diagnosed;
- why they did or did not choose Needle, PlayCanvas, Verge3D, or gltfjsx;
- who owns deployment and whether runtime licensing matters;
- what they would pay to remove, or what they already paid to work around, the problem.

**Falsify the wedge** if fewer than 5 of 12 have both recurring source-to-code handoff pain and a reason not to use an integrated engine. Do not count hypothetical enthusiasm.

### Concierge pipeline test

Recruit three real scenes from different target categories: interior/architecture, product/brand, and gallery/portfolio. Have each team perform the same material/geometry/name/lighting change with its current workflow and with a hand-operated Blendlink prototype.

Measure:

- elapsed time from saved `.blend` to accepted browser result;
- manual operations and context switches;
- undetected breaking changes;
- full rebakes and failed rebakes;
- achieved minimum/median px/m at a fixed texture-byte budget;
- visible seam/halo/clipping defects;
- whether a second team member can explain and repair an over-capacity atlas without coaching.

**Pass threshold:** at least 40% less active handoff time in two of three projects, zero undetected semantic breaks, and equal-or-better minimum atlas density at the same texture budget. **Fail** if most benefit comes only from GLB watch/export, because Needle or a small script already solves that.

### Atlas usability test

Give five Blender artists a deliberately over-capacity scene. Without documentation, ask them to protect a hero object's detail, add one atlas, edit a layout, change topology, and recover.

**Pass threshold:** four of five complete the first three tasks without intervention; all five can explain why export is blocked; no participant expects committed UVs to move silently. If they reach immediately for UVPackmaster, treat that as an integration requirement rather than a failure.

### Competitive switch test

Build the same small interactive interior in Blendlink and current Needle. Include one day/night state, one tintable lamp with baked bounce, a hero-detail atlas, a renamed hotspot, and self-hosted deployment into an existing R3F app.

Measure setup time, iteration time, output size, runtime dependencies, code ownership, bake quality, and repair after a breaking rename/topology change. Publish the comparison internally even if Blendlink loses.

**Falsify differentiation** if Needle can deliver the required result with comparable code ownership and atlas control at lower total effort, or if participants prefer Needle's runtime tradeoff.

### Willingness-to-commit test

After a successful concierge project, ask for a costly signal: install the addon in the next active project, schedule a migration session, open a PR containing generated artifacts, or pay a small pilot fee.

**Pass threshold:** three teams commit to a next project and two complete the migration. Compliments, waitlist signups, and stars are not validation.

## Product decision

Proceed with the artist-first Main Atlas and embedded scene recipe, but change the positioning:

> **Blendlink is the production handoff from Blender to a custom Three.js codebase — typed, checked, beautifully baked, and owned by your repository.**

The next product milestone should prove the narrow loop before expanding breadth:

1. embedded Blender recipe with Main Atlas and `+ Atlas from Selection`;
2. layout-only capacity/density report;
3. one-step committed editable atlas workflow;
4. stable semantic IDs plus typed/drift-checked output;
5. Preview Bake and existing multi-state/additive-light contract;
6. comparative user test against Needle on real scenes.

If that loop does not beat current workflows on measured handoff time, atlas quality, and failure detection, Blendlink should retreat to a smaller developer CLI/typegen product rather than grow into another web engine.
