# SPDX-License-Identifier: GPL-3.0-or-later
"""Same-engine image-oracle timing and exact-output control for EEVEE TAA1."""
import argparse
import hashlib
import json
import statistics
import struct
import sys
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--evidence',type=Path,required=True)
parser.add_argument('--device',choices=['CPU','GPU'],default='CPU')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
oracle=NativeCompositorReference(args.evidence,device=args.device,image_only_scene=True)
engines={item.identifier for item in oracle.scene.render.bl_rna.properties['engine'].enum_items}
oracle.scene.render.engine='BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
oracle.scene.eevee.taa_render_samples=64
pairs=[]
for iteration in range(6):
    files={}
    for samples in ([64,1] if iteration%2==0 else [1,64]):
        oracle.image_only_scene=samples==1
        sink,source=oracle.reset();oracle.tree.links.new(source.outputs['Image'],sink.inputs[0])
        oracle.save('sampling-control-'+str(iteration)+'-'+str(samples),source)
        files[samples]=args.evidence/(oracle.rows[-1]['case']+'.json')
        assert oracle.scene.eevee.taa_render_samples==64
    a,b=[json.loads(files[samples].read_text()) for samples in [64,1]]
    pack=lambda values:struct.pack('<'+'f'*len(values),*values)
    assert pack(a['input'])==pack(b['input']) and pack(a['expected'])==pack(b['expected']) and a['program']==b['program']
    pairs.append({'iteration':iteration,'files':{str(key):str(value) for key,value in files.items()},
        'inputSha256':hashlib.sha256(pack(a['input'])).hexdigest(),'nativePixelsSha256':hashlib.sha256(pack(a['expected'])).hexdigest()})
oracle.finish('BLENDLINK_COMPOSITOR_SAMPLING_CONTROL_PASSED')
# First pair is a warm-up, not part of the comparison; alternate order afterward.
profiles=oracle.render_profiles[2:]
median={str(samples):statistics.median(row['elapsedSeconds'] for row in profiles if row['samplesDuring']==samples) for samples in [64,1]}
report={'blender':bpy.app.version_string,'nativeBuild':bpy.app.build_hash.decode(),'gpuBackend':bpy.context.preferences.system.gpu_backend,
    'compositorDevice':args.device,'sceneEngine':oracle.scene.render.engine,'pairs':pairs,'medianRenderSeconds':median,
    'observedRatio64to1':median['64']/median['1'],'firstPairExcludedFromTiming':True,
    'sourceHashes':{path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in [Path(__file__),Path(sys.modules['compositor_reference'].__file__)]}}
(args.evidence/'timing-control.json').write_text(json.dumps(report,indent=2))
print('BLENDLINK_COMPOSITOR_SAMPLING_TIMING '+json.dumps(median))
