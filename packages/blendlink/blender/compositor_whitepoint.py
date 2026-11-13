# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only transport for compositor Color Balance's native White Point mode."""
import math
import bisect
from pathlib import Path
import os

import bpy
import numpy as np
import PyOpenColorIO as OCIO
from mathutils import Matrix, Vector


PARAMETERS = ("Input Temperature", "Input Tint", "Output Temperature", "Output Tint")
# Blender BLI_math_color.cc's Robertson table: inverse MK, CIE1960 u/v, isotherm slope.
LOCUS = (
    (0, .18006, .26352, -.24341), (10, .18066, .26589, -.25479), (20, .18133, .26846, -.26876),
    (30, .18208, .27119, -.28539), (40, .18293, .27407, -.30470), (50, .18388, .27709, -.32675),
    (60, .18494, .28021, -.35156), (70, .18611, .28342, -.37915), (80, .18740, .28668, -.40955),
    (90, .18880, .28997, -.44278), (100, .19032, .29326, -.47888), (125, .19462, .30141, -.58204),
    (150, .19962, .30921, -.70471), (175, .20525, .31647, -.84901), (200, .21142, .32312, -1.0182),
    (225, .21807, .32909, -1.2168), (250, .22511, .33439, -1.4512), (275, .23247, .33904, -1.7298),
    (300, .24010, .34308, -2.0637), (325, .24792, .34655, -2.4681), (350, .25591, .34951, -2.9641),
    (375, .26400, .35200, -3.5814), (400, .27218, .35407, -4.3633), (425, .28039, .35577, -5.3762),
    (450, .28863, .35714, -6.7262), (475, .29685, .35823, -8.5955), (500, .30505, .35907, -11.324),
    (525, .31320, .35968, -15.628), (550, .32129, .36011, -23.325), (575, .32931, .36038, -40.770),
    (600, .33724, .36051, -116.45),
)
BRADFORD = ((.8951, .2664, -.1614), (-.7502, 1.7135, .0367), (.0389, -.0685, 1.0296))


def whitepoint_xyz(temperature, tint):
    """BLI's float32 Robertson evaluator; avoid a lossy XYZ -> scene -> XYZ roundtrip."""
    f = np.float32
    table = np.asarray(LOCUS, dtype=np.float32)
    mired = f(1e6) / f(temperature)
    index = bisect.bisect_left(table[:, 0], mired)
    low, high = table[index - 1], table[index]
    factor = (mired - low[0]) / (high[0] - low[0])

    def normalize(vector):
        return vector / np.sqrt(vector[0] * vector[0] + vector[1] * vector[1])

    uv = low[1:3] * (f(1) - factor) + high[1:3] * factor
    a, b = normalize(np.asarray((1, low[3]), dtype=np.float32)), normalize(np.asarray((1, high[3]), dtype=np.float32))
    direction = normalize(a * (f(1) - factor) + b * factor)
    uv -= direction * f(tint) / f(3000)
    denominator = f(2) * uv[0] - f(8) * uv[1] + f(4)
    x, y = f(3) * uv[0] / denominator, f(2) * uv[1] / denominator
    return Vector((float(x / y), 1, float((f(1) - x - y) / y)))


def source_lms_bounds(temperature, tint):
    """Conservative piecewise analytic bounds; no sampled-grid zero-crossing guess.

    Along each table segment both uv coordinates are linear and each component
    of the normalized interpolated isotherm is monotone (all slopes are negative).
    XYZ has Y=1 and X=1.5u/v, Z=(2-.5u-5v)/v. Therefore every LMS numerator is
    linear in uv, and interval division is safe once v's lower bound is positive.
    The final 2e-5 expansion conservatively covers native float32 arithmetic and
    deliberately refuses near-pole grades rather than amplifying tiny errors.
    """
    low, high = 1e6 / temperature[1], 1e6 / temperature[0]
    limits = [[math.inf, -math.inf] for _ in range(3)]

    def normalize(vector):
        length = math.sqrt(sum(v * v for v in vector))
        return [v / length for v in vector]

    for lower, upper in zip(LOCUS[:-1], LOCUS[1:]):
        start, end = max(low, lower[0]), min(high, upper[0])
        if start > end:
            continue
        uv, directions = [], []
        a, b = normalize((1, lower[3])), normalize((1, upper[3]))
        for position in (start, end):
            factor = (position - lower[0]) / (upper[0] - lower[0])
            uv.append([lower[i] * (1 - factor) + upper[i] * factor for i in (1, 2)])
            directions.append(normalize([x * (1 - factor) + y * factor for x, y in zip(a, b)]))
        intervals = []
        for axis in range(2):
            offsets = [direction[axis] * t / 3000 for direction in directions for t in tint]
            intervals.append((min(point[axis] for point in uv) - max(offsets),
                              max(point[axis] for point in uv) - min(offsets)))
        u, v = intervals
        if v[0] <= 0:
            return None
        for index, (a, b, c) in enumerate(BRADFORD):
            terms = [(a * 1.5 - c * .5) * item for item in u]
            second = [(b - 5 * c) * item for item in v]
            numerator = (min(terms) + min(second) + 2 * c, max(terms) + max(second) + 2 * c)
            values = [n / denominator for n in numerator for denominator in v]
            limits[index][0] = min(limits[index][0], min(values) - 2e-5)
            limits[index][1] = max(limits[index][1], max(values) + 2e-5)
    return limits


