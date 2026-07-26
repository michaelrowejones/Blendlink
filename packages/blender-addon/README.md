# Blendlink — Blender companion addon

Artist workspace for [blendlink](../../README.md). **Set Up Blendlink Scene**
creates a scene-owned Web Presentation with Hybrid/Realtime/Fully Baked modes,
the undeletable Main atlas, selected-object atlas exceptions, preview/final
quality, lighting states, a Website Camera, Responsive Frames,
and stable IDs. **Preview Website** compiles Preview quality and opens the real
website when one is connected. With no connection it creates or reuses a
private, per-scene Preview Studio instead, so an artist can inspect a saved
`.blend` without first creating a web project. That one action also starts Live
Preview for either route: saving the `.blend` recompiles the affected Preview
scene and refreshes the website. It does not stream unsaved depsgraph edits.
If a saved update cannot export, the last good browser scene remains open while
the addon shows the error and links its log. **Publish Website** remains a
separate, deliberate Final compile, verification, and website-build action;
export mechanics remain in the CLI.
The private Preview Studio also fills application-owned presentation gaps from
the saved Blender scene: supported view transforms and exposure, one safely
constant World, and source shadow presence. The World lights PBR materials and
is tone-mapped as the backdrop; **Film > Transparent** keeps the backdrop clear
without discarding that illumination. Linked/procedural Worlds and unsupported
display settings warn instead of being guessed. This behavior is preview-only;
authored Website Look, HDR environment, shadow policy, and explicit object
shadow intent remain authoritative, and ordinary generated site integration
does not enable authoring evidence automatically. Blender 5.x OCIO AgX is
newer than Three.js's analytic AgX approximation, so Preview Studio applies a
measured, separately recorded `-0.28`-stop correction without changing Blender
exposure or a published website recipe.
Preview quality can temporarily Scale to Fit an overfull atlas with a visible
warning. Publish Website continues to enforce the artist's Stop and Explain policy.
The first private preview may take longer while its isolated viewer installs;
later previews reuse it. Setup, install, compile, and server failures remain
separate in the visible progress/log flow instead of collapsing into a silent
button failure.

The sidebar is a compact, state-driven publish loop. It presents one best next
step—scene setup, saving, preview, or opening the current website—plus **Check
Atlas Fit** and **Publish Website**. Blender never guesses or changes an artist's
repository. Preview Studio may install only its own disposable cached viewer;
connecting a production site remains a deliberate `npx blendlink connect` action
run from that website folder. **More Tools** keeps **Open Website Folder** and
the build/server logs close to that loop. Canonical intent is stored once in
native Scene, World, Object, and Material data. Component cards in the sidebar
and Properties contexts edit the same Scene-owned collection rather than
maintaining duplicate settings. **Blendlink Web Object** keeps
Automatic/Realtime/Baked visible as a
three-way choice, shows truthful editable-selection counts, and explains the
effective result. Atlas and Web Checks failures are wrapped into
consequence/remedy cards with named Select/Fix actions.

**Website Effects & Behaviors** in Scene Properties and **Web Behaviors** in
Object Properties add website behavior with outcome-first controls instead of a
generic script list. The sidebar's **Effects & Behaviors** view keeps **Add
Scene Effect** and **Add Behavior to Selection** close to the current selection.
Scene effects include Bloom and Vignette. Object behaviors include Keep Visible
Through Objects, Open Link on Click, Emphasize on Hover, Start Hidden, Look At
Object, Website Surface, Play Animation on Click, Audio Source, and Play Audio on Click.
Components are enabled/disabled without losing their settings, target
rename-stable scene objects, and show their runtime consequence in the card.
The categorized browser opens ready to type and searches task language across
names, categories, descriptions, compatibility, consequence, and keywords;
each result also shows cost and target readiness. Card actions copy values,
copy as new, paste as new, or batch-paste values through safe versioned JSON.
Unknown extension fields survive, while
every changed, already-matching, incompatible, missing, or failed target is
reported; malformed types and unresolved references never coerce silently.
The same read-only validator feeds cards, Web Checks, and publish preflight,
and disabled cards remain editable. Spatial Audio uses literal **Full Volume
Within** and **Silent Beyond** radii; the Three adapter selects linear full
rolloff so the outer radius is genuinely silent.

