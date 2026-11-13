# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_COMPOSITOR_INTEGER_BITS_CHECK_PASSED
"""Native signed-int32 oracle; independent integer arithmetic transports all32bits."""
import hashlib,json,os,sys,tempfile
from pathlib import Path
import bpy
import numpy as np
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'packages/blendlink/blender'));sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
import compositor_graph
import compositor_integer_bits as helper
from compositor_reference import NativeCompositorReference
DEVICE=os.environ.get('SCENETOWEB_INTEGER_DEVICE','CPU');DEST=os.environ.get('SCENETOWEB_INTEGER_REFERENCES')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
i32=lambda x:((x+2**31)%2**32)-2**31

def rot(x,n):
 n%=32;u=x%2**32
 return i32(((u<<n)|(u>>(32-n if n else 32)))%(2**32))
def bit(mode,a,b):
 return {'AND':lambda:i32(a&b),'OR':lambda:i32(a|b),'XOR':lambda:i32(a^b),'NOT':lambda:i32(~a),'SHIFT':lambda:0 if abs(b)>31 else i32((a%2**32)<<b) if b>=0 else (a%2**32)>>-b,'ROTATE':lambda:rot(a,b)}[mode]()
def hash1(*keys):
 mask=2**32-1;a=b=c=(0xdeadbeef+(len(keys)<<2)+13)&mask
 a=(a+keys[0])&mask
 if len(keys)>1:b=(b+keys[1])&mask
 def r(x,n):return ((x<<n)|(x>>(32-n)))&mask
 c=((c^b)-r(b,14))&mask;a=((a^c)-r(c,11))&mask;b=((b^a)-r(a,25))&mask;c=((c^b)-r(b,16))&mask;a=((a^c)-r(c,4))&mask;b=((b^a)-r(a,14))&mask;c=((c^b)-r(b,24))&mask
 return c
