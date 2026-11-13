# Production runtime benchmark

This developer tool records cost. It grants **no node correctness, fidelity, release, or performance qualification**. Native source conformance remains a separate gate. The default micro fixture uses the production `installTslMaterials` builder/installer for ordinary UV Base Color and Roughness programs, rather than a handwritten shader proxy.

Build the isolated checkout, then capture a report:

```sh
npm exec --yes --package=node@24 -- npm run build
npm exec --yes --package=node@24 -- node experiments/runtime-performance/run.mjs --built --profile metal --backend both --width 320 --height 180 --dpr 1 --warmup 30 --frames 60 --repeats 3 --gpu-samples 30 --output artifacts/benchmark-new
```

`--profile software` requires observed SwiftShader identity; `metal` requires observed Apple/Metal identity and refuses SwiftShader. These profiles are distinct. Chromium launch overrides use `BLENDLINK_TEST_CHROMIUM_CHANNEL`, JSON `BLENDLINK_TEST_CHROMIUM_ARGS`, and `BLENDLINK_TEST_CHROMIUM_HEADED=1`. They enter comparison identity. Linux canvas presentation may need the independently qualified headed Chromium/X11/Graphite configuration; a failed execution never becomes a timing pass.

For an actual published material workload:

```sh
node experiments/runtime-performance/run.mjs --built --glb /path/scene.glb --materials /path/scene.materials.json --manifest /path/scene.manifest.json --public-root /path/public --profile metal --backend both --output artifacts/scene-benchmark-new
```

The manifest is optional. Without it, the scope is material programs plus loaded glTF, with an authored camera or static bounds-fit camera and imported lights or a deterministic lighting rig. A manifest preserves the production loaded-scene presentation and post pipeline; runtime warnings refuse this fuller scope. Baked states/light-group recipes are explicitly unsupported in this first loader. Raw/micro workloads are static; the fixed-step animation transport is intended for manifest scenes. Moving-camera paths are not implemented.

A stock GLB without a program sidecar is **only a geometry/load/carrier control**:

```sh
node experiments/runtime-performance/run.mjs --built --glb /path/stock-control.glb --variant carrier --case-id stock-control --profile metal --backend both --output artifacts/stock-benchmark-new
```

It does not establish production Final coverage. Asking for `program` without matching programs refuses. Program variants must install at least one material without skips and witness an installed program material drawing in an untimed validation frame. Callback instrumentation is removed before warmup. The evidenced corpus here uses single-material micro meshes and the stock Radial control; no arbitrary material-group coverage claim follows.

## Measurements and provenance

`results.json` is `schemaVersion:1`, `kind:blendlink-runtime-benchmark-v1`; `provenance.json` retains its source/runtime/browser/artifact evidence. Failed rows and errors are saved before assertions. Output directories must be fresh.

Each repeat uses a fresh page and renderer, disables HTTP caching, compiles scene materials, submits a first frame, then warms the requested frame count. Driver/OS shader caches and thermal state are **unknown**, so these phases are not claimed as first-ever cold-device costs. Compile scope excludes possible lazy post-pipeline compilation; first-frame CPU submission is reported separately. Carrier/program order alternates across repeats.

Steady samples are synchronous update/render submission wall times and paced RAF intervals. Neither is GPU time or uncapped throughput. Raw samples and nearest-rank p50/p95 are retained. No `readPixels` operation occurs in the timing loop. Screenshots and image statistics occur after timing while the actual canvas is still alive, then disposal/reapply checks run. Restoration checks cover material references/array slots, draw callbacks, and geometry references.

GPU timing is a separate serial query pass. WebGL2 elapsed queries reject disjoint or timed-out results. WebGPU uses the pinned Three timestamp API only where the whole app-frame scope is established; observed internal multi-call output conversion currently leaves this metric **null**, with a reason. No CPU or readback wall clock substitutes for GPU time. Three's optional query instrumentation is disabled during steady RAF samples. Renderer counters report tracked allocations, not total driver VRAM or JS heap.

The immutable built-runtime snapshot passes the existing whole-program source/emitter guard. GLB/material bytes fetched by the browser must match declared byte pins. Linked assets retain stable URI-role-to-content mappings, so exchanging image bodies between URI slots changes identity. Nonlocal HTTP dependencies refuse. Machine, CPU, browser launch, Three source, harness and asset identities are retained for comparison; candidate runtime hashes are recorded separately so a runtime optimization can be compared.

## Primary-source basis and limits

The installed dependency is Three **0.184.0**. Its [renderer](https://github.com/mrdoob/three.js/blob/r184/src/renderers/common/Renderer.js), [node manager](https://github.com/mrdoob/three.js/blob/r184/src/renderers/common/nodes/NodeManager.js), [Info counters](https://github.com/mrdoob/three.js/blob/r184/src/renderers/common/Info.js), and [timestamp resolver](https://github.com/mrdoob/three.js/blob/r184/src/renderers/webgpu/utils/WebGPUTimestampQueryPool.js) govern this harness. Current [official renderer documentation](https://threejs.org/docs/pages/Renderer.html) and [TSL architecture](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language) were cross-checked; newer documentation does not override the pinned implementation.

Blender's [GPU material implementation](https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/gpu/intern/gpu_material.cc) distinguishes shared node-topology passes and optimized variants. Its [GPU pass implementation](https://github.com/blender/blender/blob/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/gpu/intern/gpu_pass.cc) has deferred compilation and delayed optimization; [EEVEE shader integration](https://github.com/blender/blender/blob/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/draw/engines/eevee/eevee_shader.cc) uses that native machinery. These facts justify separating compilation and warmed rendering. This browser tool makes no Blender-versus-browser speed claim.

Fast tests:

```sh
node --test experiments/runtime-performance/metrics.test.mjs experiments/runtime-performance/artifact-identity.test.mjs
```

`evidence-receipt.json` links the retained initial and final observations. The final micro report has three trials with sixty CPU samples per variant/API, and thirty available WebGL2 GPU query samples per trial. The real Radial stock control has one diagnostic trial per API and no port coverage. None of the captured data is an optimization win claim.

After review, the witness was tightened so a carrier slot on a mixed-material
mesh cannot count as a program draw. `integrated-baseline-receipt.json` records
a fresh 12-row capture of that integrated harness, matching current runtime and
harness source hashes. Its identical-report comparison checks the reader only.
`squeeze-screen-receipt.json` records a fresh two-API diagnostic run of an actual
Final Squeeze image-all material with six channels: one installed/drawn material,
no skips, three additional tracked image textures, and restoration after repeated
disposal. It is a short screening run, not a speed improvement or new numerical
qualification. Raw reports, images and snapshots remain in ignored artifacts.
