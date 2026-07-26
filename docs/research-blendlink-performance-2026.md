# Blendlink web-scene performance research

Research date: 2026-07-21

## Executive finding

Blendlink already has the correct foundation: standard glTF, semantic KTX2,
Meshopt, authored LOD, identity-aware instancing, baked Appearance and Lighting
paths, reflection probes, and a generated Three.js runtime. The next major gain
will not come from replacing Three.js or immediately building a meshlet engine.
It will come from making Blendlink a **measured progressive compiler**: show a
small trustworthy image immediately, stream only detail the current screen can
use, eliminate avoidable runtime work, and prove the exact format and pixels the
device rendered.

The current MichaelRoweJonesSite dogfood hero makes the priority unusually
clear. Its manifest reports only 9,782 triangles, 39 meshes, and 42 estimated
draw calls, while its 4K Main appearance atlas dominates an 11,944,040-byte
compiled scene and an estimated 90,876,584 bytes of GPU textures. The external
Main PNG is 11,096,009 bytes; Background is 282,186 bytes. Geometry is not this
hero's first bottleneck.

A local Sharp benchmark also found an immediate lossless transfer win:

- Main PNG 11,096,009 bytes -> lossless WebP 6,185,688 bytes: 4,910,321 bytes,
  or 44.25%, smaller, with exact decoded pixels.
- Background PNG 282,186 bytes -> lossless WebP 173,500 bytes: 108,686 bytes,
  or 38.52%, smaller, also exact.

This reduces transfer, not GPU residency: lossless WebP still uploads as
ordinary RGBA. It is nevertheless a production-worthy atlas derivative if the
browser matrix and Blendlink's post-save constant-background/hash contract pass.
The larger improvement remains a downscaled 128-512 px first-visible atlas shell,
followed by the full lossless image only when useful.

## What Blendlink already solves

Do not rebuild existing strengths. The repository already provides semantic
ETC1S/UASTC choice with alpha/normal/mip gates, KTX2 HDR derivatives with source
fallback, Meshopt reorder/quantization/compression with Float32 atlas UVs,
authored LOD and instancing adapters, baked states and additive light groups,
reflection probes, and compile-time byte/triangle/draw/GPU-memory estimates.
Those contracts are the reason more aggressive optimization can be attempted
safely.

The initial audit found browser-only estimates, Meshoptimizer 0.24, a narrow
cleanup pipeline, an all-or-nothing GLB, eager light-group textures, unbounded
state caches, and avoidable state-switch recompiles. The implementation pass on
2026-07-21 closed the immediately safe items: Meshoptimizer 1.2 plus semantic
cleanup gates, lazy light-group loading, slot-signature shader invalidation,
verified lossless WebP/multires atlas delivery,
pre-upload/precompile hooks, build budgets, and an opt-in browser monitor for
Resource Timing, frame percentiles, long tasks, renderer counters, and WebGL2
GPU timer queries. Generated LOD, mesh/texture sidecars, a reproducible
multi-device browser matrix, and one shared cross-codec concurrency budget
remain research or production-design work. The runtime now uses exact
uncompressed Meshopt byte evidence to keep small loads synchronous and lease a
bounded worker pool for large loads; representative browser measurement still
needs to tune that deliberately conservative default. The Three adapter now inventories the live
loader-selected texture target, mip chain, and standard format payload while
leaving driver-private allocation explicitly unknown. Generated baked recipes
also apply a configurable,
reference-safe decoded-texture LRU: inactive state and light-group textures are
evicted while active, loading, promoted-default, and application-transferred
textures remain pinned.

## Ranked roadmap

