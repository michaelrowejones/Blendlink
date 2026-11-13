# Isolated hosted Camera QA2

This note belongs to the temporary qualification branch, not a production
support claim. No shader math, budgets, native model, admission or production
browser configuration changed.

Run `43414107466` at `f44eb60b2fb715a1f22d5186223fd84639bf90bc` has two
completed failed controls:

- Headless shell artifact `14030603204`, SHA-256
  `085b76315ab6c0c430a9e6eca43ec356a56f95d5e10ecf88d33592db0117f11b`.
- Full bundled Chromium with explicit ANGLE/WebGPU SwiftShader artifact
  `14031122443`, SHA-256
  `ab818d21e3c5678d97e7c732fced384ac2d99f91b272ead01bf83ee99b31b338`.

Both completed native 5.2 OpenGL attestation, source/Final pin checks and copied
add-on namespace checks. Both browser runs passed the first 30 WebGPU native
samples before the canvas/DPR recovery. Chromium logged inability to create a
SharedImage backing with `WebgpuSwapChainTexture` usage at 1024x512, then the
WebGPU device was lost. The next scene failed buffer creation or texture
readback. WebGPU ownership independently failed at its first canvas/readback.
In both configurations actual SwiftShader Subzero WebGL2 passed all 240 native
samples and all 8 ownership cases. Neither profile qualifies full OpenGL
source/backend parity: WebGPU did not finish. Original artifacts remain intact
in `/tmp/blendlink-camera-opengl-canary/artifacts/hosted-43414107466`.

QA2 adds one explicitly experimental Linux configuration from primary Chrome
headless guidance: enable GPU, Vulkan compositing/rasterization, ANGLE Vulkan,
SwiftShader Vulkan, disable native Vulkan surface, and explicitly select the
WebGPU SwiftShader adapter. This is a candidate configuration until fresh
native, Final,240 samples/API, ownership 8/API and namespace steps all pass.

Primary references:

- [Headless GPU selection](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/using-gpu-hardware-in-headless-chrome.md)
- [Linux Vulkan presentation guidance](https://developer.chrome.com/blog/supercharge-web-ai-testing)
- [SwiftShader GL/Vulkan switches](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/swiftshader.md)

A separate `canvas-probe.mjs` exercises only public browser APIs, without Three,
Camera Data or native programs. It submits a red clear to an attached WebGPU
canvas, allows presentation, draws a fresh current texture (presented canvas
textures expire), and immediately snapshots exact RGBA 255/0/0/255 through a 2D
canvas. It retains adapter/feature data, device events, errors and phases before
asserting. A 30-second watchdog destroys a stuck device; it cannot produce a
pass. Local Mac SwiftShader headless-shell and full-Chromium controls pass.
This plain control cannot qualify a Camera node or substitute for failed native
parity. It is an independent witness for Linux canvas presentation failures.

The temporary workflow still triggers only pushes to
`codex/qualify-camera-data`. It has no PR/main/tag trigger; all failing controls
remain failing jobs, and artifacts are always retained. The plain control is
attempted after existing steps even when a browser check fails. Main's release
checks and support metadata remain untouched.

## QA2 result and QA3 bounded candidate

QA2 run `43415661971` at `4a83ce8ffe7db3943e4d7e60a8394e43453f9fd0`
failed all three profiles, including the plain public canvas. Verified archives:
Vulkan `14032001130` / `ceb7dc70999b2068e415c2b70dd9c9679320ddf758f3e69303da2b121128ecd2`,
shell `14031378722` / `492bf2ff314bf7ada2d2452a2aacee662bb9b1a79c476f6fe17b9529e9cf8bc2`,
full `14031258399` / `770fb27f11c89ec5c19982c6ba017490a3c7ab04d34c9e2067a86b317e34fbb0`.
Each native/Final source reader passed; all 163 production modules were independently
rederived and every archived runtime snapshot/source hash was checked. The full
WebGL2 results remain 240 native samples and 8 ownership cases. Each WebGPU path
passed 30 samples then lost its device when first presenting the canvas. No
profile qualifies. CDP reports actual Chromium 158.0.8127.18, Skia GaneshGL or None,
Graphite disabled, and Vulkan disabled even in the Vulkan-flag candidate.

QA3 keeps the original shell baseline and tries only one new candidate: full
Chromium with forced Graphite and Dawn SwiftShader. The version-pinned primary
sources and their decoded SHA-256 values are in `chromium158-sources.json`.
`gpu_switches.cc` declares the exact flags; `service_utils.cc` selects
GraphiteDawn for the SwiftShader value. The wrapped Skia backing factory adds
WebGPU read/write and swapchain usage for the Graphite/Dawn Vulkan backend.
This gives a concrete source basis for testing that presentation path rather
than changing node math to compensate for a browser device loss.

The plain local Mac SwiftShader control passes with actual CDP
`skia_graphite=enabled_on` and `skiaBackendType=GraphiteDawnVulkan`, including
exact RGBA 255/0/0/255. This is preparation evidence only. QA3 must record the
same actual backend and finish all native/Final/numeric/ownership/package and
plain-canvas checks on Linux before it can earn that CI configuration. Prior
failed profiles remain retained; their absence from this smaller matrix is not
a retroactive pass. A normal-trigger CI fix remains separate and unpromoted.

## QA3 failure and native backtrace capture

QA3 run `43416969774` at `1f717b5af52fb2d2f6ece15105ca1f3c32a14879`
failed both configurations. Graphite artifact `14031578675` SHA-256
`b0a0bcb33268f5537242062e690b2779f7c6610db6685f050b8ea9720deee024`
records actual GraphiteDawnVulkan/enabled Graphite, but the GPU process repeatedly
exits 133 before usable contexts. Both Camera APIs produce zero samples; the
plain control reports no WebGPU adapter. This is a distinct earlier upstream
execution failure, not a Camera numeric counterexample. The shell baseline
artifact `14031917415` / `25e2a35a8a2ff1c32acd17d6c27276352199be12f7eb7b148277b9a259c2e1a0`
repeats the prior first 30/full WebGL 240+8 behavior. Neither qualifies.

The retained Graphite stderr has no primary FATAL/CHECK text or native stack,
only failed command-buffer creation and the GPU-process exit 133 report. That
alone cannot identify a particular Chromium assert or SwiftShader defect.
The next temporary job therefore uses the identical Graphite rendering flags
and only native debugger/logging instrumentation. `--gpu-launcher` starts each
GPU subprocess under gdb, stopping on the actual signal and retaining module
maps, instruction/register location and native thread backtraces. No process
heap, environment or full core is exported. Binary/library hashes are retained.
There is no Blender, build, native reference generation or node qualification
in this diagnostic job, and its result cannot replace a failed numeric test.
Prior complete native/Final artifacts remain unchanged. A bounded diagnostic
150-second timeout does not change any production or numeric-suite watchdog.

The first debugger attempt, run 43418708545 / artifact 14032727414 SHA-256
`d1237bf30973bd9625c30dc1c22331939245cac7eda69523b74332334e7894c1`,
retains exact Chrome/library hashes but contains **no gdb wrapper logs**. It is
failed instrumentation, not a captured native backtrace. Pinned
`GpuSandboxedProcessLauncherDelegate::GetZygote` still selects the GPU zygote
unless the GPU-specific sandbox type is disabled; a wrapper prefix is not an
exec on that fork path, despite the existing global no-sandbox browser flag.
The diagnostic follow-up adds only `--disable-gpu-sandbox` to route the GPU
subprocess through the launcher under gdb. This is not a proposed normal
rendering configuration or an earned support change.

A separate debugger-control directory calibrates a known SIGTRAP. The required
browser witness checks only top-level GPU logs for actual wrapper entry,
SIGTRAP and native frame 0; a control signal cannot satisfy browser evidence.
Missing instrumentation remains a failed diagnostic. Previous raw node/native
and plain-canvas failures stay unchanged.
