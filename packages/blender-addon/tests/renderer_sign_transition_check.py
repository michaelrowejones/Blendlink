# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_RENDERER_SIGN_CONTEXT_PASSED
"""Constant sign-changing transforms never interpolate through singular scale."""
from pathlib import Path
import hashlib,json,os,sys,tempfile
import bpy,numpy as np
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
addon=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(addon));sys.path.insert(0,str(addon.parent/'blendlink/blender'))
import material_compiler as compiler

def action_curves(action):
    direct=getattr(action,'fcurves',None)
    if direct is not None:return list(direct)
    return [curve for layer in action.layers for strip in layer.strips for bag in strip.channelbags for curve in bag.fcurves]

def references(directory):
    root=Path(directory);root.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT' if bpy.app.version<(5,0) else 'BLENDER_EEVEE'
    scene.frame_start=1;scene.frame_end=5;scene.render.fps=24
    scene.render.resolution_x=1024;scene.render.resolution_y=512;scene.render.resolution_percentage=100
    scene.render.film_transparent=True;scene.render.use_compositing=False;scene.render.dither_intensity=0
    scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32'
    scene.view_settings.view_transform='Raw';scene.view_settings.look='None'
    if hasattr(scene,'eevee'):scene.eevee.taa_render_samples=1
    cases=[{'output':'normal','center':[-2,0,.5]},{'output':'backfacing','center':[0,0,.5]},{'output':'control','center':[2,3,.5]}]
    vertices=[];faces=[]
    for case in cases:
        x,y,z=case['center'];offset=len(vertices)
        vertices.extend([(x-1,y-1,z),(x+1,y-1,z),(x+1,y+1,z),(x-1,y+1,z)]);faces.append(tuple(range(offset,offset+4)))
        case['name']='Sign transition '+case['output']
    mesh=bpy.data.meshes.new('Sign transition shared geometry');mesh.from_pydata(vertices,[],faces);mesh.update()
    authored=[];oracles=[]
    for index,case in enumerate(cases):
        material=bpy.data.materials.new(case['name']);material.use_nodes=True
        tree=material.node_tree;bsdf=next(node for node in tree.nodes if node.type=='BSDF_PRINCIPLED')
        if case['output']=='control':
            rgb=tree.nodes.new('ShaderNodeRGB');rgb.outputs[0].default_value=(.3333333,.1234567,1.234567,1);field=rgb.outputs[0]
        else:
            geometry=tree.nodes.new('ShaderNodeNewGeometry');field=geometry.outputs['Normal' if case['output']=='normal' else 'Backfacing']
            if case['output']=='normal':
                encoded=tree.nodes.new('ShaderNodeVectorMath');encoded.operation='MULTIPLY_ADD'
                encoded.inputs[1].default_value=(.2,)*3;encoded.inputs[2].default_value=(.5,)*3
                tree.links.new(field,encoded.inputs[0]);field=encoded.outputs[0]
        tree.links.new(field,bsdf.inputs['Base Color']);compiler.set_tsl_ir(material,True)
        mesh.materials.append(material);mesh.polygons[index].material_index=index;authored.append(material)
        oracle=material.copy();tree=oracle.node_tree
        bsdf=next(node for node in tree.nodes if node.type=='BSDF_PRINCIPLED');out=next(node for node in tree.nodes if node.type=='OUTPUT_MATERIAL')
        field=bsdf.inputs['Base Color'].links[0].from_socket
        emission=tree.nodes.new('ShaderNodeEmission');tree.links.new(field,emission.inputs[0]);tree.links.new(emission.outputs[0],out.inputs[0]);oracles.append(oracle)
    owners=[]
    for index in range(2):
        owner=bpy.data.objects.new('Sign Owner '+str(index),mesh);scene.collection.objects.link(owner)
        owner.location.x=-4 if index==0 else 4;owner['blendlink_id']='renderer-sign-owner-'+str(index)
        if index==0:
            for frame,scale in [(1,1),(3,-1),(5,1)]:
                owner.scale=(scale,1.1,.9);owner.keyframe_insert(data_path='scale',frame=frame)
            for curve in action_curves(owner.animation_data.action):
                for key in curve.keyframe_points:key.interpolation='CONSTANT'
        else:owner.scale=(-.8,1.2,.9)
        owners.append(owner)
    camera=bpy.data.objects.new('Sign Camera',bpy.data.cameras.new('Sign Camera'));scene.collection.objects.link(camera);scene.camera=camera
    camera.data.lens=35;camera.data.sensor_width=36;camera.data.ortho_scale=20
    scene['blendlink_recipe']=json.dumps({'schemaVersion':1,'presentation':'realtime',
      'atlases':[{'id':'main','name':'Main','size':256,'targetDensity':8,'margin':4,'fitPolicy':'block','bakeOutput':'lighting'}],
      'states':[{'name':'default'}],'preview':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1},
      'final':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1}})
    rows=[];sources=[]
    with tempfile.TemporaryDirectory(prefix='blendlink-native-sign-') as temporary:
        for projection in ['PERSP','ORTHO']:
            camera.data.type=projection
            for side in ['front','back']:
                camera.location=(.3,-3,30 if side=='front' else -30);camera.rotation_euler=(-camera.location).to_track_quat('-Z','Y').to_euler()
                for frame in [1,2,3,4,5]:
                    scene.frame_set(frame);bpy.context.view_layer.update()
                    assert owners[0].scale.x==(1 if frame in {1,2,5} else -1)
                    for index,material in enumerate(oracles):mesh.materials[index]=material
                    try:
                        scene.render.filepath=str(Path(temporary)/'field.exr');bpy.ops.render.render(write_still=True)
                        image=bpy.data.images.load(scene.render.filepath,check_existing=False)
                        pixels=np.asarray(image.pixels[:],np.float32).reshape(512,1024,4);bpy.data.images.remove(image)
                        for owner in owners:
                            samples=[]
                            for case in cases:
                                point=world_to_camera_view(scene,camera,owner.matrix_world@Vector(case['center']));x,y=int(point.x*1024),int(point.y*512)
                                assert 0<=x<1024 and 0<=y<512 and pixels[y,x,3]>.95,(owner.name,case,point[:])
                                samples.append({'pixel':[x,y],'rgb':pixels[y,x,:3].tolist()})
                            rows.append({'source':projection.lower()+'_'+side,'frame':frame,'owner':owner.name,'samples':samples,
                              'objectMatrix':[list(row) for row in owner.matrix_world],'cameraMatrix':[list(row) for row in camera.matrix_world]})
                    finally:
                        for index,material in enumerate(authored):mesh.materials[index]=material
                scene.frame_set(1);name=projection.lower()+'_'+side;path=root/(name+'.blend')
                bpy.ops.wm.save_as_mainfile(filepath=str(path));sources.append({'name':name,'file':path.name})
    (root/'native-reference.json').write_text(json.dumps({'blender':bpy.app.version_string,'build':bpy.app.build_hash.decode(),
      'gpuBackend':bpy.context.preferences.system.gpu_backend,'fixtureSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
      'sources':sources,'cases':cases,'rows':rows,'frames':[1,2,3,4,5],'fps':24,'rasterTolerance':2e-5},indent=2))
    print('BLENDLINK_RENDERER_SIGN_REFERENCES_PASSED '+bpy.app.version_string)

print('BLENDLINK_RENDERER_SIGN_CONTEXT_PASSED '+bpy.app.version_string)
if os.environ.get('BLENDLINK_RENDERER_SIGN_REFERENCES'):references(os.environ['BLENDLINK_RENDERER_SIGN_REFERENCES'])
