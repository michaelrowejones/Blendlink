# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual CPU Wave fields, independent native coordinates and saved source files."""
from array import array
from pathlib import Path
import hashlib,json,math,os,struct,sys
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon/tests'),str(ROOT/'experiments/compositor-white-noise')]
import compositor_graph,compositor_wave_axis as helper
from compositor_reference import NativeCompositorReference
from hash_reference import expected,word,f32
DEST=Path(os.environ['SCENETOWEB_WAVE_AXIS_REFERENCES']).resolve();DEST.mkdir(parents=True,exist_ok=True)
sha=lambda path:hashlib.sha256(Path(path).read_bytes()).hexdigest()
case_path=Path(__file__).with_name('cases.json');DEFINITIONS=json.loads(case_path.read_text())
paths=[Path(__file__).resolve(),Path(__file__).with_name('policy.py'),case_path,Path(__file__).with_name('protocol.mjs'),Path(__file__).with_name('sources.json'),ROOT/'experiments/compositor-white-noise/hash_reference.py',ROOT/'experiments/compositor-white-noise/protocol.mjs',ROOT/'experiments/compositor-white-noise/cases.json',ROOT/'packages/blender-addon/tests/compositor_reference.py',ROOT/'packages/blender-addon/tests/compositor_wave_axis_check.py',*(ROOT/'packages/blendlink/blender').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.json')]
pins={str(path.relative_to(ROOT)):sha(path)for path in paths}
from_word=lambda value:struct.unpack('=f',struct.pack('=I',value))[0]
rows=[];coordinates=[];axes={};native_renders=0;oracle=None;extent=None;zero_words=one_words=0

def choose(width,height):
 global oracle,extent
 if extent!=(width,height):
  oracle=NativeCompositorReference(DEST,device='CPU',pixels=np.zeros((height,width,4),np.float32),node_previews=False)
  extent=(width,height)
 return oracle

def capture(label):
 global native_renders
 path=DEST/(label+'.exr');oracle.scene.render.filepath=str(path)
 for tree in bpy.data.node_groups:
  for node in tree.nodes:node.show_preview=False
 bpy.ops.render.render(write_still=True);native_renders+=1
 image=bpy.data.images.load(str(path),check_existing=False)
 try:
  assert tuple(image.size)==extent
  pixels=array('f',[0])*(extent[0]*extent[1]*4);image.pixels.foreach_get(pixels)
 finally:bpy.data.images.remove(image)
 pixel=DEST/(label+'.rgba32f');pixel.write_bytes(pixels.tobytes())
 return list(struct.unpack('='+str(len(pixels))+'I',pixels.tobytes())),{'pixelFile':pixel.name,'pixelSha256':sha(pixel)}

# Independent native Image Coordinates, before any Wave computation. The CPU
# stage uses exact half-centres and Float32 division, not a host output texture.
for width,height in dict.fromkeys((r['width'],r['height'])for r in DEFINITIONS):
 choose(width,height);sink,_=oracle.reset();image=oracle.tree.nodes.new('CompositorNodeImage');image.image=oracle.image
 coordinate=oracle.tree.nodes.new('CompositorNodeImageCoordinates');oracle.tree.links.new(image.outputs['Image'],coordinate.inputs['Image']);oracle.tree.links.new(coordinate.outputs['Uniform'],sink.inputs[0])
 label=f'{width}x{height}-raw-uniform';words,files=capture(label);maximum=max(width,height);wanted=[]
 for y in range(height):
  for x in range(width):wanted.extend([word(f32(f32(f32(x+.5)-f32(width/2))/maximum)*2),word(f32(f32(f32(y+.5)-f32(height/2))/maximum)*2),0,word(1)])
 assert words==wanted,(label,'Native coordinate calibration differs from pinned CPU arithmetic')
 coordinates.append({'case':label,'width':width,'height':height,**files});axes[(width,height)]=words

def wave(tree,row,output=None):
 node=tree.nodes.new('ShaderNodeTexWave');assert node.wave_type=='BANDS' and node.bands_direction=='X' and node.wave_profile=='SIN'
 node.bands_direction=row['axis'];node.wave_profile=row['profile']
 controls=[node.inputs[name]for name in('Scale','Phase Offset','Distortion')]
 if row['parameterWords']!=[word(5),0,0]:
  for socket,bits in zip(controls,row['parameterWords']):socket.default_value=from_word(bits)
 assert [record[0]for record in helper._raw(controls,'VALUE')]==row['parameterWords']
 return node,node.outputs[output or row['output']]

def factor(coordinate,row):
 # Independent source-law interpreter, never a production row-builder import.
 scale,phase=map(from_word,row['parameterWords'][:2])
 scaled=f32(coordinate*scale);offset=f32(scaled+f32(.000001));shrink=f32(offset*f32(.999999));argument=f32(f32(shrink*20)+phase);cycles=f32(argument/(math.pi*2))
 return f32(cycles-math.floor(cycles))if row['profile']=='SAW'else f32(abs(f32(cycles-math.floor(f32(cycles+.5))))*2)

for definition in DEFINITIONS:
 width,height=definition['width'],definition['height'];choose(width,height);sink,_=oracle.reset();tree=oracle.tree;route=definition['route']
 if route=='group-reroute':
  group=bpy.data.node_groups.new('Artist Wave group','CompositorNodeTree');group.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');exit=group.nodes.new('NodeGroupOutput');node,terminal=wave(group,definition);reroute=group.nodes.new('NodeReroute');group.links.new(terminal,reroute.inputs[0]);group.links.new(reroute.outputs[0],exit.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;terminal=instance.outputs[0]
 elif route in {'shared','mixed-white-noise'}:
  node,a=wave(tree,definition,'Fac')
  if route=='shared':_,b=wave(tree,definition,'Fac')
  else:
   white=tree.nodes.new('ShaderNodeTexWhiteNoise');assert white.noise_dimensions=='2D';b=white.outputs['Value']
  combine=tree.nodes.new('ShaderNodeCombineXYZ')
  for source,target in zip((a,b,a),combine.inputs):tree.links.new(source,target)
  terminal=combine.outputs[0]
 else:node,terminal=wave(tree,definition)
 tree.links.new(terminal,sink.inputs[0]);before_ownership=(len(bpy.data.node_groups),[(g.as_pointer(),g.users)for g in bpy.data.node_groups]);before_frame=(oracle.scene.frame_current,oracle.scene.frame_subframe)
 program=compositor_graph.extract(oracle.scene)
 assert program['status']=='extracted',program
 assert before_ownership==(len(bpy.data.node_groups),[(g.as_pointer(),g.users)for g in bpy.data.node_groups])and before_frame==(oracle.scene.frame_current,oracle.scene.frame_subframe)
 fields=[op for op in program['ops']if op['kind']=='wave-texture'];assert len(fields)==(2 if route=='shared'else 1)
 assert len(helper.table_keys(program['ops']))==1
 for field in fields:assert field['properties']['wave_axis_model']==helper.MODEL and field['properties']['wave_axis_parameter_words']==definition['parameterWords'] and 'Vector'not in field['inputs']
 label=definition['case'];program_file=DEST/(label+'.program.json');program_file.write_text(json.dumps(program,indent=2)+'\n')
 source_file=DEST/(label+'.blend')if definition['saved']else None
 if source_file:bpy.ops.wm.save_as_mainfile(filepath=str(source_file));source_sha=sha(source_file)
 actual,files=capture(label);source_coordinates=axes[(width,height)];wanted=[]
 for index in range(0,len(source_coordinates),4):
  coordinate=source_coordinates[index:index+3];a=word(factor(from_word(coordinate[0 if definition['axis']=='X'else 1]),definition));b=expected(coordinate[:2],'Value')[0]if route=='mixed-white-noise'else a;wanted.extend([a,b,a,word(1)])
 assert actual==wanted,(label,'Native Wave differs from independent calibrated-coordinate source stages')
 zero_words+=sum(bit==0 for i,bit in enumerate(actual)if i%4!=3);one_words+=sum(bit==word(1)for i,bit in enumerate(actual)if i%4!=3)
 yy,xx=np.mgrid[:height,:width];control=np.stack([xx/16384,yy/16384,(xx+3*yy)/65536,np.ones_like(xx)],axis=-1).astype(np.float32);input_file=DEST/(label+'.input32f');input_file.write_bytes(control.tobytes())
 row={**definition,**files,'programFile':program_file.name,'programSha256':sha(program_file),'inputFile':input_file.name,'inputSha256':sha(input_file),'sourceOwnershipPreserved':True}
 if source_file:assert sha(source_file)==source_sha;row.update(sourceFile=source_file.name,sourceSha256=source_sha)
 rows.append(row)
# The field remains a real image domain; no Image Info runtime admission follows.
choose(13,9);sink,_=oracle.reset();node,terminal=wave(oracle.tree,DEFINITIONS[0]);info=oracle.tree.nodes.new('CompositorNodeImageInfo');oracle.tree.links.new(terminal,info.inputs['Image']);oracle.tree.links.new(info.outputs['Dimensions'],sink.inputs[0]);source_program=compositor_graph.extract(oracle.scene);assert source_program['status']=='unsupported'
label='13x9-native-wave-image-info-field-domain';actual,files=capture(label);assert all(actual[i:i+4]==[word(13),word(9),0,word(1)]for i in range(0,len(actual),4))
domain={'case':label,'width':13,'height':9,**files,'dimensions':[13,9],'sourceExtractionStatus':'unsupported'}
assert native_renders==len(DEFINITIONS)+len(coordinates)+1
assert pins=={str(path.relative_to(ROOT)):sha(path)for path in paths},'Native sources changed during capture'
report={'schemaVersion':1,'status':'CAPTURED_COMPOSITOR_WAVE_AXIS','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'device':'CPU','sceneEngine':oracle.scene.render.engine,'resultPrecision':'CPU_FLOAT32','sourceHashes':pins,'cases':rows,'coordinateControls':coordinates,'fieldDomainControl':domain,'nativeRenders':native_renders,'wordDifferences':0,'nativeZeroRgbWords':zero_words,'nativeOneRgbWords':one_words,'finalCredit':0,'browserCredit':0}
(DEST/'qualification.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(rows),native_renders)
