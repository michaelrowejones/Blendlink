# SPDX-License-Identifier: GPL-3.0-or-later
"""Primary triangle-surface geometry inputs, with explicit context admission."""
import math
import contextvars
import functools
import bpy

GEOMETRY_OUTPUTS = {"Position": "position", "Normal": "normal", "True Normal": "true-normal",
                    "Incoming": "incoming", "Backfacing": "backfacing"}
TEXTURE_OUTPUTS = {"Camera": "camera", "Normal": "object-normal", "Window": "window", "Reflection": "reflection"}
NORMAL_OUTPUTS = {"normal", "object-normal", "reflection"}
VIEW_OUTPUTS = {"normal", "object-normal", "backfacing", "incoming", "true-normal", "camera", "window", "reflection"}
_validation_cache = contextvars.ContextVar("geometry_validation", default=None)


def cached_plan(function):
    @functools.wraps(function)
    def wrapper(*args, **kwargs):
        token = _validation_cache.set({})
        try: return function(*args, **kwargs)
        finally: _validation_cache.reset(token)
    return wrapper


def emit_geometry(node, socket, *, refuse, engine):
    outputs = GEOMETRY_OUTPUTS if node.bl_idname == "ShaderNodeNewGeometry" else TEXTURE_OUTPUTS
    name = getattr(socket, "identifier", socket.name)
    if name not in outputs: refuse(f'{node.name}: {name} has no verified primary triangle context')
    if engine not in {"CYCLES", "EEVEE"}: refuse("Geometry context requires a verified Cycles or EEVEE source engine")
    return primary_context(outputs[name], engine)


def primary_context(output, engine):
    return {"op": "geometry_context", "output": output, "sourceEngine": engine,
            "normalStorage": ("OCT16" if bpy.app.version >= (5, 2) else "FLOAT32") if engine == "CYCLES" else "SNORM16" if getattr(bpy.context.scene.render,"use_high_quality_normals",False) else "SNORM10",
            "model": "primary-triangles-v1"}


def collect_outputs(value, outputs):
    if isinstance(value, dict):
        if value.get("op") == "geometry_context": outputs.add(value.get("output"))
        for child in value.values(): collect_outputs(child, outputs)
    elif isinstance(value, (list, tuple)):
        for child in value: collect_outputs(child, outputs)


def validate_camera(outputs):
    if not outputs & VIEW_OUTPUTS: return
    scene = bpy.context.scene
    camera = scene.camera
    if camera is None: return  # A browser camera is supplied and checked on every draw.
    if camera.data.type not in {"PERSP", "ORTHO"}:
        raise ValueError("Primary geometry context requires a perspective or orthographic camera")
    matrix = camera.evaluated_get(bpy.context.evaluated_depsgraph_get()).matrix_world.to_3x3()
    axes = [matrix.col[index].normalized() for index in range(3)]
    if matrix.determinant() <= 0 or max(abs(axes[a].dot(axes[b])) for a,b in ((0,1),(0,2),(1,2))) > 1e-5:
        raise ValueError("Primary geometry context has no verified reflected/sheared camera projection binding")
    if camera.data.shift_x != 0 or camera.data.shift_y != 0 or scene.render.use_border:
        raise ValueError("Primary geometry view coordinates have no verified shifted/cropped camera projection binding")


def validate_owner(obj, outputs):
    if not outputs: return
    validate_camera(outputs)
    if obj.type != "MESH" or obj.data.shape_keys or obj.find_armature() or any(mod.show_render for mod in obj.modifiers):
        raise ValueError("Geometry context currently requires authored triangle meshes without modifiers, skin or morph deformation")
    animation = obj.data.animation_data
    if animation and (animation.action or animation.drivers or any(track.strips for track in animation.nla_tracks)):
        raise ValueError("Geometry context has no verified animated mesh-data binding")
    if getattr(bpy.context.scene.render, "use_simplify_normals", False):
        raise ValueError("Geometry context does not yet preserve Simplify Normals")
    for material in obj.data.materials:
        if material and material.use_nodes and any(node.type == 'OUTPUT_MATERIAL' and node.is_active_output and
                node.inputs['Displacement'].is_linked for node in material.node_tree.nodes):
            raise ValueError("Primary geometry context has no verified material-displacement surface binding")
    cache = _validation_cache.get()
    key = (obj.as_pointer(), bool(outputs & NORMAL_OUTPUTS))
    if cache is not None and key in cache: return
    graph = bpy.context.evaluated_depsgraph_get()
    if obj.is_instancer or any(item.is_instance and getattr(item.object, "original", None) == obj for item in graph.object_instances):
        raise ValueError("Geometry context has no verified generated-instance binding")
    evaluated = obj.evaluated_get(graph)
    matrix = evaluated.matrix_world
    if not all(math.isfinite(value) for row in matrix for value in row) or matrix.determinant() == 0:
        raise ValueError("Geometry context requires a finite invertible object matrix")
    if any(abs(value) > 1e8 for transform in (matrix.to_3x3(), matrix.to_3x3().inverted()) for row in transform for value in row):
        raise ValueError("Geometry context object matrix exceeds the verified normal precision domain")
    linear = matrix.to_3x3()
    condition_bound = math.sqrt(sum(value * value for row in linear for value in row)) * math.sqrt(
        sum(value * value for row in linear.inverted() for value in row))
    if condition_bound > 100:
        raise ValueError("Geometry context requires an object transform condition bound at most 100")
    mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=graph)
    try:
        mesh.calc_loop_triangles()
        if not mesh.loop_triangles: raise ValueError("Geometry context requires nonempty triangle surfaces")
        if not all(math.isfinite(value) for vertex in mesh.vertices for value in vertex.co):
            raise ValueError("Geometry context requires finite vertex positions")
        for triangle in mesh.loop_triangles:
            if triangle.area <= 1e-12: raise ValueError("Geometry context refuses degenerate triangle normals")
            if outputs & NORMAL_OUTPUTS:
                for loop_index in triangle.loops:
                    normal = mesh.corner_normals[loop_index].vector
                    if not all(math.isfinite(value) for value in normal) or normal.dot(triangle.normal) <= .05:
                        raise ValueError("Geometry context needs authored unit normals with outward triangle cosine above 0.05")
    finally: evaluated.to_mesh_clear()
    if cache is not None: cache[key] = True


