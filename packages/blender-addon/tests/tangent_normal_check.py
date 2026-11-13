# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_TANGENT_NORMAL_CONTEXT_PASSED
"""Native normal-node fields through real camera rays; optional saved corpus."""
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
    bpy.context.scene.render.engine='BLENDER_EEVEE_NEXT' if bpy.app.version<(5,0) else 'BLENDER_EEVEE'
    tree=bpy.data.node_groups.new('Native tangent normal schema','ShaderNodeTree')
    node=tree.nodes.new('ShaderNodeNormalMap');node.space='TANGENT'
    node.inputs['Color'].default_value=(.8,.6,.9,1)
    ir=tsl_ir.emit_output(node,node.outputs[0])
    assert ir['op']=='normal_map_tangent_native' and ir['frame']['tangentStorage']=='SNORM10',ir
    print('BLENDLINK_TANGENT_NORMAL_CONTEXT_PASSED '+bpy.app.version_string)


def references(directory):
    root=Path(directory);root.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=5;scene.render.fps=24
    frames=[1,3,5]
    scene.render.engine='CYCLES';scene.cycles.samples=1;scene.cycles.device='CPU'
    scene.render.use_high_quality_normals=os.environ.get('BLENDLINK_TANGENT_NORMAL_HIGH_QUALITY')=='1'
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
    cases=[{'strength':amount,'color':[.8,.6,.9]} for amount in [-1,0,.25,.5,1,2]]
    cases.append({'strength':1,'color':[-.4,1.2,.7]})
    if bpy.app.version>=(5,2):
        cases.extend({'strength':amount,'color':[.8,.6,.9],'convention':'DIRECTX','base':'ORIGINAL'} for amount in [.5,1])
    cases.extend({'strength':amount,'color':[.8,.6,.9],'slot':'normal'} for amount in [.5,1])
    cases.extend({'strength':1,'color':[.8,.6,.9],'slot':'coat-normal'} for _ in [0])
    cases.extend({'strength':1,'color':[.5,.5,1]} for _ in [0])
    for live in ['checker','mix','embedded','external']:
        cases.append({'live':live,'strength':.5})
        cases.append({'live':live,'liveStrength':True,'strength':1,'slot':'normal'})
    cases.append({'live':'external','strength':1,'image_uv':'EditUV'})
    if os.environ.get('BLENDLINK_TANGENT_NORMAL_NOISE_ONLY')=='1':
        cases=[]
        for dimension in [1,2,3,4]:
            for coordinate in ['object','generated'] if dimension>1 else ['constant']:
                for live_strength in [False,True]:
                    cases.append({'live':'native-noise','dimensions':dimension,'coordinates':coordinate,
                                  'strength':.125 if not live_strength else 1,'liveStrength':live_strength,
                                  'detail':1,'noiseScale':.15,'slot':'normal' if live_strength else 'color'})
        for detail,scale,distortion in [(0,.25,0),(2,.125,0),(1,.125,0)]:
            cases.append({'live':'native-noise','dimensions':3,'coordinates':'object','strength':1,
                          'liveStrength':True,'detail':detail,'noiseScale':scale,'distortion':distortion})
        for dimension,detail,scale,roughness,lacunarity,distortion,live_strength in [
            (2,2,.25,0,2,0,True),(3,0,.25,1,0,0,True),(3,1,.125,1,-2,0,False),
            (4,2,.1,1,2,0,False),(3,2,.15,-.5,2,0,True),
            (4,2,.1,1,2,0,False),(2,2,-.1,1,-2,0,True)]:
            cases.append({'live':'native-noise','dimensions':dimension,'coordinates':'object','strength':.125 if not live_strength else 1,
                          'liveStrength':live_strength,'detail':detail,'noiseScale':scale,'distortion':distortion,
                          'roughness':roughness,'lacunarity':lacunarity,'slot':'normal'})
        for dimension in [2,4]:
            cases.append({'live':'native-noise','dimensions':dimension,'coordinates':'constant','strength':.125,
                          'liveStrength':False,'detail':6,'noiseScale':80,'roughness':1,'slot':'normal'})
    requested_uv=os.environ.get('BLENDLINK_TANGENT_NORMAL_UV','')
    bound_uv=requested_uv or 'RenderUV'
    for index,case in enumerate(cases):case.update({'output':'tangent-normal-'+str(index),'scale':.2})
    cases.append({'output':'control','scale':1})
    images={}
    for width in [8,257]:
        for kind in ['color','mask']:
            name=f'Normal {kind} {width}'
            image=bpy.data.images.new(name,width=width,height=width,alpha=True,float_buffer=False,is_data=True)
            image.colorspace_settings.name='Non-Color';image.alpha_mode='STRAIGHT'
            pixels=np.empty((width,width,4),np.float32)
            for y in range(width):
                for x in range(width):
                    quadrant=(int(x>=width//2)+2*int(y>=width//2))
                    colors=[(.6,.4,.95,1),(.4,.65,.9,1),(.75,.5,.85,1),(.35,.7,.98,1)]
                    pixels[y,x]=colors[quadrant] if kind=='color' else (.2,.4,.8,[0,.25,.6,1][quadrant])
            image.pixels.foreach_set(pixels.ravel());image.filepath_raw=str((root/(name.replace(' ','-')+'.png')).resolve());image.file_format='PNG';image.save();image.pack()
            images[(width,kind)]=image
    columns=8;rows_count=math.ceil(len(cases)/columns)
    vertices=[];faces=[]
    for index,case in enumerate(cases):
        x,y=-columns+(index%columns)*2,-rows_count+(index//columns)*2
        offset=len(vertices);vertices.extend([(x,y,.5),(x+2,y,.5),(x+2,y+2,.5),(x,y+2,.5)])
        faces.append(tuple(range(offset,offset+4)));case['center']=[x+1,y+1,.5];case['name']='Native Normal '+case['output']
    mesh=bpy.data.meshes.new('Authored split normal shared geometry');mesh.from_pydata(vertices,[],faces);mesh.update()
    for polygon in mesh.polygons:polygon.use_smooth=os.environ.get('BLENDLINK_TANGENT_NORMAL_FLAT')!='1'
    normals=[]
    for loop in mesh.loops:
        p=mesh.vertices[loop.vertex_index].co
        normals.append(Vector((.15+.025*p.x,-.2+.04*p.y,1)).normalized())
    mesh.normals_split_custom_set(normals)
    edit_uv=mesh.uv_layers.new(name='EditUV');render_uv=mesh.uv_layers.new(name='RenderUV')
    for polygon in mesh.polygons:
        for local,index in enumerate(polygon.loop_indices):
            x,y=[(0,0),(1,0),(1,1),(0,1)][local]
            if polygon.index==1:x=-x
            # Distinct source maps remain visibly different while their
            # small spans keep native image sampling at base LOD. Mips are
            # a separate sampler contract, not this normal-frame oracle.
            edit_uv.data[index].uv=(.55+.02*x,.15+.02*y)
            render_uv.data[index].uv=(.1+(.65*x-.6*y)/64,.8+(.6*x+.65*y)/64)
    mesh.uv_layers.active_index=0;render_uv.active_render=True

    originals=[];oracles=[]
    for index,case in enumerate(cases):
        material=bpy.data.materials.new(case['name']);material.use_nodes=True;tree=material.node_tree;tree.nodes.clear()
        sink=tree.nodes.new('ShaderNodeOutputMaterial');bsdf=tree.nodes.new('ShaderNodeBsdfPrincipled');tree.links.new(bsdf.outputs[0],sink.inputs['Surface'])
        if case['output']=='control':
            value=tree.nodes.new('ShaderNodeRGB');value.outputs[0].default_value=(.3333333,.1234567,1.234567,1);field=value.outputs[0]
        else:
            source=tree.nodes.new('ShaderNodeNormalMap');source.space='TANGENT';source.uv_map=requested_uv
            if 'convention' in case:source.convention=case['convention']
            if 'base' in case:source.base=case['base']
            if case.get('live'):
                live=case['live']
                if live=='native-noise':
                    texture=tree.nodes.new('ShaderNodeTexNoise');texture.noise_dimensions=str(case['dimensions'])+'D';texture.normalize=True
                    texture.inputs['Scale'].default_value=case['noiseScale'];texture.inputs['Detail'].default_value=case['detail']
                    texture.inputs['Roughness'].default_value=case.get('roughness',.5);texture.inputs['Distortion'].default_value=case.get('distortion',0)
                    texture.inputs['Lacunarity'].default_value=case.get('lacunarity',2)
                    if case.get('roughness',.5)<0:
                        amount=tree.nodes.new('ShaderNodeValue');amount.outputs[0].default_value=case['roughness'];tree.links.new(amount.outputs[0],texture.inputs['Roughness'])
                    if case['dimensions']==1:texture.inputs['W'].default_value=.371234
                    elif case['coordinates']=='constant':
                        coordinate=tree.nodes.new('ShaderNodeCombineXYZ')
                        for socket,value in zip(coordinate.inputs,[.371234,-.138237,.193421]):socket.default_value=value
                        tree.links.new(coordinate.outputs[0],texture.inputs['Vector'])
                        if case['dimensions']==4:texture.inputs['W'].default_value=.371234
                    else:
                        coordinate=tree.nodes.new('ShaderNodeTexCoord')
                        tree.links.new(coordinate.outputs['Object' if case['coordinates']=='object' else 'Generated'],texture.inputs['Vector'])
                        if case['dimensions']==4:texture.inputs['W'].default_value=.371234
                    color=texture.outputs['Color'];strength=texture.outputs['Fac']
                    if case.get('liveStrength'):
                        constant=tree.nodes.new('ShaderNodeRGB');constant.outputs[0].default_value=(.8,.6,.9,1);color=constant.outputs[0]
                elif live in {'checker','mix'}:
                    coordinate=tree.nodes.new('ShaderNodeTexCoord');texture=tree.nodes.new('ShaderNodeTexChecker');texture.inputs['Scale'].default_value=.15
                    texture.inputs['Color1'].default_value=(.2,.3,.9,1);texture.inputs['Color2'].default_value=(.9,.65,.95,1)
                    shifted=tree.nodes.new('ShaderNodeVectorMath');shifted.operation='ADD';shifted.inputs[1].default_value=(.137,.173,.089)
                    tree.links.new(coordinate.outputs['Object'],shifted.inputs[0]);tree.links.new(shifted.outputs['Vector'],texture.inputs['Vector'])
                    if live=='checker':color=texture.outputs['Color']
                    else:
                        blend=tree.nodes.new('ShaderNodeMixRGB');blend.blend_type='MIX';blend.inputs[1].default_value=(.2,.3,.9,1);blend.inputs[2].default_value=(.9,.65,.95,1)
                        tree.links.new(texture.outputs['Fac'],blend.inputs['Fac']);color=blend.outputs[0]
                    strength=texture.outputs['Fac']
                else:
                    width=8 if live=='embedded' else 257
                    texture=tree.nodes.new('ShaderNodeTexImage');texture.image=images[(width,'color')];texture.interpolation='Linear'
                    if case.get('image_uv'):
                        uv=tree.nodes.new('ShaderNodeUVMap');uv.uv_map=case['image_uv'];tree.links.new(uv.outputs[0],texture.inputs['Vector'])
                    color=texture.outputs['Color']
                    mask=tree.nodes.new('ShaderNodeTexImage');mask.image=images[(width,'mask')];mask.interpolation='Linear'
                    strength=mask.outputs['Alpha']
                tree.links.new(color,source.inputs['Color'])
                if case.get('liveStrength'):tree.links.new(strength,source.inputs['Strength'])
                else:source.inputs['Strength'].default_value=case['strength']
            else:
                color=tree.nodes.new('ShaderNodeCombineXYZ')
                for socket,value in zip(color.inputs,case['color']):socket.default_value=value
                amount=tree.nodes.new('ShaderNodeValue');amount.outputs[0].default_value=case['strength']
                tree.links.new(color.outputs[0],source.inputs['Color']);tree.links.new(amount.outputs[0],source.inputs['Strength'])
            encode=tree.nodes.new('ShaderNodeVectorMath');encode.operation='MULTIPLY_ADD'
            encode.inputs[1].default_value=(case['scale'],)*3;encode.inputs[2].default_value=(.5,)*3
            tree.links.new(source.outputs['Normal'],encode.inputs[0]);field=encode.outputs[0]
        if case.get('slot') in {'normal','coat-normal'}:
            tree.links.new(source.outputs['Normal'],bsdf.inputs['Coat Normal' if case['slot']=='coat-normal' else 'Normal']);bsdf.inputs['Base Color'].default_value=(.42,.35,.13,1)
            if case['slot']=='coat-normal':bsdf.inputs['Coat Weight'].default_value=1
        else:tree.links.new(field,bsdf.inputs['Base Color'])
        compiler.set_tsl_ir(material,True)
        mesh.materials.append(material);mesh.polygons[index].material_index=index;originals.append(material)
        oracle=material.copy();tree=oracle.node_tree;sink=next(node for node in tree.nodes if node.type=='OUTPUT_MATERIAL');bsdf=next(node for node in tree.nodes if node.type=='BSDF_PRINCIPLED')
        if case.get('slot') in {'normal','coat-normal'}:
            normal=bsdf.inputs['Coat Normal' if case['slot']=='coat-normal' else 'Normal'].links[0].from_socket
            view=tree.nodes.new('ShaderNodeVectorTransform');view.vector_type='VECTOR';view.convert_from='WORLD';view.convert_to='CAMERA'
            tree.links.new(normal,view.inputs['Vector'])
            flipped=tree.nodes.new('ShaderNodeVectorMath');flipped.operation='MULTIPLY';flipped.inputs[1].default_value=(1,1,-1)
            tree.links.new(view.outputs[0],flipped.inputs[0])
            encode=tree.nodes.new('ShaderNodeVectorMath');encode.operation='MULTIPLY_ADD';encode.inputs[1].default_value=(.2,)*3;encode.inputs[2].default_value=(.5,)*3
            tree.links.new(flipped.outputs[0],encode.inputs[0]);field=encode.outputs[0]
        else:field=bsdf.inputs['Base Color'].links[0].from_socket
        emit=tree.nodes.new('ShaderNodeEmission');tree.links.new(field,emit.inputs['Color']);tree.links.new(emit.outputs[0],sink.inputs['Surface']);oracles.append(oracle)
    rig=bpy.data.objects.new('Geometry owner rig',None);scene.collection.objects.link(rig);rig.rotation_euler=(.07,.05,-.03);rig.scale=(1.1,.9,1.2)
    owners=[]
    for index in range(2):
        owner=bpy.data.objects.new('Geometry Owner '+str(index),mesh);scene.collection.objects.link(owner);owner.parent=rig;owner.location.x=-(columns+1) if index==0 else columns+1
        owner.scale=(-.9,1.2,.7) if index==0 else (.85,1.3,1.1);owner['blendlink_id']='geometry-owner-'+str(index)
        for frame in frames:
            pose=min(frame,3)
            owner.rotation_euler=(.35,.05,-.27) if frame==5 and index==0 else (.05+.02*pose,-.07+.03*pose,.03-.02*pose)
            owner.keyframe_insert(data_path='rotation_euler',frame=frame)
        owners.append(owner)
    camera=bpy.data.objects.new('Geometry Camera',bpy.data.cameras.new('Geometry Camera'));scene.collection.objects.link(camera);scene.camera=camera
    camera.data.lens=35;camera.data.sensor_width=36;camera.data.ortho_scale=48;camera.scale=(1.3,.7,2.1)
    recipe={'schemaVersion':1,'presentation':'realtime','atlases':[{'id':'main','name':'Main','size':256,'targetDensity':8,'margin':4,'fitPolicy':'block','bakeOutput':'lighting'}],
        'states':[{'name':'default'}],'preview':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1},'final':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1}}
    scene['blendlink_recipe']=json.dumps(recipe)
    rows=[];sources=[]
    active_owners=owners[:1] if os.environ.get('BLENDLINK_TANGENT_NORMAL_SINGLE_OWNER')=='1' else owners
    for owner in owners:owner.hide_render=owner not in active_owners
    with tempfile.TemporaryDirectory(prefix='blendlink-native-geometry-') as temporary:
        for projection in ['PERSP','ORTHO']:
            camera.data.type=projection
            for face in ['front','back']:
                # Reuse one camera action; sampled source keys are the actual
                # authored pose, never substitute browser-only camera metadata.
                camera.animation_data_clear()
                for frame in frames:
                    camera.location=(.3*min(frame,3),-4,60 if face=='front' else -60)
                    camera.rotation_euler=(-camera.location).to_track_quat('-Z','Y').to_euler()
                    camera.keyframe_insert(data_path='location',frame=frame);camera.keyframe_insert(data_path='rotation_euler',frame=frame)
                for engine in [eevee]:
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
    mesh.calc_tangents(uvmap=bound_uv)
    tangent_source=[{'material':mesh.materials[polygon.material_index].name,'position':list(mesh.vertices[mesh.loops[index].vertex_index].co),'tangent':list(mesh.loops[index].tangent)+[mesh.loops[index].bitangent_sign]}
        for polygon in mesh.polygons for index in polygon.loop_indices]
    normal_source=[{'material':mesh.materials[polygon.material_index].name,'position':list(mesh.vertices[mesh.loops[index].vertex_index].co),'normal':list(mesh.corner_normals[index].vector)}
        for polygon in mesh.polygons for index in polygon.loop_indices]
    (root/'native-reference.json').write_text(json.dumps({'blender':bpy.app.version_string,'build':bpy.app.build_hash.decode(),
        'fixtureSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'sources':sources,'cases':cases,'rows':rows,'normalSource':normal_source,'tangentSource':tangent_source,'uvMap':bound_uv,'frames':frames,'ownerCount':len(active_owners),'flatShading':not mesh.polygons[0].use_smooth,'highQualityNormals':scene.render.use_high_quality_normals,
        'cyclesFilter':{'type':'BOX','width':scene.cycles.filter_width},'rasterTolerance':2e-5},indent=2))
    print('BLENDLINK_TANGENT_NORMAL_REFERENCES_PASSED '+bpy.app.version_string)


unit_check()
if os.environ.get('BLENDLINK_TANGENT_NORMAL_REFERENCES'):references(os.environ['BLENDLINK_TANGENT_NORMAL_REFERENCES'])
