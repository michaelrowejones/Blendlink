# SPDX-License-Identifier: GPL-3.0-or-later
"""Private raw-Float32 transport for the EEVEE Color Attribute Alpha field.

Only compiler-owned mesh copies are modified. Source-corner associations are
checked against indexed exported triangles; accessor order is not an oracle.
"""
import hashlib
import struct
from collections import Counter
from array import array

MODEL = "eevee53-float-color-alpha-scalar-v1"
PROFILE = "blender53-eevee-metal-float-color-alpha-v1"
PREFIX = "_SCENETOWEB_VCOL_ALPHA_"
MAX_CORNERS = 300000


def layers(value):
    # This is a dependency collector over already-admitted channel IR, not a
    # new global IR budget. Numeric curve/noise/image payloads and repeated
    # annotations must not make an unrelated existing material refuse.
    found, seen, pending = set(), set(), [value]
    while pending:
        item = pending.pop()
        if not isinstance(item, (dict, list, tuple)) or id(item) in seen: continue
        seen.add(id(item))
        if isinstance(item, dict):
            if item.get("op") == "vertex_color_alpha":
                if item.get("model") != MODEL or item.get("sourceProfile") != PROFILE or not isinstance(item.get("layer"), str):
                    raise ValueError("Vertex Color Alpha source model is unqualified")
                found.add(item["layer"])
                if len(found) > 4: raise ValueError("Vertex Color Alpha layer budget exceeded")
            children = (child for key, child in item.items() if not (item.get("op") == "tex_image" and key == "pixels"))
        else: children = item
        pending.extend(child for child in children if isinstance(child, (dict, list, tuple)))
    return found


def _word(value):
    return struct.unpack("<I", struct.pack("<f", value))[0]


def _corner(position, alpha, basis):
    p = tuple(position) if basis == "blender-z-up" else (position[0], position[2], -position[1])
    # Position zero signs do not distinguish geometric association. Alpha
    # words remain untouched, including the explicit +0-only source gate.
    return struct.pack("<3fI", *(0.0 if v == 0 else v for v in p), _word(alpha))


def _triangle(corners):
    return min(b"".join(corners[i:] + corners[:i]) for i in range(3)).hex()


