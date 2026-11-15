# Independent native shader-kernel references

Research only, based on `ebd502f83d63f354447f0e8a17522a117b9bf395`. No SDK, capability, production adapter, Sheet or published evidence is changed. There are no Final exports or support promotions.

Two reference surfaces remain distinct:

- **Actual EEVEE material:** pinned Blender 5.3.0 `02f0899d78e3`, Metal, one-sample orthographic oversized emissive plane, Raw/None, scene-linear EXR32. EXR32 film is not assumed to preserve shader Float32. Two independently calibrated HALF-safe digit planes recover each nonnegative scalar. A separate coordinate control proves the nearest Non-Color image supplied the exact agreed inputs before any kernel render. Only **radial Gradient** was material-crosschecked in this bounded run.
- **Direct native source kernel:** reuse `experiments/native-f32-oracle-research/framebuffer_oracle.py`: `gpu.init()`, explicit F32 texture input, public PythonGPU native Metal compiler, RGBA32F framebuffer and raw FLOAT readback. Original pre-Naga GLSL/ABI comes from the shared source generation. No WGSL or target ES GLSL is consumed. This is a native source-kernel baseline, not automatic EEVEE material-context parity for Noise/Voronoi or their compositions.

## Fixed shared ABI and gates

64 inputs, 8×8, x fastest and bottom row first. Input RGB is `((x+.5)/8*4-2, (y+.5)/8*4-2, (x+y+1)/8-1)` and alpha is1; all components are dyadic Float32. Native direct framebuffer uses the same64 entries as a single row with exact integer texel loads. Its input-control words must equal the shared source fixture before kernels.

Outputs are `vec4(Color.rgb, Fac)` or `vec4(Color.rgb, Distance)`; the fourth lane is **not film alpha**. The material surface measures each lane separately and verifies actual film alpha1. Carrier digits are integer multiples of1/2048, exactly representable in HALF; plane0 captures32 fractional bits and plane1 another33. Independent +0, tiny2^-42, adjacent, ordinary and near-two canaries must close first. A per-case range frame refuses nonfinite/negative/out-of-range scalar values; the accepted carrier domain is +0 or `[2^-42,2)`. Arithmetic encoding cannot witness native signed-zero sign; that claim is excluded. The measured radial outputs are all nonzero.

Before native capture, `contract.json` fixed a maximum absolute error of2^-20 **and** maximum8 ULP for every compared output lane. The radial EEVEE/direct comparison was stronger: **256 words, zero differences, zero ULP**.

The direct native surface captured six outputs: radial Gradient; normalized 3D default fBM Noise; 3D Euclidean Voronoi F1/F2; `Noise(Noise(p).rgb)`; and `VoronoiF1(Noise(p).rgb)`. Noise uses Scale5/Detail2/Roughness.5/Lacunarity2/Distortion0/Normalize=true. Voronoi uses Scale5/Detail0/Randomness1/Euclidean/Normalize=false; canonical ABI also carries the source's ignored F1/F2 Smoothness1/Exponent.5 parameters. The actual node RNA probe checked four families and binds controls by **identifier**, including inactive sockets whose display names differ.

## Source-stage boundary and the concrete failures

Generic preprocessing retained20 NoiseFunctor forward declarations guarded by native ShaderTool `#ifndef GPU_METAL`. Native Metal wraps functions as class members and rejected prototype-plus-inline-definition pairs. The native-only export uses canonical `clang -E -DGPU_METAL=1`; no math is rewritten. The independent reader strips exactly those20 declarations from generic GLSL and asserts every remaining token matches the native library. The browser's generic/Naga module is unchanged.

A public `typedef_source` placement was also tested and produced all-zero outputs after compilation; these are **invalid**, despite successful storage/input controls. Restoring the original proven `FramebufferOracle.fragment_source` placement with the correct native backend export produced valid nonzero outputs. A functional nonzero/nonconstant canary is therefore mandatory in addition to finite/range/storage checks.

Retained namespaces are not rewritten:

- Schema r1/r2: setup-only socket name/identifier failures, zero renders; r3 passes all defaults.
- EEVEE r1: the factory Cube occluded the owned plane; coordinate calibration stopped after one frame. One fixture correction emptied only the fresh factory scene. EEVEE r2 passed12 frames.
- Direct r1/r2: generic-library Metal redeclaration refusals, no kernel parity.
- Direct r3: compiled but all-zero kernel outputs; invalid/zero credit. `direct-r2-failed.py` and `direct-r3-failed.py` retain those attempted placements.
- Direct r4: original helper placement plus native Metal export; five storage controls, exact input and all six functional outputs pass.

## Measurements

EEVEE r2: **12 actual render calls**,2.044s summed render-call time,3.111s guarded capture wall time. Direct r4: **12 draws** (five storage calibration +one input +six kernels),0.518s measured GPU-stage setup/compile/draw/readback, with full guarded-process time in its capture receipt. These single local observations are not FPS or cold compiler-cache benchmarks. Input preparation, source verification, archival and process startup are distinct from the inner timing.

The CPU-only independent close recomputes coordinates, both digit planes and known words, rehashes raw/EXR/shader/source artifacts, validates guarded native archives, rejects zero/constant kernel outputs and checks the20-declaration token boundary. It does not turn the PythonGPU source stage into EEVEE-context or whole-scene credit.

## Reproduce

Coordinate the GPU lease before capture. Use fresh output directories. The generation directory must contain pinned `canonical-metal-library.glsl`, unchanged `canonical-abi.glsl`, generic `canonical-library.glsl` and `generation.json` from the shared source generator.

```sh
node experiments/native-kernel-reference-pilot/run.mjs FRESH_SCHEMA --schema-only
node experiments/native-kernel-reference-pilot/run.mjs FRESH_EEVEE
node experiments/native-kernel-reference-pilot/direct-run.mjs FRESH_DIRECT GENERATION SHARED_INPUT_JSON
node experiments/native-kernel-reference-pilot/verify.mjs FRESH_EEVEE FRESH_DIRECT GENERATION FRESH_CLOSE_JSON
```

Actual successful inputs: EEVEE `/tmp/scenetoweb-native-kernel-eevee-r2`; direct `/tmp/scenetoweb-native-kernel-direct-r4`; generation `/tmp/scenetoweb-shader-kernel-next-build/generated-r5`. `evidence.json` pins the reports, raw output ABI and preserved failures. Raw machine-local images/GLSL/Blender scenes and native archives remain outside Git. Independent browser/native comparison and benchmark results belong to their own lanes.
