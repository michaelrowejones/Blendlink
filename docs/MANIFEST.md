# The blendlink manifest contract (schemaVersion 3)

`<scene>.manifest.json` is the machine contract between blendlink and any
runtime. Policy: **additive-only within a schemaVersion; reshape bumps the
version; every reader enforces the version on read** (blind-casting old
manifests once meant silent misreads).

## Identity and drift

- `runtimeAssetGraph` is additive schema-v3 evidence for every compiler-owned
  runtime request in the publication transaction. It records a full SHA-256
  graph fingerprint plus sorted `{ path, role, bytes, sha256 }` entries for the
  GLB, companions, and all four concrete Basis runtime/attribution files when
  KTX2 is required. Paths are traversal-safe POSIX-relative names and
  case-fold collisions are rejected for Windows/macOS portability. Generated
  source and remote Component media are deliberately outside this graph.
  Internal compile verifies every entry's exact path/type/bytes/hash before an
  unchanged-scene skip and during `verify`; symbolic-linked entries, noncanonical order,
  malformed metadata, a wrong scene root, and incomplete KTX2 runtime fail
  loudly. Generic external `typegen` may omit this field because Blendlink does
  not own or discover that pipeline's complete companion closure.
  For an internally compiled scene, `runtimeAssetPublication` is the matching
  additive activation record:
  `{ algorithm: "sha256", bundlePath, scenePath, immutable: true }`.
  Blendlink seals the exact graph beneath
  `<scene-output>/<scene-name>/<full-graph-sha256>/`, verifies it again, and
  only then transactionally switches the generated manifest/module. Every
  compiler-owned generated URL points into that directory. Byte-identical
  builds reuse it without touching file mtimes; changed bytes select a new
  directory while the old graph remains valid.

  The stable files beside the configured GLB are a pre-1.0 compatibility
  mirror. They are verified and repaired by compilation but are **not**
  immutable-cache eligible. Old graph directories are retained; Blendlink does
  not currently guess a cleanup/retention policy. A corrupt existing hash
  directory is never overwritten in place: the error names the exact directory
  an owner must remove before retrying.

  Hosts may derive the only safe immutable route with
  `compiledSceneImmutableAssetPolicy(scene[, assetBaseUrl])` from
  `blendlink/assets` (also exported from `blendlink`). It returns the exact
  graph prefix and `public, max-age=31536000, immutable` only when the
  descriptor URL ends beneath its full lower-case SHA-256 graph. The website
  remains responsible for installing that header in Next, Vite's production
  host, or its CDN. Mutable/stable paths must not inherit it.

  A graph fingerprint is exact identity evidence, not a promise that an
  external exporter is byte-deterministic. When `--force` rebuilds a scene
  whose declared inputs and preceding artifacts were otherwise current,
  Blendlink compares the old and new graphs after atomic publication. A changed
  fingerprint emits a loud warning with added, removed, or changed runtime
  paths and states that the new hashes are exact even though the toolchain did
  not reproduce the prior cache key. Ordinary no-op compilation skips that
  exporter work and preserves the existing key.

  Export-time warnings can also name a proven proactive hazard before drift is
  observed. Blender 5.2 applied exports containing enabled Bevel modifiers and
  UVs are currently warned because microscopic evaluated-UV differences can
  alter glTF split-vertex/accessor counts and exact GLB hashes while evaluated
  topology and rendered triangles stay stable. Blendlink does not round
  artist-authored or baked-atlas UV bytes to force a matching hash. Visual
  stability must be recorded separately; it never weakens graph verification.

- `hash` — content hash of the GLB; cache-busting key and drift signal.
- `configSourceHash` — full SHA-256 identity of the loaded Blendlink config
  revision for configured compilation. Publication rechecks that revision
  before activation, and `verify` rejects generated artifacts from another
  revision. Generic external typegen may omit it only when no configured
  compiler owns that external pipeline.
- `generatedModuleHash` — content hash of the generated TypeScript module.
  The Blender addon requires both hashes, plus every separately published
  image hash below, before showing **In sync**. URL resolution is limited to
  exact project/static paths; an unrelated same-basename file is never used.
- `sourceBlend` — commit-safe source provenance. A source below the connected
  project root is stored as a slash-normalized project-relative path. A source
  outside that root is represented only as `external/<sha256>` and adds
  `sourceBlendLocalPathKey`; neither the absolute path nor its basename is
  written to the manifest or generated TypeScript comment.
- `sourceBlendLocalPathKey` — optional SHA-256 key for the exact source path in
  Blendlink's private per-user provenance cache. The cache lives outside the
  project and publication graph
  (`%LOCALAPPDATA%/Blendlink/Cache/local-provenance-v1/` on Windows,
  `~/Library/Caches/blendlink/local-provenance-v1/` on macOS, or
  `$XDG_CACHE_HOME/blendlink/local-provenance-v1/` on Linux). Its
  schema-v1 records are written atomically with owner-only mode where the
  platform honors it. Missing, malformed, or key/path-mismatched cache state
  is stale state: sync and the addon require a new local sync and never treat
  the opaque public label as a filesystem fallback.
- `externalDependencies` — unpacked Blender inputs with path scope, byte count,
  content hash, existence, and volatility. Same-path texture/IES/OSL edits
  invalidate sync even when the `.blend` bytes do not; sequence/UDIM/directory
  inputs are intentionally never considered safe for an unchanged-scene skip.
  Relative inputs may remain `relativeToBlend: true`; in that case `path` is
  slash-normalized and resolves from the exact source `.blend`. An input below
  the project may instead carry `projectRelative: true` and resolve from the
  connected project root. An input outside both ownership roots carries an
  opaque `external/<sha256>` public `path` plus `localPathKey`, whose exact
  location exists only in the same private user cache described above. These
  locator fields are additive schema-v3 metadata. The private cache is not a
  generated companion, package file, runtime request, or deployable artifact.
  An entry may add `reachable: false` and
  `reachabilityReason: "unbound-material"` only when Blender proves that every
  local single-file Image at that path is confined to Material node graphs
  outside the exported source/evaluated object scope, with no active
  World/compositor/light/modifier use. The entry remains visible for cleanup,
  but cannot invalidate or produce the "may render differently" warning for
  that build. Missing files with absent/ambiguous reachability remain loud.
- `blendBytesHash` — sha256 (first 16 hex) of the .blend bytes; lets
  Blender-free CI and the addon detect drift without opening Blender.
- `syncHint` — the command that regenerates these artifacts.
- `identities` — stable `blendlink_id` → loaded node name/kind. Unlike a
  readable name, this survives Blender renames and hierarchy changes.
- `recipe` / `presentation` — the validated artist-owned Web Presentation
  embedded in the `.blend`. Runtime adapters may inspect it; config must not
  override it.
- `recipe.camera` — optional rename-stable presentation camera contract:
  `{ objectId, objectName, behavior, framing, targetId?, targetName?, compositions }`.
  Behavior is `fixed`, `orbit`, or `free`; orbit requires a stable target ID.
  Framing is `authored`, `fit-scene`, or `fit-target`; `authored` is the
  non-moving default and fit-target also requires a stable target ID.
  Each composition carries an artist label, pixel width/height, and a
  `safeMargin` fraction reserved for page copy and controls. The generated
  module exposes this as `scene.camera`.

### Camera-controls adapter

- The high-level `installThreeCompiledScene()` WebGL seam honors authored
  Orbit/Free behavior by creating official Three `OrbitControls`/`FlyControls`;
  it owns their listeners and disposes them with the installed scene. Fixed
  intent never creates controls.
- The lower-level `installCompiledSceneCamera()` seam never chooses a concrete
  controls implementation. It resolves camera/target objects through stable
  IDs, returns one `update` / `fit` / `reset` / `dispose` handle, and calls the
  website's `createControls()` only for Orbit/Free intent.
- A controls constructor that eagerly changes the camera cannot replace the
  first frame: Blendlink restores the authored transform before returning.
  In the lower-level seam, the factory receives the exact world-space target
  and owns the concrete Three `OrbitControls`, `MapControls`, R3F, or
  project-specific adapter.
- Fit is still two-party opt-in: the artist chooses it and the website supplies
  `initialViewport`, `measureBounds`, and `getViewDirection` when installing.
  Fit selects the closest authored responsive frame, protects its safe margin,
  keeps the authored view direction, reports the actual/authored aspect
  consequence, and refuses a move that crosses the authored near/far clip
  planes. Later `fit()` calls are explicit; canvas resize alone never recenters.

## Portable component contract

`recipe.components` is the artist-authored website-behaviour inventory. The
same array is copied to top-level `components` in the manifest and generated
scene descriptor so a runtime does not need to understand the rest of the bake
recipe. Each record is plain JSON:

```json
{
  "id": "rename-stable-component-id",
  "type": "blendlink.bloom",
  "schemaVersion": 1,
  "enabled": true,
  "target": { "kind": "scene" },
  "values": { "mode": "bright-pixels", "intensity": 0.5, "threshold": 1, "radius": 0.4 }
}
```

- `id` identifies the authored component independently of its label or target.
- `type` is vendor-namespaced. Component schema versions are independent of
  manifest schema version 3, so an adapter can evolve without reshaping the
  complete scene contract.
- `target` is either `{ kind: "scene" }` or
  `{ kind: "object", objectId, objectName? }`. `objectId` is the same
  rename-stable `blendlink_id` used by generated bindings; `objectName` exists
  only to make diagnostics readable.
- `values` may contain only finite, acyclic JSON data. Unknown namespaced types
  and newer fields remain round-trippable rather than being erased.
- Known fields retain exact JSON types and ranges end to end. Authoring
  copy/paste may carry an incomplete draft, but it never coerces strings into
  booleans/numbers or accepts an unresolved stable object reference. Cards,
  cached Web Checks, and publish preflight share the same read-only relational
  validation. Runtime-required values remain mandatory for enabled records;
  disabling a structurally valid unfinished record parks that draft without
  running it or blocking the rest of the scene.

The first-party library is deliberately focused: `blendlink.bloom`,
`blendlink.vignette`, `blendlink.chromatic-aberration`,
`blendlink.pixelation`, `blendlink.sharpen`, `blendlink.tilt-shift`,
`blendlink.ambient-occlusion`, `blendlink.outline`, `blendlink.color-grading`,
`blendlink.depth-of-field`, `blendlink.kuwahara`,
`blendlink.see-through`, `blendlink.open-url`, `blendlink.hover`,
`blendlink.website-surface`, `blendlink.hide-on-start`, `blendlink.look-at`,
`blendlink.play-animation-on-click`, `blendlink.audio-source`, and
`blendlink.play-audio-on-click`. Kuwahara's WebGL adapter is explicitly
`preview`; it is not a production claim until temporal visual and device-budget
acceptance passes. This is a useful core library, not catalog-count parity with
a hosted engine.