def normal_model(obj):
    """Cycles bakes single-user transforms into vertex normals before interpolation.

    This is source-scene metadata, captured before private compiler copies can
    alter mesh users. Restrict geometry-key exceptions until individually proved.
    """
    cache = _validation_cache.get()
    key = ('normal-model', obj.as_pointer())
    if cache is not None and key in cache: return cache[key]
    if __package__:
        from . import procedural, weblights, tsl_object_info
    else:
        import procedural, weblights, tsl_object_info
    scene = bpy.context.scene
    if getattr(scene.render, 'use_motion_blur', False):
        raise ValueError("Geometry context has no verified motion-blurred normal interpolation")
    candidates = [other for other in scene.objects if other.type == "MESH" and other.data == obj.data]
    if any(tsl_object_info._animated_property(other, {'hide_render'}) for other in candidates):
        raise ValueError("Cycles normal interpolation has no verified animated render-visibility geometry key")
    users = [other for other in candidates if
             weblights.render_visibility(other, scene, view_layer=bpy.context.view_layer).exported]
    if any(item.is_instance and getattr(getattr(item.object, 'original', None), 'data', None) == obj.data
           for item in bpy.context.evaluated_depsgraph_get().object_instances):
        raise ValueError("Cycles normal interpolation has no verified generated-instance geometry key")
    for other in users:
        if any(mod.show_render for mod in other.modifiers) or any(slot.link != 'DATA' for slot in other.material_slots):
            raise ValueError("Cycles normal interpolation has no verified modifier/material-override geometry key")
    for material in obj.data.materials:
        if not material or not material.use_nodes: continue
        for node in procedural.reachable_surface_nodes(material.node_tree):
            if node.bl_idname == "ShaderNodeSubsurfaceScattering":
                raise ValueError("Cycles normal interpolation has no verified subsurface geometry key")
            if node.bl_idname == "ShaderNodeBsdfPrincipled":
                socket = node.inputs.get("Subsurface Weight") or node.inputs.get("Subsurface")
                if socket and (socket.is_linked or socket.default_value != 0):
                    raise ValueError("Cycles normal interpolation has no verified subsurface geometry key")
        for node in material.node_tree.nodes:
            if node.type == 'OUTPUT_MATERIAL' and node.is_active_output and node.inputs['Displacement'].is_linked:
                raise ValueError("Cycles normal interpolation has no verified displacement geometry key")
    if not users: raise ValueError("Cycles normal interpolation needs an actual visible source owner")
    result = "world-vertex" if len(users) == 1 else "object"
    if cache is not None: cache[key] = result
    return result


def bind_normal_model(value, owners):
    if isinstance(value, dict):
        if value.get("op") == "geometry_context" and value.get("sourceEngine") == "CYCLES" and value.get("output") in NORMAL_OUTPUTS:
            models = {normal_model(owner) for owner in owners}
            if len(models) != 1:
                raise ValueError("One Cycles material mixes shared and single-owner normal interpolation; separate its material bindings")
            value["normalTransform"] = models.pop()
            shading = {polygon.use_smooth for owner in owners for polygon in owner.data.polygons}
            if len(shading) != 1:
                raise ValueError("Cycles geometry normals do not yet preserve mixed flat/smooth triangle shading")
            value["normalShading"] = "smooth" if shading.pop() else "flat"
            # Flat Cycles triangles use their geometric face normal, bypassing
            # packed corner normals. Constant face corners interpolate exactly.
            if value["normalShading"] == "flat": value["normalStorage"] = "FLOAT32"
        for child in value.values(): bind_normal_model(child, owners)
    elif isinstance(value, list):
        for child in value: bind_normal_model(child, owners)


def capture_refusal(root, channel, walk_channel):
    names = ("Emission Color", "Emission Strength") if channel == "Emission" else (channel,)
    for name in names:
        socket = root.inputs.get(name)
        if socket is None: continue
        for node, output in walk_channel(socket):
            if node.bl_idname == 'ShaderNodeNormalMap' and node.space != 'TANGENT':
                return 'cannot automatically replace a primary Object/World Normal Map with UV-bake ray context; keep this channel live or review an explicit capture'
            table = GEOMETRY_OUTPUTS if node.bl_idname == "ShaderNodeNewGeometry" else TEXTURE_OUTPUTS if node.bl_idname == "ShaderNodeTexCoord" else {}
            if node.bl_idname == 'ShaderNodeNewGeometry' or getattr(output, "identifier", output.name) in table:
                return "cannot automatically replace primary triangle/camera geometry context with UV-bake ray context; keep this channel live or choose an explicit reviewed material capture"
    return None
