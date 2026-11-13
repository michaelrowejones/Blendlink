# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual CPU/GPU Normal constants and legacy unnormalized negative Dot fields."""
import json
import os
import sys
import tempfile
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference, compositor_graph


def main(output):
    pixels = np.random.default_rng(8653).uniform(-2,4,(7,13,4)).astype(np.float32)
    pixels[...,3] = np.resize(np.asarray([0,-.5,.25,.5,1,1.5,.75],np.float32),(7,13))
    oracle = NativeCompositorReference(output,pixels=pixels,device=os.environ.get('BLENDLINK_COMPOSITOR_NORMAL_DEVICE','CPU'),name='Native Normal direction')
    tree = oracle.tree
    sink,source = oracle.reset();tree.links.new(source.outputs['Image'],sink.inputs[0]);oracle.save('normal-control',source)
    for index,direction in enumerate([(0,0,1),(.25,-.5,1),(2,-3,4),(0,0,0),(1e-12,-1e-12,1e-12),(16,-16,8)]):
        for requested in ['Normal','Dot']:
            for stage in (['image','constant','zero','before-posterize'] if requested=='Dot' else ['constant','before-posterize']):
                sink,source = oracle.reset();normal = tree.nodes.new('CompositorNodeNormal')
                if normal.outputs.get(requested) is None:continue
                normal.outputs['Normal'].default_value = direction
                if normal.inputs.get('Normal'):
                    incoming = oracle.color((0,0,0,1) if stage=='zero' else (2,-3,4,0)) if stage in {'constant','zero'} else source.outputs['Image']
                    tree.links.new(incoming,normal.inputs['Normal'])
                field = normal.outputs[requested]
                if stage=='before-posterize':
                    posterize = tree.nodes.new('CompositorNodePosterize');posterize.inputs['Steps'].default_value=7
                    tree.links.new(field,posterize.inputs['Image']);field=posterize.outputs[0]
                tree.links.new(field,sink.inputs[0])
                if not any(direction) and oracle.device=='GPU' and normal.outputs.get('Dot') is not None:
                    result = compositor_graph.extract(oracle.scene)
                    assert result['status']=='unsupported' and any('nonzero' in d['message'] for d in result['diagnostics']),result
                    continue
                oracle.save('normal-'+requested.lower()+'-'+str(index)+'-'+stage,source)
                path=output/(oracle.rows[-1]['case']+'.json');data=json.loads(path.read_text());data.update(assertTextureCleanup=True,assertMrtState=True)
                path.write_text(json.dumps(data,separators=(',',':')))
    oracle.finish('BLENDLINK_COMPOSITOR_NORMAL_DIRECTION_PASSED')


destination = os.environ.get('BLENDLINK_COMPOSITOR_NORMAL_REFERENCES')
if destination:main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-compositor-normal-') as directory:main(Path(directory))
