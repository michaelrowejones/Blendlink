# Transporting Blender's authored display transform

Research date: 2026-09-07. Isolated Blender 5.2.0 LTS, build `fbe6228777e7`, factory startup. No original artwork modified. Prototype and logs are under `artifacts/verification-look/`; this note records measured feasibility, not shipped browser parity.

## Result

Blender's bundled Python includes **PyOpenColorIO 2.5.0**. We can read the installed OCIO configuration, reproduce the authored display processor, and export its optimized typed operations and original LUT samples. This is a much stronger route than fitting Three's AgX or resampling the whole transform into a small LUT.

The reusable research prototype is `artifacts/verification-look/ocio_export_prototype.py`. `export_program(scene)` returns a JSON-safe operation list. It accepts a sampled fallback only when explicitly requested; that fallback's measured errors are unacceptable for the intended fidelity and it should not be adopted silently.

## Measured agreement with Blender

`probe_ocio.py` compares the composed OCIO CPU processor with `Image.save_render` to 16-bit PNG, dithering disabled, and reloads the image as Non-Color. Each case has 2,001 RGB values including small negative components and HDR values spanning 2^-12 through 2^12.

| Authored settings | Maximum display RGB error |
| --- | ---: |
| AgX, None, exposure 0, gamma 1 | 0.00000763 |
| AgX, Medium High Contrast, exposure 1.25, gamma 1.2 | 0.00000799 |
| Filmic, Medium High Contrast, exposure -0.5, gamma 1.4 | 0.00000763 |
| Standard, exposure 0.3, gamma 1 | 0.00000763 |
| AgX Punchy, exposure 0.7, gamma 1.2, white balance 4300 K / tint -25 | 0.00001215 |

Most error is at the 16-bit output quantization scale. This verifies the CPU composition against Blender image output. Browser shader precision, frame-buffer encoding, alpha handling, display emulation and actual scene-render equality remain separate acceptance work.

## Composition

The prototype follows Blender's display processor order: scene-linear exposure and white balance, selected look, selected view/display transform, then exponent 1/gamma. White balance uses Blender RNA's `white_balance_whitepoint`, which already evaluates the authored temperature and tint into scene RGB; Bradford adaptation converts that source white to the scene-space white. The scene-to-XYZ matrix is measured from the active OCIO color-space processor. This avoids reimplementing Blender's temperature/tint lookup table. [Blender display processor source](https://github.com/blender/blender/blob/main/source/blender/imbuf/opencolorio/intern/libocio/libocio_display_processor.cc), [white-point source](https://github.com/blender/blender/blob/main/source/blender/imbuf/opencolorio/intern/white_point.cc)

Read the explicit `OCIO` configuration path when present, otherwise the installed `datafiles/colormanagement/config.ocio`. Do not assume `PyOpenColorIO.GetCurrentConfig()` is Blender's loaded configuration; the probe found its name empty. Cache the actual configuration and processor identities. The prototype rejects authored display curves and does not certify arbitrary custom configurations, HDR display emulation, or non-sRGB browser output.

## Typed operation seam

