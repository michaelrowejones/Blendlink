# EEVEE Camera Data: qualified View Vector

This is a partial port of `ShaderNodeCameraData`, not a claim that all three outputs or the complete Blender BSDF render identically. The fresh `camera_data_native` / `eevee-primary-camera-v1` program supports **View Vector** for Blender 4.2.0, 5.2.0 and 5.3.0 EEVEE primary triangle surfaces. Its components are signed; no `[0,1]` color, HSL or Roughness certificate is granted.

All three native versions create the same node in material and group ShaderNodeTrees: no inputs; View Vector (VECTOR), View Z Depth and View Distance (VALUE). The native GPU function transforms the world surface point into camera space, flips Z, then normalizes that point. Orthographic output therefore varies across the surface; a constant orthographic Incoming vector is incorrect. There is no shader multi-function implementation. See the exact revisions and SHA-256 pins in [sources.json](sources.json).

The fresh helper reconstructs camera-space XY from the actual fragment coordinate and active inverse projection. Perspective normalization cancels depth; orthographic normalization retains the actual `positionView` depth. This is a new-op-only implementation of the native primary-surface function. It changes neither the existing `geometry_context` kernel nor renderer clip positioning. The exported camera context remains a required actual-geometry binding. Source/Final/installer CPU preflight is separate from the render-time owned-storage proof described below. No captured camera matrix replaces the active web camera.

## Admission

- Known EEVEE versions above; Cycles live programs refuse. An automatic EEVEE-to-Cycles channel bake cannot claim equivalent evaluation from a shared ALL material output. Explicit artist-selected capture remains a separate intent.
- Actual Float32 triangle positions and explicit Blender-Z-up or glTF-Y-up basis. Existing geometry guards retain their skin/morph/modifier/generated-instance, displacement, matrix-conditioning and camera reflection/shear limits. Static or animated owner/camera transforms are supported within those limits.
- Actual world owner bounds and camera translation are within ±64 units, with absolute object-to-world position staging at most 128 units and camera-to-owner-AABB distance at least 1 unit. Huge local-coordinate/translation cancellation cannot qualify merely through a small final world box.
- A single unshifted perspective or orthographic camera, square source render pixels, and static camera-data/projection settings. The active viewport starts at the render origin. Its actual render-target viewport or drawing buffer, including DPR, is checked on every draw.
- Angular footprint is at most `1/256` per pixel: `max(2/(P00*width), 2/(P11*height))` for perspective, divided by camera-to-owner-AABB minimum distance for orthographic. Unknown/invalid projection or an exceeded footprint gives an actionable limitation to narrow FOV, reduce orthographic scale/move back, or enlarge the viewport. This is an admission condition, not an added numerical tolerance.
- View Z Depth and View Distance have explicit source/runtime refusals: raw-unit clip/interpolant precision is not yet earned. Legacy WebGLRenderer refuses a matched fresh Camera Data program even if another channel has a portable base-color carrier. The node-renderer family supports both WebGPU and WebGL2.

## Storage ownership and static geometry

Public Three.js CPU attributes do not reveal whether a renderer already uploaded different bytes. Camera Data therefore requires `installTslMaterials`; directly rendering a low-level builder node gives a named installer remedy. The new opcode has its own Float32 position/triangle/index certificate and cache, including array/interleaved-layout/version identity. The older geometry kernels and their caches are unchanged.

After prior `onBeforeRender` callbacks, a managed callback acquires a **private deep geometry copy**, validates it, and assigns it before Three r184 constructs the render object. Source arrays and GPU history stay untouched. Private indices are canonical U32, avoiding r184's first-upload U8/U16 array rewrite. A first node update independently refreshes the copy certificate. Camera Data never swaps geometry from a node update.

Each copy belongs to its matched mesh and first renderer. A second renderer requires a separately installed scene copy. An earlier first-draw callback may replace a single-material source geometry, which is then independently copied/validated; multi-material swaps or stale group/index ranges refuse. After acquisition, replacing geometry/position/index attributes requires reinstallation. In-place unversioned edits follow Three's existing GPU-version contract; replacing an array without `needsUpdate` refuses. Accepted versioned edits acquire another fresh private copy and dispose the previous one. Warm draws perform no vertex scan or group search. This is a static-geometry ownership contract, not a per-frame vertex-animation facility; do not externally reuse or mutate private storage during renderer upload/node evaluation.

