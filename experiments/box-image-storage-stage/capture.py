# SPDX-License-Identifier: GPL-3.0-or-later
"""Native geometry-stage controls and unchanged actual BOX sampler research."""
import hashlib,json,sys,time
from pathlib import Path
import bpy,numpy as np

ROOT=Path(__file__).resolve().parents[2];args=sys.argv[sys.argv.index('--')+1:]
source,out,upstream=map(lambda p:Path(p).resolve(),args[:3]);schema='--schema-only'in args
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
contract=json.loads((out/'contract.json').read_text());pin=sha(source);assert pin==contract['sourceSha256']
assert bpy.app.version==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
bpy.ops.wm.open_mainfile(filepath=str(source));original_scene=bpy.context.scene
images=[]
for name in ['Image Texture','Image Texture.002']:
    node=bpy.data.materials['Plaster'].node_tree.nodes[name];image=node.image
    assert node.projection=='BOX'and node.projection_blend==contract['blend']and node.interpolation=='Linear'and node.extension=='REPEAT'
    assert tuple(image.size)==(1024,1024)and image.packed_file and not image.is_float
    raw=bytes(image.packed_file.data);assert raw.startswith(b'\x89PNG\r\n\x1a\n');(out/image.name).write_bytes(raw)
    images.append({'name':image.name,'file':image.name,'sha256':sha(out/image.name),'colorSpace':image.colorspace_settings.name,'width':1024,'height':1024})
