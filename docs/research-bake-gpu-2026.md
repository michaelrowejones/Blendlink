# Blendlink bake GPU and phase audit (2026-07-21)

Status: evidence-backed audit; targeted GPU discovery and writable OptiX cache
ownership are implemented, unit-verified, and exact-package dogfooded at 4K.
Per-phase execution evidence remains a design recommendation.

## Question

Which parts of Blendlink's atlas build actually run on the GPU, why does the
current diagnostic name an RTX 5080 twice, and what is the smallest truthful
instrumentation and optimization step?

## Executive finding

The current `execution.deviceClass: "gpu"` evidence means that Blendlink asked
Cycles to run bake operators on a selected GPU backend. It does **not** mean the
whole atlas pipeline is GPU work. Geometry evaluation, UV packing, proxy
construction, dependency hashing, image-buffer inspection, normalization,
resizing, background flattening, PNG coding, artifact hashing, and file
publication remain host-side work. Guided albedo and normal bakes use the same
Cycles device as the main bake.

The denoise phase is mixed and must not be labelled CPU by assumption. In the
installed Blender 5.2.0 LTS build, a newly created scene defaults to compositor
`GPU` and denoise device `AUTO`; the active OptiX RTX 5080 reports OIDN GPU
support. Therefore the present compositor Denoise node can run OIDN on the GPU
on this machine. Blendlink does not explicitly select or record that device,
and Blender's GPU option permits a CPU fallback, so the current manifest cannot
prove which denoise device completed a particular job.

## Installed-version evidence

Read-only probes used:

- Blender `5.2.0 LTS`, build hash `fbe6228777e7`, built 2026-07-14.
- Installed Cycles add-on source:
  `C:\Program Files\Blender Foundation\Blender 5.2\5.2\scripts\addons_core\cycles\properties.py`.
- Factory-startup headless probes; no preferences were saved.

After setting `compute_device_type = "OPTIX"` and calling the current
`get_devices()` method, `preferences.devices` contained:

```text
NVIDIA GeForce RTX 5080 | CUDA | CUDA_NVIDIA GeForce RTX 5080_0000:01:00
AMD Ryzen 7 9850X3D 8-Core Processor | CPU | CPU
NVIDIA GeForce RTX 5080 | OPTIX | CUDA_NVIDIA GeForce RTX 5080_0000:01:00_OptiX
```

This is why Blendlink logs the RTX 5080 twice: it prints every non-CPU entry,
not only entries whose `type` equals the selected backend. CUDA and OptiX are
two logical Cycles devices for one physical NVIDIA card. A probe that enabled
both logical entries while leaving `compute_device_type = "OPTIX"` reported
`get_num_gpu_devices() == 1`, confirming that Cycles filters execution to the
active backend even though Blendlink's diagnostic does not.

The installed Cycles source makes three relevant contracts explicit:

1. `get_devices()` is deprecated and calls `refresh_devices()`, which probes
   CUDA, OptiX, HIP, Metal, and oneAPI. The source warns that device probing can
   crash with some drivers.
2. `get_devices_for_type(type)` returns entries matching that exact type plus
   CPU. Cycles' own active-device checks also filter on the selected type.
3. The device tuple includes OIDN and OptiX-denoiser capability flags;
   `has_oidn_gpu_devices()` checks the selected rendering devices against that
   flag.

On this host, a targeted OptiX query returned one OptiX GPU and one CPU, the
OptiX tuple's OIDN-support flag was true, and a newly created scene reported:

```text
render.compositor_device = GPU
render.compositor_denoise_device = AUTO
cycles.preferences.has_oidn_gpu_devices() = True
```

Blender documents `AUTO` as using the compositor's device, and `GPU` as using
the GPU when available with CPU fallback.

## Current Blendlink phase graph

