# SPDX-License-Identifier: GPL-3.0-or-later
"""Live spectral color nodes, with explicit native evaluation models.

Tables originate in Apache-2.0 Cycles kernel/tables.h; see spectral_tables.json.
The exporter transports color-space matrices rather than assuming RGB primaries.
"""
from functools import lru_cache
import json
import os
from pathlib import Path

import bpy
import numpy as np
import PyOpenColorIO as O
from mathutils import Matrix
try:
    from .shader_domains import native_shader_input_evaluation
    from .shader_color_band import native_color_band
except ImportError:
    from shader_domains import native_shader_input_evaluation
    from shader_color_band import native_color_band


@lru_cache(maxsize=1)
def _tables():
    return json.loads(Path(__file__).with_name("spectral_tables.json").read_text())


def _linear_matrix(cfg, source, target):
    processor = cfg.getProcessor(source, target)
    operations = processor.getOptimizedProcessor(O.OPTIMIZATION_DEFAULT).createGroupTransform()
    matrix = np.eye(4, dtype=np.float64)
    for operation in operations:
        if not isinstance(operation, O.MatrixTransform) or any(operation.getOffset()):
            raise ValueError("Spectral colors require a linear, zero-offset working-space transform")
        current = np.asarray(operation.getMatrix()).reshape(4, 4)
        if operation.getDirection() == O.TRANSFORM_DIR_INVERSE:
            current = np.linalg.inv(current)
        matrix = current @ matrix
    if not np.isfinite(matrix).all() or not np.array_equal(matrix[3], [0, 0, 0, 1]) \
            or np.any(matrix[:3, 3]):
        raise ValueError("Spectral working-space matrix has unsupported alpha or offset terms")
    result = matrix[:3, :3].astype(np.float32)
    if not np.isfinite(result).all():
        raise ValueError("Spectral working-space matrix exceeds native float32 precision")
    return result


def _sample_linear_matrix(cfg, source):
    # Native legacy OCIO obtains the columns by applying its float CPU
    # processor to the three unit vectors. Validate linearity before sampling.
    _linear_matrix(cfg, source, O.ROLE_SCENE_LINEAR)
    processor = cfg.getProcessor(source, O.ROLE_SCENE_LINEAR).getDefaultCPUProcessor()
    return Matrix(np.asarray([processor.applyRGB(vector.tolist()) for vector in np.eye(3)]).T.tolist())


@lru_cache(maxsize=8)
def _matrices(path, stamp, legacy, cycles):
    cfg = O.Config.CreateFromFile(path)
    if legacy:
        xyz709 = Matrix(((3.2404542, -1.5371385, -.4985314),
                         (-.9692660, 1.8760108, .0415560),
                         (.0556434, -.2040259, 1.0572252)))
        xyz = xyz709.copy()
        if cfg.hasRole("aces_interchange"):
            ap0xyz = Matrix(((.938280, -.004451, .016628),
                             (.337369, .729522, -.066890),
                             (.001174, -.003711, 1.091595)))
            xyz = _sample_linear_matrix(cfg, "aces_interchange") @ ap0xyz.inverted()
        elif cfg.hasRole("XYZ"):
            xyz = _sample_linear_matrix(cfg, "XYZ")
        # Cycles multiplies XYZ by inverse(Rec709); IMB/EEVEE inverts
        # Rec709*inverse(XYZ). Float32 rounding makes these observably distinct.
        rec709 = xyz @ xyz709.inverted() if cycles else (xyz709 @ xyz.inverted()).inverted()
        return np.asarray(xyz, np.float32), np.asarray(rec709, np.float32)
    xyz = _linear_matrix(cfg, "cie_xyz_d65_interchange", O.ROLE_SCENE_LINEAR)
    rec709 = _linear_matrix(cfg, "Linear Rec.709", O.ROLE_SCENE_LINEAR)
    return xyz, rec709


def _color_matrices(engine):
    path = os.environ.get("OCIO") or str(Path(bpy.utils.resource_path("LOCAL")) /
                                       "datafiles/colormanagement/config.ocio")
    stamp = Path(path).stat().st_mtime_ns if Path(path).is_file() else None
    return _matrices(path, stamp, bpy.app.version < (5, 1, 0), engine == "CYCLES")


