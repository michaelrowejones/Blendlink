# Blender display transform and premultiplied alpha

Measured September 7, 2026 against Blender 5.2.0 LTS, `fbe6228777e7`. The display transform must receive unassociated RGB for partial-alpha compositor pixels. Applying OCIO directly to premultiplied RGB produces visibly incorrect translucent colors.

For normal `0 < alpha < 1` pixels, the premultiplied display-buffer operation is:

```
displayRGB = OCIO(scenePremultipliedRGB / alpha) * alpha
displayAlpha = alpha
```

When alpha is 0 or 1, Blender's CPU predivide path applies OCIO directly and skips both division and multiplication. Alpha-zero pixels can carry emissive RGB and must retain it. This is an explicit source behavior, not a guessed epsilon rule. Very small positive alpha still divides normally. [LibOCIOCPUProcessor::apply_rgba_predivide and apply_predivide](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/imbuf/opencolorio/intern/libocio/libocio_cpu_processor.cc) implement the division, OCIO processing, and multiplication. [Display buffer application](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/imbuf/intern/colormanagement.cc) chooses predivide for float images whose alpha affects RGB and stores premultiplied float display pixels.

The GPU display shader divides only when `0 < alpha < 1`. Its `OUTPUT_PREMULTIPLIED` variant restores multiplication after the display transform, except when a premultiplied input has alpha zero or less. That exception preserves emissive pixels. A straight-output destination omits multiplication and uses straight-alpha blending later. CPU and GPU handling of alpha outside `[0,1]` is not identical; this research does not assert parity for that range. The normal `[0,1]` contract is consistent. [Pinned GPU display shader](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/imbuf/opencolorio/shaders/gpu_shader_display_transform_frag.glsl).

For a browser renderer, keep scene and compositor intermediate images premultiplied, divide at the display-transform boundary, and restore multiplication exactly once if the final target expects premultiplied output. A PNG export expects straight RGB. Blending against a background is a separate operation and must not accidentally apply alpha twice. The authored CurveMapping path runs before the OCIO predivide step in the pinned source; a runtime that supports those curves must preserve that order too.

## Measured RenderResult fixture

`artifacts/verification-look/compositor/probe_display_alpha.py` uses an identity compositor fed by a known float image. It renders through Blender's actual RenderResult-to-PNG16 path, then reads PNG samples as Non-Color, straight RGBA. The fixture uses alpha `0,.001,.0625,.125,.25,.5,.75,1`, eight colors including HDR and negative channels, and nonzero emissive RGB at alpha zero. It runs isolated with `--background --factory-startup` and does not modify an existing scene.

| View | Unpremultiply then OCIO, maximum PNG16 error | Direct OCIO on premultiplied RGB, maximum error |
| --- | ---: | ---: |
| AgX | 0.00000723 | 0.957260 |
| Filmic | 0.00000745 | 0.897036 |
| Standard | 0.00000689 | 0.987077 |

The approximately `7.6e-6` ceiling is consistent with 16-bit PNG quantization. Alpha itself differs by at most `7.6293945e-6` from that quantization. These measurements verify the straight display RGB path. The equivalent premultiplied float output follows the independently inspected CPU source above.

Fixtures in `display-alpha-cases/{AgX,Filmic,Standard}.json` include scene-linear premultiplied input, actual PNG16 straight RGBA, high-precision OCIO straight expected values, and high-precision premultiplied expected values. Arrays are bottom-row-first, x-fastest RGBA. The alpha-zero expected values retain transformed emissive RGB. These files can verify the browser's display stage without drawing geometry or relying on screenshot comparison.
