# Saved-scene Luma / Difference publishing flow

This checks the actual Preview and standalone website paths after the separate
native float-pixel proofs. It uses real saved `.blend` files and real Render
Layers; no image oracle replaces the scene or the compositor input.

Run with Node 24, installed Playwright full Chromium, and an admitted native
CPU source profile (the recorded proof uses Blender 5.3.0, darwin/arm64):

```sh
npm run build
BLENDLINK_BLENDER=/Applications/Blender.app/Contents/MacOS/Blender \
node experiments/luma-final-flow/run.mjs
```

The script authors three scenes with identical scene/GLB content: Identity,
Luminance, and Luminance → Difference. It performs the normal Final `export`
command, installs private tools, builds each standalone site, and hosts it
locally under a nested URL. Browser assets and entrypoints are not rewritten.
`--reuse-fixture` repeats the flow on this test's existing saved sources.

The actual generated manifest pins the scene and presentation bytes. The test
checks SHA-256 prefixes, byte lengths, immutable publication paths, saved-source
hashes, and the exact presentation bytes fetched by the browser. The fetched
programs must contain `native-luminance-key-cpu-rne-v1` and, for the paired
scene, `native-difference-key-cpu-exact-v2`; the installed pipeline must include
`blender-compositor`. A failed export must preserve every previously published
file. Source files are checked again after the complete flow.

Both real renderer APIs are exercised. WebGPU uses the ordinary viewer
selection; disabling `navigator.gpu` before the standalone bootstrap exercises
its genuine WebGL2 fallback. Preview uses its supported backend query. The
recorded adapter is Apple Metal (nonfallback) and the recorded WebGL renderer is
ANGLE Metal / Apple M5 Pro. API observation wraps public calls without changing
arguments/results or shader programs. There are no page/shader-console errors,
failed healthy asset requests or external network requests. Deliberately
aborted GLB loads are separately marked, then recovered using the real Retry
buttons. Both standalone and Preview initial-load retries pass.

Paired screenshots show an independent Luma effect (mean RGB difference about
62/255) and an additional Difference effect (about 16/255), in both viewer and
Preview. Identity also checks visible 3D image variation, so a blank scene with
only a working background cannot pass. This is an integration/visibility check,
**not** another native float numerical parity claim or whole-scene Blender
pixel equivalence.

The flow exposed a real Preview defect: compositor-only saves published new
presentation bytes but reused the unchanged GLB hash as their generation.
The browser consequently kept the previous effect. Preview now uses the
compiler-pinned generated descriptor identity, independently checks its actual
bytes, and retains compatibility for older caches without that pin. Unit
regressions cover same-GLB display/program/material/recipe updates, stable
runtime identity despite telemetry changes, malformed/partial descriptor
rejection, and the retained healthy generation.

The actual fixed Preview flow saves Luma → Both → Identity → Luma on each API.
It verifies visible changes, one active canvas, and stable pending frame counts
`[2,2,2,2]`. An invalid saved file keeps the healthy canvas; the next valid save
recovers. Real cleanup handlers remove the active canvas / installed state and
leave zero pending animation frames. Weak API allocation observations are
retained diagnostically; they do not establish zero GPU memory, complete Three
cache release, or a process-memory benchmark.

Evidence is retained under `artifacts/verification-luma-final-flow`: source
receipts, Final logs/manifests, actual screenshots, browser/backend observations,
compiler module provenance and `report.json`. The original Preview timeout log,
failed screenshot and contemporaneous inspection note are retained separately
under `artifacts/verification-preview-sidecar-generation-before`.

Hosted Linux/Windows arithmetic qualification is a different proof role in
`../luma-cpu-precision`. A successful experimental kernel trial does not grant
production source admission, and is not substituted for this shipped-site test.
