# SPDX-License-Identifier: GPL-3.0-or-later
"""Native Magic extraction, exact controls and actual-owner admission."""
from pathlib import Path
import json
import os
import sys
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'blendlink/blender'))
import tsl_ir
import magic_bounds
import magic_ir
import material_compiler as compiler

bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT' if bpy.app.version<(5,0) else 'BLENDER_EEVEE'
mesh=bpy.data.meshes.new('Actual Magic mesh');mesh.from_pydata([(-1,-1,0),(1,-1,0),(0,1,0)],[],[(0,1,2)]);mesh.update()
uv=mesh.uv_layers.new(name='Authored Magic UV')
for item,value in zip(uv.data,[(0,0),(1,0),(.5,1)]):item.uv=value
owner=bpy.data.objects.new('Magic owner',mesh);scene.collection.objects.link(owner)
material=bpy.data.materials.new('Native EEVEE Magic');material.use_nodes=True;mesh.materials.append(material)
tree=material.node_tree;surface=next(node for node in tree.nodes if node.bl_idname=='ShaderNodeBsdfPrincipled')
magic=tree.nodes.new('ShaderNodeTexMagic');tree.links.new(magic.outputs['Color'],surface.inputs['Base Color'])
def emit():return tsl_ir.emit_channel(surface.inputs['Base Color'])
def refused(phrase):
    try:emit()
    except tsl_ir.TslIrRefusal as error:assert any(item in str(error) for item in ((phrase,) if isinstance(phrase,str) else phrase)),str(error)
    else:raise AssertionError('Unproved Magic domain silently admitted: '+phrase)
def plan():return compiler.plan_materials([owner],purpose='final',automatic_programs=True)
before=(len(tree.nodes),len(tree.links),len(bpy.data.images),len(bpy.data.node_groups))
for depth in range(11):
    magic.turbulence_depth=depth
    for output in ['Color','Fac']:
        tree.links.new(next(socket for socket in magic.outputs if socket.identifier==output),surface.inputs['Base Color'])
        expression=emit()['output'];assert expression['op']=='tex_magic_native' and expression['depth']==depth
        assert expression['nativeVersion']==list(bpy.app.version),expression
        magic_bounds.validate_owner(owner,expression)
        json.dumps(expression,allow_nan=False)
assert before==(len(tree.nodes),len(tree.links),len(bpy.data.images),len(bpy.data.node_groups))
original_version=magic_ir._source_version
try:
    for unknown in [(4,2,1),(5,0,0),(5,1,0),(5,2,1),(5,3,1),(6,0,0)]:
        magic_ir._source_version=lambda:unknown
        refused('this source version has no qualified precision model')
finally:magic_ir._source_version=original_version
assert before==(len(tree.nodes),len(tree.links),len(bpy.data.images),len(bpy.data.node_groups))
magic.turbulence_depth=2;tree.links.new(magic.outputs['Color'],surface.inputs['Base Color'])
result=plan();assert not result.errors,result.as_dict()
assert any('tslIr' in channel for channel in result.decisions[0].channel_plan['channels'])
coordinate=tree.nodes.new('ShaderNodeTexCoord');tree.links.new(coordinate.outputs['UV'],magic.inputs['Vector'])
assert not plan().errors
uv.data[0].uv=(100,0);mesh.update()
result=plan()
assert any(issue.code=='material.magic-coordinate-domain-unproven' for issue in result.decisions[0].issues),result.as_dict()
assert not any('tslIr' in channel and 'tex_magic_native' in json.dumps(channel['tslIr']) for channel in result.decisions[0].channel_plan['channels'])
uv.data[0].uv=(0,0);mesh.update();assert not plan().errors
for name,value,phrase in [('Scale',9,'scale requires'),('Distortion',.125,'nonzero Distortion'),('Distortion',-1,'nonzero Distortion')]:
    old=magic.inputs[name].default_value;magic.inputs[name].default_value=value;refused(phrase);magic.inputs[name].default_value=old