def main(dest):
 oracle=NativeCompositorReference(dest,device=DEVICE,name='Integer Bit Family',image_only_scene=True)
 scene,tree=oracle.scene,oracle.tree;scene.render.engine='BLENDER_EEVEE';scene.world=None
 def reset():tree.nodes.clear();return tree.nodes.new('NodeGroupOutput')
 def literal(n,target=tree):
  node=target.nodes.new('FunctionNodeInputInt');node.integer=n;return node.outputs[0]
 def arithmetic(mode,source,b):
  node=tree.nodes.new('FunctionNodeIntegerMath');node.operation=mode
  tree.links.new(source,node.inputs[0]);node.inputs[1].default_value=b;return node.outputs[0]
 def encode(source):
  node=tree.nodes.new('CompositorNodeCombineColor')
  for channel,divisor,modulus in [('Red',1,65536),('Green',65536,256),('Blue',16777216,256)]:
   divided=source if divisor==1 else arithmetic('DIVIDE_FLOOR',source,divisor)
   tree.links.new(arithmetic('FLOORED_MODULO',divided,modulus),node.inputs[channel])
  node.inputs['Alpha'].default_value=1
  return node.outputs[0]
 def make(kind,mode,a,b,provenance='linked'):
  node=tree.nodes.new('FunctionNodeBitMath' if kind=='bit' else 'FunctionNodeHashValue')
  if kind=='bit':node.operation=mode;names=helper.MODES[mode]
  else:node.data_type='INT';names=['Value','Seed']
  for index,name in enumerate(names):
   incoming=node.inputs[name];value=a if index==0 else b
   if provenance=='default':incoming.default_value=value
   elif provenance=='group':
    group=bpy.data.node_groups.new('Integer Artist Defaults','CompositorNodeTree');group.interface.new_socket(name='Input',in_out='INPUT',socket_type='NodeSocketInt');group.interface.new_socket(name='Output',in_out='OUTPUT',socket_type='NodeSocketInt')
    gi=group.nodes.new('NodeGroupInput');go=group.nodes.new('NodeGroupOutput');group.links.new(gi.outputs[0],go.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;instance.inputs[0].default_value=value;tree.links.new(instance.outputs[0],incoming)
   elif provenance=='reroute':
    reroute=tree.nodes.new('NodeReroute');tree.links.new(literal(value),reroute.inputs[0]);tree.links.new(reroute.outputs[0],incoming)
   else:tree.links.new(literal(value),incoming)
  return node,node.outputs[0]
 # Native refusal controls before any capture/build.
 sink=reset();node,out=make('hash','INT',1,2);node.data_type='FLOAT';tree.links.new(node.outputs[0],sink.inputs[0]);assert compositor_graph.extract(scene)['status']=='unsupported'
 sink=reset();node,out=make('bit','SHIFT',1,2);source=tree.nodes.new('ShaderNodeValue');source.outputs[0].default_value=1;tree.links.new(source.outputs[0],node.inputs['A']);tree.links.new(out,sink.inputs[0]);assert compositor_graph.extract(scene)['status']=='unsupported'
 if not DEST:print('BLENDLINK_COMPOSITOR_INTEGER_BITS_POLICY_PASSED');return
 rows=[]
 source_paths=sorted({Path(__file__), ROOT/'packages/blender-addon/tests/compositor_reference.py',
  *(ROOT/'packages/blendlink/blender').glob('*.py'), *(ROOT/'packages/blender-addon').glob('*.py')})
 source_hashes={str(p.relative_to(ROOT)):sha(p) for p in source_paths}
 def capture(label,sink,out,expected,save=False,control=False,compare=False):
  tree.links.new(out,sink.inputs[0]);source=dest/(label+'.blend') if save else None
  for item in tree.nodes:item.show_preview=False
  if source:bpy.ops.wm.save_as_mainfile(filepath=str(source));source_hash=sha(source)
  program=compositor_graph.extract(scene);assert program['status']=='extracted',program
  program_path=dest/(label+'.program.json');program_path.write_text(json.dumps(program,indent=2)+'\n')
  scene.render.filepath=str(dest/(label+'.exr'))
  with oracle._render_sampling():bpy.ops.render.render(write_still=True)
  image=bpy.data.images.load(scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL';pixels=np.empty(8*8*4,np.float32);image.pixels.foreach_get(pixels);bpy.data.images.remove(image)
  wanted=[1,1,1,1] if compare else [expected%65536,(expected//65536)%256,(expected//16777216)%256,1]
  assert np.array_equal(pixels.reshape(64,4),np.tile(np.array(wanted,np.float32),(64,1))),(label,expected,wanted,pixels[:4].tolist())
  pixel_path=dest/(label+'.rgba32f');pixel_path.write_bytes(pixels.tobytes())
  row={'case':label,'programFile':program_path.name,'programSha256':sha(program_path),'pixelFile':pixel_path.name,'pixelSha256':sha(pixel_path),'expectedInt':expected,'control':control,'compare':compare}
  if source:assert sha(source)==source_hash;row.update(sourceFile=source.name,sourceSha256=source_hash)
  rows.append(row)
 patterns=[-2147483648,2147483647,-1,0,1,0x55555555,i32(0xaaaaaaaa),0x12345678,i32(0x87654321),65535,65536,-65536]
 # Standalone independent transport controls cannot be masked by a broken BitMath.
 for index,a in enumerate(patterns):
  sink=reset();capture('calibration-'+str(index),sink,encode(literal(a)),a,control=True)
 for mode in helper.MODES:
  pairs=[(a,patterns[(i+5)%len(patterns)]) for i,a in enumerate(patterns)]
  if mode in {'SHIFT','ROTATE'}:pairs=[(i32(0x87654321),n) for n in [-2147483648,-65,-33,-32,-31,-1,0,1,31,32,33,65,2147483647]]+[(i32(1<<n),n if n%2 else -n) for n in range(32)]
  if mode in {'AND','OR','XOR'}:pairs += [(i32(1<<n),i32(~(1<<n))) for n in range(32)]
  for index,(a,b) in enumerate(pairs):
   sink=reset();node,out=make('bit',mode,a,b,provenance=['default','linked','reroute','group'][index%4]);expected=bit(mode,a,b)
   capture('bit-'+mode.lower()+'-'+str(index),sink,encode(out),expected,save=index==0)
 for index,(a,seed) in enumerate([(a,b) for a in patterns for b in [0,-1,2147483647,-2147483648]]):
  sink=reset();node,out=make('hash','INT',a,seed,provenance=['default','linked','reroute','group'][index%4]);expected=i32(hash1(hash1(a%2**32),seed%2**32))
  capture('hash-int-'+str(index),sink,encode(out),expected,save=index in [0,3,20])
 # Two independently typed Compare consumers verify full signed32 result directly.
 for kind,mode,a,b in [('bit','ROTATE',-2147483648,-31),('hash','INT',-1,-2147483648)]:
  sink=reset();node,out=make(kind,mode,a,b);expected=bit(mode,a,b) if kind=='bit' else i32(hash1(hash1(a%2**32),b%2**32))
  compare=tree.nodes.new('FunctionNodeCompare');compare.data_type='INT';compare.operation='EQUAL';active=[s for s in compare.inputs if s.enabled and not s.is_unavailable];tree.links.new(out,active[0]);active[1].default_value=expected
  capture(kind+'-int-compare',sink,compare.outputs[0],expected,save=True,compare=True)
 # Qualified own-family dependency chain exercises recursive typed admission.
 sink=reset();first,a=make('bit','XOR',-2147483648,0x12345678);second,b=make('hash','INT',0,17);tree.links.new(a,second.inputs['Value']);expected=i32(hash1(hash1(bit('XOR',-2147483648,0x12345678)%2**32),17))
 capture('hash-bit-chain',sink,encode(b),expected,save=True)
 assert source_hashes=={str(p.relative_to(ROOT)):sha(p) for p in source_paths},'Native input closure changed during capture'
 report={'status':'CAPTURED_INTEGER_BITS_NATIVE','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'device':DEVICE,'width':8,'height':8,'sourceHashes':source_hashes,'cases':rows}
 (dest/'qualification.json').write_text(json.dumps(report,indent=2)+'\n');print('BLENDLINK_COMPOSITOR_INTEGER_BITS_REFERENCES_PASSED '+json.dumps({'device':DEVICE,'cases':len(rows)}))
if DEST:
 destination=Path(DEST).resolve();destination.mkdir(parents=True,exist_ok=True);main(destination)
else:
 with tempfile.TemporaryDirectory(prefix='scenetoweb-integer-bits-policy-') as temporary:main(Path(temporary))
print('BLENDLINK_COMPOSITOR_INTEGER_BITS_CHECK_PASSED '+bpy.app.version_string)
