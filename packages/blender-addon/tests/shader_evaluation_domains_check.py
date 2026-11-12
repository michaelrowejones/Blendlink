# SPDX-License-Identifier: GPL-3.0-or-later
"""Composed nodes must retain the correct native folding eligibility."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from shader_domains import native_shader_input_evaluation as stage

constant = {"op": "const_float", "value": .5}
vector = {"op": "const_vec3", "value": [.25, .5, .75]}
noise = {"op": "noise", "vector": vector, "scale": constant}
color = {"op": "color_convert", "input": vector, "mode": "HSV"}
curve = {"op": "curve_native", "input": color, "factor": constant}
# Shader Color converters have no EEVEE multi-function, even for literals.
# Cycles' constant folder does fold them; this distinction affects a legacy
# downstream Blackbody's working-space transform.
assert stage(curve) == "shader"
assert stage(curve, cycles=True) == "constant"
# Procedural functions can fold in modern material MF preprocessing while
# remaining SVM operations in the legacy Cycles graph.
for operation in ["noise", "noise_fractal", "noise_varying", "noise_varying_native", "noise_normalized"]:
    expression = {**noise, "op": operation}
    assert stage(expression) == "constant"
    assert stage(expression, cycles=True) == "shader"
    assert stage({**expression, "vector": {"op": "texture_ref"}}) == "shader"
# Uniform object/image inputs still require shader evaluation. An unfamiliar
# function cannot inherit constant status just because its knobs are literals.
for op in ["object_info", "texture_ref"]:
    assert stage({"op": "math", "a": {"op": op}, "b": constant}) == "shader"
assert stage({"op": "future_function", "input": constant}) == "opaque"
assert stage({"op": "curve_native", "input": {"op": "future_function"}, "factor": constant}) == "opaque"
print("BLENDLINK_SHADER_EVALUATION_DOMAINS_CHECK_PASSED composed native engine and folding semantics")
