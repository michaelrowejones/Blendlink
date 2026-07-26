# Needle component audit and best-implementation plan

Status: audit complete; implementation in progress, 2026-07-21

## Decision

Blendlink should pursue useful component parity, not literal Needle component-count parity.

The installed Needle add-on exposes a broad and well-organized catalog, but the source audit shows that several cards are thin wrappers, infrastructure disguised as artist features, coupled to networking or Needle's application shell, or weaker than Blendlink's existing behavior. The right product is a smaller coherent core that covers the recurring jobs of a Blender artist making a polished website:

1. make the scene look intentional;
2. make it responsive and interactive;
3. add believable motion, audio, and physics;
4. preview the exact website result quickly;
5. ship without inheriting a game engine or cloud platform.

The immediate technical move is to keep Blendlink's authored component records renderer-neutral and put implementation choice behind shared runtime services. WebGL should remain the production path. A TSL adapter should be developed alongside it, but not become the default while Three.js still describes `WebGPURenderer` as experimental and notes that `WebGLRenderer` can remain faster or more complete for some scenes. TSL is nevertheless the right future seam: it transpiles to WGSL or GLSL and its post stack can combine passes automatically ([Three.js WebGPU guide](https://threejs.org/manual/en/webgpurenderer), [TSL post-processing reference](https://threejs.org/docs/TSL.html#post-processing)).

This plan deliberately does not import Needle source. It uses the installed source as behavioral evidence, then chooses the best suitable public implementation or technical reference for each job.

## Scope and evidence

The audit used the locally installed Blender add-on `Needle Engine Exporter for Blender` version 1.4.2 and the locally installed `@needle-tools/engine` runtime version 5.1.7. The add-on's `builtin.component.json` contains 85 Blender schemas and `components.needle.json` contains 146 runtime metadata records. Their selectable, non-abstract intersection is 84 components; `PlayerState` is the one schema without matching selectable runtime metadata.

The catalog below records every one of those 84 selectable components. Multiplayer, rooms, voice, synchronization, and the networked Avatar are explicitly excluded from Blendlink's product promise. XR is recorded so the comparison stays honest, but remains deferred because the current product is Blender-to-Three.js websites rather than an XR application framework.

Classification means:

- **Already in Blendlink** — the component or a stronger system-level equivalent exists now.
- **Parity gap** — useful recurring artist capability that should be added.
- **Improve beyond Needle** — worth adding or extending, but the inspected Needle behavior is not the target implementation.
- **Defer** — valid but niche, application-owned, expensive relative to demand, or outside the current promise.

## Complete catalog disposition

### Animation, assets, cameras, characters, and constraints