The extra private CPU/GPU memory is proportional to the full attributes and U32 indices of each matched rendered mesh, including separate copies for shared owners. Versioned updates temporarily allocate a replacement; old private resources are released. Disposal/retry restores the adopted source pointer unless the application replaced it, skips disposed copies during out-of-order lease restoration, and disposes only private resources.

`ownership.js` uses actual Final GLBs and public GPU-buffer readback to demonstrate prior stale GPU contents on two renderers, exact fresh private bytes, earlier-callback swaps, first-draw corruptions, shared owners, two material slots assembled from exact shipped primitives, versioned edits, warm resource stability, second-renderer refusal, cleanup/reapply and the low-level remedy. A read-only backend draw observer confirms that the private geometry is the actual render object. Run `run.mjs --built --ownership` with `BLENDLINK_CAMERA_DATA_NATIVE` pointing at a compiled ordinary corpus; adapter reports are `ownership-report-{metal,software}.json`. Source preservation includes source array identity/content and adopted geometry restoration.

## Evidence

`artifacts/camera-data/owned/qualification.json` binds current fixture and Python bytes, exact Final GLB/manifest/material-sidecar bytes, and immutable whole-program-checked built runtime snapshots. It contains **1,800 native field/control samples**, **120 actual Final GLBs**, and **14,400 readbacks** across all three versions, both export bases, Apple Metal and SwiftShader, and both browser APIs. Maximum distance outside the independently derived native quantization interval is **4.329253e-6**, within the unchanged `2e-5` kernel budget.

Five profiles cover ordinary, translated, distant and close cameras plus the angular-footprint boundary. Each exercises perspective/orthographic, front/back camera views, positive nonuniform camera scale, parented reflected/nonuniform shared owners, animated owner/camera transforms, a nested group, scalar composition and an unchanged-owner check after the other owner moves. Each browser run verifies actual pins, live camera/viewport refusal and recovery, DPR, repeated draws, material/callback cleanup/reapply, and the legacy-renderer refusal. Default native checks also prove automatic unmarked-material routing and source preservation. Copied built add-on package probes pass all three versions.

Native EEVEE reference rendering here uses **Metal**. The browser software/Metal comparison does not certify a native OpenGL source renderer; a separate native OpenGL canary is still needed. Browser mobile-size checks are layout/viewport tests, not phone hardware certification.

Native output is packed into RGB digits `k/256`, exactly representable in the scene-half carrier. All 256 digit values are independently rendered/calibrated before each corpus. The raw scalar interval is `[decoded, decoded + 2^-16]`, plus the independently bounded `2^-23` bias-add rounding for signed vector components. The kernel budget is measured outside that interval; it is not widened by a generic half-ULP/raster allowance. The exported program remains the authored live vector/composition, not the oracle's packing graph or rendered pixels.

The actual Preview Studio proof uses fetched Camera Data programs, desktop `1440×1000` and portrait-mobile `390×844` layouts, a deliberately too-small viewport, the named Details diagnostic, and Retry recovery. The source `.blend` remains unchanged. Desktop/mobile drawing-buffer sizes and adapter identities are retained in `artifacts/camera-data/owned-preview-{metal,software}.json`.

### Retained counterexamples

- `artifacts/camera-data/native53-wide/browser-report-metal.json`: the earlier direct-interpolant raw Z/Distance candidate differs by up to `2.90e-4`. Sequential clip staging did not remove it. These outputs remain refused.
- `artifacts/camera-data/release/53/near/browser-report-software.json`: the earlier direct-interpolant View Vector candidate fails extreme close/wide views by about `2.97e-4` outside quantization.
- `artifacts/camera-data/qualified/53/angular-edge/browser-report-software.json`: merely adding the footprint gate to the old interpolant still fails by `8.80e-5`. The earned new helper reconstructs the primary camera point instead.

Those files and their old immutable producer snapshots are research evidence, not current coverage. The original `earned/` proof also predates the owned-storage fix; `owned/` is the current release qualification corpus.

## Reproduce

Build only the intended checkout, using Node 24. Run once per exact native binary/version (replace `53` and the binary path for 4.2/5.2):

