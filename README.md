# Blendlink

> Make the scene in Blender. Ship it beautifully in Three.js.

Blendlink is a Blender-to-Three.js scene compiler for artists and small web
teams. It turns a `.blend` into portable GLB/textures, a validated manifest,
and typed bindings—without introducing an engine, cloud service, visual
scripting runtime, or proprietary scene format.

The `.blend` owns visual intent. The project config owns only integration
details such as file locations and public URLs. An artist can choose Hybrid,
Realtime, or Fully Baked presentation; mark individual objects Realtime or
Baked; design editable atlases; preview quickly; and see a quality problem
before committing to a final bake.

The generated one-call integration accepts Three's `WebGLRenderer` or an
initialized `WebGPURenderer`; environment, shadow, probe, KTX2, and lifecycle
behavior are renderer-family-aware. Compiled TSL material programs shipped in
a scene's material-programs sidecar apply automatically on the WebGPU family
only — on WebGL those materials keep their portable glTF form.

## The artist workflow

1. Install Blendlink and run `npx blendlink addon install`, then open the
   `.blend` and choose
   **Set Up Blendlink Scene**. This creates the scene-owned publishing recipe
   that **Website Readiness** evaluates; then follow that card until it is green.
2. Leave the scene on **Hybrid** for the usual case: baked environments with
   realtime characters, glass, animation, and deliberate exceptions.
3. Use the persistent **Automatic / Realtime / Baked** control on selected
   objects when Automatic is not right; the card shows the effective result
   and reason continuously.
4. Start with the undeletable **Main** atlas. Select important meshes and use
   **Add Atlas from Selection** only when they deserve an independent budget.
   New atlases use **Bake Lighting (Recommended)**: Blendlink keeps the
   material/detail UVs and PBR textures, creates a separate lightmap UV, and
   bakes only indirect diffuse GI. Choose **Bake Appearance** for a deliberately
   flattened, unlit capture of a procedural or highly stylized final look.
5. Run **Preview Website**. With no connected site, Blendlink creates or reuses
   a private, disposable Preview Studio for this saved `.blend`, compiles
   Preview quality, and opens it. If the scene is connected to a site, the same
   action keeps using that site's dev command and reported URL. The same action
   stays running as Live Preview: save the `.blend` and Blendlink recompiles the
   affected scene, after which the website refreshes. This is intentionally
   save-driven rather than unsaved depsgraph synchronization, so the browser
   always represents a real, reproducible `.blend` file. If an update fails,
   the last good preview stays open and Blender shows the failure and log.
   Preview may temporarily Scale to Fit an overfull atlas so iteration can
   continue; it reports the detail loss, while Publish Website still honors
   **Stop and Explain**.
6. Inspect density/UVs, and materialize the proposed atlas only if you want to
   edit or pin it.
7. When the scene is ready for a real site, run
   `npx blendlink connect . --blend <saved.blend>` from that website folder and
   complete its printed install and hookup actions. Connect safely attaches an
   existing Three/R3F site or creates a minimal Three/Vite starter when the
   folder is empty; it never edits application source. `setup` remains a
   compatibility alias.
8. Run **Publish Website** or `npx blendlink publish [scene]`. Blendlink compiles
   Final, verifies the exact artifacts, runs the site's own build, and verifies
   again. It blocks rather than silently lowering detail when an atlas cannot
   preserve **Target Detail**; remote deployment remains website-owned.

Preview and Final quality, atlas resolution, **Target Detail (px/m)**, padding,
fit policy, and lighting states all live in the `.blend`. `blendlink.config.mjs`
does not act as a second, invisible art-directing interface.

The atlas output choice is per atlas. Bake Lighting preserves base-color,
normal, roughness, metallic, and other glTF PBR detail while realtime direct
lights, reflections, and specular response remain live in Three.js. Its
state PNG stores normalized indirect lighting and the manifest carries the
linear decode scale. Bake Appearance retains the original all-in-one Combined
bake for looks that cannot or should not remain PBR. Existing recipes created
before this choice stay on Appearance; newly created Main/additional atlases
start on Lighting. Full lighting states work with either route. Additive Light
Groups currently require Appearance and are blocked before Cycles when mixed
with a Lighting atlas, so the limitation cannot surface only after integration.
Because Bake Lighting stores indirect GI rather than the complete look, its
portable light sources matter: exported Blender Light objects and the published
HDR environment can continue lighting Three.js, while an emissive mesh cannot
light its neighbors at runtime. The bake plan names connected emissive
contributors and an unpublished non-black World before baking, with the choice
to add an equivalent Light, publish the HDR, or use Bake Appearance.

**Baked Textures & UVs** shows the files that actually ship: thumbnails for every
lighting state, additive Light Group, and HDR environment; exact saved-pixel
preview on the matching atlas meshes; **Select Last-Build Members** for the
published atlas membership; and each object's approximate allocated texels.
Use **Select Assigned Meshes** in **Texture Atlases** when you instead need the
live authoring assignment for the next build. Final builds fingerprint complete
state/light-group × atlas jobs, so camera/UI-only edits can reuse exact prior
PNGs while material, geometry, lighting, packing, quality, or compiler changes
rebuild safely. The panel names every reused/rebuilt job and never attempts an
unsafe selected-object patch bake that would lose cross-object bounce or
shadows.

The Blender Optimization panel can opt a scene into Meshopt. Blendlink uses the
same stage for Preview and Final, decodes the result before publishing, checks
world bounds and rendered vertex counts, and reports bytes saved (including a
warning when a tiny file grows instead). The loader adapter configures the
official decoder automatically.