`installThreeCompiledScene()` installs those first-party behaviours and accepts
additional `componentAdapters` keyed by namespaced type. An enabled component
without an adapter fails loudly with its type and component ID; disabling it is
the explicit way to keep authored intent without running it. Installer options
also expose `openComponentUrl` for a site router/policy and
`componentAudioLoader` for application-owned credentials, caching, or CDN
behavior. `loadComponentLut` may return an authenticated/application-cached,
application-owned `Data3DTexture`; without it, `.cube` and `.3dl` URLs use the
lazy official Three loaders and Blendlink owns the result. `onWarning` receives
capability and scene-cost fallbacks. The installed handle owns its listeners,
mixers, audio nodes,
temporary per-occluder material clones and assignments, and post-processing
targets. Shared source materials are never mutated; original mesh assignments
are restored and the clones disposed when the occlusion clears or the handle is
disposed. Applications call `update(deltaSeconds)`,
`render(deltaSeconds)`, and `resize(width, height)`, then `dispose()` on teardown.
`render()` must replace a direct `renderer.render()` call when any post effect
is enabled so the owned composer participates in the frame.

The installed component handle also exposes `accessibleControls`, an immutable
application-facing view of authored click behaviors. Each control provides a
stable component ID, semantic `role` (`link` or `button`), artist-authored or
fallback `label`, optional validated `href` and `linkTarget`, `activate()`, and
`setFocused()`.
Blendlink owns one canvas listener set and one nearest-target raycast across all
first-party interactions; overlapping components on the same object compose.
The application remains responsible for rendering native anchors/buttons,
focus-visible styling, routing, analytics, and any page-level input policy.
This is deliberately not a package-owned DOM overlay or general event bus.
The renderer adapter requests a frame when an interaction changes visual state,
and `requiresContinuousFrames` stays true only while installed lifecycle work
reports itself active (or when an application adapter cannot prove it is idle).

An enabled `blendlink.website-surface` targets one dedicated ordinary Realtime
Mesh with one material and authored UV0. UV0 must be non-empty and finite,
remain inside 0..1 within `1e-5`, and reach all four square edges within
`1e-4`. Its renderable triangles must also have more than `1e-10` total
absolute UV area; bounding-box coverage alone is insufficient because a
diagonal, collinear unwrap samples no usable application pixels.
`values.name` is a scene-unique
lowercase kebab-case application name; `colorTreatment` is `display` (unlit,
no material tone mapping) or `surface` (preserve the cloned authored material
response). The add-on marks a selected target Realtime and removes its atlas
override when the behavior is added; both add-on validation and background
compile independently refuse stale baked, non-Mesh, empty, multi-material,
missing/non-finite/out-of-range/cropped/zero-area UV0, duplicate-name, or
unresolved-target records. Disabled records remain serializable and editable so draft
authoring intent round-trips without becoming an enabled publish blocker.

The installed Three scene and ready-only R3F handle expose
`websiteSurfaces.bindCanvas(name, canvas)`. The returned binding's `changed()`
marks Blendlink's sRGB `CanvasTexture` dirty and requests one demand frame.
The live texture uses glTF-oriented `flipY = false`, Clamp-to-Edge S/T, Linear
min/mag filters, anisotropy `1`, and `generateMipmaps = false`, matching the
inspected Needle receiver's orientation and Three's dynamic `VideoTexture`
policy while avoiding a new mip pyramid per pixel update. It uses identity
texture transform and full UV0 rather than inheriting the fallback texture's
`KHR_texture_transform`. For `display`, the authored fallback texture object
and tint remain preserved while unbound; tint is neutralized only while live
pixels own the map slot. Idempotent `dispose()` conditionally restores both map
and tint while Blendlink still owns them, then releases its wrapper. Scene
disposal releases remaining bindings.
The website retains the canvas, pixels, input, DOM, route, accessibility, and
analytics; Blendlink owns semantic target lookup, material isolation,
invalidation, restoration, and wrapper disposal. This is independent from
baked `setState()` and never turns hover labels into content-addressed atlas
states. V1 refuses material-slot targeting inside an otherwise baked multi-
material object.

The WebGL post service pins exact Three 0.184.0, `postprocessing` 6.39.3, and
N8AO 1.10.2 for its source-audited build. It loads the stack only for scenes
that need it, fuses compatible pmndrs effects, splits multiple convolution effects,
places depth stages before HDR light stages, transfers the exact supported
Three tone mapper to one final HDR transform, then runs LDR creative effects.
Half-float target failure is an explicit LDR fallback, never a silent HDR
claim. `InstalledThreeComponents.postprocessingOrder` reports the resolved
semantic order. Runtime quality changes resolution/sample policy without
rewriting authored intensity, radius, focus, or style values. Disposal clears
temporary selection layers and restores tone mapping and renderer auto-clear
only while Blendlink's installed values still own them.

For spatial `blendlink.audio-source`, `minDistance` means full volume within
that radius and `maxDistance` means silent at and beyond that radius;
`maxDistance` must be strictly greater. The Three adapter explicitly sets Web
Audio's `linear` distance model and rolloff factor `1`, then maps those fields
to reference/max distance. It does not use the default inverse model, where
maximum distance merely stops further attenuation and would contradict the
artist-facing control.

Rigid bodies and colliders remain canonical object semantics, not duplicate
component records. Their existing `blendlink_*` fields and generated metadata
describe physics intent; the website still chooses its physics runtime. Network,
room, avatar synchronization, and other multiplayer components are outside this
contract.

`sourceHash` is the rebuild key over the `.blend`, effective integration
settings, Blender version, and the actual deterministic TypeScript and
Blender-side compiler modules. A compiler, diagnostics, HDR conversion, or
optimizer fix therefore cannot silently keep artifacts produced by older code
merely because the artist did not touch the scene.

## Realtime material publishing contract

The GLB is the runtime material contract; the manifest does not duplicate or
reinterpret Blender shader graphs.

- Standard exports and **Bake Lighting** meshes use Blender's stock glTF
  exporter with materials enabled. Supported Principled BSDF inputs, image
  textures, and KHR material extensions therefore follow the capabilities of
  the installed supported Blender exporter. Blendlink does not maintain a
  separate Principled translator or ship Blender node graphs to the browser.
- Material Properties classifies each material's active Surface branch as
  **Exact glTF**, **Approximated**, or **Needs Bake**. Exact means the authored
  parameters have a known glTF representation; it is not a promise of
  pixel-identical lighting between Blender and Three.js. Unconnected scratch
  nodes do not lower the result.
- Approximated names portable details that glTF simplifies or omits. Needs Bake
  names active procedural textures, combined shaders, bump-only detail, or
  another graph feature that cannot publish faithfully as editable glTF.
  Standard/Realtime compilation surfaces non-exact results as warnings; it does
  not silently rewrite the graph or pretend it has a runtime equivalent.
- **Bake Appearance** is the explicit flattening route for a compatible
  bakeable object. Choosing it changes the material contract to the unlit atlas
  described below; **Needs Bake** never changes an object's route by itself.
  Simplifying the graph or providing an application-owned runtime material
  remain deliberate alternatives.
- An explicitly marked Website Color/Alpha constant, direct mesh color
  attribute, or supported opaque sRGB PNG/JPEG Image Texture Color may be
  compiled to an ordinary stock-glTF factor, `COLOR_0`, or
  `baseColorTexture`. The compiler separately preserves the field's active
  **surface response**: color directly owned by a portable Principled/Diffuse
  BSDF becomes core metallic-roughness PBR (`metallicFactor: 0`,
  `roughnessFactor: 0.5`), while genuine Background/Emission-only color
  remains `KHR_materials_unlit`. Automatic inference follows nested groups,
  but refuses Eevee-only Shader-to-RGB/AO convergence and non-portable BSDFs
  such as Translucent; their authored response cannot truthfully be relabeled
  ordinary PBR. Unrelated scratch nodes and independent shader branches do not
  relabel the selected field. Mixed, unsupported, or unreachable paths refuse
  unless the artist explicitly chooses the namespaced Automatic/Lit/Unlit
  setting on the existing Website Color marker. An explicit Lit/Unlit choice
  is a deliberate portable approximation. This is still a
  **selected-field** contract, not a claim that the
  complete Blender Surface graph, exact Shader-to-RGB/AO shading, authored
  shadow appearance, view transform, grain, or compositor was reproduced. A
  marked non-Mesh/Curve binding or a material binding created only by evaluated
  Geometry Nodes blocks loudly; Blendlink does not guess ownership or freeze
  it onto an unrelated source object.
- Direct image compilation accepts only clean static FILE images (packed or
  externally readable), exact sRGB/Straight interpretation, Flat/Linear/Repeat
  sampling, and an unconnected Vector input or one direct named UV Map. It
  preserves and attests the selected PNG/JPEG bytes rather than baking or
  silently converting them. Non-Color, dirty, generated/tiled/sequence/movie,
  animated, mapped/procedural-coordinate, nonopaque-alpha, and other sampling
  cases block with an artist remedy.
- A selected intrinsic Color/Value socket that has no direct portable
  representation may instead compile through a transaction-private Cycles
  Emission/Emit bake to an ordinary opaque PNG `baseColorTexture`. The
  selected socket is the contract: Blendlink does not bake the downstream
  Surface, Shader-to-RGB lighting, AO, shadows, view transform, or compositor.
  Camera/view-dependent and scene-dependent graphs therefore block before
  mutation. The private Mesh/material/image/UV state is discarded after the
  final GLB has re-attested its inferred/explicit lit-or-unlit stock material,
  PBR factors or `KHR_materials_unlit` extension, texture bytes, sampler,
  `TEXCOORD_n`, and absence of compiler-private names.
- Selected-field image sizing uses measurement model
  `selected-field-density-v1`. The current zero-configuration policy examines
  every scene-linked perspective/orthographic camera and selects the maximum
  viewport-capped sum of continuously clipped projected triangle areas. It
  does **not** union overlaps, depth-test occlusion, or count raster samples.
  The nested schema-1 object is
  `sceneDiagnostics.materialCompilation` inside this schema-v3 manifest.
  Its `gltfEvidence[*].materializationEvidence` records `projectionMetric`,
  `cameraScope`, `cameraSelection`, selected-camera identity/counts,
  `projectedTriangleAreaSum*`, and `allocatedBindingTexelArea`.
  `materializationEvidence` has no independent schema version. The historical
  `projectedCoverageFraction`, `targetProjectedPixels`, and
  `achievedProjectedPixels` fields remain unchanged compatibility aliases;
  their old names must not be interpreted as visible-pixel evidence.
