# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only bounded shader Scene Time dependency admission, not clock evaluation."""
import bpy


class TemporalDependencyUnproven(ValueError):
    pass


def material_scene_time_dependencies(material, *, target=None, inputs=None):
    if material is None:
        return []
    if __package__:
        from .bakelib_loader import bakelib
        from . import tsl_ir, static_selection, repeat_ir
    else:
        import bakelib, tsl_ir, static_selection, repeat_ir
    tree = bakelib.active_shader_node_tree(material)
    if tree is None:
        return []
    # Avoid introducing a traversal limit for ordinary materials with no Time
    # node anywhere, including scratch groups. This census never evaluates a dependency graph.
    pending, trees, has_time = [tree], set(), False
    while pending:
        current = pending.pop()
        if current.as_pointer() in trees:continue
        trees.add(current.as_pointer())
        if len(trees) > 4096:
            return [{'node': None, 'tree': tree.name, 'output': None, 'instances': [],
                     'sourceTarget': target, 'unproven': 'Scene Time group census exceeds4096 trees'}]
        for node in current.nodes:
            has_time |= node.bl_idname == 'GeometryNodeInputSceneTime'
            nested = getattr(node, 'node_tree', None)
            if nested is not None:pending.append(nested)
    if not has_time:
        return []
    target = target or tsl_ir._normalize_evaluation_engine(bpy.context.scene.render.engine)
    if target not in {'EEVEE', 'CYCLES'}:target = 'ALL'
    output = tsl_ir._active_material_output(tree, target) if inputs is None else None
    if inputs is None and output is None:
        return []
    records, seen, work = [], set(), []

    def links(socket, stack):
        work.extend((link.from_node, link.from_socket, stack) for link in socket.links
                    if link.is_valid and not getattr(link, 'is_muted', False))

    def match(sockets, reference):
        found = [s for s in sockets if s.identifier == reference.identifier]
        if len(found) != 1:
            raise TemporalDependencyUnproven('Scene Time group socket identifier is unresolved')
        return found[0]

    try:
        roots = inputs if inputs is not None else [output.inputs.get(name) for name in ['Surface', 'Volume', 'Displacement']]
        for socket in roots:
            if socket is not None and socket.enabled and not socket.is_unavailable:links(socket, ())
        while work:
            node, socket, stack = work.pop()
            key = (node.as_pointer(), socket.identifier, tuple(item.as_pointer() for item in stack))
            if key in seen:continue
            seen.add(key)
            if len(seen) > 4096 or len(stack) > 32:
                raise TemporalDependencyUnproven('Scene Time dependency exceeds 4096 visits or group depth32')
            if node.mute:
                bypass = [link.from_socket for link in node.internal_links if link.to_socket.identifier == socket.identifier]
                if len(bypass) > 1:
                    raise TemporalDependencyUnproven('Scene Time muted output has no unique native bypass')
                if bypass:links(bypass[0], stack)
                continue  # No native bypass means no upstream input contributes.
            kind = node.bl_idname
            if kind == 'GeometryNodeInputSceneTime':
                records.append({'node': node.name, 'tree': node.id_data.name, 'output': socket.identifier,
                                'instances': [item.name for item in stack], 'sourceTarget': target})
                continue
            if kind == 'NodeReroute':
                links(node.inputs[0], stack);continue
            if kind == 'NodeGroupInput':
                if not stack:
                    raise TemporalDependencyUnproven('Scene Time group input has no instance binding')
                links(match(stack[-1].inputs, socket), stack[:-1]);continue
            if kind == 'ShaderNodeGroup':
                outputs = [n for n in node.node_tree.nodes if n.bl_idname == 'NodeGroupOutput' and n.is_active_output] if node.node_tree else []
                if len(outputs) != 1:
                    raise TemporalDependencyUnproven('Scene Time group has no unique active output')
                links(match(outputs[0].inputs, socket), stack + (node,));continue
            if kind in static_selection.NODES:
                try:selected = static_selection.static_selection(node, socket, stack)
                except (ValueError, RecursionError):pass  # Unproven selectors retain all dependencies.
                else:
                    if selected['constant'] is None:links(selected['input'], stack)
                    continue
            if kind == 'GeometryNodeRepeatOutput':
                try:inputs = repeat_ir.dependencies(node, socket, stack)
                except (ValueError, RecursionError):pass
                else:
                    for incoming in inputs:links(incoming, stack)
                    continue
            for incoming in node.inputs:
                if incoming.enabled and not incoming.is_unavailable:links(incoming, stack)
    except TemporalDependencyUnproven as error:
        records.append({'node': None, 'tree': tree.name, 'output': None,
                        'instances': [], 'sourceTarget': target, 'unproven': str(error)})
    return records