In Material Properties, **Blendlink Web Material** reports the active material
as **Exact glTF**, **Approximated**, or **Needs Bake** before showing image
previews, source dimensions, color space, and the last published result.
Supported Principled BSDF inputs and Blender's supported KHR material
extensions publish through Blender's stock glTF exporter; Live Preview
republishes those changes on the next save. Exact means the authored material
parameters have a known glTF representation, not that Blender and Three.js
lighting will be pixel-identical.
Meshes with no Blender material receive Blender's neutral default PBR surface
after glTF export instead of glTF's unrelated implicit white metallic material.
This source-safe normalization touches only unbound GLB primitives; it neither
creates a material in the `.blend` nor changes any authored material binding.
Procedural textures, shader mixing, bump-only detail, and other unsupported
active graph branches are named rather than silently advertised as portable.
When the panel says **Needs Bake**, the remedies are: mark the material for a
**TSL Program** (measured node graphs translate to TSL IR and ship in the
scene's material-programs sidecar, applied at runtime on the WebGPU renderer
family), mark it for a per-channel **Material Bake** (baked
baseColor/ORM/normal/emissive carriers, with unique-route bakes packing onto
shared surface-atlas pages), use an Appearance bake, simplify the active
shader branch, or deliberately own a custom runtime material. A per-image
Published Max resizes PNG/JPEG/WebP sources without changing aspect ratio;
Preview and Final share the same transform and the manifest records
before/after dimensions and bytes.

