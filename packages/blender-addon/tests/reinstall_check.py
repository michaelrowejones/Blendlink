# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual (requires a staged extension archive and isolated user resources; invoked by test-addon-headless.mjs)
"""Real same-process extension reinstall, including unchanged manifest versions."""
import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import tomllib
import zipfile

import addon_utils
import bpy

parser = argparse.ArgumentParser()
parser.add_argument('--archive', type=Path, required=True)
parser.add_argument('--work', type=Path, required=True)
parser.add_argument('--previous', type=Path, action='append', default=[])
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
work = args.work.resolve()
resources = Path(os.environ.get('BLENDER_USER_RESOURCES', '')).resolve()
assert os.environ.get('BLENDER_USER_RESOURCES') and resources.is_relative_to(work.parent), \
    'Reinstall checks require explicit isolated Blender resources beside the test workspace'
work.mkdir(parents=True, exist_ok=True)
archive = args.archive.resolve()
package = 'bl_ext.user_default.blendlink'
rows, owned_processes = [], []


def manifest(path):
    with zipfile.ZipFile(path) as bundle:
        return tomllib.loads(bundle.read('blender_manifest.toml').decode())


def canary(path, token):
    """Same version, byte length and ZIP timestamp; exercise the real allocator.

    No modified archive is published. Changing an exported helper's behavior
    catches both an old bare-module cache and timestamp/size-based pyc reuse.
    """
    with zipfile.ZipFile(archive) as source, zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            data = source.read(info.filename)
            if info.filename == 'uvgeometry.py':
                data += ("\n_reinstall_original_allocate = allocate_receiver_rectangles\n"
                         "def allocate_receiver_rectangles(*args, **kwargs):\n"
                         "    result = _reinstall_original_allocate(*args, **kwargs)\n"
                         "    result['_blendlink_reinstall_probe'] = '" + token + "'\n"
                         "    return result\n").encode()
            target.writestr(info, data)
    assert manifest(path) == manifest(archive)


def module(name):
    return importlib.import_module(package + '.' + name)


def handlers():
    return [callback for name in dir(bpy.app.handlers)
            if isinstance(getattr(bpy.app.handlers, name), list)
            for callback in getattr(bpy.app.handlers, name)
            if getattr(callback, '__module__', '').startswith(package + '.')]


def install(path):
    print('BLENDLINK_REINSTALL_INSTALL', path.name, flush=True)
    result = bpy.ops.extensions.package_install_files(
        filepath=str(path), repo='user_default', enable_on_install=True,
    )
    assert result == {'FINISHED'}, result
    current = importlib.import_module(package)
    assert addon_utils.check(package) == (True, True)
    assert all(cls.is_registered for cls in current._classes)
    for name in ('tsl_ir', 'compositor_graph', 'native_color_band', 'noise_static_inputs',
                 'shader_domains', 'curves_ir', 'spectral_ir', 'geometry_ir', 'normal_ir', 'bootstrap'):
        if Path(current.__file__).with_name(name + '.py').is_file():
            module(name)
    for name in dir(bpy.app.handlers):
        callbacks = getattr(bpy.app.handlers, name)
        if isinstance(callbacks, list):
            assert len(callbacks) == len(set(callbacks)), name + ' contains duplicate callbacks'
    return current


