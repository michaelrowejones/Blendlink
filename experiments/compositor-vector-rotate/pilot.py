# SPDX-License-Identifier: GPL-3.0-or-later
"""Owned actual CPU compositor pilot; original math and Render Layers unchanged."""
from array import array
from pathlib import Path
import hashlib,json,struct,sys
import bpy,gpu
ROOT=Path(__file__).resolve().parents[2];OUT=Path(sys.argv[sys.argv.index('--')+1]).resolve()
calls=[0]
def deny(*args,**kwargs):calls[0]+=1;raise RuntimeError('Vector Rotate pilot denies GPU initialization')
gpu.init=deny
try:gpu.init()
except RuntimeError:pass
else:raise AssertionError('GPU guard absent')
calls[0]=0
sys.path[:0]=[str(ROOT/'packages/blender-addon/tests'),str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
from compositor_reference import NativeCompositorReference
from compositor_static_euler import _hash_word
import compositor_graph
import numpy as np
source_only='--source-only'in sys.argv
plan=json.loads(Path(__file__).with_name('cases.json').read_text());oracle=NativeCompositorReference(OUT,device='CPU',name='Owned Vector Rotate pilot',node_previews=False)
scene=oracle.scene;tree=oracle.tree;rows=[];controls=[];groups=[]
sha=lambda data:hashlib.sha256(data).hexdigest()
def save_bytes(name,data):
 path=OUT/name
 if path.exists():assert path.read_bytes()==data,'Immutable pilot artifact changed: '+name
 else:path.write_bytes(data)
 return {'file':name,'sha256':sha(data),'bytes':len(data)}
def render(label,signal,sink,width,height):
 tree.links.new(signal,sink.inputs[0]);scene.render.filepath=str(OUT/(label+'.exr'))
 for node in tree.nodes:node.show_preview=False
 bpy.ops.render.render(write_still=True)
 image=bpy.data.images.load(scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL'
 try:
  assert tuple(image.size)==(width,height),(label,tuple(image.size),width,height)
  data=array('f',[0])*(width*height*4);image.pixels.foreach_get(data);return data
 finally:bpy.data.images.remove(image)
def create(spec):
 scene.render.resolution_x=spec['width'];scene.render.resolution_y=spec['height'];sink,source=oracle.reset()
 node=tree.nodes.new('ShaderNodeVectorRotate');node.rotation_type=spec['mode'];node.invert=spec['invert'];node.inputs['Angle'].default_value=spec['angle'];node.inputs['Center'].default_value=spec['center'];node.inputs['Vector'].default_value=spec.get('vector',[0,0,0])
 if spec['kind']=='normalized':
  coordinates=tree.nodes.new('CompositorNodeImageCoordinates');tree.links.new(source.outputs['Image'],coordinates.inputs['Image']);tree.links.new(coordinates.outputs['Normalized'],node.inputs['Vector'])
 signal=node.outputs['Vector']
 if spec.get('group'):
  group=bpy.data.node_groups.new('Owned grouped Vector Rotate','CompositorNodeTree');groups.append(group);group.interface.new_socket(name='Vector',in_out='INPUT',socket_type='NodeSocketVector');group.interface.new_socket(name='Vector',in_out='OUTPUT',socket_type='NodeSocketVector');entry=group.nodes.new('NodeGroupInput');out=group.nodes.new('NodeGroupOutput');inner=group.nodes.new('ShaderNodeVectorRotate');inner.rotation_type=spec['mode'];inner.invert=spec['invert'];inner.inputs['Angle'].default_value=spec['angle'];inner.inputs['Center'].default_value=spec['center'];group.links.new(entry.outputs[0],inner.inputs['Vector']);group.links.new(inner.outputs[0],out.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;tree.links.new(coordinates.outputs['Normalized'],instance.inputs[0]);route=tree.nodes.new('NodeReroute');tree.links.new(instance.outputs[0],route.inputs[0]);signal=route.outputs[0]
 tree.links.new(signal,sink.inputs[0]);return sink,signal
def hash_carriers(signal):
 separate=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(signal,separate.inputs[0]);low=tree.nodes.new('CompositorNodeCombineColor');high=tree.nodes.new('CompositorNodeCombineColor');low.mode=high.mode='RGB'
 for lane,component in enumerate(separate.outputs):
  hash_node=tree.nodes.new('FunctionNodeHashValue');hash_node.data_type='FLOAT';hash_node.inputs['Seed'].default_value=0;tree.links.new(component,next(s for s in hash_node.inputs if s.name=='Value'and s.enabled and not s.is_unavailable))
  lo=tree.nodes.new('FunctionNodeBitMath');lo.operation='AND';lo.inputs['B'].default_value=65535;tree.links.new(hash_node.outputs['Hash'],lo.inputs['A'])
  hi=tree.nodes.new('FunctionNodeIntegerMath');hi.operation='DIVIDE_FLOOR';hi.inputs[1].default_value=65536;tree.links.new(hash_node.outputs['Hash'],hi.inputs[0]);tree.links.new(lo.outputs[0],low.inputs[lane]);tree.links.new(hi.outputs[0],high.inputs[lane])
 return low.outputs[0],high.outputs[0]

# Independent native integer Pixel control establishes the CPU file/domain
# orientation before interpreting any rotation output; no rotation-fit flip.
for width,height in ([]if source_only else sorted({(case['width'],case['height'])for case in plan['cases']})):
 scene.render.resolution_x=width;scene.render.resolution_y=height;sink,source=oracle.reset();node=tree.nodes.new('CompositorNodeImageCoordinates');tree.links.new(source.outputs['Image'],node.inputs['Image']);data=render('pixel-'+str(width)+'x'+str(height),node.outputs['Pixel'],sink,width,height);values=np.asarray(data,np.float32).reshape(height,width,4)
 forward=all(values[y,0,1]==y for y in range(height));backward=all(values[y,0,1]==height-1-y for y in range(height));assert forward!=backward
 assert all(values[y,x,0]==x and values[y,x,2]==0 and values[y,x,3]==1 for y in range(height)for x in range(width))
 controls.append({'width':width,'height':height,'nativeDomainFlipY':backward,**save_bytes('pixel-'+str(width)+'x'+str(height)+'.rgba32f',data.tobytes())})

for spec in plan['cases']:
 width,height=spec['width'],spec['height'];sink,signal=create(spec);program=compositor_graph.extract(scene);assert program['status']=='extracted',program
 program_data=(json.dumps(program,sort_keys=True,separators=(',',':'))+'\n').encode();program_pin=save_bytes(spec['case']+'.program.json',program_data)
 if source_only:
  rows.append({**spec,'program':program_pin});continue
 raw=render(spec['case'],signal,sink,width,height);words=np.frombuffer(raw.tobytes(),np.uint32).reshape(height,width,4);absolute=words&0x7fffffff
 assert np.all((absolute==0)|((absolute>=0x00800000)&(absolute<0x7f800000)))and not np.any(words==0x80000000)
 assert np.all(words[:,:,3]==0x3f800000)
 low,high=hash_carriers(signal);lo=render(spec['case']+'-hash-low',low,sink,width,height);hi=render(spec['case']+'-hash-high',high,sink,width,height);lo_values=np.asarray(lo,np.float32).reshape(-1,4);hi_values=np.asarray(hi,np.float32).reshape(-1,4)
 hashes=[]
 for pixel,row in enumerate(words.reshape(-1,4)):
  for lane in range(3):
   lower=int(lo_values[pixel,lane]);upper=int(hi_values[pixel,lane]);assert lower==lo_values[pixel,lane]and upper==hi_values[pixel,lane]and 0<=lower<65536 and -32768<=upper<32768
   actual=((upper&65535)<<16)|lower;assert actual==_hash_word(int(row[lane])),(spec['case'],pixel,lane,int(row[lane]),actual);hashes.append(actual)
 control=next(row for row in controls if row['width']==width and row['height']==height)
 if spec.get('axesControl'):
  floats=words.view(np.float32)
  for y in range(height):
   domain_y=height-1-y if control['nativeDomainFlipY']else y
   for x in range(width):assert tuple(floats[y,x])==(np.float32((x+.5)/width),np.float32((domain_y+.5)/height),0,1),(spec['case'],x,y,floats[y,x])
 rows.append({**spec,'program':program_pin,'pixels':save_bytes(spec['case']+'.rgba32f',raw.tobytes()),'preStoreLow':save_bytes(spec['case']+'-hash-low.rgba32f',lo.tobytes()),'preStoreHigh':save_bytes(spec['case']+'-hash-high.rgba32f',hi.tobytes()),'preStoreHashes':save_bytes(spec['case']+'-hashes.u32',struct.pack('='+str(len(hashes))+'I',*hashes))})
assert calls[0]==0
report={'status':'CAPTURED_VECTOR_ROTATE_SOURCE_PILOT'if source_only else'CAPTURED_VECTOR_ROTATE_NATIVE_PILOT','supportCredit':0,'FinalCredit':0,'browserCredit':0,'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'sceneEngine':scene.render.engine,'device':'CPU','precision':'FULL','gpuInitializations':calls[0],'cases':rows,'pixelControls':controls,'nativeRenders':0 if source_only else len(rows)*3+len(controls),'preStoreComponentWords':0 if source_only else sum(case['width']*case['height']*3 for case in rows),'hashCarrier':'unchanged native Float Hash Value before output materialization; exact unsigned low16/signed high16 CPU RGBA32F carriers','renderLayersInput':'original direct Render Layers retained; no input replacement or math mutation'}
(OUT/('source.json'if source_only else'native.json')).write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(rows),report['nativeRenders'])
