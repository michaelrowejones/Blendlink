# blendlink-headless-sentinel: BLENDLINK_CAMERA_DATA_PASSED
# SPDX-License-Identifier: GPL-3.0-or-later
"""Fresh EEVEE Camera Data View Vector, optional native real-render corpus."""
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
import camera_data_ir
import geometry_ir
import material_compiler as compiler
import tsl_ir


def packed_field(tree,field,bias=0):
    def math_node(operation,left,right=None):
        node=tree.nodes.new('ShaderNodeMath');node.operation=operation
        if hasattr(left,'node'):tree.links.new(left,node.inputs[0])
        else:node.inputs[0].default_value=left
        if right is not None:
            if hasattr(right,'node'):tree.links.new(right,node.inputs[1])
            else:node.inputs[1].default_value=right
        return node.outputs[0]
    positive=math_node('ADD',field,bias) if bias else field
    red=math_node('MULTIPLY',math_node('FLOOR',positive),1/256)
    green=math_node('MULTIPLY',math_node('FLOOR',math_node('MULTIPLY',math_node('FRACT',positive),256)),1/256)
    blue=math_node('MULTIPLY',math_node('FLOOR',math_node('MULTIPLY',math_node('FRACT',math_node('MULTIPLY',positive,256)),256)),1/256)
    pack=tree.nodes.new('ShaderNodeCombineXYZ')
    for index,channel in enumerate([red,green,blue]):tree.links.new(channel,pack.inputs[index])
    return pack.outputs[0]


def render_settings(scene,width=1024,height=512):
    scene.render.engine='BLENDER_EEVEE_NEXT' if bpy.app.version<(5,0) else 'BLENDER_EEVEE'
    scene.render.resolution_x=width;scene.render.resolution_y=height;scene.render.resolution_percentage=100
    scene.render.use_compositing=False;scene.render.dither_intensity=0;scene.render.film_transparent=True
    scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32'
    scene.view_settings.view_transform='Raw';scene.view_settings.look='None'
    scene.render.use_high_quality_normals=False
    if hasattr(scene,'eevee'):scene.eevee.taa_render_samples=1