| Priority | Recommendation | Maturity | Why now / acceptance gate |
| --- | --- | --- | --- |
| P0 | Extend implemented performance evidence into a deterministic browser acceptance harness | Foundation implemented | `blendlink perf` reports static budgets and the opt-in runtime monitor captures bytes, frame percentiles, long tasks, renderer counters, and GPU timers; cold-ready phases, camera/state scripts, and image evidence still need one reproducible browser gate. |
| P0 | Publish baked atlas PNG plus lossless WebP and select supported WebP | Implemented with exact-byte/pixel contracts | Measured 44.25% Main transfer saving with exact pixels; PNG fallback, saved background, hashes, and every multires variant are verified. |
| P0 | Validate the actual ASTC/BC7/ETC2/BC3 KTX target | Runtime evidence implemented; browser matrix remains | `collectThreeTextureEvidence()` reports the live Three loader-selected target family, explicit/generated mip chain, and block-aware format payload; deterministic physical-device screenshots and driver-private allocation remain outside the current automated gate. |
| P0 | Upgrade Meshoptimizer 0.24 -> 1.2 and use bounded decode workers | Implemented conservatively; browser tuning remains | Meshoptimizer 1.2 runs behind decoded-geometry, bounds, identity/extras, UV, and animation validation. Generated descriptors carry exact decoded bytes; high-level loads lease a shared 1-2 worker pool only from 4 MiB, cap overrides at four, release after all overlapping loads settle, and fall back safely for SSR/unsupported workers. The browser matrix must still validate the threshold. |
| P0 | Lazy active light groups, bounded state cache, signature-aware texture swaps | Implemented with ownership gates | Inactive groups are lazy, sampler swaps recompile only when the slot signature changes, and generated recipes evict least-recently-used inactive loader-owned textures against a configurable decoded RGBA+mipmap budget without disposing active or transferred resources. |
| P0 | Add safe `dedup`, constrained `prune`, `weld`, and lossless animation `resample` before current Meshopt stage | Implemented with semantic gates | Duplicate resources, safe vertices, and equivalent baked keys are removed only when identity/extras, UV, bounds, and animation evidence survives. |
| P0 | Pre-upload with `initTexture()` and prewarm with `compileAsync()` | Implemented opt-in policy | The runtime can upload promoted textures and precompile reachable signatures after lighting/environment installation to avoid first-use stalls. |
| P1 | Tiny bootstrap GLB plus content-hashed texture/mesh sidecars | New production architecture | Largest first-visible and unnecessary-transfer improvement for the current hero. |
| P1 | Attribute-aware generated LOD selected by projected error | Future design; no production generator or progressive companion graph ships today | Reduces static eligible meshes without replacing source art. Adoption requires a coherent pinned-Needle comparison, decoded geometry/error evidence, and browser transition gates. |
| P1 | Emit safe `EXT_mesh_gpu_instancing`; evaluate `BatchedMesh` and constrained static join | Production APIs, scene-dependent | Reduces submission while preserving identity, picking, states, animation, and culling. |
| P1 | Demand rendering and coherent Mobile/Balanced/Showcase tiers | Implemented conservatively; animation/static-idle browser subset verified | Saves idle battery and adapts DPR, LOD, post, shadows, and texture density together. Production Chromium proves a static Manual scene settles, animation acquires/reacquires frames and has zero tail renders after settling, and slow package-owned Component/composer time is bounded in the postprocessed Next dogfood route. Controls, LOD, audio, arbitrary custom adapters, physical devices, and the complete combined matrix remain pending. |
| P1 | Validate the implemented `postprocessing` 6.39.3 effect-fusion service on the browser/device matrix | Implemented; visual acceptance remains | The shared lazy pipeline now fuses compatible effects, splits convolution stages, owns tone-map order once, restores state, and reports its resolved order; reference-image and target-device gates still matter. |
| P2 | TSL/WebGPU renderer adapter | Three still labels it experimental | Strategic future path, but current `onBeforeCompile` and `EffectComposer` code must be rewritten. |
| P2 | `KHR_meshopt_compression` advanced profile | Release Candidate | Promising newer stream; keep EXT as default until writer/runtime support is routine. |
| Research | Meshlets, cluster LOD/DAG, GPU culling | Custom experimental renderer | Revisit only after conventional progressive LOD/batching fails a world-scale fixture. |

## Highest-priority technical work

### 1. Measure what ships