- Source density records raw transformed Blender units separately from the
  artist-declared Scene Unit Scale:
  `sourceWorldAreaBlenderUnitsSquared`,
  `sourceMetersPerBlenderUnit`, `sourceWorldAreaSquareMeters`,
  `achievedTexelsPerBlenderUnit`, and
  `achievedTexelsPerSourceMeter`. Meter fields are `null` when Unit System is
  `NONE`. The legacy `achievedPxPerMeter` value remains an unchanged,
  deprecated alias of raw texels per Blender unit; it is never silently
  reinterpreted. These source facts are distinct from final glTF coordinates.
- The compiler creates and proves the delivery UV only on its private Mesh.
  It preserves a valid source layout, narrowly repairs proven collapsed
  source polygons, otherwise falls back to private Smart Project, and then
  requires complete finite bounds, injectivity, gutter, and delivery
  sampleability. The automatic fallback projects a second disposable Mesh
  through the receiver's complete world-linear transform and copies back only
  topology-validated corner UVs. This avoids directional density skew from
  non-uniform object/parent scale without changing source geometry or
  transforms. For Cycles-Emit materializations, the schema-v3 manifest path
  `sceneDiagnostics.materialCompilation.gltfEvidence[*].materializationEvidence`
  has no independent schema version; its parent
  `sceneDiagnostics.materialCompilation` object declares `schemaVersion: 1`.
  The materialization evidence records the initial complete candidate's origin in
  `uvGenerationSpace`:
  `world-linear-private-proxy` for the automatic fallback, `source-uv` for a
  retained generic source layout (including its narrow local collapsed-
  polygon rescue), or `artist-authored` for the dedicated artist-owned atlas.
  `repairCount` and `uvRepairStrategies` separately report bounded evaluated
  or post-pack corrections after that candidate was chosen. These fields are
  additive schema-1 evidence; their absence means an older schema-1 producer,
  not a guessed generation path or zero repairs. Exact zero-world-area
  triangles remain in the conservative
  layout proof but are excluded from density arithmetic. A pinned authored
  atlas retries only resolution-dependent gutter failures at the next bounded
  candidate; overlap/topology failures remain immediate, and the ceiling
  failure names the exact resolution plus the repair/unpin remedy.
- All-Appearance Baked/Hybrid output compiles selected fields only on objects
  that survive the bake's exact static-mesh ownership predicate; Appearance
  already owns the complete active Surface of other meshes. Any selected-field
  intent with a Lighting atlas blocks because Lighting retains the live base
  material and no selected-field/lightmap composition rule has been proved.
- Direct color-attribute compilation uses a disposable compiler-private VEC4
  carrier because Blender 5.2's stock exporter can whiten `COLOR_0` on a
  multi-material mesh. The compiler atomically points each generated-material
  primitive at the exact carrier accessor as standard `COLOR_0`, then removes
  every private semantic. If the application did not request custom-attribute
  export, unrelated custom semantics are stripped so this internal transport
  does not broaden application policy; an explicit application-owned request
  is retained. No `_BLENDLINK_WEB_*` semantic is a legal final artifact.
- Alpha is classified per exact object/material binding before generated
  material creation. All-one carriers emit `OPAQUE`; strictly binary zero/one
  carriers emit `MASK`; other unit-range carriers emit `BLEND`. The class is
  part of the generated-material variant key, so one source material shared by
  opaque, cutout, and blended objects is split rather than assigning every
  primitive the most expensive/least depth-safe mode. Final artifact
  attestation repeats the accessor-range and alpha-mode proof after optimizer
  transforms. This classification is compiler-owned; applications do not
  repair `transparent` or `depthWrite` after load.
- A site that deliberately replaces a completely collapsed material payload
  may declare `applicationMaterialAdapter` in scene configuration with
  `acknowledgePayloadCollapse: true` and a nonempty `description`. This is an
  application-owned deployment acknowledgement, not manifest evidence and not
  a shader compiler. During realtime planning, it converts unresolved used
  `needsBake` errors into named warnings in both JSON and human output because
  the website has explicitly accepted ownership; this is not material-fidelity
  success evidence. During Final verification, it converts only the narrow
  complete-collapse error into a loud warning naming the adapter. It neither
  changes the GLB nor removes the underlying material portability diagnostics.
  Production browser evidence is still required to prove the declared adapter
  actually runs.
- Live Preview rebuilds from the saved `.blend` (and declared inputs), not from
  unsaved depsgraph state. A successful save publishes a new atomic artifact
  set and source hash; a failed update leaves the preceding GLB and manifest in
  place so the last good browser scene remains valid.
- A glTF primitive with no material binding would otherwise receive glTF's
  implicit white metallic material, which does not match Blender's neutral
  material-less surface. After stock export, Blendlink assigns only those
  unbound primitives one shared explicit default material: linear base color
  `[0.8, 0.8, 0.8, 1]`, metallic `0`, roughness `0.5`, and double-sided. The
  generated material is marked `blendlink_generated="blender-default-material"`;
  authored material bindings and the `.blend` remain untouched.

## Baked-mode runtime contract

State and light-group textures are **8-bit sRGB-encoded PNGs** saved through
Blender's Standard view transform (a bare linear→sRGB encode; no AgX/Filmic).
A runtime loads them with `colorSpace = SRGBColorSpace`, so sampling recovers
linear values. Atlas wrapping is `ClampToEdge`.

Canonical dithered PNG and scene-linear EXR writes never borrow the artist's
scene. `bakelib.py` creates a disposable image-save scene, applies
Standard/None/0 plus the owned format/channel/depth/dither contract there,
writes the live image buffer, requires a nonempty output, and removes the stage
in `finally`. This is structural preservation: an artist scene whose active
output is FFMPEG does not need to accept a temporary PNG enum value, and its
output and color-management RNA are not mutated and then restored. Denoised
PNG output continues to use its separately owned compositor stage.

- `states` — `{ name: { url?, atlases?, default? } }`. Single-atlas scenes
  carry `url`; multi-atlas scenes carry `atlases` (atlas group → URL). Each
  mesh's group is stamped as `blendlink_atlas` in its node extras; walk
  ancestors because a multi-primitive mesh can surface it on a parent. The
  entry with `default: true` is installed when the owned recipe initializes.
  For an Appearance atlas, a finalized bootstrap (the largest bakelib tier at
  or below 1024px, or the canonical image when already smaller) is embedded
  and decoded by the GLB loader. Template v7 uses it for first paint, then
  promotes it in the background when the selected delivery policy asks for a
  larger tier. Other Appearance states and every Lighting state remain
  explicit external loads. The recipe never disposes the loader-owned
  embedded map.
- `textureVariants` maps each canonical state/light-group URL to ordered,
  verified delivery choices. `format: "png"` entries are lower-resolution
  atlases produced inside `bakelib.py`; each repeats the canonical color,
  coverage, dither/denoise, and post-lossy constant-background contract.
  Matching `format: "webp"` entries are accepted only after decoded
  dimensions, channels, and every channel byte equal the PNG. The canonical
  full PNG always remains the edit/cache/fallback authority. Every variant
  carries its own `url`, dimensions, byte count, and content hash. Compiler
  skip checks and the Blender add-on verify each advertised PNG/WebP file
  independently; a missing, malformed, or changed tier makes the published
  set stale even when the canonical atlas is intact.
- `atlasDelivery` records exact lossless-WebP input/output/saved bytes, ratio,
  embedded/sidecar entries, and loud skip reasons when WebP would grow an
  image. Lossless WebP reduces transfer bytes; it does not claim lower decoded
  GPU residency.
- `bakeOutputs` — `{ atlas: "lighting" | "appearance" }`. Missing metadata is
  the pre-0.8 **Appearance** contract; readers must never reinterpret an old
  flattened bake as a lightmap. A recipe may also declare
  `bakeOutput: "material"` on an atlas: that group bakes lit PBR surface
  pages carried inside the GLB rather than state files, is excluded from the
  published `bakeOutputs` map, and is recorded in the additive
  `materialAtlases` field instead — per group `{ channels: { kind:
  { sha256 } }, strength, hasAlpha, reused }`. Node-extra stamping
  (`blendlink_bake_output`) remains appearance/lighting-only.
- `materialPrograms` — additive schema-v3 pointer to the TSL
  material-programs sidecar published beside the GLB:
  `{ url, bytes, hash, materials }`. The runtime fetches the sidecar with
  byte-count and sha256-prefix verification, resolves each `texture_ref`
  image by basename against the sidecar URL with per-image byte/hash
  verification, and applies the programs by mesh identity on the WebGPU
  renderer family only. Absent when no compiled material carries IR.
- **Lighting** preserves the exported PBR material, its material/detail UVs,
  and maps such as base color, tangent normal, roughness, and metallic. Cycles
  bakes only diffuse indirect illumination (`direct=false`, `color=false`,
  `indirect=true`) into a separate UV channel. Node extras carry
  `blendlink_bake_output="lighting"` and `blendlink_lightmap_uv=1..3`, where
  the integer is the glTF `TEXCOORD_n`/Three texture channel. The recipe binds
  the PNG as `MeshStandardMaterial.lightMap`; realtime direct lights,
  environment/specular response, and reflections remain live.
- `stateScales` — `{ state: { atlas: scale } }`. Before an 8-bit state save,
  covered texels are divided by `max(1, p99.9 peak)`; the finite positive
  scale restores their linear range at runtime. Every Lighting atlas requires
  a scale and reconstructs through `lightMapIntensity`. New Appearance bakes
  also publish scales and reconstruct immediately after the base-map sample,
  before additive Light Groups. Omission on legacy Appearance content means
  scale `1`; it is never a valid omission for Lighting.
- **Appearance** is the legacy Combined bake. The first state replaces the
  source material with an unlit atlas; other states swap that map. It captures
  material color, direct/indirect light, and supported stylized appearance in
  one texture, so source PBR texture detail is intentionally flattened. Schema
  v3 preserves above-1.0 range with the same normalized-save/state-scale
  contract instead of clipping it before the website's tone mapper.