def install(obj, requested, installed, *, material, slot, basis):
    if not requested: return {}, {}
    mesh = obj.data
    if (obj.type != "MESH" or len(obj.modifiers) or mesh.shape_keys is not None
            or obj.instance_type != "NONE" or obj.animation_data is not None
            or mesh.animation_data is not None or obj.parent_type == "BONE"
            or len(mesh.loops) > MAX_CORNERS or len(mesh.vertices) > MAX_CORNERS):
        raise ValueError("Vertex Color Alpha requires a bounded static primary Mesh without deformation, instances or animation")
    attrs = mesh.color_attributes
    result, proof = {}, {}
    mesh.calc_loop_triangles()
    # Exact oriented positions cannot distinguish coincident triangles whose
    # other fields (UV, normal, RGB) differ. Refuse that ambiguity instead of
    # granting transport credit from an unordered alpha multiset.
    position_triangles = set()
    for triangle in mesh.loop_triangles:
        if triangle.material_index >= len(mesh.materials): continue
        owner_material = mesh.materials[triangle.material_index]
        if owner_material is None or not (owner_material.name == material or owner_material.get("blendlink_source_material") == material): continue
        key = _triangle([_corner(mesh.vertices[mesh.loops[index].vertex_index].co, 0, basis) for index in triangle.loops])
        if key in position_triangles:
            raise ValueError("Vertex Color Alpha coincident oriented triangles cannot attest source field association")
        position_triangles.add(key)
    for requested_name in sorted(requested):
        if requested_name:
            source = attrs.get(requested_name)
        else:
            index = attrs.render_color_index
            source = attrs[index] if 0 <= index < len(attrs) else None
        if source is None or source.data_type != "FLOAT_COLOR" or source.domain not in {"POINT", "CORNER"}:
            raise ValueError("Vertex Color Alpha needs a present FLOAT_COLOR POINT/CORNER active-render or named layer")
        expected_count = len(mesh.vertices) if source.domain == "POINT" else len(mesh.loops)
        if len(source.data) != expected_count:
            raise ValueError("Vertex Color Alpha source count differs from its native domain")
        # foreach_get preserves raw words before Python's Float32->double
        # conversion can flush a subnormal under Blender's CPU FTZ state.
        raw = array("f", [0]) * (expected_count * 4)
        source.data.foreach_get("color", raw)
        raw_bytes = raw.tobytes()
        alpha_bytes = b"".join(raw_bytes[index*16+12:index*16+16] for index in range(expected_count))
        words = struct.unpack("=" + str(expected_count) + "I", alpha_bytes)
        for word in words:
            if word > 0x3F800000 or (word != 0 and ((word >> 23) & 255) == 0):
                raise ValueError("Vertex Color Alpha source requires +0 or normal finite Float32 in [0,1]; signed-zero/subnormal/HDR are unqualified")
        values = array("f")
        values.frombytes(alpha_bytes)
        semantic = PREFIX + hashlib.sha256(source.name.encode("utf8")).hexdigest()[:16].upper()
        key = (mesh.as_pointer(), source.name)
        alpha_hash = hashlib.sha256(alpha_bytes).hexdigest()
        if key not in installed:
            if sum(item[0] == mesh.as_pointer() for item in installed) >= 4:
                raise ValueError("Vertex Color Alpha private mesh layer budget exceeded")
            if mesh.attributes.get(semantic) is not None:
                raise ValueError("Vertex Color Alpha reserved private attribute collision")
            carrier = mesh.attributes.new(semantic, "FLOAT", source.domain)
            if carrier.name != semantic:
                raise ValueError("Vertex Color Alpha private scalar name changed")
            carrier.data.foreach_set("value", values)
            back = array("f", [0]) * len(values)
            carrier.data.foreach_get("value", back)
            if back.tobytes() != alpha_bytes:
                raise ValueError("Vertex Color Alpha private scalar lost source Float32 words")
            installed[key] = (semantic, alpha_hash)
        elif installed[key] != (semantic, alpha_hash):
            raise ValueError("Vertex Color Alpha private scalar binding changed")
        result[requested_name] = {"model": MODEL, "sourceProfile": PROFILE, "attribute": semantic.lower(), "semantic": semantic,
            "sourceLayer": source.name, "domain": source.domain, "materials": [material]}
        triangles = []
        for triangle in mesh.loop_triangles:
            if triangle.material_index != slot: continue
            corners = []
            for loop_index in triangle.loops:
                vertex = mesh.loops[loop_index].vertex_index
                alpha = values[vertex if source.domain == "POINT" else loop_index]
                corners.append(_corner(mesh.vertices[vertex].co, alpha, basis))
            triangles.append(_triangle(corners))
        if not triangles:
            raise ValueError("Vertex Color Alpha material owns no rendered triangles")
        proof[requested_name] = {"slot": slot, "triangles": triangles}
    return result, proof


def _checked_accessor(document, binary, index, read_accessor):
    # The general compiler reader supports stride. This route additionally
    # checks the accessor's own view span/alignment before accepting raw words.
    accessor = document["accessors"][index]
    if accessor.get("sparse") is not None or "bufferView" not in accessor:
        raise ValueError("Vertex Color Alpha needs dense accessor storage")
    view = document["bufferViews"][accessor["bufferView"]]
    size = {5121: 1, 5123: 2, 5125: 4, 5126: 4}.get(accessor.get("componentType"))
    components = {"SCALAR": 1, "VEC3": 3}.get(accessor.get("type"))
    count, local = accessor.get("count", 0), accessor.get("byteOffset", 0)
    stride = view.get("byteStride", size * components if size and components else 0)
    start, span = view.get("byteOffset", 0), view.get("byteLength", 0)
    if (not size or not components or view.get("buffer", 0) != 0 or count <= 0 or local < 0 or start < 0
            or stride < size * components or stride % size or (start + local) % size
            or local + (count - 1)*stride + size*components > span or start + span > len(binary)):
        raise ValueError("Vertex Color Alpha accessor stride/span/alignment is invalid")
    if accessor.get("type") == "SCALAR" and accessor.get("componentType") == 5126:
        for offset in range(start + local, start + local + count*stride, stride):
            word = struct.unpack_from("<I", binary, offset)[0]
            if word > 0x3F800000 or (word and ((word >> 23) & 255) == 0):
                raise ValueError("Vertex Color Alpha emitted scalar raw word is outside its source profile")
    return read_accessor(document, binary, index)


