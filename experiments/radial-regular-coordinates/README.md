# Regular Radial Segment Coordinates candidate

This is an isolated numerical research candidate, **not an admitted node port**. It grants zero support, saved Final, live-field, or official-scene acceptance credit. The fixed domain is native integer Sides3/8/12, Roundness1, both Normalize modes; the official demo still uses a computed STEPPED3/8/12 route, which this experiment has not exported or accepted.

The candidate starts from the mechanically transpiled pinned native GPU function. `specialize.mjs` verifies the original source and preprocessed hashes, proves the expected AST branch shape, and selects the whole regular/full-roundness branch under explicit preconditions. Retained arithmetic, predicates, output order and origin override are unchanged. Other source branches are removed; this is not a470-line manual rewrite, a seam epsilon, an artist-input quantization or an output repair. The generated derivative retains the upstream Apache-2.0 copyright/license. It remains outside published runtime pending license and support review.

The native Vector input is a two-component NodeSocketVector2D; Segment Coordinates is a three-component NodeSocketVector output with Z0. The returned native helper is `(radius,phase,width,rotation)` after Normalize postprocessing; actual Segment Coordinates are `(phase,radius)`. Origin explicitly overwrites phase to zero before normalization, while native atan2 and the auxiliary rotation remain undefined there. Both selected coordinate components are finite in all440 native cases; the24 origin rotation NaNs are retained. Raw input transport uses uint32 words, preserving negative zero and subnormals;12 subnormal controls are classified from source exponent/mantissa bits, never host floating comparisons after GPU initialization.

The independent oracle lives in [radial-f32-oracle](../radial-f32-oracle/README.md). It submits the **entire unchanged native shared function**, independently assembled type aliases, constant header and native math helpers through Blender's PythonGPU GLSL frontend/native Metal compiler to RGBA32F. It does not consume this TSL candidate or branch specialization. This stage is explicitly distinct from EEVEE material/film evaluation. Native storage calibration and exact input readback precede kernel interpretation. Separate atan2/radius/angle/phase diagnostics are observable programs; they are not a trace of optimized main-function registers.

The440 exact-word inputs cover three side counts and both Normalize modes, a dyadic grid, ordinary non-half values, each sector cut with neighboring Float32 input words, bisectors and all signed-zero origins. [The contract](contract.json) fixed numerical gates before capture: radius8ULP and2^-20 absolute, phase2^-18 absolute with native exact0/1 retained, width2ULP and2^-22 absolute, and identical non-origin sector selection independently of numeric tolerance. These are pinned-profile research test budgets, not a theorem for arbitrary adapters. In particular [WGSL permits a much looser f32 atan2 error](https://www.w3.org/TR/2026/CRD-WGSL-20260703/#accuracy-of-concrete-floating-point-expressions), so branch-cut agreement needs direct evidence.

Observed results, with failures retained:

| Candidate | Metal WebGPU | Metal WebGL2 | SwiftShader WebGPU/WebGL2 |
|---|---|---|---|
| Full native branch structure |440inputs bit-exact|12raw-word differences;2sector flips|380raw-word differences/API;24sector flips/API|
| Regular/full-roundness AST specialization |440inputs bit-exact|440inputs bit-exact|Same software counterexamples;54gate violations/API|

Specialization reduces generated TSL34474→2495bytes and submitted Radial fragments21419→2073bytes WGSL and21547→2724bytes GLSL. It eliminates an observed Metal optimizer-context mismatch without changing retained expressions. It does **not** solve cross-profile behavior. For example, input words`[1056964608,1063105494,1094713344,1065353216]` (x=.5,y≈.86602533,Sides12,Normalize=true) select different sectors in the unspecialized MetalWebGL candidate: native phase≈.99999976 becomes0. Software still has sector disagreements after specialization. Near the unit circle, raw radius cancellation also differs: native0 versus software−2^-24 fails the fixed ULP gate despite its small absolute error. No gate was widened after these failures.

Actual EEVEE material controls remain separate. A saved native-class atlas covers12 logical origin/+X settings,24 coordinate magnitudes,24 negative-sign witnesses and24 exact-grid residue witnesses. All correspond to the direct-F32 reference words exactly. Two independently authored non-half carrier controls also decode exactly through the EEVEE half-safe digit carrier. Magnitude/sign are separate; signed-zero signs are not reconstructed. This establishes only those selected literal material/film controls, not generic field equivalence. The first setup attempt supplied a three-component value to a native two-component socket and stopped before render; that failed archive retains zero credit. The corrected fresh capture is the only one closed by the receipt.

[The closed receipt](evidence.json) pins the full comparison and independent native/material captures. Both actual browser APIs/profiles used exact input texture loads and disposed owned textures. These are raw harness controls; there is no saved Final/publication, live resize/DPR, full pipeline ownership or performance qualification. Shader build/compile wall times are not throughput measurements. Original official assets were never modified.

The useful next decision is whether a separately named, guarded Metal-only source model is worth qualifying, or whether the native branch topology should remain a refusal until a justified portable intrinsic strategy exists. Further random precision loops are not warranted. Any support decision still requires true FLOAT_VECTOR2 extraction/conversion provenance, exact input-domain/cost guards, actual saved Final/both-API lifecycle proof, representative live fields, and unchanged authored-demo acceptance. The broader fractional branch stays research.

## Replay

Use Node24 and new ignored output directories. Generate the pinned full candidate with the existing feasibility script, then:

```sh
node --test experiments/radial-regular-coordinates/cases.test.mjs
node experiments/radial-regular-coordinates/cases.mjs CASES_JSON
node experiments/radial-f32-oracle/run.mjs NATIVE_OUTPUT PINNED_NATIVE_SOURCES CASES_JSON
node experiments/radial-regular-coordinates/specialize.mjs FULL_GENERATED_DIR SPECIALIZED_DIR
node experiments/radial-regular-coordinates/run.mjs FULL_GENERATED_DIR FULL_METAL_OUTPUT
BLENDLINK_TEST_PROFILE=software node experiments/radial-regular-coordinates/run.mjs FULL_GENERATED_DIR FULL_SOFTWARE_OUTPUT
node experiments/radial-regular-coordinates/run.mjs SPECIALIZED_DIR SPECIALIZED_METAL_OUTPUT
BLENDLINK_TEST_PROFILE=software node experiments/radial-regular-coordinates/run.mjs SPECIALIZED_DIR SPECIALIZED_SOFTWARE_OUTPUT
node experiments/radial-regular-coordinates/compare.mjs NATIVE_OUTPUT COMPARISON_JSON FULL_METAL_OUTPUT FULL_SOFTWARE_OUTPUT SPECIALIZED_METAL_OUTPUT SPECIALIZED_SOFTWARE_OUTPUT
node experiments/radial-regular-coordinates/capture-material.mjs MATERIAL_OUTPUT
node experiments/radial-regular-coordinates/close.mjs COMPARISON_JSON MATERIAL_OUTPUT RECEIPT_JSON
```

The independent native oracle uses its own closed guarded launcher. Browser captures pin source, candidate, fixture and Three build inputs before/after capture and archive exact shader/readback bytes. The comparison closes these archive hashes, preserves every failing row, and the receipt reader independently checks actual-material archive bytes and all72 witness values against native F32 rows. No automatic capability promotion exists.
