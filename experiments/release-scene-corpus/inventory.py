"""Read-only Blender 5.3 source inventory; no render, save, bake or GPU calls.

blender --background --factory-startup --disable-autoexec SOURCE --python
    experiments/release-scene-corpus/inventory.py -- OUTPUT.json
"""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from graph import summarize, reachable


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def value(v):
    if isinstance(v, (str, bool, int)) or v is None:
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else {'nonfinite': str(v)}
    if isinstance(v, bpy.types.ID):
        return {'datablock': v.name, 'type': v.bl_rna.identifier}
    try:
        return [value(x) for x in v]
    except TypeError:
        return str(v)


def settings(node):
    result = {}
    ui = {'width', 'height', 'dimensions', 'location', 'color', 'name', 'label'}
    for p in node.bl_rna.properties:
        if p.type in {'FLOAT', 'INT', 'STRING'} and not p.is_readonly and p.identifier not in ui and not p.identifier.startswith('bl_'):
            try:
                result[p.identifier] = value(getattr(node, p.identifier))
            except (TypeError, AttributeError):
                pass
    ramp = getattr(node, 'color_ramp', None)
    if ramp:
        result['color_ramp'] = {'color_mode': ramp.color_mode,
            'hue_interpolation': ramp.hue_interpolation, 'interpolation': ramp.interpolation,
            'elements': [{'position': e.position, 'color': list(e.color)} for e in ramp.elements]}
    mapping = getattr(node, 'mapping', None)
    if mapping and hasattr(mapping, 'curves'):
        result['curve_mapping'] = {'extend': mapping.extend,
            'use_clip': mapping.use_clip,
            'black_level': list(mapping.black_level), 'white_level': list(mapping.white_level),
            'curves': [[{'location': list(p.location), 'handle_type': p.handle_type}
                        for p in c.points] for c in mapping.curves]}
    image = getattr(node, 'image', None)
    if image:
        result['image'] = {'name': image.name, 'filepath': image.filepath,
            'source': image.source, 'alpha_mode': image.alpha_mode,
            'colorspace': image.colorspace_settings.name, 'size': list(image.size),
            'packed': bool(image.packed_file)}
    return result


source = Path(bpy.data.filepath)
before = digest(source)
trees = {}
tree_ids = {}


def add_tree(tree, context, owner=None):
    if tree.as_pointer() in tree_ids:
        return tree_ids[tree.as_pointer()]
    # Blender ID names are unique per ID type/library, and type prevents
    # compositor/shader/geometry collisions. Library path remains provenance.
    name = context + ':' + (owner or tree.name_full)
    if name in trees:
        name += ':' + (tree.library.filepath if tree.library else 'local')
    if name in trees:
        raise ValueError('Ambiguous node-tree identity: ' + name)
    tree_ids[tree.as_pointer()] = name
    nodes = {}
    trees[name] = {'context': context, 'type': tree.bl_idname,
                   'library': tree.library.filepath if tree.library else None,
                   'nodes': nodes, 'links': []}
    for n in tree.nodes:
        modes = {}
        for p in n.bl_rna.properties:
            if p.type in {'ENUM', 'BOOLEAN'} and not p.is_readonly and not p.identifier.startswith('bl_') and p.identifier not in {'select', 'show_options', 'show_preview', 'show_texture', 'hide', 'mute', 'use_custom_color', 'color_tag', 'warning_propagation'}:
                try:
                    modes[p.identifier] = value(getattr(n, p.identifier))
                except (AttributeError, TypeError):
                    pass
        nodes[n.name] = {'id': n.bl_idname, 'muted': n.mute,
            'modes': modes, 'settings': settings(n),
            'inputs': [{'identifier': s.identifier, 'name': s.name,
                'type': s.bl_idname, 'linked': s.is_linked,
                **({'default': value(s.default_value)} if hasattr(s, 'default_value') else {})}
                for s in n.inputs],
            'outputs': [{'identifier': s.identifier, 'name': s.name,
                         'type': s.bl_idname} for s in n.outputs]}
        if hasattr(n, 'is_active_output'):
            nodes[n.name]['activeOutput'] = n.is_active_output
        if n.bl_idname == 'CompositorNodeRLayers':
            nodes[n.name]['renderScene'] = n.scene.name if n.scene else None
        if getattr(n, 'node_tree', None):
            child = n.node_tree
            domain = {'ShaderNodeTree': 'shader', 'CompositorNodeTree': 'compositor',
                      'GeometryNodeTree': 'geometry'}.get(child.bl_idname, 'other')
            nodes[n.name]['groupTree'] = add_tree(child, domain)
    trees[name]['links'] = [{'fromNode': l.from_node.name,
        'fromSocket': l.from_socket.identifier, 'toNode': l.to_node.name,
        'toSocket': l.to_socket.identifier} for l in tree.links if l.is_valid]
    return name


for m in bpy.data.materials:
    if m.node_tree:
        add_tree(m.node_tree, 'shader', 'material:' + m.name_full)
for w in bpy.data.worlds:
    if w.node_tree:
        add_tree(w.node_tree, 'shader', 'world:' + w.name_full)
for g in bpy.data.node_groups:
    add_tree(g, {'ShaderNodeTree': 'shader', 'CompositorNodeTree': 'compositor',
                'GeometryNodeTree': 'geometry'}.get(g.bl_idname, 'other'))
