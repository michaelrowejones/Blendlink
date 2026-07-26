# Needle Blender add-on UI and capability parity audit

Research date: 2026-07-19  
Inspected implementation: locally installed Needle Blender add-on 1.4.2  
Product target: Blendlink for solo artists and small custom Three.js teams

The maintained implementation-status table now lives in
[`FEATURE_PARITY.md`](FEATURE_PARITY.md). This document retains the design
analysis behind its scope and priorities.

## Decision

Use Needle's information architecture as competitive evidence, not as a screen
to clone. Its best pattern is a contextual split between **project actions** and
**selected-object settings**, with a dominant browser-preview action and deeper
controls progressively disclosed. Blendlink should adopt that skeleton while
keeping a much smaller promise: compile a Blender-authored scene into portable
Three.js assets.

Feature parity means that an artist can achieve the same relevant publishing
outcome—not that Blendlink exposes every Needle checkbox. WebXR, networking,
voice chat, cloud deployment, visual runtime components, and application menu
branding belong to Needle's engine/application scope and are deliberately not
Blendlink parity targets.

## What Needle's layout gets right

1. **Project and object contexts are separate.** The project panel owns project
   creation, local preview, export, builds, and project-wide settings; the
   object panel owns export inclusion, lightmapping, shadows, reflection probes,
   materials, textures, and components. Needle's component guide explicitly
   describes the object panel as the home for export, shadows, layers, material
   overrides, and texture compression. [Needle components in Blender](https://engine.needle.tools/docs/blender/components)
2. **The primary iteration loop is visually dominant.** Local preview gets a
   large `Export To Browser Preview` action, while production build/deployment
   is collapsed. Saving can automatically export and refresh the browser.
   [Needle Blender workflow](https://engine.needle.tools/docs/blender/)
3. **Simple defaults precede exceptions.** Progressive textures/meshes are
   project defaults, while individual textures can override maximum size and
   ETC1S/UASTC/WebP policy. [Progressive loading](https://engine.needle.tools/docs/how-to-guides/optimization/progressive-loading-and-lods.html)
   [Texture compression](https://engine.needle.tools/docs/how-to-guides/optimization/compress-textures.html)
4. **Lightmapping is described as an artist task.** Objects and lights are
   marked Lightmapped; objects receive a Lightmap Scale; the scene exposes
   Preview/High/Custom quality, resolution, denoising, a prominent bake action,
   and a raw-lightmap debug view. [Needle lightmapping](https://engine.needle.tools/docs/blender/lightmapping)
5. **Controls explain conflicts.** The installed add-on disables automatic
   project settings when an equivalent authored component already exists, and
   identifies the conflicting object in the tooltip. This is a strong general
   pattern: disable with a reason and a path to the source of truth.
6. **Visual assets are inspectable.** Texture rows show names, dimensions,
   thumbnails, and inline overrides; reflection probes show their resulting
   texture and dimensions. Needle documents environment compression and local
   reflection probes as part of the Blender workflow. [Environment lighting](https://engine.needle.tools/docs/blender/environment.html)

## Where Blendlink should improve the model

- Needle asks artists to enable a Lightmap Preview mode before baking and ties
  availability to viewport shading state. Blendlink should let artists plan and
  build from any normal object-mode viewport; inspection modes should be aids,
  not gates.
- Needle's automatic UV promise removes setup but does not expose target versus
  achieved density, committed atlas ownership, protected islands, or a capacity
  failure before baking. Blendlink should preserve its Main/additional atlas,
  proposal/materialize/pin, and Stop-and-Explain model.
- Needle's project surface mixes asset compilation with project generation,
  runtime components, networking, XR, deployment, licensing, and cloud status.
  Blendlink should keep integration settings outside the artistic hierarchy and
  never make cloud state part of scene correctness.
- A checkbox should only appear when its downstream consequence is implemented,
  exported, typed, and verified. A nonfunctional parity checkbox is worse than
  an explicit roadmap gap.
- Blendlink should show consequences in artist language: “Realtime objects cast
  a 2048px shadow until 30m” is better than a disconnected collection of bias,
  width, height, distance, and resolution fields.

## Live UI review and chosen synthesis (2026-07-20)

A live review of the installed Needle 1.4.2 add-on confirmed that its strongest
ideas are structural rather than ornamental. The large browser-preview action
makes the iteration loop obvious; project actions and selected-object settings
have distinct homes; familiar Blender rows, toggles, data-block pickers, and
collapsed advanced sections reduce the amount an artist must learn; and visual
asset rows expose useful identity and dimensions instead of presenting opaque
IDs. These remain the standard Blendlink must meet.

The same review also made Needle's limits clearer. Its project surface carries
project creation, local preview, production build, deployment, cloud and
license state, runtime components, framework concerns, and optimization in one
long hierarchy. Many individually reasonable controls compete for attention,
and the user's next action becomes less obvious once the happy path breaks.
Deep collapsed sections reduce initial noise but also hide ownership and setup
dependencies. Object settings scale toward Needle's broad engine/component
model rather than toward a truthful summary of a Blender selection. This is
appropriate for Needle's product, but it is not the best model for a focused,
portable Blender-to-Three.js compiler.

Blendlink's synthesis is therefore not a denser Needle clone:

1. **The viewport owns the publishing loop.** A compact state card reports
   not-configured, blocked, ready, building, preview-running, or failed state;
   presents one dominant next action; and keeps the latest result, cancel, log,
   and concise blockers in reach. Setup and publishing are one state machine,
   not duplicated panels.
2. **Native Properties contexts own persistent settings.** Scene owns the
   recipe, profiles, atlases, states, optimization, and checks; World owns
   environment/background output; Camera owns web composition; Object owns
   inclusion, render route, atlas budget, runtime rendering, and semantics;
   Material owns baking, texture semantics, compression, and exceptions. The
   viewport summarizes and routes to those owners without duplicating values.
3. **Layouts respond to available width.** Narrow panels become a legible
   single-column workflow with short labels and tooltip depth. Wider panels may
   use aligned label/control pairs and side-by-side secondary actions. No key
   command or state may be discoverable only because the sidebar happens to be
   wide.
4. **Selection summaries tell the truth.** Multi-selection shows selected,
   included, baked, realtime, automatic, and mixed counts. Mixed properties are
   labeled `Mixed`; edits report compatible, changed, and skipped subjects.
   Single-object details never masquerade as a batch summary.
5. **Diagnostics use compact list/detail disclosure.** The first view is a
   blocker/warning count and terse, actionable rows. Selecting a row reveals
   evidence, consequence, and remedies, with select/reveal/fix actions adjacent
   to the issue. Large scenes must not become walls of repeated explanatory
   text.
6. **Drawing is presentation-only.** Expensive scans, manifest reads, geometry
   analysis, thumbnail work, and atlas calculations feed a cached snapshot via
   timers or explicit operators. Blender may request `draw()` constantly; its
   cost must remain small and independent of project complexity.

This exceeds Needle where Blendlink's narrower scope permits it: less cloud and
engine clutter, a clearer next action in every workflow state, native and
unambiguous data ownership, reliable narrow-width behavior, honest batch
editing, and diagnostics that remain useful on large scenes. The capability
inventory below still describes what artists need; this section is the settled
presentation contract for exposing it.

## Expert-research synthesis: the capability compiler

The expert-source investigations change what “parity” should mean. Stylized
Blender work routinely mixes portable meshes and animation with evaluated
Geometry Nodes, authored control data, view-dependent shading, simulations, and
compositor effects. A larger export form cannot make all of those equivalent.

Blendlink should give every important object or effect one explicit route:

| Route | Artist meaning | Typical output |
| --- | --- | --- |
| Preserve | This already travels cleanly | glTF mesh, material, animation, camera, light, or GPU instances |
| Realize | Keep the procedural source editable; ship its evaluated result | compiled mesh plus source/evaluated cost report |
| Bake | Preserve appearance where live reconstruction is wasteful | editable named bake layer, texture, atlas, or mask |
| Runtime recipe | Preserve a supported interactive or view-dependent intent | small typed Three.js adapter recipe and controls |
| Cache or proxy | Preserve finite topology-changing motion within a stated budget | point, curve, or mesh cache / simplified proxy |
| Block | No route can honestly preserve the intent yet | evidence, affected object, and concrete remedies |

This route should be visible before export and should state its consequence in
artist language. The interface must not ask artists to understand Meshopt,
PMREM, tangent-space transforms, or cache encodings merely to choose the right
creative outcome.

The highest-value research-derived capabilities are therefore:

1. **Web Fidelity report** — a per-object/material/effect route with the reason,
   visual consequence, and estimated geometry/texture/runtime cost.
2. **Reference-frame comparison** — Blender reference cameras, poses, lighting
   states, and Preview/Final quality compared against the actual Three.js build.
3. **Geometry Nodes preflight** — instances, realization cost, named attributes,
   animated inputs, simulation zones, and camera dependencies without mutating
   the artist's source objects.
4. **Appearance-loss diagnostics** — identify unsupported shader nodes,
   generated coordinates, compositor-only effects, volumes, and camera-locked
   tricks with relevant remedies.
5. **Website composition contract** — fixed/constrained/free camera, breakpoint
   crops, text safe zones, focus, and screen importance so atlases and LODs are
   budgeted for the image the visitor actually sees.

The supporting source reports are
[`research-version-of-reality.md`](research-version-of-reality.md) and
[`research-expert-blender-sources.md`](research-expert-blender-sources.md).

## Capability matrix

| Artist outcome | Needle surface | Blendlink status | Decision / acceptance criterion |
| --- | --- | --- | --- |
| Save-to-browser loop | Export On Save, local server, browser export | Preview Website now opens a connected site's reported URL or provisions an identity-verified private Preview Studio; Watch Saves, progress, cancel, and separate logs remain available | Keep the one dominant action and explicit server ownership |
| Preview versus final | browser export; development/production build; lightmap Preview/High | Preview/Final scene profiles and builds | Keep; make actions always visible after setup |
| Static/realtime split | per-object Lightmapped | Automatic/Realtime/Baked | Blendlink exceeds: automatic safety plus explicit override |
| Per-object lightmap budget | Lightmap Scale | texel weight and measured density | Blendlink exceeds when target/achieved consequence is shown beside the control |
| Atlas construction | automatic single lightmap | Main/additional atlases, preview/materialize/pin | Blendlink differentiator; do not regress to an anonymous resolution field |
| Bake diagnostics | raw-lightmap debug, UV tile preview | density checker, UV grid, per-object plan | Add final-image thumbnail and atlas/object pixel readout |
| Multiple lighting scenarios | documented scenarios | named full states plus additive bounced Light Groups | Blendlink exceeds; improve state authoring beyond comma-separated collection names |
| Texture compression | project defaults; per-texture max size/format/quality | not yet implemented end to end | P0: KTX2 pipeline with Auto/ETC1S/UASTC/None, semantic slot defaults, before/after bytes, visual regression checks |
| Production-parity preview | Auto Compress | preview/final bake profiles, no post-export compression parity yet | P0: Preview Optimized Output; cache each transform and report duration/size |
| Mesh compression | production Draco/Meshopt | Meshopt decoder only; no encoder stage | P0: deterministic Meshopt transform with geometry/animation regression tests |
| Progressive loading | texture/mesh LOD generation | absent | P2: only if a thin standard-Three adapter can consume it without an engine runtime |
| Export inclusion | Ignore for export | direct Include in Web Scene toggle authors `blendlink_role=noimp`; legacy name vocabulary remains readable | Keep; excluded objects must not display irrelevant atlas or shading controls |
| Realtime shadows | receive/cast, map size, distance, bias presets | absent | P1: portable extras + Three adapter; presets first, expert bias fields collapsed |
| Reflection probes | bake/custom HDRI, samples/resolution, preview | absent | P1: named probes, influence/anchor, PMREM output, nearest/explicit assignment, preview thumbnail |
| HDR environment | viewport HDRI export, FastHDR, ground projection | glTF environment handling not productized | P1: explicit environment asset, lighting/background separation, compressed output, portable adapter |
| Material instancing | per-material Instancing | linked meshes may share data; no explicit contract | P1: diagnose reusable geometry/material groups and emit stable instance metadata |
| Animation | NLA auto-play and runtime components | clips and timeline markers exported/typed | P1: scene-owned autoplay/loop policy as optional integration metadata, not an owned state machine |
| Camera controls | Orbit Controls and Auto Fit | camera exported; app owns controls | Thin-adapter convenience only; never inject controls invisibly |
| Physics | optional Rapier runtime | collider/rigid vocabulary and typed contract | Keep semantic export; runtime engine remains application choice |
| XR/networking/voice/full component catalog | project toggles and 100+ runtime components | XR/networking/voice remain out of scope; a focused ten-type portable Components library now covers recurring effects, interaction, animation, visibility, and audio jobs | Keep the versioned adapter contract extensible, but do not pursue catalog-count parity or absorb Needle's application framework |
| Cloud/deployment | Needle Cloud and production deployment | portable files, hosting-agnostic | Deliberate non-parity and product advantage |

## Proposed Blendlink panel hierarchy

### Blendlink — project workspace

1. **Project status card** — saved/compiled/preview-quality/error, source and
   output consequence, open log.
2. **Preview & Build** — Preview Build (primary), Build Final, Check Final
   Layout, Watch Saves/cancel. Later: Open Browser and Open Project Folder.
3. **Web Presentation** — Hybrid/Realtime/Fully Baked with one-sentence result.
4. **Lightmaps & Atlases** — Main/additional atlas list, target/achieved
   density, padding, capacity, Preview/Final quality, states, checker and UV
   editing actions.
5. **Optimization** — only after implemented: optimized-preview toggle,
   aggregate mesh/texture size budget, defaults with exception counts.
6. **Checks** — errors first, grouped by “blocks build” and “worth reviewing.”
7. **Advanced Integration** — collection/exporter escape hatches remain project
   config and should generally not be duplicated in Blender.

### Blendlink Object — selected-object workspace

1. Object identity and Include in Web Scene.
2. Automatic/Realtime/Baked with the reason Automatic chose its result.
3. Atlas membership, target/achieved px/m, budget scale, select/inspect atlas.
4. Realtime rendering only when relevant: cast/receive shadows, probe, render
   cost estimate.
5. Materials/textures: thumbnails, dimensions, semantic role, compressed size,
   and exception overrides.
6. Semantic designation: collider, socket, hotspot, audio, LOD, rigid body.

## Implementation order

1. Finish the project/object hierarchy around the now always-visible build,
   Watch Saves, and export-inclusion actions.
2. Add the Web Fidelity report and establish Preserve/Realize/Bake/Runtime
   Recipe/Cache/Block as the shared compiler and UI vocabulary.
3. Add reference-frame comparison and Geometry Nodes/appearance preflight.
4. Implement optimization as a deep compiler stage before adding compression
   controls: deterministic Meshopt, then KTX2 semantic defaults and overrides.
5. Add shadow semantics through extras and thin adapters.
6. Add environment and reflection-probe publishing.
7. Evaluate progressive delivery only after ordinary portable builds are
   excellent; do not require a Blendlink engine runtime to claim parity.

## Research intake guardrail

Continue mining expert artists, but only promote a technique into Blendlink when
it has a recurring artist job, a plausible portable route, and a reference scene
that can become a Blender-to-Three.js regression test. This keeps the research
program from turning the add-on into a collection of fascinating but unrelated
checkboxes.