**GPU Textures: KTX2 Auto** is semantic rather than a wall of encoder flags:
opaque color uses Compact ETC1S, while normals, packed material data, alpha,
and artist-selected detail use High Fidelity UASTC. Spec-conforming inputs whose
width and height are both multiples of four retain their exact dimensions, are
validated against `KHR_texture_basisu`, and are decoded back to pixels before
publishing. A nonconforming candidate warns loudly and remains in its original
uncompressed format; KTX2 compression never resizes it. Individual images can
use Scene Default, Uncompressed, Compact, or High Fidelity. Baked lighting
atlases remain PNG to preserve Blendlink's constant-background mip-tail contract.
Install the free [Khronos KTX-Software tools](https://github.com/KhronosGroup/KTX-Software/releases)
locally and run `npx blendlink doctor`; no cloud codec is involved.

**Geometry Conversion** explains how evaluated Blender features survive publishing.
Ordinary meshes are Preserve, fixed Geometry Nodes results are Realize/Bake,
and realtime-designated objects are Runtime. Finite-cache candidates are
measured and explained, but remain blocked until Blendlink has a proven portable
VAT or point-cache route; unsupported time/simulation behavior is surfaced in
Web Checks instead of silently freezing one frame. The publish audit measures
source-versus-evaluated topology, follows
nested camera/object/collection dependencies, and exhaustively samples bounded
time ranges. Changing topology, unvalidated finite caches, Simulation Zones,
and destructive camera-culling for movable website cameras stop the export with
the precise portable route that would be required.
Material, light, camera, and World property animation also stops with a remedy:
core Three.js does not bind `KHR_animation_pointer`, so Blendlink never labels
plugin-dependent animation as a portable clip or silently drops it.

**LOD + Instance Consequences** separate authoring intent from optimization
folklore. LOD chains report missing/non-increasing thresholds, divergent origins,
stable IDs, and the exact draw-call difference between rendering every level and
one active level. `startCompiledSceneLods()` switches visibility without
reparenting authored objects and includes hysteresis plus ownership cleanup.
Shared Blender mesh data is reported separately: it saves geometry bytes but not
draw calls. The generated diagnostics show technical GPU-batch eligibility,
current/potential draws, blockers, stable members, and any actual
`EXT_mesh_gpu_instancing` batches; automatic merging stays off while it would
erase per-object binding or culling behavior. Applications can opt in with
`applyCompiledSceneInstances()`: it creates native InstancedMesh batches, keeps
the stable source objects hidden but addressable, resolves raycaster
`instanceId` values back to stable IDs/objects, updates transforms on request,
and restores the original scene completely on `stop()`.

**Animation Playback** can leave the scene still or start the first, a named,
or every exported clip, with Loop, Hold Last Frame, or Ping-Pong behavior and
an artist-authored speed. The generated contract stays renderer-agnostic;
`startCompiledScenePlayback()` configures a supplied Three `AnimationMixer`
and returns transport state/commands plus `update(delta)` for the render loop.
`stop()` returns to an idle, replayable start pose; `dispose()` permanently
releases playback.
For authored editorial motion, an opt-in **Website NLA Sequence** reads one
real Blender NLA track instead of inventing a second timeline editor. It
preserves ordered Action strips, trim, scale/speed, fractional repeat, reverse,
Replace/Add, blend envelopes, weight, easing, extrapolation, mute, loop, and
duration. During export, reversible staging makes every sequence-referenced
Action discoverable to Blender's stock exporter without filtering other
scene-discoverable Actions. Blendlink rejects overlaps, stale tracks,
Transition/Meta strips, animated time/influence, or Blender-only blend modes.
`startAnimationSequence()` owns one
mixer and deterministic seeking; the one-call Three installer gives this
sequence precedence over simple autoplay when it is present.

**Website Look** makes ownership explicit. The page can keep its existing
renderer/background, or the artist can publish AgX, PBR Neutral, ACES, or no
tone mapping, photographic-stop exposure, and a transparent or solid scene
background. `applyCompiledSceneLook()` maps those choices onto Three while
refusing impossible transparent/color setups rather than failing visually.

**HDR Environment** publishes a selected Radiance HDR or OpenEXR source
byte-for-byte, including packed images, and lets the artist decide separately
whether it lights physical materials, appears behind the scene, or becomes a
grounded backdrop. Lighting and flat-background strength/rotation are independent;
grounded projection instead exposes capture height, radius, and rotation;
linked HDRs are content-hashed, so an in-place byte change invalidates sync
without forcing unchanged linked assets to rebuild forever. Website Look and the HDR panel hand off
background ownership explicitly instead of relying on adapter call order. With
KTX2 Auto, Blendlink also tries a 32-bit packed-float KTX2, decodes it back to
linear radiance, and publishes it only when energy and highlight gates pass;
the byte-exact source always remains the fallback.

**Realtime Shadows** leads with Off, Fast, Balanced, Soft Studio, and Crisp
Detail. Each preset resolves to a visible map resolution, reach, filter, bias,
and update budget; Custom exposes those exact controls. The optional adapter
enables the renderer and configures every exported shadow-capable light, while
per-object Cast/Receive intent remains independent. A Blender Light whose
native **Shadows** switch is off receives a portable namespaced opt-out after
glTF export, so the preview/global budget cannot turn it back on; an explicit
Blendlink value remains authoritative.

Realtime Point, Spot, and Sun lights use Blender's stock glTF exporter in
`COMPAT` mode, so Blender 5.2's default `SPEC` conversion cannot make them 683
times brighter in Three.js. Blendlink exports only the active Scene and honors
the active View Layer, object visibility, every complete nested-collection
path, and collection-instance sources; temporary export constraints are fully
restored. The
**Blendlink Web Light** panel in Light Data Properties reports **Exact Realtime
Light**, **Realtime · Web Approximation**, **Bake-only Light**, or **Not
Published**; shows authored energy/exposure and website intensity/Three.js
power when predictable and applicable; then explains the consequence and next
step. Area lights remain bake-only because glTF has no portable realtime
area-light type; emitter radius, Sun angle, contribution controls,
shadow/linking controls, Light Falloff ownership, and routed Cycles node groups
are named approximations rather than silently promised. Ordinary Point/Spot
node defaults and direct Sun Emission strength retain the stock exporter's
predictable behavior.

**Reflection Probes** start from selected meshes: Blendlink centers a named,
visible box/sphere influence helper, assigns those meshes explicitly, and
publishes capture detail, strength, and an optional stable anchor. Choose a
one-shot Three runtime capture, a lossless high-detail Blender/Cycles EXR bake,
or an exact custom 2:1 reflection texture. Bakes carry source/content hashes,
turn visibly stale when dependencies change, live in an owned editable derived
folder, and publish only after byte/dimension validation; **Bake All** replaces
none unless every probe succeeds. The standard Three installer automatically
decodes baked/custom equirectangular assets to owned PMREMs. The portable seam
also accepts a website-supplied PMREM, custom loader/capture callback, or the
included `createThreeWebGLReflectionCapture({ THREE, renderer, scene })`
CubeCamera→PMREM helper; it clones assigned materials safely, owns cleanup, and
reports capture cost without inventing hidden overlap or shared-material behavior.

## Quick start

```bash
npm install blendlink
npx blendlink addon install      # install + enable the Blender workspace
npx blendlink preview --blend assets/hero.blend  # private Live Preview Studio
npx blendlink connect . --blend assets/hero.blend # attach this site; scaffold if empty
npx blendlink compile --preview  # fast iteration profile
npx blendlink preview            # open + watch the connected website
npx blendlink publish            # Final + verify + site build + verify
npx blendlink plan --preview     # inspect the Preview atlas plan without Cycles
npx blendlink plan               # inspect the Final atlas plan without Cycles
npx blendlink verify             # Blender-free CI drift check
npx blendlink perf --tier mobile # static budget evidence; runtime remains measured
```

The CLI does not import a renderer, but the package includes its lazy WebGL
post-processing implementations. npm may therefore resolve their compatible
Three peer even in a CLI-only installation.

`connect` is intentionally safe in an established codebase. It recognizes a
declared `three` or `@react-three/fiber` renderer, creates the integration
config and configured generated-asset directories, declares Blendlink without
running a package manager, and adds only non-conflicting scripts. It also makes
the website explicitly own exact `three@0.184.0`, the current source-audited
runtime profile, plus a matching r184 `@types/three` patch; when an unusual
version range cannot be matched safely, connect prints
the exact dependency action instead of guessing. Ordinary
Three.js projects receive one user-owned `install<Scene>()` module per scene;
WebGL R3F projects receive tiny client-safe association components backed by
Blendlink's package-owned lifecycle adapter. Imports resolve from the actual
`genDir`. Connect never edits existing application source and
refuses to guess when the current directory is not a Three.js site. In an empty
directory it creates the smallest useful Three/Vite starter, including an
authored-camera-first loader; dependency installation is still an explicit
package-manager action. `blendlink init` remains available as the narrower
config-only command.

`blendlink publish [scene]` is the preview-to-production boundary. It always
compiles Final quality, verifies recipe/schema/input/companion integrity, runs
the website's existing package-manager `build` script, and re-verifies scene
artifacts after the build. A scene name scopes compilation and verification.
`--assets-only` explicitly stops after deployable assets for a custom pipeline;
Blendlink never infers permission to upload or deploy the website.

`blendlink compile` remains an alias for `compile`. `compile --watch` rebuilds on
Blender saves and changes to each scene's declared `inputs`. Editing
`blendlink.config.mjs` reloads validated config, updates the watched paths, and
rebuilds only affected scenes; an invalid edit is reported while the last
working watch graph stays active. Commit the generated GLB, textures, manifest,
and TypeScript. Static hosting needs neither Blender nor a Blendlink service or
CLI; websites using `blendlink/three` still keep the npm package as a normal
build dependency so their bundler can include the adapter.

A minimal config is intentionally boring:

```js
export default {
  outDir: 'public/models',
  genDir: 'src/generated',
  urlPrefix: '/models',
  scenes: [{ file: 'assets/hero.blend', name: 'hero' }],
}
```

`blendlink preview --blend <saved.blend>` is the zero-setup Preview Studio. It
maps the absolute `.blend` path to a private user-local cache, creates a minimal
Vite/Three/Blendlink viewer there, installs only that disposable viewer's
dependencies when missing or stale, compiles Preview quality, opens its
verified local URL, and keeps watching that saved scene. Each Blender save is
compiled through the same single-flight Preview path; successful output
refreshes the Vite page, while a failed export leaves the last good browser
scene in place and reports the error. Unsaved Blender edits are deliberately
not streamed. Repeating the command reuses the scene's cache and a running
server only when its identity marker matches. It never writes a project beside
the `.blend`; pass `--no-open` when another tool will open the URL, and stop the
long-running command when the Live Preview session is finished.

Preview Studio reserves **Ready** for a generation the browser has actually
installed, shader-compiled, rendered, and acknowledged for the current preview
session. A reachable dev server or a successfully written GLB is still
**Preparing**, **Compiling**, or **Validating**. Each new generation loads on a
candidate canvas; it replaces the visible scene only after that validation, and
stale candidates are discarded. A browser/runtime failure therefore cannot
turn a broken save into a false green state or replace the last good scene.

The Studio toolbar provides Pause, Reset view, background inspection,
fullscreen, and a Details drawer. Details includes Fit window, Desktop, and
Mobile viewport presets, build statistics, Web Checks, and controls for baked
states and Light Groups when the scene publishes them. These are private
authoring controls: they do not add UI or policy to the connected website.

Preview-quality atlas resolution follows the scene's Preview profile, but a
reduced atlas stays at least 256 px unless its authored Final atlas is smaller.
Blendlink scales the target detail and pixel margin by that atlas's actual
resolution ratio, so Final-size gutters cannot consume a low-resolution
preview or collapse its islands. This is a readability floor for iteration,
not a promise of Final detail. `blendlink plan <scene> --preview` resolves the
same settings without running Cycles; add `--json` for tooling or regression
checks. Plain `blendlink plan <scene>` continues to report the Final plan.

Preview Studio explicitly opts into Blender authoring evidence only where the
published recipe leaves look, World, or shadows application-owned. AgX,
Khronos PBR Neutral, Standard exposure, a safely constant World, and source
shadow presence therefore resemble the saved Blender scene without
becoming hidden production policy. A constant World lights PBR materials and
passes through tone mapping as the backdrop; **Film > Transparent** keeps that
backdrop transparent while retaining World lighting. Linked/procedural Worlds
and unsupported display settings produce visible warnings instead of guessed
translations. Explicit Website Look, HDR environment, shadow settings, and
per-object shadow intent always win, and connected-site installs do not opt in
automatically. Three.js's analytic AgX is not pixel-identical to Blender 5.x's
current OCIO transform, so the private preview carries a measured, explicit
`-0.28`-stop adapter correction and labels the result approximate; the artist's
authored exposure and every production recipe remain unchanged.

Inside a connected website, `blendlink preview` preserves the existing project
workflow: it discovers a `dev`/`start` script, package manager, and the URL
printed by Vite, Next, Astro, or another local server. It does not assume that
an unrelated process on a framework's conventional port is this project. The
command also remains alive and recompiles on saves, whether it starts the site
server or reuses an explicitly configured reachable URL.
Monorepos and unusual servers can declare the integration explicitly without
moving artistic controls out of Blender:

```js
website: {
  root: 'apps/site',
  devCommand: 'pnpm dev',
  url: 'http://localhost:5173',
}
```

Legacy `mode` and `bake` config settings remain readable for existing scenes,
but new artistic settings belong to the Blender Scene Publishing panels.

### Current dogfood: the portfolio workbench

The [MichaelRoweJonesSite](https://github.com/michaelrowejones/MichaelRoweJonesSite)
hero is the current integration dogfood. Its Blendlink lane starts from the
isolated, provenance-guarded
`assets/blender/dogfood/SiteDemo.blendlink-dogfood.blend`, publishes as the
separate `workbenchDogfood` scene, and renders only at `/blendlink-lab` while
the production source, assets, and homepage remain the control. This keeps old
Blendlink metadata or an experimental migration from silently changing the
shipping hero.

From a checkout of that site, the repeatable loop is:

```bash
npx blendlink plan workbenchDogfood --preview --json
npx blendlink preview --blend assets/blender/dogfood/SiteDemo.blendlink-dogfood.blend
# In another terminal when the scene is approved:
npx blendlink publish workbenchDogfood
npm run dev                       # inspect /blendlink-lab
npx playwright test e2e/blendlink-lab.spec.ts
```

The browser gate waits for the installed scene's ready state, proves the
dogfood GLB was requested, checks that the canvas contains visible pixels and
fills the viewport, and fails on unexpected page, console, asset, or
accessibility errors. The guarded migration recipe remains in
`scripts/blender/prepare_blendlink_dogfood.py` in the site repository so the
isolated file can be audited or rebuilt without normalizing the production
`.blend` in place.

The addon's **Website Ownership** panel names who owns every important handoff:
the `.blend`, website code, `blendlink.config.mjs`, or generated repository
output. Application-owned defaults stay untouched. `blendlink doctor` and the
addon also consume the same bounded Blender-version known-issue registry; it
accepts no entry without a primary evidence URL and concrete artist action.

## Use it from Three.js or React Three Fiber

The standard Three WebGL seam (exact r184) applies the complete authored recipe—baked composition,
look, fog, shadows, HDR environment, camera, playback, LODs, reflection probes,
and portable Components—and owns cleanup behind one call. Generated modules
still expose readable names and stable IDs for application behavior.

```ts
import { installThreeCompiledScene } from 'blendlink/three'
import { hero } from './generated/hero.gen'
import { createBakedScene } from './generated/hero.baked'

const installed = await installThreeCompiledScene({
  descriptor: hero,
  renderer,
  scene,
  createBakedScene,
  // Optional. The default 'authored' policy selects the highest advertised
  // atlas tier. Use 'adaptive' or a positive requested resolution when desired.
  bakedAtlasDeliveryQuality: 'authored',
  // Optional; otherwise the generated recipe chooses 64/128/256 MiB from
  // save-data and device-memory hints.
  bakedTextureCacheBytes: 96 * 1024 * 1024,
})

// In the website frame loop:
installed.update(deltaSeconds)
installed.render(deltaSeconds)

// Await artist-facing state changes so a failed texture keeps the current state:
await installed.setStateAsync('night')
installed.setLightGroup('lamp', { strength: 0.8, color: '#ffd6a0' })

// On route/scene teardown:
installed.dispose()
```

Generated baked recipes keep inactive loader-owned state textures in a
device-aware 64/128/256 MiB LRU. Large installations can override it with
`bakedTextureCacheBytes` on the one-call installer, or with
`createBakedScene(root, { textureCacheBytes })` when using the recipe directly.
Active, loading, promoted-default, and application-adopted textures remain
pinned even when one of them is larger than the budget.

Atlas delivery quality is independent from that cache budget. It defaults to
`'authored'`, which selects the highest advertised tier. Opt into the previous
viewport/device heuristic with `bakedAtlasDeliveryQuality: 'adaptive'`, or pass
a positive resolution to select the smallest tier at or above that request.
Direct recipe callers use `atlasDeliveryQuality`.
R3F scene components accept `bakedAtlasDeliveryQuality` per mount, so a
developer lab can opt into adaptive delivery without lowering the same scene's
public hero.

For measured browser evidence, wrap the one render that would normally happen
in the frame loop; do not render once for Blendlink and again for measurement:

```ts
import {
  createRuntimePerformanceMonitor,
  collectThreeTextureEvidence,
} from 'blendlink/three'

const performanceMonitor = createRuntimePerformanceMonitor()
performanceMonitor.start()

function renderMeasuredFrame(requestAnimationFrameTimestamp: number, deltaSeconds: number) {
  installed.update(deltaSeconds)
  // requestAnimationFrameTimestamp and performance.now() use the same clock.
  performanceMonitor.sample(
    renderer,
    () => installed.render(deltaSeconds),
    requestAnimationFrameTimestamp,
  )
}

const report = await performanceMonitor.finish(renderer)
// Run after the desired state has loaded. Shared Texture objects are deduped;
// unsupported dimensions or internal formats remain explicit unknowns.
const textureEvidence = collectThreeTextureEvidence(installed.root)
```

The report separates observed transfer/decoded bytes, frame percentiles, long
tasks, renderer counters, and non-blocking WebGL2 GPU timer evidence. Missing
browser capabilities stay visibly unavailable; static scene counts are never
reported as measured frame rate. Use `npx blendlink perf --tier mobile` for the
separate compiled-artifact/build-budget report. It verifies manifest/GLB
identity, decodes required Meshopt streams, separates all decoded accessors,
the geometry-only subset, and embedded images, and ranks triangle and decoded-
geometry contributors independently. A source-material advisory reports the
used-material and rendered-triangle coverage that still needs baking without
turning every approximation into a build failure. `--fail` rejects a budget
overrun or complete all-default material-payload collapse.

A site that intentionally replaces every collapsed GLB material may acknowledge
that otherwise-fatal condition per scene. This is not a generic ignore switch:
it requires a named application-owned adapter, remains a loud verification
warning, and shifts proof to the application's production browser gate.

```js
scenes: [{
  name: 'hero',
  file: 'assets/hero.blend',
  applicationMaterialAdapter: {
    acknowledgePayloadCollapse: true,
    description: 'HeroMaterialAdapter maps every generated material ID',
  },
}]
```

`textureEvidence` reports the live Three transcode target family (including
ASTC, BC7/BC6H, ETC2/EAC, S3TC, and uncompressed formats), material/environment
roles, explicit or generated mips, and block-aware standard format payload.
It deliberately excludes opaque driver allocation overhead and never replaces
missing evidence with a guess.

## Portable Components

Components let an artist add focused website behavior without turning the
`.blend` into a proprietary application project. The initial library covers
Bright/Selective Bloom, Vignette, Chromatic Aberration, DPR-stable Pixelation,
bounded Contrast-Adaptive Sharpen, Tilt Shift, N8AO Ambient Occlusion, Outline,
3D LUT Color Grade, object- or distance-focused Depth of Field, a preview
anisotropic Kuwahara treatment, Keep Visible Through Objects, Open Link on
Click, Emphasize on Hover, Website Surface, Start Hidden, Look At Object, Play
Animation on Click, Audio Source, and Play Audio on Click. Scene effects live
with the Scene; object behaviors target
rename-stable object IDs and remain intact when an artist renames an object.
The Blender browser is categorized, opens ready to type, searches artist task
language across names, categories, descriptions, consequences, compatibility,
and keywords, then shows cost, docs, and target readiness with every result.
Component cards stay editable when disabled. Copy/paste actions use
safe versioned JSON, preserve unknown extension fields, and report every
changed, already-matching, skipped, or failed selected target; malformed types
and unresolved references are rejected without mutation. The same component
validator feeds cards, Web Checks, and publish preflight. Spatial Audio's
**Full Volume Within** / **Silent Beyond** promise is literal: the Three adapter
uses Web Audio linear falloff with full rolloff, reaching zero at the outer
radius instead of merely stopping inverse attenuation there.

**Website Surface** is the narrow handoff for a Blender-authored monitor,
display, or sign whose pixels come from application code. In Blender, keep the
receiver as a separate one-material Mesh with ordinary 0..1 UV0, then add
Website Surface from **Web Behaviors** and give it a unique lowercase Website
Name such as `monitor-screen`. Adding it marks the Mesh Realtime and removes
its atlas override. **Display** presents UI-like pixels unlit and without
material tone mapping; **Surface** retains the cloned authored material
response. V1 refuses multi-material/baked receivers. Add-on checks, background
compile, and runtime independently require finite UV0 bounded to 0..1 within
`1e-5` and reaching every square edge within `1e-4`.

The website binds its own canvas and notifies Blendlink only after drawing:

```ts
const binding = installed.websiteSurfaces.bindCanvas('monitor-screen', appCanvas)
paintMonitor(appCanvas, applicationState)
binding.changed() // uploads on the next render and requests one demand frame

// Route or scene teardown; appCanvas remains application-owned.
binding.dispose()
```

The sRGB live canvas uses Clamp-to-Edge wrapping, Linear min/mag filters,
anisotropy `1`, and no generated mipmaps. It deliberately uses identity
transform/full UV0 rather than inheriting fallback `KHR_texture_transform`.
For Display, the authored fallback texture object and tint remain intact while
unbound; Blendlink neutralizes tint only while application pixels are bound
and conditionally restores the exact fallback on disposal.

The generated R3F `use<Scene>Scene()` handle exposes the same typed
`websiteSurfaces` interface. Blendlink owns semantic lookup, material
isolation, invalidation, conditional restoration, and Three wrapper disposal;
the website owns pixels, input, Canvas, DOM, route, accessibility, and
analytics. This is deliberately separate from baked `setState()`, which
continues to switch content-addressed Blender Lighting/Appearance states.

**Web Guides** make those choices spatial in Blender: the cached viewport
overlay shows selected component radii, active reflection-probe influence, and
Point/Spot/Sun shadow consequences while following live object transforms.

Each component is a versioned, namespaced JSON record in the scene recipe,
manifest, and generated descriptor. The included Three adapter owns the real
composer, pointer listeners, animation mixers, audio nodes, resize work, and
cleanup. Its lazy pmndrs pipeline fuses compatible effects, separates multiple
convolution stages, keeps supported authored tone mapping exactly once after
HDR effects, adapts implementation quality independently from art direction,
and restores renderer/selection ownership. That is why the frame loop calls
`installed.render()` above: it uses the post-processing chain only when an
authored component needs one and falls back to the normal renderer otherwise.

The registry is intentionally extensible. A site can preserve a custom record
such as `studio.ripple` and install its implementation explicitly:

```ts
const installed = await installThreeCompiledScene({
  descriptor: hero,
  renderer,
  scene,
  createBakedScene,
  componentAdapters: {
    'studio.ripple': ({ component, object }) => installRipple(object, component.values),
  },
})
```

An enabled record with no adapter fails loudly instead of silently losing the
artist's intent. Rigidbody and Collider continue using Blendlink's canonical
object fields and generated metadata—the Components UI links to those controls
rather than publishing a second, conflicting physics record. The website still
chooses Rapier or another physics runtime. Multiplayer/network components are
deliberately excluded.

The generated `.baked.ts` file is emitted once for every scene-owned recipe,
including Realtime scenes where it is a harmless no-op. It is ordinary,
user-owned Three.js code and is never overwritten. The one-call installer
awaits its `ready` promise before attaching the scene, so the default GI cannot
pop in one frame late and missing textures fail with state, atlas, and URL
context. When Blendlink's owned template contract advances, `sync`/`verify`
leave the editable file untouched; run `npx blendlink recipe update <scene>` to
preserve its exact bytes in a deterministic `.bak` and install the current
template. A Lighting scene cannot publish through a stale recipe.

For internally compiled KTX2 scenes, `installThreeCompiledScene()` needs no
extra setup. Sync transactionally publishes `blendlink-basis/` beside the GLB,
including Three's `basis_transcoder.js`, `basis_transcoder.wasm`, attribution
README, and Apache-2.0 license. The installer derives that sibling URL, creates
one `KTX2Loader`, detects renderer support, shares it with material and HDR
loading, and disposes it with the scene. `sync` and `verify` reject a missing or
mismatched runtime file.

The generic `loadCompiledScene()` seam remains application-owned, so pass a
shared loader when using it directly:

```ts
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'

const ktx2 = new KTX2Loader()
  .setTranscoderPath('/basis/')
  .detectSupport(renderer)
const loaded = await loadCompiledScene(new GLTFLoader(), hero, {
  ktx2Loader: ktx2,
  // Optional measured override; false/0 keeps Meshopt decoding on the main thread.
  meshoptWorkerCount: 2,
  meshoptWorkerThresholdBytes: 8 * 1024 * 1024,
})
```

Generic `blendlink typegen` pipelines get the same runtime contract: when the
decoded GLB requires `KHR_texture_basisu`, typegen transactionally publishes
the complete attributed `blendlink-basis/` directory beside that local GLB.
Applications that deliberately host the GLB at a different URL may instead
mirror that sibling directory there or pass an application-configured
`ktx2Loader`.

Typegen also records required `EXT_meshopt_compression` directly from generic
GLBs. Both the one-call installer and `loadCompiledScene()` then configure the
official Meshopt decoder even when no Blendlink optimization report exists.
Generated descriptors also carry the exact total uncompressed Meshopt
buffer-view bytes. Actual high-level loads keep small or unknown scenes on the
main thread and lease a shared 1-2 worker pool only at 4 MiB or larger; the pool
is bounded at four, shared by overlapping Blendlink loads, and stopped after
the last load settles. SSR and browsers without Blob workers fall back without
touching `Worker`, `Blob`, or `URL`.

Use `meshoptWorkerCount: false` (or `0`) to force Blendlink's isolated
main-thread decoder. If the application already owns Meshopt's module-global
pool, pass that configured decoder as `meshoptDecoder`; Blendlink installs it
as-is and never calls `useWorkers()` on it. The owned-decoder option is mutually
exclusive with Blendlink's worker count and threshold. `meshoptWorkerThresholdBytes: 0`
explicitly opts hand-authored descriptors without size evidence into workers.
`configureCompiledSceneLoader()` alone always installs a main-thread adapter
and never starts a worker; only the awaited `loadCompiledScene()` and
`installThreeCompiledScene()` seams acquire worker leases.

Applications that deliberately own individual policies can still use the
lower-level helpers instead of the one-call installer:

```ts
import * as THREE from 'three'
import {
  applyCompiledSceneEnvironment,
  applyCompiledSceneFog,
  applyCompiledSceneLook,
  applyCompiledSceneShadows,
  installCompiledSceneCamera,
  startCompiledScenePlayback,
} from 'blendlink/three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js'

const playback = startCompiledScenePlayback(loaded, hero, {
  createMixer: (root) => new THREE.AnimationMixer(root as THREE.Object3D),
  loopModes: {
    once: THREE.LoopOnce,
    repeat: THREE.LoopRepeat,
    pingpong: THREE.LoopPingPong,
  },
})
const look = applyCompiledSceneLook(renderer, scene, hero, {
  toneMappings: {
    agx: THREE.AgXToneMapping,
    neutral: THREE.NeutralToneMapping,
    aces: THREE.ACESFilmicToneMapping,
    none: THREE.NoToneMapping,
  },
  createColor: ([r, g, b]) => new THREE.Color().setRGB(r, g, b),
})
const fog = applyCompiledSceneFog(scene, hero, {
  createFog: (recipe) => recipe.mode === 'linear'
    ? new THREE.Fog(new THREE.Color().setRGB(...recipe.color), recipe.near, recipe.far)
    : new THREE.FogExp2(new THREE.Color().setRGB(...recipe.color), recipe.density),
})
const shadows = applyCompiledSceneShadows(renderer, loaded.scene, hero, {
  shadowMapTypes: {
    basic: THREE.BasicShadowMap,
    pcf: THREE.PCFShadowMap,
    vsm: THREE.VSMShadowMap,
  },
})
const environment = await applyCompiledSceneEnvironment(scene, hero, {
  // Three r184 can use the verified packed-float derivative. Without ktx2
  // plus LinearFilter, or if it fails to load, the exact source is automatic.
  loaders: { hdr: new HDRLoader(), exr: new EXRLoader(), ktx2 },
  linearFilter: THREE.LinearFilter,
  equirectangularReflectionMapping: THREE.EquirectangularReflectionMapping,
  onWarning: console.warn,
  createGroundedBackground: (texture, settings) => {
    const ground = new GroundedSkybox(texture as THREE.Texture, settings.height, settings.radius)
    ground.position.y = settings.height
    ground.rotation.y = settings.rotation
    return ground
  },
})

const cameraControls = installCompiledSceneCamera(
  loaded.scene,
  loaded.blendlink,
  hero,
  {
    createControls: ({ camera, targetPosition }) => {
      const controls = new OrbitControls(camera as THREE.Camera, renderer.domElement)
      if (targetPosition) controls.target.set(...targetPosition)
      return {
        update: (delta?: number) => controls.update(delta),
        dispose: () => controls.dispose(),
        saveState: () => controls.saveState(),
        reset: () => controls.reset(),
        setTarget: (x: number, y: number, z: number) => controls.target.set(x, y, z),
      }
    },
    getWorldPosition: (object) =>
      (object as THREE.Object3D).getWorldPosition(new THREE.Vector3()).toArray() as [number, number, number],
    getViewDirection: (camera) =>
      (camera as THREE.Camera).getWorldDirection(new THREE.Vector3()).toArray() as [number, number, number],
    measureBounds: (object) => {
      const sphere = new THREE.Box3()
        .setFromObject(object as THREE.Object3D)
        .getBoundingSphere(new THREE.Sphere())
      return { center: sphere.center.toArray() as [number, number, number], radius: sphere.radius }
    },
    initialViewport: { width: renderer.domElement.clientWidth, height: renderer.domElement.clientHeight },
  },
)

// In the website's existing frame loop:
playback?.update(deltaSeconds)
cameraControls?.update(deltaSeconds)

// On route/scene teardown:
cameraControls?.dispose()
environment.dispose()
shadows.dispose()
fog?.dispose()
look.dispose()
playback?.dispose()
```

For an existing R3F site, `blendlink connect` creates one tiny user-owned
association component per configured scene, such as
`src/blendlink/HeroScene.ts`. Add the one you want inside a Canvas — the
installer accepts the WebGL renderer or an initialized `WebGPURenderer`,
and R3F context-loss handling covers both families:

```tsx
import { HeroScene } from './blendlink/HeroScene'

<Canvas>
  <HeroScene onReady={(scene) => {
    void scene.setStateAsync('Evening')
    scene.setLightGroup('Desk Lamp', { strength: 0.8 })
    scene.animation?.play('Wave')
  }} />
</Canvas>
```

The package-owned adapter installs the same complete recipe, adopts the
authored camera, updates animation/controls/LODs in `useFrame`, follows canvas
size, and takes render priority only when an authored Component installs
post-processing. It restores the prior R3F camera and scene state on unmount,
so lifecycle fixes do not require rewriting generated site files. The thin
component's typed `onReady` prop exposes an advanced borrowed installed handle
without making inline callback identity reinstall the scene; the component
still owns its lifecycle, so callers must not dispose it while mounted.
Ready children should prefer the generated `use<Scene>Scene()` hook for the
ownership-safe application interface. Its renderer-neutral `animation`
transport exposes available clips, immutable state, subscription, `play`,
deterministic `playAll`, `pause`, authored-seconds `seek`, and replayable
`stop`; mixer, frame-loop, and terminal disposal ownership remain inside
Blendlink. Installation failures publish Failed and are rethrown during render
for the nearest Error Boundary. Status and ready callbacks are isolated
best-effort observers: their exceptions are logged instead of being routed
through that boundary. The tiny
association remains
application-owned, while the adapter enforces it as the sole compiled-scene
owner for that Canvas; a competing mount fails loudly because camera,
environment, and composer are Canvas-global. React 19 / R3F 9 compatibility is
checked during connect, and demand-mode canvases keep updating while the
installed scene needs frames, then settle when its known systems are idle.
Blendlink-owned R3F update/composer time starts at zero when an installed
runtime wakes and caps later frame deltas at 100 ms, matching Needle's stall
bound without changing the website's R3F clock or exact low-level playback API.

The output stays standard and inspectable. Remove Blendlink tomorrow and the
GLB, PNGs, and generated data still work.

## What Blendlink understands

- Hybrid baked/realtime scenes and per-object Automatic, Realtime, or Baked
- Main plus artist-created atlases, **Target Detail**, editable UV proposals,
  pinning, density checkers, and explicit scale-to-fit
- Cycles lighting states and additive interactive Light Group layers
- animation clips, timeline markers, curves, cameras, materials, and extras
- **Website Camera & Frames** with exact **Responsive Frame** crop/safe-zone/DPR
  previews plus a deterministic
  Blender-versus-browser reference matrix, real browser-capture callback, and
  measured PNG diffs for Preview and Final
- colliders, LODs, sockets, hotspots, audio anchors, and rigid-body metadata
- versioned portable Components for core effects, visibility, interaction,
  animation, and audio, plus an explicit Three adapter extension point
- stable object IDs plus typed names, clips, materials, states, and anchors
- save-driven Live Preview with last-good retention, loud validation,
  deterministic manifests, cache-busting, standalone watch mode, and CI

It deliberately does not provide multiplayer, Unity support, hosting, an
engine, an owned render loop, or a cloud. Its optional disposable Three.js
adapters translate authored intent into an application-owned scene; the
product boundary is the difficult part small teams otherwise rebuild:
preserving that intent from Blender through a portable, efficient handoff.

## Support and verification

Focused local Windows gates exercise the discoverable Blender 5.2 LTS
installation with Node 24.
Blender 4.2+ plus supported Node 22.15+ and Node 24 are the declared
compatibility floor; the same-commit release workflow defines exact 4.2/5.2
Linux and Windows jobs, but those hosted results remain pending until the
workflow runs. The generated Vite 7 starter uses the same Node floor; new
release lines are added only after consumer and Blender gates pass on them.
Exporter options are inspected against the installed Blender version, and
files saved by a newer Blender are refused by default rather than risk
corruption.

```bash
npm run test:unit            # Vitest contract/unit suite
npm run test:consumer        # real Vanilla + R3F TypeScript/Vite consumers
npm run test:package         # packed consumers + same-version local archive replacement/lock identity
npm run test:addon-headless  # Blender addon + shared vocabulary contract
npm run test:baked-e2e       # real two-state baked compiler path
npm run test:real-tools      # real KTX texture + HDR encode/decode fidelity gates
npm run test:full            # required release bar: build + every suite above
```

`test:full` is the single supported local validation command and requires a
discoverable supported Blender installation and Khronos KTX-Software. The real
toolchain gate creates an owned HDR fixture with Blender, then makes both the
ordinary texture and HDR KTX tests run instead of accepting their optional-test
skip path. The same-commit tagged-candidate workflow runs `test:full` only
after installing pinned Blender and KTX toolchain bytes; hosted success is a
separate release fact from this local command. The baked e2e creates a real two-state `.blend`, compiles it through
headless Blender under an empty owned user profile, checks the bake plan and manifest, verifies constant atlas
background corners, and proves the lighting states visibly differ.

## Living product research

- [Needle feature parity ledger](docs/FEATURE_PARITY.md) tracks every relevant
  competitive capability as Better, Parity, Partial, Gap, Evaluate, or Out of
  Scope and is updated alongside implementation.
- [Needle UI audit](docs/research-needle-addon-ui-parity.md) records the design
  reasoning behind the table.
- [Blender technique ledger](docs/TECHNIQUE_LEDGER.md) turns expert discoveries
  into bounded prototypes with explicit failure cases and adoption criteria.
- [A Version of Reality](docs/research-version-of-reality.md) and the
  [expert Blender source survey](docs/research-expert-blender-sources.md) mine
  concrete techniques for evaluation rather than treating impressive work as
  an automatic feature request.

## License

Blendlink's npm tarball is a mixed aggregate with a file-level
[`LICENSES.md`](packages/blendlink/LICENSES.md): Node/compiler/runtime files are
MIT, Blender-dependent files are GPL-3.0-or-later, and bundled Basis notices
are Apache-2.0. The separately built Blender Extension is
GPL-3.0-or-later. The root `LICENSE` contains the MIT terms for the
MIT-covered repository files; it is not a claim that every repository or
tarball member is MIT.
