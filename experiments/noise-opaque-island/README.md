# Mixed live input / constant-arithmetic Noise audit

A live image makes the whole Noise input opaque to `constant_input`. It must
not hide an independently recognized inexact constant sibling. The new source
check applies the existing exact-arithmetic certificate inside transparent
coordinate plumbing for fresh static FBM 4D Color, zero distortion, shader
stage. It does not change any runtime or old serialized opcode. Modern wholly
MF inputs retain their existing qualified Float32 path.

The scan follows Math, Vector Math/Scale, Combine/Separate, Clamp, Mapping and
Vector Rotate operands, with depth 32/node 256 inspection bounds. Images and
native/qualified kernels remain opaque boundaries. This is not a universal
Math evaluator or a claim about constant arithmetic hidden inside every node.
Witnessed inexact islands take a named source-baking refusal; exact/literal
siblings retain live translation. An exhausted inspection limit has its own
named refusal.

## Actual native counterexamples

The authored island is `((1e8 + direction) - 1e8) - direction`, for both
`direction = -1,+1`. One graph adds its result to image-derived vector X;
another adds it to the image-derived W field. Native reference graphs have
opaque nearest Non-Color image input, Detail 0, Scale 1, FBM Color output.

On native 5.2/5.3 Metal, both placements exactly match the opposite-sign literal
control. Generic browser Math fails WebGPU by about `.065..068` in the encoded
raw output, while WebGL2 matches. On native 4.2 Metal, vector placement matches
literal 0 and fails WebGL2 by about `.067`; the W placement is context-dependent
and fails both APIs (about `.0144` WebGPU). It is deliberately refused rather
than assigned a guessed source value. Normalized fields independently expose
the same class on all three versions. No node tolerance is widened.

The post-guard generator retains all four refused authored graphs and native
float pixels per version/mode with hashes. Their native pixels are byte-identical
to the original pre-guard counterexamples. They are not relabeled as passing
comparisons or replaced with runtime readback.

## Reproduce

From the repository root, with a verified executable in `BLENDLINK_BLENDER`:

```sh
npm exec --yes --package=node@24 -- npm run build --workspace blendlink
BLENDLINK_NOISE_OPAQUE_ISLAND=1 BLENDLINK_NOISE_ENGINE=EEVEE \
BLENDLINK_NOISE_EVIDENCE="$EVIDENCE/raw" \
node experiments/noise-fractal-differential/run.mjs --built

BLENDLINK_NOISE_OPAQUE_ISLAND=1 BLENDLINK_NOISE_NORMALIZED=1 \
BLENDLINK_NOISE_ENGINE=EEVEE BLENDLINK_NOISE_EVIDENCE="$EVIDENCE/normalized" \
node experiments/noise-fractal-differential/run.mjs --built

"$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 -t 1 \
  --python packages/blender-addon/tests/noise_opaque_island_check.py
```

The fixture includes both directions/placements, literal controls, independently
exact `.125+.25` controls and the standard image/carrier calibration. Each
version/mode has 13 admitted graphs and 4 recorded native refusals. Native 4.2
`a51f293548ad`, 5.2`fbe6228777e7`, 5.3`02f0899d78e3` on macOS Metal pass all 156
admitted readbacks across raw/normalized modes and WebGPU/WebGL2 SwiftShader
LLVM. All 24 refused native pixel files match their pre-guard bytes exactly.

`admission-regression.py REFERENCE_DIRECTORY...` applies the guard to unchanged
retained native IR and records each document hash. The checkpoint retains all
509 existing raw/normalized documents (984 fresh Noise expressions); the new
source guard changes none of their admission results. The production TypeScript
runtime is byte-unchanged from the baseline. Full unit/policy checks also pass.
