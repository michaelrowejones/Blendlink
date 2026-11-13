# SPDX-License-Identifier: GPL-3.0-or-later
"""Correct stock glTF camera animation bases and camera-parented geometry.

Blender's exporter applies the camera correction to rotation after its generic
TRS conversion of animation samples. Raw Z-up gets an unwanted camera
rotation; Y-up keeps generic Y/Z scale swapping even though camera-local axes
are native. Animated camera children need camera-local, not generic axes.
Static node transforms already account for these bases and stay untouched.
This pass runs once on the freshly written stock export, before attestation.
"""
import copy
import math
import struct

from mathutils import Quaternion

try:
    from . import glblib
except ImportError:
    import glblib


_TURN = Quaternion((1.0, 0.0, 0.0), math.pi / 2)


def _rotation(values, left):
    quaternion = Quaternion((values[3], *values[:3]))
    # This is a linear operation on all four components. In particular,
    # CUBICSPLINE derivatives must NEVER be normalized as quaternions.
    result = _TURN @ quaternion if left else quaternion @ _TURN
    return [result.x, result.y, result.z, result.w]


def _transform(values, operation):
    if operation == "rotation-left": return _rotation(values, True)
    if operation == "rotation-right": return _rotation(values, False)
    if operation == "translation": return [values[0], -values[2], values[1]]
    if operation == "scale": return [values[0], values[2], values[1]]
    raise ValueError("unknown camera basis operation " + operation)


def canonicalize_camera_axes(path, *, export_yup):
    """Preserve native camera/child worlds in the selected exported basis.

    Animation output storage is copied per operation, so an output accessor or
    sampler shared with another object remains untouched. Unknown GLB chunks
    and all unrelated buffer bytes are preserved.
    """
    purpose = "camera-axes"
    document, chunks, json_index = glblib.read_document(path, purpose)
    nodes = document.get("nodes", [])
    cameras = {index for index, node in enumerate(nodes) if "camera" in node}
    if not cameras: return
    parents = {}
    for index, node in enumerate(nodes):
        for child in node.get("children", []):
            if not isinstance(child, int) or isinstance(child, bool) or not 0 <= child < len(nodes):
                raise ValueError("camera axes require valid node hierarchy indices")
            parents.setdefault(child, set()).add(index)
    children = {child for camera in cameras for child in nodes[camera].get("children", [])} if export_yup else set()
    touched = cameras | children
    for index in touched:
        seen = set()
        pending = [index]
        while pending:
            ancestor = pending.pop()
            if ancestor in seen:
                raise ValueError("camera axes require an unambiguous acyclic node hierarchy")
            seen.add(ancestor)
            owners = parents.get(ancestor, set())
            if len(owners) > 1:
                raise ValueError("camera axes cannot correct a node with multiple parents")
            pending.extend(owners)

    operations = {}
    for index in touched:
        mapping = {}
        if export_yup:
            if index in cameras: mapping["scale"] = "scale"
            if index in children:
                mapping.update(translation="translation", rotation="rotation-left")
        else:
            mapping["rotation"] = "rotation-right"
        operations[index] = mapping

    # Clone only changed outputs. Append within the sole embedded buffer, never
    # redirect shared existing storage or change skin/mesh/image bytes.
    binary = None
    cache = {}

    def transformed_accessor(index, operation):
        nonlocal binary
        key = (index, operation)
        if key in cache: return cache[key]
        accessors = document.get("accessors", [])
        if not isinstance(index, int) or not 0 <= index < len(accessors):
            raise ValueError("camera animation has an invalid output accessor")
        accessor = accessors[index]
        width = 4 if operation.startswith("rotation") else 3
        if accessor.get("componentType") != 5126 or accessor.get("type") != "VEC" + str(width) or accessor.get("normalized") or "sparse" in accessor:
            raise ValueError("camera animation requires dense float32 vector outputs")
        views = document.get("bufferViews", [])
        view_index = accessor.get("bufferView")
        if not isinstance(view_index, int) or not 0 <= view_index < len(views):
            raise ValueError("camera animation has no embedded output buffer view")
        view = views[view_index]
        if view.get("buffer", 0) != 0 or "EXT_meshopt_compression" in view.get("extensions", {}):
            raise ValueError("camera animation requires uncompressed embedded outputs")
        if binary is None:
            buffers = document.get("buffers", [])
            if len(buffers) != 1 or "uri" in buffers[0]:
                raise ValueError("camera animation requires one embedded GLB buffer")
            binary = bytearray(glblib.binary_chunk(chunks, purpose))
        count = accessor.get("count")
        stride = view.get("byteStride", width * 4)
        relative = accessor.get("byteOffset", 0)
        start = view.get("byteOffset", 0) + relative
        if not isinstance(count, int) or count < 0 or stride < width * 4 or stride % 4 or relative < 0 or relative + max(0, count - 1) * stride + (width * 4 if count else 0) > view.get("byteLength", 0) or start + max(0, count - 1) * stride + (width * 4 if count else 0) > len(binary):
            raise ValueError("camera animation output storage is invalid")
        payload = bytearray()
        for row in range(count):
            values = struct.unpack_from("<" + "f" * width, binary, start + row * stride)
            if not all(math.isfinite(value) for value in values):
                raise ValueError("camera animation requires finite outputs")
            payload.extend(struct.pack("<" + "f" * width, *_transform(values, operation)))
        binary.extend(b"\0" * (-len(binary) % 4))
        offset = len(binary)
        binary.extend(payload)
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(payload)})
        result = copy.deepcopy(accessor)
        result.update(bufferView=len(views) - 1, byteOffset=0)
        result.pop("min", None); result.pop("max", None)
        accessors.append(result)
        cache[key] = len(accessors) - 1
        return cache[key]

    changed = False
    for animation in document.get("animations", []):
        samplers = animation.get("samplers", [])
        for channel in animation.get("channels", []):
            target = channel.get("target", {})
            operation = operations.get(target.get("node"), {}).get(target.get("path"))
            if operation is None: continue
            if "matrix" in nodes[target["node"]]:
                raise ValueError("camera animation requires TRS nodes, not matrix-authored targets")
            sampler_index = channel.get("sampler")
            if not isinstance(sampler_index, int) or not 0 <= sampler_index < len(samplers):
                raise ValueError("camera animation has an invalid sampler")
            sampler = samplers[sampler_index]
            if sampler.get("interpolation", "LINEAR") not in {"LINEAR", "STEP", "CUBICSPLINE"}:
                raise ValueError("camera animation has an unverified interpolation")
            rewritten = copy.deepcopy(sampler)
            rewritten["output"] = transformed_accessor(sampler.get("output"), operation)
            samplers.append(rewritten)
            channel["sampler"] = len(samplers) - 1
            changed = True
    if not changed: return
    if binary is not None:
        binary.extend(b"\0" * (-len(binary) % 4))
        for chunk in chunks:
            if chunk[0] == glblib.GLB_BINARY_CHUNK: chunk[1] = bytes(binary)
        document["buffers"][0]["byteLength"] = len(binary)
    glblib.write_document(path, document, chunks, json_index, purpose)
