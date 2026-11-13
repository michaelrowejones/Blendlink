# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual legacy HSV sockets/source lowering; unavailable is not a modern alias."""
# blendlink-headless-sentinel: BLENDLINK_LEGACY_HSV_SOURCE_CONTRACT_PASSED
from pathlib import Path
import os
import sys
from types import SimpleNamespace
import bpy
ADDON=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ADDON));sys.path.insert(0,str(ADDON.parent/'blendlink/blender'))
import tsl_ir
import color_ir
from engine_fallback import channel_engine_difference
identifiers=['ShaderNodeCombineHSV','ShaderNodeSeparateHSV']
if bpy.app.version != (4,2,0):
    assert bpy.app.version in {(5,2,0),(5,3,0)}
    for identifier in identifiers:
        assert not hasattr(bpy.types,identifier), identifier
    print('BLENDLINK_LEGACY_SHADER_HSV_UNAVAILABLE ' + bpy.app.version_string)
else:
    material=bpy.data.materials.new('Actual legacy HSV');material.use_nodes=True
    tree=material.node_tree;tree.nodes.clear()
    combine=tree.nodes.new(identifiers[0]);separate=tree.nodes.new(identifiers[1])
    assert [s.identifier for s in combine.inputs]==['H','S','V']
    assert [s.identifier for s in separate.outputs]==['H','S','V']
    assert len(combine.outputs)==len(separate.inputs)==1
    for index,value in enumerate([.125,.75,.625]):combine.inputs[index].default_value=value
    separate.inputs[0].default_value=(.25,.5,.75,.125)
    def fingerprint():
        return (len(tree.nodes),len(tree.links),len(bpy.data.node_groups),
                [tuple(float(v) for v in socket.default_value) if socket.type=='RGBA' else float(socket.default_value)
                 for node in [combine,separate] for socket in node.inputs])
    before=fingerprint()
    with tsl_ir.emission_context(evaluation_engine='EEVEE'):
        combined=tsl_ir.emit_output(combine,combine.outputs[0])
        assert combined['op']=='color_convert' and combined['mode']=='HSV' and combined['direction']=='combine'
        assert combined['model']=='eevee-gpu' and combined['sourceEngine']=='EEVEE'
        assert [combined['input'][key]['value'] for key in ['x','y','z']]==[.125,.75,.625]
        for index,socket in enumerate(separate.outputs):
            split=tsl_ir.emit_output(separate,socket)
            assert split['op']=='separate' and split['channel']==['x','y','z'][index]
            assert split['input']['mode']=='HSV' and split['input']['direction']=='separate'
            assert split['input']['input']['value']==[.25,.5,.75]
    assert before==fingerprint()
    for node in [combine,separate]:
        with tsl_ir.emission_context(evaluation_engine='CYCLES'):
            try:tsl_ir.emit_output(node,node.outputs[0]);raise AssertionError('Cycles legacy HSV silently became live')
            except tsl_ir.TslIrRefusal as error:assert 'EEVEE only' in str(error)
    real_bpy=color_ir.bpy
    try:
        for version in [(4,2,1),(4,3,0),(5,0,0),(5,2,0),(5,3,0)]:
            color_ir.bpy=SimpleNamespace(app=SimpleNamespace(version=version))
            try:
                color_ir.emit_color_conversion(combine,combine.outputs[0],emit_input=lambda s: {},
                    refuse=tsl_ir._refuse,evaluation_engine='EEVEE')
                raise AssertionError('Unknown legacy source version admitted')
            except tsl_ir.TslIrRefusal as error:assert 'measured Blender 4.2.0' in str(error)
    finally:color_ir.bpy=real_bpy
    root=SimpleNamespace(inputs={'Base Color':object()})
    for node in [combine,separate]:
        reason=channel_engine_difference(root,'Base Color','EEVEE','CYCLES',lambda s:[(node,node.outputs[0])])
        assert node.bl_idname in reason and 'cannot automatically switch' in reason
    assert before==fingerprint()
    # The automatic artist route must actually ship the emitted program,
    # rather than merely accepting a low-level emitter call.
    import material_compiler as compiler
    bpy.context.scene.render.engine='BLENDER_EEVEE_NEXT'
    mesh=bpy.data.meshes.new('Legacy HSV actual owner');mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)]);mesh.update()
    uv=mesh.uv_layers.new(name='Authored legacy HSV UV')
    for item,value in zip(uv.data,[(0,0),(1,0),(0,1)]):item.uv=value
    owner=bpy.data.objects.new('Legacy HSV owner',mesh);bpy.context.scene.collection.objects.link(owner);mesh.materials.append(material)
    surface=tree.nodes.new('ShaderNodeBsdfPrincipled');sink=tree.nodes.new('ShaderNodeOutputMaterial');tree.links.new(surface.outputs[0],sink.inputs['Surface'])
    for node in [combine,separate]:
        tree.links.new(node.outputs[0],surface.inputs['Base Color'])
        planned=compiler.plan_materials([owner],purpose='final',automatic_programs=True)
        assert not planned.errors,planned.as_dict()
        channel=next(item for item in planned.decisions[0].channel_plan['channels']if item['channel']=='Base Color')
        assert channel['route']=='program' and 'color_convert' in str(channel['tslIr']),planned.as_dict()
    bpy.context.scene.render.engine='CYCLES';compiler.set_material_bake(material,True)
    for node in [combine,separate]:
        tree.links.new(node.outputs[0],surface.inputs['Base Color'])
        planned=compiler.plan_materials([owner],purpose='final',automatic_programs=True)
        assert not planned.errors,planned.as_dict()
        channel=next(item for item in planned.decisions[0].channel_plan['channels']if item['channel']=='Base Color')
        assert channel['route']=='bake' and 'tslIr' not in channel,planned.as_dict()
    compiler.set_material_bake(material,False)
    if os.environ.get('BLENDLINK_HSV_PACKAGED_ADDON'):
        import importlib.util
        import tempfile
        import zipfile
        source=Path(os.environ['BLENDLINK_HSV_PACKAGED_ADDON']).resolve()
        with tempfile.TemporaryDirectory(prefix='blendlink-legacy-hsv-installed-')as temporary:
            root=Path(temporary);archive=root/'addon.zip';installed=root/'isolated_hsv_addon'
            with zipfile.ZipFile(archive,'w')as bundle:
                for path in source.rglob('*'):
                    if path.is_file()and '__pycache__'not in path.parts:bundle.write(path,path.relative_to(source))
            with zipfile.ZipFile(archive)as bundle:bundle.extractall(installed)
            spec=importlib.util.spec_from_file_location('isolated_hsv_addon',installed/'__init__.py',submodule_search_locations=[str(installed)])
            package=importlib.util.module_from_spec(spec);sys.modules[spec.name]=package;spec.loader.exec_module(package)
            packaged=__import__('isolated_hsv_addon.tsl_ir',fromlist=['emit_channel'])
            assert Path(packaged.__file__).resolve().is_relative_to(installed.resolve())
            bpy.context.scene.render.engine='BLENDER_EEVEE_NEXT'
            for node in [combine,separate]:
                tree.links.new(node.outputs[0],surface.inputs['Base Color'])
                assert packaged.emit_channel(surface.inputs['Base Color'])==tsl_ir.emit_channel(surface.inputs['Base Color'])
                planned=package.material_compiler.plan_materials([owner],purpose='final',automatic_programs=True)
                assert not planned.errors,planned.as_dict()
                channel=next(item for item in planned.decisions[0].channel_plan['channels']if item['channel']=='Base Color')
                assert channel['route']=='program'and 'color_convert'in str(channel['tslIr'])
            print('BLENDLINK_LEGACY_HSV_PACKAGED_ZIP_PASSED')
    bpy.data.objects.remove(owner,do_unlink=True);bpy.data.meshes.remove(mesh)
    bpy.data.materials.remove(material,do_unlink=True)
    print('BLENDLINK_LEGACY_SHADER_HSV_PASSED EEVEE4.2 actual H/S/V sockets, no alpha, source/version/engine guards')

# This is an availability/admission contract, not modern legacy numerical coverage.
print('BLENDLINK_LEGACY_HSV_SOURCE_CONTRACT_PASSED ' + bpy.app.version_string)
