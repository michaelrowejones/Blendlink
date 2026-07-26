# Website Surface: application-owned pixels on an artist-owned mesh

- Last updated: 2026-07-26
- Focused evidence last passed: 2026-07-26
- Capability ID: `NDL-SUR-001`
- Relation: **Boundary / Improvement candidate**
- Implementation: **Shipped** for Blender authoring/compiler validation and
  the standard Three/WebGL and R3F adapters
- Evidence: **Verified focused package, real-Blender, aggregate Blendlink
  release gate, and clean production dogfood publication**; npm/GitHub
  publication and hosted CDN/device matrices remain **Pending**

## Decision

Blendlink now provides a narrow **Website Surface** capability: the artist
chooses and positions a screen-shaped mesh in Blender, while the website binds
an application-owned canvas to that semantic surface and decides which pixels
to draw. Blendlink owns the Three texture/material mutation, frame
invalidation, rollback, and disposal behind one small interface. It must not
own hover state, route state, DOM, analytics, or the pixel-producing UI.

The shipped v1 deliberately requires a **separate, Realtime,
single-material mesh with ordinary 0..1 UVs**. It must refuse an Appearance-
baked multi-material object or a material-slot target loudly. This constraint
is narrower than the eventual ideal, but it keeps ownership truthful:

- Blendlink's current component target is an object identified by a stable ID,
  not a primitive or material slot;
- Automatic/Realtime/Baked classification is object-scoped;
- an Appearance bake replaces every material slot on a baked object with its
  atlas carrier and uses compiler-owned atlas UVs; and
- a canvas sampled through one small atlas rectangle would not have the
  expected full-surface UV contract.

Automatic compiler splitting or stable material-slot targets can be evaluated
later as a schema/compiler feature. They are not a safe implicit migration for
the release candidate.

Website Surface is not a renamed baked state. Existing named Lighting and
Appearance states remain artist-authored, content-addressed scene transitions
installed through `setStateAsync()` / the R3F handle's `setState()`. Website
Surface pixels are ephemeral, application-owned runtime content. The two
interfaces must remain distinct even when the website happens to use names
such as `idle`, `code`, or `about` for both.

## Exact Needle source identity

The nearest inspected Needle analogue is its engine-owned `VideoPlayer`, not a
generic application-canvas receiver.

| Source | Exact identity | What this establishes |
| --- | --- | --- |
| Needle Engine [`VideoPlayer.ts`](../experiments/needle-spike/node_modules/@needle-tools/engine/src/engine-components/VideoPlayer.ts) | `@needle-tools/engine` **5.1.7**; normalized path `experiments/needle-spike/node_modules/@needle-tools/engine/src/engine-components/VideoPlayer.ts`; SHA-256 `5307ddd7a03938d32ee46bf5fb13fa5bb7bd1666231f7b096d6111904711249a`; baseline file ID `engine-video-player` | The exact receiver, texture, media, and cleanup behavior described below |
| Three [`GLTFLoader.js`](../node_modules/three/examples/jsm/loaders/GLTFLoader.js) | `three` **0.184.0**; SHA-256 `97642d720f16cc9a0c9844934198e4d0c023bea8e89576d0f7545d03b2d103d2` | The stock glTF image-source path explicitly sets `texture.flipY = false` before the texture is assigned to imported material state |
| Three [`BufferGeometry.js`](../node_modules/three/src/core/BufferGeometry.js) | `three` **0.184.0**; SHA-256 `41029aa0f06674911225eb8ac20e4894323fbb94f98be4ad3e0e65a11a17fe9a` | Public indexed/non-indexed triangle-list traversal uses index triplets or contiguous position triplets; Three's tangent path computes the corresponding UV determinant but silently skips coincident/collinear UV triangles |
| Three [`CanvasTexture.js`](../node_modules/three/src/textures/CanvasTexture.js) | `three` **0.184.0**; SHA-256 `f6258ea9f08f511b79c86c530665747f7152e5345abbfe4dff7d7ea60bca634b` | A canvas texture starts with `needsUpdate = true` |
| Three [`VideoTexture.js`](../node_modules/three/src/textures/VideoTexture.js) | `three` **0.184.0**; SHA-256 `1ff70de3a313d53cb3fd57e308f3664a650fd3247899651c2942bd2c20c17e2d` | Three's dynamic video source uses Clamp-to-Edge wrapping, Linear minification/magnification, anisotropy `1`, and no generated mipmaps |
| Three [`Texture.js`](../node_modules/three/src/textures/Texture.js) | `three` **0.184.0**; SHA-256 `ab2b297f91c58c69a95849ef8d1d3a9b7c0e7d2c3a574964b0ffd90b107452c6` | Later pixel publication requires `needsUpdate = true`; `dispose()` releases renderer-owned GPU resources |

