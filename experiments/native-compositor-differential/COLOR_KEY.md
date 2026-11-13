# Color Key qualification

The live `color-key` operation supports Image and Matte outputs from CPU source
compositing on Blender 4.2, 5.2 and 5.3. Image and Key Color remain executable
graphs. Hue, Saturation and Value thresholds must be proven fixed normal
Float32 values in [0,1], or zero. Modern literal Value links and the existing
qualified fixed scalar bounds are supported. Changing controls, subnormal
thresholds, animation and unsupported image-domain combinations refuse.

The port keeps strict comparisons, native CPU HSV conversion, the legacy
doubled-hue wrap test and the modern half-threshold wrap test distinct. Key
alpha is ignored. Unkeyed Matte preserves original alpha, including negative
or greater-than-one alpha; Image multiplies every original RGBA component by
Matte. It does not clamp alpha or silently turn Image into a Set Alpha result.

The native corpus has 99 scenes per version: independent input/HSV controls,
fixed and two-image fields, constants, zero/end/default thresholds, signed/HDR
RGB and alpha, ignored key alpha, groups, cascades and Matte-to-Alpha use.
Actual native HSV output selects threshold values immediately below, at and
above hue, saturation and value boundaries, including nonbinary RGB inputs.
Source node/group/socket/property/link fingerprints remain unchanged during
extraction. All three versions also exercise the named GPU-source refusal.

The 297 native scenes pass 1,188 readbacks across recorded Apple M5 Pro Metal
and SwiftShader adapters on WebGPU and WebGL2. Maximum error is
1.1920928955078125e-7, confined to the continuous HSV control; the key decisions
in the retained corpus match exactly. The compositor budget remains 2e-5,
with exact alpha comparison. Immutable runtime snapshots and original native
inputs/programs/pixels are retained in the isolated worker under
`artifacts/color-key/final{42,52,53}-cpu` and
`artifacts/color-key/final-{metal,software}`.

Image-only sample1 rendering is separately proved against all 297 original
case JSON files: input, program and output bytes are identical. It keeps
EEVEE and full compositor precision, changing only unused scene sampling
after every scene-result link has been replaced, and restores that setting.

## GPU grayscale and dead-predicate domains

Fresh `native-color-key-gray-v1` documents admit Image and Key Color only when
independent bounded Python and runtime graph walkers prove replicated scalar
RGB or fixed grayscale colors. RGB combination must use the same actual scalar
expression or equal Float32 literals; a claimed scalar ref type, a gray
annotation, HSV combination, cycles and unknown expression shapes do not grant
admission. Scalar-to-RGB conversions and flattened groups remain executable.
Native grayscale has H=S=0 exactly, so positive fixed Hue/Saturation controls
leave only the native scalar Value-distance comparison. Default thresholds work.
Hue=0 yields the unkeyed result. Positive Hue must be at least 2^-125, keeping
its half threshold normal. CPU source behavior and old documents are unchanged.

`native-color-key-dead-v1` admits arbitrary chromatic RGB when Saturation or
Value is exactly zero: a strict nonnegative distance cannot be less than zero.
The unused Key Color subtree is not extracted or evaluated. In both models,
unkeyed Matte retains original signed/HDR alpha; Image still multiplies all
original RGBA components by that matte, including negative or >1 alpha.
These are exact graph reductions, not an approximate HSV implementation.

The dedicated `compositor_color_key_gpu_subset_check.py` fixture emits 67 actual
EEVEE/GPU/FULL scenes per native version, plus named chromatic/invalid-proof
refusals. It covers replicated/scalar/literal/group inputs, two gray fields,
fixed/default/zero controls, neighboring binary and decimal Value thresholds,
HDR/negative alpha and an authored unported but dead Key Color branch. Generate
references with `BLENDLINK_COMPOSITOR_COLOR_KEY_GPU_REFERENCES=/absolute/path`,
then use the normal immutable compositor runner. The all-version built replay
also keeps CPU99 unchanged: 498 cases per API on physical Metal and SwiftShader
WebGPU/WebGL2 (1,992 readbacks). All 804 new GPU-subset readbacks are exact;
the unchanged CPU control maximum is 1.1920928955078125e-7.

## GPU source limitation

General chromatic GPU-authored Color Key remains unported. Native Metal HSV and strict hue-wrap
staging produce visible differences from both an existing continuous HSV
translation and a source-shaped branching prototype. The actual failed
corpus is retained under `artifacts/color-key/boundary{42,52,53}-{cpu,gpu}` and
`boundary-all-metal`; the GPU prototype is preserved at local research commit
`a2eebb0` / branch `codex/color-key-gpu-study`. Six hue-boundary cases per native
GPU version fail on each physical browser API, with matte differences up to1.
Those failures are not reclassified as numerical tolerance. Chromatic source and
runtime documents still require the explicit CPU model and reject GPU fields
and GPU-authored folded constants outside the reductions above. Further GPU staging research is separate; [independent native controls](../color-key-gpu-precision/README.md) retain the newly demonstrated fast-reciprocal and strict-threshold counterexamples.

Primary semantic references:

- [Modern CPU Color Key](https://github.com/blender/blender/blob/v5.3.0/source/blender/nodes/composite/nodes/node_composite_color_key.cc)
- [Legacy CPU matte](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/operations/COM_ColorMatteOperation.cc)
- [Modern GPU matte](https://github.com/blender/blender/blob/v5.3.0/source/blender/compositor/shaders/library/gpu_shader_compositor_color_matte.glsl)

Generate CPU references with `compositor_color_key_check.py`, setting
`BLENDLINK_COMPOSITOR_COLOR_KEY_REFERENCES` to an evidence directory, then pass
that directory to `experiments/native-compositor-differential/run.mjs --built`.
Use `BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium` for the physical-browser run and
verify the recorded adapter before claiming physical GPU coverage.
