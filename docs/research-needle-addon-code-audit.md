# Needle Engine Blender add-on source audit

- Research date: 2026-07-20
- Inspected implementation: locally installed Needle Engine Exporter for Blender 1.4.2
- Primary installation: `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender`
- Comparison target: the current Blendlink working tree
Method: static review of all 106 Python modules, bundled component schemas and project templates, followed by critical-path tracing through export, preview, lighting, materials, components, lightmapping, reflection probes, animation, process handling, and registration teardown. The Blender 5.1 and 5.2 Needle installations contain the same 106 Python files and every corresponding SHA-256 hash is identical, so the 5.2 review covers both installations.

This report complements [`research-needle-addon-ui-parity.md`](research-needle-addon-ui-parity.md). That document studies the visible information architecture; this one studies the implementation beneath it. Source markers such as **S2** resolve to exact local files and line spans in [Source anchors](#source-anchors).

## Decision

Needle's strongest competitive advantage is breadth of editor affordances tied to its own runtime, not a better Blender-to-glTF compiler. This audit identified three outcomes and one narrow authoring refinement worth adopting; all four are now implemented in Blendlink's focused, portable form:

1. **Use Blender's `COMPAT` glTF light conversion and verify it as a cross-version contract.** This was the direct cause of the overpowered-light regression. The implementation, real-GLB `COMPAT` assertions, direct `SPEC`/`COMPAT` 683x control, and measured browser comparison are in place; the current full release matrix remains the sign-off gate. [S2] [S3] [S4] [S5] [S6] [S48]
2. **Reflection-probe authoring now supports Runtime Capture, Blender Bake, and Custom Texture.** The Blender surface adds samples, resolution, status, inspectable published pixels, Bake, and transactional Bake All while retaining stable IDs, owned derived assets, exact-byte evidence, loud staleness, and automatic Three texture/PMREM ownership. [S10] [S11] [S12] [S49] [S50]
3. **The focused component catalog now scales through an outcome-first browser.** Search, categories, descriptions, consequences, compatibility, documentation, target readiness, and support badges sit beside safe copy/paste-values and copy-as-new operations with per-target changed/skipped/error results. The catalog remains deliberately small and portable rather than importing Needle's engine-specific runtime surface. [S13] [S14] [S15] [S16] [S17] [S21] [S22]
4. **A slim authored NLA sequence is now available as an opt-in layer.** It preserves ordered Action strips, trim, speed, repeat, reverse, blend, easing, extrapolation, mute, loop, and duration through reversible Action staging and deterministic runtime playback. Needle's full Animator state-machine editor remains application logic and is not ported. [S31] [S32] [S33] [S51]

Everything else should be adopted selectively. The useful architecture lessons are explicit lifecycle stages, teardown-before-RNA cleanup, conflict explanations that identify the owning object, data-driven viewport helpers, and robust state restoration. Cloud deployment, licensing, XR, multiplayer, voice chat, AI control, runtime framework generation, a TypeScript component compiler, and general glTF import round-tripping do not reduce friction in Blendlink's focused Blender-to-Three.js promise.

## P0: accurate realtime lights

### Root cause

Needle calls Blender's stock glTF exporter and explicitly sets `export_import_convert_lighting_mode='COMPAT'`; it uses the legacy `convert_lighting_mode='COMPAT'` key for older Blender versions. It does not apply a second light-energy scale in its component post-process. [S2] [S7]

Blender 5.2 defaults the same exporter property to `SPEC`. The official exporter defines `PBR_WATTS_TO_LUMENS = 683`, divides non-directional point and spot energy by `4 * pi`, then multiplies every supported light's result by 683 only in `SPEC` mode. Both `SPEC` and `COMPAT` retain Blender Light exposure as `2 ** exposure`. [S3] [S4] [S5]

Therefore, for an ordinary data-driven Blender light and exposure:

| Light | Blender glTF `COMPAT` intensity | Blender glTF `SPEC` intensity | Mismatch relevant to Blendlink |
| --- | --- | --- | --- |
| Sun | `energy * 2^exposure` | `energy * 683 * 2^exposure` | exactly 683x |
| Point | `energy / (4*pi) * 2^exposure` | `energy / (4*pi) * 683 * 2^exposure` | exactly 683x |
| Spot | `energy / (4*pi) * 2^exposure` | `energy / (4*pi) * 683 * 2^exposure` | exactly 683x |
| Area | not a native `KHR_lights_punctual` type | not a native `KHR_lights_punctual` type | test and explain Blender's observed conversion/omission; do not invent a scale |

This exactly explains a website preview that is dramatically brighter than the Blender-authored look. It is not a Three.js tone-mapping quirk and should not be repaired with a runtime `1 / 683` multiplier.

Cycles light node graphs can change the pre-conversion strength/color path, and `normalize=False` can change effective energy. Those cases do not invalidate the 683 `SPEC`/`COMPAT` ratio, but the simple table is no longer a complete predictor. Blender still uses data Energy for ordinary Point/Spot default node graphs, Light Falloff can own their strength, and a direct Sun Emission can own Sun strength. Blendlink predicts the proven cases and withholds a number for linked procedural routing or an active Shader Node Group boundary. [S5] [S48]

### Blendlink state after this audit

`gltf_export_contract()` now discovers the current or legacy Blender RNA property, refuses export if neither is available, and requests `COMPAT` through the one stock-exporter seam. It retains `exporterOverrides` only for non-owned fields and rejects attempts to replace light export, render visibility, or conversion mode. [S6]

That design is better than copying Needle's version-number branches:

- feature detection follows the actual installed exporter API;
- failure is loud when Blendlink cannot honor its visual contract;
- every export mode gets the same arguments;
- there is no second runtime compensation that could double-correct the result.

### Light-fidelity release gates

Reflection probes, the component browser, and consequence guides are independent of a focused light-fidelity release. The following items still define that release claim:

1. **The full build and test matrix must pass with the real Blender exporter.** The headless fixture exports and parses real GLBs, asserts `COMPAT` Point/Spot/Sun values (including Light exposure), directly proves Blender's `SPEC` result is 683x the `COMPAT` Point intensity, and covers spot range/cones, hidden-light exclusion, final export scope, collection-instanced lights, native shadow opt-outs, grouped Cycles nodes, and rejection of conflicting raw overrides. Release sign-off still requires the current `npm run test:full` result; this report does not freeze a test count while the suite continues to grow. [S48]
2. **The normal preview path must visibly use the corrected GLB.** Complete. A fresh Preview Studio loaded the corrected artifact with no browser error. A direct-light control exported a 1000 W Blender Point as `79.57747154594767` glTF candela (`1000 / 4*pi`); on a neutral directly lit surface, the matched 1920x1080 Blender/browser samples differed by 1 RGB level. The full-frame MAE was 4.39/255, dominated by the already-diagnosed finite-emitter/soft-shadow and renderer-material differences rather than excess light energy.
3. **Any render-visible Area light is a conditional blocker.** Blender's official glTF exporter refuses `AREA` because `KHR_lights_punctual` has no area-light type. Blendlink now diagnoses it as bake-only and tells the artist to use Point, Spot, or Sun for realtime lighting. If the release scene relies on an Area light illuminating Realtime objects, the scene must be changed or an explicit approximation designed; `COMPAT` cannot make that light appear. `C:\Program Files\Blender Foundation\Blender 5.2\5.2\scripts\addons_core\io_scene_gltf2\blender\exp\lights.py:39-44`; `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\weblights.py:503-529`.
4. **Keep one light-policy source.** This convergence is now implemented: the headless exporter imports `weblights.exporter_policy()` for the owned conversion/export/visibility arguments, while the addon uses the same module for artist diagnostics. Regression coverage rejects conflicting raw overrides and exercises the real stock exporter, so a duplicated compiler policy cannot silently drift from the UI. Preserve this boundary. [S6] [S48]
5. **Review every approximation diagnostic in the release scene.** Nonzero Point/Spot emitter radius and Soft Falloff, Sun angle, Diffuse/Specular/Transmission/Volume contribution factors, Blender-only shadow tuning, Light/Shadow Linking, and Cycles light-node behavior are not fully represented by `KHR_lights_punctual`. Native per-light Shadows off is now carried separately as a namespaced runtime opt-out. The remaining approximations are not universal release blockers, but any one the target look relies on blocks a claim of visual parity until the artist accepts it or Blendlink owns an equivalent runtime recipe. [S48]

### Non-regression verification

1. Keep the deterministic Sun/Point/Spot real-export fixture and Area-light diagnostic without claiming unsupported glTF semantics. [S48]
2. Keep both the ordinary `COMPAT` export and the direct stock-exporter `SPEC / COMPAT == 683` control.
3. Keep every product exporter entry point on `gltf_export_contract()` so owned policy cannot diverge from `weblights.exporter_policy()`.
4. Keep browser smoke coverage beside real GLB-value assertions; neither alone catches stale build or adapter mistakes.
5. Retain matched-camera Blender/browser comparisons for a direct-light fixture and representative scene. Do not turn one measured fixture into a universal pixel-equality claim.
6. The legacy exporter-property branch is covered with a synthetic RNA surface; add a real older-Blender lane when that version becomes part of the declared compatibility floor.
7. Keep the artist's viewport look separate from bake byte contracts. Realtime light parity must not relax the existing Standard/None/0 save contract for additive bake layers.

Needle also maps AgX and Khronos PBR Neutral to runtime tone-mapping modes and converts Blender exposure stops to a linear multiplier. Blendlink keeps that ownership explicit and improves the private preview path: Blender 5.x's current OCIO AgX is labeled approximate, the untouched artist exposure is retained as evidence, and a separately recorded measured `-0.28`-stop adapter correction reduces the target-scene browser/Blender MAE from 11.86 to 4.30/255. Published website recipes receive no correction. [S8] [S42]

## Prioritized adoption plan

| Priority | Outcome | Why it matters to an artist | Port / improve decision |
| --- | --- | --- | --- |
| P0 | Verify `COMPAT` lighting end to end | A light set in Blender should not become 683x brighter in the website | Implemented with real `COMPAT` values, a direct 683x `SPEC` control, Preview Studio GLB inspection, and matched browser evidence; the current full release matrix remains the release sign-off gate |
| P1 | Reflection Probe: Runtime / Bake / Custom | Artists can choose zero-wait runtime capture, a deterministic offline HDR bake, or an art-directed map and inspect the result in Blender | Complete: stable-ID derived EXRs, exact custom bytes, source/content evidence, stale status, transactional Bake All, published asset descriptors, and automatic Three loader/PMREM ownership; textured spatial preview, overlap blending, and box parallax remain explicit limitations |
| P1 | Searchable component browser | As the catalog grows, artists need to find an outcome rather than remember internal component names | Complete: keyboard-focused categories/search, descriptions, docs, cost/consequence/compatibility, target readiness, support badges, and a declarative JSON/RNA binding check |
| P1 | Component copy/paste and batch apply | Repeating tuned behavior settings across selected objects should be one deliberate action | Complete: safe versioned JSON, extension preservation, new stable IDs, resolved-reference validation, exact type/range checks, already-matches detection, and structured changed/skipped/errors for every target |
| P1 | Cached consequence guides | Audio range, see-through clearance, probe influence, and light-shadow cost become understandable spatially | Implemented for selected component radii, the active probe, and Point/Spot/Sun shadow consequences with cached analysis/GPU primitives, live transform resolution, collision-aware labels, six-face Point cost, the actual Spot cone, and a non-geometric Sun far-clip badge. Collider bounds, a see-through camera-target line, and probe anchor/member-count guides remain candidates rather than claimed parity |
| P2 | Authored NLA sequence metadata | An artist can preserve strip order, trim, speed, blend, reverse, and extrapolation without writing site code | Complete as an opt-in slim layer over one real NLA track: deterministic Action export/restoration, portable ordered-strip contract, transport commands/state, render-loop update, replayable stop, terminal disposal, additive cloning, and loud rejection of overlap or Blender-only strip semantics; ordinary clip autoplay remains the default |
| P2 | Optional File > Export integration | Portable Blendlink metadata can travel through Blender's familiar glTF surface when deliberately requested | Consider only after preview/build paths are complete; do not create two compiler contracts |
| Evaluate | Contact Shadows recipe | It can cheaply ground realtime objects, but may duplicate baked grounding or normal shadow maps | Prototype with measured visual/performance evidence before exposing a checkbox |
| Evaluate | Spatial Trigger recipe | Useful for some portfolio interactions, but it requires event ownership and runtime semantics | Add as a focused portable recipe only when an actual site needs it |
| Evaluate | Progressive streaming | Low-resolution-first loading may help very large scenes | Require a thin standard-Three implementation and measurable benefit; do not adopt Needle extensions by name |

## Detailed implementation comparison

### Export architecture and lifecycle

| Topic | Needle implementation | Blendlink assessment | Decision |
| --- | --- | --- | --- |
| Add-on registration | Dynamically imports every module, topologically sorts Blender classes, registers classes before module callbacks, then tears module callbacks down before RNA classes to avoid live draw handlers touching freed types. Its topological sorter has no explicit cycle failure. [S34] | The teardown ordering is a strong safety invariant; dynamic discovery is not itself a product feature and can obscure ownership. | Adopt the teardown-before-RNA rule and explicit handler cleanup. Prefer explicit/typed registration or add cycle detection if dependency sorting is ever introduced. |
| glTF extension dispatch | Creates eight extension handlers and independently fans most Blender exporter/importer hooks through them, catching each handler failure and recording an export error. [S35] | Strong separation of hook responsibilities, but it is coupled to many custom NEEDLE extensions and Blender-version callback shapes. | Borrow an explicit typed stage registry only where Blendlink's compiler stages genuinely need it: preflight, freeze, export, optimize, verify, publish. Keep deterministic order and one manifest contract. |
| Export transaction | `SceneExportContext` records errors/warnings, mode, active/main scenes, dependencies, lock file, and restoration. The root export clears files from the asset directory before exporting and mutates scene state for dependency/export filtering. [S36] | State capture/restoration is useful; clearing a shared directory and mutating authored scene membership are fragile. | Keep Blendlink's staged output and publish/rollback behavior. If context grows, make every mutation an explicit restoration record and verify cleanup failures. |
| File-menu export | Needle can inject its own options into Blender's glTF dialog and export Everything or Components Only. [S35] | Familiar, but creates a second entry surface and embeds runtime-specific extensions. | P2 at most. If added, it must invoke the same Blendlink compiler contract and clearly state whether it exports a portable GLB or a full website build. |
| Scene dependencies | Needle discovers referenced Blender scenes and emits multiple GLBs. [S36] | Potentially useful for multi-scene sites, but not necessary for the hero-scene core promise. | Evaluate only from a real multi-scene authoring job. Do not let it complicate Main scene ownership now. |

### Preview and project workflow

| Topic | Needle implementation | Blendlink assessment | Decision |
| --- | --- | --- | --- |
| Project surface | Duplicates the full project panel in the 3D sidebar and Scene Properties. The panel's `poll()` performs Node and package checks every five seconds. [S37] | The prominent preview action and project/component conflict messaging are good; draw-path side effects and duplicated forms are not. | Keep Blendlink's compact sidebar plus canonical Scene/Object/Material ownership. Preserve Needle's hierarchy-path conflict explanation pattern. |
| One-click preview | Offers a large `Export To Browser Preview` action after a separately visible install/start-server row. Starting the server stops the component watcher, launches a server, exports, then restarts the watcher after ten seconds. [S37] [S38] | Blendlink's one action already provisions or connects a preview, opens it, watches saves, uses the same single-flight path for the first and later builds, and retains the last good scene on failure. [S40] | Blendlink exceeds this. Continue improving truthfulness and latency; do not copy Needle's separate install/start ceremony. |
| Server startup | Always runs registry configuration, `npm install`, and `npm run dev/start`; liveness is a four-second cache around a hard-coded `localhost:3000` socket with a TODO for custom ports/background work. [S38] | Expensive and brittle for solo-artist iteration. | Do not port. Keep identity-proven server reuse, detected/configured URLs, private Preview Studio, and no network install on every preview. |
| Process errors and teardown | Uses `shell=True`; stderr is printed only in debug mode and otherwise discarded; completion callbacks do not receive a structured exit result; teardown kills only the direct process. [S38] | Blendlink captures output tails, trusts sentinel plus artifacts over Blender's shutdown exit code, uses an inactivity timeout, streams progress, and kills Windows process trees. [S41] | Blendlink is materially safer. Preserve this as a non-regression requirement. |
| Toolchain consistency | Installed code expects engine 5.1.4 and advertises Node 20.19-24, while the Vite template pins engine 5.0.3 and the actual support predicate accepts Node 16.13+. [S43] | Visible version claims can drift when diagnostics and templates do not share one schema. | Keep Blendlink's single toolchain/manifest contract and test UI text against the same source. Do not copy hard-coded parallel lists. |

### Components and artist-authored behavior

| Topic | Needle implementation | Blendlink assessment | Decision |
| --- | --- | --- | --- |
| Catalog breadth | Bundles 85 instantiable Blender schemas and 146 runtime documentation records. The catalog includes cameras, post effects, controls, physics, colliders, audio, UI, network, XR, and many framework-specific behaviors. [S44] | Breadth is impressive but most entries are application/runtime features rather than scene-compilation concerns. Blendlink currently has ten deliberate first-party outcomes and preserves vendor namespaces. [S21] [S22] | Do not chase numerical parity. Expand only around common solo-site jobs with a real adapter, validation, tests, and cleanup. |
| Component browser | Builds categories, search, descriptions, docs links, target filtering, and skip-existing behavior in a large popup. [S14] | This is the strongest broadly reusable component UX. Blendlink now implements the outcome with keyboard-first search, target readiness, runtime-support badges, cost, consequence, compatibility, and documentation. [S22] | Keep the focused catalog and measure future additions by recurring artist jobs, not Needle's entry count. |
| Declarative fields | Translates schema primitives, vectors/colors, enums/flags, arrays, nested records, object/resource/component references, clips, and events into Blender RNA and dynamic panels. [S15] [S16] | Powerful but tied to Needle's TypeScript/runtime schema. Blendlink already has a smaller declarative schema shared with a versioned portable JSON contract. [S21] [S22] | Keep Blendlink's contract. Extend its field metadata as needed instead of importing Needle's compiler. |
| Copy/paste | Recursively copies values and collections; supports paste-values and paste-as-new, but silently ignores incompatible writes and collection failures. [S17] | Blendlink now uses versioned JSON, exact known-field validation, reference validation with rollback, new IDs for copied instances, extension retention, and structured changed/skipped/error results for every target. [S22] | Keep the explicit multi-selection result contract and never reintroduce silent incompatible writes. |
| Live TypeScript watcher | Polls project `.ts` files every two seconds and invokes a pinned `npx` compiler. If a compiler is already running, the observed change is skipped after the file-state snapshot is advanced, so it can be lost. [S18] | Framework-specific and less reliable than Blendlink's coalesced save-build path. | Reject as core. Custom site adapters remain normal source code; Blendlink should not become a TypeScript IDE/compiler host. |
| Identity | Needle derives UUIDv5 IDs from Blender datablock names or owner-name plus component class, making them deterministic but rename-sensitive. [S19] | Blendlink stores UUID-backed `blendlink_id` values and portable component IDs, keeping object references rename-stable. [S21] [S45] | Blendlink is better. Never replace stable stored identity with name-derived identity. |
| Unknown components | Needle retains imported unknown models and remaps references, but stores them with `str()` and reconstructs them using `eval()`. [S20] | The preservation goal is excellent; the representation is unsafe and Python-specific. Blendlink safely retains well-formed unknown vendor JSON namespaces. [S21] | Preserve the goal, reject the implementation. Never use `eval()` for authored or imported component data. |
| Conflict lookup | Caches a single-pass scene component search for one second and names every conflicting object's hierarchy path in the UI. [S19] [S37] | Good large-scene and source-of-truth behavior. | Blendlink already has cached validation; reuse it to provide the same hierarchy-path explanation rather than adding draw-time scans. |

### Lighting, environment, shadows, and probes

| Topic | Needle implementation | Blendlink assessment | Decision |
| --- | --- | --- | --- |
| Realtime light units | Stock glTF export in `COMPAT`; no manual component intensity rewrite. [S2] [S7] | Blendlink now uses the same `COMPAT` choice through its canonical feature-detected policy, adds complete render-visibility enforcement and exact/approximation diagnostics, and applies no second runtime scale. | Keep the implementation and real-GLB/browser regressions as non-regression gates. |
| Shadow authoring | Adds baked/realtime light intent, shadow enablement, Default/Soft/Hard bias pairs, width, height, distance, and resolution to its Light component. [S7] | Blendlink's consequence-first global presets plus custom controls are already more understandable; the Light Data summary shows publish outcome, portable-unit consequences, and a remedy, while cached guides show the selected Spot cone, six-face Point cost, and an honest Sun far-clip badge. [S24] [S42] [S48] | Keep Blendlink's presets, summary, and spatial consequences rather than copying a raw field list. |
| Tone and exposure | Injects a ToneMapping component from Blender's view transform and stores exposure as `2^stops` unless an explicit component already exists. [S8] | Blendlink exposes explicit Website/Application ownership, restores application state, and now records a transparent preview-only Blender-5.x-AgX calibration without changing authored exposure or production policy. | Keep the measured visual evidence; do not hide display-transform differences inside light units. |
| World/environment | Reads viewport studio or World settings, including intensity, background, blur, and rotation. It temporarily changes viewport shading and, in two paths, changes `background_type` without restoring it; it scans all Background and texture nodes rather than the active output graph. [S8] [S9] | Blendlink's explicit background versus image-lighting ownership and reachable-graph analysis are safer. | Do not port the resolver. Use Blendlink's existing environment contract for reflection baking too. |
| Reflection probe UI | Contextual Bake/Custom mode, resolution, samples, large Bake and Bake All actions, viewport-HDRI assignment, gizmo toggle, texture name, dimensions, and thumbnail. [S10] | Blendlink now adds Runtime as a third mode and presents source, current/stale/error status, capture cost, exact dimensions/hash/bytes, thumbnail, source-file access, Bake, and Bake All. [S49] | Keep the explicit three-mode ownership and inspectable published-pixel evidence; textured spatial preview, overlap blending, and box parallax remain open limits. |
| Reflection probe bake | Saves render/Cycles/camera/output state, creates a panoramic Cycles camera, uses GPU with CPU fallback, writes RGB 32-bit DWAA EXR, hides the probe, renders, packs the image, assigns it, and restores state. It names temp/output data from the editable object name, deletes the old image before validating replacement, and collapses exceptions to `None`. [S11] | Blendlink renders owned stable-ID half-float ZIP EXRs, byte-attests the complete staged batch, replaces through sibling backups, decode-validates after replacement, and rolls back file/image/RNA state on failure. Exact custom bytes and baked assets publish through one cache-keyed descriptor and Three loader/PMREM seam. [S12] [S49] [S50] | Preserve this transactional, evidence-backed boundary; add a finite-pixel decode gate only if the decoder can prove it across supported Blender/OpenEXR versions. |
| Contact shadows | Project setting injects a ContactShadows component unless one exists. [S39] [S44] | Useful in some realtime hero scenes, but can conflict visually with baked grounding and realtime shadow maps. | Evaluate with a prototype and real browser pixels before adding an artist checkbox. |

#### Implemented reflection-probe contract

The implemented Blendlink design is:

- **Mode: Runtime Capture / Bake in Blender / Custom Texture.** Runtime remains the quick default where a one-shot browser capture is acceptable. Bake provides deterministic offline art direction. Custom accepts an exact 2:1 HDR, EXR, PNG, JPEG, or WebP asset without requiring a render.
- **Shared spatial intent:** shape, influence volume, strength, explicit assigned meshes, and an optional stable capture anchor remain common to all three modes.
- **Bake controls:** authored face detail, Cycles samples, Bake Selected, and Bake All. The capture uses the current render-visible scene and World rather than hiding a second environment selector.
- **Derived-asset record:** stable probe ID, conservative scene/probe source hash, byte hash, dimensions, format/color space, Blender completion time, and stale reason. The thumbnail is loaded from the published pixels, not an unsaved Render Result.
- **Atomic replacement:** render every probe to a temporary stable-ID path and attest dimensions, format, byte count, and hash before replacement. Install with sibling backups, then decode-validate the batch; a failed bake restores the previous files and RNA/image state and reports why. Finite-pixel inspection is not currently claimed. [S49]
- **Runtime wiring:** generated Three adapters load published baked/custom assets into the existing provided-texture seam and own PMREM cleanup. No material assignment happens between runtime captures; no application-owned material is mutated in place. [S12] [S50]
- **Remaining visual verification:** render at least one probe-driven reflective object in Blender and the browser, save comparable evidence, and report the probe source and hash used by each side. The real-browser orientation/reference matrix remains a release-evidence gap, not an implementation claim.

### Viewport helpers and one-click authoring

Needle's component gizmo table declaratively maps collider boxes/spheres, ViewBox, audio min/max ranges, SeeThrough target, ContactShadows planes, and Orbit bounds to wire shapes. It also retains its draw handle in `bpy.app.driver_namespace` so module reloads can remove orphan callbacks. [S23]

Two implementation details should not be copied:

- every draw walks every visible scene object for every component definition; Blendlink already renders cached validation overlay items and builds unit GPU batches once; [S23] [S24]
- Needle's arrow builder normalizes the target direction and resets the endpoint to one unit from the start, so the wire no longer reaches the actual target. [S23]

Blendlink now extends its cached overlay data with Audio Source minimum/maximum
distance spheres, Keep Visible clearance, the active reflection-probe volume
and capture-cost/status label, the selected Spot cone, six-face Point shadow
cost, and a truthful non-geometric Sun far-clip badge. Analysis and unit GPU
primitives are cached while matrices resolve from live transforms. [S24]

Still-unimplemented candidates are the Keep Visible camera-target line,
rigid-body/collider bounds and proxy distinction, selected shadow-map
allocation, and probe anchor/member-count guides. They should be added only
when their spatial promise can be represented truthfully.

Needle also adds Reflection Probe, Text Button, and Spatial Trigger helpers to Blender's Add menu. The reflection-probe helper is worth matching; Blendlink's existing semantic helpers already follow the right selection-first approach. A Spatial Trigger helper should wait for an actual portable trigger recipe. [S46]

### Lightmapping, atlases, and materials

| Topic | Needle implementation | Blendlink assessment | Decision |
| --- | --- | --- | --- |
| Lightmap set | Selects meshes marked lightmapped and lights marked for baking. It hides every non-lightmapped mesh from render, explicitly preventing those meshes from contributing shadows. [S25] | That can remove legitimate occluders and bounced-light contributors. Blendlink's baked-versus-dynamic distinction should not imply contributor exclusion. | Do not port. Keep receiver, contributor, collision-proxy, and exported-runtime semantics separate. |
| Packing | Builds proxy quads sized by bounding-box dimension sum times `lightmapScale`, averages and packs those quads, then applies UV offsets; rotation is disabled. [S26] | This is simple but not a reliable detail metric. It cannot express authored islands, pinned areas, surface area, target versus achieved density, or multiple budgets. | Blendlink's Main/additional atlases, materialize/pin workflow, per-atlas density/capacity preflight, and exact packed-UV evidence are materially better. |
| Reuse | Hashes topology counts, positions, object scale, `lightmapScale`, and resolution to skip re-unwrapping. [S26] | Useful concept, narrower dependency set than Blendlink's bake fingerprints. | No direct port needed. Ensure Blendlink fingerprints continue to include every setting/world/material/light/state input that changes bytes. |
| Lightmap encoding | Converts a float lightmap to RGBM in an 8-bit non-color PNG, creates a dummy material/quad so stock glTF exports the image, and attaches custom NEEDLE lightmap extensions. [S27] | Runtime-specific and less transparent than Blendlink's standard-lightmap/appearance atlas contract and saved-pixel evidence. | Reject the extension and dummy-geometry route. Keep Blendlink's byte/color/background contract in `bakelib.py`. |
| Material translation | Delegates Principled/material conversion to Blender's stock glTF exporter. Needle's material utility only resolves image nodes/socket names; the material UI lists every `TEX_IMAGE` node in the active material, including disconnected experiments. [S2] [S29] | Needle does not have a hidden superior Principled translator to port. Blendlink's active-Surface reachable graph avoids false warnings and irrelevant optimization. [S30] | Keep stock glTF as the common realtime material baseline and test representative Principled changes. Do not copy all-node discovery. |
| Texture controls | Per-image Auto/None/ETC1S/UASTC/WebP, max size, quality, dimensions, thumbnail, and override UI. The max-size enum contains `8096`, likely intending `8192`. [S29] | The compact row is good UI evidence; Blendlink's semantic compression choices and decode-backed fidelity gates are stronger. | Preserve Blendlink's consequence-first presets. Borrow only compact preview/dimensions/override presentation where it improves scanning. |
| Progressive assets | Emits Needle-specific progressive texture/mesh metadata. [S35] [S39] | Can improve very large sites, but binds output to a runtime extension. | Evaluate a standard-Three adapter only with measured loading benefit. |

### Animation and import

Needle's timeline serializer is the one animation feature worth retaining as design evidence. It serializes active actions and NLA strips into ordered clips with start/end, duration, time scale, clip-in, blend in/out, extrapolation, and reverse. With no explicit tracks, it scans all Blender objects. [S31]

Its animation export handler creates temporary muted NLA tracks to force referenced actions through Blender's glTF exporter, maps actions to `/animations/N`, includes Blender-version workarounds, and cleans created tracks after export. [S32] This solves real exporter friction but is also version-sensitive and mutates animation data during the transaction.

Blendlink now uses the narrow action-export shim this evidence motivated. One
opt-in real NLA track is validated into a portable ordered-strip descriptor;
export temporarily creates muted stash tracks for the sequence's referenced
Actions and restores the authored stack, while runtime playback clones clips,
converts additive strips explicitly, and seeks deterministically. Unsupported
overlap, Transition/Meta strips, animated time/influence, stale source metadata,
and Blender-only blend modes fail before export. The stock exporter may still
include other scene-discoverable Actions, so the staging contract is exact
without claiming the final GLB contains only sequence Actions. [S51]

Needle's Animator node editor remains rejected: it serializes parameters,
layers, states, transitions, exit times, offsets, and conditions, which is an
application state machine rather than an asset handoff. [S33]

Needle also implements glTF import hooks and attempts to preserve components/persistent assets. Blendlink's target is deterministic publishing from an authored `.blend`, not a general bidirectional engine scene editor. Safe unknown vendor JSON preservation is useful; general glTF-to-Blender reconstruction is out of scope.

## Where Blendlink already exceeds Needle

1. **Preview integrity and feedback.** Blendlink's first build and save updates share a subscribed single-flight path; update failure keeps the last good preview; Blender receives structured progress/error state; process trees are terminated on Windows; Blender failure reports include the output tail. Needle's process helper discards non-debug stderr and its liveness check can confuse another process on port 3000 for the project server. [S38] [S40] [S41]
2. **Editable, evidence-backed atlases.** Main plus additional atlas budgets, authored/materialized UV layers, pinned-island protection, target/achieved density, capacity blocking, bake states, additive light groups, and exact layout/fingerprint evidence are substantially more artist-controlled than Needle's single proxy-quad lightmap pack. [S25] [S26] [S47]
3. **Stable portable identity.** Blendlink stores rename-stable object/component IDs and uses a versioned namespaced JSON component record. Needle's derived IDs change on rename and its unknown-component fallback uses `eval()`. [S19] [S20] [S21] [S45]
4. **Material relevance.** Blendlink traces only nodes contributing to the active Surface output, including nested groups. Needle's material UI inventories every image node in the datablock. [S29] [S30]
5. **Reflection-probe safety and authorship.** Blendlink captures every runtime probe before local environment assignment, supports published baked/custom textures, clones materials, restores ownership, disposes resources, and fails loudly on stale IDs. Its Blender surface now adds the offline bake/custom/status workflow while keeping batch replacement more atomic than Needle's implementation. [S11] [S12] [S49] [S50]
6. **Focused ownership.** Blendlink distinguishes Blender-owned and application-owned camera, tone, backdrop, environment, shadows, and controls. Needle often injects runtime components implicitly and mixes scene publishing with engine menu, XR, networking, cloud, license, and deployment state. [S39] [S42]
7. **Truthful diagnostics.** Blendlink keeps schema/version enforcement, known-issue evidence, atlas blocking, and process failures in the artist-facing workflow. Needle contains several silent `except` paths and visible version claims that disagree with their predicates/templates. [S17] [S20] [S38] [S43]

## Explicit rejects

These are real Needle features, but they do not fit Blendlink's primary promise:

- Needle Cloud upload/deploy, account/login/license flows, analytics, bug-report upload, sharing, and remote tokens;
- Needle AI chat and WebSocket scene-control tooling;
- WebXR, QuickLook, networking, synchronized rooms, voice chat, remote skybox, model drop, and branded engine menu;
- generated Needle/Vite application projects as the canonical output;
- the full engine component library or a local TypeScript component compiler;
- custom NEEDLE lightmap/progressive/persistent-asset extensions as core output;
- the Animator state-machine node editor;
- general glTF import/round-trip parity;
- gzip/server configuration, because deployment and hosting own transport encoding.

Rejecting these is not a claim that they are poor features. It preserves Blendlink's advantage: a deep Blender-native compiler for beautiful, portable Three.js scenes that works for solo artists and small teams without adopting an application engine.

## Complete module inventory

The following 106 Python modules were inspected from the 5.2 installation. The identical 5.1 copies were hash-compared rather than reviewed twice.

### Coverage accounting

The installed 5.2 add-on contains **242 files**. Coverage was accounted as follows:

| File class | Count | Treatment |
| --- | ---: | --- |
| Python source (`.py`) | 106 | 106/106 classified and inspected; the export, preview, light/material, component, reflection-probe, lightmap, animation, process, registration, and teardown paths were traced end to end. Cloud/AI/auth modules were inspected for entry points, dependencies, and side effects but were not subjected to a security/protocol audit because those domains are explicitly rejected. |
| Python bytecode (`.pyc`) | 106 | Intentionally excluded as generated duplicates of the reviewed source. |
| Text/data/template files | 24 | All 13 text template files were read; `builtin.component.json` and `components.needle.json` were parsed and counted; `schemes.json` and five schema/test fixtures were inspected. `README.md`, `CHANGELOG.md`, and generated `data/ui-reference.llms.md` were treated as secondary orientation only, not implementation evidence (`ui-reference` identifies itself as auto-generated and reports add-on 1.4.1 rather than installed 1.4.2). |
| Binary visual assets | 6 | Five PNG logos/icons and one favicon were intentionally excluded from semantic code review. Their presence and UI references were inventoried; pixel design was already covered by the separate live UI audit. |

This is an implementation and product-scope audit, not a dependency vulnerability audit or a claim that every historical changelog entry was revalidated. Conclusions in this report come from current 1.4.2 source and bundled production contracts, not generated bytecode or marketing copy.

### Bootstrap, Blender helpers, and infrastructure (35)

`__init__.py`, `__meta__.py`, `analytics.py`, `auto_load.py`, `blender_cli.py`, `blender_dialogue.py`, `blender_export.py`, `blender_lifecycle.py`, `blender_materials.py`, `blender_objects.py`, `blender_scene.py`, `blender_windows.py`, `external_process.py`, `settings_addon.py`, `settings_scene.py`, `utils.py`, `utils_addon_data.py`, `utils_auth.py`, `utils_auto_update.py`, `utils_blender.py`, `utils_bugreport.py`, `utils_cli.py`, `utils_debug.py`, `utils_gltf.py`, `utils_icons.py`, `utils_json.py`, `utils_license.py`, `utils_local_server_token.py`, `utils_meta.py`, `utils_npm.py`, `utils_request_helper.py`, `utils_system_requirements.py`, `utils_tools.py`, `utils_version_warnings.py`, `utils_web_project.py`.

### Components and glTF extensions (24)

`component_registry.py`, `component_selector.py`, `component_types.py`, `component_utils.py`, `component_watcher.py`, `components_meta.py`, `extensions/animationhandler.py`, `extensions/asset_utils.py`, `extensions/extensionbase.py`, `extensions/KHR_animation_2.py`, `extensions/material_utils.py`, `extensions/NEEDLE_components.py`, `extensions/NEEDLE_components_export.py`, `extensions/NEEDLE_components_importer.py`, `extensions/NEEDLE_components_postprocess.py`, `extensions/NEEDLE_components_unknown.py`, `extensions/NEEDLE_gameobject_data.py`, `extensions/NEEDLE_lightmaps.py`, `extensions/NEEDLE_persistent_assets.py`, `extensions/NEEDLE_persistent_assets_importer.py`, `extensions/NEEDLE_progressive.py`, `extensions/NEEDLE_texture_compression.py`, `extensions/reference_resolver.py`, `extensions/skybox_utils.py`.

### Lightmapping, viewport helpers, project workflow, panels, and operators (32)

`gizmo_light.py`, `gizmo_reflectionprobe.py`, `gizmo_utils.py`, `gizmos.py`, `image_types.py`, `lightmapping/lightmapping.py`, `lightmapping/lightmapping_common.py`, `lightmapping/lightmapping_pack.py`, `menu_items.py`, `operators_components.py`, `operators_environment.py`, `operators_lightmap.py`, `operators_list.py`, `operators_materials.py`, `operators_meta.py`, `operators_objects.py`, `operators_reflectionprobe.py`, `operators_utils.py`, `operators_web.py`, `panels_bugreport.py`, `panels_common.py`, `panels_components.py`, `panels_components_unknown.py`, `panels_experimental.py`, `panels_lightmapping.py`, `panels_materials.py`, `panels_object.py`, `panels_project.py`, `panels_reflectionprobe.py`, `panels_samples_ai.py`, `panels_settings.py`, `panels_viewport.py`.

### Animation and timeline (9)

`types/animation/animator.py`, `types/animation/animator_conditions.py`, `types/animation/animator_nodes.py`, `types/animation/animator_operators.py`, `types/animation/animator_sockets.py`, `types/animation/animator_transition.py`, `types/animation/animator_utils.py`, `types/animation/register.py`, `types/timeline/timeline_serializer.py`.

### Cloud, AI, sharing, and server (6)

`cloud_upload.py`, `needle_ai.py`, `needle_ai_tools.py`, `needle_ai_websocket.py`, `needle_share.py`, `server/server.py`. Supporting cloud/account behavior is also routed through `analytics.py`, `utils_auth.py`, `utils_license.py`, `utils_local_server_token.py`, and `utils_request_helper.py`, which are counted once in infrastructure.

The numeric grouping above counts each module once: 35 + 24 + 32 + 9 + 6 = 106. `operators_meta.py` is effectively a placeholder. Non-Python primary artifacts were also reviewed where they define product behavior: `data/builtin.component.json`, `data/components.needle.json`, every text file under `templates/`, and the schema/test JSON fixtures described in Coverage accounting.

## Source anchors

All Needle and Blender anchors below point to primary locally installed source. Blendlink anchors point to the current working tree inspected on 2026-07-20.

- **S1 - installed version:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\__init__.py:43-54`.
- **S2 - Needle stock glTF export and `COMPAT`:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\blender_export.py:370-416`.
- **S3 - Blender 5.2 lighting mode definitions/default:** `C:\Program Files\Blender Foundation\Blender 5.2\5.2\scripts\addons_core\io_scene_gltf2\__init__.py:195-206`.
- **S4 - Blender's 683 conversion constant:** `C:\Program Files\Blender Foundation\Blender 5.2\5.2\scripts\addons_core\io_scene_gltf2\blender\com\conversion.py:10-11`.
- **S5 - official glTF light intensity conversion:** `C:\Program Files\Blender Foundation\Blender 5.2\5.2\scripts\addons_core\io_scene_gltf2\blender\exp\lights.py:96-179`.
- **S6 - Blendlink feature-detected glTF export contract, final light-shadow normalization, and nested render-visibility enforcement:** `C:\Users\micha\Documents\GitHub\blendlink\packages\blendlink\blender\export_scene.py:3103-3207`, `:3296-3398`, and `:3400-3582`.
- **S7 - Needle light component and shadow presets:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\extensions\NEEDLE_components_postprocess.py:41-86`; matching Blender properties are in `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\panels_object.py:72-131`.
- **S8 - Needle camera/environment and tone/exposure post-process:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\extensions\NEEDLE_components_postprocess.py:142-229` and `:365-406`.
- **S9 - Needle viewport/world extraction and mutations:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\extensions\skybox_utils.py:45-202`.
- **S10 - Needle reflection-probe authoring UI:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\panels_reflectionprobe.py:7-120`.
- **S11 - Needle reflection-probe bake and settings:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\operators_reflectionprobe.py:295-523`.
- **S12 - Blendlink runtime reflection capture/assignment/rollback:** `C:\Users\micha\Documents\GitHub\blendlink\packages\blendlink\src\reflectionProbes.ts:92-137`, `:211-406`, and `:435-510`.
- **S13 - Needle bundled/project schema registry:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\component_registry.py:38-129`.
- **S14 - Needle component search/category/browser:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\component_selector.py:87-222`, `:229-367`, and `:469-586`.
- **S15 - Needle schema-to-RNA field/type generation:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\component_types.py:764-1002` and `:1030-1103`.
- **S16 - Needle component property panels:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\panels_components.py:434-535`, `:596-837`, and `:860-1042`.
- **S17 - Needle component copy/paste behavior:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\operators_components.py:16-210`.
- **S18 - Needle TypeScript component watcher:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\component_watcher.py:30-195`.
- **S19 - Needle name-derived IDs and cached conflict scan:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\component_utils.py:14-102` and `:265-308`.
- **S20 - Needle unknown-component `str()`/`eval()` round trip:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\extensions\NEEDLE_components_unknown.py:188-207`; another legacy `eval()` is in `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\extensions\NEEDLE_components.py:346-352`.
- **S21 - Blendlink versioned portable component contract and vendor retention:** `C:\Users\micha\Documents\GitHub\blendlink\packages\blendlink\src\components.ts:9-65`, `:83-188`, and `:189-272`.
- **S22 - Blendlink declarative component catalog, browser, structured editing, and shared validation:** `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\component_schema.py:45-363`; `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\components_ui.py:187-589` and `:752-935`; `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\component_validation.py:100-269`.
- **S23 - Needle data-driven gizmos, per-draw scan, arrow bug, and cleanup:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\gizmos.py:18-111`, `:282-308`, and `:313-479`.
- **S24 - Blendlink cached consequence analysis, live transform resolution, and unit GPU batches:** `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\consequence_gizmos.py:151-423`; `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\validation.py:311-421`; `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\overlay.py:138-223`; `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\handlers.py:253-368`.
- **S25 - Needle lightmap selection/contributor visibility/restoration:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\lightmapping\lightmapping.py:169-325` and `:465-527`.
- **S26 - Needle unwrap hash and proxy-quad pack:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\lightmapping\lightmapping_pack.py:11-36`, `:38-90`, and `:149-223`.
- **S27 - Needle RGBM lightmap export/custom extensions:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\extensions\NEEDLE_lightmaps.py:174-231` and `:263-339`.
- **S28 - Blendlink atlas configuration, authored/pinned pack, capacity evidence, and fingerprints:** `C:\Users\micha\Documents\GitHub\blendlink\packages\blendlink\blender\export_scene.py:99-128`, `:1014-1308`, `:1693-1908`, and `:1994-2532`.
- **S29 - Needle material/image discovery and compression UI:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\panels_materials.py:25-72`; `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\image_types.py:3-100`; `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\extensions\material_utils.py:4-66`.
- **S30 - Blendlink active-Surface graph traversal:** `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\procedural.py:141-190`; export consumers are in `C:\Users\micha\Documents\GitHub\blendlink\packages\blendlink\blender\export_scene.py:1598-1643`.
- **S31 - Needle NLA timeline serializer:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\types\timeline\timeline_serializer.py:6-156`.
- **S32 - Needle temporary animation tracks and pointer mapping:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\extensions\animationhandler.py:9-85`, `:92-193`, and `:196-215`.
- **S33 - Needle Animator state-machine serialization:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\types\animation\animator.py:30-94`; transitions are in `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\types\animation\animator_transition.py:10-72`.
- **S34 - Needle dynamic module/class registration and teardown:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\auto_load.py:21-77`, `:83-170`, and `:176-188`.
- **S35 - Needle extension handlers, error isolation, export/import hooks:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\__init__.py:479-524`, `:539-680`, and `:689-741`.
- **S36 - Needle export context, directory clearing, dependencies, and restoration:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\blender_export.py:37-186`, `:280-368`, and `:425-508`.
- **S37 - Needle duplicated project panels, conflict explanation, and preview hierarchy:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\panels_project.py:56-158`, `:160-408`, and `:433-597`.
- **S38 - Needle preview/server/process behavior:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\operators_web.py:105-151`; `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\utils_web_project.py:222-284` and `:313-337`; `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\external_process.py:12-26` and `:50-147`.
- **S39 - Needle project/runtime feature settings:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\settings_scene.py:39-86`.
- **S40 - Blendlink live preview, last-good semantics, and process-tree teardown:** `C:\Users\micha\Documents\GitHub\blendlink\packages\blendlink\src\preview.ts:560-623` and `:758-773`; Blender presentation is in `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\ui.py:780-827`.
- **S41 - Blendlink Blender process sentinel, output tail, inactivity timeout, and tree kill:** `C:\Users\micha\Documents\GitHub\blendlink\packages\blendlink\src\invoke.ts:322-386` and `:519-568`; add-on cancellation/logging is in `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\previewrun.py:121-220`.
- **S42 - maintained Blendlink feature status:** `C:\Users\micha\Documents\GitHub\blendlink\docs\FEATURE_PARITY.md:72-184`.
- **S43 - Needle toolchain drift:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\utils_npm.py:23-30`; `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\templates\vite\package.json:1-23`; `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\utils_system_requirements.py:74-98`.
- **S44 - Needle component data:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\data\builtin.component.json:1-2084` contains 85 top-level schemas; `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\data\components.needle.json:1` contains 146 documentation records.
- **S45 - Blendlink stable-ID creation/storage:** `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\ops.py:405-420`; `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\props.py:1021-1031` and `:1147-1153`; component IDs are authored in `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\components_ui.py:155-166`.
- **S46 - Needle Add-menu helpers:** `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender\menu_items.py:10-139` and `:193-204`.
- **S47 - Blendlink artist-facing atlas evidence and remedies:** `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\ui.py:1697-1988`, `:2535-2783`, and `:2968-3121`.
- **S48 - Blendlink canonical realtime-light diagnostics/policy, Light Data summary, and tests:** `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\weblights.py:110-160` and `:729-862`; the Light Data panel is in `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\ui.py:351-491`; pure-Python coverage is in `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\tests\weblights_test.py:134-705`; real-GLB coverage is in `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\tests\run_headless.py:1458-2333`.
- **S49 - Blendlink reflection-probe inspection, status, and transactional Blender bake:** `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\probe_authoring.py:174-457` and `:460-805`; the Scene Properties panel is in `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\ui.py:1369-1540`; the single-source capture mechanics are in `C:\Users\micha\Documents\GitHub\blendlink\packages\blendlink\blender\bakelib.py:503-614` and `:660-880`.
- **S50 - Blendlink reflection asset validation/publication and automatic Three loading:** `C:\Users\micha\Documents\GitHub\blendlink\packages\blendlink\blender\export_scene.py:388-525` and `:641-720`; `C:\Users\micha\Documents\GitHub\blendlink\packages\blendlink\src\threeRuntime.ts:602-649` and `:973-1002`.
- **S51 - Blendlink one-track NLA validation, reversible Action staging, and deterministic runtime sequence:** `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\nla_sequence.py:63-267` and `:270-511`; `C:\Users\micha\Documents\GitHub\blendlink\packages\blendlink\src\animationSequence.ts:121-328`; Three clip staging is in `C:\Users\micha\Documents\GitHub\blendlink\packages\blendlink\src\threeRuntime.ts:933-949`; Blender regression coverage is in `C:\Users\micha\Documents\GitHub\blendlink\packages\blender-addon\tests\run_headless.py:5709-5856`.

## Final recommendation

Do not turn Blendlink into a smaller Needle Engine. Make it a better Blender-native scene compiler.

The immediate non-regression criterion remains exact realtime light parity
through the stock glTF `COMPAT` contract. The reflection-probe workflow,
searchable behavior browser, trustworthy batch editing, cached consequence
guides, and slim NLA sequence identified by this audit are now implemented.
The next work is validation rather than indiscriminate breadth: run the full
release gate, complete the real-browser reflection orientation/visual matrix,
and add further guides or components only when a recurring artist job justifies
their runtime and lifecycle cost. That preserves the areas where Blendlink is
already deeper: editable atlases, stable portable identity, explicit ownership,
truthful preview failure behavior, and evidence-backed fidelity.