scene = bpy.context.scene
for s in bpy.data.scenes:
    compositor = getattr(s, 'compositing_node_group', None) or getattr(s, 'node_tree', None)
    if compositor:
        add_tree(compositor, 'compositor', 'scene:' + s.name_full)
roots = []
owners = []
root_trees = set()
object_seen = set()
scene_seen = set()
particle_systems = []


def add_object(o, owner_scene):
    if o.hide_render or o.as_pointer() in object_seen:
        return
    object_seen.add(o.as_pointer())
    for slot in o.material_slots:
        if slot.material and slot.material.node_tree:
            t = add_tree(slot.material.node_tree, 'shader')
            root_trees.add(t)
            owners.append({'scene': owner_scene, 'object': o.name,
                           'material': slot.material.name, 'tree': t})
    for mod in o.modifiers:
        if mod.type == 'NODES' and mod.show_render and mod.node_group:
            root_trees.add(add_tree(mod.node_group, 'geometry'))
    collection = o.instance_collection if o.instance_type == 'COLLECTION' else None
    if collection:
        for child in collection.all_objects:
            add_object(child, owner_scene)
    for ps in o.particle_systems:
        p = ps.settings
        particle_systems.append({'object': o.name, 'name': ps.name, 'type': p.type,
            'renderType': p.render_type, 'count': p.count})
        if p.instance_object:
            add_object(p.instance_object, owner_scene)
        if p.instance_collection:
            for child in p.instance_collection.all_objects:
                add_object(child, owner_scene)


def add_scene(s, include_compositor=False):
    if s.name in scene_seen:
        return
    scene_seen.add(s.name)
    for o in s.objects:
        add_object(o, s.name)
    if s.world and s.world.node_tree:
        root_trees.add(add_tree(s.world.node_tree, 'shader'))
    compositor = getattr(s, 'compositing_node_group', None) or getattr(s, 'node_tree', None)
    if include_compositor and compositor and getattr(s, 'use_nodes', True):
        root_trees.add(add_tree(compositor, 'compositor'))


def update_roots():
    roots.clear()
    for t in sorted(root_trees):
        for n, item in trees[t]['nodes'].items():
            if item['id'] in {'ShaderNodeOutputMaterial', 'ShaderNodeOutputWorld',
                              'CompositorNodeComposite', 'NodeGroupOutput'} and item.get('activeOutput', True):
                roots.append({'tree': t, 'node': n})


add_scene(scene, True)
graph = {'trees': trees, 'roots': roots}
while True:
    update_roots()
    dependencies = {trees[t]['nodes'][n].get('renderScene') for t, n in reachable(graph)}
    pending = dependencies - scene_seen - {None}
    if not pending:
        break
    for name in sorted(pending):
        add_scene(bpy.data.scenes[name])


def external_record(item, path):
    resolved = Path(bpy.path.abspath(path, library=getattr(item, 'library', None))).resolve()
    inside = resolved.is_relative_to(source.parent.resolve())
    exists = resolved.is_file()
    return {'name': item.name, 'authoredPath': path,
        'relativePath': str(resolved.relative_to(source.parent.resolve())) if inside else None,
        'insideAcquiredSourceRoot': inside, 'exists': exists,
        'bytes': resolved.stat().st_size if inside and exists else None,
        'sha256': digest(resolved) if inside and exists else None}


closure = {'libraries': [external_record(lib, lib.filepath) for lib in bpy.data.libraries],
    'externalImages': [external_record(im, im.filepath) for im in bpy.data.images
                       if not im.packed_file and im.filepath]}
out = {'schemaVersion': 1, 'kind': 'release-scene-source-node-inventory-v1',
    'source': {'fileName': source.name, 'bytes': source.stat().st_size, 'sha256': before},
    'blender': {'version': bpy.app.version_string,
                'buildHash': bpy.app.build_hash.decode()},
    'scene': {'name': scene.name, 'engine': scene.render.engine,
        'frame': scene.frame_current, 'camera': scene.camera.name if scene.camera else None,
        'objects': len(scene.objects)},
    'discoveryProgramSha256': {p.name: digest(p) for p in
        [Path(__file__), Path(__file__).with_name('graph.py')]},
    'sceneDependencies': sorted(scene_seen), 'particleSystems': particle_systems,
    'sourceClosure': closure,
    'discoveryContract': 'Conservative linked reachability from current-scene outputs plus referenced Render Layers scenes, collection/particle instance objects and render-enabled geometry modifiers. All material slots/branches and engine-specific active outputs retained. Collection visibility and evaluated geometry/instances are not evaluated. Not semantic contribution, export acceptance or node support.',
    'materialOwners': owners, 'graph': graph, 'nodeUsage': summarize(graph),
    'texts': {t.name: t.as_string() for t in bpy.data.texts
              if any(k in t.name.lower() for k in ['readme', 'license', 'credit'])},
    'sourceUnchanged': digest(source) == before,
    'renderCalls': 0, 'saveCalls': 0, 'bakeCalls': 0}
assert out['sourceUnchanged']
target = Path(sys.argv[sys.argv.index('--') + 1])
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(out, indent=2, sort_keys=True, allow_nan=False) + '\n')
print('SCENETOWEB_RELEASE_SCENE_INVENTORY', source.name, len(out['nodeUsage']))