def packing_calibration(root):
    """All256digits, independently authored raw constants; exactly half representable."""
    bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;render_settings(scene,512,512)
    camera=bpy.data.objects.new('Digit camera',bpy.data.cameras.new('Digit camera'));scene.collection.objects.link(camera);scene.camera=camera
    camera.location.z=20;camera.data.type='ORTHO';camera.data.ortho_scale=16
    mesh=bpy.data.meshes.new('Digit cells');vertices=[];faces=[]
    expected=[]
    for k in range(256):
        x,y=k%16-8,k//16-8;offset=len(vertices)
        vertices.extend([(x,y,0),(x+1,y,0),(x+1,y+1,0),(x,y+1,0)]);faces.append(tuple(range(offset,offset+4)))
        digits=(k,255-k,(k%16)*16+k//16);raw=digits[0]+digits[1]/256+digits[2]/65536
        material=bpy.data.materials.new('Digits '+str(k));material.use_nodes=True;tree=material.node_tree;tree.nodes.clear()
        value=tree.nodes.new('ShaderNodeValue');value.outputs[0].default_value=raw
        emit=tree.nodes.new('ShaderNodeEmission');tree.links.new(packed_field(tree,value.outputs[0]),emit.inputs['Color'])
        sink=tree.nodes.new('ShaderNodeOutputMaterial');tree.links.new(emit.outputs[0],sink.inputs['Surface']);expected.append([value/256 for value in digits])
    mesh.from_pydata(vertices,[],faces);mesh.update();owner=bpy.data.objects.new('Digit cells',mesh);scene.collection.objects.link(owner)
    for k in range(256):mesh.materials.append(bpy.data.materials['Digits '+str(k)]);mesh.polygons[k].material_index=k
    scene.render.filepath=str(root/'packing-calibration.exr');bpy.ops.render.render(write_still=True)
    image=bpy.data.images.load(scene.render.filepath,check_existing=False)
    pixels=np.asarray(image.pixels[:],np.float32).reshape(512,512,4);bpy.data.images.remove(image)
    actual=[pixels[(k//16)*32+16,(k%16)*32+16,:3].tolist() for k in range(256)]
    assert actual==expected,(actual,expected)
    return {'cases':256,'maximum':0,'expected':expected,'actual':actual,
        'imageSha256':hashlib.sha256((root/'packing-calibration.exr').read_bytes()).hexdigest()}


def unit_check():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    tree=bpy.data.node_groups.new('Geometry schema','ShaderNodeTree')
    node=tree.nodes.new('ShaderNodeCameraData')
    assert len(node.inputs)==0
    assert [socket.identifier for socket in node.outputs]==list(camera_data_ir.OUTPUTS)
    for name,output in [('View Vector','view-vector')]:
        with tsl_ir.emission_context(evaluation_engine='EEVEE'):
            ir=tsl_ir.emit_output(node,node.outputs[name])
        assert ir['op']=='camera_data_native' and ir['output']==output,ir
        assert ir['sourceVersion']==list(bpy.app.version) and ir['camera']['output']=='camera'
        with tsl_ir.emission_context(evaluation_engine='CYCLES'):
            try:tsl_ir.emit_output(node,node.outputs[name])
            except tsl_ir.TslIrRefusal as error:assert 'EEVEE' in str(error)
            else:raise AssertionError('Unverified Cycles live Camera Data admitted')
    for name in ['View Z Depth','View Distance']:
        with tsl_ir.emission_context(evaluation_engine='EEVEE'):
            try:tsl_ir.emit_output(node,node.outputs[name])
            except tsl_ir.TslIrRefusal as error:assert 'clip/interpolant precision contract' in str(error)
            else:raise AssertionError('Unqualified raw-unit Camera Data admitted')
    assert camera_data_ir.required(ir)
    import shader_domains
    assert shader_domains.native_shader_input_evaluation(ir)=='shader'
    import engine_fallback
    assert 'ShaderNodeCameraData' in engine_fallback._ENGINE_SENSITIVE
    scene=bpy.context.scene;render_settings(scene)
    mesh=bpy.data.meshes.new('Camera unit mesh');mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)])
    owner=bpy.data.objects.new('Camera unit owner',mesh);scene.collection.objects.link(owner)
    material=bpy.data.materials.new('Unmarked Camera Data');material.use_nodes=True;mesh.materials.append(material)
    shader=next(node for node in material.node_tree.nodes if node.type=='BSDF_PRINCIPLED')
    source=material.node_tree.nodes.new('ShaderNodeCameraData');material.node_tree.links.new(source.outputs['View Vector'],shader.inputs['Base Color'])
    camera=bpy.data.objects.new('Camera unit camera',bpy.data.cameras.new('Camera unit camera'));scene.collection.objects.link(camera);scene.camera=camera;camera.location.z=20
    owner['artist']='preserved';before=(len(material.node_tree.nodes),len(material.node_tree.links),list(material.keys()),dict(owner.items()),list(mesh.vertices[1].co))
    planned=compiler.plan_materials([owner],automatic_programs=True).decisions[0].as_dict()
    channels=planned['channels'];assert channels['automatic']
    base=next(channel for channel in channels['channels'] if channel['channel']=='Base Color')
    assert base['route']=='program' and camera_data_ir.required(base['tslIr']),planned
    assert before==(len(material.node_tree.nodes),len(material.node_tree.links),list(material.keys()),dict(owner.items()),list(mesh.vertices[1].co))
    camera_data_ir.validate_owner(owner)
    camera.data.lens=2;bpy.context.view_layer.update()
    try:camera_data_ir.validate_owner(owner)
    except ValueError as error:assert 'angular footprint' in str(error)
    else:raise AssertionError('Unqualified wide source projection admitted')
    camera.data.lens=50
    camera.location.z=.5;bpy.context.view_layer.update()
    try:camera_data_ir.validate_owner(owner)
    except ValueError as error:assert 'at least 1' in str(error)
    else:raise AssertionError('Unsafe close camera admitted')
    camera.location.z=20;owner.location.x=65;bpy.context.view_layer.update()
    try:camera_data_ir.validate_owner(owner)
    except ValueError as error:assert 'world mesh bounds' in str(error)
    else:raise AssertionError('Unsafe translated owner admitted')
    print('BLENDLINK_CAMERA_DATA_PASSED '+bpy.app.version_string)


def references(directory):
    root=Path(directory);root.mkdir(parents=True,exist_ok=True)
    calibration=packing_calibration(root)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=5;scene.render.fps=24
    frames=[1,3,5]
    render_settings(scene)
    eevee=scene.render.engine
    reference_engines=[eevee]
    control_rgb=(.3125,.125,1.25) # Exactly representable scene-half carrier.
    cases=[{'node':'ShaderNodeCameraData','socket':'View Vector','component':axis,'output':'view-'+axis,'bias':1}
           for axis in ['X','Y','Z']]
    cases.append({'node':'ShaderNodeCameraData','socket':'View Vector','component':'Z','output':'view-composed','bias':1,'composition':True})
    cases.append({'output':'control','scale':1})
    vertices=[];faces=[]
    for index,case in enumerate(cases):
        cell = 9 if case['output']=='control' else index
        x,y=-5+(cell%5)*2,-2+(cell//5)*2
        offset=len(vertices);vertices.extend([(x,y,.5),(x+2,y,.5),(x+2,y+2,.5),(x,y+2,.5)])
        faces.append(tuple(range(offset,offset+4)));case['center']=[x+1,y+1,.5];case['name']='Geometry '+case['output']
    mesh=bpy.data.meshes.new('Authored split normal shared geometry');mesh.from_pydata(vertices,[],faces);mesh.update()
    for polygon in mesh.polygons:polygon.use_smooth=os.environ.get('BLENDLINK_CAMERA_DATA_FLAT')!='1'
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
            value=tree.nodes.new('ShaderNodeRGB');value.outputs[0].default_value=(*control_rgb,1);field=value.outputs[0]
        else:
            if case['output']=='view-Y':
                group=bpy.data.node_groups.new('Camera group','ShaderNodeTree');group.interface.new_socket(name='Vector',in_out='OUTPUT',socket_type='NodeSocketVector')
                inner=group.nodes.new('ShaderNodeCameraData');out=group.nodes.new('NodeGroupOutput');group.links.new(inner.outputs['View Vector'],out.inputs['Vector'])
                source=tree.nodes.new('ShaderNodeGroup');source.node_tree=group;field=source.outputs['Vector']
            else:
                source=tree.nodes.new(case['node']);field=source.outputs[case['socket']]
            if 'component' in case:
                separate=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(field,separate.inputs[0]);field=separate.outputs[case['component']]
            if case.get('composition'):
                for operation,value in [('MULTIPLY',.75),('ADD',.125)]:
                    math_node=tree.nodes.new('ShaderNodeMath');math_node.operation=operation;math_node.inputs[1].default_value=value;tree.links.new(field,math_node.inputs[0]);field=math_node.outputs[0]
        tree.links.new(field,bsdf.inputs['Base Color']) # Automatic, unmarked live program.
        mesh.materials.append(material);mesh.polygons[index].material_index=index;originals.append(material)
        oracle=material.copy();tree=oracle.node_tree;sink=next(node for node in tree.nodes if node.type=='OUTPUT_MATERIAL');bsdf=next(node for node in tree.nodes if node.type=='BSDF_PRINCIPLED')
        field=bsdf.inputs['Base Color'].links[0].from_socket
        if case['output']!='control':
            # Native camera field remains the oracle. Pack positive raw values
            # into exact half-representable 8-bit digits; no fitted field table.
            field=packed_field(tree,field,case['bias'])
        emit=tree.nodes.new('ShaderNodeEmission');tree.links.new(field,emit.inputs['Color']);tree.links.new(emit.outputs[0],sink.inputs['Surface']);oracles.append(oracle)

    profile=os.environ.get('BLENDLINK_CAMERA_DATA_PROFILE','ordinary')
    if profile not in {'ordinary','translated','wide','near','close','angular-edge'}:raise ValueError('Unknown Camera Data profile '+profile)
    rig=bpy.data.objects.new('Geometry owner rig',None);scene.collection.objects.link(rig);rig.rotation_euler=(.07,.05,-.03);rig.scale=(1.1,.9,1.2)
    if profile=='translated':rig.location=(48,48,0)
    if profile=='close':rig.scale*=.05
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
    camera.data.lens=2 if profile=='near' else 9.0009 if profile=='angular-edge' else 35;camera.data.sensor_width=36;camera.data.ortho_scale=1.4 if profile=='close' else 28;camera.scale=(1.3,.7,2.1)
    recipe={'schemaVersion':1,'presentation':'realtime','atlases':[{'id':'main','name':'Main','size':256,'targetDensity':8,'margin':4,'fitPolicy':'block','bakeOutput':'lighting'}],
        'states':[{'name':'default'}],'preview':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1},'final':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1}}
    scene['blendlink_recipe']=json.dumps(recipe)
    rows=[];sources=[]
    active_owners=owners[:1] if os.environ.get('BLENDLINK_CAMERA_DATA_SINGLE_OWNER')=='1' else owners
    for owner in owners:owner.hide_render=owner not in active_owners
    with tempfile.TemporaryDirectory(prefix='blendlink-native-geometry-') as temporary:
        for projection in ['PERSP','ORTHO']:
            camera.data.type=projection
            for face in ['front','back']:
                # Reuse one camera action; sampled source keys are the actual
                # authored pose, never substitute browser-only camera metadata.
                camera.animation_data_clear()
                for frame in frames:
                    base=(60,-60,60 if face=='front' else -60) if profile=='wide' else (.3*min(frame,3),-4,3 if face=='front' and profile=='near' else -3 if profile=='near' else 30 if face=='front' else -30)
                    camera.location=rig.location+Vector(base)*(.05 if profile=='close' else 1)
                    camera.rotation_euler=(rig.location-camera.location).to_track_quat('-Z','Y').to_euler()
                    camera.keyframe_insert(data_path='location',frame=frame);camera.keyframe_insert(data_path='rotation_euler',frame=frame)
                if profile=='angular-edge' and projection=='ORTHO':
                    distance=float('inf')
                    for frame in frames:
                        scene.frame_set(frame);bpy.context.view_layer.update()
                        for owner in owners:
                            corners=[owner.matrix_world@Vector(point) for point in owner.bound_box]
                            lower=Vector(tuple(min(point[axis] for point in corners) for axis in range(3)))
                            upper=Vector(tuple(max(point[axis] for point in corners) for axis in range(3)))
                            p=camera.matrix_world.translation
                            distance=min(distance,math.sqrt(sum(max(lower[axis]-p[axis],0,p[axis]-upper[axis])**2 for axis in range(3))))
                    camera.data.ortho_scale=distance*1024/256*.9999
                for engine in reference_engines:
                    scene.render.engine=engine
                    label=('cycles' if engine=='CYCLES' else 'eevee')+'_'+projection.lower()+'_'+face
                    for frame in frames:
                        scene.frame_set(frame);bpy.context.view_layer.update()
                        for data in {owner.data for owner in owners}:
                            for index,material in enumerate(oracles):data.materials[index]=material
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
                                assert max(abs(a-b) for a,b in zip(samples[-1]['rgb'],control_rgb))<(2e-6 if engine=='CYCLES' else .001)
                                rows.append({'source':label,'engine':engine,'projection':projection,'face':face,'frame':frame,'owner':owner.name,'samples':samples,
                                    'objectMatrix':[list(row) for row in owner.matrix_world],'cameraMatrix':[list(row) for row in camera.matrix_world]})
                        finally:
                            for data in {owner.data for owner in owners}:
                                for index,material in enumerate(originals):data.materials[index]=material
                            for owner in owners:owner.hide_render=owner not in active_owners
                    scene.frame_set(1);path=root/(label+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(path));sources.append({'name':label,'file':path.name,'engine':engine})
    for material in oracles:bpy.data.materials.remove(material)
    normal_source=[{'material':mesh.materials[polygon.material_index].name,'position':list(mesh.vertices[mesh.loops[index].vertex_index].co),'normal':list(mesh.corner_normals[index].vector)}
        for polygon in mesh.polygons for index in polygon.loop_indices]
    (root/'native-reference.json').write_text(json.dumps({'blender':bpy.app.version_string,'build':bpy.app.build_hash.decode(),
        'fixtureSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'profile':profile,'sources':sources,'cases':cases,'rows':rows,'normalSource':normal_source,'frames':frames,'ownerCount':len(active_owners),'flatShading':not mesh.polygons[0].use_smooth,'highQualityNormals':scene.render.use_high_quality_normals,
        'requireExactNormals':False,'controlRgb':control_rgb,'packingCalibration':calibration,'nativeGpuBackend':bpy.context.preferences.system.gpu_backend,'rasterTolerance':2e-5,'packing':{'model':'positive-rgb-digits-256-v1','quantizationBound':1/65536,'upperExclusive':256}},indent=2))
    print('BLENDLINK_CAMERA_DATA_REFERENCES_PASSED '+bpy.app.version_string)


unit_check()
if os.environ.get('BLENDLINK_CAMERA_DATA_REFERENCES'):references(os.environ['BLENDLINK_CAMERA_DATA_REFERENCES'])