def object_scene_time_dependencies(obj):
    """Source-only used-material proof, or named uncertainty; never evaluate a mesh.

    Ordinary meshes use the existing allocation-free material-use seam. Simple
    refinement/normal chains preserve source slot indices. Material-generating
    modifiers retain referenced candidates as unproven instead of allocating an
    unbounded evaluated receiver just to inspect its material table.
    """
    if __package__:
        from . import procedural, material_compiler
    else:
        import procedural, material_compiler
    source = [slot.material for slot in getattr(obj, 'material_slots', ())]
    active = [mod for mod in getattr(obj, 'modifiers', ()) if mod.show_render or mod.show_viewport]
    index_preserving = {'SUBSURF', 'TRIANGULATE', 'WEIGHTED_NORMAL', 'NORMAL_EDIT',
                        'ARMATURE', 'LATTICE', 'SMOOTH', 'LAPLACIANSMOOTH', 'SIMPLE_DEFORM',
                        'CAST', 'HOOK', 'WARP', 'WAVE', 'SHRINKWRAP', 'SURFACE_DEFORM',
                        'CORRECTIVE_SMOOTH', 'MESH_DEFORM', 'CURVE', 'MIRROR', 'DECIMATE'}
    candidates = list(source)
    opaque = bool(active) and (not all(mod.type in index_preserving for mod in active)
                              or any(slot.link != 'DATA' for slot in obj.material_slots))
    # Native Geometry Nodes can introduce a Material absent from source slots.
    # Inspect actual ID references (including nested group/modifier inputs), not
    # every material in bpy.data or arbitrary unrelated scratch materials.
    pending, seen = [], set()
    def modifier_references(modifiers):
        for modifier in modifiers:
            if not (modifier.show_render or modifier.show_viewport):continue
            if modifier.type == 'NODES':
                if modifier.node_group is not None:pending.append(modifier.node_group)
                try:values = tuple(modifier.values())
                except TypeError:values = ()  # No custom input storage exists yet.
                pending.extend(value for value in values if isinstance(value, bpy.types.ID))
                # Blender 5.3 exposes actual socket bindings as dynamic RNA
                # properties, instead of the legacy modifier ID properties.
                inputs = getattr(getattr(modifier, 'properties', None), 'inputs', None)
                if inputs is not None:
                    for prop in inputs.bl_rna.properties:
                        if prop.type == 'POINTER' and prop.identifier != 'rna_type':
                            value = getattr(inputs, prop.identifier, None)
                            if not isinstance(value, bpy.types.ID):value = getattr(value, 'value', None)
                            if isinstance(value, bpy.types.ID):pending.append(value)
            elif modifier.type in {'BOOLEAN', 'ARRAY', 'VOLUME_TO_MESH'}:
                for name in ['object', 'collection', 'start_cap', 'end_cap']:
                    value = getattr(modifier, name, None)
                    if value is not None:pending.append(value)
    modifier_references(active)
    while pending:
        item = pending.pop()
        if item.as_pointer() in seen:continue
        seen.add(item.as_pointer())
        if len(seen) > 4096:
            return [{'material': None, 'dependencies': [], 'unproven': 'Scene Time material-reference census exceeds4096 IDs'}]
        if isinstance(item, bpy.types.Material):
            candidates.append(item);continue
        if isinstance(item, bpy.types.Object):
            candidates.extend(slot.material for slot in item.material_slots)
            modifier_references(item.modifiers)
            if item.instance_collection is not None:pending.append(item.instance_collection)
        elif isinstance(item, bpy.types.Collection):
            pending.extend(item.objects);pending.extend(item.children)
        elif isinstance(item, bpy.types.NodeTree):
            for node in item.nodes:
                if getattr(node, 'node_tree', None) is not None:pending.append(node.node_tree)
                for socket in node.inputs:
                    value = getattr(socket, 'default_value', None)
                    if isinstance(value, (bpy.types.Material, bpy.types.Object, bpy.types.Collection)):pending.append(value)
                for prop in node.bl_rna.properties:
                    if prop.type == 'POINTER' and getattr(prop.fixed_type, 'identifier', '') in {'Material', 'Object', 'Collection'}:
                        value = getattr(node, prop.identifier, None)
                        if value is not None:pending.append(value)
    matches = {}
    for material in candidates:
        if material is None or material.as_pointer() in matches:continue
        dependencies = material_scene_time_dependencies(material)
        for marker in material_compiler.marker_nodes(material):
            selected = [marker.inputs.get(name) for name in [material_compiler.COLOR_INPUT, material_compiler.ALPHA_INPUT]]
            dependencies.extend(dict(row, intent="selected-field") for row in material_scene_time_dependencies(material, inputs=selected))
        if dependencies:matches[material.as_pointer()] = (material, dependencies)
    if not matches:return []
    def record(material, dependencies, *, unproven=None):
        row = {'material': material.name, 'materialPointer': material.as_pointer(),
               'materialLibrary': material.library.filepath if material.library else None,
               'dependencies': dependencies}
        if unproven:row['unproven'] = unproven
        return row
    if obj.type == 'MESH' and not getattr(obj, 'modifiers', ()):
        used = {use.material.as_pointer() for use in procedural.evaluated_material_uses(obj) if use.material is not None}
        return [record(material, dependencies) for pointer, (material, dependencies) in matches.items() if pointer in used]
    if obj.type == 'MESH' and not opaque:
        used = {source[face.material_index].as_pointer() for face in obj.data.polygons
                if 0 <= face.material_index < len(source) and source[face.material_index] is not None}
        return [record(material, dependencies, unproven='Source-used material may survive this modifier chain; exact render-used reachability is unproven')
                for pointer, (material, dependencies) in matches.items() if pointer in used]
    return [record(material, dependencies,
                   unproven='Render-used material reachability through this modifier/binding requires separate proof')
            for material, dependencies in matches.values()]
