# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_FLOAT_COORDINATES_CHECK_PASSED
"""Native Uniform/Normalized float2 field extraction and explicit padded-edge references."""
import hashlib
import json
import os
from pathlib import Path
import platform
import sys

import bpy
import numpy as np

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
import compositor_graph
from compositor_reference import NativeCompositorReference
DESTINATION=os.environ.get('BLENDLINK_FLOAT_COORDINATES_REFERENCES')
DEVICE=os.environ.get('BLENDLINK_FLOAT_COORDINATES_DEVICE','CPU')


def graph(oracle,route='rgba',output='Uniform'):
    tree=oracle.tree;sink,source=oracle.reset();coord=tree.nodes.new('CompositorNodeImageCoordinates')
    tree.links.new(source.outputs['Image'],coord.inputs['Image']);field=coord.outputs[output]
    if route=='reroute':
        reroute=tree.nodes.new('NodeReroute');tree.links.new(field,reroute.inputs[0]);field=reroute.outputs[0]
    if route=='group':
        group=bpy.data.node_groups.new('Artist padded coordinate group','CompositorNodeTree')
        group.interface.new_socket(name='Vector',in_out='INPUT',socket_type='NodeSocketVector')
        group.interface.new_socket(name='Vector',in_out='OUTPUT',socket_type='NodeSocketVector')
        entry=group.nodes.new('NodeGroupInput');exit=group.nodes.new('NodeGroupOutput');group.links.new(entry.outputs['Vector'],exit.inputs['Vector'])
        instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;tree.links.new(field,instance.inputs['Vector']);field=instance.outputs['Vector']
    if route in {'vector3','group'}:
        separate=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(field,separate.inputs['Vector'])
        combine=tree.nodes.new('CompositorNodeCombineColor')
        for index,name in enumerate(['X','Y','Z']):tree.links.new(separate.outputs[name],combine.inputs[index])
        field=combine.outputs['Image']
    if route=='scalar':
        math=tree.nodes.new('ShaderNodeMath');math.operation='ADD';tree.links.new(field,math.inputs[0]);field=math.outputs['Value']
    tree.links.new(field,sink.inputs[0]);return source,coord


def run():
    if tuple(bpy.app.version)!=(5,3,0) or sys.platform!='darwin' or platform.machine()!='arm64':return
    oracle=NativeCompositorReference('/tmp/scenetoweb-float-coordinate-policy',device=DEVICE,pixels=np.ones((9,13,4),np.float32));oracle.scene.world=None;oracle.scene.render.engine='BLENDER_EEVEE';oracle.scene.eevee.taa_render_samples=1
    for route in ['rgba','vector3','reroute','group']:
        source,coord=graph(oracle,route)
        program=compositor_graph.extract(oracle.scene)
        assert program['status']=='extracted',(route,program)
        emitted=next(op for op in program['ops'] if op['kind']=='image-coordinates')
        assert emitted['type']=='FLOAT_VECTOR2' and emitted['source']['output']=='Uniform'
    for route,output in [('scalar','Uniform'),('scalar','Normalized')]:
        graph(oracle,route,output);assert compositor_graph.extract(oracle.scene)['status']=='unsupported',(route,output)
    graph(oracle);oracle.scene.render.use_border=True
    assert compositor_graph.extract(oracle.scene)['status']=='unsupported'
    if not DESTINATION:return
    destination=Path(DESTINATION).resolve();destination.mkdir(parents=True,exist_ok=True)
    digest=lambda path:hashlib.sha256(Path(path).read_bytes()).hexdigest()
    source_paths=sorted({Path(__file__), ROOT/'packages/blender-addon/tests/compositor_reference.py',
        *(ROOT/'packages/blendlink/blender').glob('*.py'), *(ROOT/'packages/blender-addon').glob('*.py')})
    source_hashes={str(path.relative_to(ROOT)):digest(path) for path in source_paths}
    cases=[]
    for width,height,pixel_ratio in [(13,9,1),(26,18,2),(9,13,1),(18,26,2),(19,11,1),(38,22,2)]:
        yy,xx=np.mgrid[:height,:width]
        pixels=np.stack([xx/64,yy/64,((xx+yy*3)%31)/64,np.ones_like(xx)],axis=-1).astype(np.float32)
        oracle=NativeCompositorReference(destination,device=DEVICE,name='Artist Float Coordinates',pixels=pixels);oracle.scene.world=None;oracle.scene.render.engine='BLENDER_EEVEE';oracle.scene.eevee.taa_render_samples=1
        for output in ['Uniform','Normalized']:
            for route in ['rgba','vector3','reroute','group']:
                source,coord=graph(oracle,route,output)
                label=f'{width}x{height}-{output.lower()}-{route}'
                source_path=None
                if (width,height) in {(13,9),(9,13)} and route in {'rgba','group'}:
                    source_path=destination/(label+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(source_path));source_sha=digest(source_path)
                oracle.save(label,source,exact_alpha=True)
                case=oracle.prefix+'-'+label;path=destination/(case+'.json');data=json.loads(path.read_text())
                data.update({'requireFloat32Bits':False,'assertTextureCleanup':True,'assertShaderCost':{'maxPasses':1,'maxFragmentBytes':16384}})
                path.write_text(json.dumps(data,separators=(',',':')))
                program_path=destination/(case+'.program.json');program_path.write_text(json.dumps(data['program'],indent=2)+'\n')
                pixel_path=destination/(case+'.rgba32f');pixel_path.write_bytes(np.asarray(data['expected'],np.float32).tobytes())
                input_path=destination/(case+'.input32f');input_path.write_bytes(pixels.tobytes())
                cases.append({'case':case,'width':width,'height':height,'pixelRatio':pixel_ratio,'route':route,'coordinateOutput':output,'programFile':program_path.name,'programSha256':digest(program_path),'pixelFile':pixel_path.name,'pixelSha256':digest(pixel_path),'inputFile':input_path.name,'inputSha256':digest(input_path),**({'sourceFile':source_path.name,'sourceSha256':source_sha} if source_path else {})})
                if source_path:assert digest(source_path)==source_sha
    assert source_hashes=={str(path.relative_to(ROOT)):digest(path) for path in source_paths},'Native input closure changed during capture'
    (destination/'qualification.json').write_text(json.dumps({'status':'native-float-coordinate-qualified','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'device':DEVICE,'nativeBackend':bpy.context.preferences.system.gpu_backend,'sourceHashes':source_hashes,'cases':cases},indent=2)+'\n')
    print('BLENDLINK_FLOAT_COORDINATES_REFERENCES_PASSED',len(cases),DEVICE)
run()
print('BLENDLINK_FLOAT_COORDINATES_CHECK_PASSED',bpy.app.version_string)