- `stateVisibility` — per-state exported renderable membership as stable IDs
  (legacy name fallback only when an ID is absent). It mirrors Blender's
  multi-linked collection-path behavior and is applied/restored by the owned
  baked recipe. References outside the configured export collection and
  parent/child collection arrangements whose Three visibility would cascade
  differently are blocked before publication.
  Runtime instance batches and LOD chains containing any state-controlled node
  are conservatively omitted because both adapters would otherwise compete for
  `visible` ownership and could re-show an artist-hidden object.
- `lightGroups` — `{ name: { url, maxValue } }` or `{ name: { atlases:
  { group: { url, maxValue } } } }`. Appearance layers are normalized to the
  99.9th-percentile peak and compose in linear space as
  `state × stateScale + Σ layer × maxValue × tint × strength`. Lighting-atlas Light Groups
  are not yet a supported PBR composition route; plan/final validation blocks
  that combination before Cycles and names the atlas/remedy.
- A state collection name must resolve exactly and occur once; renamed,
  missing, or duplicate names block before any visibility is mutated. Additive
  Light Groups require identical collection visibility across states because a
  globally reused layer cannot carry correct bounce/shadows for two different
  geometries. Blendlink blocks that unsafe combination and tells the artist to
  use full states instead.
- Automatic Realtime meshes include transform/parent animation,
  morphs, deformers, particles, nested glass/volume/view-dependent shader
  groups, linked alpha, and transmission. They keep real glTF materials and
  runtime lighting and are temporarily excluded as bake contributors so they
  cannot leave permanent ghosts. An explicit Baked override is honored, but
  the addon, Fidelity panel, and build warnings name what motion/view behavior
  will be frozen.
- Material, light, camera, and World property animation is not a core glTF
  animation contract. Blendlink blocks it before publication rather than
  silently dropping `KHR_animation_pointer`; animate those values in website
  code, or explicitly mark a baked mesh when freezing its material is the
  intended result.
- A working composition (`<scene>.baked.ts`) is emitted once beside the
  generated module and is owned by the user thereafter. Template v7 carries an
  explicit marker, `ready`, and transactional `setStateAsync()`: the default
  state is ready before the one-call installer attaches the root, and a failed
  later decode leaves the current state installed. It also reuses embedded
  default Appearance maps and keeps loader-owned versus recipe-owned texture
  disposal explicit. `qualityReady` exposes completion of a non-blocking
  bootstrap promotion for screenshots or transitions; ordinary first paint
  waits only for `ready`. Template v9 defaults to
  `atlasDeliveryQuality: "authored"`, selecting the highest advertised
  resolution so an artist's Final
  quality does not silently depend on the viewer's device. `"adaptive"` opts
  into selection from viewport DPR, save-data, and device-memory hints; a
  positive finite number requests the smallest advertised tier at or above that
  resolution. R3F scene components expose the same installer override as a
  per-mount `bakedAtlasDeliveryQuality` prop, allowing a developer lab to use a
  lower policy without redefining or weakening the public scene. Every policy
  prefers exact WebP, falls back through the
  same-resolution PNG and then the canonical PNG, and pre-uploads a late
  promotion when a renderer has been supplied. Sync and
  verify never overwrite an older editable recipe; `blendlink recipe update <scene>` stores
  its exact bytes in a deterministic backup before replacing the template, and
  Lighting publication is blocked until that explicit migration succeeds.
- Template v7 also gives loader-owned inactive state and light-group textures a
  reference-safe LRU budget. `createBakedScene(root, { textureCacheBytes })`
  accepts a non-negative byte count or `Infinity`; its default is 64, 128, or
  256 MiB according to save-data and device-memory hints. The estimate is the
  decoded RGBA8 image plus its full mip chain, not compressed transfer bytes.
  Active, loading, promoted-default, and application-transferred textures are
  pinned, so one visible atlas may safely exceed the budget; textures whose
  dimensions are genuinely unknown are reported by the accounting as unknown
  rather than assigned a false size. `prepare(renderer)` uploads only textures
  that can contribute to the next frame, preserving lazy GPU residency.
- Bake Lighting preflight warns when connected emissive mesh materials or a
  non-black Blender World contribute to Cycles without a portable runtime
  owner. Three emissive materials do not illuminate neighboring meshes;
  exported Blender Light objects and an assigned published HDR do. The remedy
  is named before Cycles: add the equivalent Light, publish the HDR, or use
  Appearance.
- Atlas textures use `ClampToEdge` wrapping; the atlas background is a
  constant (mean island color) so mip tails never halo — do not "clean it
  up".

### Dependency-aware rebuilds

- `bakeFingerprints` is compiler tooling state, not a runtime API. It stores a
  versioned hash for each `state:<name>:<atlas>` and
  `light:<name>:<atlas>` job. The hash conservatively covers frozen evaluated
  geometry and topology, transforms, mesh/shader attributes and source
  images, materials and nested node graphs, world and light node settings,
  evaluated collection/particle instances, ray visibility, View Layer and
  collection visibility, packed atlas UVs, normalized bake settings, relevant
  linked file bytes, bake quality, and the Blender version. Packed image tiles
  are all hashed; volatile sequence/UDIM inputs disable atlas reuse entirely.
  The compiler also hashes the shipped exporter and shared `bakelib.py`, so a
  bake-algorithm update invalidates old pixels even when the `.blend` did not
  change.
- `bakeArtifactHashes` separately records the exact PNG bytes for every
  state/light-group × atlas job. Up-to-date checks, incremental reuse, and
  Blender-free `verify` all require both dependency equality and byte
  integrity; a deleted, truncated, or hand-modified atlas is rebuilt rather
  than trusted.
- Every resolution tier is also content-hashed and participates in unchanged-
  scene integrity. Incremental reuse copies a tier set only when all required
  dimensions, paths, and bytes attest; a missing or changed tier rebuilds the
  whole safe atlas job because a flattened PNG no longer contains the source
  coverage mask needed to regenerate it correctly.
- `incrementalBake` reports the most recent decision as `totalJobs`,
  `reusedJobs`, `rebuiltJobs`, plus explicit `reused` and `rebuilt` job IDs.
  The addon presents this beside the published images so an artist can see
  whether an edit actually cost a bake.
- Reuse is exact-file reuse at the atlas-job boundary. A camera/UI/animation
  edit may reuse pixels only when it leaves packing and every render
  dependency unchanged. A missing prior file, changed dependency, or unknown
  fingerprint version rebuilds that job. False invalidation is acceptable;
  stale lighting is not.
- The cache never performs selected-object patch baking. Objects outside an
  atlas can still cast shadows or contribute bounce, so the smallest safe
  unit is one complete lighting state or light group multiplied by one atlas.
- Blender, post-export transforms, type generation, the generated module,
  manifest, and new one-time recipe all write into an owned staging directory.
  Only a complete artifact set is published, with rollback to the prior live
  set if any install step fails.

## Optimization contract

- `recipe.optimization.geometry` is `none` or `meshopt` and is authored in
  Blender. Preview and Final use the same post-export geometry stage.
- `recipe.optimization.textures` is `none` or `ktx2`. Per-image
  `blendlink_texture_compression` (`none`, `etc1s`, or `uastc`) overrides the
  scene default without exposing raw encoder flags.
- `optimization` records the applied stage, input/output/saved bytes, ratio,
  decoded world-space `maxBoundsError`, and additive `passes` evidence for
  exact animation-key resampling, bit-identical welding, safe de-duplication,
  constrained pruning, and every refused optional pass. Older schema-v3
  manifests may omit `passes`. Blendlink decodes and inspects the candidate
  before atomically replacing the GLB; scene count, rendered vertex counts,
  stable node/animation identity, authored extras, and rendered `TEXCOORD`
  values must survive. Position quantization is withheld when its corrective
  transform would replace an authored attachment or insert a child node.
- A Meshopt GLB requires the official decoder. `requiresMeshopt` records
  required `EXT_meshopt_compression` evidence directly from the decoded GLB,
  including generic external assets that have no Blendlink `optimization`
  report. `loadCompiledScene()`, `configureCompiledSceneLoader()`, and the
  one-call installer configure the decoder on Three.js `GLTFLoader` and fail
  loudly when a supplied loader cannot accept one.
- `stats` includes file bytes, triangles, meshes, embedded texture bytes,
  estimated GPU texture bytes, animation bytes, estimated draw calls, and the
  separately published exact and optimized HDR byte counts when present.
  `deliveryBytes`/`deliverySavedBytes` are included when atlas alternatives
  exist. Draw calls and GPU bytes are estimates for budget feedback, not
  profiler measurements from the final website.
- `textureTransforms` records each artist-authored maximum-size operation:
  original/published dimensions, input/output image bytes, and the enforced
  longest-edge maximum. Resizing preserves aspect and source PNG/JPEG/WebP
  format. A named override that does not match the exported GLB warns loudly.
- `textureCompression` records semantic KTX2 results: codec and decision per
  image, material slots, color space, exact input dimensions for conforming
  textures whose width and height are both multiples of four, bytes, base-level
  PSNR/channel/normal error, verified mip count, worst mip PSNR, alpha-coverage
  drift, and mip normal error. A nonconforming texture remains in its original
  uncompressed format and warns loudly; the compression stage never resizes it.
  Blendlink uses the official local Khronos tools to encode, validates every output with
  `ktx validate --gltf-basisu`, decodes every generated level with
  `ktx extract`, and refuses output below its codec, alpha, or normal fidelity
  gates before atomically replacing the GLB. Preview and Final use this
  identical stage.
- Each compressed texture may add a `rateDistortion` report. Its
  `selectedCandidate` identifies the smallest candidate that passed the full
  base-level and mip-chain semantic gates; `candidates` records the bounded,
  deterministic ETC1S/UASTC ladder with encoder settings, output bytes,
  fidelity measurements, `selected`/`passed`/`rejected` status, and an explicit
  rejection reason where applicable. This is build evidence, not a runtime
  requirement, and older schema-v3 manifests may omit it.
- Auto chooses ETC1S only for smooth opaque color. Normal, ORM/occlusion,
  alpha, and mixed-use detail textures choose UASTC. Lighting atlases listed
  in `states`/`lightGroups` are protected from KTX2 because their background
  constant must remain exact after every lossy stage.
- Internal sync publishes `blendlink-basis/` beside every GLB that contains
  KTX2 material textures (or has an optimized KTX2 environment). The GLB,
  generated contracts, `basis_transcoder.js`, `basis_transcoder.wasm`, Three's
  Basis README, and the Apache-2.0 license enter one rollback-capable publication
  transaction. Unchanged-scene skip and Blender-free `verify` compare all four
  runtime files with the installed Three peer and self-heal or fail when any is
  absent or stale.
