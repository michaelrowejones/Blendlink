# SPDX-License-Identifier: GPL-3.0-or-later
"""Native source-node observer setup; no shader implementation is copied."""
import hashlib, json, time
from pathlib import Path
import bpy
from mathutils import Vector

def prepare_native(owner,scene,material,metadata,contract,out,source_camera=None,render=False):
    scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=contract['samples']
    scene.render.resolution_x,scene.render.resolution_y=contract['dimensions'];scene.render.resolution_percentage=100
    scene.render.use_compositing=False;scene.render.use_sequencer=False;scene.render.film_transparent=False;scene.render.dither_intensity=0
    scene.render.use_high_quality_normals=False
    scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32';scene.render.image_settings.exr_codec='NONE'
    scene.view_settings.view_transform='Raw';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
    scene.world=bpy.data.worlds.new('Owned field black World');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=0
    if source_camera is not None:
        camera=bpy.data.objects.new('Owned source camera',source_camera.data.copy());camera.matrix_world=source_camera.matrix_world.copy()
    else:
        data=bpy.data.cameras.new('Owned field camera');data.type='ORTHO';data.ortho_scale=4;data.clip_start=.1;data.clip_end=30
        camera=bpy.data.objects.new('Owned field camera',data)
        center=owner.matrix_world@Vector((.25,.25,.25));direction=Vector((1.3,-1.7,1.1)).normalized()
        camera.matrix_world=direction.to_track_quat('Z','Y').to_matrix().to_4x4();camera.matrix_world.translation=center+direction*5
    scene.collection.objects.link(camera);scene.camera=camera;bpy.context.view_layer.update()
    t=material.node_tree;t.nodes.clear();output=t.nodes.new('ShaderNodeOutputMaterial');output.target='EEVEE'
    emit=t.nodes.new('ShaderNodeEmission');emit.inputs['Strength'].default_value=1;t.links.new(emit.outputs[0],output.inputs['Surface'])
    nm=t.nodes.new('ShaderNodeNormalMap');nm.space='TANGENT';nm.convention='OPENGL';nm.base='ORIGINAL';nm.uv_map=next(u.name for u in owner.data.uv_layers if u.active_render);nm.inputs['Strength'].default_value=1
    scale=t.nodes.new('ShaderNodeVectorMath');scale.operation='SCALE';scale.inputs['Scale'].default_value=.5
    bias=t.nodes.new('ShaderNodeVectorMath');bias.operation='ADD';bias.inputs[1].default_value=(.5,.5,.5);t.links.new(scale.outputs['Vector'],bias.inputs[0])
    geo=t.nodes.new('ShaderNodeNewGeometry');tc=t.nodes.new('ShaderNodeTexCoord');split=t.nodes.new('ShaderNodeSeparateXYZ');combine=t.nodes.new('ShaderNodeCombineXYZ');combine.inputs['Z'].default_value=0
    t.links.new(tc.outputs['Window'],split.inputs[0]);t.links.new(split.outputs['X'],combine.inputs['X']);t.links.new(split.outputs['Y'],combine.inputs['Y'])
    white=t.nodes.new('ShaderNodeRGB');white.outputs[0].default_value=(1,1,1,1)
    normal_matrix=owner.matrix_world.to_3x3().inverted().transposed()
    metadata['frame']={'basis':'blender-z-up','modelMatrix':[list(row) for row in owner.matrix_world],'normalMatrix':[list(row) for row in normal_matrix],'negativeObjectScale':owner.matrix_world.to_3x3().determinant()<0,'camera':{'type':camera.data.type,'matrix':[list(row) for row in camera.matrix_world],'near':camera.data.clip_start,'far':camera.data.clip_end,'viewFrame':[list(v) for v in camera.data.view_frame(scene=scene)]},'normalMap':{'space':nm.space,'convention':nm.convention,'base':nm.base,'uvMap':nm.uv_map,'strength':nm.inputs['Strength'].default_value,'displacementLinked':output.inputs['Displacement'].is_linked,'materialBackfaceCulling':material.use_backface_culling},'dimensions':contract['dimensions'],'normalStorage':'SNORM10','sceneHighQualityNormals':scene.render.use_high_quality_normals,'gpuQualityWorkaround':'Source-pinned Metal default false; no fit-based quality selection. Actual GPU identity and normal control remain required.','probes':[],'rows':[]}
    assert not output.inputs['Displacement'].is_linked
    for probe in contract['probes']:
        nm.inputs['Color'].default_value=(*probe['rgb'],1)
        metadata['frame']['probes'].append({'id':probe['id'],'rgb':list(nm.inputs['Color'].default_value[:3])})
    if render:
        import numpy as np
        import gpu
        gpu.init();identity={'backend':gpu.platform.backend_type_get(),'vendor':gpu.platform.vendor_get(),'renderer':gpu.platform.renderer_get()};assert identity['backend']=='METAL';metadata['frame']['gpu']=identity
        for kind in [*contract['controls'],*[p['id'] for p in metadata['frame']['probes']]]:
            if kind=='mask':signal=white.outputs[0]
            elif kind=='window-xy':signal=combine.outputs[0]
            else:
                if kind=='geometry-normal':field=geo.outputs['Normal']
                else:
                    nm.inputs['Color'].default_value=(*next(p['rgb'] for p in metadata['frame']['probes'] if p['id']==kind),1);field=nm.outputs['Normal']
                t.links.new(field,scale.inputs[0]);signal=bias.outputs[0]
            t.links.new(signal,emit.inputs['Color']);path=out/(metadata['name']+'-'+kind+'.exr');scene.render.filepath=str(path);start=time.perf_counter();bpy.ops.render.render(write_still=True)
            image=bpy.data.images.load(str(path),check_existing=False);image.use_half_precision=False
            values=np.empty(contract['dimensions'][0]*contract['dimensions'][1]*4,np.float32);image.pixels.foreach_get(values);bpy.data.images.remove(image)
            target=path.with_suffix('.f32');target.write_bytes(values.astype('<f4').tobytes());metadata['frame']['rows'].append({'kind':kind,'file':target.name,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'milliseconds':(time.perf_counter()-start)*1000})
            (out/'partial-native.json').write_text(json.dumps(metadata,indent=2)+'\n')
    data=camera.data;world=scene.world
    bpy.data.objects.remove(camera,do_unlink=True);bpy.data.cameras.remove(data);scene.world=None;bpy.data.worlds.remove(world)
