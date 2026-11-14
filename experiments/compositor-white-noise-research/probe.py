# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual CPU compositor White Noise, raw-bit input and output witness only."""
from array import array
from pathlib import Path
import bpy,json,os,struct,sys
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference
OUT=Path(os.environ['SCENETOWEB_WHITE_NOISE_RESEARCH']);OUT.mkdir(parents=True,exist_ok=True)
assert tuple(bpy.app.version)==(5,3,0) and bpy.app.build_hash==b'02f0899d78e3'
def raw(words):
    values=array('f');values.frombytes(struct.pack('='+str(len(words))+'I',*words));return values
def word(value):return struct.unpack('=I',struct.pack('=f',value))[0]
def f32(value):return struct.unpack('=f',struct.pack('=f',value))[0]
def hash_words(words):
    mask=0xffffffff
    rot=lambda x,n:((x<<n)|(x>>(32-n)))&mask
    a=b=c=(0xdeadbeef+(len(words)<<2)+13)&mask
    a=(a+words[0])&mask
    if len(words)>1:b=(b+words[1])&mask
    if len(words)>2:c=(c+words[2])&mask
    if len(words)==4:
        a=((a-c)^rot(c,4))&mask;c=(c+b)&mask
        b=((b-a)^rot(a,6))&mask;a=(a+c)&mask
        c=((c-b)^rot(b,8))&mask;b=(b+a)&mask
        a=((a-c)^rot(c,16))&mask;c=(c+b)&mask
        b=((b-a)^rot(a,19))&mask;a=(a+c)&mask
        c=((c-b)^rot(b,4))&mask;b=(b+a)&mask
        a=(a+words[3])&mask
    c=((c^b)-rot(b,14))&mask;a=((a^c)-rot(c,11))&mask;b=((b^a)-rot(a,25))&mask
    c=((c^b)-rot(b,16))&mask;a=((a^c)-rot(c,4))&mask;b=((b^a)-rot(a,14))&mask;c=((c^b)-rot(b,24))&mask
    return c
def scalar_hash(words):return word(f32(f32(hash_words(words))/f32(0xffffffff)))
def expected(words,output):
    if output=='Value':return [scalar_hash(words)]*3+[word(1)]
    if len(words)<=3:seeds=[words,words+[word(1)],words+[word(2)]]
    else:
        x,y,z,w=words;seeds=[words,[z,x,w,y],[w,z,y,x]]
    return [scalar_hash(seed)for seed in seeds]+[word(1)]
oracle=NativeCompositorReference(OUT,device='CPU',pixels=np.zeros((4,4,4),np.float32),node_previews=False)
rows=[];ordinary=[word(.1),word(-.8),word(1/3),word(.5678912)]
specs=[(f'{dim}D-{output}',dim,output,ordinary[:dim])for dim in range(1,5)for output in('Value','Color')]
specs +=[(name,1,'Value',[value])for name,value in [('positive-zero',0),('negative-zero',0x80000000),('subnormal-one',1),('minimum-normal',0x00800000)]]
for name,dim,output,words in specs:
    sink,_=oracle.reset();tree=oracle.tree;node=tree.nodes.new('ShaderNodeTexWhiteNoise');default_dimensions=node.noise_dimensions;node.noise_dimensions=str(dim)+'D'
    if dim!=1:
        vector=tree.nodes.new('ShaderNodeCombineXYZ');vector.inputs.foreach_set('default_value',raw(words[:3]+[0]*(3-len(words[:3]))))
        tree.links.new(vector.outputs[0],node.inputs['Vector'])
    if dim in(1,4):
        value=tree.nodes.new('ShaderNodeValue');value.outputs.foreach_set('default_value',raw([words[-1]]));tree.links.new(value.outputs[0],node.inputs['W'])
        original=array('f',[0]);value.outputs.foreach_get('default_value',original);assert struct.unpack('=I',original.tobytes())[0]==words[-1]
    tree.links.new(node.outputs[output],sink.inputs[0])
    for n in tree.nodes:n.show_preview=False
    path=OUT/(name+'.exr');oracle.scene.render.filepath=str(path);bpy.ops.render.render(write_still=True)
    image=bpy.data.images.load(str(path),check_existing=False)
    try:
        pixels=array('f',[0])*64;image.pixels.foreach_get(pixels);actual=list(struct.unpack('=64I',pixels.tobytes()))
    finally:bpy.data.images.remove(image)
    assert all(actual[i:i+4]==actual[:4]for i in range(0,len(actual),4))
    predicted=expected(words,output)
    rows.append({'case':name,'dimensions':dim,'output':output,'defaultCompositorDimensions':default_dimensions,
        'sourceInputWords':words,'independentHashU32':hash_words(words),'expectedRGBAWords':predicted,
        'actualRGBAWords':actual[:4],'wordDifferences':sum(a!=b for a,b in zip(actual[:4],predicted))})
report={'status':'COMPOSITOR_WHITE_NOISE_CPU_SOURCE_FEASIBILITY','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),
    'backend':'actual CPU compositor / shared native MF constant unit','cases':rows,'renders':len(rows),
    'gpuInitializationCalls':0,'GPUCredit':0,'FinalCredit':0,'browserCredit':0,'portCredit':0}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
