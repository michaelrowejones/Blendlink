# Actual Final determinant-sign transitions

Three.js r184 includes the mesh winding in its WebGPU pipeline cache key but
omits it from `needsRenderUpdate`. After one Mesh changes from positive to
negative determinant, the renderer can retain the previous front-face state.
This flips Geometry Normal/Backfacing outputs and can affect face culling.
The WebGL2 backend already updates that state correctly.

The material installer now attaches one reversible `onBeforeRender` callback
per installed Mesh. It calls the existing user callback first, checks the
actual draw-material argument (including material groups), and marks that
owned material for update once when its determinant sign changes. The first
draw, stable signs, unowned materials and WebGL2 draws receive no extra
invalidation. Per-Mesh state lets shared materials serve owners with different
signs without invalidating every draw. Disposal restores the previous callback,
preserves later user replacements, and unwraps disposed managed callbacks on
reapplication. Shader functions and their inputs are unchanged.

This callback runs before Three's render-object and pipeline selection. The
browser regression also observes the real backend cache-key calls and checks
that user callbacks have already run. It checks exact material-version
increments, stable resource counts after warmup, disposal and reinstallation.

## Reproduce

Use Node 24, a fresh package build, and an actual Blender executable:

```sh
npm run build
BLENDLINK_RENDERER_SIGN_BLENDER=/path/to/blender \
BLENDLINK_RENDERER_SIGN_NATIVE="$PWD/artifacts/verification-renderer-sign" \
BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium \
node experiments/renderer-sign-differential/run.mjs
```

Omit the channel to exercise Playwright's headless shell. Both WebGPU and
WebGL2 run in each invocation. Actual adapter information is recorded from the
explicitly requested WebGPU device and the WebGL context; backend names are not
used to infer hardware. `--reuse-native` requires the exact retained fixture
hash. `--baseline` deliberately removes only the installed orientation hook;
it must reproduce the native WebGPU pixel failure while WebGL2 still passes.
This is a development regression selector, not a website option.

The fixture authors CONSTANT positive/negative scale keys. The actual exported
scale tracks must be STEP, and native frames between the keys are checked.
Singular linear interpolation is outside this proof. Two owners share the
source mesh and materials; one owner changes sign while the other remains
negative. Perspective/orthographic, front/back, Blender Z-up/glTF Y-up, native
Geometry Normal and Backfacing, and an asymmetric independent RGB control all
pass through actual Final export, GLTFLoader and the production installer.
The source `.blend` files remain unchanged. Runtime snapshots verify whole
TypeScript-program emitter equality and copy immutable tested bytes; the
report also records the native fixture and browser-harness source hashes.

## Results

Blender 4.2.0, 5.2.0 LTS and 5.3.0 passed in both recorded environments:
Apple M5 Pro Metal and SwiftShader. Each version/environment publishes eight
Final GLBs and checks 6,912 field/control readbacks per browser API, including
eight repeated forward/backward frame sequences and two installations.
The combined positive corpus is 48 GLBs and 82,944 readbacks. Maximum encoded
RGB error is 0.000292957 within the unchanged 2e-5 raster allowance plus the
native final half-float ULP. Pipeline/program, geometry, texture and attribute
counts stay equal to their warm values across the repeated transitions.
The disabled-hook baseline fails on the first actual negative STEP pose.

This fixes installed material-program clones. It does not change Blender node
coverage, shader math, or renderer behavior for application-owned materials
outside this installer.