def arm_cleanup():
    callbacks = [module('handlers')._tick, module('previewrun')._pump, module('syncrun')._pump]
    node = os.environ.get('BLENDLINK_REINSTALL_NODE')
    children = []
    if node:
        assert Path(node).is_file()
        for name in ('previewrun', 'syncrun'):
            runner = module(name)
            ready = work / (name + '-ready')
            ready.unlink(missing_ok=True)
            code = "require('node:fs').writeFileSync(process.argv[1], 'ready');setInterval(()=>{},1000)"
            assert runner.start([node, '-e', code, str(ready)], str(work)) is None
            process = runner._state['process']
            owned_processes.append(process)
            children.append(process)
            deadline = time.monotonic() + 10
            while not ready.exists() and time.monotonic() < deadline:
                assert process.poll() is None, 'Owned runner child exited before reinstall'
                time.sleep(.02)
            assert ready.exists(), 'Owned runner child did not start'
    # Background Blender omits UI pump timers. Enroll the actual callbacks with
    # the real timer API to exercise the same uninstall ownership path.
    for callback in callbacks:
        if not bpy.app.timers.is_registered(callback):
            bpy.app.timers.register(callback, first_interval=60, persistent=True)
    overlay = module('overlay')
    for key, callback, stage in (('view', overlay._draw_view, 'POST_VIEW'), ('pixel', overlay._draw_pixel, 'POST_PIXEL')):
        if overlay._handles[key] is None:
            overlay._handles[key] = bpy.types.SpaceView3D.draw_handler_add(callback, (), 'WINDOW', stage)
    bpy.app.driver_namespace[overlay._DRIVER_NAMESPACE_KEY] = dict(overlay._handles)
    return callbacks, children


def check_cleanup(previous, callbacks, children, old_handlers):
    assert not any(bpy.app.timers.is_registered(callback) for callback in callbacks)
    assert not any(callback in handlers() for callback in old_handlers)
    assert all(not cls.is_registered for cls in previous._classes)
    assert all(handle is None for handle in previous.overlay._handles.values())
    assert previous.overlay._DRIVER_NAMESPACE_KEY not in bpy.app.driver_namespace
    for process in children:
        process.wait(timeout=10)
    assert len(handlers()) == len(old_handlers), 'Persistent handlers accumulated or disappeared'


def scene_signature():
    return {
        'scene': bpy.context.scene.as_pointer(), 'object': owner.as_pointer(),
        'dirty': bpy.data.is_dirty, 'frame': bpy.context.scene.frame_current,
        'selected': [obj.name for obj in bpy.context.selected_objects],
        'active': bpy.context.view_layer.objects.active.as_pointer() if bpy.context.view_layer.objects.active else None,
        'objectLocation': list(owner.location), 'objectCustom': owner['artist_intent'].to_dict(),
        'recipe': bpy.context.scene['blendlink_recipe'],
        'previewSamples': bpy.context.scene.blendlink_project.preview_samples,
        'material': material.as_pointer(),
        'nodes': [(node.name, node.bl_idname) for node in material.node_tree.nodes],
        'links': [(link.from_node.name, link.from_socket.identifier, link.to_node.name, link.to_socket.identifier)
                  for link in material.node_tree.links],
        'noiseScale': noise.inputs['Scale'].default_value,
    }