| Phase | Current implementation | Device truth |
| --- | --- | --- |
| Dependency fingerprints and cache integrity | Python hashing plus file reads | CPU + disk I/O |
| Geometry preparation and UV packing | evaluated Blender meshes, BMesh/operator work, `bpy.ops.uv.pack_islands` | CPU |
| Frozen native receivers and two-level receiver packing | Blender evaluated-mesh capture, local chart packing, and one generated rectangle per receiver | CPU; later scene upload belongs to Cycles |
| Main appearance/lighting bake | `bpy.ops.object.bake(COMBINED/DIFFUSE)` | selected Cycles backend; GPU kernels when `scene.cycles.device = GPU`, with CPU orchestration/upload |
| Denoise guide | one-sample DIFFUSE color `bpy.ops.object.bake` call | same selected Cycles backend as main bake; object-space encoded NORMAL is deliberately omitted because it is not a valid OIDN common-space guide |
| Coverage, clipping, HDR normalization | `Image.pixels.foreach_get/set` and NumPy | CPU/host memory |
| Resolve/downscale | `Image.scale` | host-side Blender image operation; no Cycles device setting |
| Denoise | compositor Image → Denoise → output | mixed: compositor/OIDN GPU is available here, CPU fallback is possible, PNG write remains host-side |
| Canonical PNG save | `Image.save_render` with Standard/None/0 and dither | CPU image/color-management/encoding path |
| Constant background repair | PNG reload, NumPy byte-equivalent edit, PNG save | CPU + disk I/O |
| Delivery tiers | repeated PNG load, resize, save, coverage resolve, flatten, hash | CPU + disk I/O |
| Artifact publication | SHA-256, copy/rename, GLB/sidecar relocation | CPU + disk I/O |

The existing timings have important boundaries:

- `execution.durationMs` covers the whole `run_baked_mode` call.
- A rebuilt state `jobs[].durationMs` starts before its optional albedo guide
  and ends after the main bake, resolve, optional denoise, canonical save,
  background repair, and delivery tiers. It therefore combines GPU and CPU
  work. A light-group guide is shared by several output jobs and remains
  represented only in the aggregate duration until phase spans land.
- Geometry preparation and proxy construction occur before the per-job timer.
- `execution.denoise` records requested configuration, not effective outcome;
  `save_resolved` can print `BLENDLINK_DENOISE_FALLBACK` and ship the plain save
  while the field remains true.
- TypeScript's export `durationMs` additionally covers process startup, glTF
  work, and sidecar publication.

## Device-selection defect and implemented correction

The audited selection called deprecated `preferences.get_devices()`, then
treated every entry whose type was not CPU as evidence that the backend being
attempted existed. On this machine that produced a harmless duplicate
diagnostic because both CUDA and OptiX exist. On a different machine it could
claim an attempted backend based on a device belonging to another backend.

Blendlink now applies the smallest safe correction:

1. Attempt backends in policy order (`OPTIX`, `CUDA`, `HIP`, `ONEAPI`,
   `METAL`; unavailable enum values remain caught).
2. Query only the attempted backend with
   `preferences.get_devices_for_type(backend)` where available; retain a
   compatibility fallback for older supported Blender versions.
3. Accept and enable only entries with `device.type == backend`; disable CPU
   and other logical backends. Do not silently enable hybrid CPU+GPU.
4. Log backend-qualified logical devices, for example
   `OPTIX: NVIDIA GeForce RTX 5080`, while continuing to omit exact hardware
   names from published website manifests.
5. Verify the selected backend has at least one active exact-type device before
   setting `scene.cycles.device = "GPU"`.

This removed the duplicate display in a real OptiX bake (`OPTIX: NVIDIA
GeForce RTX 5080` appeared once), avoids unnecessary all-backend
initialization, and makes backend evidence true without changing bake pixels.

## OptiX disk-cache failure and implemented correction

The Cube dogfood publish exposed a separate GPU failure mode. The progress UI
still said `packing bake atlases`, but inspection showed geometry preparation
completed in 24.665 seconds, hierarchical packing in about 4.24 seconds, final
spacing validation in about 4.18 seconds, and dependency fingerprinting in
23.9–25.6 seconds. The unlabelled work was the 38-receiver, one-sample DIFFUSE
albedo guide.

With the default OptiX cache directory unwritable in the managed build
environment, Blender logged the following once per receiver:

```text
Could not open database file: .../NVIDIA/OptixCache/optix7cache.db
Unable to initialize the OptiX cache database
```

