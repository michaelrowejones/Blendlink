# Floating Image Coordinates fields

Fresh `FLOAT_VECTOR2` marks only the native Uniform/Normalized Image Coordinates fields. `VECTOR` retains its existing three-component meaning and Pixel retains `INT_VECTOR2`. Only explicit field-to-RGBA `(x,y,0,1)` and padded float3 `(x,y,0)` conversions are new. Reroutes and ordinary artist node groups are exercised; no literalization or precomputed image replaces the field.

The first source domain is a direct texture-backed full-frame Render Layers Image, zero data offset, square pixels, physical extents1..8192, without borders or spatial/neighborhood operations. Runtime guards check actual image, drawing-buffer and target dimensions every frame. Non-texture preprocessing fields refuse before shader compilation. Source profile is Blender5.3.0 `02f0899d78e3`, macOS arm64, native CPU and Metal compositor settings; this is independent of the shading engine.

The predeclared [numeric contract](numeric-contract.json) requires XY to satisfy **both** at most2ULP and absolute error2^-22. Exact zero coordinate centers, Z=+0 and alpha=1 retain their Float32 words. Integer texels and half-center numerators are exact in the bound; the one non-power-of-two division can lower to reciprocal multiplication on GPU. Exact-word differences are recorded separately from contract violations. This bound applies at the coordinate output and its two padding conversions. It does not bound an arbitrary downstream graph: Math can amplify error, and Compare or Checker can change branches. The pointwise-only admission is a domain restriction, not a compositional fidelity guarantee. Gradient and Checker require their own composition proofs and budgets.

The frozen matrix has six physical sizes:13x9,26x18,9x13,18x26,19x11,38x22. It covers both outputs and direct color, float3, reroute and artist-group routes:48native graphs/device and8savedFinal scenes/device. Actual raw and Final pipelines reuse the same built program over seven real animation frames spanning portrait/landscape and DPR1/2. Independent image-load patterns calibrate orientation before testing coordinates. Three apply/dispose cycles restore the exact renderer-owned DFG lookup cache and source ownership; the coordinate kernel allocates no textures or render targets.

After an isolated/coordinated build and with exclusive GPU ownership:

```sh
PATH=/tmp/mrj-tooling:$PATH node experiments/compositor-float-coordinates/matrix.mjs artifacts/verification-float-coordinates
```

This serially captures fresh native CPU/GPU references, actual saved Final exports, and Metal/SwiftShader × actual WebGPU/WebGL2 proofs, then runs the strict closed reader. It performs no build or workflow trigger. The reader independently derives current whole-program emission, requires exact native source/module/fixture/vendor/source-map inventories and pins actual saved assets and frozen runtime snapshots. Raw artifacts remain ignored; `evidence.json` is a compact receipt.

`buildFullFrameFloatCoordinateKernel(mode,dimensions)` is the shared numerical kernel for future implicit texture coordinates. Its caller must separately qualify actual/implicit provenance and physical integer dimensions in[1,8192]. No fake Image Coordinates node or Image dependency is required for those consumers.
