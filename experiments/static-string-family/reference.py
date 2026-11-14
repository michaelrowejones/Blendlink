# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual native static strings, logical witnesses and exact encoded integer pixels."""
import bpy,gpu,json,os,sys,hashlib
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'packages/blendlink/dist/blender'),str(ROOT/'packages/blendlink/dist/addon'),str(Path(__file__).parent)]
import tsl_ir,compositor_graph,static_strings
from cases import cases,build,encode,parser_witness_endpoints
from artifact_closure import native_artifact_closure
OUT=Path(os.environ['SCENETOWEB_STRINGS_REFERENCES']).resolve();OUT.mkdir(parents=True,exist_ok=True);CONTEXT=os.environ['SCENETOWEB_STRINGS_CONTEXT'];assert CONTEXT in ['shader','CPU','GPU']
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
packaging=native_artifact_closure(ROOT)
source_files=sorted(set(packaging['sourceFiles'])|{'experiments/static-string-family/cases.json','experiments/static-string-family/cases.py','experiments/static-string-family/artifact_closure.py','experiments/static-string-family/reference.py','experiments/static-string-family/numeric-contract.json','packages/blender-addon/tests/static_string_family_policy.py'})
source_hashes={p:sha(ROOT/p)for p in source_files};artifact_inputs=packaging['artifactInputs']
for entry in artifact_inputs:assert sha(ROOT/entry['source'])==sha(ROOT/entry['artifact'])==entry['sha256'],'Staged helper differs '+entry['artifact']
for target,expected in packaging['inventories'].items():
    actual=sorted(p.name for p in(ROOT/'packages/blendlink/dist'/target).iterdir()if p.suffix in{'.py','.json'})
    assert actual==expected,('Native staging inventory differs from independent AST closure',target,actual,expected)
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=1;scene.world=None
scene.render.resolution_x=scene.render.resolution_y=SIZE=8;scene.render.resolution_percentage=100;scene.render.dither_intensity=0
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32';scene.view_settings.view_transform='Raw';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1;scene.render.use_compositing=CONTEXT!='shader'
if CONTEXT!='shader':scene.render.compositor_device=CONTEXT;scene.render.compositor_precision='FULL'
bpy.ops.mesh.primitive_plane_add(size=2);owner=bpy.context.object;owner.name='Artist static text controls';owner['blendlink_id']='static-string-owner'
camera_data=bpy.data.cameras.new('Artist text-control camera');camera_data.type='ORTHO';camera_data.ortho_scale=2;camera=bpy.data.objects.new(camera_data.name,camera_data);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera
if CONTEXT!='shader':
    material=bpy.data.materials.new('Source plate');material.use_nodes=True;surface=next(n for n in material.node_tree.nodes if n.bl_idname=='ShaderNodeBsdfPrincipled');surface.inputs['Base Color'].default_value=(.125,.25,.5,1);owner.data.materials.append(material)

def state(tree):
    def value(socket):
        v=getattr(socket,'default_value',None);return v if v is None or isinstance(v,(str,bool,int,float))else tuple(v)
    records=[];seen=set()
    def visit(target):
        if target.as_pointer()in seen:return
        seen.add(target.as_pointer())
        records.append((target.name,[(n.bl_idname,n.name,n.mute,n.string if n.bl_idname=='FunctionNodeInputString'else None,[(s.identifier,value(s))for s in n.inputs],[(s.identifier,value(s))for s in n.outputs])for n in target.nodes],sorted((l.from_node.name,l.from_socket.identifier,l.to_node.name,l.to_socket.identifier)for l in target.links)))
        for node in target.nodes:
            if getattr(node,'node_tree',None):visit(node.node_tree)
    visit(tree);return repr(records)

