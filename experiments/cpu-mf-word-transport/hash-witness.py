# SPDX-License-Identifier: GPL-3.0-or-later
"""Research-only distinct hash-code Float32 carrier; no generic INT32 proof."""
from array import array
import bpy,struct,json,os,sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference
OUT=Path(os.environ['SCENETOWEB_MF_WORDS']);OUT.mkdir(parents=True,exist_ok=True)
WORDS=[0,0x80000000,1,0x007fffff,0x80000001,0x807fffff,0x00800000,0x3dcccccd]
def raw(words):
 a=array('f');a.frombytes(struct.pack('='+str(len(words))+'I',*words));return a
def hash32(*words):
 m=0xffffffff;rot=lambda x,k:((x<<k)|(x>>(32-k)))&m;a=b=c=(0xdeadbeef+(len(words)<<2)+13)&m;a=(a+words[0])&m
 if len(words)>1:b=(b+words[1])&m
 c=((c^b)-rot(b,14))&m;a=((a^c)-rot(c,11))&m;b=((b^a)-rot(a,25))&m;c=((c^b)-rot(b,16))&m;a=((a^c)-rot(c,4))&m;b=((b^a)-rot(a,14))&m;c=((c^b)-rot(b,24))&m;return c
hashword=lambda word:hash32(hash32(word),0)
def carrier(word):
 result=hashword(word);signed=result if result<0x80000000 else result-0x100000000;return struct.unpack('=I',struct.pack('=f',signed))[0]
CODES={word:carrier(word)for word in WORDS};assert len(set(CODES.values()))==len(WORDS)
oracle=NativeCompositorReference(OUT,device='CPU',pixels=np.zeros((4,4,4),np.float32),node_previews=False);rows=[]
for kind in ['value','matrix']:
 for word in WORDS:
  sink,_=oracle.reset();tree=oracle.tree;value=tree.nodes.new('ShaderNodeValue');value.outputs.foreach_set('default_value',raw([word]));stored=array('f',[0]);value.outputs.foreach_get('default_value',stored);stored_word=struct.unpack('=I',stored.tobytes())[0];assert stored_word==word
  source=value.outputs[0]
  if kind=='matrix':
   combine=tree.nodes.new('FunctionNodeCombineMatrix');separate=tree.nodes.new('FunctionNodeSeparateMatrix');tree.links.new(source,combine.inputs[0]);tree.links.new(combine.outputs[0],separate.inputs[0]);source=separate.outputs[0]
  witness=tree.nodes.new('FunctionNodeHashValue');witness.data_type='FLOAT';witness.inputs['Seed'].default_value=0;tree.links.new(source,witness.inputs['Value']);tree.links.new(witness.outputs['Hash'],sink.inputs[0]);oracle.scene.render.filepath=str(OUT/(kind+'-'+str(word)+'.exr'))
  for node in tree.nodes:node.show_preview=False
  bpy.ops.render.render(write_still=True);image=bpy.data.images.load(oracle.scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL'
  try:
   a=array('f',[0])*64;image.pixels.foreach_get(a);words=list(struct.unpack('=64I',a.tobytes()));assert all(words[i:i+4]==words[:4]for i in range(0,64,4))
  finally:bpy.data.images.remove(image)
  candidates=[candidate for candidate,code in CODES.items()if code==words[0]];rows.append({'producer':kind,'storedSourceWord':word,'hashInteger':hashword(word),'expectedSourceCarrierWord':CODES[word],'actualRGBAWords':words[:4],'matchedInputWords':candidates,'directSourceMatch':words[0]==CODES[word]})
report={'status':'CPU_COMPOSITOR_HASH_WORD_WITNESS_RESEARCH','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'stage':'Actual CPU compositor native HashValue FLOAT with fixed Seed0; INT output rounded toFloat32 RGBA only to distinguish8predeclared widelyseparated hashcodes. No fullINT32transport or GPU credit.','cases':rows,'carrierWords':{str(w):code for w,code in CODES.items()},'renders':len(rows),'gpuInitializationCalls':0,'nodePortCredit':0}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(rows))