Use **Website Surface** when an artist-authored monitor, display, or sign needs
pixels supplied by the website. Separate those faces into one ordinary Mesh
with one material, unwrap ordinary 0..1 UV0, select it, then add Website Surface
from **Web Behaviors**. The add action transactionally marks that Mesh
Realtime, removes its atlas override, and derives a unique lowercase Website
Name; a failed add restores the prior rendering/atlas values. **Display** keeps
UI-like pixels unlit and outside material tone mapping, while **Surface** keeps
the cloned authored material response. Web Checks and background compile both
refuse baked, non-Mesh, empty, multi-material, missing/non-finite UV0, UV0
outside 0..1 (`1e-5` tolerance), UV0 that misses a square edge (`1e-4`
tolerance), duplicate-name, or unresolved targets. Disabled Website Surface
records remain editable and round-trip without acting as enabled publish
targets.

The website binds its own canvas through the generated scene's named
`websiteSurfaces` interface and remains responsible for drawing, hover/focus,
input, route, DOM, accessibility, and analytics. Blendlink owns semantic
binding, Three material isolation, demand-frame invalidation, conditional
restoration, and wrapper disposal. Website Surface is not a baked lighting
state; named Lighting/Appearance transitions continue through `setState()`.
Rigid Body and Collider shortcuts route to Blendlink's existing canonical
object controls rather than creating duplicate physics state. The initial
library is extensible through website adapters; it does not claim every Needle
component, and multiplayer behavior is intentionally excluded.

**Texture Atlases** is a real Main-plus-additional collection editor: use **Add
Atlas from Selection**, move later selections into it or back to Main, use
**Select Assigned Meshes** for its live authored membership, and inspect cached
capacity and achieved-detail evidence beside **Minimum Detail** and the other
settings that control the result. Main is always the default; raw stable IDs
stay out of artist-facing labels.

Each atlas also makes its output contract visible. **Bake Lighting
(Recommended)** preserves authored PBR maps and material UVs, creates a
separate lightmap UV, and bakes indirect GI while direct lights, reflections,
and specular response stay live on the website. **Bake Appearance** captures
the Combined look into an unlit atlas when flattening is intentional. New Main
and additional atlases start on Lighting; recipes and `.blend` entries from
before this setting remain Appearance for compatibility. Additive Light Groups
currently require Appearance and fail during layout checking—not after a long
bake—when a Lighting atlas is present.
Lighting preflight also names connected emissive mesh/material contributors
and a non-black Blender World when no published HDR owns the same runtime
illumination. Those are warnings rather than guesses disguised as blockers:
export an equivalent Blender Light object, publish the HDR, or choose
Appearance when the complete viewport look is the intended deliverable.

