# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only extraction of the authored compositor output graph."""

import importlib
import importlib.util
import math
from contextlib import contextmanager
from pathlib import Path
import sys

import bpy

def _sibling(name):
    qualified = (__package__ + "." if __package__ else "") + name
    try:
        return importlib.import_module(qualified)
    except ModuleNotFoundError as error:
        if error.name != qualified:
            raise
        # A source extension can load this canonical file under its own package
        # name; installed extensions put all helpers directly beside it.
        source = Path(__file__).with_name(name + ".py")
        if name in {"static_selection", "static_strings"} and not source.is_file():
            # This shared policy is authored with the addon. Standalone source
            # probes only add the canonical Blender directory to sys.path;
            # packaged SDK/extension builds put the derived import closure
            # beside this file, so they never need the source-layout fallback.
            source = Path(__file__).resolve().parents[2] / "blender-addon" / (name + ".py")
        if not source.is_file():
            raise
        spec = importlib.util.spec_from_file_location(qualified, source)
        module = importlib.util.module_from_spec(spec)
        sys.modules[qualified] = module
        try:
            spec.loader.exec_module(module)
        except Exception:
            sys.modules.pop(qualified, None)
            raise
        return module


static_selection = _sibling("static_selection")
static_strings = _sibling("static_strings")
normalize_color_operation = _sibling("compositor_color").normalize_color_operation
native_color_band = _sibling("native_color_band").native_color_band
normalize_integer_bits = _sibling("compositor_integer_bits").normalize_integer_bits
normalize_utility = _sibling("compositor_utilities").normalize_utility
normalize_transform = _sibling("compositor_transform").normalize_transform
normalize_affine = _sibling("compositor_affine").normalize_affine
translation_only_transform = _sibling("compositor_affine").is_translation_only
multiply_image_affine = _sibling("compositor_affine").multiply_affine
transform_origin_conflict = _sibling("compositor_transform").origin_conflict
validate_math_domain = _sibling("compositor_math").validate_math_domain
native_gpu_profile = _sibling("compositor_gpu").native_gpu_profile
whitepoint_properties = _sibling("compositor_whitepoint").whitepoint_properties
normalize_blur = _sibling("compositor_blur").normalize_blur
normalize_filter = _sibling("compositor_filter").normalize_filter
normalize_pixelate = _sibling("compositor_pixelate").normalize_pixelate
validate_pixelate_domains = _sibling("compositor_pixelate").validate_pixelate_domains
normalize_normal = _sibling("compositor_normal").normalize_normal
normalize_alpha_conversion = _sibling("compositor_alpha_conversion").normalize_alpha_conversion
normalize_luminance_key = _sibling("compositor_luminance_key").normalize_luminance_key
normalize_difference_key = _sibling("compositor_difference_key").normalize_difference_key
normalize_distance_key = _sibling("compositor_distance_key").normalize_distance_key
normalize_chroma_key = _sibling("compositor_chroma_key").normalize_chroma_key
normalize_channel_key = _sibling("compositor_channel_key").normalize_channel_key
normalize_map_value = _sibling("compositor_map_value").normalize_map_value
normalize_spill = _sibling("compositor_spill").normalize_spill
normalize_color_key = _sibling("compositor_color_key").normalize_color_key
normalize_static_image = _sibling("compositor_image").normalize_image
normalize_vector_component = _sibling("compositor_vector_component").normalize_vector_component
normalize_float_to_int = _sibling("compositor_float_to_int").normalize_float_to_int
normalize_vector_math = _sibling("compositor_vector_math").normalize_vector_math
normalize_radial_width = _sibling("compositor_radial_width").normalize_radial_width
normalize_blackbody = _sibling("compositor_blackbody").normalize_blackbody
resolve_vector_math_literal = _sibling("compositor_procedural_texture").literal
normalize_procedural_texture = _sibling("compositor_procedural_texture").normalize_procedural_texture
validate_texture_field_graph = _sibling("compositor_procedural_texture").validate_texture_field_graph
normalize_relative_to_pixel = _sibling("compositor_relative_to_pixel").normalize_relative_to_pixel
normalize_image_coordinates = _sibling("compositor_image_coordinates").normalize_image_coordinates
normalize_image_info = _sibling("compositor_image_info").normalize_image_info
validate_image_info_edge = _sibling("compositor_image_info").validate_image_info_edge
normalize_float_coordinates = _sibling("compositor_float_coordinates").normalize_float_coordinates
validate_image_coordinate_graph = _sibling("compositor_image_coordinates").validate_image_coordinate_graph
normalize_crop = _sibling("compositor_crop").normalize_crop
normalize_split = _sibling("compositor_split").normalize_split
validate_split_domains = _sibling("compositor_split").validate_split_domains
validate_crop_domains = _sibling("compositor_crop").validate_crop_domains
validate_static_image_graph = _sibling("compositor_image").validate_image_graph