- `installThreeCompiledScene()` derives
  `<descriptor.url directory>/blendlink-basis/`, creates and configures one
  Three `KTX2Loader`, calls `detectSupport(renderer)`, shares it across GLTF and
  environment loading, and disposes it with the installed scene. An explicitly
  supplied loader remains application-owned. The lower-level
  `loadCompiledScene(..., { ktx2Loader })` contract still requires an already
  configured shared loader.
- Generic `blendlink typegen` inspects the decoded GLB and transactionally
  publishes the same complete attributed Basis runtime beside the local GLB
  whenever `KHR_texture_basisu` is required. If deployment relocates the GLB,
  the application must mirror that sibling directory at the descriptor URL or
  supply its own configured loader.

## Animation playback contract

- `recipe.playback` is scene-owned and records `start` (`manual`, `first`,
  `named`, or `all`), `loop` (`once`, `repeat`, or `pingpong`), `speed`, and an
  exact `clip` when named. The safe default is `manual`; Blendlink does not
  guess that every exported action should start together.
- The generated module exposes `playback`. `startCompiledScenePlayback()`
  resolves the authored clips against the loaded GLB, configures a supplied
  Three-compatible mixer and loop constants, and returns `update(deltaSeconds)`
  plus `stop()`. Missing named/first clips fail with the exported names listed.
- Optional `recipe.animationSequence` selects one Blender NLA track as a slim
  authored timeline. The same validated object is copied to top-level
  `animationSequence` in the manifest/generated descriptor; any recipe/sidecar
  disagreement blocks publication. It contains a rename-stable source object,
  sequence duration/loop/speed, and ordered strip records with the exact glTF
  Action name, timeline start, zero-based Action trim, scale/speed, repeat,
  weight, Blend In/Out easing, `replace`/`add`, extrapolation, reverse, and mute.
- NLA Sequence takes precedence over simple `playback` while enabled. Runtime
  playback clones one Action per strip, seeks it deterministically, and composes
  those clips with one mixer; it is not an Animator/state-machine graph.
  Additive clones use the strip's trim start as their zero-delta reference, and
  the source clips remain untouched.
- The portable subset is intentionally strict: only non-overlapping Action
  Clip strips, Replace/Add blending, static influence/time, and
  Nothing/Hold Forward/Hold extrapolation publish. Transition/Meta strips,
  Blender-only blend modes,
  missing Action slots, render-hidden sources, stale NLA metadata, unsupported
  exporter versions, missing named clips, or trims beyond the exported clip
  fail with an artist-facing remedy rather than being approximated silently.

## Authoring Preview evidence

Top-level `authoringPreview` is copied from Blender's compiler sidecar into the
manifest and generated descriptor. It is tooling evidence, not another website
presentation recipe:

- `look` records the closest native Three.js mapping for Blender's view
  transform, exposure in stops, the source transform name, and whether that
  mapping is exact. Optional `previewExposureOffsetStops` is a separate,
  preview-only adapter correction; it never mutates the recorded Blender
  exposure or `recipe.look`. Blender 5.x AgX emits `-0.28` because Three.js's
  analytic AgX is not pixel-identical to Blender's current OCIO transform.
- Optional `warnings` names unsupported Look, gamma, display-device, curve,
  white-balance, Filmic, Raw, or unknown-transform consequences rather than
  hiding them.
- `shadows.enabled` records whether at least one Point, Spot, or Sun light that
  actually reached the completed export has Blender shadows enabled. It is a
  scene-level preview hint, not a replacement for `recipe.shadows` or
  per-object cast/receive intent.
- Optional `world` is emitted only for a finite, non-negative constant Blender
  World: either the non-node World color or one direct, active, unmuted
  Background node whose Color and Strength inputs are unlinked. `color` is
  scene-linear radiance, `strength` remains separate, and `source` is
  `world-color` or `background`. `backgroundVisible: false` means Blender
  **Film > Transparent** hides that World from the camera while its radiance can
  still illuminate physical materials.
- Top-level `worldBackgroundVisible: false` records **Film > Transparent** even
  when a procedural World cannot be classified and `world` is omitted. It gates
  only source-camera-background ownership; World lighting remains an independent
  decision and may still require a published environment or a warning.
- Optional `worldWarning` explains why a linked, procedural, ambiguous, muted,
  invalid, or otherwise unsupported World was deliberately omitted. Preview
  tools surface it only when source World ownership is needed.

Nothing consumes this evidence implicitly. The high-level Three WebGL installer
must receive `useAuthoringPreview: true`; Blendlink's private Preview Studio opts
in, while ordinary generated website integrations do not. Even when enabled,
the preview fills only fields that the published recipe leaves
application-owned. Explicit Website Look, environment, and shadow ownership
always wins. A constant World is installed as a small scene-linear
equirectangular texture so the same radiance passes through tone mapping for the
background and through Three's PBR environment response for lighting. If source
shadows are used, Preview Studio defaults only untagged render meshes to cast
and receive; explicit `blendlink_cast_shadow` / `blendlink_receive_shadow`
values remain authoritative and all preview changes are restored on disposal.

## Website look contract

- `recipe.look` distinguishes artist ownership from application ownership.
  `toneMapping` is `application`, `agx`, `neutral`, `aces`, or `none`;
  `exposure` is stored in photographic stops; `background` is `application`,
  `transparent`, or `color` with linear-sRGB `backgroundColor`.
- `applyCompiledSceneLook()` maps explicit intent onto a supplied renderer and
  scene. Exposure becomes `2^stops`. Application-owned fields remain untouched;
  transparent canvas intent refuses a known non-alpha context and requires the
  renderer's `getClearAlpha()`/`setClearAlpha()` pair; a solid color requires
  the caller's native Color constructor. The returned idempotent
  disposer restores the previous look only while its complete tone/background
  ownership group is still installed, so a later site owner is not clobbered.
  Reflection probes and post-process effects are not implied by this contract.
- `recipe.fog` is separate because it is native scene state rather than a
  renderer/composer effect. Mode is `application`, `none`, `linear`, or
  `exponential`; owned fog carries linear-sRGB color plus near/far and density
  values in Blender world units. `applyCompiledSceneFog()` is a no-op for
  application ownership, explicitly clears for `none`, and otherwise requires
  `createFog(recipe)` to return the site's native `Fog`/`FogExp2`. Its disposer
  restores prior fog unless another owner has replaced it. Native scene fog
  affects fog-enabled materials, not an HDR/transparent backdrop; matching a
  solid background color is an explicit artist choice, never an automatic edit.
- Bloom, depth of field, AO, outline, LUT grading, vignette, and the preview
  Kuwahara treatment remain portable component intent rather than native look
  fields. The standard Three WebGL installer supplies their real
  composer/render-loop lifecycle, ordering, resolution, capability fallback,
  and disposal; other renderers must provide an explicit adapter and never
  silently treat their records as native scene state.

## HDR environment and shadow contract

- Realtime Point, Spot, and Sun lights publish through Blender's stock glTF
  exporter and `KHR_lights_punctual`. Blendlink owns light export, complete
  Blender render visibility, active-Scene and active-View-Layer scope, and the
  exporter's current or legacy lighting-mode option. It requires `COMPAT`,
  matching Needle's artist-look choice and
  avoiding Blender `SPEC` mode's 683 lumens-per-watt multiplication. The Three
  runtime applies no second compensation.
- Render visibility includes an object's own Render toggle, every reachable
  scene-collection path, render-hidden ancestors, active Layer Collection
  exclusions, and nested collection-instance source paths. An object linked
  through at least one fully render-visible in-scope path may publish; otherwise
  the stock export is temporarily constrained. Blender 5.2 expands collection
  instances despite a source object's Render toggle, so a fully hidden in-scope
  source is temporarily unlinked from its exact source collections as well.
  Every flag and membership is restored. Portable glTF has no Area-light type,
  so Blendlink represents its proven Three-specific subset as the versioned
  `blendlink_rect_area_light` extra on the ordinary finalized light-object
  node; it never invents a `KHR_lights_punctual` type.
- Missing `blendlink_area_light_mode` metadata selects **Automatic** only for a
  Blender `AREA` light. Point, Spot, and Sun keep the punctual policy above. In
  Automatic, a finite static Square/Rectangle with a supported transform and
  engine semantics receives a Three `RectAreaLight` descriptor; unsupported or
  intentionally nonportable semantics remain bake-only with a named reason.
  Artists can choose **Bake Only** (`"bake-only"`) to preserve the previous
  behavior, or **Three Rect Area** (`"three-rect-area"`) to accept the diagnosed
  approximation. The explicit Three choice still refuses invalid or
  uncomputable source facts instead of guessing them. Choosing Automatic in the
  add-on removes the property; an authored `"auto"` value remains readable.
- Area compilation follows the active Blender engine. Eevee uses Light data
  color/temperature, ignores its unused Area Spread and light-node graph, and
  folds the static finite non-negative
  `scene.eevee.direct_light_intensity` into `energy * 2 ** exposure`. Cycles
  may additionally compose a directly routed constant Emission color; linked,
  grouped, or indirect routes cannot become a static descriptor. Cycles
  Emission Strength values other than the proven default `1` keep Automatic
  bake-only and make an explicit Three choice fail. Non-default Cycles Spread,
  non-default diffuse/specular factors, intermediate nonzero
  transmission/volume factors, light/shadow linking, Eevee Custom Distance,
  and Eevee direct clamp are intentional Automatic fallbacks. A positive
  default transmission/volume contribution remains a named direct-closure
  limitation; zero agrees with Three's absent path. Eevee emitters below its
  scaled half-extent product cull (`1e-5`) or half-extent clamp (`0.003 m`)
  boundaries also remain bake-only; explicit Three cannot override those
  divergent source facts.
- Automatic also falls back at the finished-artifact seam when a source comes
  only through a Collection Instance, or when the final GLB does not contain
  exactly one unambiguous node for it. An explicit Three choice makes either
  condition a blocking export error. This preserves the safe source scene
  without claiming that Blendlink proved the composed transform.