magic.inputs['Distortion'].default_value=-1
result=plan();assert any(issue.code=='material.automatic-fallback-engine-unproven' and 'ShaderNodeTexMagic' in issue.problem for issue in result.errors),result.as_dict()
magic.inputs['Distortion'].default_value=1
separate=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(coordinate.outputs['UV'],separate.inputs[0])
clamp=tree.nodes.new('ShaderNodeClamp');clamp.inputs['Min'].default_value=.25;clamp.inputs['Max'].default_value=1
tree.links.new(separate.outputs[0],clamp.inputs['Value']);tree.links.new(clamp.outputs[0],magic.inputs['Distortion'])
assert emit()['output']['distortion']['op']=='clamp_minmax'
add=tree.nodes.new('ShaderNodeMath');add.operation='ADD';add.inputs[0].default_value=1e8;add.inputs[1].default_value=1
subtract=tree.nodes.new('ShaderNodeMath');subtract.operation='SUBTRACT';tree.links.new(add.outputs[0],subtract.inputs[0]);subtract.inputs[1].default_value=1e8
tree.links.new(subtract.outputs[0],clamp.inputs['Value']);refused('portable exact constant arithmetic')
tree.links.remove(magic.inputs['Distortion'].links[0])
image=bpy.data.images.new('Actual float data coordinates',width=1,height=1,float_buffer=True,alpha=True);image.use_half_precision=False;image.colorspace_settings.name='Non-Color';image.pixels[:]=[.25,.5,.75,1]
texture=tree.nodes.new('ShaderNodeTexImage');texture.image=image;texture.interpolation='Closest';tree.links.new(texture.outputs['Color'],magic.inputs['Vector'])
assert emit()['output']['sourceSamples']=='native-float-data-v1'
for property,value,phrase in [('use_half_precision',True,'qualified direct opaque nearest float data'),('alpha_mode','PREMUL','Image alpha mode')]:
    old=getattr(image,property);setattr(image,property,value);refused(phrase);setattr(image,property,old)
image.colorspace_settings.name='sRGB';refused(('qualified direct opaque nearest float data','Float-buffer sRGB image'));image.colorspace_settings.name='Non-Color'
image.pixels[:]=[.25,.5,.75,.5];refused('qualified direct opaque nearest float data')
image.pixels[:]=[.25,.5,.75,1]
try:tsl_ir.emit_channel(surface.inputs['Base Color'],evaluation_engine='CYCLES')
except tsl_ir.TslIrRefusal as error:assert 'requires EEVEE' in str(error)
else:raise AssertionError('Fresh EEVEE Magic silently emitted for Cycles')
if os.environ.get('BLENDLINK_MAGIC_PACKAGED_ADDON'):
    import importlib.util
    import tempfile
    import zipfile
    source=Path(os.environ['BLENDLINK_MAGIC_PACKAGED_ADDON']).resolve()
    with tempfile.TemporaryDirectory(prefix='blendlink-magic-installed-') as temporary:
        root=Path(temporary);archive=root/'blendlink.zip';installed=root/'isolated_magic_addon'
        with zipfile.ZipFile(archive,'w') as bundle:
            for path in source.rglob('*'):
                if path.is_file() and '__pycache__' not in path.parts:bundle.write(path,path.relative_to(source))
        with zipfile.ZipFile(archive) as bundle:bundle.extractall(installed)
        for name in ['magic_ir.py','magic_bounds.py','normal_noise_bounds.py','noise_static_inputs.py']:assert (installed/name).is_file(),name
        spec=importlib.util.spec_from_file_location('isolated_magic_addon',installed/'__init__.py',submodule_search_locations=[str(installed)])
        package=importlib.util.module_from_spec(spec);sys.modules[spec.name]=package;spec.loader.exec_module(package)
        packaged=__import__('isolated_magic_addon.tsl_ir',fromlist=['emit_channel'])
        assert Path(packaged.__file__).resolve().is_relative_to(installed.resolve()),packaged.__file__
        document=packaged.emit_channel(surface.inputs['Base Color']);assert document==emit(),document
        plan_module=__import__('isolated_magic_addon.material_compiler',fromlist=['plan_materials'])
        result=plan_module.plan_materials([owner],purpose='final',automatic_programs=True)
        assert not result.errors,result.as_dict()
        print('BLENDLINK_MAGIC_PACKAGED_ZIP_PASSED')
print('BLENDLINK_MAGIC_TRANSLATION_CHECK_PASSED '+bpy.app.version_string)
