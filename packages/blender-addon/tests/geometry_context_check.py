# blendlink-headless-sentinel: BLENDLINK_GEOMETRY_CONTEXT_PASSED
# SPDX-License-Identifier: GPL-3.0-or-later
"""Primary camera-ray geometry fields, optional native real-render corpus."""
import json
import hashlib
import math
import os
from pathlib import Path
import sys
import tempfile
import bpy
import numpy as np
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

addon=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(addon));sys.path.insert(0,str(addon.parent/'blendlink/blender'))
import geometry_ir
import material_compiler as compiler
import tsl_ir


def unit_check():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    tree=bpy.data.node_groups.new('Geometry schema','ShaderNodeTree')
    for identifier,outputs in [('ShaderNodeNewGeometry',geometry_ir.GEOMETRY_OUTPUTS),('ShaderNodeTexCoord',geometry_ir.TEXTURE_OUTPUTS)]:
        node=tree.nodes.new(identifier)
        for name,output in outputs.items():
            ir=tsl_ir.emit_output(node,node.outputs[name])
            assert ir['op']=='geometry_context' and ir['output']==output,ir
    node=tree.nodes.new('ShaderNodeNewGeometry')
    for name in ['Tangent','Pointiness','Random Per Island']:
        try:tsl_ir.emit_output(node,node.outputs[name])
        except tsl_ir.TslIrRefusal:pass
        else:raise AssertionError('Unverified geometry output admitted: '+name)
    print('BLENDLINK_GEOMETRY_CONTEXT_PASSED '+bpy.app.version_string)


