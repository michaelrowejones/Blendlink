# Independent direct-Float32 Radial kernel research

This oracle captures the pinned native Radial shared function directly through Blender's PythonGPU GLSL frontend on Metal into RGBA32F. It is a distinct kernel stage, with **zero node, EEVEE material, saved Final or full-scene qualification credit**.

The entire57,296-byte `gpu_shader_material_radial_tiling_shared.glsl` is inserted unchanged, including its Apache-2.0 notice and default GLSL-adaptation macros. External vector-type aliases bridge the interface; exact native scalar `square` and `_atan2` declarations and the original constant header are inserted independently from pinned primary source. No generated Three.js/TSL candidate, simplified Radial branch, expression rewrite, epsilon, output repair or quantization is used by this oracle.

The shared function is called as `calculate_out_variables(true,false,normalize,Sides,1,coord)`. Literal Sides3/8/12, Roundness1 and both Normalize values are the initial research domain. Inputs use a440×1 RGBA32F texture with exact Float32 input words `(x,y,Sides,Normalize0or1)`; texelFetch bypasses interpolation. The case corpus is owned by the separate Radial source-to-TSL experiment and copied/hash-pinned into the oracle transaction before GPU initialization. Input storage is independently read back before interpreting any numerical comparison.

The raw kernel return is `(postprocessedRadius,postprocessedPhase,width,rotation)`. Segment Coordinates would be `(raw.y,raw.x,0)`. A separate native math diagnostic records `(atan2(y,x),sqrt(square(x)+square(y)),0,1)`. Two additional diagnostic programs expose the regular source expressions `(xAxisAngle,nextWidth,angle/nextWidth,floor(angle/nextWidth))` and `(phaseResidual,halfWidth,rawPhase,finalPhase)`. They are separate observable programs, **not instrumentation of the optimized main function's registers**; exposing values can change compiler choices.

R2 observed:

- All1760 input words survived upload/load/storage exactly.
- Five independent calibration draws compared8800 Float32 words exactly, covering non-half-representable positive, signed/HDR, tiny-normal, adjacent-Float32 and signed-zero values.
- All440 raw coordinate/width triples were finite. The24 signed-zero origin cases had undefined atan2/rotation values; NaNs were retained without repair. The native final phase override remains independently visible.
- Twelve source-word subnormal controls remain research/refusal controls. Classification uses exponent/mantissa bits, because host floating comparisons after GPU initialization can flush subnormals. R1's raw data are unchanged and valid, but its floating metadata classifier incorrectly reported zero subnormal controls; R2 corrects only that classification and adds diagnostics.
- R2's main submitted shader and raw output bytes are identical to R1. The auxiliary diagnostic programs do not modify the reference function.

See `pilot-receipt.json` for exact source, helper, assembly, case and archive hashes. This capture provides no browser parity claim; the other experiment owns independent browser comparisons and their predeclared gates. Undefined outputs, seam flips and software-backend differences must remain explicit, without widening gates or calling the kernel oracle an EEVEE scene render.

The PythonGPU/frontend/compiler distinction and stock EEVEE half-float AOV/film limitation are described in [the foundation research](../native-f32-oracle-research/README.md). An actual-material crosscheck should force verified Float32 non-color image-field inputs, begin with half-exact controls, compare actual one-sample EEVEE AOV storage against a direct RGBA16F companion, and retain calibrated carriers or an explicitly instrumented native build for claims about full material Float32 intermediates. That actual-material step is outside this oracle receipt.

## Reproduce

Fetch the exact files in `sources.json` into an owned directory by basename and verify their hashes. Generate the separate experiment's current exact-word cases and coordinate GPU ownership:

```sh
PATH=/tmp/mrj-tooling:$PATH node experiments/radial-f32-oracle/run.mjs \
  artifacts/verification-radial-f32-oracle-NEW SOURCE_DIRECTORY CASES_JSON
```

The guarded native child is bounded to120seconds. The same shared native archive/census reader used by node proofs checks the one exact Python script and fresh cache prefix, without introducing a copied launcher closure. Raw words and all submitted GLSL stay in ignored artifacts; no capability update is automatic.
