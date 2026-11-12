# Native spectral color nodes

`reference.py` builds actual Blender Blackbody and Wavelength material graphs.
Cycles CPU evaluates them through the production isolated-channel bake. EEVEE
renders the same emission graphs to linear EXR. `run.mjs` evaluates their
exported production IR on actual WebGPU and WebGL2 backends.

Run after a clean build with a supported Node runtime, Blender, and Playwright
Chromium installed:

```sh
node experiments/spectral-node-differential/run.mjs --built
```

`BLENDLINK_BLENDER` selects a specific native binary and
`BLENDLINK_SPECTRAL_EVIDENCE` selects an independent evidence directory. Omit
`--built` for source development. `--reuse-reference` retains the existing
native reference corpus; final verification regenerates it. Each run snapshots
the tested browser modules and Python extraction modules, disables HMR, and
records module hashes independently of subsequent workspace edits.

The 88 graphs include native endpoint boundaries, negative/out-of-range inputs,
live UV inputs, constant Noise feeding Blackbody, the corresponding direct
temperature and Noise controls, and independent native render-precision controls.
Blender 4.2, 5.2 and 5.3 each pass on both browser backends locally on macOS.

The port serializes the source OCIO linear matrices and distinguishes native
Cycles graph folding, legacy SVM's almost-Rec709 shortcut, and EEVEE tables.
Material GPUColorBand storage changes from RGBA16F to RGBA32F in 5.3. Legacy
Metal upload truncation, current half-float rounding, sampler fraction precision
and sampled output precision are distinct from the scene render target.

Fixed Cycles comparisons allow 6e-6 absolute error. Live UV fixtures add a
conservative derivative bound times independently measured UV rasterization
error. EEVEE comparisons additionally allow one native half-float render-target
ULP per component, validated by nontrivial color controls; this allowance does
not change the ported color function. Every component must pass its own budget.
Shader/browser errors and fallback to an unrequested browser backend fail.

The fixture proves these graphs and domains, not arbitrary shader composition,
all devices, other working-space configurations, or whole-scene renderer parity.
The Apache-2.0 attribution and license travel with both distribution carriers.
