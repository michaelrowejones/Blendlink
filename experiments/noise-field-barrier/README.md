# Experimental high-detail Noise image-field compiler barrier

The retained Linux 5.2 run 13987756890 passed 314 rows per family with no numeric
failures, then lost both browser devices at these actual image fields:

* `cycles-fbm-raw-4d-color-image-4`
* `blender_eevee-fbm-normalized-4d-color-image-4`

Those IDs have native Detail 6, Roughness 1, Lacunarity 2, Scale 40 and no distortion.
The browser GPU subprocess exits 139 on SwiftShader Subzero. macOS SwiftShader
uses LLVM; passing there does not establish a Subzero fix. The prior constant
fold addressed constant inputs, not these fields.

The candidate adds one private, never-updated zero uniform to the scaled 4D
position before fresh static FBM Color octave evaluation. It is restricted to
`noise_fractal`/`noise_normalized`, shader-evaluated image inputs, Detail 4..6,
no distortion or live Roughness. Admission independently requires nearest embedded
image RGB within [-2,2], alpha 1, Scale 40/80 and an exact W literal or the tested
`.5*imageY+.125` subtree. Payload values must upload exactly as half (protecting
legacy Metal image transport), scale products must be exact Float32, and each
W value is independently checked by the existing exact-arithmetic certificate.
No specific fixture pixel sequence or grid identity authorizes the candidate.
The measured executable sampling profile is color output, FULL Float32 storage,
no upload conversion, closest/repeat/flat UV sampling and a known source engine/
backend. The runtime samples these already-decoded linear payloads directly.
Unknown image processing/working-space metadata, byte/half storage, alpha output
and alternate filters/wrapping are excluded by a closed profile allowlist. This avoids changing Float32
contraction staging in arbitrary authored coordinate expressions. Legacy `noise`, other dimensions/outputs,
MF constant folds, other fractal types and lower-detail paths retain their old
code. Ordinary direct-UV, other texture/input shapes, and unproved arithmetic
remain on their existing paths. This is an experimental compiler-staging candidate until actual hosted
Subzero fields pass. It changes no native pixel references, numeric budgets,
launch/watchdog flags, or Perlin/fractal formulas. It does not revive the prior
unpromoted bounded-loop prototype.

## Fast native field canary

From the repository root, after a normal build:

```sh
BLENDLINK_NOISE_FIELD_FOCUS=1 \
BLENDLINK_NOISE_EVIDENCE="$EVIDENCE/raw" \
node experiments/noise-fractal-differential/run.mjs --built

BLENDLINK_NOISE_FIELD_FOCUS=1 BLENDLINK_NOISE_NORMALIZED=1 \
BLENDLINK_NOISE_ENGINE=EEVEE BLENDLINK_NOISE_EVIDENCE="$EVIDENCE/normalized" \
node experiments/noise-fractal-differential/run.mjs --built
```

Set `BLENDLINK_BLENDER` to the verified native executable. The selector retains
only actual high-detail 4D Color image fields plus independent carrier/row controls
and the amplified residual control. The raw family retains both Cycles and
EEVEE; the normalized family follows its existing EEVEE source contract. An
empty field selection fails explicitly. The generator still evaluates actual
native graphs; no GPU readback or expected pixels are substituted into the IR.
Both APIs remain mandatory, with the default watchdog. The runner records
immutable tested production/native bytes and the actual browser adapter.

For retained native data, copy/symlink its unchanged `reference` directory into
an evidence directory and run `--reuse-reference --built --ids ID1,ID2,...`.
The runner automatically adds independent controls for each selected engine.
Record reference IR/pixel hashes when comparing historical and fresh runs.
Full Chromium can separately be selected with
`BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium`; verify the adapter metadata before
claiming a physical device proof.
