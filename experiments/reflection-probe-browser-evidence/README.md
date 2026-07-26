# Reflection-probe browser evidence

This isolated Chromium fixture exercises Blendlink's production
`createThreeWebGLReflectionCapture()` and
`applyCompiledSceneReflectionProbes()` interfaces against real Three.js WebGL
objects. It does not change either production module.

## Why this design

Three credible evidence designs were considered:

1. A screenshot-only glossy sphere is useful for review, but cannot prove face
   orientation, receiver exclusion, or exact cleanup.
2. A synthetic unit seam can prove control flow, but cannot prove that the real
   CubeCamera and PMREM shader work in a browser.
3. Thin observing subclasses around the real Three constructors preserve the
   production interface while exposing cube-face readback and disposal events.

The fixture uses design 3. Its adapters do not replace rendering behavior on
the successful path: `CubeCamera.update()` and `PMREMGenerator.fromCubemap()`
delegate to the installed Three implementations. The application scene,
renderer, camera, Canvas, presentation, and teardown remain fixture-owned.

## Primary-source basis

- The official [Three CubeCamera documentation](https://threejs.org/docs/pages/CubeCamera.html)
  describes capture into a cube render target and its reflection example hides
  the reflective receiver before `update()`, then restores it afterward.
- The official [Three PMREMGenerator documentation](https://threejs.org/docs/pages/PMREMGenerator.html)
  defines `fromCubemap()`, its GGX-prefiltered CubeUV result, shader precompile,
  minimum input size, and generator disposal.
- The official [Three WebGLRenderer documentation](https://threejs.org/docs/pages/WebGLRenderer.html)
  defines cube-face-aware `readRenderTargetPixels()`.
- The installed Three `0.184.0` sources provide the exact implementation under
  test:
  [`CubeCamera.js`](https://github.com/mrdoob/three.js/blob/d3b629c0c2097cec664ad16369bb6eae3b10e335/src/cameras/CubeCamera.js),
  [`PMREMGenerator.js`](https://github.com/mrdoob/three.js/blob/d3b629c0c2097cec664ad16369bb6eae3b10e335/src/extras/PMREMGenerator.js), and
  [`WebGLRenderer.js`](https://github.com/mrdoob/three.js/blob/d3b629c0c2097cec664ad16369bb6eae3b10e335/src/renderers/WebGLRenderer.js)
  at the immutable r184 commit. Exact installed-file and package-manifest
  SHA-256 identities are written into every `evidence.json`.
- The official [Playwright browser documentation](https://playwright.dev/docs/browsers)
  explains the browser/version coupling; the fixture therefore records the
  Playwright and actual Chromium versions rather than claiming generic browser
  coverage.
- The pinned Needle Engine `5.1.7`
  `src/engine-components/ReflectionProbe.ts` hash is also recorded. That source
  loads and applies authored textures but has no analogous runtime CubeCamera
  capture, so this is a Blendlink no-analogue improvement fixture rather than a
  contrived side-by-side Needle pixel comparison.

## Run

Run the registered browser gate (which builds the production package first):

```powershell
npm run test:reflection-probe-browser
```

The command fails loudly on page/console errors or any contract regression and
writes:

- `artifacts/reflection-probe-browser-2026/evidence.json`
- `artifacts/reflection-probe-browser-2026/reflection-probe-browser.png`
- `artifacts/reflection-probe-browser-2026/reflection-probe-canvas.png`

## What the gate proves

- exact center-color orientation for the real `+X`, `-X`, `+Y`, `-Y`, `+Z`,
  and `-Z` CubeCamera faces immediately before PMREM conversion;
- the assigned closed receiver is hidden during the real cube update and
  restored before the application's presentation render;
- the PMREM target is assigned through Blendlink's normal material-cloning
  path and produces a nonblank, chromatic presentation after the six source
  panels are hidden, materially exceeding a same-camera no-environment-map
  negative control;
- temporary cube target and PMREM generator cleanup on success;
- receiver and temporary-resource rollback after an injected update failure;
- owned PMREM disposal, authored material-identity restoration, and idempotent
  handle cleanup.

It does not prove cross-browser behavior, deployed asset loading, physical-GPU
performance, context-loss recovery, or six separately decoded directions after
CubeUV filtering. Its injected failure proves Blendlink-owned cleanup, not
Three's internal renderer-target/XR rollback after an exception inside
`renderer.render()`. `renderer.info.memory.textures` is only a coarse retained
resource sentinel; exact PMREM ownership is asserted through the returned
render target's disposal event. Those limitations are recorded in the generated
report.