def _blackbody_rgb(temperature, matrix):
    f = np.float32
    t = f(temperature)
    table = _tables()
    if t >= 12000:
        color = np.array([0.8262954810464208, 0.9945080501520986, 1.566307710274283], np.float32)
    elif t < 800:
        color = np.array([5.413294490189271, -0.20319390035873933, -0.0822535242887164], np.float32)
    else:
        index = sum(t >= boundary for boundary in (965, 1167, 1449, 1902, 3315, 6365))
        r, g, b = [np.asarray(table["blackbody_table_" + channel][index], np.float32) for channel in "rgb"]
        inverse = f(1) / t
        color = np.array([r[0] * inverse + r[1] * t + r[2],
                          g[0] * inverse + g[1] * t + g[2],
                          ((b[0] * t + b[1]) * t + b[2]) * t + b[3]], np.float32)
    return np.maximum(matrix @ color, 0)


def _wavelength_rgb(wavelength, matrix):
    f = np.float32
    position = (f(wavelength) - f(380)) * f(0.2)
    index = int(position)
    if index < 0 or index >= 80:
        return np.zeros(3, np.float32)
    table = np.asarray(_tables()["cie_color_match"], np.float32)
    xyz = table[index] + (position - f(index)) * (table[index + 1] - table[index])
    return np.maximum(matrix @ xyz, 0)


def emit_spectral(node, socket, *, emit_input, refuse, fold_scalar, evaluation_engine):
    if socket.name != "Color":
        refuse("Spectral color nodes only provide the Color output")
    kind = {"ShaderNodeBlackbody": "blackbody", "ShaderNodeWavelength": "wavelength"}.get(node.bl_idname)
    if kind is None:
        refuse("Unknown spectral node " + node.bl_idname)
    try:
        xyz, rec709 = _color_matrices(evaluation_engine)
    except Exception as error:
        refuse("Spectral working-space transform is unavailable: " + str(error))
    engine = evaluation_engine
    if engine not in {"CYCLES", "EEVEE", "BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"}:
        refuse("Spectral node evaluation requires a Cycles or EEVEE source engine")
    matrix = rec709 if kind == "blackbody" else xyz
    name = "Temperature" if kind == "blackbody" else "Wavelength"
    incoming = emit_input(node.inputs[name])
    # EEVEE can fold constant Blackbody through its native multi-function.
    stage = native_shader_input_evaluation(incoming)
    if engine != "CYCLES" and bpy.app.version >= (5, 0, 0) and kind == "blackbody" and stage == "opaque":
        refuse("Blackbody input has no verified native constant-versus-shader evaluation model")
    cycles_stage = native_shader_input_evaluation(incoming, cycles=True)
    if engine == "CYCLES" and kind == "blackbody" and bpy.app.version < (5, 1, 0):
        xyz709 = np.asarray(((3.2404542, -1.5371385, -.4985314),
                            (-.9692660, 1.8760108, .0415560),
                            (.0556434, -.2040259, 1.0572252)), np.float32)
        if np.max(np.abs(xyz - xyz709)) <= .0001:
            # The legacy SVM kernel short-circuits its almost-Rec709 matrix;
            # CPU graph folding still multiplies that matrix unconditionally.
            if cycles_stage == "opaque":
                refuse("Blackbody input has no verified Cycles constant-folding model")
            if cycles_stage == "shader":
                matrix = np.eye(3, dtype=np.float32)
    analytical = engine == "CYCLES" or (kind == "blackbody" and stage == "constant" and
                                        bpy.app.version >= (5, 0, 0))
    result = {"op": "spectral", "kind": kind, "model": "cycles" if analytical else "eevee-table",
              "matrix": matrix.ravel().tolist(), "input": incoming, "sourceEngine": engine, "inputEvaluation": stage,
              "workingSpace": "exported OCIO scene-linear matrix"}
    result["cyclesInputEvaluation"] = cycles_stage
    if kind == "blackbody":
        for channel in "rgb":
            result[channel + "Coefficients"] = [value for row in _tables()["blackbody_table_" + channel] for value in row]
    if result["model"] == "eevee-table":
        size = 257
        low, span = (800, 11200) if kind == "blackbody" else (380, 400)
        evaluator = _blackbody_rgb if kind == "blackbody" else _wavelength_rgb
        values = [[*evaluator(np.float32(low) + np.float32(span / size) * np.float32(index), matrix), 1]
                  for index in range(size)]
        try:
            result.update(samples=size, **native_color_band(values))
        except ValueError as error:
            refuse(str(error))
    elif kind == "wavelength":
        result.update(samples=81, values=[value for row in _tables()["cie_color_match"] for value in [*row, 1]])
    return result
