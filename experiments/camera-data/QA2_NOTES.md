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
