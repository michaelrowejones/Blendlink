# SPDX-License-Identifier: GPL-3.0-or-later
"""Vector Transform extraction with explicit native coordinate semantics."""
import math
import struct
import bpy


def _literal_vector(expression):
    if expression.get("op") == "const_vec3":
        return expression.get("value")
    if expression.get("op") == "combine":
        channels = [expression.get(axis, {}) for axis in ("x", "y", "z")]
        if all(channel.get("op") == "const_float" for channel in channels):
            return [channel["value"] for channel in channels]
    if expression.get("op") == "color_convert" and expression.get("mode") == "RGB":
        return _literal_vector(expression["input"])
    return None


def emit_vector_transform(node, socket, *, emit_input, refuse, engine):
    if socket.identifier != "Vector":
        refuse("Vector Transform has no verified output " + socket.identifier)
    kind, source, target = str(node.vector_type), str(node.convert_from), str(node.convert_to)
    if kind not in {"POINT", "VECTOR", "NORMAL"} or source not in {"WORLD", "OBJECT", "CAMERA"} \
            or target not in {"WORLD", "OBJECT", "CAMERA"}:
        refuse("Vector Transform requires a verified World, Object or Camera space")
    incoming = emit_input(node.inputs["Vector"])
    if engine not in {"CYCLES", "EEVEE"}: refuse("Vector Transform has no verified source engine " + str(engine))
    normalizes = kind == "NORMAL" and (source != target or engine == "EEVEE")
    if normalizes:
        literal = _literal_vector(incoming)
        if literal is None or not all(math.isfinite(value) for value in literal) \
                or not 1e-10 <= max(abs(value) for value in literal) <= 1e10:
            refuse("Vector Transform Normal requires a verified nonzero finite input; native zero normalization is undefined")
    return {"op": "vector_transform", "kind": kind, "from": source, "to": target,
            "sourceEngine": engine,
            "normalModel": "direction" if engine == "EEVEE" and bpy.app.version < (5, 2, 0) else "object-inverse-transpose",
            "input": incoming, "cameraModel": "scale-normalized-positive-z-forward",
            "normalDomain": "verified-nonzero" if normalizes else "not-normalized"}


def collect_requirements(value, requirements):
    if isinstance(value, dict):
        if value.get("op") == "vector_transform" and value.get("from") != value.get("to"):
            requirements.append(value)
        for child in value.values(): collect_requirements(child, requirements)
    elif isinstance(value, (list, tuple)):
        for child in value: collect_requirements(child, requirements)


def validate_owner(obj, requirements):
    needed = [item for item in requirements if "OBJECT" in {item.get("from"), item.get("to")}]
    if not needed: return
    import bpy
    graph = bpy.context.evaluated_depsgraph_get()
    if getattr(obj, "is_instancer", False) or any(instance.is_instance and getattr(instance.object, "original", None) == obj for instance in graph.object_instances):
        raise ValueError(f'Vector Transform on "{obj.name}" requires distinct authored object transforms; generated instances are not transported yet')
    matrix = obj.evaluated_get(graph).matrix_world.copy()
    def finite(value):
        try: return math.isfinite(struct.unpack("f", struct.pack("f", value))[0])
        except (OverflowError, struct.error): return False
    if not all(finite(value) for row in matrix for value in row):
        raise ValueError(f'Vector Transform on "{obj.name}" needs a finite float32 object matrix')
    inverse_needed = any((item.get("from") == "OBJECT" if item.get("kind") == "NORMAL" and item.get("normalModel") != "direction" else item.get("to") == "OBJECT") for item in needed)
    if inverse_needed:
        if not math.isfinite(matrix.determinant()) or matrix.determinant() == 0:
            raise ValueError(f'Vector Transform on "{obj.name}" needs an invertible object matrix for its selected direction/type')
        inverse = matrix.inverted()
        if not all(finite(value) for row in inverse for value in row):
            raise ValueError(f'Vector Transform on "{obj.name}" has no finite float32 inverse object matrix')
    from mathutils import Vector
    for item in needed:
        if item.get("kind") != "NORMAL" or "CAMERA" in {item.get("from"), item.get("to")}: continue
        witness = _literal_vector(item.get("input", {}))
        if witness is None: raise ValueError("Vector Transform needs a verified literal normal")
        if item.get("normalModel") == "direction":
            transform = matrix if item.get("from") == "OBJECT" else matrix.inverted()
        else:
            transform = matrix.inverted().transposed() if item.get("from") == "OBJECT" else matrix.transposed()
        transformed = transform.to_3x3() @ Vector(witness)
        maximum = max(abs(value) for value in transformed)
        if not math.isfinite(maximum) or not 1e-18 <= maximum <= 1e18:
            raise ValueError(f'Vector Transform normal on "{obj.name}" is outside its verified float32 normalization domain')