The guide portion exceeded 552 seconds and the 602-second diagnostic run timed
out. Pointing `OPTIX_CACHE_PATH` at a writable local directory changed the
same 38-object, 256×256 guide to 83.208 seconds with a cold cache and 24.316
seconds warm. The warm result is more than 22× faster than the failed-cache
lower bound. This is a process/cache result, not a claim that atlas resolution
or the main 4K bake has become 22× faster.

NVIDIA's OptiX device-context contract says the disk cache needs a dedicated
writable directory, creates it if absent, disables caching if initialization
fails, and honors `OPTIX_CACHE_PATH`. Its programming guide explains that
compiled work is reused by later contexts from this disk cache; disabling it
does not create an equivalent in-memory cache. Sources:
[OptiX device-context cache API](https://raytracing-docs.nvidia.com/optix9/api/group__optix__host__api__device__context.html) and
[OptiX 8.1 Programming Guide](https://raytracing-docs.nvidia.com/optix8/guide/optix_guide.241022.A4.pdf).

Blendlink now provisions and write-probes a stable package-owned cache before
spawning Blender. Precedence is:

1. `BLENDLINK_OPTIX_CACHE_PATH`, for a Blendlink-specific explicit override;
2. the standard `OPTIX_CACHE_PATH`, preserving an application/build-agent
   choice;
3. `<os temporary directory>/blendlink-optix-cache`.

The child receives the resolved path through the standard variable. An
unwritable path fails before Blender with a remedy instead of silently paying
repeated kernel compilation. Focused Vitest coverage proves the stable default,
both override levels, cleanup of the write probe, and the loud failure route.
The exporter now also labels atlas preparation, backend selection, dependency
fingerprinting, state-guide work, shared light-guide work, and main bakes
separately. State job duration includes its guide instead of hiding that cost.

### Full-resolution package evidence (2026-07-23)

The current package was built, packed, and installed into the Cube consumer
from archive SHA-256
`9361FD927AF9EE3A219FC4DB831EFB1C7F059A841F0A088AD3541E33E0BD6684`.
`publish cubeDioramaAppearance --force` then rebuilt the 4096px, 64-sample,
denoised atlas through OptiX and completed the compiler, optimizer, website
TypeScript/Vite build, and artifact verification in 322.6 seconds. The durable
manifest evidence reports:

```text
execution.durationMs = 277661
jobs[state:default:main].durationMs = 233131
deviceClass = gpu
backend = optix
effectiveSize = 4096
```

The same package's browser fixture subsequently passed three production-build
Chromium cases: HTTP/GLB body and SHA, nonzero 1440×900 Canvas, WebGL 2,
nonblank pixels, and no relevant console/page/request errors. The current
[Appearance capture](../artifacts/release-dogfood/cube-diorama/browser-evidence-cube-appearance.png)
and [measured visual diff](../artifacts/release-dogfood/cube-diorama/visual-diff-cube-appearance-final.png)
are retained for artist review. The visual comparison is evidence, not a parity
pass: no acceptance threshold has yet been declared for this demo.

### Flagship website evidence (2026-07-23)

`npm run blendlink:publish -- workbenchDogfood` exercised the package through
the MichaelRoweJonesSite-owned Final compile, Next 16.2.6 production build,
artifact verification, and declared Playwright smoke. The pipeline-signature
change intentionally invalidated all six jobs once. Publish completed in
951.1 seconds; durable manifest evidence reports 787.185 seconds of Final bake
execution on OptiX at 128 samples with 2× supersampling and denoise:

```text
state:default:main           365165ms at 8192px
state:default:architecture   244662ms at 4096px
state:default:background     242594ms at 1024px
light:Lamp Pool:main         196097ms at 8192px
light:Lamp Pool:architecture  27240ms at 4096px
light:Lamp Pool:background      575ms at 1024px
```

These job windows include guide work and can overlap in what elapsed work they
attribute, so they are ranking evidence and must not be summed as wall time.
That limitation is one reason the phase-span design below remains valuable.
The website build compiled in 3.0 seconds and its 20-test production browser
suite passed in 2.1 minutes. A separate focused `blendlink-lab.spec.ts` run on
an isolated port passed 3/3, and standalone TypeScript plus both repositories'
`git diff --check` passed. The source still reports nine missing optional/local
Blender file references; portability remains a source-asset cleanup task, not
a successful-publish claim.

An immediate unchanged publish then completed in 135.3 seconds and reported
`workbenchDogfood: already Final`: the whole-scene/asset-graph gate avoided
launching Blender entirely, while the application-owned Next build (2.3s) and
the same 20 browser tests (2.1 minutes) ran again and passed. This proves the
preferred top-level no-op route; the registered two-state and grouped-light
fixtures separately prove per-job fingerprint reuse when Blender must run.

## Instrumentation designs compared

### A. Infer timings from progress records

Add start/end labels to the existing `##blendlink` progress stream and let the
Node invoker calculate durations. This has the smallest Python diff and is good
for live UI, but progress is optional, heartbeat records repeat labels, nested
operations are hard to pair after failure, and the result is not durable build
evidence.

### B. Package-owned phase spans (recommended)

Add a tiny timer/span helper in the Python exporter and store optional spans on
the existing execution report. One stable flat record is sufficient:

```text
{ job, phase, durationMs, processor, backend, outcome }
```

Stable initial phases should be `prepare`, `guides`, `cycles-bake`,
`postprocess`, `denoise`, `encode-and-flatten`, `delivery`, `reuse`, and
`finalize`. `processor` describes the phase truth (`cpu`, `gpu`, `mixed`, or
`unknown`), not the whole build. `backend` is meaningful for `cycles-bake` and
`denoise`; `outcome` distinguishes `completed`, `cpu-fallback`,
`plain-save-fallback`, and `failed`.

This is an additive extension to existing execution evidence, not a manifest
reshape. The same helper can emit progress at phase boundaries, so live UX and
durable evidence share one source. Exact GPU names stay local-console-only.

## Safe speedups, in order

1. **Target only the attempted Cycles backend.** This removes redundant driver
   probes and their failure surface before any performance speculation.
2. **Make denoise device selection explicit and evidenced.** If the selected
   device's OIDN capability flag is true, explicitly request GPU compositor and
   GPU denoise; if GPU execution fails, retry OIDN on CPU before dropping to an
   undenoised save. Record the effective outcome. Compare representative
   outputs before making GPU OIDN the cross-version policy.
3. **Land phase timings before changing image mechanics.** The postprocess path
   is already vectorized with NumPy. Blender data-block operations are not
   thread-safe, so parallelizing them is not a safe first optimization.
4. **Use the timings to decide whether delivery-tier work warrants a deeper
   redesign.** Each tier currently reloads and saves the canonical PNG and then
   reloads/saves it again for constant-background repair. Combining those
   operations is attractive but touches the color/background contract and must
   be proven byte- and visually equivalent in `bakelib.py` tests.
5. **Do not enable CPU+GPU hybrid rendering, persistent data, concurrent bpy
   image work, or alternate encoders by default without measured representative
   bakes.** Blender documents hybrid as an option, not a universal speedup;
   persistent-data benefits are documented for re-renders, not established here
   for image-texture bake operators.

## Sources

- Blendlink `packages/blendlink/blender/export_scene.py`: device selection,
  Cycles bake calls, run orchestration, and current timing boundaries.
- Blendlink `packages/blendlink/blender/bakelib.py`: progress, save, denoise,
  pixel processing, delivery tiers, UV packing, and proxy mechanics.
- Blendlink `packages/blendlink/src/invoke.ts`: process-level timing and
  published execution types.
- Installed Blender 5.2 Cycles source, `scripts/addons_core/cycles/properties.py`,
  especially `get_device_list`, `get_devices_for_type`, `refresh_devices`,
  `get_devices`, and `has_oidn_gpu_devices`.
- [Blender GPU Rendering manual](https://docs.blender.org/manual/en/5.0/render/cycles/gpu_rendering.html)
- [Blender compositor performance and denoise-device manual](https://docs.blender.org/manual/en/5.0/render/eevee/render_settings/performance.html)
- [Blender Denoise node manual](https://docs.blender.org/manual/en/5.0/compositing/types/filter/denoise.html)
