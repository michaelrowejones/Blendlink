# SPDX-License-Identifier: GPL-3.0-or-later
"""Fresh CPU fields, independent pre-hash coordinates and actual saved scenes."""
from array import array
from pathlib import Path
import hashlib,json,os,struct,sys
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon/tests'),str(ROOT/'experiments/compositor-white-noise')]
import compositor_graph,compositor_white_noise as helper
from compositor_reference import NativeCompositorReference
from hash_reference import expected,word,f32
DEST=Path(os.environ['SCENETOWEB_WHITE_NOISE_DEFAULT_FIELD_REFERENCES']).resolve();DEST.mkdir(parents=True,exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
case_path=Path(__file__).resolve().with_name('cases.json');DEFINITIONS=json.loads(case_path.read_text())
paths=[Path(__file__).resolve(),Path(__file__).resolve().with_name('policy.py'),case_path,ROOT/'experiments/compositor-white-noise/hash_reference.py',
 ROOT/'packages/blender-addon/tests/compositor_reference.py',ROOT/'packages/blender-addon/tests/compositor_white_noise_fields_check.py',ROOT/'packages/blender-addon/tests/compositor_white_noise_check.py',
 *(ROOT/'packages/blendlink/blender').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.json')]
pins={str(p.relative_to(ROOT)):sha(p)for p in paths}
raw=lambda values:array('f',values)
from_word=lambda value:struct.unpack('=f',struct.pack('=I',value))[0]
rows=[];coordinates=[];axes={};native_renders=0;oracle=None;extent=None

def choose(width,height):
 global oracle,extent
 if extent!=(width,height):
  oracle=NativeCompositorReference(DEST,device='CPU',pixels=np.zeros((height,width,4),np.float32),node_previews=False)
  extent=(width,height)
 return oracle

def capture(label):
 global native_renders
 path=DEST/(label+'.exr');oracle.scene.render.filepath=str(path)
 for node in oracle.tree.nodes:node.show_preview=False
 bpy.ops.render.render(write_still=True);native_renders+=1
 image=bpy.data.images.load(str(path),check_existing=False)
 try:
  assert tuple(image.size)==extent;pixels=array('f',[0])*(extent[0]*extent[1]*4);image.pixels.foreach_get(pixels)
 finally:bpy.data.images.remove(image)
 pixel=DEST/(label+'.rgba32f');pixel.write_bytes(pixels.tobytes())
 return list(struct.unpack('='+str(len(pixels))+'I',pixels.tobytes())),{'pixelFile':pixel.name,'pixelSha256':sha(pixel)}

# These raw witnesses precede every noise graph and come from native cache,
# not a host replacement texture or a browser numerical construction.
for width,height in dict.fromkeys((r['width'],r['height'])for r in DEFINITIONS):
 choose(width,height);sink,_=oracle.reset();image=oracle.tree.nodes.new('CompositorNodeImage');image.image=oracle.image;coordinate=oracle.tree.nodes.new('CompositorNodeImageCoordinates');oracle.tree.links.new(image.outputs['Image'],coordinate.inputs['Image']);oracle.tree.links.new(coordinate.outputs['Uniform'],sink.inputs[0])
 label=f'{width}x{height}-raw-uniform';words,files=capture(label);maximum=max(width,height)
 wanted=[]
 for y in range(height):
  for x in range(width):wanted.extend([word(f32(f32(f32(x+.5)-f32(width/2))/maximum)*2),word(f32(f32(f32(y+.5)-f32(height/2))/maximum)*2),0,word(1)])
 assert words==wanted,(label,'Native coordinate calibration differs from pinned CPU arithmetic')
 coordinates.append({'case':label,'width':width,'height':height,**files});axes[(width,height)]=words

def noise(tree,dimensions,output,w):
 node=tree.nodes.new('ShaderNodeTexWhiteNoise');assert node.noise_dimensions=='2D';node.noise_dimensions=str(dimensions)+'D'
 assert not node.inputs['Vector'].is_linked
 if dimensions==4:node.inputs['W'].default_value=from_word(w)
 return node,node.outputs[output]

for definition in DEFINITIONS:
 width,height=definition['width'],definition['height'];choose(width,height);sink,_=oracle.reset();tree=oracle.tree
 dimension,output,w=definition['dimensions'],definition['output'],definition['seedWWord'];route=definition['route']
 if route=='group-w':
  group=bpy.data.node_groups.new('Artist fixed W field group','CompositorNodeTree');group.interface.new_socket(name='W',in_out='INPUT',socket_type='NodeSocketFloat');group.interface.new_socket(name='Noise',in_out='OUTPUT',socket_type='NodeSocketColor');entry=group.nodes.new('NodeGroupInput');exit=group.nodes.new('NodeGroupOutput');node,value=noise(group,4,'Color',w);reroute=group.nodes.new('NodeReroute');group.links.new(entry.outputs[0],reroute.inputs[0]);group.links.new(reroute.outputs[0],node.inputs['W']);group.links.new(value,exit.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;values=array('f');values.frombytes(struct.pack('=I',w));instance.inputs.foreach_set('default_value',values);terminal=instance.outputs[0]
 elif route=='multi':
  _,a=noise(tree,2,'Value',w);_,b=noise(tree,4,'Value',w);combine=tree.nodes.new('ShaderNodeCombineXYZ')
  for source,target in zip((a,b,a),combine.inputs):tree.links.new(source,target)
  terminal=combine.outputs[0]
 else:node,terminal=noise(tree,dimension,output,w)
 tree.links.new(terminal,sink.inputs[0]);program=compositor_graph.extract(oracle.scene);assert program['status']=='extracted',program
 expected_ops=3 if route=='multi'else 1;assert len(program['ops'])==expected_ops,program
 fields=[op for op in program['ops']if op['kind']=='white-noise-texture'];assert len(fields)==(2 if route=='multi'else 1)
 for field in fields:
  assert field['properties']['white_noise_model']==helper.FIELD_MODEL and field['properties']['white_noise_profile']==helper.FIELD_PROFILE
  assert 'Vector'not in field['inputs']
  if field['properties']['noise_dimensions']==4:assert word(field['inputs']['W']['value']['value'])==w
 label=definition['case'];program_file=DEST/(label+'.program.json');program_file.write_text(json.dumps(program,indent=2)+'\n')
 source_file=DEST/(label+'.blend')if definition['saved']else None
 if source_file:bpy.ops.wm.save_as_mainfile(filepath=str(source_file));source_sha=sha(source_file)
 actual,files=capture(label);wanted=[];source_coordinates=axes[(width,height)]
 for index in range(0,len(source_coordinates),4):
  seed=source_coordinates[index:index+3]
  if route=='multi':wanted.extend([expected(seed[:2],'Value')[0],expected(seed+[w],'Value')[0],expected(seed[:2],'Value')[0],word(1)])
  else:wanted.extend(expected(seed[:2]if dimension==2 else seed if dimension==3 else seed+[w],output))
 assert actual==wanted,(label,'Native hash field differs from independent raw-coordinate/uint reference')
 yy,xx=np.mgrid[:height,:width];control=np.stack([xx/16384,yy/16384,(xx+3*yy)/65536,np.ones_like(xx)],axis=-1).astype(np.float32);input_file=DEST/(label+'.input32f');input_file.write_bytes(control.tobytes())
 row={**definition,**files,'programFile':program_file.name,'programSha256':sha(program_file),'inputFile':input_file.name,'inputSha256':sha(input_file)}
 if source_file:assert sha(source_file)==source_sha;row.update(sourceFile=source_file.name,sourceSha256=source_sha)
 rows.append(row)
# A native field stays an image domain even though its input list is empty.
# This independent native Image Info read is deliberately not exported/admitted.
choose(13,9);sink,_=oracle.reset();node,terminal=noise(oracle.tree,2,'Value',word(.1));info=oracle.tree.nodes.new('CompositorNodeImageInfo');oracle.tree.links.new(terminal,info.inputs['Image']);oracle.tree.links.new(info.outputs['Dimensions'],sink.inputs[0]);source_program=compositor_graph.extract(oracle.scene);assert source_program['status']=='unsupported',source_program
label='13x9-native-image-info-field-domain';actual,files=capture(label);assert all(actual[i:i+4]==[word(13),word(9),0,word(1)]for i in range(0,len(actual),4))
domain={'case':label,'width':13,'height':9,**files,'dimensions':[13,9],'sourceExtractionStatus':'unsupported'}
assert native_renders==63 and len(rows)==54 and len(coordinates)==8
assert pins=={str(path.relative_to(ROOT)):sha(path)for path in paths},'Native sources changed during capture'
report={'schemaVersion':1,'status':'CAPTURED_COMPOSITOR_WHITE_NOISE_DEFAULT_FIELD','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'device':'CPU','sceneEngine':oracle.scene.render.engine,'resultPrecision':'CPU_FLOAT32','sourceHashes':pins,'cases':rows,'coordinateControls':coordinates,'fieldDomainControl':domain,'nativeRenders':native_renders,'wordDifferences':0,'finalCredit':0,'browserCredit':0}
(DEST/'qualification.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(rows),native_renders)
