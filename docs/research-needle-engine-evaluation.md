# Needle Engine adoption evaluation

Research date: 2026-07-19

> Decision update, 2026-07-19: the adoption recommendation below was tested
> and rejected after additional hands-on use. The experiment remains valuable
> competitive evidence, but ADR 0004 now makes Blendlink the primary product.
> Needle's broad engine/cloud surface proved less valuable to the target solo
> developer and small-team workflow than direct Three.js ownership, editable
> atlas control, portable output, and a smaller conceptual model.

## Original recommendation (superseded)

Adopt Needle Engine as the publishing layer for the next production prototype and freeze new Blendlink product development. A hands-on spike now confirms the core artist loop, animation export, generated scene bindings, supported React embedding, and a hybrid baked/dynamic scene. Continuing the broad Blendlink rewrite would duplicate a working maintained product.

Do not delete the Blendlink repository yet. Needle's closest-fit capabilities are recent or experimental, and its tradeoffs land exactly on Blendlink's proposed differentiators: direct React Three Fiber interoperability, committed editable atlas layouts, strict density/capacity control, runtime independence, and licensing. Preserve Blendlink as a reference/fallback until Needle has survived one representative production scene, then archive it if no demonstrated blocker emerges.

## Hands-on spike result

The reproducible trial lives in `experiments/needle-spike` and was run with Blender 5.2 LTS, Needle Blender add-on 1.4.2, and Needle Engine 5.1.7.

- Needle exported the existing Blendlink sample on the first attempt, including `CrateHop`, cameras, lights, environment, and authored empty nodes.
- The browser played the two-second Blender animation automatically.
- `Ground` was marked lightmapped while `Crate` and `Crate-colonly` remained dynamic. `Sun` and `WarmLamp` were opted into the bake separately.
- A 128x128 Preview bake completed, generated `NEEDLE_LightmapUV`, packed the lightmap into the copied `.blend`, and exported the `NEEDLE_lightmaps` extension.
- Needle's Vite plugin generated 13 typed scene bindings, including `Crate`, `SOCKET_Top`, `HOTSPOT_About`, the camera controls, lights, and runtime components.
- The supported React `<needle-engine>` integration built and rendered cleanly.
- The official React Three Fiber scaffold did not build unmodified: its Drei version imported a Three export absent from Needle's aliased Three version. It also retained a generated reference to `Cube.glb` after Blender replaced the asset with `scene.glb`. Direct R3F remains an unsuitable default today.
- The supported unoptimized build was 12.05 MB across 30 files. Rapier and MaterialX accounted for several megabytes; the Blender add-on currently writes `useRapier: true` into generated metadata even when the scene setting is false.
- The authenticated production build compiled the application, then failed its asset-compression stage with exit code 6 because no Needle Cloud login or `NEEDLE_CLOUD_TOKEN` was present. Production and CI setup therefore have a hard authentication dependency that still needs the owner's account.
- The production dependency audit reported two moderate issues through Needle's `uuid` dependency with no available fix. The generated dev stack reported substantially more audit noise.
- Export clears the configured `assets` directory. That directory must be treated as Blender-owned generated output.

The result is strong enough to adopt Needle's supported React path, but not strong enough to archive Blendlink before a larger scene tests atlas repair, final-quality baking, topology iteration, and license/CI operation.

## What Needle already solves

