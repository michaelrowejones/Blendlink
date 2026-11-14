# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual CPU compositor node references and unchanged saved source graphs."""
from array import array
import hashlib,json,os,struct,sys
from pathlib import Path
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon/tests'),str(Path(__file__).parent)]
import compositor_graph,compositor_white_noise as helper
from compositor_reference import NativeCompositorReference
from hash_reference import expected
DEST=Path(os.environ['SCENETOWEB_WHITE_NOISE_REFERENCES']).resolve();DEST.mkdir(parents=True,exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
case_path=ROOT/'experiments/compositor-white-noise/cases.json';CASES=json.loads(case_path.read_text())
paths=[Path(__file__),ROOT/'experiments/compositor-white-noise/policy.py',ROOT/'experiments/compositor-white-noise/hash_reference.py',case_path,
    ROOT/'packages/blender-addon/tests/compositor_white_noise_check.py',ROOT/'packages/blender-addon/tests/compositor_reference.py',
    *(ROOT/'packages/blendlink/blender').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.json')]
pins={str(p.relative_to(ROOT)):sha(p)for p in paths}
def raw(words):
    values=array('f');values.frombytes(struct.pack('='+str(len(words))+'I',*words));return values
f32=lambda word:struct.unpack('=f',struct.pack('=I',word))[0]
oracle=NativeCompositorReference(DEST,device='CPU',pixels=np.zeros((4,4,4),np.float32),node_previews=False)
rows=[]
for definition in CASES:
    sink,_=oracle.reset();tree=oracle.tree;dimension=definition['dimensions'];output=definition['output'];words=definition['seedWords']
    target=tree
    if definition['route']=='group':
        target=bpy.data.node_groups.new('Artist White Noise fixed group','CompositorNodeTree')
        if dimension!=1:target.interface.new_socket(name='Vector',in_out='INPUT',socket_type='NodeSocketVector')
        if dimension in (1,4):target.interface.new_socket(name='W',in_out='INPUT',socket_type='NodeSocketFloat')
        target.interface.new_socket(name='Noise',in_out='OUTPUT',socket_type='NodeSocketColor'if output=='Color'else'NodeSocketFloat')
        entry=target.nodes.new('NodeGroupInput');exit=target.nodes.new('NodeGroupOutput')
    node=target.nodes.new('ShaderNodeTexWhiteNoise');assert node.noise_dimensions=='2D';node.noise_dimensions=str(dimension)+'D'
    if dimension!=1:
        if definition['route']=='group':source=entry.outputs['Vector']
        else:
            combine=target.nodes.new('ShaderNodeCombineXYZ');combine.inputs.foreach_set('default_value',raw(words[:3]));source=combine.outputs[0]
        reroute=target.nodes.new('NodeReroute');target.links.new(source,reroute.inputs[0]);target.links.new(reroute.outputs[0],node.inputs['Vector'])
    if dimension in (1,4):
        if definition['route']=='group':source=entry.outputs['W']
        else:
            value=target.nodes.new('ShaderNodeValue');value.outputs.foreach_set('default_value',raw([words[3]]));source=value.outputs[0]
        target.links.new(source,node.inputs['W'])
    if definition['route']=='group':
        target.links.new(node.outputs[output],exit.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=target
        if dimension!=1:instance.inputs['Vector'].default_value=[f32(word)for word in words[:3]]
        if dimension in (1,4):instance.inputs['W'].default_value=f32(words[3])
        terminal=instance.outputs[0]
    else:terminal=node.outputs[output]
    tree.links.new(terminal,sink.inputs[0])
    program=compositor_graph.extract(oracle.scene);assert program['status']=='extracted',program
    op=next(op for op in program['ops']if op['kind']=='white-noise-texture');assert len(program['ops'])==1
    actual_seeds=[]
    if dimension!=1:actual_seeds += list(struct.unpack('=3I',struct.pack('=3f',*op['inputs']['Vector']['value']['value'])))
    if dimension in (1,4):actual_seeds.append(struct.unpack('=I',struct.pack('=f',op['inputs']['W']['value']['value']))[0])
    assert actual_seeds==([words[3]]if dimension==1 else words if dimension==4 else words[:3]),(definition,actual_seeds)
    wanted=expected([words[3]]if dimension==1 else words[:dimension],output)
    label=definition['case'];program_file=DEST/(label+'.program.json');program_file.write_text(json.dumps(program,indent=2)+'\n')
    source_file=DEST/(label+'.blend')if definition['saved']else None
    if source_file:bpy.ops.wm.save_as_mainfile(filepath=str(source_file));source_sha=sha(source_file)
    oracle.scene.render.filepath=str(DEST/(label+'.exr'))
    for node in tree.nodes:node.show_preview=False
    bpy.ops.render.render(write_still=True)
    image=bpy.data.images.load(oracle.scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL'
    try:
        assert tuple(image.size)==(4,4);pixels=array('f',[0])*64;image.pixels.foreach_get(pixels)
        raw_words=struct.unpack('=64I',pixels.tobytes());assert all(raw_words[index:index+4]==tuple(wanted)for index in range(0,64,4)),(label,raw_words[:4],wanted)
        pixel=DEST/(label+'.rgba32f');pixel.write_bytes(pixels.tobytes())
    finally:bpy.data.images.remove(image)
    yy,xx=np.mgrid[:4,:4];control=np.stack([xx/16,yy/16,(xx+3*yy)/64,np.ones_like(xx)],axis=-1).astype(np.float32);input_file=DEST/(label+'.input32f');input_file.write_bytes(control.tobytes())
    row={**definition,'rgbaWords':wanted,'programFile':program_file.name,'programSha256':sha(program_file),'pixelFile':pixel.name,'pixelSha256':sha(pixel),'inputFile':input_file.name,'inputSha256':sha(input_file)}
    if definition['imageInfoControl']:
        info=tree.nodes.new('CompositorNodeImageInfo');tree.links.new(terminal,info.inputs['Image']);tree.links.new(info.outputs['Dimensions'],sink.inputs[0])
        oracle.scene.render.filepath=str(DEST/(label+'.info.exr'));bpy.ops.render.render(write_still=True)
        image=bpy.data.images.load(oracle.scene.render.filepath,check_existing=False)
        try:
            pixels=array('f',[0])*64;image.pixels.foreach_get(pixels);info_words=list(struct.unpack('=64I',pixels.tobytes()))
            assert all(info_words[index:index+4]==[0,0,0,0x3f800000]for index in range(0,64,4)),('Native single-value domain must be 0x0',info_words[:4])
            info_file=DEST/(label+'.info.rgba32f');info_file.write_bytes(pixels.tobytes())
        finally:bpy.data.images.remove(image)
        tree.nodes.remove(info);tree.links.new(terminal,sink.inputs[0])
        row.update(imageInfoDimensions=[0,0],imageInfoFile=info_file.name,imageInfoSha256=sha(info_file))
    if source_file:assert sha(source_file)==source_sha;row.update(sourceFile=source_file.name,sourceSha256=source_sha)
    rows.append(row)
assert pins=={str(path.relative_to(ROOT)):sha(path)for path in paths},'Native sources changed during capture'
report={'schemaVersion':1,'status':'CAPTURED_COMPOSITOR_WHITE_NOISE','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),
    'device':'CPU','sceneEngine':oracle.scene.render.engine,'resultPrecision':'CPU_FLOAT32','sourceHashes':pins,'cases':rows,'wordDifferences':0,'finalCredit':0,'browserCredit':0}
(DEST/'qualification.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(rows))