```sh
npm exec --yes --package=node@24 -- npm run build --workspace blendlink
BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium BLENDLINK_TEST_PROFILE=metal \
  npm exec --yes --package=node@24 -- node experiments/camera-data/suite.mjs \
  --built --blender /Applications/Blender.app/Contents/MacOS/Blender \
  --output artifacts/camera-data/owned/53
BLENDLINK_TEST_PROFILE=software \
BLENDLINK_TEST_CHROMIUM_ARGS='["--use-angle=swiftshader","--use-webgpu-adapter=swiftshader"]' \
  npm exec --yes --package=node@24 -- node experiments/camera-data/suite.mjs \
  --built --skip-native --skip-export --output artifacts/camera-data/owned/53
BLENDLINK_CAMERA_DATA_NATIVE=artifacts/camera-data/owned/53/ordinary \
BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium BLENDLINK_TEST_PROFILE=metal \
  npm exec --yes --package=node@24 -- node experiments/camera-data/run.mjs --built --ownership
BLENDLINK_CAMERA_DATA_NATIVE=artifacts/camera-data/owned/53/ordinary \
BLENDLINK_TEST_PROFILE=software \
BLENDLINK_TEST_CHROMIUM_ARGS='["--use-angle=swiftshader","--use-webgpu-adapter=swiftshader"]' \
  npm exec --yes --package=node@24 -- node experiments/camera-data/run.mjs --built --ownership
npm exec --yes --package=node@24 -- node experiments/camera-data/qualify.mjs
```

The native fixture is `packages/blender-addon/tests/camera_data_check.py`. Default sentinel: `BLENDLINK_CAMERA_DATA_PASSED`. Optional output env: `BLENDLINK_CAMERA_DATA_REFERENCES`; profile env: `BLENDLINK_CAMERA_DATA_PROFILE` (`ordinary`, `translated`, `wide`, `close`, `angular-edge`). `native-reference.json` records versions/build/backend, five field/control cases, four saved sources and 24 frame/owner rows with sample pixels, packed values and actual owner/camera matrices. The native oracle is EEVEE shader evaluation, not a CPU evaluator or Cycles bake. `probe_native.py` inventories actual node creation with `BLENDLINK_CAMERA_DATA_PROBE`.

For copied-package imports, pass `BLENDLINK_CAMERA_DATA_ADDON=<copied dist/addon directory>` to Blender running `package_probe.py`. For Preview UI, start the private Preview Studio against an ordinary source and run `preview.mjs <URL> <output.json>` with the same adapter environment variables. The numerical suite never substitutes the Preview's scene renderer for its native oracle.

## Central and native OpenGL checks

The central `geometry` parity shard runs the complete five-profile Camera Data source/Final suite, copied add-on namespace probe and owned-storage proof. Fresh native runs use `native_backend.py` around the unchanged native fixture. It selects an explicitly requested backend before initialization, records `gpu.platform` before and after that same process renders the oracle, and binds fixture/wrapper/reference bytes. `check-camera-data-source.mjs <profile> [OPENGL|METAL]` independently checks that attestation, current canonical Python and all eight actual Final GLB/manifest/program pins. Refusal, an unknown version, a missing request or a switched actual backend cannot count as the requested source proof.

The separate `native-camera-data` Linux canary requests `OPENGL` on Blender5.2.0, generates an ordinary corpus from scratch, exports eight actual Final GLBs, compares both browser APIs, and exercises owned GPU storage. It does not reuse local Metal references or widen tolerances. Native OpenGL qualification stays **pending** in the capability map until that canary passes and its evidence is reviewed. `BLENDLINK_CAMERA_DATA_NATIVE_BACKEND=METAL` runs the same requested-backend path locally; omitting the variable still records actual backend identity without pretending an explicit request.

Blender4.2.0 background mode has no `gpu.init`, and its `gpu.platform` queries
raise instead of identifying the renderer. The wrapper still runs the actual
native oracle, Final export and browser comparison, but records
`SOURCE_ATTESTATION_NA` with null before/after backend identities. Its engine is
`BLENDER_EEVEE_NEXT`; modern versions use `BLENDER_EEVEE`. The reader retains
legacy numerical/Final pins separately and refuses to credit them as a
requested Metal/OpenGL backend qualification. A request remains a selected
preference, never a replacement for the unavailable actual platform query.
