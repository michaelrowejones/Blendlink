# SPDX-License-Identifier: GPL-3.0-or-later
"""Conservative native shader evaluation-stage classification.

Constant means eligible for native multi-function constant evaluation, not just
spatially uniform on a mesh. Texture images and object uniforms still require
shader evaluation even when their coordinates/property happen to be constant.
Unknown operations remain opaque until their native evaluation is proved.
"""

_CONSTANT = {"const_float", "const_vec3", "typed_const"}
_SHADER = {"noise_field_nearest", "uv", "uv_active", "generated", "object_coords", "normal_view", "view_cos",
           "attribute_object", "vertex_color", "normal_map", "object_info",
           "ambient_occlusion", "fresnel", "layer_weight", "shader_to_rgb_diffuse",
           "texture_ref", "tex_image", "vector_transform", "geometry_context", "normal_map_native", "normal_view_native", "tangent_native", "normal_map_tangent_native", "bump_passthrough_native", "bump_height_native"}
_FUNCTION = {"math_modulo_native", "math", "vector_math", "mapping", "vector_rotate", "vector_scale",
             "combine", "separate", "clamp01", "clamp_minmax", "mix_color",
             "rgb_to_bw", "hue_sat", "hsv_to_rgb", "rgb_to_hsv", "gamma",
             "invert", "bright_contrast", "color_ramp", "ramp_alpha", "ramp_lut",
             "curve_rgb", "curve_native", "noise", "noise_fractal", "noise_normalized", "noise_varying", "noise_varying_native", "tex_checker", "tex_gradient", "tex_magic",
             "tex_wave", "tex_voronoi", "tex_white_noise", "tex_brick",
             "typed_convert", "boolean_math", "integer_math"}
_CYCLES_FUNCTION = {"math_modulo_native", "math", "vector_math", "mapping", "vector_scale", "combine",
                   "separate", "clamp01", "clamp_minmax", "mix_color", "rgb_to_bw",
                   "hsv_to_rgb", "rgb_to_hsv", "gamma", "invert", "bright_contrast",
                   "color_ramp", "ramp_alpha", "ramp_lut", "curve_rgb", "curve_native",
                   "typed_convert", "boolean_math", "integer_math"}


def native_shader_input_evaluation(expression, *, cycles=False):
    """Return constant, shader, or opaque for a lowered input expression."""
    if not isinstance(expression, dict) or "op" not in expression:
        return "opaque"
    operation = expression["op"]
    if operation == 'tex_magic_native':
        if expression.get('model')!='eevee-magic-f32-v1' or expression.get('sourceEngine')!='EEVEE':return 'opaque'
        if expression.get('evaluationModel')=='shader':return 'shader'
        if expression.get('evaluationModel')!='mf':return 'opaque'
        values=[native_shader_input_evaluation(expression.get(key)) for key in ['vector','scale','distortion']]
        return 'constant' if all(value=='constant' for value in values) else 'opaque'
    if operation == "color_convert":
        # Shader Separate/Combine Color has a Cycles constant folder, but
        # no material multi-function registration in EEVEE.
        return native_shader_input_evaluation(expression.get("input"), cycles=True) if cycles else "shader"
    if operation in _CONSTANT:
        return "constant"
    if operation in _SHADER:
        return "shader"
    if cycles and operation in _FUNCTION and operation not in _CYCLES_FUNCTION:
        return "shader"
    if operation == "spectral":
        if expression.get("kind") == "wavelength":
            return "shader"
        if expression.get("kind") != "blackbody":
            return "opaque"
        return native_shader_input_evaluation(expression.get("input"), cycles=cycles)
    if operation not in _FUNCTION:
        return "opaque"
    children = []

    def collect(value):
        if isinstance(value, dict):
            if "op" in value:
                children.append(native_shader_input_evaluation(value, cycles=cycles))
            else:
                for child in value.values():
                    collect(child)
        elif isinstance(value, (list, tuple)):
            for child in value:
                collect(child)

    for name, value in expression.items():
        if name != "op":
            collect(value)
    if not children or "opaque" in children:
        return "opaque"
    return "shader" if "shader" in children else "constant"
