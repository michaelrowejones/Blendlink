# SPDX-License-Identifier: GPL-3.0-or-later
"""Explicit native Object Info data, separate from geometry/UV mesh sharing."""
import math

OUTPUTS = {
    "Location": "location", "Color": "color", "Alpha": "alpha",
    "Object Index": "object_index", "Material Index": "material_index",
}


def collect_outputs(value, outputs):
    if isinstance(value, dict):
        if value.get("op") == "object_info":
            outputs.add(value.get("output"))
        for item in value.values():
            collect_outputs(item, outputs)
    elif isinstance(value, (list, tuple)):
        for item in value:
            collect_outputs(item, outputs)


def _animated_property(value, paths):
    if __package__:
        from . import procedural
    else:
        import procedural
    animation = getattr(value, "animation_data", None)
    if animation is None:
        return False
    if any(not getattr(curve, "mute", False) and curve.data_path in paths
           for curve in getattr(animation, "drivers", ())):
        return True
    actions = [(getattr(animation, "action", None), getattr(animation, "action_slot", None))]
    actions.extend((getattr(strip, "action", None), getattr(strip, "action_slot", None))
                   for strip in procedural._effective_nla_strips(animation))
    for action, slot in actions:
        if action is None:
            continue
        curves, inspected = procedural._action_fcurves(action, slot)
        if not inspected or any(not getattr(curve, "mute", False) and curve.data_path in paths for curve in curves):
            return True
    return False


def owner_metadata(obj, outputs):
    if not outputs or not outputs <= set(OUTPUTS.values()):
        raise ValueError("Object Info needs an explicitly supported output")
    if outputs & {"color", "alpha"} and _animated_property(obj, {"color"}):
        raise ValueError(f'Object Info Color/Alpha on "{obj.name}" uses animated or driven object color; its property timeline is not transported yet')
    if "object_index" in outputs and _animated_property(obj, {"pass_index"}):
        raise ValueError(f'Object Info Object Index on "{obj.name}" is animated or driven; its property timeline is not transported yet')
    # Ordinary authored objects may share one glTF mesh. Native generated
    # instances need individual evaluated identities, not one source snapshot.
    if getattr(obj, "is_instancer", False):
        raise ValueError(f'Object Info on "{obj.name}" needs explicit generated-instance data; realize or export distinct object owners until that transport is verified')
    import bpy
    graph = bpy.context.evaluated_depsgraph_get()
    if any(instance.is_instance and getattr(instance.object, "original", None) == obj for instance in graph.object_instances):
        raise ValueError(f'Object Info on "{obj.name}" is used by generated instances whose individual metadata is not transported yet')
    color = [float(item) for item in obj.color]
    location = [float(item) for item in obj.matrix_world.translation]
    if any(not math.isfinite(item) for item in color + location):
        raise ValueError(f'Object Info on "{obj.name}" has nonfinite color or world location')
    return {"schemaVersion": 1, "color": color, "objectIndex": int(obj.pass_index),
            "nativeLocation": location}


def material_metadata(material, outputs):
    if "material_index" in outputs and _animated_property(material, {"pass_index"}):
        raise ValueError(f'Object Info Material Index on "{material.name}" is animated or driven; its property timeline is not transported yet')
    return {"schemaVersion": 1, "materialIndex": int(material.pass_index)}
