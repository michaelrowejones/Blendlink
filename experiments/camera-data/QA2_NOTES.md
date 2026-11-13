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

## Actual native trap and source-qualified X11 candidate

Routed run `43419636094` at `12123313d3ac347b293897ce811f8bf61ea327ed`
retains artifact `14033915425`, SHA-256
`58089a53e6da5b54fbd9a8b130a99a5012b2dec0a7f414b4e3f8f23a684c9e21`.
The separate known-signal control passes. Two actual browser GPU processes
independently stop on SIGTRAP with a native frame 0. Their Chrome mapping bases
are `0x55d40f482000` and `0x56068064f000`; both stopped instruction pointers
resolve to ELF virtual offset `0xf0cfbe2`. The preceding `0xf0cfbe1` is `int3`,
followed by `ud2`. SwiftShader worker threads are waiting; this trap is in the
Chrome GPU main thread, not a generated shader. There is no printed FATAL text.

The complete Chrome ELF was independently extracted from the official
158.0.8127.18 Chrome-for-Testing archive and matches the hosted SHA-256
`76bcde21a2f8c9d4fbbf42afbeab011817d000552d093e5f5e89c9b8808f4231`.
The hosted EGL/GLES/SwiftShader hashes also match that archive. The exact
incoming branch at `0xf0cf99b` jumps to the trap when a virtual property getter
returns a structure whose byte at offset `0x0d` is not 1. The getter follows the
global Ozone platform instance. The pinned `OzonePlatform::PlatformProperties`
layout places `skia_can_fall_back_to_x11` at that byte (one bool, padding, two
32-bit message-pump enums, then `supports_vulkan_swap_chain` and this bool).
The function's offscreen branch and X11 device construction match
`SkiaOutputSurfaceImplOnGpu::InitializeForDawn()`.

The pinned primary source gives the condition without guessing an error string:
`MayFallBackToSkiaOutputDeviceX11()` reads that property (lines 187–194), and
`InitializeForDawn()` calls `NOTREACHED()` if it is false on this Linux build
(lines 2159–2169). Ozone Headless leaves the default false; Ozone X11 explicitly
sets it true (lines 185–204 of `ozone_platform_x11.cc`). The actual CDP command
line includes `--headless` and `--ozone-platform=headless`. Running Xvfb around a
headless browser therefore does not provide the required X11 presentation path.
The four version-pinned source hashes are included in `chromium158-sources.json`.

The Chromium-documented Google Chrome debug-info archive for this version was
also checked, but **its build ID does not match this Chrome-for-Testing ELF**:
debug `fbf44c42c6ed72dd5cb095215c99a3c64e5446aa`, actual
`c1d797c512c8fe910085e56edca2a9b21ad0e34d`. It was not used to symbolize this
address. Sparse nearest-symbol labels in the stripped ELF are not function
attribution, and the limited native unwind is retained as a limitation.

The next bounded QA candidate runs full Chromium **headed** under Xvfb with
explicit Ozone X11 and the same Graphite/Dawn SwiftShader rendering flags. It
does not use the gdb launcher or its GPU-sandbox diagnostic flag. The plain
public canvas runs first. Actual CDP must then demonstrate X11, absence of
headless switches, and GraphiteDawnVulkan; unchanged native/Final source pins,
240 samples per API, 8 ownership cases per API and copied-package proof remain
mandatory. This is an unqualified environment candidate until that actual
Linux run completes. No math, tolerance, source admission or normal-trigger
workflow changed, and every prior failure receipt remains valid.

Preparation on macOS with full headed Chromium, the same Graphite flags and
its native Cocoa platform passes the plain exact-red control, 240 retained
native samples per API, and 8 ownership cases per API. Reports record
`requestedHeadless=false`, actual absence of `--headless`, and
GraphiteDawnVulkan. This is not Linux/X11 qualification. Invalid values for the
new explicit `BLENDLINK_TEST_CHROMIUM_HEADLESS=0|1` test option are refused;
unset remains the existing headless default. The temporary hosted candidate
also requires the actual CDP `--ozone-platform=x11` identity and rejects the
debugger launcher/sandbox diagnostic flags. Workflow structure and embedded
JavaScript syntax were checked locally; no production build was performed.