The Optimization panel also owns the artistic publishing outcome: optional
Meshopt geometry and KTX2 Auto GPU textures. In Material Properties,
**Blendlink Web Material** first reports the active material as **Exact glTF**,
**Approximated**, or **Needs Bake**. Supported Principled BSDF inputs and KHR
material extensions travel through Blender's stock glTF exporter. The panel
names procedural textures, shader mixing, bump-only detail, and other active
graph features that cannot publish faithfully as editable glTF; it never
silently promises a procedural graph will survive. When an artist selects an
intrinsic Color/Value output as **Website Color**, Blendlink automatically
preserves whether that field belongs to a lit BSDF response or a genuinely
unlit Background/Emission response. Nested portable Principled/Diffuse paths
are analyzed. Eevee-only Shader-to-RGB/AO convergence, Translucent and other
non-portable BSDFs, mixed response, or detached intent block until the artist
chooses the visible Automatic/Lit/Unlit override or a supported specialized
strategy. An explicit Lit/Unlit choice knowingly requests the stock-glTF
approximation rather than claiming the complete Eevee response was preserved.
Exact per-object alpha data independently produces Opaque, Masked, or Blended
material variants, so opaque walls and small props keep correct depth behavior
even when they share an authored source material. These choices compile into
ordinary stock glTF; website developers do not patch Three materials after
load. The panel then exposes per-image
Scene Default, Uncompressed, Compact, and High Fidelity choices plus published
maximum size. Encoding, glTF validation, decoded-image fidelity checks, and
reports remain in the CLI; the Blender UI never asks an artist to tune
ETC1S/UASTC encoder flags.
Material-less meshes are normalized only in the exported GLB to Blender's
neutral default dielectric, avoiding glTF's implicit white metallic fallback
without creating a material in the `.blend` or touching authored bindings.

Animation and Blendlink Web World panels add portable startup, loop, speed,
tone-mapping, exposure, page/background, and native distance-fog ownership
intent. Simple clip autoplay remains the default. **Website NLA Sequence** is
an opt-in slim layer over one real Blender NLA track: artists keep using the NLA
Editor for strip order, trim, scale/speed, repeat, reverse, Replace/Add,
blend-in/out, weight, easing, extrapolation, and mute. During export,
reversible staging makes every sequence-referenced Action discoverable to
Blender's stock exporter without filtering other scene-discoverable Actions.
Blendlink blocks overlapping, stale, transition/meta, animated-time/influence,
or Blender-only blend intent
instead of approximating it. **Website Camera & Frames** adds explicit Preserve/Fit Scene/Fit Target
framing; the generated installer never moves a camera or attaches browser
controls unless both the artist and website opt in. Defaults remain
application-owned: an existing site is not restyled or animated merely because
the add-on was installed.

The collapsed **Website Ownership** panel applies that ownership language across
the entire handoff: camera, playback, tone mapping, background, image lighting,
realtime shadows, optimization, filesystem integration, and generated assets.
It always names exactly one owner and why. Blender-version warnings are loaded
from a bounded data registry shared with `blendlink doctor`; an entry is invalid
without a concrete action and public primary evidence.

HDR Environment publishes a selected packed or linked `.hdr`/`.exr` without
color conversion, separating image-based lighting from visible or grounded
backgrounds. KTX2 Auto may add a decoded-radiance-verified packed-float
derivative, but the exact source remains mandatory and runtime fallback-safe.
Realtime Shadows offers consequence-first Fast/Balanced/Soft/
Crisp presets and a collapsed Custom budget; generated Three adapters apply
both policies without making Blendlink an engine. A native Blender Light with
**Shadows** off is carried through a namespaced node-extra opt-out despite
glTF's missing light-shadow field; an explicit Blendlink value wins.
Point, Spot, and Sun lights publish through the stock glTF `COMPAT` conversion,
preventing Blender `SPEC` mode's 683x photometric multiplication from changing
the authored look. Export is limited to the active Scene and respects the
active View Layer, multi-path nested collection visibility, and reachable
collection-instance sources. **Blendlink Web Light** in Light Data Properties uses that
same canonical policy to show **Exact Realtime Light**, **Realtime · Web
Approximation**, **Bake-only Light**, or **Not Published**; authored
energy/exposure; website intensity and Three.js power when predictable and
applicable; the consequence; and a next step. Unsupported cases also enter
Web Checks. For an Area light, **Website Area Light** offers **Automatic
(Default)**, **Bake Only**, and **Three Rect Area (Approximation)**. Automatic is
represented by missing `blendlink_area_light_mode` metadata and publishes only
the engine-proven Square/Rectangle subset; Point, Spot, and Sun behavior does
not change. Eevee's static Direct Light scale is folded into the result while
its unused Area Spread and light-node graph are ignored. Cycles accepts
nodes-off data-block semantics or one direct constant Emission route, but a
non-default Emission Strength and a non-default Spread keep Automatic
bake-only. Unsupported transforms, micro Eevee emitters, non-default
diffuse/specular factors, intermediate nonzero transmission/volume factors,
linking, custom distance/clamp, and ambiguous Collection Instance artifacts
also keep Automatic bake-only with a named reason. **Three Rect Area** knowingly
accepts diagnosed semantic losses but still fails on invalid or uncomputable
facts; **Bake Only** is the explicit
way to retain the old pre-1.0 behavior. The emitted Three light is one-sided,
shadowless, direct-only, and limited to live Standard/Physical PBR receivers;
it continues geometric falloff rather than reproducing Eevee's finite Light
Threshold/Custom Distance fade, and grazing angles/highlights can differ
because Eevee and Three do not use identical LTC horizon/facing evaluation.
Blendlink also refuses to layer the realtime light over a Lighting atlas until
per-light bake-exclusion evidence can rule out double illumination. None of
these paths claims Blender image parity.
Routed Cycles node groups and Light Falloff ownership stay explicit
approximations instead of receiving guessed numeric promises.