def references(directory):
    root=Path(directory);root.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=5;scene.render.fps=24
    frames=[1,3,5]
    scene.render.engine='CYCLES';scene.cycles.samples=1;scene.cycles.device='CPU'
    scene.render.use_high_quality_normals=os.environ.get('BLENDLINK_GEOMETRY_HIGH_QUALITY')=='1'
    scene.cycles.pixel_filter_type='BOX';scene.cycles.filter_width=.01
    import _cycles
    _cycles.set_device_override('CPU')
    scene.render.resolution_x=1024;scene.render.resolution_y=512;scene.render.resolution_percentage=100
    scene.render.use_compositing=False;scene.render.dither_intensity=0;scene.render.film_transparent=True
    scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32'
    scene.view_settings.view_transform='Raw';scene.view_settings.look='None'
    if hasattr(scene.cycles,'use_denoising'):scene.cycles.use_denoising=False
    if hasattr(scene,'eevee'):scene.eevee.taa_render_samples=1
    eevee='BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in {item.identifier for item in scene.render.bl_rna.properties['engine'].enum_items} else 'BLENDER_EEVEE'
    cases=[]
    for identifier,outputs in [('ShaderNodeNewGeometry',geometry_ir.GEOMETRY_OUTPUTS),('ShaderNodeTexCoord',geometry_ir.TEXTURE_OUTPUTS)]:
        for name,output in outputs.items():cases.append({'node':identifier,'socket':name,'output':output,'scale':.02 if output in {'position','camera'} else .2})
    cases.append({'output':'control','scale':1})
    vertices=[];faces=[]
    for index,case in enumerate(cases):
        x,y=-5+(index%5)*2,-2+(index//5)*2
        offset=len(vertices);vertices.extend([(x,y,.5),(x+2,y,.5),(x+2,y+2,.5),(x,y+2,.5)])
        faces.append(tuple(range(offset,offset+4)));case['center']=[x+1,y+1,.5];case['name']='Geometry '+case['output']
    mesh=bpy.data.meshes.new('Authored split normal shared geometry');mesh.from_pydata(vertices,[],faces);mesh.update()
    for polygon in mesh.polygons:polygon.use_smooth=os.environ.get('BLENDLINK_GEOMETRY_FLAT')!='1'
    normals=[]
    for loop in mesh.loops:
        p=mesh.vertices[loop.vertex_index].co
        normals.append(Vector((.15+.025*p.x,-.2+.04*p.y,1)).normalized())
    mesh.normals_split_custom_set(normals)
    originals=[];oracles=[]
    for index,case in enumerate(cases):
        material=bpy.data.materials.new(case['name']);material.use_nodes=True;tree=material.node_tree;tree.nodes.clear()
        sink=tree.nodes.new('ShaderNodeOutputMaterial');bsdf=tree.nodes.new('ShaderNodeBsdfPrincipled');tree.links.new(bsdf.outputs[0],sink.inputs['Surface'])
        if case['output']=='control':
            value=tree.nodes.new('ShaderNodeRGB');value.outputs[0].default_value=(.3333333,.1234567,1.234567,1);field=value.outputs[0]
        else:
            source=tree.nodes.new(case['node']);encode=tree.nodes.new('ShaderNodeVectorMath');encode.operation='MULTIPLY_ADD'
            encode.inputs[1].default_value=(case['scale'],)*3;encode.inputs[2].default_value=(.5,)*3
            tree.links.new(source.outputs[case['socket']],encode.inputs[0]);field=encode.outputs[0]
        tree.links.new(field,bsdf.inputs['Base Color']);compiler.set_tsl_ir(material,True)
        mesh.materials.append(material);mesh.polygons[index].material_index=index;originals.append(material)
        oracle=material.copy();tree=oracle.node_tree;sink=next(node for node in tree.nodes if node.type=='OUTPUT_MATERIAL');bsdf=next(node for node in tree.nodes if node.type=='BSDF_PRINCIPLED')
        emit=tree.nodes.new('ShaderNodeEmission');tree.links.new(bsdf.inputs['Base Color'].links[0].from_socket,emit.inputs['Color']);tree.links.new(emit.outputs[0],sink.inputs['Surface']);oracles.append(oracle)
    rig=bpy.data.objects.new('Geometry owner rig',None);scene.collection.objects.link(rig);rig.rotation_euler=(.07,.05,-.03);rig.scale=(1.1,.9,1.2)
    owners=[]
    for index in range(2):
        owner=bpy.data.objects.new('Geometry Owner '+str(index),mesh);scene.collection.objects.link(owner);owner.parent=rig;owner.location.x=-6 if index==0 else 6
        owner.scale=(-.9,1.2,.7) if index==0 else (.85,1.3,1.1);owner['blendlink_id']='geometry-owner-'+str(index)
        for frame in frames:
            pose=min(frame,3)
            owner.rotation_euler=(.35,.05,-.27) if frame==5 and index==0 else (.05+.02*pose,-.07+.03*pose,.03-.02*pose)
            owner.keyframe_insert(data_path='rotation_euler',frame=frame)
        owners.append(owner)
    camera=bpy.data.objects.new('Geometry Camera',bpy.data.cameras.new('Geometry Camera'));scene.collection.objects.link(camera);scene.camera=camera
    camera.data.lens=35;camera.data.sensor_width=36;camera.data.ortho_scale=28;camera.scale=(1.3,.7,2.1)
    recipe={'schemaVersion':1,'presentation':'realtime','atlases':[{'id':'main','name':'Main','size':256,'targetDensity':8,'margin':4,'fitPolicy':'block','bakeOutput':'lighting'}],
        'states':[{'name':'default'}],'preview':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1},'final':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1}}
    scene['blendlink_recipe']=json.dumps(recipe)
    rows=[];sources=[]
    active_owners=owners[:1] if os.environ.get('BLENDLINK_GEOMETRY_SINGLE_OWNER')=='1' else owners
    for owner in owners:owner.hide_render=owner not in active_owners
    with tempfile.TemporaryDirectory(prefix='blendlink-native-geometry-') as temporary:
        for projection in ['PERSP','ORTHO']:
            camera.data.type=projection
            for face in ['front','back']:
                # Reuse one camera action; sampled source keys are the actual
                # authored pose, never substitute browser-only camera metadata.
                camera.animation_data_clear()
                for frame in frames:
                    camera.location=(.3*min(frame,3),-4,30 if face=='front' else -30)
                    camera.rotation_euler=(-camera.location).to_track_quat('-Z','Y').to_euler()
                    camera.keyframe_insert(data_path='location',frame=frame);camera.keyframe_insert(data_path='rotation_euler',frame=frame)
                for engine in ['CYCLES',eevee]:
                    scene.render.engine=engine
                    label=('cycles' if engine=='CYCLES' else 'eevee')+'_'+projection.lower()+'_'+face
                    for frame in frames:
                        scene.frame_set(frame);bpy.context.view_layer.update()
                        for index,material in enumerate(oracles):mesh.materials[index]=material
                        try:
                            for owner in active_owners:
                                # Preserve the saved scene's shared-geometry user
                                # count: Cycles changes normal interpolation when
                                # hiding the other owner permits transform baking.
                                for other in owners:other.hide_render=other not in active_owners
                                scene.render.filepath=str(Path(temporary)/'field.exr');bpy.ops.render.render(write_still=True)
                                image=bpy.data.images.load(scene.render.filepath,check_existing=False)
                                pixels=np.asarray(image.pixels[:],np.float32).reshape(512,1024,4);bpy.data.images.remove(image)
                                samples=[]
                                for case in cases:
                                    point=world_to_camera_view(scene,camera,owner.matrix_world@Vector(case['center']))
                                    x,y=int(point.x*1024),int(point.y*512)
                                    assert 0<=x<1024 and 0<=y<512 and pixels[y,x,3]>.95,(label,owner.name,case['name'],point[:])
                                    samples.append({'pixel':[x,y],'rgb':pixels[y,x,:3].tolist()})
                                assert max(abs(a-b) for a,b in zip(samples[-1]['rgb'],(.3333333,.1234567,1.234567)))<(2e-6 if engine=='CYCLES' else .001)
                                rows.append({'source':label,'engine':engine,'projection':projection,'face':face,'frame':frame,'owner':owner.name,'samples':samples,
                                    'objectMatrix':[list(row) for row in owner.matrix_world],'cameraMatrix':[list(row) for row in camera.matrix_world]})
                        finally:
                            for index,material in enumerate(originals):mesh.materials[index]=material
                            for owner in owners:owner.hide_render=owner not in active_owners
                    scene.frame_set(1);path=root/(label+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(path));sources.append({'name':label,'file':path.name,'engine':engine})
    for material in oracles:bpy.data.materials.remove(material)
    normal_source=[{'material':mesh.materials[polygon.material_index].name,'position':list(mesh.vertices[mesh.loops[index].vertex_index].co),'normal':list(mesh.corner_normals[index].vector)}
        for polygon in mesh.polygons for index in polygon.loop_indices]
    (root/'native-reference.json').write_text(json.dumps({'blender':bpy.app.version_string,'build':bpy.app.build_hash.decode(),
        'fixtureSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'sources':sources,'cases':cases,'rows':rows,'normalSource':normal_source,'frames':frames,'ownerCount':len(active_owners),'flatShading':not mesh.polygons[0].use_smooth,'highQualityNormals':scene.render.use_high_quality_normals,
        'cyclesFilter':{'type':'BOX','width':scene.cycles.filter_width},'rasterTolerance':2e-5},indent=2))
    print('BLENDLINK_GEOMETRY_REFERENCES_PASSED '+bpy.app.version_string)


unit_check()
if os.environ.get('BLENDLINK_GEOMETRY_REFERENCES'):references(os.environ['BLENDLINK_GEOMETRY_REFERENCES'])