`npm run verify:needle-baseline` passed on 2026-07-26 for the broader 131-file,
nine-identity inventory. That inventory is intentionally
`integration=mixed-source` and names its separately coherent Splash lane.
Therefore this note makes a source-level comparison against exact Needle
Engine 5.1.7 bytes; it does **not** claim an end-to-end coherent Needle
add-on/build/runtime Website Surface differential.

## What Needle 5.1.7 actually does

The inspected `VideoPlayer`:

1. creates a hidden `HTMLVideoElement`, assigns a URL or `MediaStream`, and
   creates a Three `VideoTexture` with `flipY = false` and sRGB color space;
2. resolves a target renderer, reads its `material`, clones that material,
   assigns the clone to the target object, and writes the video texture to the
   clone's `map` field;
3. assumes a scalar cloneable material. It has no material-array/material-slot
   branch, and its own diagnostic mentions that multi-material is unsupported;
4. supports autoplay, loop, speed, time, muted-before-input behavior,
   `crossorigin="anonymous"`, streams, and an HLS path;
5. pauses on disable. Visibility-driven pause is opt-in because
   `playInBackground` defaults to `true`; and
6. removes the video element and disposes the `VideoTexture` in `onDestroy()`.
   The inspected destroy path does not restore the target's original material
   assignment or dispose `_videoMaterial`.

The material-receiver path does not inspect target geometry, UV attributes,
indices, triangle topology, or area and performs no mesh-UV repair. Its only
receiver-adjacent aspect adjustment changes object scale. Therefore the loud
zero-area UV refusal below is a scoped **Improvement** over this exact receiver,
not a claim about every Needle package.

Items 1-6 are source observations. No current Blendlink gate executes this
5.1.7 class for a same-surface browser differential, so they are not browser
or leak measurements.

Needle's useful baseline is the receiver technique: author a mesh, clone its
material, place live pixels in a texture, and keep media behavior behind a
component. Blendlink should retain that depth while changing the ownership at
the product seam. A Blendlink website already owns its DOM, navigation,
loading presentation, and interaction state, so forcing those pixels through
an engine-owned video URL or trigger graph would work against the product
promise.

## Current Blendlink ownership that constrains the design

