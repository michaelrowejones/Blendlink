# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual native normalized 3D/4D Noise escapes unit range; never silently clamp it."""
import json
import os
from pathlib import Path
import sys
import tempfile
import bpy
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import tsl_ir
from color_ir import _unit_bounded
from noise_varying_ir import unit_roughness
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
engines={item.identifier for item in scene.render.bl_rna.properties['engine'].enum_items}
scene.render.engine='BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
scene.eevee.taa_render_samples=1
scene.render.resolution_x=scene.render.resolution_y=64;scene.render.resolution_percentage=100
scene.render.use_compositing=False;scene.render.dither_intensity=0
scene.view_settings.view_transform='Raw';scene.view_settings.look='None'
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_depth='32';scene.render.image_settings.color_mode='RGBA'
bpy.ops.mesh.primitive_plane_add(size=2)
plane=bpy.context.object
material=bpy.data.materials.new('Normalized 4D HDR proof');material.use_nodes=True;plane.data.materials.append(material)
tree=material.node_tree;tree.nodes.clear()
output=tree.nodes.new('ShaderNodeOutputMaterial');emission=tree.nodes.new('ShaderNodeEmission');tree.links.new(emission.outputs[0],output.inputs['Surface'])
noise=tree.nodes.new('ShaderNodeTexNoise');noise.normalize=True
noise.inputs['Scale'].default_value=1;noise.inputs['Detail'].default_value=0
coordinates=tree.nodes.new('ShaderNodeCombineXYZ')
tree.links.new(coordinates.outputs[0],noise.inputs['Vector'])
add=tree.nodes.new('ShaderNodeMath');add.operation='ADD';add.inputs[1].default_value=.5
tree.links.new(noise.outputs['Fac'],add.inputs[0]);tree.links.new(add.outputs[0],emission.inputs['Color'])
camera_data=bpy.data.cameras.new('Range Camera');camera_data.type='ORTHO';camera_data.ortho_scale=2
camera=bpy.data.objects.new('Range Camera',camera_data);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera
cases=[('negative-3d','3D',[27687.359375,47520.48046875,38070.5],0,(-.006,-.003)),
       ('negative-4d','4D',[58250.5,35498.5,49388.5],58164.5,(-.023,-.02))]
# A distinct legacy transport issue: shader-rounded amplitude sums and its
# JS-double denominator can push an ideal1D peak above1 on SwiftShader.
legacy={'op':'noise','dimensions':1,'detail':6,'roughness':float(np.float32(.063289)),
        'lacunarity':1,'input':{'op':'const_float','value':291.5},'scale':{'op':'const_float','value':1}}
assert not _unit_bounded(legacy) and not unit_roughness(legacy)
assert _unit_bounded({'op':'clamp_minmax','value':legacy,'min':{'op':'const_float','value':0},'max':{'op':'const_float','value':1}})
assert _unit_bounded({**legacy,'op':'noise_normalized','normalize':True,'perlinModel':'native-standard-f32'})
records=[];actuals={}
evidence=os.environ.get('BLENDLINK_NOISE_RANGE_EVIDENCE')
destination=Path(evidence) if evidence else None
if destination:(destination/'ir').mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='blendlink-noise-range-') as directory:
    for identifier,dimensions,point,w,bounds in cases:
        noise.noise_dimensions=dimensions
        if dimensions=='4D':noise.inputs['W'].default_value=w
        for socket,value in zip(coordinates.inputs,point):socket.default_value=value
        original=(len(tree.nodes),len(tree.links),noise.normalize,noise.inputs['Scale'].default_value)
        expression=tsl_ir.emit_output(noise,noise.outputs['Fac'])
        for op in ['noise','noise_normalized','noise_varying']:
            probe={**expression,'op':op,'normalize':True,'roughness':1,'roughnessNode':{'op':'const_float','value':.5}} if op=='noise_varying' else {**expression,'op':op}
            assert not _unit_bounded(probe) and not unit_roughness(probe), (dimensions,op)
            clamped={'op':'clamp_minmax','value':probe,'min':{'op':'const_float','value':0},'max':{'op':'const_float','value':1}}
            assert _unit_bounded(clamped) and unit_roughness(clamped), (dimensions,op)
        assert original==(len(tree.nodes),len(tree.links),noise.normalize,noise.inputs['Scale'].default_value)
        scene.render.filepath=str(Path(directory)/(identifier+'.exr'));bpy.ops.render.render(write_still=True)
        image=bpy.data.images.load(scene.render.filepath,check_existing=False)
        values=np.asarray(image.pixels[:],np.float32).reshape(64,64,4)[...,:3];bpy.data.images.remove(image)
        actual=float(values[32,32,0])-.5;actuals[dimensions]=actual
        assert bounds[0]<actual<bounds[1], (dimensions,actual)
        if destination:
            document=tsl_ir.emit_channel(emission.inputs['Color']);(destination/'ir'/(identifier+'.json')).write_text(json.dumps(document));values.astype('<f4').tofile(destination/(identifier+'.f32'))
            records.append({'id':identifier,'kind':'noise','engine':scene.render.engine,'oracleScale':1})
if destination:
    (destination/'index.json').write_text(json.dumps({'blender':bpy.app.version_string,'buildHash':bpy.app.build_hash.decode(),'gpuBackend':bpy.context.preferences.system.gpu_backend,'size':64,'cases':records}))
print('BLENDLINK_NORMALIZED_NOISE_RANGE_PASSED native=',actuals,'unit claims refused; authored clamp restores range')
