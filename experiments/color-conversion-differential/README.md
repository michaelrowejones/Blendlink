# Native shader color and Color Ramp parity

This proof builds actual Blender material graphs, captures their emitted IR,
then compares native linear float pixels with the production Three.js TSL
builder on both WebGPU and the WebGL2 backend of WebGPURenderer. It does not
bake the translated material for the browser. Native rendering supplies the
comparison oracle only.

```sh
BLENDLINK_BLENDER=/path/to/blender \
BLENDLINK_COLOR_EVIDENCE=artifacts/verification-color \
node experiments/color-conversion-differential/run.mjs
```

Use `--built` after the coordinated package build to exercise shipped JavaScript.
Use `--reuse-reference` to replay an existing evidence directory. Every runtime
module is captured immutably; `--built` independently emits the whole TypeScript
program and checks every module's semantic bytes, including dependency-inlined
values and the reviewed n8ao import rewrite. Source maps, all runtime module
hashes, native helper hashes, native version/device, source hashes, and explicit
refusals are retained in the evidence. Vite file watching and HMR are disabled.
`BLENDLINK_TEST_CHROMIUM_ARGS` accepts a JSON array of additional browser flags.

The corpus covers Separate/Combine Color in RGB, HSV and HSL, scalar-to-color
broadcast, negative and HDR inputs, negative/wrapped hue, dense live input grids,
unit-bounded compositions and native compile-time eligibility when connected to
Blackbody or Float Curve. Shader Color nodes expose three channels; they do not
have the compositor's Alpha sockets. Source input alpha is ignored natively.

HSL separation refuses known saturation singularities and unknown live HDR
ranges. Literal nonsingular HDR and proven unit-bounded live inputs are
accepted. Both Python admission and the runtime independently establish those
bounds; an IR annotation cannot grant permission. Regressions include
unnormalized Noise, non-FBM Noise, unclamped additive blends, forged ramp modes
and out-of-range LUT values. These refusals are recorded separately from numeric
passes.

Color Ramp coverage includes RGB/HSV/HSL, all five interpolation settings, all
four hue directions, Color and Alpha, sharp stop intervals, tiny nonzero spans,
one-stop behavior and authored Alpha output defaults. Native renderer models
are distinct:

- Cycles evaluates a native 257-entry table, even for RGB LINEAR and CONSTANT.
  The browser preserves that table and its native lookup; it does not replace
  the original sampled shader with a higher-resolution approximation.
- EEVEE uses an analytic two-stop RGB LINEAR/CONSTANT/EASE shortcut and otherwise
  a native GPU color band. Its CONSTANT shortcut uses a strict `factor > edge`.
- Blender 5.0+ may evaluate constant material expressions before either engine.
  Literal Factors use the native CPU evaluator. Nonliteral MF Factors remain
  refused for modes without a proven analytic CPU evaluator; RGB LINEAR and
  CONSTANT retain their existing analytic path.
- Before 4.4, the one-stop EEVEE RGB shortcut still reads a hidden second native
  slot. A private isolated `.blend` snapshot exposes its self-describing SDNA;
  derived field offsets and the visible row are validated before reading the
  hidden row. No ctypes, artist graph edits, source saves, or fixed ABI offsets
  are used. Forward and reversed slot positions are preserved. Coincident
  LINEAR/EASE positions are refused. Blender 4.2's embedded-owner copy leaks
  external ID user counts, so those owners and custom ID properties are refused
  before copying; a second visible stop avoids this legacy limitation. Private
  IDs/files are removed, and repeated success/refusal paths preserve source
  nodes, properties and users.
- Newer one-stop EEVEE Color is the first stop; its GPU Alpha is the authored
  Alpha output socket default. Cycles and native MF Alpha use the stop alpha.

Native GPU tables also preserve version/backend precision: pre-5.0 verified
Metal/OpenGL upload truncation, 5.0–5.2 nearest-even half upload, and 5.3 float
upload. Metal's half sampler has fixed-eight-bit interpolation fractions and
rounds half ties away from zero; software OpenGL returns full-float interpolated
samples with full-float fractions. Shared sampler controls include positive and
negative ties. Older schema-1 documents lacking `sampleRounding` retain their
previous nearest-even interpretation.

Coordinates and live values use nearest-sampled exactly half-representable
images. Cycles has a strict maximum absolute error of 6e-6. EEVEE adds one native
final-target half ULP, independently established by constant and image carriers;
node-table precision is implemented separately. No UV rasterization allowance
or blanket tolerance widening is applied. The legacy hidden-slot grid uses
procedural UV coordinates to keep its isolated owner free of external IDs.

Current native Metal evidence: 501 graphs on Blender 4.2, 489 each on 5.2 and 5.3,
all passed on both browser backends. Linux software OpenGL sampler metadata is
separately proven by retained native spectral and curve references and the
central release gate; this does not claim parity for every native GPU driver.
The live program requires WebGPURenderer, with either of its tested backends;
legacy WebGLRenderer cannot consume TSL programs.