Reflection Probes creates a named native box/sphere helper from selected
meshes, exposes face detail, influence, strength, and a stable optional anchor,
and keeps renderer membership explicit. Each probe can capture once in Three,
bake a high-detail scene-linear EXR in Blender, or publish an exact custom 2:1
HDR/EXR/PNG/JPEG/WebP. The panel shows current/stale/error evidence, dimensions,
content hash, thumbnail, and source location. **Bake All** byte-attests every
staged EXR before replacement, installs the batch with sibling backups, then
decode-validates dimensions and format; any failure restores the whole file,
image, and recipe batch. Generated Three sites automatically decode
baked/custom sources to owned PMREMs.

It also provides:

- **Tag Selected** — one-click vocabulary authoring on every selected object:
  collider suffixes (`-col` / `-convcol` / `-colonly` / `-convcolonly`),
  `-rigid` with mass/friction sliders, `_LODn` with switch distance,
  `-noimp` exclusion, and typed anchor empties (`SOCKET_` / `HOTSPOT_` /
  `AUDIO_`) parented to the active object. Every operator is one undo step
  and adjustable in the F9 redo panel.
- **Web Checks** — the same lint blendlink's parser runs, live in the sidebar:
  near-miss tokens (`-collonly`), LOD gaps, anchors with geometry, and
  Blender's `.001` duplicate numbering that silently hides a suffix tag
  (with a one-click fix that moves the number into the base name). Incomplete
  or conflicting Website Components enter this same cached list and block
  publish with their actual component name.
- **Geometry Conversion** — source/evaluated topology deltas, nested Geometry Nodes
  camera/object/collection dependencies, finite-range Cache/Block evidence,
  LOD threshold and draw-call consequences, and stable shared-mesh instance
  groups. Unsupported changing topology or movable-camera culling blocks the
  build instead of silently publishing one misleading evaluated frame.
  Material/light/camera/World property animation is likewise blocked with a
  website-code or deliberate-freeze remedy because core Three.js does not bind
  `KHR_animation_pointer`.
- **Website preview + build status** — whether the saved `.blend` and the exact
  published GLB, generated module, atlases, and environment match every hash
  in the last manifest (discovery walks up to `blendlink.config.mjs`; asset
  URLs resolve only through exact project/static paths, never basename
  guesses). Referenced files are checked at their recorded paths too, so an
  edited image, IES, or OSL input cannot leave an unchanged `.blend` looking
  current; volatile sequences and UDIM sets always require a rebuild. The
  buttons save the file and run `npx blendlink publish`, connected-site
  `npx blendlink preview`, or private `npx blendlink preview --blend ...` as a
  background subprocess — Blender stays fully usable, a progress bar tracks the
  `##blendlink` progress lines the pipeline emits, and failures surface an
  open-log button. Preview remains active after its first successful compile;
  each later save updates the same browser session. A failed update is displayed
  without discarding the last good preview. The addon still never implements
  export logic; it only invokes the CLI the project already uses.