try:
    current = install(args.previous[0].resolve() if args.previous else archive)
    scene = bpy.context.scene
    mesh = bpy.data.meshes.new('Artist Mesh')
    mesh.from_pydata([(0, 0, 0), (1, 0, 0), (0, 1, 0)], [], [(0, 1, 2)])
    owner = bpy.data.objects.new('Artist Scene Object', mesh)
    scene.collection.objects.link(owner)
    owner['artist_intent'] = {'purpose': 'keep authored scene', 'weight': .375}
    scene.blendlink_project.preview_samples = 37
    module('props').write_recipe(scene)
    material = bpy.data.materials.new('Artist Material')
    material.use_nodes = True
    owner.data.materials.append(material)
    noise = material.node_tree.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 3.5
    principled = next(node for node in material.node_tree.nodes if node.bl_idname == 'ShaderNodeBsdfPrincipled')
    material.node_tree.links.new(noise.outputs['Color'], principled.inputs['Base Color'])
    preferences = bpy.context.preferences.addons[package].preferences
    preferences.category = 'Artist Tools'
    preferences.overlay_xray = True
    preferences.preview_package = str(work / 'Local Compiler')
    scene_file = work / 'Saved Artist Scene.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(scene_file))
    saved_hash = hashlib.sha256(scene_file.read_bytes()).hexdigest()
    owner.location.x = 2.5  # An unsaved artist edit must also survive.
    before = scene_signature()
    first, second = work / 'canary-old.zip', work / 'canary-new.zip'
    canary(first, 'old')
    canary(second, 'new')
    with zipfile.ZipFile(first) as a, zipfile.ZipFile(second) as b:
        assert a.getinfo('uvgeometry.py').file_size == b.getinfo('uvgeometry.py').file_size
        assert a.getinfo('uvgeometry.py').date_time == b.getinfo('uvgeometry.py').date_time
    chain = [(path.resolve(), None) for path in args.previous[1:]] + [
        (archive, None), (archive, None), (first, 'old'), (second, 'new'), (archive, None),
    ]
    for path, expected_token in chain:
        previous = current
        old_modules = {name: loaded for name, loaded in sys.modules.copy().items()
                       if name == package or name.startswith(package + '.')}
        old_handlers = handlers()
        callbacks, children = arm_cleanup()
        module('syncstatus')._state['status'] = 'IN_SYNC'
        current = install(path)
        check_cleanup(previous, callbacks, children, old_handlers)
        assert current is not previous
        for name in old_modules:
            # Lazy helper imports must also resolve to the new generation.
            if name != package and Path(current.__file__).with_name(name.rsplit('.', 1)[-1] + '.py').is_file():
                importlib.import_module(name)
        assert not any(sys.modules.get(name) is loaded for name, loaded in old_modules.items())
        assert module('syncstatus').status()[0] == 'CHECKING', 'Old website status cache survived reinstall'
        preferences = bpy.context.preferences.addons[package].preferences
        assert (preferences.category, preferences.overlay_xray, preferences.preview_package) == \
            ('Artist Tools', True, str(work / 'Local Compiler'))
        assert scene_signature() == before, 'Saved or unsaved source scene changed during reinstall'
        assert hashlib.sha256(scene_file.read_bytes()).hexdigest() == saved_hash
        bakelib = module('bakelib_loader').bakelib
        result = bakelib.allocate_receiver_rectangles([('proof', .25, .5)], edge_gutter=0, receiver_gutter=0)
        assert result.get('_blendlink_reinstall_probe') == expected_token, \
            ('Reinstall executed a stale geometry helper', path.name, result.get('_blendlink_reinstall_probe'), expected_token)
        rows.append({'archive': path.name, 'archiveSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                     'version': manifest(path)['version'], 'sourceSha256': saved_hash,
                     'moduleGenerationReplaced': len(old_modules), 'handlers': len(handlers()),
                     'timersRemoved': len(callbacks), 'drawHandlersRemoved': 2, 'childrenStopped': len(children), 'helperToken': expected_token,
                     'helperModule': bakelib.allocate_receiver_rectangles.__module__})

    previous = current
    callbacks, children = arm_cleanup()
    old_handlers = handlers()
    addon_utils.disable(package, default_set=True)
    assert not handlers()
    assert all(handle is None for handle in previous.overlay._handles.values())
    assert previous.overlay._DRIVER_NAMESPACE_KEY not in bpy.app.driver_namespace
    assert all(not cls.is_registered for cls in previous._classes)
    assert not hasattr(bpy.types.Scene, 'blendlink_project')
    assert not any(bpy.app.timers.is_registered(callback) for callback in callbacks)
    for process in children:
        process.wait(timeout=10)
    assert addon_utils.enable(package, default_set=True) is not None
    assert len(handlers()) == len(old_handlers)
    assert all(cls.is_registered for cls in current._classes)
    assert scene_signature() == before
    module('syncstatus')._local_provenance_root = lambda: work / 'local-provenance'
    module('syncstatus').refresh(force=True)
    assert module('syncstatus').status()[0] == 'NO_MANIFEST'
    assert hashlib.sha256(scene_file.read_bytes()).hexdigest() == saved_hash
    print('BLENDLINK_ADDON_REINSTALL_PASSED ' + json.dumps({
        'blender': bpy.app.version_string, 'rows': rows,
        'disabledCleanly': True, 'reenabledCleanly': True, 'freshStatus': module('syncstatus').status()[0],
    }), flush=True)
finally:
    # A failed assertion must not leave an owned test process behind.
    for process in owned_processes:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)
