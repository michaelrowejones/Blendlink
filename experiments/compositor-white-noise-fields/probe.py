# SPDX-License-Identifier: GPL-3.0-or-later
"""Research: native CPU implicit coordinates before raw-bit White Noise hashing."""
from array import array
import hashlib,json,os,struct,sys
from pathlib import Path
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'packages/blender-addon/tests'),str(ROOT/'experiments/compositor-white-noise')]
from compositor_reference import NativeCompositorReference
from hash_reference import expected,word,f32
OUT=Path(os.environ['SCENETOWEB_WHITE_NOISE_FIELD_RESEARCH']);OUT.mkdir(parents=True,exist_ok=True)
assert tuple(bpy.app.version)==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
rows=[]
for width,height in [(13,9),(9,13),(16,8),(8,8)]:
    oracle=NativeCompositorReference(OUT,device='CPU',pixels=np.zeros((height,width,4),np.float32),node_previews=False)
    tree=oracle.tree;maximum=max(width,height)
    axes=[[word(f32(f32(f32(pixel+.5)-f32(size/2))/maximum)*2)for pixel in range(size)]for size in [width,height]]
    def capture(label,kind='coordinate',dimension=2,output='Color',linked=False):
        sink,_=oracle.reset();image=tree.nodes.new('CompositorNodeImage');image.image=oracle.image
        coords=tree.nodes.new('CompositorNodeImageCoordinates');tree.links.new(image.outputs['Image'],coords.inputs['Image'])
        source=coords.outputs['Uniform']
        if kind=='noise':
            node=tree.nodes.new('ShaderNodeTexWhiteNoise');assert node.noise_dimensions=='2D'
            if dimension!=2:node.noise_dimensions=str(dimension)+'D'
            if dimension==4:node.inputs['W'].default_value=f32(.1)
            if linked:tree.links.new(source,node.inputs['Vector'])
            else:assert not node.inputs['Vector'].is_linked
            source=node.outputs[output]
        tree.links.new(source,sink.inputs[0]);path=OUT/(f'{width}x{height}-'+label+'.exr');oracle.scene.render.filepath=str(path)
        for node in tree.nodes:node.show_preview=False
        bpy.ops.render.render(write_still=True)
        result=bpy.data.images.load(str(path),check_existing=False)
        try:
            assert tuple(result.size)==(width,height);pixels=array('f',[0])*(width*height*4);result.pixels.foreach_get(pixels)
            words=list(struct.unpack('='+str(len(pixels))+'I',pixels.tobytes()))
        finally:bpy.data.images.remove(result)
        raw=path.with_suffix('.rgba32f');raw.write_bytes(pixels.tobytes())
        return words,{'case':f'{width}x{height}-'+label,'width':width,'height':height,'pixelFile':raw.name,'pixelSha256':sha(raw),'kind':kind,'dimension':dimension,'output':output,'linked':linked}
    coordinates,row=capture('raw-uniform')
    wanted=[part for y in range(height)for x in range(width)for part in [axes[0][x],axes[1][y],0,word(1)]]
    row.update(exactWordDifferences=sum(a!=b for a,b in zip(coordinates,wanted)),sourceAxes=axes);assert coordinates==wanted,row;rows.append(row)
    controls={}
    for dimension,output,linked in [(2,'Value',False),(2,'Color',False),(3,'Color',False),(4,'Color',False),(2,'Color',True)]:
        label=f'{dimension}d-{output.lower()}-'+('linked-control'if linked else'untouched-default')
        actual,row=capture(label,'noise',dimension,output,linked)
        wanted=[]
        for index in range(0,len(coordinates),4):
            seed=coordinates[index:index+dimension]
            if dimension==4:seed=coordinates[index:index+3]+[word(f32(.1))]
            wanted+=expected(seed,output)
        differences=sum(a!=b for a,b in zip(actual,wanted));row.update(exactWordDifferences=differences);assert differences==0,(row,actual[:4],wanted[:4]);rows.append(row)
        if dimension==2 and output=='Color':controls[linked]=actual
    assert controls[False]==controls[True],'Actual implicit and same-cache explicit coordinate hash fields differ'
report={'schemaVersion':1,'status':'RESEARCH_ONLY_IMPLICIT_WHITE_NOISE_CPU_FIELDS','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),
    'sourceStage':'CPU compositor cached Uniform Float2 -> native Float3 Z+0 -> actual White Noise MF field',
    'rows':rows,'nativeRenders':len(rows),'primaryFloat32Words':sum(row['width']*row['height']*4 for row in rows),'exactWordDifferences':0,
    'gpuInitializationCalls':0,'portCredit':0,'savedFinalCredit':0,'browserCredit':0}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
