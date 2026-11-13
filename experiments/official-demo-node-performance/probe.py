"""Read-only real-demo triage; render/export settings apply only in this process.
Run in factory Blender with --disable-autoexec and a private source-file copy.
"""
from __future__ import annotations
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys
import time
import traceback
import bpy


def sha(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def counts(items):
    return dict(sorted(Counter(items).items()))


def default(value):
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    try:
        return [default(item) for item in value]
    except TypeError:
        return getattr(value, 'name', str(type(value)))


def tree_record(tree):
    nodes = list(tree.nodes)
    return {'name': tree.name, 'type': tree.bl_idname, 'nodes': len(nodes), 'links': len(tree.links),
            'classes': counts(node.bl_idname for node in nodes),
            'groups': [{'node': node.name, 'tree': node.node_tree.name} for node in nodes if getattr(node, 'node_tree', None)],
            'controls': [{'node': node.name, 'type': node.bl_idname,
                          'inputs': {socket.identifier: default(socket.default_value) for socket in node.inputs if hasattr(socket, 'default_value') and not socket.is_linked},
                          'properties': {key: default(getattr(node, key)) for key in ('operation', 'data_type', 'noise_dimensions', 'noise_type', 'normalize', 'vector_type', 'depth') if hasattr(node, key)}}
                         for node in nodes if any(token in node.bl_idname for token in ('Repeat', 'Noise', 'Voronoi', 'Magic', 'Radial', 'Mapping'))]}


def expanded(tree, stack=()):
    if tree.as_pointer() in stack:
        return {'nodes': 0, 'depth': len(stack), 'cycle': True}
    children = [expanded(node.node_tree, (*stack, tree.as_pointer())) for node in tree.nodes if getattr(node, 'node_tree', None)]
    return {'nodes': min(10**9, len(tree.nodes) + sum(child['nodes'] for child in children)),
            'depth': max([len(stack)] + [child['depth'] for child in children]), 'cycle': any(child['cycle'] for child in children)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--sdk-root', required=True)
    parser.add_argument('--geometry', action='store_true')
    parser.add_argument('--materials', action='store_true')
    parser.add_argument('--profile-materials', action='store_true')
    parser.add_argument('--render', action='store_true')
    parser.add_argument('--stock-export', action='store_true')
    parser.add_argument('--floor-experiment', action='store_true')
    parser.add_argument('--camera-control', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    output = Path(args.output).resolve(); output.mkdir(parents=True, exist_ok=False)
    source = Path(bpy.data.filepath).resolve(); source_hash = sha(source)
    scene = bpy.context.scene
    report = {'schemaVersion': 1, 'kind': 'official-demo-native-triage-v1', 'source': {'copy': str(source), 'bytes': source.stat().st_size, 'sha256Before': source_hash},
              'native': {'version': list(bpy.app.version), 'versionString': bpy.app.version_string, 'buildHash': bpy.app.build_hash.decode(), 'autoexecEnabled': bpy.context.preferences.filepaths.use_scripts_auto_execute},
              'scene': {'name': scene.name, 'engine': scene.render.engine, 'frame': scene.frame_current, 'frameRange': [scene.frame_start, scene.frame_end], 'resolution': [scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage], 'camera': scene.camera.name if scene.camera else None},
              'proofRole': 'Real authored scene cost/compatibility triage; no browser or visual-fidelity qualification.', 'phases': {}, 'adjustments': []}

    def save():
        report['source']['sha256After'] = sha(source)
        assert report['source']['sha256After'] == source_hash, 'Source copy changed on disk'
        (output / 'report.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')

    def phase(name, action):
        start = time.perf_counter(); record = {'status': 'running'}; report['phases'][name] = record; save()
        try:
            record['result'] = action(); record['status'] = 'passed'
        except Exception as error:
            record.update(status='failed', error=str(error), traceback=traceback.format_exc())
        finally:
            record['elapsedMs'] = (time.perf_counter() - start) * 1000; save()
        return record.get('result')

    trees = []
    for owner in [*bpy.data.materials, *bpy.data.worlds, *bpy.data.scenes]:
        tree = getattr(owner, 'node_tree', None)
        if tree: trees.append(tree)
    trees += list(bpy.data.node_groups)
    trees = list({tree.as_pointer(): tree for tree in trees}.values())
    records = [tree_record(tree) for tree in trees]
    scope = [obj for obj in bpy.context.view_layer.objects if not obj.hide_render]
    report['inventory'] = {'objects': len(bpy.data.objects), 'activeViewLayerObjects': len(scope), 'objectTypes': counts(obj.type for obj in scope),
                           'materials': len(bpy.data.materials), 'loadedUnknownNodeClasses': sorted({node.bl_idname for tree in trees for node in tree.nodes if bpy.types.Node.bl_rna_get_subclass_py(node.bl_idname) is None}), 'images': len(bpy.data.images), 'packedImages': sum(bool(image.packed_file) for image in bpy.data.images),
                           'imageClosure': [{'name': image.name, 'source': image.source, 'packed': bool(image.packed_file), 'filePath': image.filepath, 'resolvedPath': bpy.path.abspath(image.filepath), 'exists': bool(image.filepath and Path(bpy.path.abspath(image.filepath)).is_file())} for image in bpy.data.images],
                           'nodeTrees': len(trees), 'physicalNodes': sum(len(tree.nodes) for tree in trees), 'physicalClasses': counts(node.bl_idname for tree in trees for node in tree.nodes),
                           'trees': records, 'materialExpansionUpperBounds': [{'material': material.name, **expanded(material.node_tree)} for material in bpy.data.materials if material.node_tree],
                           'geometryModifiers': [{'object': obj.name, 'type': modifier.type, 'name': modifier.name, 'viewport': modifier.show_viewport, 'render': modifier.show_render} for obj in scope for modifier in obj.modifiers],
                           'notices': [{'name': text.name, 'text': text.as_string()} for text in bpy.data.texts if any(token in text.name.lower() for token in ('readme', 'license', 'credit'))]}
    save()
    if args.floor_experiment:
        obj = bpy.data.objects.get('Floor')
        assert obj is not None, 'Explicit Cube experiment requires the real Floor object'
        for modifier in obj.modifiers:
            if modifier.type == 'SUBSURF' and modifier.subdivision_type == 'SIMPLE':
                report['adjustments'].append({'role': 'explicit-derivative-experiment', 'object': obj.name, 'modifier': modifier.name, 'originalViewport': modifier.show_viewport, 'originalRender': modifier.show_render, 'levels': modifier.levels, 'renderLevels': modifier.render_levels})
                modifier.show_viewport = False; modifier.show_render = False
        assert report['adjustments'], 'No expected Simple Subdivision modifier found'
    if args.geometry:
        def geometry():
            start = time.perf_counter(); graph = bpy.context.evaluated_depsgraph_get(); graph.update(); dependency_ms = (time.perf_counter() - start) * 1000
            objects = []
            for obj in scope:
                if obj.type != 'MESH': continue
                start = time.perf_counter(); evaluated = obj.evaluated_get(graph)
                try:
                    mesh = evaluated.to_mesh(preserve_all_data_layers=False, depsgraph=graph)
                    mesh.calc_loop_triangles()
                    objects.append({'name': obj.name, 'baseVertices': len(obj.data.vertices), 'basePolygons': len(obj.data.polygons), 'evaluatedVertices': len(mesh.vertices), 'evaluatedTriangles': len(mesh.loop_triangles), 'evaluateMeshMs': (time.perf_counter() - start) * 1000})
                finally: evaluated.to_mesh_clear()
            return {'dependencyGraphMs': dependency_ms, 'meshObjects': len(objects), 'trianglesSumPerObject': sum(obj['evaluatedTriangles'] for obj in objects), 'objectsByTriangles': sorted(objects, key=lambda obj: -obj['evaluatedTriangles']), 'scopeLimit': 'Active view-layer non-hide_render mesh objects; instance multiplicity/curves not included in this triangle sum.'}
        phase('geometry', geometry)
    if args.materials:
        def materials():
            root = Path(args.sdk_root).resolve()
            sys.path[:0] = [str(root / 'packages/blender-addon'), str(root / 'packages/blendlink/blender')]
            import material_compiler
            import procedural
            used = {material.as_pointer(): material for obj in scope if obj.type == 'MESH' for material in obj.data.materials if material is not None}
            stock_diagnostics = [procedural.analyze_material(material) for material in used.values()]
            active_nodes = {node.as_pointer(): node for material in used.values() for node in procedural.reachable_surface_nodes(material.node_tree)}
            report['inventory']['usedMaterialActiveSurfaceClasses'] = counts(node.bl_idname for node in active_nodes.values())
            report['inventory']['usedMaterialActiveSurfaceNodes'] = len(active_nodes)
            profile = None
            if args.profile_materials:
                import cProfile
                profile = cProfile.Profile(); profile.enable()
            plan = material_compiler.plan_materials([obj for obj in scope if obj.type == 'MESH'], purpose='final', automatic_programs=True)
            if profile:
                profile.disable()
                import pstats
                stats = pstats.Stats(profile)
                report['materialProfile'] = {'role': 'Instrumented cold material planner; overhead included, not an ordinary elapsed-time benchmark.', 'calls': stats.total_calls, 'totalSeconds': stats.total_tt, 'topCumulative': [{'file': key[0], 'line': key[1], 'function': key[2], 'primitiveCalls': value[0], 'calls': value[1], 'ownSeconds': value[2], 'cumulativeSeconds': value[3]} for key,value in sorted(stats.stats.items(), key=lambda item: -item[1][3])[:30]]}
            value = plan.as_dict(); (output / 'material-plan.json').write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
            return {'purpose': 'final', 'automaticPrograms': True, 'decisions': len(plan.decisions), 'stockExporterDiagnostics': stock_diagnostics, 'channelRefusals': [{'material': decision.material_name, **channel} for decision in plan.decisions for channel in (decision.channel_plan or {}).get('channels', []) if channel.get('route') == 'refused'], 'outcomes': counts(decision.outcome for decision in plan.decisions), 'transports': counts(decision.transport or 'none' for decision in plan.decisions), 'issueCodes': counts(issue.code for decision in plan.decisions for issue in decision.issues), 'materials': [{'material': decision.material_name, 'outcome': decision.outcome, 'transport': decision.transport, 'issues': [issue.as_dict() for issue in decision.issues]} for decision in plan.decisions]}
        phase('materialPlan', materials)
    if args.stock_export:
        def export():
            path = output / 'stock-control.glb'
            # Explicit current-frame stock control, not a Blendlink Final product.
            result = bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', export_apply=True, export_animations=False, use_visible=True)
            return {'operatorResult': sorted(result), 'bytes': path.stat().st_size, 'sha256': sha(path), 'role': 'Stock glTF geometry/material control only; not a Blendlink Final or fidelity pass.', 'exportAnimations': False, 'exportApply': True}
        phase('stockExport', export)
    if args.render:
        def render():
            previous = {'engine': scene.render.engine, 'resolution': [scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage], 'compositing': scene.render.use_compositing, 'samples': getattr(scene.eevee, 'taa_render_samples', None), 'imageFormat': scene.render.image_settings.file_format, 'mediaType': getattr(scene.render.image_settings, 'media_type', None)}
            scene.render.engine = 'BLENDER_EEVEE_NEXT' if bpy.app.version < (5, 0, 0) else 'BLENDER_EEVEE'
            scene.render.resolution_x = 256; scene.render.resolution_y = 256; scene.render.resolution_percentage = 100
            if not scene.camera:
                if not args.camera_control: raise RuntimeError('Authored scene has no camera; use explicit --camera-control for a generated orthographic cost control')
                from mathutils import Vector
                points = [obj.matrix_world @ Vector(corner) for obj in scope if obj.type == 'MESH' for corner in obj.bound_box]
                assert points, 'No mesh bounds for camera control'
                low = Vector(tuple(min(point[index] for point in points) for index in range(3)))
                high = Vector(tuple(max(point[index] for point in points) for index in range(3)))
                center = (low + high) * .5
                data = bpy.data.cameras.new('RESEARCH_COST_CAMERA'); camera = bpy.data.objects.new('RESEARCH_COST_CAMERA', data); scene.collection.objects.link(camera)
                data.type = 'ORTHO'; data.ortho_scale = max(high.x-low.x, high.y-low.y, 1) * 1.25
                camera.location = center + Vector((0, 0, max(high.z-low.z, 1) * 5)); scene.camera = camera
                report['adjustments'].append({'role': 'explicit-generated-camera-cost-control', 'camera': camera.name, 'location': list(camera.location), 'orthographicScale': data.ortho_scale, 'sourceHadCamera': False})
            for layer in scene.view_layers:
                if layer == bpy.context.view_layer and not layer.use:
                    report['adjustments'].append({'role': 'enable-active-view-layer-cost-control', 'layer': layer.name, 'previousUse': False}); layer.use = True
            if hasattr(scene.eevee, 'taa_render_samples'): scene.eevee.taa_render_samples = 1
            if hasattr(scene.eevee, 'taa_samples'): scene.eevee.taa_samples = 1
            report['adjustments'].append({'role': 'bounded-eevee-cost-control', 'previous': previous, 'effectiveEngine': scene.render.engine, 'resolution': [256, 256, 100], 'samples': getattr(scene.eevee, 'taa_render_samples', None), 'compositing': scene.render.use_compositing, 'savedToSource': False})
            if hasattr(scene.render.image_settings, 'media_type'): scene.render.image_settings.media_type = 'IMAGE'
            scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGBA'; scene.render.image_settings.color_depth = '8'
            path = output / 'controlled-eevee.png'; scene.render.filepath = str(path)
            start = time.perf_counter(); bpy.ops.render.render(write_still=True); operator_ms = (time.perf_counter()-start)*1000
            import gpu
            profile = {'requestedBackend': bpy.context.preferences.system.gpu_backend}
            for label, getter in [('renderer','renderer_get'),('vendor','vendor_get'),('version','version_get'),('backend','backend_type_get')]:
                try: profile[label] = getattr(gpu.platform, getter)()
                except Exception as error: profile[label] = {'unavailable': str(error)}
            image = bpy.data.images.load(str(path), check_existing=False)
            try:
                values = list(image.pixels); rgb = [value for index, value in enumerate(values) if index % 4 != 3]
                pixels = {'width': image.size[0], 'height': image.size[1], 'minimum': min(rgb), 'maximum': max(rgb), 'mean': sum(rgb)/len(rgb)}
            finally: bpy.data.images.remove(image)
            return {'bytes': path.stat().st_size, 'sha256': sha(path), 'pixels': pixels, 'renderOperatorMs': operator_ms, 'gpuProfile': profile, 'role': 'Controlled native render/cost observation; no web parity threshold or authored full-resolution timing.'}
        phase('controlledRender', render)
    save()
    print('BLENDLINK_OFFICIAL_DEMO_PROBE', json.dumps({'output': str(output), 'version': report['native']['version'], 'phases': {name: value['status'] for name, value in report['phases'].items()}}))


if __name__ == '__main__': main()