`blendlink perf` should drive a deterministic camera path and state/light-group
sequence in a real browser. Record transferred and decoded bytes, first proxy
and final-ready frame, GLB parse, Meshopt decode, KTX transcode, upload, PMREM,
shader compile, p50/p95/p99 CPU and GPU frame time, calls, triangles, active
samplers, selected texture formats, resident bytes, long tasks, and transition
hitches. Three exposes renderer counters; `stats-gl` supports WebGL/WebGPU GPU
timing. [Three renderer info](https://threejs.org/docs/pages/WebGLRenderer.html#info)
[stats-gl](https://github.com/RenaudRohlinger/stats-gl)

Avoid one universal triangle limit. Start the hero contract with a bootstrap
under 500 KiB and under 10% of final bytes, p95 at 16.67 ms on its target tier
and 33.33 ms on its declared fallback, no Blendlink-attributable 50 ms task
after the proxy is visible, no warmed state-switch compilation, and no texture
growth after a repeated state cycle. The W3C Long Tasks threshold is 50 ms.
[Long Tasks](https://www.w3.org/TR/longtasks-1/)

### 2. Make texture decisions device-truthful

The compiler validates KTX2 via `ktx extract --transcode rgba8`. That tests the
ETC1S/UASTC payload, while Three later chooses a device format. The Three
adapter now records that live loader-selected format, mip allocation, and
standard payload through `collectThreeTextureEvidence()`; unsupported internal
formats remain explicit unknowns. The ratified Basis glTF guidance says
non-color UASTC should become uncompressed RGBA when ASTC or BC7 is unavailable;
Three r184's general ranking can choose ETC2 without knowing that a texture is a
normal or ORM map.
[KHR_texture_basisu](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_basisu/README.md#using-ktx-v2-images-with-basis-universal-supercompression-for-material-textures)
[Three r184 KTX2Loader](https://github.com/mrdoob/three.js/blob/r184/examples/jsm/loaders/KTX2Loader.js#L770-L881)

The remaining gate is to run Blendlink's existing normal/channel/alpha/mip
visual checks on representative physical ASTC, BC7, ETC2, and BC3 targets. If a
target fails, choose a content-hashed data-safe GLB from detected GPU
capabilities or add a semantic loader policy; never sniff the user agent. Also
encode a small ETC1S-quality/UASTC-RDO candidate ladder and select the smallest
passing candidate. The Khronos tool documents these controls.
[KTX `create`](https://github.khronos.org/KTX-Software/ktxtools/ktx_create.html)

Keep baked atlas lossy compression off. Their mean-island background must be
restored after every lossy stage in `bakelib.py`. Lossless WebP and progressive
PNG/WebP tiers are viable only if the decoded bytes and final artifact contract
remain exact; they do not authorize a second bake implementation.

### 3. Remove runtime waste

Make Appearance light groups lazy and make shader cost proportional to
simultaneously active groups, not authored groups. Bind active layers into a
small fixed slot set, keep strength/tint as uniforms, and specialize only when
the active-set signature changes. Add a byte-bounded LRU for inactive state and
group textures, excluding current or application-transferred resources. This
preserves Blendlink's sRGB-decode then linear-add formula.

Only set `material.needsUpdate` when map/lightMap presence or another program
key changes; swapping one non-null texture for another can update the sampler
without recompilation. Pre-upload imminent maps with `initTexture()` and expose
the preview's `compileAsync()` lifecycle to generated integrations after
lighting and environment are installed. Three recommends the async path via
`KHR_parallel_shader_compile`. [Three WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html#compileAsync)

The Meshoptimizer 1.2 runtime now calls `MeshoptDecoder.useWorkers()` only
around actual large loads. Typegen sums `count * byteStride` for every
`EXT_meshopt_compression` buffer view; the default keeps totals below 4 MiB and
unknown external descriptors on the main thread, leases 1-2 workers above the
threshold, caps explicit overrides at four, holds the pool while Blendlink
loads overlap, then calls `useWorkers(0)` after the last load settles. Small
concurrent loads use an isolated synchronous adapter, and configure-only/SSR
paths never touch browser worker primitives. Applications that own
Meshoptimizer's module-global pool pass their decoder explicitly; Blendlink
installs that override without calling `useWorkers()` on it. The owned decoder
and Blendlink worker-policy options are mutually exclusive. Setting the worker
count to false or zero instead selects Blendlink's isolated main-thread adapter.
Its release reports 5-10% faster JS decode and a worker-race fix.

The remaining performance gate is to measure the 4 MiB crossover on the
browser/device fixture matrix and then use one bounded concurrency budget
across Meshopt, KTX2, and future BVH work so mobile devices are not flooded by
independent pools.
[Meshoptimizer 1.2](https://github.com/zeux/meshoptimizer/releases/tag/v1.2)
[Meshoptimizer JS API](https://github.com/zeux/meshoptimizer/blob/master/js/README.md)

### 4. Complete the safe offline pipeline

Before current reorder/quantize/Meshopt, evaluate `dedup()`, constrained
`prune({keepExtras:true})`, bit-identical `weld()`, and lossless animation
`resample()` with its optional WASM implementation. Re-attest stable nodes,
`blendlink_*` extras, state/component/probe bindings, decoded bounds/counts, and
the final atlas UV accessor afterward.
[dedup](https://gltf-transform.dev/modules/functions/functions/dedup)
[prune](https://gltf-transform.dev/modules/functions/functions/prune)
[weld](https://gltf-transform.dev/modules/functions/functions/weld)
[resample](https://gltf-transform.dev/modules/functions/functions/resample)

Meshoptimizer's overdraw reorder must remain measured: its maintainer notes
tiled mobile GPUs may not benefit. [Meshoptimizer pipeline](https://github.com/zeux/meshoptimizer/tree/v1.2#core-pipeline)

## Progressive delivery, LOD, and draw calls

Create a standard bootstrap GLB containing stable nodes, coarse eligible
geometry, and a downscaled 128-512 px default appearance. Store higher mesh and
texture tiers as content-hashed static sidecars with bounds, geometric error,
screen density, byte cost, cancellation, request deduplication, bounded
concurrency, atomic swaps, and GPU-memory eviction. Fixed desktop/mobile hero
compositions can prioritize only detail visible in their authored frames.

Needle's MIT `@needle-tools/gltf-progressive` is a useful reference or optional
interoperability adapter: low proxies, external LODs, screen-density selection,
caching, throttling, and low-poly raycasts. Its documented standalone asset
generation uses Needle Cloud or Needle integrations. Blendlink should own the
deterministic local generator and standard fallback rather than require its
vendor extension. [gltf-progressive docs](https://engine.needle.tools/docs/gltf-progressive/)
[source](https://github.com/needle-tools/gltf-progressive)

Generate static LODs with Meshoptimizer's attribute-aware simplifier, preserve
UV/material borders and silhouette, store returned error, and select by
projected screen error plus existing hysteresis. Exclude skinned, morphing,
transparent, collider, state-special, and individually animated objects first.
[Meshoptimizer simplifier](https://github.com/zeux/meshoptimizer/blob/master/js/README.md#simplifier)

For submission cost, prefer canonical materials, then ratified
`EXT_mesh_gpu_instancing`, then Three `BatchedMesh` for different static
geometries sharing a material. Offline `join()` is last because it collapses
identity/culling and can increase vertices for reused meshes. `BatchedMesh`
multi-draw benefit is capability-dependent, so report observed calls.
[EXT_mesh_gpu_instancing](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_mesh_gpu_instancing/README.md)
[BatchedMesh](https://threejs.org/docs/pages/BatchedMesh.html)
[join](https://gltf-transform.dev/modules/functions/functions/join)

Add offline whole-animation or per-clip bounds so skinned objects remain
frustum-cullable without per-frame vertex scans. Any lossy animation optimizer
must compare world-joint transforms, representative deformed vertices, morphs,
bounds, and event timing—not only accessor error.
[Three SkinnedMesh](https://threejs.org/docs/pages/SkinnedMesh.html)

## Runtime quality tiers and rendering backend

Static heroes should render on demand, switching to continuous frames only for
animation, controls, scroll, physics, uploads, transitions, or temporal effects.
Adapt coherent artist-visible tiers controlling DPR, streamed detail, bloom,
shadows, reflections, and dynamic lights with hysteresis. R3F documents the
same demand/invalidation and adaptive-performance pattern; provide both plain
Three and R3F helpers. [R3F scaling performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance)

Blendlink now pins `postprocessing` 6.39.3 and merges compatible effects into an
`EffectPass`. The shared service lazy-loads only for authored post effects,
separates multiple convolution stages, keeps the supported authored tone mapper
exactly once after HDR work, exposes the resolved order, and uses mipmapped
bloom. Continue benchmarking tone-map, alpha, clear-color, gradient, bloom, and
vignette behavior across the browser/device matrix rather than treating the
library migration itself as visual acceptance.
[postprocessing](https://github.com/pmndrs/postprocessing#performance)
[6.39.3 peer range](https://raw.githubusercontent.com/pmndrs/postprocessing/v6.39.3/package.json)

WebGPU is an architecture seam, not a checkbox. Three's `WebGPURenderer` offers
TSL, a WebGL2 fallback backend, and modern combined post-processing, but remains
experimental and does not support Blendlink's current `onBeforeCompile` or
legacy `EffectComposer` path. First express Appearance, Lighting, state, probe,
and component behavior as renderer-neutral graphs; then add a TSL adapter and
promote it only after pixel and device benchmarks.
[Three WebGPURenderer](https://threejs.org/manual/en/webgpurenderer)

## Watchlist — do not prioritize yet

- **`KHR_meshopt_compression`:** promising Release Candidate supported by Three
  r183+, but normal glTF Transform writer support is not complete. Offer an
  advanced profile later; keep complete `EXT_meshopt_compression` as default.
  [spec](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_meshopt_compression/README.md)
- **Meshlets/cluster DAG/GPU culling:** Meshoptimizer 1.2 has excellent building
  blocks, but there is no ratified glTF meshlet contract or portable Three path.
  It would require custom chunks, compute/indirect submission, TSL/WGSL, and a
  WebGL fallback. [clusterization](https://github.com/zeux/meshoptimizer/tree/v1.2#clusterization)
- **Virtual texturing/texture arrays:** no ratified generic glTF material
  contract or WebGPU sparse-residency API. Progressive sidecars provide most of
  the benefit with far less custom shader/cache complexity.
- **XUASTC and `EXT_texture_astc`:** genuinely cutting edge but still emerging
  KTX embedding/vendor contracts, not a Three production default.
  [Basis status](https://github.com/BinomialLLC/basis_universal#ktx2-support-status)
  [EXT_texture_astc](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_texture_astc/README.md)
- **`three-mesh-bvh`:** production-ready but opt-in only for measured picking or
  spatial-query cost; it does not accelerate ordinary rasterization and authored
  collision proxies remain preferable. [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)
- **Full OffscreenCanvas rendering, LightProbeGrid, and VAT:** useful specialist
  recipes, not core defaults. Start with decode workers, existing baked lighting,
  and ordinary animation. [OffscreenCanvas](https://threejs.org/manual/en/offscreencanvas.html)

## Remaining milestones after the 2026-07-21 implementation pass

1. **Browser acceptance:** check in the hero plus PBR, animation, and instance
   fixtures; turn the existing static/runtime evidence into one deterministic
   browser gate that records the implemented live KTX target evidence; and
   measure and tune the implemented decode-worker threshold. Lossless WebP,
   Meshoptimizer 1.2 with bounded worker leases, lazy light
   groups, bounded state-texture residency, and signature-aware prewarm are
   already implemented foundations.
2. **Progressive payload:** build on the embedded atlas bootstrap and verified
   multires delivery with separately cacheable texture/mesh sidecars; prove the
   hero is visible materially earlier and settles to approved pixels with no
   hitch or leak.
3. **Scalable scenes:** build on safe cleanup/resample, authored LOD/instancing,
   and the fused post service with generated LOD, animation bounds, demand
   rendering, and evidence-driven batching policies.
4. **Modern renderer research:** build the TSL/WebGPU adapter and benchmark KHR
   Meshopt or meshlets only on fixtures large enough to justify them.

Blendlink's durable advantage is not the longest list of codec checkboxes. It
is knowing the artist's composition, creating the smallest trustworthy version
for the current screen, proving what the browser actually sampled, and making
every compromise visible and reversible.