TYPES = {
    "FunctionNodeInputBool": "utility-constant",
    "FunctionNodeFloatToInt": "float-to-int",
    "ShaderNodeVectorMath": "vector-math",
    "ShaderNodeRadialTiling": "radial-segment-width",
    "ShaderNodeBlackbody": "blackbody-color",
    "ShaderNodeTexGradient": "gradient-texture",
    "ShaderNodeTexChecker": "checker-texture",
    "CompositorNodeRelativeToPixel": "relative-to-pixel",
    "CompositorNodeImageCoordinates": "image-coordinates",
    "CompositorNodeImageInfo": "image-info",
    "FunctionNodeInputVector": "value",
    "ShaderNodeCombineXYZ": "combine-vector",
    "ShaderNodeSeparateXYZ": "separate-vector",
    "FunctionNodeGetVectorComponent": "separate-vector",
    "FunctionNodeInputInt": "utility-constant",
    "FunctionNodeBooleanMath": "boolean-math",
    "FunctionNodeIntegerMath": "integer-math",
    "FunctionNodeBitMath": "bit-math",
    "FunctionNodeHashValue": "hash-value",
    "FunctionNodeCompare": "compare",
    "CompositorNodeRGB": "rgb",
    "ShaderNodeValue": "value",
    "CompositorNodeValue": "value",
    "ShaderNodeMath": "math",
    "CompositorNodeMath": "math",
    "ShaderNodeMixRGB": "mix-rgb",
    "CompositorNodeMixRGB": "mix-rgb",
    "ShaderNodeMix": "mix",
    "CompositorNodeAlphaOver": "alpha-over",
    "CompositorNodeSetAlpha": "set-alpha",
    "CompositorNodePremulKey": "convert-alpha",
    "CompositorNodeLumaMatte": "luminance-key",
    "CompositorNodeDiffMatte": "difference-key",
    "CompositorNodeDistanceMatte": "distance-key",
    "CompositorNodeChromaMatte": "chroma-key",
    "CompositorNodeChannelMatte": "channel-key",
    "CompositorNodeMapValue": "map-value",
    "CompositorNodeColorSpill": "color-spill",
    "CompositorNodeColorMatte": "color-key",
    "CompositorNodeExposure": "exposure",
    "CompositorNodeColorCorrection": "color-correction",
    "CompositorNodePosterize": "posterize",
    "CompositorNodeBrightContrast": "brightness-contrast",
    "CompositorNodeColorBalance": "color-balance",
    "CompositorNodeSeparateColor": "separate-color",
    "CompositorNodeCombineColor": "combine-color",
    "CompositorNodeSepRGBA": "separate-color",
    "CompositorNodeCombRGBA": "combine-color",
    "CompositorNodeSepHSVA": "separate-color",
    "CompositorNodeCombHSVA": "combine-color",
    "CompositorNodeSepYUVA": "separate-color",
    "CompositorNodeCombYUVA": "combine-color",
    "CompositorNodeSepYCCA": "separate-color",
    "CompositorNodeCombYCCA": "combine-color",
    "CompositorNodeRGBToBW": "rgb-to-bw",
    "ShaderNodeClamp": "clamp",
    "ShaderNodeMapRange": "map-range",
    "CompositorNodeMapRange": "map-range",
    "ShaderNodeValToRGB": "color-ramp",
    "CompositorNodeValToRGB": "color-ramp",
    "CompositorNodeCurveRGB": "curves",
    "ShaderNodeRGBCurve": "curves",
    "ShaderNodeFloatCurve": "curves",
    "ShaderNodeVectorCurve": "curves",
    "CompositorNodeCurveVec": "curves",
    "ShaderNodeGamma": "gamma",
    "CompositorNodeGamma": "gamma",
    "CompositorNodeInvert": "invert",
    "CompositorNodeHueSat": "hue-saturation-value",
    "CompositorNodeHueCorrect": "hue-correct",
    "CompositorNodeBlur": "blur",
    "CompositorNodeTranslate": "translate",
    "CompositorNodeTransform": "translate",
    "CompositorNodeRotate": "image-affine",
    "CompositorNodeScale": "image-affine",
    "CompositorNodeFlip": "flip",
    "CompositorNodeFilter": "filter",
    "CompositorNodePixelate": "pixelate",
    "CompositorNodeNormal": "normal-direction",
    "CompositorNodeSwitch": "switch",
    "CompositorNodeGlare": "glare",
    "CompositorNodeRLayers": "render-pass",
    "CompositorNodeImage": "image-input",
    "CompositorNodeCrop": "alpha-crop",
    "CompositorNodeSplit": "image-split",
}
PROPERTIES = (
    "operation",
    "use_clamp",
    "blend_type",
    "use_alpha",
    "data_type",
    "factor_mode",
    "clamp_factor",
    "clamp_result",
)


def value(v):
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    try:
        return list(v)
    except TypeError:
        return str(v)


class Unsupported(Exception):
    pass


@contextmanager
def copied_curve_mapping(node):
    """Yield an initialized owned copy for context-specific native evaluation.

    The caller controls clipping and sampling domains on this copy. The authored
    mapping is never changed, and the temporary ID is removed even on refusal.
    """
    temporary = node.id_data.copy()
    try:
        mapping = temporary.nodes[node.name].mapping
        mapping.initialize()
        mapping.update()
        yield mapping
    finally:
        bpy.data.node_groups.remove(temporary)


def curve_tables(node):
    """Sample Blender's own tables without changing the authored CurveMapping.

    The public evaluator clips output while the compositor's internal evaluator
    does not. Disable that flag on an owned temporary ID copy only.
    """
    temporary = node.id_data.copy()
    try:
        mapping = temporary.nodes[node.name].mapping
        clip = bool(mapping.use_clip)
        mapping.use_clip = False
        mapping.initialize()
        mapping.update()
        curves = list(mapping.curves)
        ranges, values, slopes = [], [], []
        for curve in curves:
            low = min(float(mapping.clip_min_x), *(float(point.location[0]) for point in curve.points))
            high = max(float(mapping.clip_max_x), *(float(point.location[0]) for point in curve.points))
            extent = high - low
            if extent <= 0:
                raise Unsupported("Curve Mapping requires a nonzero finite horizontal range")
            samples = [float(mapping.evaluate(curve, low + extent * index / 256)) for index in range(257)]
            start = (samples[0] - mapping.evaluate(curve, low - extent)) / extent
            end = (mapping.evaluate(curve, high + extent) - samples[-1]) / extent
            ranges.append([low, high])
            values.append(samples)
            slopes.append([start, end])
        premultiplied = None
        if len(curves) == 4:
            premultiplied = [[float(mapping.evaluate(curves[3], item)) for item in channel]
                             for channel in values[:3]]
        numbers = [item for row in ranges + values + slopes for item in row]
        if premultiplied:
            numbers += [item for row in premultiplied for item in row]
        if not all(math.isfinite(item) for item in numbers):
            raise Unsupported("Curve Mapping produces non-finite native samples")
        return {"curve_ranges": ranges, "curve_values": values, "curve_slopes": slopes,
                "curve_premultiplied": premultiplied,
                "curve_tone": getattr(mapping, "tone", "STANDARD"),
                "curve_clip": clip, "curve_clip_y": [float(mapping.clip_min_y), float(mapping.clip_max_y)]}
    finally:
        bpy.data.node_groups.remove(temporary)