| Needle component | Classification | Blendlink disposition |
|---|---|---|
| Animation | Already in Blendlink | Existing exported clips and Three `AnimationMixer` support cover direct clip playback. Add crossfade, randomized offset, speed range, and clamp controls to the animation action rather than a second animation system. |
| Animator | Defer | A full parameterized state-machine editor is a product of its own. First ship a typed trigger/action graph and clip crossfades; revisit a state machine only after real projects exceed that model. |
| PlayableDirector | Already in Blendlink | Blendlink's authored animation sequence/timeline is the system-level equivalent. Keep the data renderer-neutral and expose markers/events incrementally. |
| DropListener | Defer | Drag-and-drop import is a website/application concern, not portable scene behavior. Offer an application hook later. |
| SceneSwitcher | Defer | Multi-scene routing belongs in the delivery graph and site shell. A future component can request a stable scene ID without owning loading UI or URLs. |
| Camera | Already in Blendlink | Blender cameras, website look, environment ownership, and responsive framing already cover the recurring job. Add render-to-texture only when a mirror/portal use case justifies it. |
| OrbitControls | Already in Blendlink | Existing Orbit/Fly controls and responsive frames are stronger defaults. Retain official Three controls and add polished transition/fit presets; Three documents both auto-rotate and damping in the official [`OrbitControls`](https://threejs.org/docs/pages/OrbitControls.html). |
| ViewBox | Improve beyond Needle | Needle temporarily mutates a perspective camera's view/projection. Blendlink should keep responsive frames as the primary artist model and later add a named viewport-region adapter that supports perspective and orthographic cameras without persistent camera mutation. |
| CharacterController | Improve beyond Needle | Use Rapier's real kinematic character controller instead of moving the object transform directly. It includes move-and-slide, slopes, stairs, small obstacles, moving platforms, and collision results ([Rapier character controller](https://rapier.rs/docs/user_guides/javascript/character_controller/)). |
| CharacterControllerInput | Improve beyond Needle | Separate input mapping from motion. Supply an optional keyboard/touch preset, but let sites inject actions; include reduced-motion and focus/typing guards. |
| AlignmentConstraint | Parity gap | Add a low-priority `Span Between Objects` constraint with from/to references, axis, width, and centering. Use time-independent transforms and clear missing-reference diagnostics. |
| OffsetConstraint | Parity gap | Add a general `Follow Transform` constraint with position/rotation/scale channels, local/world space, and time-constant smoothing. |

### Post-processing and common actions

| Needle component | Classification | Blendlink disposition |
|---|---|---|
| Antialiasing | Implemented runtime policy | The shared WebGL post target now requests 2x/4x/8x MSAA for Low/Balanced/High, clamps to the renderer's actual `maxSamples`, and reports the resolved count. It remains runtime quality rather than an artist-authored effect; a physical-device fallback study and TSL TRAA remain future work. |
| BloomEffect | Implemented core; collection gap | The shared WebGL stack now maps Bright Pixels and Emissive Objects to pmndrs `BloomEffect`/`SelectiveBloomEffect`, with mipmapped blur, quality policy, and selection cleanup. Selected Collection still needs a stable exported collection-membership contract; future target: TSL `bloom`. |
| ChromaticAberration | Implemented | A restrained post-LDR effect now exposes amount plus truthful directional/radial controls and center, preserves alpha, defaults subtly, and warns at strong values because they harm readability. |
| DepthOfField | Implemented | pmndrs `DepthOfFieldEffect` now supports physical focus distance or a rename-stable moving focus object, focus range, blur strength, quality policy, and clipping-range diagnostics. Needle's non-behavioral Gaussian/Bokeh selector was not copied. |
| PixelationEffect | Implemented | Pixel size is authored in CSS pixels and remains stable across DPR. Zero edge strengths use pmndrs' cheaper color-only effect; optional depth/normal emphasis shares buffers and warns about transparent-edge limits. TSL's `pixelationPass` remains the future renderer reference ([TSL reference](https://threejs.org/docs/pages/TSL.html#pixelationPass)). |
| ScreenSpaceAmbientOcclusionN8 | Implemented core | The WebGL adapter pins N8AO 1.10.2, provides world/screen radius, tint/intensity, transparency diagnostics, depth-aware half resolution, and bounded adaptive profiles. The inspected published package does **not** implement neural presets; controls from examples, branches, or future releases remain excluded. |
| SharpeningEffect | Implemented beyond Needle | Blendlink does not port Needle's dynamic `(2r+1)^2` blur loop. One bounded amount controls a fixed-footprint FidelityFX-CAS-style WebGL pass; TSL `sharpen(..., denoise)` remains the future path. |
| TiltShiftEffect | Implemented | The photographic pmndrs `TiltShiftEffect` adapter exposes focus position, angle, feather, strength, and bounded quality policy before tone mapping. |
| ToneMappingEffect | Already in Blendlink | Keep one owner: Website Look/render settings. Do not create a second component that can double-apply exposure or tone mapping. |
| Vignette | Already in Blendlink | Keep Blendlink's intensity, softness, and tint. The inspected Needle runtime only applies intensity-derived offset/darkness even though its schema exposes center/color, so Blendlink already has the more truthful contract. |
| ChangeMaterialOnClick | Improve beyond Needle | Implement a material-variant action addressed by stable material/slot IDs. Needle's browser path replaces matching materials but its exposed fade is only used by USDZ behavior; Blendlink should either perform a real crossfade or label the switch instant. |
| ChangeTransformOnClick | Parity gap | Add a reusable transform action with position/rotation/scale target, local/world space, duration, easing, interrupt policy, and physics handoff. Use quaternion slerp for rotation. |
| EmphasizeOnClick | Improve beyond Needle | Implement actual browser hover/click/focus emphasis. The inspected Needle class registers accessibility metadata but its emphasis execution is a USDZ behavior, not a browser click handler. |
| HideOnStart | Already in Blendlink | Retain. Express internally as initial active state so it composes with later Set Active actions. |
| LookAt | Already in Blendlink | Retain and extend with aim axis, up policy, invert, and optional damping. |
| PlayAnimationOnClick | Already in Blendlink | Retain; add crossfade, restart/ignore/queue policy, speed, and clip completion events. |
| PlayAudioOnClick | Already in Blendlink | Retain; add play/pause/stop/restart and fade duration through the shared audio service. |
| SetActiveOnClick | Parity gap | Add a generic Set/Toggle Visibility action that targets stable IDs and optionally affects interactivity and audio, not only `Object3D.visible`. |
| AxesHelper | Defer | Provide as a Preview Studio debug overlay, never a shipped component. |
| GridHelper | Defer | Provide as a Preview Studio debug overlay, never a shipped component. |
| TransformGizmo | Defer | Use official Three [`TransformControls`](https://threejs.org/docs/pages/TransformControls.html) in Preview Studio or an explicit editor mode; do not silently ship an editing tool. |

### Interaction, media, physics, rendering, UI, and web integration

| Needle component | Classification | Blendlink disposition |
|---|---|---|
| CursorFollow | Parity gap | Add a low-cost `Follow Pointer` constraint with screen/world plane modes, max travel, and reduced-motion fallback. |
| Deletable | Defer | Its inspected runtime is intertwined with network destruction. A local product-configurator deletion action can be added after the generic action system. |
| DeleteBox | Defer | Niche authoring primitive. Later model as a Rapier sensor plus Destroy/Hide action rather than a bespoke component pair. |
| DragControls | Improve beyond Needle | Split `Drag on Surface` from editor `Transform Gizmo`. Use Pointer Events, ray/plane or surface constraints, pointer capture, and Rapier kinematic motion when physics is present. XR dragging is a separate adapter. |
| Duplicatable | Defer | Useful for configurators but not foundational. A future local-only version should clone from a stable template, allocate fresh runtime IDs, apply pooling/limits, and avoid networking imports. |
| EventTrigger | Improve beyond Needle | Build a typed trigger/action graph instead of serializing arbitrary method callbacks. Initial triggers: click, double click, hover enter/leave, focus, key activate, visibility, timer, animation marker, sensor enter/exit. |
| HoverAnimation | Already in Blendlink | Keep the simple accessible Hover component, then let it author emphasis actions rather than owning a parallel animation subsystem. |
| ObjectRaycaster | Defer | This is runtime infrastructure. A target should become interactive automatically when it has an interaction component. Accelerate dense static meshes with `three-mesh-bvh` when profiling warrants it. |
| OpenURL | Already in Blendlink | Retain Blendlink's URL scheme validation and controlled application hook. Provide a semantic link in the accessibility overlay; new tabs must use safe opener isolation. |
| SmoothFollow | Parity gap | Add a `Follow Object` constraint with position/rotation channels, dead zone, local/world offsets, and exponential damping. |
| SpatialTrigger | Improve beyond Needle | Implement as a Rapier sensor/event subscription when physics is enabled and a broadphase spatial index otherwise. Do not repeat Needle's per-frame receiver-by-trigger `BoxHelper` intersection loop. |
| SpatialTriggerReceiver | Improve beyond Needle | Fold into typed sensor filters on the receiving object; expose layer/tag filters and enter/stay/exit triggers. |
| AudioSource | Already in Blendlink | Keep the component but port Needle's strongest runtime ideas: one shared listener/context, gesture-safe resume, page-visibility lifecycle, click-free gain ramps, and a dual spatial/non-spatial gain graph. |
| VideoPlayer | Shipped Boundary plus remaining parity gap | Exact Needle Engine 5.1.7 source (`experiments/needle-spike/node_modules/@needle-tools/engine/src/engine-components/VideoPlayer.ts`, `engine-video-player`, SHA-256 `5307ddd7a03938d32ee46bf5fb13fa5bb7bd1666231f7b096d6111904711249a`) creates an sRGB `VideoTexture`, clones and replaces one scalar target material, and owns playback/media policy. Blendlink's shipped [Website Surface](research-website-surface-needle-2026.md) keeps arbitrary canvas pixels and hover/focus/route state in the application while owning semantic binding, material isolation, invalidation, restoration, and disposal; v1 requires a dedicated Realtime one-material mesh with authored UV0 and keeps baked `setState()` separate. Focused package/Blender/production-browser dogfood passed on 2026-07-25, but no same-fixture Needle execution exists, so cleanup remains an Improvement candidate rather than proven comparative Improvement. A full `Video Surface` with URL/CORS, muted autoplay, audio, loop, poster, fit/crop, and visibility-aware pause remains a parity gap. Three's `VideoTexture` must be recreated when its video source changes ([Three.js `VideoTexture`](https://threejs.org/docs/pages/VideoTexture.html)). |
| Attractor | Defer | Niche physics behavior. It becomes easy to add as a force action after the physics service exists. |
| BoxCollider | Parity gap | Add to the Rapier batch with trigger mode, friction, restitution, density, collision groups, and visible preview shape. |
| MeshCollider | Improve beyond Needle | Add with safe defaults: fixed/static trimesh only; offer convex hull for moving bodies; warn on non-applied scale, excessive triangles, and dynamic concave meshes. Rapier documents the supported collider shapes and their tradeoffs ([Rapier colliders](https://rapier.rs/docs/user_guides/javascript/colliders/)). |
| Rigidbody | Parity gap | Add fixed/dynamic/kinematic modes, gravity scale, damping, axis locks, sleep, CCD, initial velocities, and explicit fixed timestep ownership. |
| SphereCollider | Parity gap | Add to the Rapier batch. Also add Capsule Collider because it is a common, cheap shape and the Needle Blender catalog omits it despite runtime support. |
| ContactShadows | Improve beyond Needle | Add optional ground contact shadows with auto-fit, static/on-change update, half-resolution quality, blur, opacity, and an explicit warning when baked grounding already exists. |
| Fog | Already in Blendlink | Blendlink already supports linear and exponential-squared fog with explicit ownership; the inspected Needle component ultimately installs Three linear `Fog` despite a broader-looking enum. |
| GroundProjectedEnv | Already in Blendlink | Retain the existing `GroundedSkybox` adapter and artist-facing environment controls. Three provides the reference implementation as [`GroundedSkybox`](https://threejs.org/docs/pages/GroundedSkybox.html). |
| ReflectionProbe | Already in Blendlink | Retain Blendlink's baked/runtime/custom probe workflow and deterministic ownership. Needle's runtime applies PMREM plus per-renderer material overrides; it does not require a competing component model. |
| RemoteSkybox | Already in Blendlink | Existing environment/source controls cover the useful behavior. URL/file-drop plumbing stays application-owned. |
| SeeThrough | Already in Blendlink | Blendlink's camera-to-subject ray test is stronger than Needle's inspected forward-direction dot-product check. Improve it with BVH acceleration, alpha hash/dither mode, and temporary shadow/raycast suppression while faded. |
| ShadowCatcher | Improve beyond Needle | Ship `Shadow Mask` using Three `ShadowMaterial` and `Occluder` depth-only mode. Keep additive relighting experimental: Needle's path patches shader source with a fixed `6.6` multiplier and `onBeforeCompile`, which is not a portable WebGPU strategy. |
| Button | Improve beyond Needle | Do not create a separate mesh-button runtime. Any object with an activation trigger can opt into an accessible label, description, role, disabled state, focus treatment, and Space/Enter activation. |
| DeviceFlag | Improve beyond Needle | Replace UA-based mobile/desktop flags with `Runtime Visibility`: viewport class, coarse/fine pointer, reduced motion, save-data, memory/performance tier, and optional application feature flags. |
| ClickThrough | Defer | Canvas/page pointer pass-through is embedding policy. Expose it as a site adapter option, not data attached to a Blender object. |
| ScrollFollow | Improve beyond Needle | Define a normalized external progress input and bindings to animation, transform, camera, or material values. A site adapter can use native Scroll/View Timelines; the core must not assume iframe/top-window ownership or import a polyfill globally. |

### Networking and XR

These nine components are excluded, not missing parity: `Networking`, `PlayerColor`, `ScreenCapture`, `SpectatorCamera`, `SyncedCamera`, `SyncedRoom`, `SyncedTransform`, `Voip`, and the networked `Avatar`. Screen capture can be offered later by Preview Studio or the host site without adopting Needle's room/player architecture.

| Needle component | Classification | Blendlink disposition |
|---|---|---|
| TeleportTarget | Defer | Only useful after a deliberate XR runtime exists. |
| USDZExporter | Defer | Treat USDZ/Quick Look as a separate compiler/export target, not a Three runtime component. Apple's model-preview path has its own Quick Look contract ([Apple AR Quick Look](https://developer.apple.com/augmented-reality/quick-look/)). |
| WebARCameraBackground | Defer | Requires session permission, camera composition, and device-specific validation beyond the current website promise. |
| WebARSessionRoot | Defer | XR application infrastructure, not general scene behavior. |
| WebXR | Defer | If adopted later, build a small optional adapter over Three's [`WebXRManager`](https://threejs.org/docs/pages/WebXRManager.html) and official AR/VR button helpers. |
| WebXRImageTracking | Defer | Feature/platform support remains fragmented; the Immersive Web sample site labels proposal APIs as in flux ([Immersive Web proposals](https://immersive-web.github.io/webxr-samples/proposals/)). |
| WebXRPlaneTracking | Defer | Same reason; requires a real target project and capability-specific fallbacks. |
| XRControllerFollow | Defer | Straightforward future adapter once session/controller ownership is defined. |
| XRControllerModel | Defer | Straightforward future adapter over Three's controller/hand model factories. |
| XRControllerMovement | Defer | Comfort, locomotion, teleport collision, and session UI need to be designed as a coherent XR subsystem. |
| XRFlag | Defer | Its useful generalization is Runtime Visibility, which can ship without XR. |
| XRRig | Defer | XR application infrastructure. |

## What the installed Needle implementation teaches us

The add-on's layout is worth learning from; the runtime implementation should not be treated as a gold standard.

### Good patterns to adopt

- The component picker is target-aware, grouped by outcome, searchable, and driven by declarative field metadata.
- Post effects register into one `PostProcessingHandler`, and compatible pmndrs effects can be combined in an `EffectPass`. pmndrs explicitly designs `EffectPass` to merge effects and reduce fullscreen render operations, using a single fullscreen triangle ([pmndrs postprocessing](https://github.com/pmndrs/postprocessing#performance)).
- Runtime-heavy systems are loaded dynamically. Blendlink should preserve that property: a scene without physics, post effects, video, or XR should not download those adapters.
- `AudioSource` handles browser reality unusually well: gesture unlock, tab visibility, entry ramps, and spatial/non-spatial crossfade are all worth porting as behavior.
- The installed runtime uses Rapier, N8AO, pmndrs postprocessing, `three-mesh-bvh`, and official Three helpers rather than reinventing every primitive. Blendlink should keep making similarly selective dependencies.

### Places to exceed Needle

- **Catalog truthfulness:** exposed controls must affect the browser result. In the inspected Vignette runtime, center/color fields are not applied; Depth of Field presents two modes that instantiate the same effect; Change Material's fade does not fade in the normal browser path.
- **Physics correctness:** Needle's inspected Character Controller moves `gameObject.position` directly and derives grounded state from contact normals. Rapier's built-in KCC already solves motion with shape casts and reports slopes, stairs, moving platforms, and collisions.
- **Trigger scalability:** Needle's inspected Spatial Trigger loops through receivers/triggers and intersects `BoxHelper`s every frame. Rapier sensor intersections and event queues are both more scalable and semantically correct; collision groups filter work early in the pipeline ([Rapier collision groups](https://rapier.rs/docs/user_guides/javascript/collider_collision_groups/), [simulation events](https://rapier.rs/docs/user_guides/javascript/simulation_structures/)).
- **Occlusion correctness:** Needle's See Through checks obstacle direction against camera forward every 20 frames. Blendlink already performs the meaningful camera-to-subject query. Three's [`Raycaster`](https://threejs.org/docs/pages/Raycaster.html) plus optional [`three-mesh-bvh`](https://github.com/gkjohnson/three-mesh-bvh) is the better scaling path.
- **Bounded shader cost:** Needle's sharpening shader uses a radius-dependent nested sample loop. Artist sliders should not accidentally create quadratic GPU work. A fixed-footprint contrast-adaptive pass is safer.
- **Renderer portability:** Needle's additive shadow catcher uses `onBeforeCompile`; Three documents that custom `ShaderMaterial`, `RawShaderMaterial`, and `onBeforeCompile` modifications do not migrate to `WebGPURenderer` and must be expressed as nodes/TSL ([Three.js WebGPU migration notes](https://threejs.org/manual/en/webgpurenderer#migration)).
- **Separation of scene and app:** click-through, dropped files, top-window scrolling, QR codes, cloud rooms, and editor gizmos should be host/preview adapters. Keeping them out of the portable scene contract makes Blendlink usable in React, vanilla Three, a custom render loop, and future renderers.

## Best implementation targets

### Shared post-processing pipeline first

Blendlink currently creates a Three `EffectComposer` and independent passes for Bloom and Vignette. Before adding more effects, replace that with one `PostPipelineService` that owns color/depth targets, order, resolution, alpha behavior, resize, disposal, and quality changes.

For production WebGL, use `postprocessing` 6.39.3 while Blendlink remains on a compatible Three release. That exact published package accepts Three `>=0.168.0 <0.186.0` ([6.39.3 package manifest](https://raw.githubusercontent.com/pmndrs/postprocessing/v6.39.3/package.json)). Pin the compatible pair and enforce it in tests; do not float either independently.

Canonical phases should be semantic, not an arbitrary artist-reorderable list:

1. scene color, depth, normals, and optional velocity;
2. geometry/depth effects such as AO;
3. focus/lens effects such as depth of field;
4. HDR light effects such as bloom;
5. tone mapping and output color transform, owned once;
6. LDR creative effects such as Kuwahara, LUT, pixelation, chromatic aberration, vignette, and sharpening;
7. final edge AA where applicable.

Some effects need a limited `before tone map`/`after tone map` expert option, but impossible orders should remain impossible. The runtime should report the resolved order in diagnostics.

| Artist effect | Production WebGL target | Future TSL/WebGPU target | Artist controls and policy |
|---|---|---|---|
| Bloom | pmndrs `BloomEffect`; `SelectiveBloomEffect` for collection/selection masks; mipmapped blur | TSL `bloom` | What blooms, intensity, threshold, softness/radius; preview false-color threshold mask. |
| Vignette | Existing Blendlink tint shader reimplemented as a pmndrs custom `Effect`, so it can fuse with compatible effects | Small TSL node | Amount, softness, roundness/aspect behavior, tint. Keep transparent canvas alpha unchanged. |
| Chromatic aberration | pmndrs `ChromaticAberrationEffect` | TSL `chromaticAberration`/`rgbShift` | Amount in visually bounded units, radial toggle, center. Strong-value warning. |
| Depth of field | pmndrs `DepthOfFieldEffect` | TSL `dof`, which Three describes as the newer renderer's improved path | Focus object/distance, focus picker, blur strength, quality. Warn for alpha-heavy scenes and tiny near/far ranges. |
| Pixelation | pmndrs `PixelationEffect` | TSL `pixelationPass` | Pixel size in CSS pixels, optional geometry edges, DPR-stable result. |
| AO | Current N8AO `N8AOPostPass` | TSL GTAO `ao` plus `denoise` | World/screen radius, strength, quality preset, color. Runtime owns half-resolution/adaptive quality. |
| Sharpen | FidelityFX CAS-style fixed-footprint pass; license and shader attribution retained | TSL `sharpen` with denoise | Amount only in Basic; reveal denoise/upsample in Advanced. CAS is documented by AMD as a low-overhead adaptive sharpener with optional upsampling ([FidelityFX CAS](https://gpuopen.com/manuals/fidelityfx_sdk/techniques/contrast-adaptive-sharpening/)). |
| Tilt shift | pmndrs `TiltShiftEffect` | TSL custom composition until an official node is suitable | Focus band position/angle, feather, strength, quality. |
| Selection outline | pmndrs `OutlineEffect` | TSL `outline` | Selected objects/collection, visible/hidden colors, x-ray toggle, thickness, pulse. pmndrs supports selection, x-ray, blur, patterns, and half-resolution targets ([OutlineEffect reference](https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/OutlineEffect.js~OutlineEffect.html)). |
| Toon outline | Three `OutlineEffect` or a purpose-built normal/depth post pass, selected by look | TSL `toonOutlinePass` | Whole scene/collection, thickness, color, crease/depth sensitivity. Keep separate from selection feedback. |
| Color grading LUT | pmndrs `LUT3DEffect` | TSL `lut3D` | `.cube`/3D LUT asset, intensity, before/after creative effects. This is a useful artist feature Needle's Blender catalog does not expose. |
| Kuwahara | Custom multi-scale anisotropic pass based on the papers below | Equivalent TSL node graph/custom node | Style strength, brush scale, anisotropy, detail preservation, temporal stability, quality. Half/quarter-res profiles and optional depth/normal edge guidance. |

N8AO is the right WebGL baseline today because it supports orthographic cameras, logarithmic depth, alpha clipping, displacement, screen-space radius, and a depth-aware half-resolution mode that its author measures as generally 2–4× faster. Source inspection of the pinned npm release 1.10.2 confirms only `Performance`, `Low`, `Medium`, `High`, and `Ultra`; neural presets are therefore excluded until they exist in a compatible published release and pass the same scene matrix. The adapter must inspect transparency: N8AO renders transparent objects an extra time when transparency-aware mode is active, so the cost can be material in glass-heavy scenes ([N8AO transparency notes](https://github.com/N8python/n8ao#transparency)).

### Kuwahara: build the differentiator from the research, not a random shader snippet

The desired effect is not the original square-window Kuwahara filter. The production target should be multi-scale anisotropic Kuwahara filtering:

- Kyprianidis, Kang, and Döllner's anisotropic filter aligns an elliptical kernel with local image structure, producing painterly abstraction while preserving directional edges ([2009 paper](https://www.kyprianidis.com/p/pg2009/jkyprian-pg2009.pdf)).
- Their polynomial weighting formulation avoids sector texture lookup and is well suited to GPU evaluation ([2010 paper](https://www.kyprianidis.com/p/tpcg2010/jkyprian-tpcg2010.pdf)).
- The multi-scale extension varies kernel scale from local structure and supports coherent image/video abstraction ([2011 paper and examples](https://www.kyprianidis.com/p/npar2011/index.html), [paper PDF](https://www.kyprianidis.com/p/npar2011/jkyprian-npar2011.pdf)).

Implementation should therefore have three internal stages: structure tensor/orientation, anisotropic sector statistics, and edge-aware composition. The artist should see `Brush Scale`, `Directionality`, `Detail`, and `Strength`, not tensor eigenvalues. Performance tiers can vary input resolution, sector/sample count, and whether depth/normal guidance is enabled. Temporal tests must include animated cameras and skinned meshes; a still image that looks attractive but crawls or shimmers is not acceptable.

### Rendering helpers

- **Contact shadows:** keep Needle's useful orthographic depth + separable blur concept, but update only when required. `Static`, `On Change`, and `Every Frame` must be explicit. Auto-fit should ignore collision proxies/helpers and use the rendered subject bounds. Disable or warn when the baked appearance already includes grounding.
- **Shadow catcher:** Three's [`ShadowMaterial`](https://threejs.org/docs/pages/ShadowMaterial.html) is the production basis for a transparent shadow mask. An occluder uses depth write with color write disabled. Additive relighting remains experimental until it has a physically explainable composition and a TSL path.
- **See through:** keep camera-to-subject ray or shapecast semantics. Use a shared material override cache, dither/alpha-hash option, and a stable set-diff so entering/leaving obstacles do not allocate every frame. Dense static meshes can opt into BVH acceleration.
- **Reflection/environment:** stay system-owned. Ground projection, probes, tone mapping, and fog should not be duplicated as arbitrary stack components when Blendlink already has deterministic scene-level ownership.

### Physics and spatial interaction

Use `@dimforge/rapier3d-compat` as a lazy production dependency initially for broad deployment, with an opt-in SIMD build only after capability and determinism tests. Rapier's JavaScript project documents both regular and deterministic compatibility builds ([Rapier JS repository](https://github.com/dimforge/rapier.js/)).

The first physics schema should cover:

- rigid body: Fixed, Dynamic, Kinematic Position, Kinematic Velocity;
- collider: Auto, Box, Sphere, Capsule, Convex Hull, Trimesh;
- material: friction, restitution, density/mass override;
- stability: sleep, CCD, translation/rotation locks, gravity scale;
- filtering: artist-named collision layers compiled to Rapier membership/filter masks;
- sensor: enter/stay/exit triggers with optional tags/layers;
- debugging: preview shapes, center of mass, sleeping state, contact/sensor log;
- simulation: fixed timestep with a capped accumulator and interpolation for render transforms.

Collision groups are preferable to late solver filtering when contact data is not needed because Rapier filters them before narrow-phase work ([Rapier collision groups](https://rapier.rs/docs/user_guides/javascript/collider_collision_groups/)). Scene ray/shape queries accept filters for body type, groups, sensors, and excluded bodies ([Rapier scene queries](https://rapier.rs/docs/user_guides/javascript/scene_queries/)); the same authored layer model should drive physics, drag placement, character movement, and see-through exclusions where appropriate.

Character movement should wrap Rapier KCC rather than hide it. Basic UI: radius, height, step height, maximum slope, snap to ground, movement speed, jump. Advanced UI: offset, autostep minimum width, slide, moving-platform impulse, collision layers. Rapier recommends cuboid, ball, or capsule shapes for lower cost and fewer numerical approximations ([Rapier KCC guidance](https://rapier.rs/docs/user_guides/javascript/character_controller/)).

### Interaction and accessibility

The portable model should be a small typed graph:

```text
Trigger -> optional conditions -> one or more actions
```

Examples:

```text
Activate(ProductButton) -> Material Variant(Product, "Blue")
Hover(Product) -> Emphasis(Product, 1.04, outline)
Sensor Enter(DoorZone, layer=Visitor) -> Play Clip(Door, "Open")
Scroll Progress(Hero) -> Set Timeline Progress(HeroReveal)
```

Keep that graph as Blendlink's artist-facing model, but lower the portable
subset to standards instead of trapping every behavior in a Blendlink-only
runtime. The first compiler target to evaluate is Khronos
[`KHR_interactivity`](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_interactivity/Specification.adoc).
Where a behavior is more specifically represented by a ratified glTF
extension, prefer that smaller contract: material choices through
[`KHR_materials_variants`](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_variants/README.md),
hierarchical active state through
[`KHR_node_visibility`](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_node_visibility/README.md),
and material/camera/extension-property animation through
[`KHR_animation_pointer`](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_animation_pointer/README.md).
Blendlink still needs its own runtime adapter and validation because Three.js
support is not universal, but the authored graph should have a deterministic,
inspectable standard lowering whenever its semantics fit. Unsupported nodes
remain explicit Blendlink extensions rather than being approximated silently.

Pointer handling should use the device-agnostic Pointer Events model rather than separate mouse/touch paths ([W3C Pointer Events](https://www.w3.org/TR/pointerevents3/)). Any object with Activate must also create or integrate with a DOM accessibility target. A button activates on Space and Enter and needs an accessible name; a navigation action should be a semantic link rather than a button-shaped div ([WAI-ARIA button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/)). Focus, disabled/toggle state, keyboard activation, visible focus treatment, and `prefers-reduced-motion` are acceptance criteria, not optional polish.

Scroll Follow should consume normalized progress from an injected source. The browser adapter may use `ScrollTimeline` or `ViewTimeline`, whose specification defines scroll- and view-progress timelines on top of Web Animations ([CSS Scroll-driven Animations](https://drafts.csswg.org/scroll-animations-1/)). This keeps the scene usable when embedded in React, an iframe, a scroll container, or a site whose animation framework owns scroll.

All damped follow/look/constraint behavior must use a time-constant form such as `alpha = 1 - exp(-lambda * dt)`, not `dt / duration` linear interpolation, which can overshoot after a stalled frame.

### Audio and video

Keep Three `AudioListener`/`PositionalAudio` as the scene binding, but put browser lifecycle in one `AudioRuntimeService`:

- one context/listener per installed scene runtime, reference-counted;
- resume only after a trusted user gesture and report blocked autoplay clearly;
- short gain ramps for play/stop/spatial-mode transitions to avoid clicks;
- dual signal paths for continuous 2D-to-3D `Spatial Blend`;
- `linear`, `inverse`, and `exponential` distance models with artist presets;
- configurable page-hide pause and deterministic resume;
- decode/cache by stable asset URL; disposal disconnects every node.

The Web Audio specification defines the `PannerNode` spatial model and its distance/cone parameters ([Web Audio API](https://webaudio.github.io/web-audio-api/#PannerNode)). UI labels should remain concrete: `Full Volume Within`, `Fade`, and `Silent Beyond`, with the mathematical model in Advanced.

Video Surface should clone only the affected material slot, preserve the original for disposal, assign an sRGB `VideoTexture`, and pause when it is not visible unless the artist opts out. Muted inline playback is the safe autoplay preset; unmuted playback must wait for activation.

## Renderer-neutral component architecture

### Preserve the current envelope for the first batches

The existing record already has the important properties: stable ID, namespaced semantic type, explicit schema version, enabled state, stable target, and JSON values. Do not reshape it merely to copy Needle.

```ts
interface PortableComponentRecord {
  id: string
  type: string                 // e.g. blendlink.bloom
  schemaVersion: 1
  enabled: boolean
  target: SceneTarget | ObjectTarget
  values: JsonObject           // authored intent only
}
```

New component types and optional definition metadata are additive. Object/material/collection/asset references can initially follow the current `...Id` plus diagnostic `...Name` convention. If Blendlink later introduces a tagged reference object, per-type schema versions, material targets, or an authored graph envelope, that is a real schema reshape and must bump the relevant manifest/component version with a migration; readers must refuse unsupported versions loudly.

Unknown namespaced records must continue to round-trip. An enabled component with no installed runtime adapter remains a loud publish/runtime error, never a silent skip.

### Expand definitions, not records

The component registry should gain non-serialized metadata:

```ts
interface ComponentDefinition {
  id: string
  label: string
  summary: string
  category: string
  targets: readonly TargetKind[]
  phase?: 'initial' | 'update' | 'fixed' | 'post-depth' | 'post-hdr' | 'post-ldr'
  cardinality: 'one-per-target' | 'many-per-target' | 'one-per-scene'
  requires: readonly RuntimeCapability[]
  conflicts: readonly string[]
  cost: 'free' | 'low' | 'medium' | 'high' | 'very-high'
  fields: Readonly<Record<string, ComponentField>>
  adapters: { webgl: SupportLevel; tsl: SupportLevel; fallback?: string }
}
```

`RuntimeCapability` is semantic (`depth`, `normals`, `velocity`, `physics`, `audio`, `pointer`, `dom-accessibility`, `scroll-source`), not a package name. That lets a WebGL runtime satisfy `depth` through an `EffectComposer` target and a TSL runtime satisfy it through a render pipeline node.

### Shared services and adapter lifecycle

```ts
interface RuntimeComponentAdapter {
  install(record: PortableComponentRecord, context: RuntimeContext):
    | ComponentInstallation
    | Promise<ComponentInstallation>
}

interface ComponentInstallation {
  update?(deltaSeconds: number): void
  fixedUpdate?(fixedDeltaSeconds: number): void
  resize?(width: number, height: number, pixelRatio: number): void
  beforeRender?(): void
  afterRender?(): void
  setQuality?(quality: RuntimeQuality): void
  dispose(): void
}
```

The context supplies narrow services, not an unrestricted engine singleton:

- `PostPipelineService.add(semanticEffectDescriptor)`;
- `InteractionService.addTarget(...)` and `ActionService.invoke(...)`;
- `PhysicsService.addBody/addCollider/addSensor/query(...)`;
- `AudioRuntimeService.addSource(...)`;
- `AssetService.resolve(stableAssetId)`;
- `AccessibilityService.addButton/addLink(...)`;
- `QualityService` and diagnostics.

Every installation owns and restores its mutations. Material clones, listeners, DOM nodes, audio nodes, render targets, animation mixers, physics handles, and subscriptions must all be disposed. Adapter installation is transactional: on failure, dispose previously installed pieces and report component type, stable ID, target, and cause.

### WebGL and TSL adapters

The semantic component does not know its renderer:

| Semantic record | WebGL adapter | TSL/WebGPU adapter |
|---|---|---|
| `blendlink.bloom` | pmndrs Bloom/Selective Bloom registration | TSL bloom node registration |
| `blendlink.ambient-occlusion` | N8AO pass | TSL GTAO + denoise nodes |
| `blendlink.kuwahara` | GLSL multi-pass implementation from paper | TSL node implementation using same authored parameters |
| `blendlink.outline` | pmndrs Outline effect | TSL outline/toon outline nodes |
| `blendlink.rigidbody` | Rapier, independent of renderer | same Rapier service |
| `blendlink.activate` | Pointer/raycast + DOM accessibility | same interaction service; renderer supplies picking |

WebGPU support levels should be visible as `Production`, `Preview`, `Fallback`, or `Unavailable`. Never silently produce a visually different fallback. A fallback is part of the component definition and is shown in Blender before export.

## Artist-facing Blender UX

The component UI should borrow Needle's discoverability and exceed its explanation.

### Add Component flow

1. The button says `Add Behavior or Effect`, not just `Add Component`.
2. Search understands outcomes and synonyms: `glow` finds Bloom, `click link` finds Open Link, `ground` finds Contact Shadows and Shadow Catcher, `paint` finds Kuwahara.
3. Results are target-aware. Scene-only effects do not appear as normal choices on an arbitrary mesh; incompatible choices explain where to add them.
4. Each card shows one-line outcome, target, runtime cost, and support: `WebGL ✓ · WebGPU Preview · Medium GPU`.
5. `Recommended` contains the small high-value set; `All` exposes the full catalog. This prevents feature breadth from recreating Needle's wall of choices.

Recommended scene cards: Bloom, Color Grade, Depth of Field, Ambient Occlusion, Vignette, Kuwahara, Contact Shadows. Recommended object cards: Open Link, Hover/Emphasize, Play Animation, Play Audio, Look At, Drag, Rigidbody/Collider, Sensor.

### Component panel anatomy

- Header: icon, plain label, enabled switch, cost/support badge, duplicate/menu.
- First line: a live outcome sentence, for example `Bright emissive details glow around their edges.`
- Basic controls: no more than the 3–5 values needed for the common result.
- `Preview` affordances: focus picker, threshold mask, collider visualization, AO-only view, effect solo, sensor log.
- `Advanced`: implementation-sensitive controls, ordering exceptions, quality override, collision masks.
- Consequence box: actionable warnings such as `Every Frame contact shadows add 2 depth renders and 4 blur passes` or `This mesh collider is dynamic; use Convex Hull for stable performance.`
- Fallback box: only when another adapter behaves differently.

Effect solo/debug views are essential. Artists cannot tune AO radius, bloom threshold, outline masks, DOF focus, or collider bounds confidently from numeric fields alone.

### Automatic checks

- baked grounding plus realtime AO/contact shadows;
- no active camera or invalid near/far planes for depth effects;
- bloom threshold unreachable by current emissive range;
- transparent canvas plus an effect that destroys alpha;
- orthographic camera with an unsupported effect;
- dynamic rigid body with trimesh collider;
- collider with unapplied/non-uniform scale;
- click action without accessible label;
- unmuted video/audio autoplay;
- duplicate tone-mapping owner;
- component supported only by an adapter not enabled in the website.

Warnings should include `Fix` or `Show me` actions where deterministic. Nothing should disappear silently from export.

## Performance and fidelity policy for varied scenes

Authored look and runtime quality are separate. `Bloom intensity = 0.7` is art direction; bloom resolution scale is runtime policy. The runtime may lower resolution or sample counts within a declared quality range, but must never rewrite the authored values.

Default profiles:

| Profile | Intended device | Policy examples |
|---|---|---|
| Low | older phone / constrained embed | DPR cap 1, no AO or half-res Performance AO, half/quarter-res Kuwahara, static contact shadows, up to 2x target MSAA, no realtime mesh colliders. |
| Balanced | modern phone / integrated GPU | DPR cap 1.5, half-res Medium AO, mip bloom, half-res creative effects, on-change contact shadows. |
| High | laptop / desktop | DPR cap 2, full-res Medium/High AO, full-res bloom/DOF, higher Kuwahara samples, realtime contact shadows only when requested. |
| Auto | default | starts from capabilities and adjusts quality from measured frame/GPU time with hysteresis; never changes component semantics. |

Each expensive adapter declares quality knobs, memory estimate, required buffers, and whether changing quality recompiles a shader. N8AO, for example, warns that changing sample/radius-quality configuration recompiles its shaders; choose presets at startup or infrequent quality transitions rather than touching them every frame ([N8AO performance notes](https://github.com/N8python/n8ao#performance)).

The runtime should request buffers once and share them. Depth/normal/velocity requirements are unioned across active effects; no component renders its own redundant scene copy unless the algorithm requires it. Effects lazy-load by first use, and route splitting should ensure a basic scene does not include postprocessing, Rapier, N8AO, or video code.

Performance acceptance is measured, not inferred from component count:

- CPU update and GPU pass time per component/effect at representative Low/Balanced/High scenes;
- transient and persistent GPU memory at 1080p and common mobile DPRs;
- draw calls and full-screen passes after effect fusion;
- load/parse cost and code-split bytes;
- no per-frame allocations in steady-state interaction, physics, or effects;
- stable degradation: no alternating quality, temporal reset every frame, or visibly changing authored color.

## Prioritized implementation batches

Implementation checkpoint (2026-07-21): the transactional component runtime,
shared lazy WebGL post service, authoring metadata/UI, Bloom, Vignette, N8AO,
whole-scene Outline, Color Grade, Depth of Field, Chromatic Aberration,
Pixelation, bounded Sharpen, Tilt Shift, and conditional post-edge SMAA are implemented. Kuwahara remains a
Preview adapter. The browser visual/device matrix, collection bloom, toon/object
outline, threshold debugging, physical zero-sample AA device/pixel evidence, Contact Shadows, triggers/actions,
accessibility, physics, and later batches remain open; the numbered batches
below retain the original dependency order rather than pretending the whole
batch completed at once.

The AA checkpoint now covers the currently resolved hard-edge generators and
the zero-sample fallback. MSAA handles scene rasterization; a stack containing
AO/Outline, or any non-Pixelation post stack on a renderer with zero usable
offscreen MSAA samples, receives one final quality-tiered pmndrs
[`SMAAEffect`](https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/SMAAEffect.js~SMAAEffect.html)
after all post-LDR effects. Low/Balanced/High select Low/Medium/High, and Preview
diagnostics expose both the actual preset and resolved order. Any active
Pixelation suppresses final SMAA, including AO/Outline combinations and
zero-sample devices: placing SMAA after Pixelation would blur the deliberately
authored grid, so Pixelation fidelity takes priority until a clean pre-Pixelation
stage is justified. Stacks that only need ordinary MSAA pay no SMAA pass. Unit
coverage verifies zero-sample Vignette/Bloom fallback, AO + Pixelation priority,
conditional inclusion, single final ordering, quality transitions,
resize/dispose/reinstall, and the direct no-component path. pmndrs' SMAA shader
outputs its weighted RGBA sample rather than forcing opacity; transparent-canvas
browser pixels and the broader physical DPR/device matrix remain acceptance work
rather than a completed claim.

### Batch 0 — contract and shared runtime foundations

1. Extend registry metadata with capabilities, phase, cost, adapter support, conflicts, and fallbacks without reshaping serialized records.
2. Introduce `PostPipelineService`, `InteractionService`, `AccessibilityService`, `QualityService`, and lifecycle/rollback contracts.
3. Add Blender support/cost badges, consequences, search synonyms, and target-aware component results.
4. Build browser visual-test scenes covering transparent/opaque backgrounds, perspective/orthographic cameras, resize/DPR, HDR emissives, alpha-tested materials, skinned meshes, and empty/minimal scenes.

Exit criterion: Bloom and Vignette run through the service with identical or better reference images, no leaks after install/dispose/reinstall, and no behavior change for scenes without components.

### Batch 1 — artist-visible rendering leap

1. Shared pmndrs pipeline; migrate Bloom and Vignette.
2. Bloom selection modes and threshold debug view.
3. Ambient Occlusion using pinned N8AO, including adaptive half-resolution profiles; evaluate neural modes only after a compatible published implementation exists.
4. Selection Outline and whole-scene Toon Outline.
5. Kuwahara v1: anisotropic half/full-resolution profiles with temporal tests.
6. Color Grade LUT, Chromatic Aberration, Pixelation, and bounded Sharpen.
7. AA as runtime policy and a canonical single tone/output stage.

This batch intentionally goes beyond Needle in the area most aligned with Blendlink's promise: giving Blender artists a beautiful website result without shader engineering.

### Batch 2 — photographic presentation and grounding

1. Depth of Field with focus picker/object.
2. Tilt Shift.
3. Contact Shadows with static/on-change/every-frame modes.
4. Shadow Catcher mask and occluder modes.
5. See Through material/alpha-hash refinements and BVH threshold.
6. Video Surface.

Exit criterion: every effect documents transparency, orthographic support, quality cost, and fallback; baked/realtime overlap diagnostics are actionable.

### Batch 3 — coherent interaction instead of one-off click scripts

1. Typed triggers, conditions, and actions. Define and test a standards-lowering table for `KHR_interactivity`, `KHR_materials_variants`, `KHR_node_visibility`, and `KHR_animation_pointer`; retain explicit Blendlink adapters for semantics outside those contracts.
2. Set Active, Transform, Material Variant, Emphasize, animation/audio action upgrades.
3. DOM accessibility overlay with button/link semantics, focus, keyboard, labels, and reduced-motion behavior.
4. Follow Pointer, Follow Object, Span Between, and constraint smoothing.
5. Injected Scroll Progress adapter.
6. Drag on Plane/Surface for non-physics objects.

Exit criterion: all click actions work with pointer, touch, keyboard, and assistive semantics; component order in Blender does not affect dependency installation.

### Batch 4 — physics, sensors, character, and robust audio

1. Lazy Rapier world with fixed timestep/interpolation and debug overlays.
2. Rigidbody plus Box/Sphere/Capsule/Convex/Trimesh colliders and collision layers.
3. Sensors wired into the trigger/action graph.
4. Physics-aware drag.
5. Rapier KCC and optional input preset.
6. Shared Audio Runtime with unlock, visibility, gain ramps, spatial blend, and distance models.

Exit criterion: deterministic headless tests for body modes, sensor enter/exit, collision filtering, KCC stairs/slopes, teardown, and scene reload; visual browser tests for transform interpolation.

### Batch 5 — demand-driven extras

Local Duplicatable/Deletable configurator actions, multi-scene switching, attractors, render-to-texture cameras, and optional XR adapters. None should precede evidence from dogfooding or users.

## Definition of done for each new component

A component is not complete when a checkbox exists. It needs:

1. namespaced Blender properties and a declarative definition with plain-language help;
2. target/cardinality validation and loud export diagnostics;
3. manifest validation with enforced schema version and round-trip preservation;
4. at least one production runtime adapter plus an explicit future/fallback status;
5. full lifecycle ownership and rollback/disposal tests;
6. Preview Studio auto-update and a useful debug/solo visualization when applicable;
7. representative visual or behavioral browser tests, including resize and reinstall;
8. performance tier behavior and a measured cost note;
9. accessibility behavior for anything interactive;
10. documentation in the living feature-parity table.

For post effects, the test matrix also includes transparent background, tone-map/exposure interaction, high-emissive HDR values, orthographic camera, alpha clip, displacement, skinned/morphed meshes, and quality transitions. For physics, it includes non-uniform/applied scale, moving/static colliders, fixed timestep under a long frame, collision groups, scene teardown, and unsupported-shape diagnostics.

## Local Needle paths inspected

### Blender add-on

Root:

`C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\scripts\addons\Needle Engine Exporter for Blender`

Catalog, metadata, UI, and serialization files inspected:

- `__init__.py`
- `component_registry.py`
- `component_selector.py`
- `component_types.py`
- `component_utils.py`
- `components_meta.py`
- `operators_components.py`
- `panels_components.py`
- `panels_object.py`
- `panels_settings.py`
- `panels_viewport.py`
- `extensions\NEEDLE_components.py`
- `extensions\NEEDLE_components_export.py`
- `extensions\NEEDLE_components_importer.py`
- `extensions\NEEDLE_components_postprocess.py`
- `data\builtin.component.json`
- `data\components.needle.json`
- `data\ui-reference.llms.md`

### Needle runtime

Root:

`C:\Users\micha\Documents\GitHub\blendlink\experiments\needle-spike\node_modules\@needle-tools\engine\src\engine-components`

Post-processing files inspected:

- `postprocessing\PostProcessingHandler.ts`
- `postprocessing\Effects\Antialiasing.ts`
- `postprocessing\Effects\BloomEffect.ts`
- `postprocessing\Effects\ChromaticAberration.ts`
- `postprocessing\Effects\DepthOfField.ts`
- `postprocessing\Effects\Pixelation.ts`
- `postprocessing\Effects\ScreenspaceAmbientOcclusionN8.ts`
- `postprocessing\Effects\Sharpening.ts`
- `postprocessing\Effects\TiltShiftEffect.ts`
- `postprocessing\Effects\Tonemapping.ts`
- `postprocessing\Effects\Vignette.ts`

Physics, rendering, and camera files inspected:

- `CharacterController.ts`
- `Collider.ts`
- `RigidBody.ts`
- `physics\Attractor.ts`
- `ContactShadows.ts`
- `Fog.ts`
- `GroundProjection.ts`
- `ReflectionProbe.ts`
- `SeeThrough.ts`
- `ShadowCatcher.ts`
- `Skybox.ts`
- `Camera.ts`
- `OrbitControls.ts`
- `web\ViewBox.ts`

Interaction, action, constraint, and media files inspected:

- `AlignmentConstraint.ts`
- `OffsetConstraint.ts`
- `SmoothFollow.ts`
- `DragControls.ts`
- `Duplicatable.ts`
- `EventTrigger.ts`
- `SpatialTrigger.ts`
- `AudioSource.ts`
- `VideoPlayer.ts`
- `web\Clickthrough.ts`
- `web\CursorFollow.ts`
- `web\HoverAnimation.ts`
- `web\ScrollFollow.ts`
- `utils\LookAt.ts`
- `utils\OpenURL.ts`
- the runtime files referenced by `components.needle.json` for Change Material, Change Transform, Emphasize, Set Active, Hide, Play Animation, Play Audio, Scene Switcher, helpers, and XR controller/session components.

XR/export files inspected include `webxr\WebXR.ts`, its controller/session companions referenced by the metadata, and `export\usdz\USDZExporter.ts`.

## Bottom line

The market-worthy version of component parity is not “84 cards.” It is a dependable visual and interaction language that an artist can author in Blender, preview immediately, and trust across ordinary Three.js sites. The highest-leverage sequence is shared renderer/runtime foundations, then a visibly superior effects stack—especially selective bloom, modern AO, outlines, LUT grading, and a research-grounded Kuwahara—followed by one coherent trigger/action system and robust Rapier/audio services. That path covers more real scenes than copying Needle's component surface one class at a time, while keeping Blendlink small enough for solo developers and small teams.