def render(label,golden):
    scene.render.filepath=str(OUT/(label+'.exr'));bpy.ops.render.render(write_still=True);image=bpy.data.images.load(scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL';actual=np.empty(SIZE*SIZE*4,np.float32);image.pixels.foreach_get(actual);bpy.data.images.remove(image);actual=actual.reshape(SIZE,SIZE,4)
    expected=np.empty_like(actual);expected[:]=[(golden%256)/256,(golden//256)/256,.25,1];assert np.array_equal(actual.view(np.uint32),expected.view(np.uint32)),(label,golden,actual[0,0].tolist(),expected[0,0].tolist())
    decoded=actual[:,:,0]*256+actual[:,:,1]*65536;assert np.array_equal(decoded,np.full((SIZE,SIZE),golden,np.float32)),(label,decoded)
    path=OUT/(label+'.rgba32f');actual.tofile(path);return{'pixelFile':path.name,'pixelSha256':sha(path),'decodedInt':int(decoded[0,0])}

rows=[]
for spec in cases(CONTEXT):
    name=spec['case']
    if CONTEXT=='shader':
        material=bpy.data.materials.new('Static string '+name);material.use_nodes=True;tree=material.node_tree;tree.nodes.clear();sink=tree.nodes.new('ShaderNodeOutputMaterial');root=tree.nodes.new('ShaderNodeBsdfPrincipled');tree.links.new(root.outputs[0],sink.inputs['Surface']);owner.data.materials.clear();owner.data.materials.append(material);target=root.inputs['Base Color']
    else:
        tree=bpy.data.node_groups.new('Static string '+name,'CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree;sink=tree.nodes.new('NodeGroupOutput');target=sink.inputs[0]
    scalar,text=build(tree,spec,CONTEXT);entry=dict(spec,context=CONTEXT)
    if spec['kind']=='parse':
        raw,consumed=parser_witness_endpoints(scalar,text,spec['witness'])
        record=static_strings.evaluate_output(raw);length_record=static_strings.evaluate_output(consumed)
        assert record['type']=='INT'and record['value']==spec['expectedValue']and length_record['value']==spec['expectedLength'],(name,record,length_record)
        entry.update(helperValue=record['value'],helperConsumed=length_record['value'],helperType=record['type'],helperSources=record['sources'])
    if text:
        record=static_strings.evaluate_output(text);assert record['value']==spec['expectedString'],(name,record,spec['expectedString']);entry.update(helperText=record['value'],helperSources=record['sources'])
    elif spec['kind']=='match':
        original=scalar.node.inputs['Switch'].links[0].from_socket;record=static_strings.evaluate_output(original)
        assert record['type']=='BOOLEAN' and record['value'] is spec['expectedBool'],(name,record,spec['expectedBool'])
        entry.update(helperBoolean=record['value'],helperType=record['type'],helperSources=record['sources'])
    elif spec['kind']=='scalar':
        record=static_strings.evaluate_output(scalar);assert record['value']==spec['expectedInt'];entry.update(helperScalar=record['value'],helperSources=record['sources'])
    elif spec['kind']=='selector':
        original=scalar.node.inputs[0].links[0].from_socket;record=static_strings.evaluate_output(original);assert record['value']==spec['expectedSelector'];entry.update(helperSelector=record['value'],helperSources=record['sources'])
    signal=encode(tree,scalar);tree.links.new(signal,target)
    if CONTEXT=='shader':program=tsl_ir.emit_channel(target,evaluation_engine='EEVEE')
    else:program=compositor_graph.extract(scene);assert program['status']=='extracted',program
    def no_string_payload(value):
        if isinstance(value,dict):
            assert not(value.get('kind')=='constant'and value.get('type')=='STRING')and not(value.get('op')=='typed_const'and value.get('type')=='STRING')
            for child in value.values():no_string_payload(child)
        elif isinstance(value,list):
            for child in value:no_string_payload(child)
    no_string_payload(program)
    before=state(tree);path=OUT/(name+'.program.json');path.write_text(json.dumps(program,indent=2)+'\n');entry.update(programFile=path.name,programSha256=sha(path))
    if spec.get('saved'):
        path=OUT/(name+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(path));entry.update(sourceFile=path.name,sourceSha256=sha(path))
    if CONTEXT=='shader':
        created=set(tree.nodes);emission=tree.nodes.new('ShaderNodeEmission');tree.links.new(signal,emission.inputs['Color']);tree.links.new(emission.outputs[0],sink.inputs['Surface']);entry.update(render(name,spec['expectedInt']));tree.links.new(root.outputs[0],sink.inputs['Surface'])
        for node in list(tree.nodes):
            if node not in created:tree.nodes.remove(node)
    else:entry.update(render(name,spec['expectedInt']))
    assert state(tree)==before,name
    if spec.get('saved'):assert sha(OUT/entry['sourceFile'])==entry['sourceSha256']
    entry['sourcePreserved']=True;rows.append(entry)
assert source_hashes=={p:sha(ROOT/p)for p in source_files}
native_backend=({'evaluator':'EEVEE','requestedDevice':'shader','backend':gpu.platform.backend_type_get(),'renderer':gpu.platform.renderer_get()} if CONTEXT=='shader' else {'evaluator':'CPU-MF','requestedDevice':CONTEXT,'backend':None,'renderer':None})
packet={'status':'CAPTURED_STATIC_STRINGS','context':CONTEXT,'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'nativeBackend':native_backend,'nativeStringStage':'Native host static string evaluation; compositor single-value scalar arithmetic uses CPU-MF even for GPU-authored settings. Shader scalar carrier runs EEVEE; no GPU string kernel claim.','sourcePreserved':True,'width':SIZE,'height':SIZE,'cases':rows,'sourceHashes':source_hashes,'artifactInputs':artifact_inputs,'nativePackaging':packaging}
(OUT/'qualification.json').write_text(json.dumps(packet,indent=2)+'\n');print('SCENETOWEB_STATIC_STRINGS_NATIVE_PASSED',CONTEXT,len(rows),'saved',sum('sourceFile'in r for r in rows))