The existing [portable component contract](MANIFEST.md#portable-component-contract)
already provides rename-stable object targets and transactional Three adapter
installation. The existing [baked-mode runtime contract](MANIFEST.md#baked-mode-runtime-contract)
owns Appearance/Lighting atlas UVs, material replacement, external state
textures, state visibility, and `setStateAsync()`.

Those are complementary modules:

- **Portable Components** are the authoring/runtime seam for declaring that an
  object is a Website Surface.
- **The Website Surface module** hides canvas-texture creation, material
  clone/assignment, invalidation, conditional restoration, and disposal.
- **Baked states** continue to own content-addressed Blender-authored scene
  variants. Website Surface must not route through or mutate that module.

The deletion test favors a package-owned Website Surface module. If it were
deleted, every site would need to rediscover target lookup, UV/material
constraints, sRGB texture setup, Strict Mode-safe leases, demand-loop
invalidation, material restoration, and disposal. A raw `Object3D` or material
handle would merely expose that complexity to each caller.

## Designs compared

| Design | Result | Reason |
| --- | --- | --- |
| Reuse baked `setState(name)` for `idle` / `code` / `about` | Rejected | It conflates content-addressed Blender states with ephemeral website UI, invites network/decode work for hover, and makes Blender or Blendlink own application state. |
| Give the site a raw node/material and let it install `CanvasTexture` | Rejected | The interface is shallow: each caller must understand material sharing, atlas UVs, color space, invalidation, Strict Mode, rollback, and disposal. |
| Target one material slot inside an otherwise baked multi-material object | Deferred | It needs a stable primitive/material-slot identity, mixed baked/realtime UV ownership, compiler attestation, and a schema decision. Needle 5.1.7 does not provide a proven multi-material baseline. |
| Dedicated Realtime one-material mesh plus a semantic Website Surface binding | Selected and shipped for WebGL | It preserves artist control of geometry/fallback appearance and application control of pixels while keeping renderer/lifecycle complexity package-owned. It fails loudly before publication and has a small browser-facing interface. |

## Shipped interface and invariants

The installed Three scene and ready-only R3F scene handle expose the same deep
module. Generated R3F descriptors narrow `name` to the authored surface-name
union when it is statically available:

```ts
const binding = scene.websiteSurfaces.bindCanvas('monitor-screen', canvas)
drawApplicationPixels(canvas)
binding.changed()

// Route or scene teardown. The application-owned canvas remains usable.
binding.dispose()
```

The caller needs to know only a semantic surface name, its own
`HTMLCanvasElement`/`OffscreenCanvas`, and when its pixels changed. The module
owns these invariants:

- exactly one enabled authored surface per semantic name;
- one active binding lease per surface;
- the authored mesh is separate, Realtime, renderable, and single-material;
- the artist supplies ordinary full-surface 0..1 UV0. Runtime, add-on
  validation, and the independent exporter require non-empty finite UV0,
  bounds within 0..1 with `1e-5` numeric tolerance, and all four square edges
  reached within `1e-4`. They additionally sum absolute per-triangle UV area
  and require more than `1e-10`, so opposing winding cannot cancel and a
  full-bounds collinear mapping cannot masquerade as usable coverage;
- the source material is never mutated;
- installation clones and assigns material state transactionally;
- while unbound, `Display` preserves the authored fallback texture object and
  tint. `bindCanvas()` neutralizes that tint only while live application pixels
  occupy the map slot, and conditional disposal restores the fallback map and
  tint without mutating or disposing the authored texture;
- `bindCanvas()` creates an sRGB `CanvasTexture` with `flipY = false`, matching
  both Needle 5.1.7's inspected `VideoPlayer` receiver and Three r184's glTF
  image-source orientation. It also uses Three's complete dynamic-source
  policy: Clamp-to-Edge S/T, Linear min/mag filters, anisotropy `1`, and
  `generateMipmaps = false`. This avoids rebuilding a mip pyramid after every
  application update;
- the live canvas deliberately uses identity texture transform and full UV0.
  It does not inherit the fallback texture's `KHR_texture_transform`; that
  authored fallback texture and transform remain intact while unbound;
- initial binding requests one frame without claiming continuous render-loop
  ownership;
- `changed()` marks only the owned canvas texture dirty and requests one frame;
- `dispose()` restores the fallback map and tint only while the lease still
  owns the map slot, then disposes owned texture/material resources exactly
  once;
- scene disposal releases every remaining binding;
- a stale Strict Mode or replaced-scene lease cannot mutate the current scene;
  and
- bind/validation failures include the semantic name and actionable target or
  remedy context; the authoring record independently retains stable component
  and object IDs.

The authoring UI adds `blendlink.website-surface`, assigns a unique lowercase
kebab-case Website Name, marks its selected dedicated Mesh Realtime, and
removes its atlas override transactionally. `Display` uses an unlit,
non-tone-mapped material for UI-like pixels; `Surface` preserves the cloned
authored material response. Add-on validation and the background compiler both
refuse non-Mesh, non-Realtime, empty, multi-material/material-index, missing,
non-finite, out-of-range, not-full-square, or zero-area UV0, duplicate-name, and
unresolved-target cases. Disabled Website Surface records remain serialized
and editable so draft authoring intent round-trips without becoming an enabled
publish blocker.

The artist owns mesh placement, UVs, fallback material, and the semantic name.
The website owns canvas resolution, drawing, hover/focus/route state,
accessibility, and analytics. Blendlink owns only the transport and renderer
lifecycle. A future Video Surface may build on the same internal receiver seam,
but video playback, autoplay policy, audio, source/CORS, poster, crop, and
visibility pause are a separate interface and remain a parity gap.

Creating `CanvasTexture` or setting `needsUpdate` proves only that Three will
schedule texture upload on a subsequent render. Neither that source behavior
nor `renderer.initTexture()` is a GPU-completion or presented-pixel barrier.

## Evidence state

### Shipped and verified

Dates are stated per gate. The focused package/build, registered-add-on,
aggregate release, and production dogfood gates all pass the current
zero-area-validation and canvas-orientation bytes.

| Layer | Exact gate | Verified claim |
| --- | --- | --- |
| Portable schema + Three module + installed Components | `npm test --workspace blendlink -- src/components.test.ts src/threeWebsiteSurfaces.test.ts src/threeComponents.test.ts` — **3 files, 64 tests passed** on 2026-07-26 | Semantic-name validation; shared-source-material isolation; explicit no-mipmap dynamic texture policy; authored fallback map/tint preservation and live-tint neutralization; demand invalidation without a continuous-frame claim; conditional restoration; finite, bounded, full-square UV0 refusal; duplicate/unknown/zero-size/multi-material refusal; scene teardown; installed-scene exposure |
| Focused Website Surface runtime | `npm.cmd test --workspace blendlink -- src/threeWebsiteSurfaces.test.ts` — **1 file, 5 tests passed** on 2026-07-26 | CPU-side `CanvasTexture.flipY = false` contract matching the inspected Needle/glTF source paths; indexed full-bounds collinear UV0 refusal using public BufferGeometry topology; dynamic sampler/mipmap invariants; fallback restoration; and the map-less `USE_MAP` regression. Presented-pixel orientation is established separately by the production-browser row below |
| Focused zero-area Blender differential | Blender **5.2** `--background --factory-startup --python-exit-code 1 --python-expr $code` — printed `WEBSITE_SURFACE_UV_AREA_FOCUSED_CHECK_PASSED` on 2026-07-26 | Add-on diagnostics, enabled serialization, and the independent exporter all reject a full-bounds collinear plane with the same repair contract; disabled records remain non-blocking, serializable, and compiler-skipped |
| Registered add-on + exporter regression | From `packages/blender-addon`: `& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python-exit-code 1 --python tests\run_headless.py` — exit `0`, printed `BLENDLINK_ADDON_TESTS_PASSED` on 2026-07-26 | The retained collinear add-on/serializer fixture and independently repeated exporter fixture pass inside the complete registered-add-on regression suite |
| Package build | `npm.cmd run build --workspace blendlink` — exit `0` on 2026-07-26 | TypeScript compiled and current Blender/add-on distribution assets were copied |
| Add-on schema/discoverability | `python packages\blender-addon\tests\component_schema_check.py` — passed on 2026-07-25 | `blendlink.website-surface`, defaults, field bindings, and `application pixels` search discoverability stay aligned |
| Focused real Blender UV differential | Blender **5.2** `--background --factory-startup --python-exit-code 1 --python-expr $code` against the Website Surface assertions retained in `packages/blender-addon/tests/run_headless.py` — printed `WEBSITE_SURFACE_UV_FOCUSED_CHECK_PASSED` on 2026-07-26 | Enabled authoring validation, add-on serialization, and the independent exporter agree on finite, bounded, full-square UV0; collapsed, cropped, out-of-range, and non-finite fixtures fail independently, while disabled draft records still round-trip |
| Blender Python syntax | `& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python-exit-code 1 --python-expr "import ast; from pathlib import Path; files=[Path(r'packages/blender-addon/component_validation.py'),Path(r'packages/blender-addon/props.py'),Path(r'packages/blender-addon/tests/run_headless.py'),Path(r'packages/blendlink/blender/export_scene.py')]; [ast.parse(p.read_text(encoding='utf8'), filename=str(p)) for p in files]; print('WEBSITE_SURFACE_UV_SYNTAX_OK')"` — printed `WEBSITE_SURFACE_UV_SYNTAX_OK` on 2026-07-26 | All four changed Blender-side Python files parse under the release Blender runtime |
| Current aggregate Blendlink release gate | `npm run test:full` — exit `0` on 2026-07-26 | The current Website Surface bytes passed build, the unit/release contracts, required real Blender 5.2 and Khronos KTX tooling, packed Vanilla and R3F consumer builds, add-on headless/archive verification, and baked appearance/lighting e2e |
| Production dependency audit | `npm run audit:production` — passed on 2026-07-26 | The reviewed workaround for `GHSA-f88m-g3jw-g9cj` remained the only named advisory policy |
| Local release-artifact rehearsal | `npm run release:artifacts -- --allow-dirty` — passed on 2026-07-26 | Wrote `artifacts/release/0.8.0/release-manifest.json`; this was a local, unpublished dirty-worktree rehearsal, not a clean release or registry publication |
| Production Next/Chromium hover/focus dogfood | From the configured site smoke in `npm run blendlink:publish -- workbenchDogfood`: `artist-authored monitor surface follows website hover and keyboard focus` passed on 2026-07-26 | The artist-authored `monitor-screen` is present; website hover selects code/Blender pixels; the stable monitor-inner ROI—not the surrounding hero—changes by more than `5%` of pixels; keyboard focus selects document/code states; console/page failures remain empty |
| Presented-pixel canvas orientation | From the configured site smoke in `npm run blendlink:publish -- workbenchDogfood`: `artist-authored monitor surface preserves top-to-bottom canvas orientation` passed on 2026-07-26 | An asymmetric cyan-top/orange-bottom application canvas is sampled from the rendered monitor ROI after the R3F scene reaches Ready. The test requires each intended half to occupy more than `8%` of its crop, requires each color to be more than twice as prevalent in its intended half, and observes no console/page failure; this closes the CPU-only `flipY` evidence gap for the tested Next/Chromium path |
| Production dogfood publish gate | From `MichaelRoweJonesSite`: `npm run blendlink:publish -- workbenchDogfood` — exit `0` on 2026-07-26 | Final compilation and artifact verification, the existing Next **16.2.6** production build, and the configured production browser smoke all passed. The production build produced `/work/development/blendlink`; the smoke finished **25/25**, including hover/focus Website Surface state changes, asymmetric presented-pixel orientation, the settled demand-loop policy, and retry/remount lifecycle cases |

Focused package toolchain: Node **24.15.0**, Three / `@types/three`
**0.184.0**, R3F **9.6.1**, Vitest **3.2.4**, and TypeScript **5.9.x**.
The browser gate used the site's Next **16.2.6** production integration.

The dogfood keeps render-loop ownership at the application seam. The site uses
`always` while its own transitions or compositor introduction are active,
settles to `demand`, and uses `never` while the persistent stage is hidden.
Blendlink's R3F adapter continues to requeue demand frames only while the
installed scene's package-owned animation, controls, LOD, or Components
truthfully report `requiresContinuousFrames`. Website Surface itself acquires no
continuous-frame lease: initial binding and each `changed()` call request one
frame. The 25-test production smoke observes the public hero settled in
`demand` after sustained rendering; this is one site-owned integration policy,
not a package claim that every application must use that policy.

### Prototype evidence

The exact Needle 5.1.7 source comparison establishes a product **Boundary**
and identifies cleanup/multi-material Improvement candidates. No gate yet
executes Needle and Blendlink against the same scalar/multi-material receiver,
so the relation remains **Improvement candidate**, not verified Improvement.

### Pending current run

- npm registry and GitHub publication. The passing `--allow-dirty` release-
  artifact command above remains only a local rehearsal; and
- hosted CDN/base-path/CSP verification plus cross-browser, mobile, and
  physical-device matrices. The local production Next/Chromium gate does not
  establish those deployment claims.

### Future work

- stable primitive/material-slot addressing or automatic compiler splitting
  for a screen embedded in a baked multi-material object;
- a same-fixture executed Needle differential;
- WebGPU/TSL adapter evidence, cross-browser/mobile/physical-GPU coverage, and
  context-loss/rebind browser coverage; and
- full Video Surface media policy: URL/CORS, autoplay/audio, loop, poster,
  fit/crop, source replacement, and visibility pause.

Unit seams establish ownership and invalidation. The named production-browser
gate, not those unit seams, establishes visible hover/focus pixel changes in
the dogfood site. It is one Next/Chromium case, not universal display parity.