def attest(document, binary, facts, read_accessor):
    """Check actual per-owner/material indexed triangles before publication."""
    materials = document.get("materials", [])
    for generated_name, fact in facts.items():
        for owner, entry in fact.get("tslRuntimeMeshes", {}).items():
            bindings = entry.get("vertexColorAlpha", {})
            proofs = entry.get("vertexColorAlphaProof", {})
            if not bindings: continue
            nodes = [node for node in document.get("nodes", []) if node.get("name") == owner and "mesh" in node]
            if len(nodes) != 1:
                raise ValueError("Vertex Color Alpha needs one actual exported owner node")
            mesh = document["meshes"][nodes[0]["mesh"]]
            selected = []
            for primitive in mesh.get("primitives", []):
                mi = primitive.get("material", -1)
                extras = materials[mi].get("extras", {}) if isinstance(mi, int) and 0 <= mi < len(materials) else {}
                if extras.get("blendlink_source_material") == fact["source"] and extras.get("blendlink_material_variant") == fact["variant"]:
                    selected.append(primitive)
            for layer, binding in bindings.items():
                actual = []
                for primitive in selected:
                    if primitive.get("mode", 4) != 4 or primitive.get("targets"):
                        raise ValueError("Vertex Color Alpha only qualifies static indexed triangle primitives")
                    attributes = primitive.get("attributes", {})
                    color_index = attributes.get("COLOR_0")
                    if (entry.get("vertexColorAlphaOpacity") and color_index is not None
                            and document["accessors"][color_index].get("type") == "VEC4"):
                        _, color_values = read_accessor(document, binary, color_index)
                        position_count = document["accessors"][attributes["POSITION"]]["count"]
                        if len(color_values) != position_count or any(row[3] != 1.0 for row in color_values):
                            raise ValueError("Vertex Color Alpha opacity with stock VEC4 COLOR_0 is unqualified; implicit vertex alpha would multiply opacity twice")
                    if binding["semantic"] not in attributes or "POSITION" not in attributes:
                        raise ValueError("Vertex Color Alpha exported primitive is missing its private scalar")
                    aa, alphas = _checked_accessor(document, binary, attributes[binding["semantic"]], read_accessor)
                    pa, positions = _checked_accessor(document, binary, attributes["POSITION"], read_accessor)
                    if (aa.get("type") != "SCALAR" or aa.get("componentType") != 5126 or aa.get("normalized", False)
                            or pa.get("type") != "VEC3" or pa.get("componentType") != 5126 or pa.get("normalized", False)
                            or len(alphas) != len(positions)):
                        raise ValueError("Vertex Color Alpha exported accessor is not count-matched raw Float32 SCALAR")
                    if "indices" in primitive:
                        ia, iv = _checked_accessor(document, binary, primitive["indices"], read_accessor)
                        if ia.get("type") != "SCALAR" or ia.get("componentType") not in {5121, 5123, 5125} or ia.get("normalized", False):
                            raise ValueError("Vertex Color Alpha indices are unqualified")
                        indices = [int(v[0]) for v in iv]
                    else: indices = list(range(len(positions)))
                    if not indices or len(indices) % 3 or any(i < 0 or i >= len(positions) for i in indices):
                        raise ValueError("Vertex Color Alpha rendered index span is invalid")
                    for start in range(0, len(indices), 3):
                        actual.append(_triangle([_corner(positions[i], alphas[i][0], "blender-z-up") for i in indices[start:start+3]]))
                expected = [triangle for row in proofs.get(layer, []) for triangle in row["triangles"]]
                if Counter(actual) != Counter(expected):
                    raise ValueError("Vertex Color Alpha per-material source-corner association mismatch")