- The resulting realtime light is deliberately narrower than Eevee or Cycles:
  it is one-sided, shadowless, direct-only, and affects Three
  `MeshStandardMaterial`/`MeshPhysicalMaterial` receivers. It does not reproduce
  indirect bounce, volumes, renderer sampling, independent closure factors,
  linking, or Eevee's finite distance fade. The default Eevee Light Threshold
  fade, authored shadows, default direct transmission/volume closure, and the
  two renderers' differing LTC horizon/facing behavior remain named semantic
  approximations; Three continues geometric falloff. Installed-source and
  package tests verify the engine policy and transactional ordering. The
  retained focused browser fixture verifies material selection, direction, LTC
  upload/fallback, and lifecycle. After replacing its deadlock-prone dynamic
  LTC split with a static official initializer import, a freshly packed current
  package also passed Cube's production Vite HTTP/hash/WebGL/nonblank/error
  gates. LTC allocation/upload remain descriptor-lazy. These complementary
  browser results are not a Blender-to-browser image-parity claim.
  The static import makes the similar total Area payload eagerly resident even
  when no descriptor exists; no-descriptor scenes still avoid LTC texture
  initialization and GPU upload. Measuring and safely isolating the no-Area
  payload remains future architecture work.
- Runtime installation refuses a RectArea descriptor over a Lighting atlas
  until the compiled artifact carries per-light bake-exclusion evidence. This
  happens before LTC allocation and prevents probable double illumination.
  Keep that light Bake Only, use Appearance for static baked receivers plus
  explicit live PBR exceptions, or author a portable Point/Spot/Sun light.
- Blender-side `lightDiagnostics` is compiler/tooling evidence from the same
  canonical policy used to configure export. It classifies every Light as
  `exact`, `approximated`, or `notExported`, records visibility and expected web
  units when they can be predicted, and distinguishes the artist outcomes
  `exact`, `approximated`, `bakeOnly`, and `notPublished` with a remedy. The
  Light Data Properties panel reads the cached live form; the completed export
  form also accounts for the actual collection/selection export scope and
  diagnoses source Light objects reached only through collection instances
  exactly once. For Automatic Area lights, its completed form also records a
  source-policy or finalized-artifact bake-only fallback instead of describing
  a descriptor that was not attached. Ordinary Cycles Point/Spot node defaults
  still export from data
  Energy; Light Falloff can own their strength, and a direct Sun Emission can
  own Sun strength. Linked procedural routing and active node-group boundaries
  therefore withhold numeric predictions. Emitter radius/Sun angle,
  contribution controls, shadow/linking controls, and other fields without a
  portable punctual-light representation must not be inferred from a successful
  GLB export.

- `recipe.environment` separates asset ownership (`source`) from image-based
  `lighting` and the visible `background`. Each can remain application-owned;
  image lighting/background requires the separately published `environment`
  manifest asset. Strength and Y rotation are independent. `grounded` also
  carries capture height and backdrop radius. The standard Three installer
  centers the projection over visible meshes beneath the compiled root and
  places its floor at their minimum Y. Hidden subtrees, UI, and objects with
  `blendlink_auto_fit = false` do not affect the fit; application-owned scene
  siblings are never included.
- `environment` always records the public byte-exact `.hdr`/`.exr` URL,
  original Blender image name, bytes, content hash/cache key, and whether the
  unchanged payload came from a `packed` or `linked` image. Linked sources
  force compilation even when `.blend` bytes have not changed, preventing a
  stale external HDR from passing the cache.
- With KTX2 Auto enabled, `environment.optimized` may additionally record a
  standard `B10G11R11_UFLOAT_PACK32` KTX2 with Zstd supercompression. It is a
  derivative, never the only copy. The entry includes encoder/version,
  Three.js compatibility floor, bytes/hash, dimensions, and the measurements
  from decoding the KTX2 back to scene-linear EXR. The optimized derivative is
  rejected (while the byte-exact HDR/EXR still publishes) if
  relative RMSE exceeds 2.5%, mean relative error 1.25%, highlight peak error
  5%, maximum error/source peak 5%, or log-luminance RMSE 0.08 stops; signed
  or non-finite sources remain on the exact HDR/EXR path.
- `applyCompiledSceneEnvironment()` conditionally prefers `optimized` only
  when its adapter supplies the configured Three r184 `KTX2Loader` and
  `THREE.LinearFilter` (the high-level installer supplies both automatically).
  Three conservatively gives raw packed-float KTX2
  DataTextures nearest filtering, so the adapter explicitly restores linear
  minification/magnification before assigning the environment. Missing either
  prerequisite selects the exact HDR/EXR; a missing filter or KTX2 load error
  is reported through `onWarning` (or `console.warn`) before the exact source
  is loaded. The adapter assigns equirectangular lighting/background, applies
  current Three scene intensity/rotation fields, and reports whether the
  optimized or original asset won. It validates and loads before scene
  mutation, rolls back a failed application, and returns an idempotent disposer
  that conditionally restores prior fields and releases only resources it still
  owns. Grounded backgrounds require a small `GroundedSkybox` constructor
  callback; adapters that allocate geometry/materials can also provide its
  matching disposal callback. Modern Three renderers perform the equirectangular
  environment conversion used by physical materials.
- `recipe.shadows` records both the artist preset and its resolved portable
  budget: filter, map size, maximum camera reach, bias, normal bias, softness,
  and automatic-update intent. `applyCompiledSceneShadows()` configures the
  renderer plus every exported shadow-capable light and reports the upper-bound
  square shadow pixels. `application` changes nothing; `off` disables maps.
- Node extras still own per-object cast/receive intent. Because
  `KHR_lights_punctual` has no shadow flag, post-export normalization carries a
  native Blender Light with **Shadows** off as
  `blendlink_cast_shadow=false` on that light node; an explicitly authored
  namespaced value wins. The final-GLB pass resolves ordinary and
  collection-instanced source lights before making that decision and never
  authors the extra back into Blender. A scene budget never silently changes
  those decisions.

## Local reflection-probe contract

- `recipe.reflectionProbes` is the named capture inventory. Every entry has an
  ergonomic slug `id`, rename-stable helper `objectId`, helper name, box/sphere
  influence preview, `source` (`runtime`, `baked`, or `custom`), cubemap-face
  `resolution`, Blender-bake `samples`, influence distance, reflection
  intensity, and an optional rename-stable capture/parallax anchor. `baked`
  and `custom` records also carry `texture` evidence: Blender `imageName`,
  decoded 2:1 `width`/`height`, `format`, and `colorSpace`. Baked evidence adds
  `sourceHash` (the conservative scene, origin, resolution, samples, explicit
  receiver-exclusion membership, Blender, and bake-contract fingerprint) and
  `contentHash` (the exact EXR bytes). The
  generated module exposes `reflectionProbes`, `reflectionProbeAssignments`,
  and a literal `*ReflectionProbeId` type.
- `reflectionProbeAssets` is the separately published source map keyed by
  probe `id`; runtime probes intentionally have no entry. Each asset contains
  `{ url, sourceName, mode, format, colorSpace, width, height, bytes, hash,
  source, sourceHash? }`. `source` says whether the Blender image bytes were
  packed or linked; `hash` versions the generated-module URL and participates
  in addon/CI drift checks. A baked asset's `sourceHash` must match its recipe
  evidence. Unknown assets, runtime assets, missing non-runtime assets, mode
  mismatches, changed bytes, changed dimensions/format/color space, and stale
  baked dependencies fail before publication.
- Blender Bake renders a scene-linear Cycles panorama at `4 × resolution` by
  `2 × resolution`, using the authored sample budget and a lossless half-float
  ZIP OpenEXR. This angular sampling retains the detail promised by the
  cubemap-face control instead of writing Needle 1.4.2's `R × R/2` panorama.
  This is the one narrow exception to Eevee source-of-truth: Blender 5.2's
  Eevee panoramic operator reports success while rendering one
  perspective-like face, so offline probes use Cycles even when Eevee owns the
  visible scene. A reachable known Shader to RGB contributor refuses capture
  with a Custom Texture remedy; that diagnostic is not presented as complete
  Eevee/Cycles compatibility. The canonical bake-device policy selects one
  exact GPU backend with CPU fallback and reports only its privacy-safe broad
  class/backend. The save forces Standard/None/0, hides every explicit assigned
  receiver, and restores receiver visibility, the artist's camera, renderer,
  dimensions, output, transparency, Cycles samples/device/compute
  backend/device-enable flags, color management, selection, render policy, and
  camera datablocks on success or failure. Compositing, Sequencer, stamps,
  border crop, multiview, simplify, Freestyle, and motion blur are disabled
  only for the capture so a camera/post-production choice cannot contaminate
  local scene radiance or change its dimensions. A batch renders and
  byte-attests every staged EXR before replacing any prior file. It then
  installs the batch with sibling backups and decode-validates dimensions and
  format; file, RNA, and image rollback make **Bake All** one transaction.
  Owned files live below
  `//blendlink-derived/reflection-probes/`; arbitrary output paths are refused.
- Custom Texture accepts one exact 2:1 HDR, EXR, PNG, JPEG, or WebP source from
  32×16 through the portable 8192×4096 ceiling.
  HDR/EXR is linear; LDR follows the Blender image color-space declaration.
  Blendlink copies linked or packed source bytes rather than resaving them, so
  artist detail is not silently requantized. It does not currently compress
  reflection sources or prepublish PMREM mip chains.
- Mesh extras use `blendlink_reflection_probe` = the probe helper's stable
  object ID. Membership is always explicit. Influence volumes do **not**
  silently reassign meshes or blend overlapping probes; ordinary Three PBR
  materials have one local `envMap`, so overlap policy belongs in a custom
  renderer adapter.
