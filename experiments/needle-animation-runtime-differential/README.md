# Needle animation runtime differential (prototype)

Question: can the exact Needle Engine runtime selected by Blender add-on 1.4.2
load and play Blendlink's animation/deformation fixture closely enough to match
the same nine-time Blender dependency-graph oracle?

Run:

```powershell
node experiments/needle-animation-runtime-differential/run.mjs
```

This is a throwaway, runtime-only differential for capability `NDL-ANM-001`.
It reuses, byte for byte:

- `experiments/animation-deformation-browser/output/animation-deformation-fixture.glb`
- `experiments/animation-deformation-browser/output/blender-reference.json`

The runner rejects either file if its SHA-256 no longer matches the evidence
written by the Blendlink-side differential. It then loads the GLB through the
actual `<needle-engine src autoplay>` web component from
`@needle-tools/engine@5.1.4`. Because this neutral glTF has no
`NEEDLE_components` extension, the installed runtime's
`AnimationUtils.autoplayAnimations` fallback creates a Needle `Animation`
component. Controlled samples use that component's public `play`, `pause`, and
`time` APIs plus its lifecycle `update` method; no standalone fixture-created
`AnimationMixer` is used.

The neutral GLB has three independent clips (`RigMotion`, `MorphMotion`, and
`TransformMotion`). The metadata-free fallback starts one randomly chosen clip
in `Animation.onEnable`. The fixture records that default, stops it, and then
starts all three with the component's
`play(index, { exclusive: false, ... })` API. That distinction is part of the
result: default `autoplay` alone is not evidence that every independent glTF
clip runs concurrently.

The element is also pointed at the exact Engine-nested Three decoder
directories. Needle's installed progressive-loader bootstrap otherwise probes
remote decoders and falls back to page-relative `include/` URLs when offline;
those page-relative files are not part of this isolated fixture.

The comparison covers:

- one object translation and quaternion;
- one animated morph influence;
- one two-bone skinned mesh, compared as a bidirectional world-space point-set
  Hausdorff distance;
- five authored key times and four fractional subframes;
- a nonblank, chromatic Needle `Context` render;
- component/renderer disposal;
- the exact two-copy Three topology selected by the add-on's npm declarations.

## Primary installed sources

The runner hashes every source below into `output/evidence.json`:

- `experiments/needle-coherent-addon-1.4.2/node_modules/@needle-tools/engine/src/engine/webcomponents/needle-engine.ts`
  owns web-component loading, context creation, and disposal.
- `experiments/needle-coherent-addon-1.4.2/node_modules/@needle-tools/engine/src/engine/engine_loaders.ts`
  owns Needle's `loadSync` GLB path and built-in component construction.
- `experiments/needle-coherent-addon-1.4.2/node_modules/@needle-tools/engine/src/engine-components/AnimationUtilsAutoplay.ts`
  chooses authored Animation/Animator/PlayableDirector metadata when present,
  or calls `AnimationUtils.autoplayAnimations` when absent.
- `experiments/needle-coherent-addon-1.4.2/node_modules/@needle-tools/engine/src/engine/engine_animation.ts`
  creates the metadata-free `Animation` component and assigns glTF clips.
- `experiments/needle-coherent-addon-1.4.2/node_modules/@needle-tools/engine/src/engine-components/Animation.ts`
  owns playback, the mixer, action time, runtime updates, and mixer
  registration.
- `experiments/needle-coherent-addon-1.4.2/node_modules/@needle-tools/engine/src/engine/engine_context.ts`
  owns the render loop, `renderNow`, and teardown.

The coherent package fixture locks:

- `@needle-tools/engine@5.1.4`;
- project `three` alias `@needle-tools/three@0.169.21`;
- Engine-nested `three` alias `@needle-tools/three@0.169.19`.

Package identity comes from the locked manifest and its SHA-256. The unbundled
Engine source in this npm package intentionally defaults
`NEEDLE_ENGINE_VERSION` (and therefore the element's `version` attribute) to
the build placeholder `0.0.0`; the browser report preserves that advertised
value separately rather than misidentifying it as the npm package version.

The browser report records constructor identity separately for the loaded root,
skinned mesh, and component-owned mixer. It also measures the much narrower
duck-typed operation of passing a project-copy `Vector3` as the result target
to an Engine-copy `Object3D` method. That one successful operation is not
general proof that arbitrary Three objects can safely cross copies.

## Claim boundary

This fixture does **not** establish a coherent Needle Blender add-on → build
pipeline → runtime export. The shared GLB was produced by Blendlink's production
exporter. The result can close only the Needle runtime side of `NDL-ANM-001`;
it cannot be cited as Needle add-on or pipeline end-to-end evidence.

It also does not cover AnimatorController, PlayableDirector, generated scripts,
NLA strip blending, constraints, drivers, root motion, VAT, or
`KHR_animation_pointer`. Those require independent fixtures.

## Current result

Last pass: **2026-07-23**, using Node.js 24.15.0, Chrome
150.0.7871.129, Playwright 1.60.0, Vite 7.3.6,
`@needle-tools/engine@5.1.4`, project
`@needle-tools/three@0.169.21`, and Engine-nested
`@needle-tools/three@0.169.19`.

```text
NEEDLE_ANIMATION_RUNTIME_DIFFERENTIAL_PASSED position=6.729e-8 quaternion=7.765e-4rad morph=5.960e-8 skin=1.174e-5 threeIdentity=separate
```

Observed:

- `npm ls --all` passed for the coherent dependency fixture before browser
  execution.
- The GLB has no `NEEDLE_components` extension, so the auto-created component
  path is evidenced rather than inferred.
- Needle's default metadata-free autoplay created one action; the test then
  coordinated all three clips non-exclusively through the same `Animation`
  component.
- Loaded Object3D, SkinnedMesh, and component mixer are instances of Engine's
  nested Three copy and not the project copy. A project-copy `Vector3` worked
  as a result target with zero measured delta, which proves only that one
  structural operation.
- The final Needle render contained 24,913 non-background pixels, and disposal
  disconnected the element, cleared the context renderer and mixer registry,
  and left no running action.
- Offline external decoder-probe, font, and telemetry failures are retained in
  evidence and allowlisted by exact origin/error. Unexpected console, request,
  page, local HTTP, or runtime errors fail the command.

Artifacts:

- [`output/needle-animation-runtime-browser.png`](output/needle-animation-runtime-browser.png)
- [`output/needle-animation-runtime-canvas.png`](output/needle-animation-runtime-canvas.png)
- [`output/evidence.json`](output/evidence.json)