sys.path.insert(0,str(Path(__file__).parent))
from geometry_fixture import fixture,diagnostic_pixels
scene,owner,camera,cases,activate,native_settings=fixture(original_scene)
(out/'geometry-inputs.json').write_text(json.dumps({'cases':cases,'sourceSettings':native_settings,'source':'Actual native vertices, corner normals, triangle indices, object/camera matrices and camera view frame; not per-pixel GPU answers'},indent=2)+'\n')
source_paths=['source/blender/gpu/intern/gpu_texture_mipmap.cc','source/blender/gpu/shaders/gpu_shader_update_mipmaps.bsl.hh','source/blender/imbuf/intern/util_gpu.cc','source/blender/blenkernel/intern/image_gpu.cc','source/blender/gpu/metal/mtl_texture.mm','source/blender/python/gpu/gpu_py_texture.cc','source/blender/nodes/shader/nodes/node_shader_tex_image.cc','source/blender/draw/intern/draw_pass.hh','source/blender/draw/engines/eevee/eevee_instance.cc']
report={'status':'SOURCE_ONLY_GEOMETRY_INPUTS_NO_GPU'if schema else'running','supportCredit':0,'source':str(source),'sourceSha256':pin,'nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'captureSha256':sha(__file__),'fixtureSha256':sha(Path(__file__).with_name('geometry_fixture.py')),'contractSha256':sha(out/'contract.json'),'geometryInputsSha256':sha(out/'geometry-inputs.json'),'nativeSamplerSourcePins':{str(upstream/p):sha(upstream/p)for p in source_paths},'images':images,'sourceSettings':native_settings,'rows':[],'inputControls':[]}
if not schema:
    import gpu
    sys.path.insert(0,str(ROOT/'experiments/native-f32-oracle-research'))
    from framebuffer_oracle import FramebufferOracle,initialize_metal,calibration
    report['oracleSha256']=sha(ROOT/'experiments/native-f32-oracle-research/framebuffer_oracle.py')
    report['gpu']=initialize_metal();oracle=FramebufferOracle(64);report['storageCalibration']=calibration(oracle)
    oracle.release()
    material=bpy.data.materials.new('Owned BOX normal stage');material.use_nodes=True;t=material.node_tree;t.nodes.clear()
    sink=t.nodes.new('ShaderNodeOutputMaterial');emit=t.nodes.new('ShaderNodeEmission');emit.inputs['Strength'].default_value=1;t.links.new(emit.outputs[0],sink.inputs['Surface'])
    tc=t.nodes.new('ShaderNodeTexCoord');field=t.nodes.new('ShaderNodeTexImage');field.interpolation='Closest';field.extension='EXTEND';t.links.new(tc.outputs['Window'],field.inputs['Vector'])
    fields={}
    for frequency in contract['frequencies']:
        values=np.asarray([[[(x+.5)/64*frequency+.125,.375,.625,1]for x in range(64)]for y in range(4)],np.float32)
        image=bpy.data.images.new('Owned calibrated BOX input '+str(frequency),width=64,height=4,alpha=True,float_buffer=True);image.colorspace_settings.name='Non-Color';image.alpha_mode='STRAIGHT';image.use_half_precision=False;image.pixels.foreach_set(values.ravel());image.update();fields[frequency]=image
    texture=t.nodes.new('ShaderNodeTexImage');texture.projection='BOX';texture.projection_blend=contract['blend'];texture.interpolation='Linear';texture.extension='REPEAT';t.links.new(field.outputs['Color'],texture.inputs['Vector'])
    geometry=t.nodes.new('ShaderNodeNewGeometry');transform=t.nodes.new('ShaderNodeVectorTransform');transform.vector_type='NORMAL';transform.convert_from='WORLD';transform.convert_to='OBJECT';t.links.new(geometry.outputs['Normal'],transform.inputs['Vector'])
    normalized=t.nodes.new('ShaderNodeVectorMath');normalized.operation='NORMALIZE';t.links.new(transform.outputs['Vector'],normalized.inputs[0])
    scale=t.nodes.new('ShaderNodeVectorMath');scale.operation='SCALE';scale.inputs['Scale'].default_value=.5;t.links.new(normalized.outputs['Vector'],scale.inputs[0])
    encoded=t.nodes.new('ShaderNodeVectorMath');encoded.operation='ADD';encoded.inputs[1].default_value=(.5,.5,.5);t.links.new(scale.outputs['Vector'],encoded.inputs[0])
    diagnostic=bpy.data.images.new('Independent BOX plane identity colors',width=8,height=8,alpha=True,float_buffer=True);diagnostic.colorspace_settings.name='Non-Color';diagnostic.alpha_mode='STRAIGHT';diagnostic.use_half_precision=False;diagnostic.pixels.foreach_set(diagnostic_pixels().ravel());diagnostic.update()
    weights=t.nodes.new('ShaderNodeTexImage');weights.image=diagnostic;weights.projection='BOX';weights.projection_blend=contract['blend'];weights.interpolation='Closest';weights.extension='REPEAT';constant=t.nodes.new('ShaderNodeCombineXYZ');constant.inputs['X'].default_value=.1875;constant.inputs['Y'].default_value=.4375;constant.inputs['Z'].default_value=.6875;t.links.new(constant.outputs['Vector'],weights.inputs['Vector'])
    face=t.nodes.new('ShaderNodeAttribute');face.attribute_name='BOXFaceID'
    position=t.nodes.new('ShaderNodeVectorMath');position.operation='SCALE';position.inputs['Scale'].default_value=.03125;t.links.new(geometry.outputs['Position'],position.inputs[0])
    position_encoded=t.nodes.new('ShaderNodeVectorMath');position_encoded.operation='ADD';position_encoded.inputs[1].default_value=(.5,.5,.5);t.links.new(position.outputs['Vector'],position_encoded.inputs[0])
    white=t.nodes.new('ShaderNodeRGB');white.outputs[0].default_value=(1,1,1,1)
    renders=0
    def render(id,signal):
        global renders
        owner.data.materials.clear();owner.data.materials.append(material)
        t.links.new(signal,emit.inputs['Color']);scene.render.filepath=str(out/(id+'.exr'));started=time.perf_counter();bpy.ops.render.render(write_still=True);elapsed=(time.perf_counter()-started)*1000;renders+=1
        im=bpy.data.images.load(scene.render.filepath,check_existing=False);im.use_half_precision=False;assert tuple(im.size)==(64,4);v=np.empty(1024,np.float32);im.pixels.foreach_get(v);bpy.data.images.remove(im);assert np.isfinite(v).all()
        file=id+'.rgba32f';(out/file).write_bytes(v.astype('<f4').tobytes());row={'id':id,'file':file,'sha256':sha(out/file),'words':1024,'milliseconds':elapsed}
        report.setdefault('completedRenderOutputs',[]).append(row);report['rendersCompleted']=renders
        (out/'partial.json').write_text(json.dumps(report,indent=2)+'\n')
        return row,v.reshape(4,64,4)
    masks={}
    for profile in contract['profiles']:
        scene.render.use_high_quality_normals=profile=='SNORM16'
        for case in cases:
            activate(case['id'])
            for kind,signal in [('mask',white.outputs['Color']),('normal',encoded.outputs['Vector']),('weights',weights.outputs['Color']),('face',face.outputs['Color']),('position',position_encoded.outputs['Vector'])]:
                row,values=render(profile+'-'+case['id']+'-'+kind,signal);report['rows'].append({**row,'profile':profile,'case':case['id'],'kind':kind})
                if kind=='mask':
                    if not np.any(values[:,:,:3]>0):raise AssertionError('Source geometry case has no visible coverage: '+case['id'])
                    masks[(profile,case['id'])]=values.copy()
    primary=native_settings['normalStorage'];scene.render.use_high_quality_normals=primary=='SNORM16'
    for case in cases:
        activate(case['id']);field.image=fields[8];row,values=render(primary+'-'+case['id']+'-input',field.outputs['Color'])
        mask=masks[(primary,case['id'])];binary=np.all((mask[:,:,:3]==0)|(mask[:,:,:3]==1))and np.array_equal(mask[:,:,0],mask[:,:,1])and np.array_equal(mask[:,:,0],mask[:,:,2])
        expected=np.asarray([[[(x+.5)/64*8+.125,.375,.625,1]for x in range(64)]for y in range(4)],np.float32)
        expected[:,:,:3]*=mask[:,:,:1]
        error=int(np.count_nonzero(values.view(np.uint32)!=expected.view(np.uint32)))
        report['inputControls'].append({**row,'case':case['id'],'binaryCoverage':bool(binary),'wordDifferences':error})
        if not binary or error:raise AssertionError('Independent exact input/coverage control failed for '+case['id'])
        for image in images:
            texture.image=bpy.data.images[image['name']]
            for frequency in contract['frequencies']:
                field.image=fields[frequency];id=primary+'-'+case['id']+'-'+image['name']+'-'+str(frequency)
                row,_=render(id,texture.outputs['Color']);report['rows'].append({**row,'profile':primary,'case':case['id'],'kind':'sampler','image':image['name'],'frequency':frequency})
    oracle=FramebufferOracle(64)
    # Public native from_image observation, before any image.pixels access.
    report['textureObservations']=[];report['lodRows']=[]
    for entry in images:
        print('OBSERVE before_from_image '+entry['name'],flush=True);image=bpy.data.images[entry['name']];tex=gpu.texture.from_image(image);print('OBSERVE texture_created '+str(tex.format),flush=True)
        report['textureObservations'].append({'image':image.name,'isFloat':image.is_float,'depth':image.depth,'channels':image.channels,'alphaMode':image.alpha_mode,'colorSpace':image.colorspace_settings.name,'useHalfPrecision':image.use_half_precision,'gpuFormat':tex.format,'gpuWidth':tex.width,'gpuHeight':tex.height})
        for level in range(11):
            print('OBSERVE level '+str(level),flush=True)
            size_shader=oracle.compile('void main(){ivec2 s=textureSize(sourceTex,int(levelValue.x));fragColor=vec4(vec2(s),0,1);}',samplers=['sourceTex'],uniforms=['levelValue'])
            actual_size=oracle.draw(size_shader,samplers={'sourceTex':tex},uniforms={'levelValue':[level,0,0,0]})[0,:2].astype(int).tolist()
            assert actual_size==[max(1,1024>>level)]*2
            report['textureObservations'][-1].setdefault('observedMipSizes',[]).append(actual_size)
            for kind in ['fetch','linear']:
                expression='texelFetch(sourceTex,ivec2(floor(uv*vec2(size))),level)'if kind=='fetch'else'textureLod(sourceTex,uv,float(level))'
                body='void main(){int level=int(levelValue.x);ivec2 size=textureSize(sourceTex,level);vec2 uv=vec2(fract((gl_FragCoord.x-0.5)*0.137+0.1875),0.37109375);fragColor='+expression+';}'
                shader=oracle.compile(body,samplers=['sourceTex'],uniforms=['levelValue'])
                values=oracle.draw(shader,samplers={'sourceTex':tex},uniforms={'levelValue':[level,0,0,0]})
                id=entry['name']+'-lod-'+str(level)+'-'+kind;file=id+'.rgba32f';(out/file).write_bytes(values.astype('<f4').tobytes())
                report['lodRows'].append({'id':id,'image':entry['name'],'level':level,'kind':kind,'file':file,'sha256':sha(out/file),'words':256,'size':[max(1,1024>>level)]*2})
        del tex
    (out/'texture-observations.json').write_text(json.dumps({'textures':report['textureObservations'],'rows':report['lodRows']},indent=2)+'\n')
    oracle.release()
    report['actualEeveeRenders']=renders;report['status']='CAPTURED_BOX_STORAGE_STAGE_RESEARCH'
assert sha(source)==pin
report['sourcePreserved']=True
(out/'native.json').write_text(json.dumps(report,indent=2)+'\n')
print('SCENETOWEB_BOX_NORMAL_STAGE '+json.dumps({'status':report['status'],'cases':len(cases),'sourceSettings':native_settings,'rows':len(report['rows']),'supportCredit':0}))
