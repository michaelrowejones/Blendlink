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

## GPU source limitation

GPU-authored Color Key remains unported. Native Metal HSV and strict hue-wrap
staging produce visible differences from both an existing continuous HSV
translation and a source-shaped branching prototype. The actual failed
corpus is retained under `artifacts/color-key/boundary{42,52,53}-{cpu,gpu}` and
`boundary-all-metal`; the GPU prototype is preserved at local research commit
`a2eebb0` / branch `codex/color-key-gpu-study`. Six hue-boundary cases per native
GPU version fail on each physical browser API, with matte differences up to1.
Those failures are not reclassified as numerical tolerance. Fresh source and
runtime documents require the explicit CPU model and reject GPU fields and
GPU-authored folded constants. Further GPU staging research is separate.

Primary semantic references:

- [Modern CPU Color Key](https://github.com/blender/blender/blob/v5.3.0/source/blender/nodes/composite/nodes/node_composite_color_key.cc)
- [Legacy CPU matte](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/operations/COM_ColorMatteOperation.cc)
- [Modern GPU matte](https://github.com/blender/blender/blob/v5.3.0/source/blender/compositor/shaders/library/gpu_shader_compositor_color_matte.glsl)

Generate CPU references with `compositor_color_key_check.py`, setting
`BLENDLINK_COMPOSITOR_COLOR_KEY_REFERENCES` to an evidence directory, then pass
that directory to `experiments/native-compositor-differential/run.mjs --built`.
Use `BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium` for the physical-browser run and
verify the recorded adapter before claiming physical GPU coverage.