def extract(scene):
    result = {
        "version": 1,
        "blenderVersion": bpy.app.version_string,
        "engine": scene.render.engine,
        "frame": scene.frame_current,
        "status": "disabled",
        "ops": [],
        "passes": [],
        "diagnostics": [],
        "alphaConvention": "premultiplied",
        "colorSpace": "scene-linear",
        "displayTransform": "separate, after authored compositor",
    }
    if not scene.render.use_compositing:
        return result
    modern = hasattr(scene, "compositing_node_group")
    tree = scene.compositing_node_group if modern else getattr(scene, "node_tree", None)
    if tree is None or (not modern and not scene.use_nodes):
        return result
    result["tree"] = tree.name
    memo = {}
    visiting = set()
    pass_keys = set()
    single_values = set()
    static_image_cache = {}

    def is_single_value(ref):
        return ref["kind"] == "constant" or (ref["kind"] == "ref" and ref["node"] in single_values) \
            or (ref["kind"] == "convert" and is_single_value(ref["input"]))

    def fail(code, path, node, socket, message):
        result["diagnostics"].append(
            {
                "code": code,
                "path": list(path),
                "node": node.name if node else None,
                "nodeType": node.bl_idname if node else None,
                "socket": socket.identifier if socket else None,
                "message": message,
            }
        )
        raise Unsupported(message)

    def output_node(t, path):
        candidates = [
            n
            for n in t.nodes
            if n.bl_idname == "NodeGroupOutput" and n.is_active_output
        ]
        if not candidates:
            fail("no-active-output", path, None, None, "No active Group Output")
        if len(candidates) != 1:
            fail(
                "ambiguous-output",
                path,
                None,
                None,
                "More than one active Group Output",
            )
        return candidates[0]

    def const(socket):
        return {
            "kind": "constant",
            "type": socket.type,
            "value": value(getattr(socket, "default_value", None)),
        }

    def static_string_value(socket, ctx):
        frames = []
        current = ctx
        while current.get('parent') is not None:
            frames.append(current['instance'])
            current = current['parent']
        try:
            record = static_strings.evaluate_input(socket, tuple(reversed(frames)))
        except static_strings.StaticStringUnsupported as error:
            fail('unsupported-static-string', ctx['path'], socket.node, socket, str(error))
        public_record = {key: value for key, value in record.items() if key != 'value'}
        if isinstance(record['value'], str):
            import hashlib
            encoded = record['value'].encode('utf-8')
            public_record.update(utf8Bytes=len(encoded), valueSha256=hashlib.sha256(encoded).hexdigest())
        else:
            public_record['value'] = record['value']
        result.setdefault('compileTimeStrings', []).append(dict(public_record, path=list(ctx['path']), node=socket.node.name))
        return record

    def input_value(socket, ctx):
        require_static(socket.node, socket, ctx)
        links = [
            l for l in socket.links if l.is_valid and not getattr(l, "is_muted", False)
        ]
        if len(links) > 1:
            fail(
                "multiple-links",
                ctx["path"],
                socket.node,
                socket,
                "Multiple valid links require ordered multi-input semantics",
            )
        if not links:
            return const(socket)
        resolved = output_value(links[0].from_socket, ctx)
        validate_image_info_edge(resolved, socket, result["ops"], lambda message: fail("unsupported-image-info-conversion", ctx["path"], socket.node, socket, message))
        target_type = socket.type
        if resolved.get("type") == "FLOAT_VECTOR2":
            default = getattr(socket, "default_value", None)
            if socket.type == "VECTOR" and socket.bl_idname == "NodeSocketVector2D" and default is not None and len(default) == 2:
                target_type = "FLOAT_VECTOR2"
            if target_type not in {"FLOAT_VECTOR2", "RGBA", "VECTOR"}:
                fail("unsupported-float2-conversion", ctx["path"], socket.node, socket,
                     "Image Coordinates FLOAT_VECTOR2 currently supports only identity, RGBA and padded float3 edges; scalar/integer conversions remain unqualified")
        if resolved.get("type") == "INT_VECTOR2":
            default = getattr(socket, "default_value", None)
            if socket.type == "INT_VECTOR" and socket.bl_idname == "NodeSocketIntVector2D" and default is not None and len(default) == 2:
                target_type = "INT_VECTOR2"
            if socket.bl_idname == "NodeSocketVector2D" or target_type not in {"INT_VECTOR2", "RGBA", "VECTOR", "VALUE", "INT", "BOOLEAN"}:
                fail("unsupported-int2-conversion", ctx["path"], socket.node, socket,
                     "Image Coordinates INT_VECTOR2 supports identity, RGBA, padded float3, scalar, integer midpoint and Boolean edges; other widths/conversions remain unqualified")
        if resolved.get("type") != target_type:
            return {
                "kind": "convert",
                "fromType": resolved.get("type"),
                "type": target_type,
                "input": resolved,
            }
        return resolved

    def output_value(socket, ctx):
        node = socket.node
        require_static(node, socket, ctx)
        path = ctx["path"]
        key = (path, node.as_pointer(), socket.identifier)
        if key in memo:
            return memo[key]
        if key in visiting:
            fail("cycle", path, node, socket, "Reachable compositor cycle")
        visiting.add(key)
        try:
            if node.mute:
                links = [l for l in node.internal_links if l.to_socket == socket]
                if len(links) != 1:
                    fail(
                        "muted-mapping",
                        path,
                        node,
                        socket,
                        "Muted output has no unique Blender internal bypass link",
                    )
                ref = input_value(links[0].from_socket, ctx)
            elif node.bl_idname == "NodeReroute":
                ref = input_value(node.inputs[0], ctx)
            elif node.bl_idname == "NodeGroupInput":
                if ctx.get("parent") is None:
                    fail(
                        "root-group-input",
                        path,
                        node,
                        socket,
                        "Root group inputs need explicit scene-pipeline binding; do not treat as constants",
                    )
                outer = next(
                    (
                        s
                        for s in ctx["instance"].inputs
                        if s.identifier == socket.identifier
                    ),
                    None,
                )
                if outer is None:
                    fail(
                        "group-input-binding",
                        path,
                        node,
                        socket,
                        "Group input identifier does not match instance",
                    )
                ref = input_value(outer, ctx["parent"])
            elif node.bl_idname == "CompositorNodeGroup":
                sub = node.node_tree
                if sub is None:
                    fail("missing-group", path, node, socket, "Group tree is missing")
                if sub.as_pointer() in ctx["ancestry"]:
                    fail("recursive-group", path, node, socket, "Recursive node group")
                subctx = {
                    "path": path + (node.name,),
                    "parent": ctx,
                    "instance": node,
                    "ancestry": ctx["ancestry"] + (sub.as_pointer(),),
                }
                sink = output_node(sub, subctx["path"])
                target = next(
                    (s for s in sink.inputs if s.identifier == socket.identifier), None
                )
                if target is None:
                    fail(
                        "group-output-binding",
                        path,
                        node,
                        socket,
                        "Group output identifier does not match instance",
                    )
                ref = input_value(target, subctx)
            elif node.bl_idname in static_selection.NODES:
                # The native shader inliner and compositor operation both forward only
                # the selected input. Inactive branches must never enter extraction.
                group_stack = []
                current = ctx
                while current.get('parent') is not None:
                    group_stack.append(current['instance'])
                    current = current['parent']
                try:
                    selected = static_selection.static_selection(node, socket, tuple(reversed(group_stack)))
                except static_selection.SelectionUnsupported as error:
                    fail('unsupported-static-selection', path, node, socket, str(error))
                if selected['constant'] is not None:
                    ref = {'kind': 'constant', 'type': 'BOOLEAN', 'value': selected['constant']}
                else:
                    ref = input_value(selected['input'], ctx)
                result.setdefault('compileTimeSelections', []).append(dict(selected['metadata'], path=list(path), node=node.name))
            elif node.bl_idname in static_strings.SCALAR_NODES:
                record = static_string_value(socket, ctx)
                ref = {'kind': 'constant', 'type': record['type'], 'value': record['value']}
            elif node.bl_idname not in TYPES:
                fail(
                    "unsupported-node",
                    path,
                    node,
                    socket,
                    "Reachable node has no portable compositor implementation",
                )
            else:
                op = {
                    "id": "n" + str(len(result["ops"])),
                    "kind": TYPES[node.bl_idname],
                    "source": {
                        "path": list(path),
                        "node": node.name,
                        "nodeType": node.bl_idname,
                        "output": socket.identifier,
                    },
                    "type": socket.type,
                    "properties": {
                        p: value(getattr(node, p))
                        for p in PROPERTIES
                        if hasattr(node, p)
                    },
                    "inputs": {},
                }
                device = getattr(scene.render, "compositor_device", "CPU")
                op["properties"]["evaluation_device"] = device
                op["properties"]["native_gpu_backend"] = getattr(bpy.context.preferences.system, "gpu_backend", "UNKNOWN")
                # The old GPU compositor evaluates even all-constant nodes in
                # shaders. Shared compositor nodes now fold these through CPU
                # functions, which have distinct curves, Hue and Math rules.
                op["properties"]["single_value_device"] = "GPU" if device == "GPU" and bpy.app.version < (4, 5, 0) else "CPU"
                if node.bl_idname == "CompositorNodeImage":
                    normalize_static_image(node, socket, op, scene, result, static_image_cache,
                        lambda incoming, message: fail("unsupported-static-image", path, node, incoming, message))
                elif node.bl_idname == "CompositorNodePixelate":
                    normalize_pixelate(node, op, scene, lambda incoming: input_value(incoming, ctx),
                        lambda incoming, message: fail("unsupported-pixelate-domain", path, node, incoming, message))
                elif node.bl_idname == "CompositorNodeCrop":
                    normalize_crop(node, op, scene, lambda incoming: input_value(incoming, ctx),
                        lambda incoming, message: fail("unsupported-crop-domain", path, node, incoming, message))
                elif node.bl_idname == "CompositorNodeSplit":
                    normalize_split(node, socket, op, scene, lambda incoming: input_value(incoming, ctx), is_single_value,
                        lambda incoming, message: fail("unsupported-split-domain", path, node, incoming, message))
                elif node.bl_idname in ("ShaderNodeMath", "CompositorNodeMath"):
                    for incoming in node.inputs:
                        if not incoming.enabled or getattr(incoming, "is_unavailable", False):
                            continue
                        op["inputs"][incoming.identifier] = {
                            "name": incoming.name, "socketType": incoming.type,
                            "value": input_value(incoming, ctx),
                        }
                elif node.bl_idname in ("FunctionNodeInputBool", "FunctionNodeInputInt", "FunctionNodeBooleanMath", "FunctionNodeIntegerMath", "FunctionNodeCompare"):
                    normalize_utility(node, op, lambda incoming: input_value(incoming, ctx),
                                      lambda message: fail("unsupported-utility-mode", path, node, socket, message),
                                      getattr(scene.render, "compositor_device", "CPU"),
                                      constant_string=lambda incoming: static_string_value(incoming, ctx)['value'])
                elif node.bl_idname in ("FunctionNodeBitMath", "FunctionNodeHashValue"):
                    normalize_integer_bits(node, socket, op, lambda incoming: input_value(incoming, ctx), result["ops"],
                        lambda incoming, message: fail("unsupported-integer-bits", path, node, incoming, message))
                elif node.bl_idname == "ShaderNodeBlackbody":
                    normalize_blackbody(node, socket, op, lambda incoming: input_value(incoming, ctx), result["ops"],
                        lambda incoming, message: fail("unsupported-blackbody", path, node, incoming, message), resolve_vector_math_literal)
                elif node.bl_idname == "ShaderNodeRadialTiling":
                    normalize_radial_width(node, socket, op, lambda incoming: input_value(incoming, ctx), result["ops"],
                        lambda incoming, message: fail("unsupported-radial-width", path, node, incoming, message), resolve_vector_math_literal)
                elif node.bl_idname == "ShaderNodeVectorMath":
                    normalize_vector_math(node, socket, op, lambda incoming: input_value(incoming, ctx), result["ops"],
                        lambda incoming, message: fail("unsupported-vector-math", path, node, incoming, message), resolve_vector_math_literal)
                elif node.bl_idname in ("ShaderNodeTexGradient", "ShaderNodeTexChecker"):
                    normalize_procedural_texture(node, socket, op, lambda incoming: input_value(incoming, ctx), result["ops"],
                        lambda incoming, message: fail("unsupported-procedural-texture", path, node, incoming, message), scene)
                elif node.bl_idname == "FunctionNodeFloatToInt":
                    normalize_float_to_int(node, socket, op, lambda incoming: input_value(incoming, ctx), result["ops"],
                        lambda incoming, message: fail("unsupported-float-to-int", path, node, incoming, message))
                elif node.bl_idname == "CompositorNodeRelativeToPixel":
                    normalize_relative_to_pixel(node, socket, op, scene, lambda incoming: input_value(incoming, ctx), result["ops"],
                        lambda incoming, message: fail("unsupported-relative-to-pixel", path, node, incoming, message))
                elif node.bl_idname == "CompositorNodeImageInfo":
                    normalize_image_info(node, socket, op, scene, lambda incoming: input_value(incoming, ctx), result["ops"],
                        lambda incoming, message: fail("unsupported-image-info", path, node, incoming, message))
                elif node.bl_idname == "CompositorNodeImageCoordinates":
                    coordinate_normalizer = normalize_float_coordinates if socket.identifier in {"Uniform", "Normalized"} else normalize_image_coordinates
                    coordinate_normalizer(node, socket, op, scene, lambda incoming: input_value(incoming, ctx), result["ops"],
                        lambda incoming, message: fail("unsupported-image-coordinates", path, node, incoming, message))
                elif node.bl_idname == "FunctionNodeInputVector":
                    op["value"] = list(node.vector)
                elif node.bl_idname == "FunctionNodeGetVectorComponent":
                    normalize_vector_component(node, socket, op, lambda incoming: input_value(incoming, ctx), result["ops"],
                        lambda incoming, message: fail("unsupported-vector-component", path, node, incoming, message))
                elif node.bl_idname in ("ShaderNodeCombineXYZ", "ShaderNodeSeparateXYZ"):
                    for incoming in node.inputs:
                        op["inputs"][incoming.identifier] = {"name": incoming.name, "socketType": incoming.type,
                                                             "value": input_value(incoming, ctx)}
                elif node.bl_idname in ("CompositorNodeRGB", "ShaderNodeValue", "CompositorNodeValue"):
                    op["value"] = value(socket.default_value)
                elif node.bl_idname == "CompositorNodeNormal":
                    normalize_normal(node, socket, op, scene, lambda incoming: input_value(incoming, ctx),
                        lambda incoming, message: fail("unsupported-normal-direction", path, node, incoming, message))
                elif node.bl_idname in ("CompositorNodeExposure", "CompositorNodeHueSat",
                                        "CompositorNodeColorCorrection", "CompositorNodePosterize"):
                    normalize_color_operation(node, op, lambda incoming: input_value(incoming, ctx),
                                              getattr(scene.render, "compositor_device", "CPU"))
                elif node.bl_idname == "CompositorNodeMapValue":
                    normalize_map_value(node, socket, op, lambda incoming: input_value(incoming, ctx),
                        lambda incoming, message: fail("unsupported-map-value", path, node, incoming, message), result["ops"])
                elif node.bl_idname in ("ShaderNodeMapRange", "CompositorNodeMapRange"):
                    vector = getattr(node, "data_type", "FLOAT") == "FLOAT_VECTOR"
                    interpolation = getattr(node, "interpolation_type", "LINEAR")
                    if interpolation not in ("LINEAR", "STEPPED", "SMOOTHSTEP", "SMOOTHERSTEP"):
                        fail("unsupported-map-range-interpolation", path, node, socket,
                             "Map Range requires a verified interpolation mode")
                    if node.bl_idname == "ShaderNodeMapRange" and socket.identifier != ("Vector" if vector else "Result"):
                        fail("inactive-map-range-output", path, node, socket,
                             "The requested Map Range output is inactive")
                    op["properties"].update({"data_type": "FLOAT_VECTOR" if vector else "FLOAT",
                                             "interpolation_type": interpolation,
                                             "clamp": bool(getattr(node, "clamp", getattr(node, "use_clamp", False))),
                                             "map_range_model": "legacy" if node.bl_idname == "CompositorNodeMapRange" else getattr(scene.render, "compositor_device", "CPU")})
                    identifiers = ("Vector", "From_Min_FLOAT3", "From_Max_FLOAT3", "To_Min_FLOAT3", "To_Max_FLOAT3", "Steps_FLOAT3") if vector else (
                        "Value", "From Min", "From Max", "To Min", "To Max", "Steps")
                    for name, identifier in zip(("Value", "From Min", "From Max", "To Min", "To Max", "Steps"), identifiers):
                        if name == "Steps" and interpolation != "STEPPED":
                            continue
                        incoming = next(item for item in node.inputs if item.identifier == identifier)
                        op["inputs"][name] = {"name": incoming.name, "socketType": incoming.type,
                                              "value": input_value(incoming, ctx)}
                elif node.bl_idname == "ShaderNodeClamp":
                    op["properties"]["clamp_type"] = node.clamp_type
                    for incoming in node.inputs:
                        op["inputs"][incoming.identifier] = {"name": incoming.name,
                            "socketType": incoming.type, "value": input_value(incoming, ctx)}
                elif node.bl_idname == "CompositorNodeGamma":
                    for name, identifier in (("Color", "Image"), ("Gamma", "Gamma")):
                        incoming = node.inputs[identifier]
                        op["inputs"][name] = {"name": incoming.name, "socketType": incoming.type,
                                              "value": input_value(incoming, ctx)}
                elif node.bl_idname in ("ShaderNodeValToRGB", "CompositorNodeValToRGB"):
                    ramp = node.color_ramp
                    op["properties"].update({
                        "color_mode": ramp.color_mode, "interpolation": ramp.interpolation,
                        "hue_interpolation": ramp.hue_interpolation,
                        "color_conversion_device": getattr(scene.render, "compositor_device", "CPU"),
                        "gpu_filter_fraction_bits": 8 if getattr(bpy.context.preferences.system, "gpu_backend", "") == "METAL" else None,
                        "stops": [{"position": float(element.position),
                                   "color": list(element.color)} for element in ramp.elements],
                        "samples": 257,
                        "values": [float(channel) for index in range(257)
                                   for channel in ramp.evaluate(index / 256)],
                    })
                    if op["properties"]["color_conversion_device"] == "GPU":
                        try:
                            op["properties"]["gpu_color_band"] = native_color_band(op["properties"]["values"])
                        except ValueError as error:
                            fail("unsupported-native-color-band", path, node, socket, str(error))
                    incoming = node.inputs["Fac"]
                    op["inputs"]["Fac"] = {"name": incoming.name, "socketType": incoming.type,
                                            "value": input_value(incoming, ctx)}
                elif node.bl_idname == "CompositorNodeSwitch":
                    selector = node.inputs.get("Switch")
                    if selector is not None and selector.is_linked:
                        fail("dynamic-switch-choice", path, node, selector,
                             "Switch requires an unlinked fixed Boolean choice")
                    selected = "On" if (selector.default_value if selector is not None else node.check) else "Off"
                    incoming = node.inputs[selected]
                    op["properties"].update({"switch_model": "fixed-choice-v1", "switch_selected": selected})
                    # Unselected graphs are not dependencies of this fixed
                    # choice; unsupported or expensive inactive branches remain authored.
                    op["inputs"]["Selected"] = {"name": incoming.name, "socketType": incoming.type,
                                                 "value": input_value(incoming, ctx)}
                elif node.bl_idname == "CompositorNodeFilter":
                    normalize_filter(node, op, scene, lambda incoming: input_value(incoming, ctx),
                        lambda incoming, message: fail("unsupported-filter-mode", path, node, incoming, message))
                elif node.bl_idname == "CompositorNodeFlip":
                    if node.inputs.get("Flip X") is not None:
                        for name in ("Flip X", "Flip Y"):
                            if node.inputs[name].is_linked:
                                fail("dynamic-flip-axis", path, node, node.inputs[name],
                                     "Flip axes require unlinked fixed Boolean settings")
                        flags = [bool(node.inputs[name].default_value) for name in ("Flip X", "Flip Y")]
                    else:
                        if node.axis not in {"X", "Y", "XY"}:
                            fail("unsupported-flip-axis", path, node, socket, "Flip has no verified native axis")
                        flags = ["X" in node.axis, "Y" in node.axis]
                    op["properties"].update({"spatial_model": "native-flip-v1", "flip_x": flags[0], "flip_y": flags[1]})
                    incoming = node.inputs["Image"]
                    op["inputs"]["Image"] = {"name": incoming.name, "socketType": incoming.type,
                                              "value": input_value(incoming, ctx)}
                elif node.bl_idname == "CompositorNodeBlur":
                    normalize_blur(node, op, scene, lambda incoming: input_value(incoming, ctx),
                        _sibling("compositor_math").numeric_socket_bounds,
                        lambda incoming, message: fail("unsupported-blur-mode", path, node, incoming, message))
                elif node.bl_idname in ("CompositorNodeTranslate", "CompositorNodeTransform", "CompositorNodeRotate", "CompositorNodeScale"):
                    bounds = _sibling("compositor_math").numeric_socket_bounds
                    if node.bl_idname == "CompositorNodeTranslate" or translation_only_transform(node, bounds):
                        normalize_transform(node, op, scene, lambda incoming: input_value(incoming, ctx), bounds,
                            lambda incoming, message: fail("unsupported-transform-mode", path, node, incoming, message))
                    else:
                        normalize_affine(node, op, scene, lambda incoming: input_value(incoming, ctx),
                            lambda incoming, message: fail("unsupported-affine-transform-mode", path, node, incoming, message))
                elif TYPES[node.bl_idname] in ("curves", "hue-correct"):
                    try:
                        op["properties"].update(curve_tables(node))
                    except Unsupported as error:
                        fail("unsupported-curve-mapping", path, node, socket, str(error))
                    if node.bl_idname == "CompositorNodeHueCorrect":
                        op["properties"]["hue_correct_model"] = "native-curves-v1"
                        if (getattr(scene.render, "compositor_device", "CPU") == "GPU"
                                and op["properties"]["native_gpu_backend"] == "OPENGL"):
                            op["properties"]["hue_curve_sampling_model"] = "opengl-normalized-f32-v1"
                    op["properties"]["color_conversion_device"] = getattr(scene.render, "compositor_device", "CPU")
                    op["properties"]["gpu_filter_fraction_bits"] = 8 if getattr(bpy.context.preferences.system, "gpu_backend", "") == "METAL" else None
                    if op["properties"]["color_conversion_device"] == "GPU":
                        tables = op["properties"]["curve_values"]
                        packed = [[tables[channel][index] if channel < len(tables) else 0.0
                                   for channel in range(4)] for index in range(257)]
                        try:
                            op["properties"]["gpu_color_band"] = native_color_band(packed)
                        except ValueError as error:
                            fail("unsupported-native-color-band", path, node, socket, str(error))
                    for incoming in node.inputs:
                        name = {"Factor": "Fac", "Color": "Image"}.get(incoming.identifier, incoming.identifier)
                        op["inputs"][name] = {"name": incoming.name, "socketType": incoming.type,
                                              "value": input_value(incoming, ctx)}
                elif node.bl_idname in ("ShaderNodeMix", "ShaderNodeMixRGB", "CompositorNodeMixRGB"):
                    op["properties"]["color_conversion_device"] = getattr(scene.render, "compositor_device", "CPU")
                    if node.bl_idname == "ShaderNodeMix":
                        data_type = node.data_type
                        if data_type not in ("FLOAT", "VECTOR", "RGBA"):
                            fail("unsupported-mix-data-type", path, node, socket,
                                 "Mix Rotation needs a verified quaternion socket/interpolation mapping")
                        suffix = {"FLOAT": "Float", "VECTOR": "Vector", "RGBA": "Color"}[data_type]
                        factor = "Factor_Vector" if data_type == "VECTOR" and node.factor_mode == "NON_UNIFORM" else "Factor_Float"
                        identifiers = (factor, "A_" + suffix, "B_" + suffix)
                        aliases = identifiers
                    elif node.bl_idname == "CompositorNodeMixRGB":
                        identifiers, aliases = ("Fac", "Image", "Image_001"), ("Fac", "Color1", "Color2")
                    else:
                        identifiers = aliases = ("Fac", "Color1", "Color2")
                    for name, identifier in zip(aliases, identifiers):
                        incoming = next(item for item in node.inputs if item.identifier == identifier)
                        op["inputs"][name] = {"name": incoming.name, "socketType": incoming.type,
                                              "value": input_value(incoming, ctx)}
                elif node.bl_idname in ("CompositorNodeSetAlpha", "CompositorNodePremulKey"):
                    normalize_alpha_conversion(node, op, lambda incoming: input_value(incoming, ctx),
                        lambda incoming, message: fail("unsupported-alpha-conversion-mode", path, node, incoming, message))
                elif node.bl_idname == "CompositorNodeLumaMatte":
                    normalize_luminance_key(node, socket, op, scene, lambda incoming: input_value(incoming, ctx),
                        _sibling("compositor_math").numeric_socket_bounds,
                        lambda incoming, message: fail("unsupported-luminance-key", path, node, incoming, message), is_single_value)
                elif node.bl_idname == "CompositorNodeDiffMatte":
                    normalize_difference_key(node, socket, op, scene, lambda incoming: input_value(incoming, ctx),
                        _sibling("compositor_math").numeric_socket_bounds,
                        lambda incoming, message: fail("unsupported-difference-key", path, node, incoming, message), is_single_value)
                elif node.bl_idname == "CompositorNodeDistanceMatte":
                    normalize_distance_key(node, socket, op, scene, lambda incoming: input_value(incoming, ctx),
                        is_single_value,
                        lambda incoming, message: fail("unsupported-distance-key", path, node, incoming, message))
                elif node.bl_idname == "CompositorNodeColorMatte":
                    normalize_color_key(node, socket, op, lambda incoming: input_value(incoming, ctx),
                        _sibling("compositor_math").numeric_socket_bounds,
                        lambda incoming, message: fail("unsupported-color-key", path, node, incoming, message), result["ops"])
                elif node.bl_idname == "CompositorNodeChromaMatte":
                    normalize_chroma_key(node, socket, op, scene, lambda incoming: input_value(incoming, ctx),
                        _sibling("compositor_math").numeric_socket_bounds,
                        lambda incoming, message: fail("unsupported-chroma-key", path, node, incoming, message))
                elif node.bl_idname == "CompositorNodeChannelMatte":
                    normalize_channel_key(node, socket, op, scene, lambda incoming: input_value(incoming, ctx), result["ops"],
                        lambda incoming, message: fail("unsupported-channel-key", path, node, incoming, message))
                elif node.bl_idname == "CompositorNodeColorSpill":
                    normalize_spill(node, op, lambda incoming: input_value(incoming, ctx),
                        lambda incoming, message: fail("unsupported-color-spill", path, node, incoming, message))
                elif node.bl_idname == "CompositorNodeInvert":
                    for incoming in node.inputs:
                        op["inputs"][incoming.identifier] = {"name": incoming.name, "socketType": incoming.type,
                                                             "value": input_value(incoming, ctx)}
                    for name, attribute in (("Invert Color", "invert_rgb"), ("Invert Alpha", "invert_alpha")):
                        if name not in op["inputs"]:
                            op["inputs"][name] = {"name": name, "socketType": "BOOLEAN",
                                "value": {"kind": "constant", "type": "BOOLEAN", "value": bool(getattr(node, attribute))}}
                elif node.bl_idname == "CompositorNodeAlphaOver":
                    legacy = node.inputs.get("Type") is None
                    op["properties"]["alpha_over_model"] = "legacy" if legacy else "modern"
                    if legacy:
                        op["properties"]["legacy_premul"] = float(node.premul)
                        op["properties"]["legacy_straight"] = bool(node.use_premultiply)
                    for incoming in node.inputs:
                        name = {"Image": "Background", "Image_001": "Foreground"}.get(incoming.identifier, incoming.identifier) if legacy else incoming.identifier
                        op["inputs"][name] = {"name": incoming.name, "socketType": incoming.type,
                                              "value": input_value(incoming, ctx)}
                elif TYPES[node.bl_idname] in ("separate-color", "combine-color"):
                    legacy_mode = {"CompositorNodeSepHSVA": "HSV", "CompositorNodeCombHSVA": "HSV",
                                   "CompositorNodeSepYUVA": "YUV", "CompositorNodeCombYUVA": "YUV",
                                   "CompositorNodeSepYCCA": "YCC", "CompositorNodeCombYCCA": "YCC"}.get(node.bl_idname)
                    mode = legacy_mode or getattr(node, "mode", "RGB")
                    if mode not in ("RGB", "HSV", "HSL", "YUV", "YCC"):
                        fail("unsupported-color-channel-mode", path, node, socket,
                             "Separate/Combine Color has an unknown color model")
                    op["properties"]["mode"] = mode
                    op["properties"]["ycc_mode"] = getattr(node, "mode", "ITUBT601") if legacy_mode == "YCC" else getattr(node, "ycc_mode", "ITUBT601")
                    op["properties"]["color_conversion_device"] = getattr(
                        scene.render, "compositor_device", "CPU")
                    op["properties"]["legacy_hsv_clamp"] = bpy.app.version < (4, 5, 0)
                    op["properties"]["legacy_hsl_clamp"] = bpy.app.version < (4, 5, 0)
                    if TYPES[node.bl_idname] == "separate-color":
                        incoming = node.inputs["Image"]
                        op["inputs"]["Image"] = {"name": incoming.name,
                                                    "socketType": incoming.type,
                                                    "value": input_value(incoming, ctx)}
                    else:
                        aliases = {"CompositorNodeCombRGBA": ("R", "G", "B", "A"),
                                   "CompositorNodeCombHSVA": ("H", "S", "V", "A"),
                                   "CompositorNodeCombYUVA": ("Y", "U", "V", "A"),
                                   "CompositorNodeCombYCCA": ("Y", "Cb", "Cr", "A")}.get(
                            node.bl_idname, ("Red", "Green", "Blue", "Alpha"))
                        for name, identifier in zip(("Red", "Green", "Blue", "Alpha"), aliases):
                            incoming = node.inputs[identifier]
                            op["inputs"][name] = {"name": incoming.name,
                                                  "socketType": incoming.type,
                                                  "value": input_value(incoming, ctx)}
                elif node.bl_idname == "CompositorNodeBrightContrast":
                    op["properties"]["use_premultiply"] = bool(getattr(node, "use_premultiply", False))
                    for incoming in node.inputs:
                        op["inputs"][incoming.identifier] = {"name": incoming.name, "socketType": incoming.type,
                                                             "value": input_value(incoming, ctx)}
                elif node.bl_idname == "CompositorNodeColorBalance":
                    # Older nodes grade lift/gain in sRGB; the new socket-based
                    # node grades directly in scene-linear. Preserve the model
                    # as well as the controls when normalizing the graph.
                    modern_balance = node.inputs.get("Type") is not None
                    op["properties"]["color_balance_model"] = (
                        "linear" if modern_balance else "legacy-srgb"
                    )
                    if modern_balance:
                        type_socket = node.inputs["Type"]
                        if any(link.is_valid and not getattr(link, "is_muted", False)
                               for link in type_socket.links):
                            fail("dynamic-color-balance-mode", path, node, type_socket,
                                 "Color Balance requires a fixed Lift/Gamma/Gain, ASC-CDL or White Point mode")
                        mode = type_socket.default_value
                    else:
                        mode = {"LIFT_GAMMA_GAIN": "Lift/Gamma/Gain",
                                "OFFSET_POWER_SLOPE": "Offset/Power/Slope (ASC-CDL)"}.get(
                            getattr(node, "correction_method", ""))
                    if mode not in ("Lift/Gamma/Gain", "Offset/Power/Slope (ASC-CDL)", "White Point"):
                        fail("unsupported-color-balance-mode", path, node,
                             node.inputs.get("Type"),
                             "Color Balance requires Lift/Gamma/Gain, ASC-CDL or White Point mode")

                    def balance_constant(name, socket_type, setting):
                        op["inputs"][name] = {
                            "name": name, "socketType": socket_type,
                            "value": {"kind": "constant", "type": socket_type,
                                      "value": value(setting)},
                        }

                    for name in ("Image", "Fac"):
                        incoming = node.inputs[name]
                        op["inputs"][name] = {"name": incoming.name,
                                              "socketType": incoming.type,
                                              "value": input_value(incoming, ctx)}
                    balance_constant("Type", "MENU", mode)
                    if mode == "White Point":
                        try:
                            op["properties"].update(whitepoint_properties(node,
                                _sibling("compositor_math").numeric_socket_bounds,
                                lambda incoming, message: fail("white-point-domain", path, node, incoming, message)))
                        except ValueError as error:
                            fail("white-point-working-space", path, node, node.inputs["Image"], str(error))
                        for name in ("Input Temperature", "Input Tint", "Output Temperature", "Output Tint"):
                            incoming = node.inputs[name]
                            op["inputs"][name] = {"name": incoming.name, "socketType": incoming.type,
                                                  "value": input_value(incoming, ctx)}
                    parameters = {"Lift/Gamma/Gain": ("Lift", "Gamma", "Gain"),
                                  "Offset/Power/Slope (ASC-CDL)": ("Offset", "Power", "Slope"),
                                  "White Point": ()}[mode]
                    for parameter in parameters:
                        if modern_balance:
                            for name in ("Base " + parameter, "Color " + parameter):
                                incoming = node.inputs[name]
                                op["inputs"][name] = {"name": incoming.name,
                                                      "socketType": incoming.type,
                                                      "value": input_value(incoming, ctx)}
                        else:
                            base = (getattr(node, "offset_basis", 0.0) if parameter == "Offset"
                                    else 0.0 if parameter == "Lift" else 1.0)
                            balance_constant("Base " + parameter, "VALUE", base)
                            balance_constant("Color " + parameter, "RGBA",
                                             [*getattr(node, parameter.lower()), 1.0])
                elif node.bl_idname == "CompositorNodeRLayers":
                    source_scene = node.scene or scene
                    layer = source_scene.view_layers.get(node.layer)
                    if layer is None:
                        fail(
                            "missing-view-layer",
                            path,
                            node,
                            socket,
                            "Referenced view layer missing",
                        )
                    pass_data = {
                        "scene": source_scene.name,
                        "viewLayer": layer.name,
                        "pass": socket.identifier,
                        "name": socket.name,
                        "type": socket.type,
                        "engine": source_scene.render.engine,
                    }
                    if source_scene != scene:
                        fail(
                            "other-scene-pass",
                            path,
                            node,
                            socket,
                            "Additional rendered scenes need explicit runtime render passes",
                        )
                    if not socket.enabled or socket.is_unavailable:
                        fail(
                            "disabled-pass",
                            path,
                            node,
                            socket,
                            "Referenced Blender render pass is unavailable",
                        )
                    pass_data["aov"] = next(
                        (
                            {"name": a.name, "type": a.type, "valid": a.is_valid}
                            for a in layer.aovs
                            if a.name == socket.name
                        ),
                        None,
                    )
                    op["pass"] = pass_data
                    pass_key = (source_scene.name, layer.name, socket.identifier)
                    if pass_key not in pass_keys:
                        result["passes"].append(pass_data)
                        pass_keys.add(pass_key)
                else:
                    for incoming in node.inputs:
                        if incoming.enabled and not incoming.is_unavailable:
                            op["inputs"][incoming.identifier] = {
                                "name": incoming.name,
                                "socketType": incoming.type,
                                "value": input_value(incoming, ctx),
                            }
                # Assign only after dependencies are emitted, yielding topological order.
                single = op["kind"] == "image-info" or (op["kind"] not in {"render-pass", "image-input"} and not op["properties"].get("procedural_texture_coordinate_model") and all(is_single_value(incoming["value"]) for incoming in op["inputs"].values()))
                if single and op["kind"] == "alpha-crop" and bpy.app.version < (4, 5, 0) and device == "CPU":
                    fail("unsupported-crop-domain", path, node, socket,
                         "Legacy CPU Crop requires a finite image input; constant-image canvas evaluation remains unqualified")
                if op["kind"] == "math":
                    effective = op["properties"]["single_value_device"] if single else device
                    op["properties"].update(validate_math_domain(node, effective,
                        lambda code, incoming, message: fail(code, path, node, incoming, message), native_gpu_profile))
                op["id"] = "n" + str(len(result["ops"]))
                result["ops"].append(op)
                if single:
                    single_values.add(op["id"])
                ref = {"kind": "ref", "node": op["id"], "type": op["type"] if op["kind"] in {"image-coordinates", "image-info"} else socket.type}
            memo[key] = ref
            return ref
        finally:
            visiting.remove(key)

    def require_static(node, socket, ctx):
        owner = node.id_data
        animation = owner.animation_data
        if animation and (
            animation.action or len(animation.drivers) or len(animation.nla_tracks)
        ):
            fail(
                "animated-tree",
                ctx["path"],
                node,
                socket,
                "Compositor animation or drivers need live curve transport; the current frame cannot stand in for the animation",
            )

    try:
        ctx = {"path": (tree.name,), "ancestry": (tree.as_pointer(),), "parent": None}
        if modern:
            sink = output_node(tree, ctx["path"])
            sockets = [s for s in sink.inputs if s.identifier != "__extend__"]
            if not sockets or sockets[0].type != "RGBA":
                fail(
                    "invalid-output",
                    ctx["path"],
                    sink,
                    None,
                    "First Group Output input must be Color",
                )
            terminal = sockets[0]
        else:
            sinks = [
                n
                for n in tree.nodes
                if n.bl_idname == "CompositorNodeComposite"
                and getattr(n, "is_active_output", True)
            ]
            if len(sinks) != 1:
                fail(
                    "legacy-output",
                    ctx["path"],
                    None,
                    None,
                    "No unique legacy Composite output",
                )
            sink = sinks[0]
            terminal = sink.inputs.get("Image")
        require_static(sink, terminal, ctx)
        if not modern and not sink.use_alpha:
            result["outputAlpha"] = "legacy-composite-opaque-v1"
        result["output"] = input_value(terminal, ctx)
        texture_conflict = validate_texture_field_graph(result)
        if texture_conflict:
            op, message = texture_conflict
            result["diagnostics"].append({"code":"unsupported-procedural-texture-field", "path":op["source"]["path"], "node":op["source"]["node"], "socket":op["source"]["output"], "message":message})
            raise Unsupported()
        coordinate_conflict = validate_image_coordinate_graph(result)
        if coordinate_conflict:
            op, message = coordinate_conflict
            result["diagnostics"].append({"code": "unsupported-image-coordinates", "path": op["source"]["path"],
                "node": op["source"]["node"], "socket": op["source"]["output"], "message": message})
            raise Unsupported()
        split_conflict = validate_split_domains(result)
        if split_conflict:
            op, message = split_conflict
            result["diagnostics"].append({"code": "unsupported-split-domain", "path": op["source"]["path"],
                "node": op["source"]["node"], "socket": op["source"]["output"], "message": message})
            raise Unsupported()
        pixelate_conflict = validate_pixelate_domains(result)
        if pixelate_conflict:
            op, message = pixelate_conflict
            result["diagnostics"].append({"code": "unsupported-pixelate-domain", "path": op["source"]["path"],
                "node": op["source"]["node"], "socket": op["source"]["output"], "message": message})
            raise Unsupported()
        crop_conflict = validate_crop_domains(result, single_values)
        if crop_conflict:
            op, message = crop_conflict
            result["diagnostics"].append({"code": "unsupported-crop-domain", "path": op["source"]["path"],
                "node": op["source"]["node"], "socket": op["source"]["output"], "message": message})
            raise Unsupported()
        image_conflict = validate_static_image_graph(result)
        if image_conflict:
            op, message = image_conflict
            result["diagnostics"].append({"code": "unsupported-image-domain", "path": op["source"]["path"],
                "node": op["source"]["node"], "socket": op["source"]["output"], "message": message})
            raise Unsupported()
        if any(op["kind"] in ("translate", "image-affine") for op in result["ops"]):
            conflict = transform_origin_conflict(result, single_values, multiply_image_affine)
            if conflict:
                op, message = conflict
                result["diagnostics"].append({"code": "unsupported-image-domain", "path": op["source"]["path"],
                    "node": op["source"]["node"], "socket": op["source"]["output"], "message": message})
                raise Unsupported()
        result["status"] = "extracted"
    except Unsupported:
        result["status"] = "unsupported"
    return result