def whitepoint_properties(node, bounds, fail):
    domains = []
    for name in PARAMETERS:
        domain = bounds(node.inputs[name])
        low, high = (1800.0, 100000.0) if name.endswith("Temperature") else (-150.0, 150.0)
        if domain is None or not all(math.isfinite(v) for v in domain) or domain[0] < low or domain[1] > high:
            fail(node.inputs[name], "White Point requires proven " + name + " bounds within "
                 + str(low) + ".." + str(high) + "; bound image-driven values with Math Maximum and Minimum")
        domains.append(list(domain))
    lms_bounds = source_lms_bounds(domains[0], domains[1])
    if lms_bounds is None or any(not all(math.isfinite(v) for v in row) or row[0] <= 0 <= row[1]
                                 for row in lms_bounds):
        fail(node.inputs["Input Temperature"], "White Point requires a provably nonzero Bradford source response; "
             "input temperature/tint bounds cross or approach a native adaptation pole")
    path = os.environ.get("OCIO") or str(Path(bpy.utils.resource_path("LOCAL"))
                                        / "datafiles/colormanagement/config.ocio")
    try:
        config = OCIO.Config.CreateFromFile(path)
    except Exception as error:
        raise ValueError("White Point cannot resolve the authored OCIO configuration: " + str(error)) from error

    def linear_matrix(source, target):
        try:
            transform = config.getProcessor(source, target)
            operations = transform.getOptimizedProcessor(OCIO.OPTIMIZATION_DEFAULT).createGroupTransform()
            if any(not isinstance(operation, OCIO.MatrixTransform) for operation in operations):
                raise ValueError("White Point requires matrix-only scene-linear/XYZ working-space transforms")
            processor = transform.getDefaultCPUProcessor()
        except Exception as error:
            raise ValueError("White Point cannot resolve the scene-linear/XYZ working-space transform: " + str(error)) from error
        points = np.asarray([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
                             [-0.25, 0.5, 2], [0.125, -0.5, 0.75]], dtype=np.float32)
        expected = points.copy()
        processor.applyRGB(expected)
        matrix = expected[1:4].T
        if not np.isfinite(expected).all() or np.max(np.abs(expected[0])) > 1e-7 \
                or not np.allclose(expected, points @ matrix.T, rtol=1e-6, atol=1e-6):
            raise ValueError("White Point requires a linear zero-offset scene-linear/XYZ working-space transform")
        return Matrix(matrix.tolist())

    forward = linear_matrix("scene_linear", "cie_xyz_d65_interchange")
    reverse = linear_matrix("cie_xyz_d65_interchange", "scene_linear")
    if np.max(np.abs(np.asarray(forward @ reverse) - np.eye(3))) > 1e-5:
        raise ValueError("White Point scene-linear/XYZ matrices are not inverse transforms")
    properties = {"white_point_model": "native-bradford-robertson-v1",
                  "white_point_domains": domains,
                  "white_point_source_lms_bounds": lms_bounds,
                  "white_point_scene_to_xyz": [list(row) for row in forward],
                  "white_point_xyz_to_scene": [list(row) for row in reverse],
                  "white_point_gpu_constant": not any(node.inputs[name].is_linked for name in PARAMETERS)}
    if all(low == high for low, high in domains):
        # RNA exposes Blender's actual temperature/tint -> scene-RGB result.
        # Change only an owned NodeTree copy; remove it even if OCIO refuses.
        temporary = node.id_data.copy()
        try:
            owned = temporary.nodes[node.name]
            for name, domain in zip(PARAMETERS, domains):
                for link in list(owned.inputs[name].links):
                    temporary.links.remove(link)
                owned.inputs[name].default_value = domain[0]
            source = whitepoint_xyz(domains[0][0], domains[1][0])
            target = whitepoint_xyz(domains[2][0], domains[3][0])
            # RNA independently evaluates the same native function in scene RGB.
            # Verify the transported locus against it without using that lossy
            # scene-space roundtrip to construct the adaptation matrix.
            for xyz, rgb in ((source, owned.input_whitepoint), (target, owned.output_whitepoint)):
                if not np.allclose(reverse @ xyz, rgb, rtol=2e-6, atol=2e-6):
                    raise ValueError("White Point's native temperature/tint locus differs from the verified model")
            bradford = Matrix(BRADFORD)
            source_lms = bradford @ source / source.y
            target_lms = bradford @ target / target.y
            scale = Matrix.Diagonal(Vector(tuple(b / a for a, b in zip(source_lms, target_lms))))
            matrix = reverse @ (bradford.inverted() @ scale @ bradford) @ forward
            properties["white_point_constant_matrix"] = [list(row) for row in matrix]
        finally:
            bpy.data.node_groups.remove(temporary)
    return properties