- `applyCompiledSceneReflectionProbes()` accepts ready cubemap/PMREM resources
  keyed by generated probe ID, a `capture(context)` implementation for runtime
  probes, or `loadTexture(asset, context)` for published baked/custom sources.
  Source modes never silently substitute for one another. The
  context contains the probe helper, optional anchor, explicit member objects,
  face resolution, and influence. A Three implementation may use
  [`PMREMGenerator.fromScene()`](https://threejs.org/docs/pages/PMREMGenerator.html)
  with the authored size/position, or
  [`CubeCamera`](https://threejs.org/docs/pages/CubeCamera.html) followed by
  `PMREMGenerator.fromCubemap()`. For standard Three WebGL,
  `createThreeWebGLReflectionCapture({ THREE, renderer, scene })` provides that
  callback directly, honors face resolution/anchor/capture planes, hides every
  explicit assigned receiver for the one-shot CubeCamera update, restores
  receiver visibility even when capture fails, disposes temporary cube
  resources immediately, and keeps the PMREM owned by the returned probe
  handle.
- `installThreeCompiledScene()` supplies the standard published-source loader
  automatically. It uses Three's HDR/EXR/ordinary texture loaders according to
  manifest evidence, rejects a decoded dimension mismatch, applies the
  declared linear/sRGB space, converts the equirectangular source with
  `PMREMGenerator.fromEquirectangular()`, disposes the source and generator,
  and keeps only the returned PMREM target under the installed scene's
  ownership. The lower renderer-neutral seam keeps `loadTexture` explicit.
- The default assignment path clones each assigned material before setting its
  [`envMap`](https://threejs.org/docs/pages/MeshStandardMaterial.html), strength,
  and update flag, then restores originals on dispose. It refuses materials
  that cannot be cloned or do not expose `envMap`; node materials, box-projected
  parallax, and other renderers use the explicit `assignTexture()` seam.
- Baked-recipe template v7 owns the material-clone handoff, embedded bootstrap,
  and background detail promotion. Its
  `trackMaterialClone(source, clone)` seam registers reflection-created clones
  with state-map/light-map updates and independently reinstalls Appearance
  Light Group shader uniforms, which Three's ordinary `Material.clone()` does
  not copy. Reflection disposal unregisters before baked disposal; a clone
  adopted by a later application owner keeps every baked/PMREM resource it
  still references. Older editable recipes fail with the explicit
  `blendlink recipe update <scene>` migration instead of silently freezing an
  assigned mesh on the default state.
- Unused probes do not allocate or capture a texture and are returned in the
  runtime report. Stale assignments, missing helpers/anchors, missing textures,
  and unsupported default materials fail loudly.
- Influence shapes are visible authoring/consequence guides, not a promise of
  local-probe interpolation. Core assignment remains one explicit env map per
  mesh. Textured spatial probe-sphere preview, overlap blending, and
  box-projected parallax remain application/custom-adapter work; the panel
  provides a source thumbnail and exact evidence instead of implying those
  unsupported runtime semantics.

## LOD, instancing, procedural, and material diagnostics

In `<scene>.manifest.json`, `sceneDiagnostics` is the compiler's complete
portable evidence, not a collection of advisory booleans. The manifest keeps
the complete procedural snapshot evidence—including every frame of an
exhaustive audit—and the material, camera, LOD, and instancing audit details
used by Blendlink's tooling.

The generated `<scene>.gen.ts` binding deliberately does not copy that full
tooling record into application JavaScript. It exposes the independent,
browser-safe `runtimeDiagnostics` contract instead. Version 1 contains only
`{ schemaVersion: 1, lodChains, instanceGroups }`, the evidence required by
the optional LOD and native Three instancing adapters. Procedural frame
samples, material portability records, material-compilation attestations,
camera audit details, GPU-batch inventory, and summary counters remain in the
manifest.

`resolveRuntimeSceneDiagnostics()` is the one compatibility seam used by both
runtime adapters. When `runtimeDiagnostics` is defined, that value is
authoritative: version 1 is validated, malformed arrays and unknown versions
fail loudly, and the resolver never falls back to possibly stale legacy data.
An explicit `null` also disables the legacy fallback. If the new property is
absent, a current runtime may still project
`lod.chains` and `instances.groups` from an older generated binding's full
`sceneDiagnostics`. New bindings omit that deprecated field. Upgrade the
Blendlink package and regenerate bindings together; an older runtime does not
understand the new versioned property.

The full manifest evidence includes:

- `lod.chains[]` resolves each `_LODn` member to its Three-loaded name and
  rename-stable object ID, validates LOD0, strictly increasing distances, and
  coincident origins, and records `drawCallsWithoutAdapter` versus the
  worst-case `drawCallsWithAdapter`. `startCompiledSceneLods()` owns only
  visibility, never reparents the authored hierarchy, applies a configurable
  hysteresis dead band, and restores previous visibility on `stop()`. Pass
  `createVector3: () => new THREE.Vector3()` and call `update()` after camera
  movement. This implements the same distance outcome as
  [Three LOD](https://threejs.org/docs/pages/LOD.html) while preserving stable
  Blendlink object bindings.
- `instances.groups[]` identifies Blender objects that share one mesh data block.
  Every member retains its stable ID. `drawCallsSeparate` states the estimated current
  consequence; `drawCallsInstanced` and `drawCallsSaved` state the potential
  batch consequence; `eligible` and `reasons` apply Blender's parent, child,
  material, animation, and evaluated-geometry constraints. Shared glTF mesh data
  saves payload/VRAM but is not itself GPU instancing. `gpuBatches[]` separately
  inventories extension batches actually present in the GLB, including count,
  primitive draws, and instance semantics. Blendlink does not auto-merge stable
  objects because [`EXT_mesh_gpu_instancing`](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_mesh_gpu_instancing/README.md)
  has no standard individual-instance animation/material contract and batching
  changes hierarchy and culling behavior. `applyCompiledSceneInstances()` is
  the explicit native-Three route: pass
  `createInstancedMesh: (geometry, material, count) => new THREE.InstancedMesh(...)`.
  Eligible originals remain hidden in their authored hierarchy so generated
  object bindings still work; `resolveInstance(batch, instanceId)` maps a
  raycaster hit to its stable ID/name/object, `update()` recopies local
  transforms, and `stop()` removes/disposes batches and restores visibility.
- `procedural.objects[]` carries the source mesh, evaluated frame samples,
  topology/position hashes, vertex and triangle delta, nested Geometry Nodes
  dependencies, exhaustive-audit flag, route, reason, and finite-cache byte
  estimate. Time-dependent ranges up to 120 frames are checked at every integer
  frame. A changing topology, Simulation Zone, unproven/oversized range, or
  camera-culling dependency for a movable web camera blocks export. The one
  exception is an exact active-camera match owned by a Fixed website camera.
  This is deliberate: core glTF animation targets TRS or fixed-topology morph
  weights, and [morph accessors must retain the base accessor count](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#meshes).
- `materials.records[]` preserves the Blender-side active-Surface result for
  each material in the actual export scope: Exact glTF, Approximated, or
  Needs Bake;
  its reasons and source-object usage; and an independent
  `cyclesAppearance` compatibility result. In particular, Shader to RGB is
  EEVEE-only: it can require materialization while also being impossible for
  Blendlink's current Cycles Appearance route to evaluate. The summary counts
  include `cyclesAppearanceBlocked`. This field is additive schema-v3 evidence
  and may be absent on an older schema-v3 manifest. Export-scope analysis uses
  the same active View Layer, collection/selection, and render-visibility gates
  as glTF export, while retaining source objects referenced by visible
  collection instances; excluded objects cannot pollute the advisory.
- `materialCompilation` is additive schema-v3 evidence with its own exact
  `schemaVersion: 1`. Its reader accepts only the numeric value `1`; an absent,
  string, or newer value refuses with a regeneration remedy instead of being
  cast as current evidence. It carries a `sourceFingerprint`, sorted
  source/generated material inventories, and one `gltfEvidence` record per
  lowered material. Each record binds source and generated material names,
  transport (`factor`, `vertexColor`, `image`, `channels` for per-channel
  Material bakes, or `program` for TSL program carriers), `surfaceResponse`
  (`lit`/`unlit`), boolean unlit status, primitive count, source object/slot
  bindings, base-color factor, alpha mode, and double-sided state. A record
  may additionally carry `emittedMaterial` — the name that actually shipped,
  differing from `generatedMaterial` only for composed lighting-owned
  carriers whose lighting fork is the exported material; verification
  matches on it when present. Lit records
  additionally attest core-PBR metallic and roughness factors; unlit records
  attest `KHR_materials_unlit`. Vertex-color records additionally carry `color0`,
  `color0Type`, aggregate `color0Min`/`color0Max`, and a storage-derived
  tolerance. Evidence is emitted only after Blender has proved exactly one
  generated material, no shipped source fallback, binding/mesh ownership, and
  primitive use. Vertex routes also prove matching POSITION/color counts,
  supported finite VEC4 storage, and the selected numeric range.
- A lowered record may add `surfaceFactorization` only for the exactly
  recognized `selected-intrinsic-static-shade-floor-v1` family. The record
  carries static `shadeValue`/`shadeColor`, a structural `proofHash`, the
  planned base/emissive factors, `textureOwnership:
  "sharedBaseAndEmissive"`, exact terms (`selectedIntrinsic`,
  `staticShadeFloor`), and the explicitly approximate
  `shaderToRgbDirectResponseAsMetallicRoughness` term. This is a bounded stock
  carrier, not a claim that arbitrary Shader-to-RGB, AO, translucent, or
  view-dependent response was compiled.
- Its `gltfEvidence` adds the exact emissive factor, image
  SHA-256/MIME/dimensions, sampler, texCoord, UV values and
  geometry-association proof, plus
  `textureNormalization.model: "stock-gltf-shared-texture-v1"`. The Base Color
  and Emission evidence must describe the same selected-intrinsic image,
  sampler, texCoord, and UV association. Blender-export texture indices are
  retained only as normalization provenance; the final glTF-Transform
  verifier proves object identity directly and refuses a byte-identical second
  Texture object, factor drift, sampler/texCoord drift, or material/TextureInfo
  extensions outside the proof.
- Three's `GLTFLoader` may clone that one glTF Texture once per material slot
  when `texCoord > 0`. Before prewarm, the standard Blendlink Three installer
  recognizes only the attested
  `blendlink.lit.selected-field-static-shade-floor` generated-material rule,
  proves the loaded Base Color and Emission textures share one decoded source
  and identical channel/sampler/color-space/transform/upload contracts, then
  rejoins them. The lease restores the original loader clone on disposal and
  does not overwrite a later application-owned material change. A mismatch
  refuses installation rather than silently allocating or sampling two
  different contracts.
- Current producers add
  `attestationModel: "primitive-corner-v1"` at the
  `materialCompilation` level. An absent marker identifies legacy schema-1
  evidence; an unknown marker refuses loudly. Legacy evidence proves generated
  material use on the expected emitted meshes, but its `Object[slot]` label
  does not prove a primitive ordinal and its image `uvHash` covers only the
  distinct float32 UV value set. A same-mesh material move or a same-set corner
  permutation can therefore be outside the legacy proof. These semantics are
  retained only so an older schema-1 artifact is not silently reinterpreted.
- Under `primitive-corner-v1`, every `gltfEvidence` record has
  `bindingPrimitives`. It contains exactly one entry for every existing
  `bindings` label and every emitted node occurrence of that object name. Each
  occurrence records the exact emitted glTF mesh index and sorted primitive
  ordinals on that mesh that use the generated material. The ordinals are read
  from Blender's staged GLB after export; they are never inferred from the
  Blender material-slot number. Missing, duplicate, extra, moved, or
  no-longer-material-bound references refuse at final verification.
- Current image records retain the legacy SHA-256/MIME/dimensions, normalized
  sampler, texCoord, and aggregate UV fields for schema-1 compatibility, and
  additionally require `uvGeometryAssociation`:
  `{ algorithm: "mesh-position14-uv-triangles-v1", hash, triangleCount,
  positionGrids }`. This is a rendered-triangle corner-association proof, not
  merely a UV-value inventory:

  1. Each affected glTF mesh records one 14-bit POSITION grid
     `{ mesh, bits: 14, offset: [x,y,z], scale }`. The grid is computed from
     the full emitted mesh, not only the selected material's primitives. Its
     bounds include base POSITION accessors and the origin/doubled extrema
     required by glTF-Transform's relative morph-POSITION quantization volume.
     `offset` is the bounds midpoint and `scale` is the largest axis
     half-extent. Persisting this pre-optimization grid lets the final verifier
     reproduce the same signed position codes after optional normalized-SHORT
     POSITION quantization.
  2. For every rendered TRIANGLES corner, the canonical record stores three
     little-endian signed 16-bit position codes followed by two little-endian
     float32 UV values. One triangle record is 42 bytes. Only cyclic corner
     rotations are canonicalized; winding reversal remains a different fact.
  3. Each triangle digest is
     `SHA-256("blendlink:uv-geometry-triangle:v1\0" || primitiveHeader ||
     canonicalTriangle)`. `primitiveHeader` is four little-endian uint32
     values: mesh index, primitive ordinal, mode, and texCoord.
  4. The association header begins with little-endian uint32 texCoord and grid
     count. Grids are sorted by mesh index; each contributes uint32 mesh index,
     three float64 offsets, float64 scale, and uint32 bits. The final hash is
     `SHA-256("blendlink:uv-geometry-association:v1\0" ||
     associationHeader || uint64LE(triangleCount) ||
     lexicographicallySortedTriangleDigests)`.

  Triangle digests are sorted in 65,536-record runs and merged from one owned
  temporary directory, so large receivers do not require retaining every
  triangle digest in memory. The ordinary cryptographic multiset hash preserves
  multiplicity; Blendlink does not substitute a collision-weaker XOR or sum.
  Reordering triangles or vertices and welding identical attribute rows can
  preserve the proof, while moving material ownership, changing winding,
  changing a POSITION/UV corner association, or changing triangle
  multiplicity cannot.
- Blender emits the attestation from its staged, stock-glTF GLB before the
  Node optimizer runs. Before manifest publication,
  `verifyMaterialCompilationEvidence()` repeats generated/source material
  identity, surface-response/extension/PBR-factor state,
  factor/alpha/double-sided state, exact primitive ownership, primitive count,
  `COLOR_0` presence/type/count, finite values, aggregate numeric min/max, and
  (for images) exact bytes, MIME, dimensions, sampler, texCoord, and
  geometry-associated UV proof against the fully transformed Document after
  resize, KTX2, and optional Meshopt. It also refuses leaked compiler-private
  semantics. This proves that the emitted selected-field payload survived
  Blendlink's optimizer transaction. It does **not** prove a Blender
  source-loop identity, GPU upload, shader sampling, or browser pixels; those
  require their own source/Blender/browser fixtures.

`auditCompiledSceneArtifact({ manifest, glbBytes })` is the exact final-GLB
diagnostic seam. It verifies the manifest hash/byte count, decodes required
Meshopt streams, reports all unique decoded accessor bytes separately from the
geometry-accessor subset, counts embedded image bytes, attributes rendered
triangles and decoded geometry bytes to default-scene nodes and meshes with
separate dominance rankings, and
inspects the raw material JSON without turning omitted glTF defaults into
authored values. `blendlink perf` uses this evidence only when explicitly run;
save-driven Preview does not repeatedly parse a large finished artifact.

The same staged audit refuses publication when the exact final default scene
contains no renderable mesh primitives. Cameras, lights, Worlds, helpers, and
mesh definitions reachable only from another library scene do not satisfy the
gate; visible point and line primitives do, so triangle count is not used as a
proxy. The audit runs after collection/export filtering, evaluated modifiers,
and optimizers but before atomic publication. Intentional helper or asset-
library `.blend` files remain available to `blendlink plan` without being
misrepresented as publishable website scenes.

Final verification blocks the narrow complete-collapse condition: every used
exported material maps unambiguously to Needs Bake, all rendered triangles are
affected, and the GLB supplies no meaningful PBR factor/texture, emissive,
unlit, or material-extension payload. It does not reject a Needs Bake material
that still publishes a deliberate useful approximation. The error groups
repeated source graphs by their reasons, weights them by rendered triangles,
and names a Cycles-bake blocker when present. `applicationMaterialAdapter` may
explicitly acknowledge this one condition as described above; without it the
condition blocks. Integrity and artistic fidelity remain distinct: a hash-valid
GLB can still be an unacceptable publication.

## Authored properties

All blendlink-authored custom properties are namespaced `blendlink_*`
(`blendlink_role`, `blendlink_mass`, `blendlink_texel_weight`, …). Bare
legacy names are still read with a deprecation warning until 1.0.

The optional runtime adapter applies these portable node extras when present:

- `blendlink_active` → initial `Object3D.visible`;
- `blendlink_cast_shadow` → `Object3D.castShadow`;
- `blendlink_receive_shadow` → `Object3D.receiveShadow`.
- `blendlink_reflection_probe` → rename-stable local reflection-probe
  assignment consumed by `applyCompiledSceneReflectionProbes()`.

Missing shadow extras mean “application default” in production; Blendlink does
not silently enable renderer shadow maps or choose light-level shadow budgets.
The one exception is the explicitly opted-in private authoring preview described
above, which may default otherwise-untagged render meshes while it owns the
complete disposable preview installation.

## Node names

`nodes` keys are the names **three.js reports after load** (the loader
sanitizes: whitespace → `_`; `[ ] % $ . : /` stripped). Because Three's
private unique-name allocator is not a portable API, scene/node and node/node
post-sanitization collisions block with a Blender rename action instead of
guessing a suffix. Runtime binders traverse `userData.blendlink_id` directly
and reject duplicate IDs; loader names are only a readable fallback.
The vocabulary (colliders, anchors, LODs) parses the authored names, so
`.NNN` duplicate tolerance still applies at parse time. During binding,
`-colonly`/`-convcolonly` nodes are set invisible after extras are applied, but
remain indexed with their geometry intact for the application's physics adapter.

## Diagnostics

`bakePlan`, `bakeFingerprints`, `incrementalBake`, `lastSyncDurationMs`, and
`draft` are tooling state riding along for the addon; runtimes should ignore
them.

`bakePlan.atlasLayout` is a versioned `f32le-zlib-base64` snapshot of Blender's
exact packed corner UVs, in Blender loop order, with an object ID/name, atlas,
loop count, topology hash, and UV-byte hash per mesh. Plan-only output is marked
`space: blender-pack`. A published manifest is marked
`space: final-glb-decoded` only after every distinct Float32 UV pair is found
unchanged in the decoded post-Meshopt accessor (accounting for Blender glTF's
deterministic `v -> 1-v` conversion). TEXCOORD accessors therefore stay
lossless Float32; there is no UV quantization to hide. This is value-survival
attestation, not an inferred per-corner mapping through glTF vertex splitting;
the exporter and optimizer preserve attribute-row association, while the
recorded topology hash prevents applying the loop-ordered payload to a changed
source mesh. The addon accepts only final-attested evidence and never reruns
Blender's UV packer. If topology differs, linked instances need different
packs, or a final accessor cannot be attested, the record appears in
`unavailable` and the addon refuses an approximation; saved atlas pixels remain
inspectable.

Materializing that evidence is an all-or-nothing edit across the selected
meshes. UV-layer capacity and exact authored-name ownership are checked before
mutation, existing authored layers are snapshotted, and any creation/write
failure restores every selected mesh; an operator failure never leaves a
partially materialized selection, a silently suffixed layer, or deleted artist
pins and generic mesh attributes.

Before either a plan or a final bake can proceed, Blendlink expands authored
pins to Blender's complete locked islands and validates the staged UV geometry.
Pinned coordinates must be finite and inside the 0..1 bake square; every
triangulated face must retain positive UV area. Positive-area intersections
block between islands, between objects, and within a folded/stacked island.
Distinct locked islands must also retain the configured
bake/mipmap gutter between their true triangulated boundaries and from every
atlas edge. A manifold-disk proof uses a balanced boundary-event tree to handle
dense, consistently oriented islands without a triangle-pair scan; collapsed,
complex, or non-manifold islands fail or fall back to a per-island
triangle hierarchy; a separate 2D island hierarchy finds only bounds close
enough to overlap or violate the gutter. Neither hierarchy approximates the
final intersection or distance tests. Touching triangle boundaries remain
legal only within one valid UV island. These are
`bakePlan.errors`, not warnings, and direct final-bake entry points repeat the
gate before Cycles.

Each bake-plan atlas may include `targetDensity`, `achievedDensity`,
`targetAchievement`, `requiredOccupancy`, `paddingPx`, and `fitPolicy`.
The artist-facing name for `targetDensity` is **Minimum Detail**: it is the
lowest acceptable packed density used by validation, not a request to discard
available atlas space or cap a successful pack. `estimatedGpuBytesRgba8Mipmapped`
reports the exact full RGBA8 mip-chain allocation for that atlas, while the
plan-level `estimatedActiveAtlasGpuBytesRgba8Mipmapped` sums the initially active
atlas set. These are uncompressed GPU residency estimates, not transfer bytes.

When a Fixed presentation camera and responsive compositions are available,
objects and atlas summaries may also include `compositionDetail`. Its
`atlasTexelsPerCssPixelAt1x` and `atlasTexelsPerDevicePixelAt2x` values are
projection-derived evidence for the worst declared composition. Values below
one warn that the atlas cannot supply one source texel per corresponding screen
pixel for that object. This is a composition diagnostic, not a universal
perceptual-quality score; runtime camera movement can invalidate it.

`errors` is the list that blocks a final bake;
plan-only runs return it so Blender can explain the remedy before Cycles work.
Preview-quality compilation may turn an authored `block` into an effective
`scale` for that disposable build only. The bake-plan warning is prefixed
`Preview only — Scale to Fit`; the embedded recipe remains unchanged, and a
Final build continues to block until the artist fixes the layout or explicitly
chooses Scale to Fit.
