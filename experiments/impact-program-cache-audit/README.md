# Impact material-program fan-out audit (CPU only)

The original Impact standalone site reaches ready with 281 material assignments and no skips, but the first real node-WebGL2 smoke takes 17.285 seconds versus 1.168 seconds on WebGPU. These are individual readiness observations, **not performance-budget acceptance**. This experiment makes no SDK, arithmetic, admission or source-scene change and requests no GPU context.

The reusable `run.mjs` parses the actual published GLB with the public GLTFLoader, invokes the currently built `installTslMaterials` entry point, walks the actual installed node-material/cache keys, then disposes its private installation. `evidence.json` pins the original artifact, material document, audit source and relevant runtime/Three source. Timing excludes module imports and file reads; it is one CPU sample, not a benchmark distribution.

## Observed fan-out

- GLB: 1,747,708 bytes, SHA256 `c1aef0622db7408a7eda5f3785096e49dd93c3a0eb6558a26d427aa7d48a4987`.
- Material programs: 2,927 bytes, SHA256 `e993017405d9b591d830c4341a908833fdd4cce6c6d2a7ef985f6b732e3f3569`.
- 282 exported meshes, two glTF materials; one shared source material is used by 281 mesh primitives. The other material is the ground.
- 278 distinct runtime-extras records. Removing only `texspace` leaves **one** metadata variant. All 278 effective Float32 location/denominator tuples are distinct; attributed geometry layouts are identical.
- Actual installation: one source material, 281 assignments, **278 node-material instances**, 278 material custom cache keys, 278 roughness-node cache keys, zero skips. The assignments counter is not a shader/program count.
- CPU parsing is about 11 ms, installation 46 ms and first cache-key walk 101 ms in the initial frozen audit. `evidence.json` retains the exact final sample. No final shader was generated or driver program compiled here.

The one shipped source program has a Generated-coordinate input feeding a detail 6 fractal-noise Color expression, then detail 1 normalized noise, power and map-range roughness. Most other channels are constants. Its substantial repeated roughness shader makes program fan-out a concrete concern.

## Source-grounded hypotheses

**H1: per-texspace literal shader fan-out.** `tslMaterialRuntime.ts` keys variants by source-material UUID, normal-map basis and serialized mesh extras. `tslMaterialProgram.buildOptionsFor` copies texspace vectors into build options. `tslNodeRecipe` emits Generated coordinates as:

```text
(blenderObjectPosition - vec3(location)) / vec3(2 * safeSize) + 0.5
```

Those `vec3` inputs are constants, not object/geometry uniforms. Three `ConstNode.generateConst` embeds their values in shader text; `Pipelines.getForRender` caches final programmable stages by complete vertex/fragment shader strings. Therefore 278 nearly identical roughness shaders differing in bbox literals are the leading hypothesis. **278 node cache keys alone do not prove 278 driver programs:** Three's default `Node.customCacheKey` includes node identity, and different node graphs can still emit identical shader text that the final program cache shares. Final shader hashes/counts remain unmeasured.

**H2: preparation and first post-process render may compile different target variants.** `threeRuntime` calls plain `renderer.compileAsync(scene,camera)` after component finalization. `threeWebgpuPostPipeline` creates a `pass(scene,camera)` and later invokes `RenderPipeline.render()`. That first real render can use an offscreen scene-pass target rather than the prewarm target. It may rebuild target-dependent shader/pipeline variants. This is a source-level possibility, not measured duplication. Removing the readiness barrier would hide work or errors and is not proposed.

## Smallest next measurement

Use a fresh performance copy of the generated original app, preserving original GLB/program  bytes and the same SDK source. Root's frozen published site and previous reports remain unchanged. No new general capture framework is needed.

1. Add wall-clock phase marks around renderer construction/init, the installer, its `compileAsync` call, and the first `installed.render(0)`/next presentation frame. Keep the ready/error behavior and all shader checks unchanged. Record WebGL context creation time so fallback initialization cannot be mistaken for driver compilation.
2. Transparently observe WebGL2 `shaderSource`, `compileShader`, `linkProgram`, and existing `KHR_parallel_shader_compile` completion polls. Record stage, source byte length/hash and phase; retain original arguments/results and restore hooks. Count both calls and unique final shader strings. Hash source offline to keep observer overhead small. Record only wall-clock/driver-completion intervals, not invented GPU timestamps.
3. Separate unique shader hashes introduced during prewarm from those first introduced by the post-process scene pass. For H1, compare actual shader text groups differing only in the known Generated texspace constants; never normalize arbitrary numeric literals or use normalized hashes as rendering-equivalence evidence.
4. Repeat a bounded set of independently launched browser runs with identical viewport/DPR and stated cache policy, plus a WebGPU control. Report distributions, program counts and observer overhead before choosing a readiness budget or declaring a win.

## Narrow candidate to consider after measurement

If H1 is confirmed, first preserve all 278 material variants, owner/lifetime boundaries and per-mesh validation. Give each variant its own immutable uniform vectors for texspace location and the existing doubled safe-size denominator. This could make shader text identical while avoiding shared mutable object-uniform state or changes to baked atlas/material ownership. Do not merge materials or alter the variant key in the initial candidate.

Keep subtraction, division and addition in the current order. Do **not** replace division with reciprocal multiplication, pre-collapse transforms, round texspace values or change procedural-noise arithmetic. Even changing constants to uniforms can alter compiler folding/division behavior; current profile proofs cannot be assumed to transfer. A scoped candidate needs same-pixel raw baseline/native comparisons, adversarial bbox/degenerate-axis inputs and an installed multi-object test before production admission. Performance measurement must show fewer actual final programs and shorter readiness, with no dropped receivers or new skips. No such mutation or proof is part of this audit.

## Replay

After building the SDK in this checkout:

```sh
PATH=/tmp/scenetoweb-apply-tooling:$PATH node experiments/impact-program-cache-audit/run.mjs /tmp/scenetoweb-impact-original-final-website/models/impactFracture/7d132b739f030be86e54d2f35c2af32e75f577bacddfcfa7990917333f307d91/impactFracture.glb /tmp/impact-cpu-audit-fresh.json
```

Outputs must use a fresh path. Expect stable hashes/counts and varying timings. Original readiness evidence is `/tmp/scenetoweb-impact-original-browser-r2/website.json` and `-r3/website.json`; this audit does not promote their smoke status to fidelity or performance acceptance.