- **Baked Textures & UVs** — inspect hash-verified state, Light Group, and HDR files
  rather than a pre-save approximation. Select a thumbnail to open it or show
  its exact saved pixels on matching atlas meshes; **Select Last-Build Members**
  selects the membership recorded by that build, distinct from the live
  **Select Assigned Meshes** action in **Texture Atlases**. “Load Published Atlas UVs” loads
  the exact compressed Blender-space pack snapshot after its distinct Float32
  values have been attested against the final GLB; topology is checked before
  applying it and the addon never reruns packing. A selected derived asset is cleared as
  soon as its bytes stop matching the manifest, so stale pixels cannot be
  opened or projected onto the scene. The same panel reports
  approximate per-object texels and the last dependency-aware build's reused
  versus rebuilt state/light-group × atlas jobs.
- **Viewport overlay** — draws what blendlink sees: collider proxies as green
  wireframes, sockets as RGB axes, hotspots and audio anchors as labeled
  crosses, selected component radii, the active reflection influence, actual
  Spot cones, six-face Point shadow cost, and a truthful non-geometric Sun far-
  clip badge. Scene analysis and GPU primitives stay cached while guides follow
  live object transforms; shared-anchor labels stack automatically. A **Responsive Frame** preview adds an exact camera crop, page-safe zone, CSS
  size, reference DPR, and backing-buffer size; a red guide explains when the
  selected aspect has not been applied. Respects the global overlay toggle;
  X-ray mode is in preferences.
- **Visual reference matrix** — captures clean Blender source renders across
  cameras, lighting states, Responsive Frames, and animation poses, then
  writes separate required Preview/Final browser cells. The npm
  `runVisualReferenceAudit()` callback seam accepts real website PNGs, verifies
  their backing size/source hash, writes premultiplied-RGBA diffs (including
  alpha-only composition failures), and records measured error;
  Blender never presents its own pixels as website evidence. See
  [the workflow](../../docs/VISUAL_REFERENCE_WORKFLOW.md).

Find it in the 3D viewport sidebar (N) under the **Blendlink** tab. The tab
name is editable in the addon preferences.

## Install

Build and install from this directory (Blender 4.2+):

```
blender --command extension build --output-filepath blendlink-addon.zip
```

then Blender → Preferences → Get Extensions → Install from Disk, or headless:

```
blender --background --python tests/install_check.py --python-exit-code 1
```

## Development

```
# pure-Python vocabulary tests (no bpy required)
python tests/vocab_test.py

# full operator suite inside Blender
blender --background --factory-startup --python tests/run_headless.py --python-exit-code 1

# responsive framing + real Blender reference PNG/manifest contract
blender --background --factory-startup --python tests/presentation_check.py --python-exit-code 1

# overlay shader validation offscreen (Blender 5.2+)
blender --background --factory-startup --python tests/overlay_gpu_check.py --python-exit-code 1

# sync-status e2e against a synced project
blender --background --python tests/sync_status_check.py --python-exit-code 1 -- <project-dir> <name>.blend

# manifest sanity
blender --command extension validate
```

`vocab.py` mirrors `packages/blendlink/src/vocabulary.ts` — keep the regexes
in sync when the vocabulary grows.

## License

The standalone Blender Extension is GPL-3.0-or-later, with the complete GPL
version 3 terms in its `LICENSE`. The npm tarball is a mixed aggregate: its
Node/compiler/runtime files are MIT, Blender-dependent files are
GPL-3.0-or-later, and bundled Basis notices are Apache-2.0. See the npm
artifact's `LICENSES.md` for the file-level map.
