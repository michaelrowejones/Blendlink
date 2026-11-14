# SPDX-License-Identifier: GPL-3.0-or-later
"""Known native evaluation differences that forbid an automatic engine switch."""

_ENGINE_SENSITIVE = {
    "ShaderNodeBlackbody", "ShaderNodeWavelength",
    "ShaderNodeFloatCurve", "ShaderNodeVectorCurve", "ShaderNodeRGBCurve",
    "ShaderNodeValToRGB", "ShaderNodeSeparateColor", "ShaderNodeCombineColor",
    "ShaderNodeSeparateHSV", "ShaderNodeCombineHSV",
    "ShaderNodeRGBToBW",
    "ShaderNodeTexImage",
    "ShaderNodeTexNoise",
    "ShaderNodeTexMagic",
    "ShaderNodeRadialTiling",
    "ShaderNodeCameraData", "ShaderNodeSqueeze", "ShaderNodeLightFalloff",
    "ShaderNodeVectorTransform",
    "ShaderNodeNormalMap", "ShaderNodeNormal", "ShaderNodeBump", "ShaderNodeTangent",
}


def channel_engine_difference(root, channel, source_engine, bake_engine, walk_channel):
    """Name differences only on the channel about to bake, including groups.

    An ALL material output follows the source scene's engine. A shared shader
    root does not establish equality between the native engines' evaluators.
    Conservative refusal preserves the authored graph when equivalence has not
    been measured. Explicit artist-selected Material baking is a separate intent.
    """
    if source_engine == bake_engine:
        return None
    names = ("Emission Color", "Emission Strength") if channel == "Emission" else (channel,)
    nodes = []
    for name in names:
        socket = root.inputs.get(name)
        if socket is None:
            continue
        for node, output in walk_channel(socket):
            sensitive = node.bl_idname in _ENGINE_SENSITIVE
            field = getattr(output, 'identifier', output.name)
            if node.bl_idname == 'ShaderNodeNewGeometry' and field in {'Normal', 'Tangent'}:
                sensitive = True
            if node.bl_idname == 'ShaderNodeTexCoord' and field in {'Normal', 'Reflection'}:
                sensitive = True
            if node.bl_idname == "FunctionNodeIntegerMath" and node.operation in {"LCM", "FLOORED_MODULO"}:
                sensitive = True
            if sensitive:
                nodes.append(f'{node.name} ({node.bl_idname})')
    if not nodes:
        return None
    return (f"cannot automatically switch from {source_engine} to a {bake_engine} channel bake: "
            "native node evaluation differs and channel equivalence is unproven for "
            + ", ".join(sorted(set(nodes))))