Needle's Blender integration can generate and install a web project, start a development server, export on `.blend` save, refresh the browser, export environment lighting, add interactive components in Blender, optimize builds, and deploy to Needle Cloud or self-hosted infrastructure. This is substantially more complete than Blendlink's present artist workflow. [Needle for Blender](https://engine.needle.tools/docs/blender/) [project structure](https://engine.needle.tools/docs/explanation/core-concepts/project-structure.html)

Needle is not confined to a hosted no-code editor. Its runtime is an npm package built on Three.js, its web component can be embedded in an existing React application, and it supports custom web projects. React integration is documented; direct React Three Fiber interoperability is explicitly experimental. [React integration](https://engine.needle.tools/docs/how-to-guides/web-integration/react) [framework support](https://engine.needle.tools/docs/html.html) [Three.js integration](https://engine.needle.tools/docs/three/)

Needle 5.1 added generated Scene Bindings: TypeScript access to scene nodes, objects, components, and properties that regenerates when glTF assets change. This removes raw typed node access as a credible Blendlink differentiator. The binding API is recent and parts remain experimental, so a rename/duplicate-name test is still required. [Needle 5.1 changelog](https://engine.needle.tools/docs/reference/changelogs/needle-engine)

Needle's Blender lightmapper already uses Cycles, allows individual objects and lights to be marked lightmapped, provides per-object Lightmap Scale, preview/final quality controls, supports mixing lightmaps with dynamic lights, and documents multiple lightmap scenarios. This directly covers the approved Hybrid model at a product level. [Needle lightmapping](https://engine.needle.tools/docs/blender/lightmapping)

## Material differences and risks

### Lightmap ownership

Needle's public documentation emphasizes automatic UV generation and describes the lightmapper as experimental. It does not document artist-committed atlas layouts, named Main/additional atlases, packing new objects around protected islands, or strict capacity/density diagnostics. This is a documented absence, not proof the implementation cannot support them. Blendlink should continue only if real artists demonstrate that these controls materially improve accepted output or repair time. [Needle lightmapping](https://engine.needle.tools/docs/blender/lightmapping)

Needle documents multiple complete lighting scenarios, but not Blendlink's normalized additive, tintable, full-bounce per-light-group layers. That capability is technically distinctive, but it matters only if target projects actually need interactive relighting rather than day/night swaps or dynamic overlay lights.

### Existing R3F applications

Embedding `<needle-engine>` in React is supported, but it owns a separate engine context and rendering surface. Direct R3F interoperability is experimental. A team that needs scene objects inside its existing R3F Canvas, reconciler, postprocessing, event, and state conventions may experience meaningful integration friction. This must be tested in the target repository rather than inferred from the React guide. [React integration](https://engine.needle.tools/docs/how-to-guides/web-integration/react)

### Runtime and portability

Needle exports glTF and allows standard assets to be used from Three.js or R3F, but Needle components and its `NEEDLE_lightmaps` extension require compatible loader/runtime behavior. Needle's FAQ says its engine handles that extension automatically. Thus standard geometry remains portable, while the richer authored behavior and lightmap workflow are coupled to Needle semantics. [Needle Cloud glTF interoperability](https://engine.needle.tools/docs/blender/upload-to-needle-cloud) [Needle FAQ](https://engine.needle.tools/docs/reference/faq)

### Commercial licensing

Commercial use requires a license. The current Pro price shown by Needle is €49 per user/month billed annually (€588 per seat/year), or €67 per user/month billed quarterly. CI builds require a Needle Cloud token/license server. White-label entitlement depends on an active qualifying license; the FAQ says branding returns if the license lapses. These are reasonable product costs, but they are genuine build and operational dependencies. [pricing](https://needle.tools/pricing/) [licensing and CI](https://engine.needle.tools/docs/reference/faq)

## Strongest case to adopt Needle

- It already delivers the artist-centered Blender-to-browser loop Blendlink is proposing.
- It includes a much broader maintained component, optimization, deployment, XR, physics, and interaction ecosystem.
- Hybrid lightmapping, per-object scale, previews, and lighting scenarios already exist.
- React, Next.js, custom projects, self-hosting, and newly generated scene bindings eliminate several assumed gaps.
- A small team should not maintain a parallel exporter, Blender addon, bake pipeline, generated contract, and runtime recipe unless the difference is central to its work.

## Strongest case not to adopt

- Direct R3F use is experimental; the supported React path is primarily a Needle-owned web component.
- Lightmapping is experimental and publicly centered on automatic UVs rather than committed, inspectable atlas ownership.
- Commercial output and CI depend on an active license and Needle Cloud authentication.
- Rich lightmap/component semantics require Needle support instead of remaining a tiny user-owned Three.js contract.
- Additive bounced relighting and strict repository drift/semantic validation are not documented equivalents.

## Fair hands-on spike

Use one real custom R3F scene, not a toy model. Reproduce:

1. A static interior or gallery with at least one hero object and one transparent or animated object.
2. Hybrid classification: static objects lightmapped, hero/dynamic objects realtime.
3. A deliberately over-capacity lightmap case that requires preserving hero detail.
4. Day/night scenarios.
5. One renamed object referenced from TypeScript, verifying whether generated bindings create a useful compile failure.
6. Embedding inside the existing R3F application, including its controls, postprocessing, events, and state.
7. A local production build and CI build using self-hosted assets.
8. Inspection of output size, runtime bundle cost, editable UV behavior, licensing steps, and recovery after topology changes.

Time-box the spike to two working days. Do not reimplement missing features during the test.

## Decision thresholds

**Adopt Needle and archive Blendlink** if the artist can complete the scene without maintaining manual atlas workarounds, the existing app can integrate it without surrendering important R3F architecture, rename failures are caught acceptably, and the runtime/license cost is acceptable.

**Continue a narrow Blendlink** only if at least two of these are demonstrated blockers on a real project: committed atlas ownership materially improves quality or repair time; direct R3F ownership is essential and Needle interop is inadequate; the project requires portable additive bounced lighting; or license/runtime independence is a firm organizational requirement.

**Do not build a Blendlink companion for Needle** unless the spike identifies one small, stable missing contract Needle invites third parties to extend. Maintaining a second orchestration layer around a fast-moving engine would otherwise combine both maintenance burdens.

## Bottom line

Needle is not merely adjacent competition; it is a credible adoption candidate and currently the default choice to beat. Blendlink's broad rewrite should stop now. The next investment should be the two-day comparative spike, followed by an explicit adopt/archive or continue-narrow decision based on observed friction rather than attachment to existing code.
