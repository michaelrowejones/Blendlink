# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only extraction of the authored compositor output graph."""

import bpy

TYPES = {
    "CompositorNodeRGB": "rgb",
    "ShaderNodeValue": "value",
    "ShaderNodeMath": "math",
    "ShaderNodeMixRGB": "mix-rgb",
    "ShaderNodeMix": "mix",
    "CompositorNodeAlphaOver": "alpha-over",
    "CompositorNodeExposure": "exposure",
    "CompositorNodeBrightContrast": "brightness-contrast",
    "ShaderNodeGamma": "gamma",
    "CompositorNodeInvert": "invert",
    "CompositorNodeHueSat": "hue-saturation-value",
    "CompositorNodeBlur": "blur",
    "CompositorNodeGlare": "glare",
    "CompositorNodeRLayers": "render-pass",
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
        if resolved.get("type") != socket.type:
            return {
                "kind": "convert",
                "fromType": resolved.get("type"),
                "type": socket.type,
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
                if node.bl_idname in ("CompositorNodeRGB", "ShaderNodeValue"):
                    op["value"] = value(socket.default_value)
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
                op["id"] = "n" + str(len(result["ops"]))
                result["ops"].append(op)
                ref = {"kind": "ref", "node": op["id"], "type": socket.type}
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
        result["output"] = input_value(terminal, ctx)
        result["status"] = "extracted"
    except Unsupported:
        result["status"] = "unsupported"
    return result