`processor.getOptimizedProcessor(OCIO.OPTIMIZATION_DEFAULT).createGroupTransform()` exposes typed operations and numeric getters. The prototype serializes Matrix, Log, LogAffine, Exponent, ExponentWithLinear, Lut1D and Lut3D, plus direction and negative-style metadata. Buffers use base64 little-endian float32. This permits an allowlisted TSL interpreter with no dynamic JavaScript evaluation. [OCIO processors](https://opencolorio.readthedocs.io/en/latest/api/processors.html)

Default AgX requires six operations: Matrix → Log2 → Matrix → 57³ tetrahedral LUT → exponent 2.4 → inverse exponent-with-linear. Standard is Matrix → inverse exponent-with-linear. Tested Filmic contrast uses 33³ LUTs and linear 1D LUTs with 65,536 and 4,096 entries, without half-domain or hue adjustment. AgX contrast adds GradingPrimary; Punchy adds GradingTone and CDL. Those latter operations need explicit support. GradingPrimary's tested contrast-only case is just a pivoted linear contrast operation in its native log space; the extracted GLSL shows pivot 0.4 and contrast 1.2, making that narrow case a small next extension.

OCIO GPU shader extraction also works, but 2.5 exposes GLSL/HLSL/MSL rather than WGSL. A direct trial of Three r184's GLSLDecoder failed for all four extracted programs; its presence does not make generic transpilation a verified shortcut. Typed OCIO operations are the simpler current seam. [OCIO shader API](https://opencolorio.readthedocs.io/en/latest/api/shaders.html)

## Runtime numerical semantics

- Matrix arrays are row-major, multiplying a column RGBA vector, followed by offset. Resolve inverse direction deliberately.
- Forward Log clamps to float32's minimum positive normal before log; reverse Log uses exponentiation. LogAffine adds the documented slope/offset operations on each side; inverse must reverse their order.
- LUT3D data is RGB triplets in `(r,g,b)` order, **blue index fastest**: `((r*N+g)*N+b)*3`. A Three Data3DTexture uploaded in this order samples coordinates `.zyx`, or the exporter can transpose data. Preserve OCIO tetrahedral interpolation, clamping and direction.
- For a forward linear Lut1D, sample each output channel's own curve at its input coordinate. The prototype rejects inverse, half-domain and hue-adjusted variants.
- Exponent negative styles must remain distinct: clamp, mirror and pass-through are different functions. Preserve alpha separately from the RGB display transform.
- For inverse ExponentWithLinear with gamma `g > 1` and offset `a > 0`, define `b = (g*a/((g-1)*(1+a)))^g` and `s = (a/(g-1))/b`. Above linear-input breakpoint `b`, output is `x^(1/g)*(1+a)-a`; below it the linear extension is `x*s`. For forward direction the corresponding encoded breakpoint is `a/(g-1)` and the branches are reversed analytically. Handle identity gamma, zero offset, and negative styles explicitly; the general formula has singular cases.
- Exported values are already display-encoded. Disable the pipeline's automatic tone mapping/output transform, or a second transform changes the result. The application's input working space must match the program's declared input space.

The default-AgX CPU reference evaluator in `probe_lut_accuracy.py` tests 101,000 RGB values, including negative channels and HDR values through 2^16. Correct tetrahedral sampling produced maximum error **0.00001918** versus OCIO; changing only interpolation to trilinear produced maximum **0.10645**, with 99th-percentile error **0.00605**. This is a material difference, not a rounding detail.

### Measured narrow contrast lowering

The prototype now includes `lower_neutral_log_contrast()`. It accepts only nondynamic forward-log GradingPrimary with neutral brightness, offset, exposure, lift, gamma, gain and saturation, no clamping, and unchanged black/white pivots. OCIO computes channel contrast as `float32(master * channel)` and the actual pivot as `0.5 + 0.5 * authoredPivot`; the nominal -0.2 pivot therefore means 0.4 in its native log domain. That operation is algebraically a diagonal Matrix plus offset `pivot * (1 - contrast)`. [OCIO 2.5 computation](https://github.com/AcademySoftwareFoundation/OpenColorIO/blob/v2.5.0/src/OpenColorIO/ops/gradingprimary/GradingPrimary.cpp), [CPU application](https://github.com/AcademySoftwareFoundation/OpenColorIO/blob/v2.5.0/src/OpenColorIO/ops/gradingprimary/GradingPrimaryOpCPU.cpp)

`probe_contrast_lowering.py` checks the complete Medium High Contrast display processor on 90,000 held-out negative, ordinary and HDR RGB samples. Maximum difference after lowering was **0.00000282** and 99th-percentile difference **0.000000715**. Mutation checks reject nonneutral fields. Other built-in contrast looks have nonneutral saturation and are deliberately rejected by this narrow guard; an additional proven saturation matrix could broaden coverage. Base Contrast introduces a RangeTransform elsewhere, which the initial serializer does not yet handle. Reports are in `contrast-lowering-results.json`; these are CPU comparisons rather than GPU/browser certification.

## Rejected full-transform LUT shortcut

The prototype also measures a 65³ tetrahedral LUT sampling the complete processor with a signed-log1p shaper, scale 0.01 and component domain [-16,4096]. On 60,000 held-out samples:

| Look | Maximum error | 99th percentile |
| --- | ---: | ---: |
| AgX Medium High Contrast | 0.61686 | 0.09168 |
| AgX Punchy | 0.52512 | 0.06835 |

Mixed negative components and saturated colors expose severe interpolation errors. These results reject that full-transform approximation for high-fidelity output. Keep exact operation transport; implement additional grading operations or investigate narrowly materializing individual unsupported operations in their native, well-conditioned domains. Any such approximation needs its own held-out error gate. The prototype's `approximate: false` means no additional resampling was introduced; it is not certification of an untested browser implementation.
