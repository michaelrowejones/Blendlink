# SPDX-License-Identifier: GPL-3.0-or-later
"""Native-only MF coordinate residuals; no production folder in the oracle."""
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
import bpy
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
import bakelib
from mf_coordinate_reference import expression, socket, value
assert bpy.app.version >= (5,0,0), 'Native MF is not available in Blender4.2'
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
engines={item.identifier for item in scene.render.bl_rna.properties['engine'].enum_items}
scene.render.engine='BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
scene.eevee.taa_render_samples=1
proxy=bakelib.uv_tile_proxy([],window=(0,0,1,1))
camera_data=bpy.data.cameras.new('MF arithmetic camera');camera_data.type='ORTHO';camera_data.ortho_scale=2
camera=bpy.data.objects.new(camera_data.name,camera_data);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera
scene.world=None
scene.render.resolution_x=scene.render.resolution_y=8;scene.render.resolution_percentage=100
scene.render.use_compositing=False;scene.render.film_transparent=False;scene.render.dither_intensity=0
scene.view_settings.view_transform='Raw';scene.view_settings.look='None'
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32'
output=Path(os.environ['BLENDLINK_MF_STAGE_EVIDENCE']).resolve();output.mkdir(parents=True,exist_ok=True)
records=[]
with tempfile.TemporaryDirectory(prefix='blendlink-mf-stages-') as temporary:
    for variant in ['cancel-positive','cancel-negative','scalar-multiply','scalar-tie','vector-add-subtract','vector-multiply','vector-scale']:
        material=bpy.data.materials.new(variant);material.use_nodes=True;tree=material.node_tree;tree.nodes.clear()
        source=socket(tree,expression(variant));expected=value(expression(variant));vector=expected.ndim==1
        subtract=tree.nodes.new('ShaderNodeVectorMath' if vector else 'ShaderNodeMath');subtract.operation='SUBTRACT'
        tree.links.new(source,subtract.inputs[0]);subtract.inputs[1].default_value=expected.tolist()
        multiply=tree.nodes.new('ShaderNodeVectorMath' if vector else 'ShaderNodeMath');multiply.operation='SCALE' if vector else 'MULTIPLY'
        tree.links.new(subtract.outputs[0],multiply.inputs[0]);multiply.inputs[3 if vector else 1].default_value=2**20
        add=tree.nodes.new('ShaderNodeVectorMath' if vector else 'ShaderNodeMath');add.operation='ADD'
        tree.links.new(multiply.outputs[0],add.inputs[0]);add.inputs[1].default_value=(.5,.5,.5) if vector else .5
        emission=tree.nodes.new('ShaderNodeEmission');tree.links.new(add.outputs[0],emission.inputs['Color'])
        target=tree.nodes.new('ShaderNodeOutputMaterial');tree.links.new(emission.outputs[0],target.inputs['Surface'])
        graph={'nodes':[{'name':n.name,'type':n.bl_idname,'operation':getattr(n,'operation',None),
            'inputs':[{'identifier':s.identifier,'value':list(s.default_value) if hasattr(s.default_value,'__len__') else s.default_value}
                      for s in n.inputs if hasattr(s,'default_value')],
            'outputs':[{'identifier':s.identifier,'value':list(s.default_value) if hasattr(s.default_value,'__len__') else s.default_value}
                       for s in n.outputs if hasattr(s,'default_value')]} for n in tree.nodes],
            'links':[[l.from_node.name,l.from_socket.identifier,l.to_node.name,l.to_socket.identifier] for l in tree.links]}
        graph_bytes=json.dumps(graph,allow_nan=False).encode();(output/(variant+'.graph.json')).write_bytes(graph_bytes)
        proxy.data.materials.clear();proxy.data.materials.append(material)
        scene.render.filepath=str(Path(temporary)/'stage.exr');bpy.ops.render.render(write_still=True)
        image=bpy.data.images.load(scene.render.filepath,check_existing=False)
        raw=np.asarray(image.pixels[:],np.float32).reshape(8,8,4)[...,:3];bpy.data.images.remove(image)
        assert np.array_equal(raw,np.full_like(raw,.5)),(variant,raw.min(axis=(0,1)),raw.max(axis=(0,1)))
        raw.astype('<f4').tofile(output/(variant+'.f32'))
        records.append({'variant':variant,'expectedFloat32':expected.tolist(),'amplification':2**20,
            'residualMinimum':raw.min(axis=(0,1)).tolist(),'residualMaximum':raw.max(axis=(0,1)).tolist(),
            'graphSha256':hashlib.sha256(graph_bytes).hexdigest(),'nativePixelsSha256':hashlib.sha256(raw.astype('<f4').tobytes()).hexdigest()})
        proxy.data.materials.clear();bpy.data.materials.remove(material)
manifest={'blender':bpy.app.version_string,'nativeBuild':bpy.app.build_hash.decode(),'gpuBackend':bpy.context.preferences.system.gpu_backend,
    'models':['separate-ADD','separate-SUBTRACT','separate-MULTIPLY','vector-Scale'],'controls':records,
    'sourceHashes':{name:hashlib.sha256((Path(__file__).resolve().parent/name).read_bytes()).hexdigest()
        for name in ['probe-mf-coordinate-stages.py','mf_coordinate_reference.py']}}
(output/'index.json').write_text(json.dumps(manifest,indent=2))
print('BLENDLINK_MF_COORDINATE_STAGES_PASSED 7 native residual controls, amplification1048576, all output .5 exactly')
