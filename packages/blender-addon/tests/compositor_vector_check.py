# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual native vector constants and XYZ combination/separation, not class aliases."""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference


def main(output):
    oracle = NativeCompositorReference(output,
        device=os.environ.get('BLENDLINK_COMPOSITOR_VECTOR_DEVICE', 'CPU'), name='Native Vector Utilities')
    tree = oracle.tree
    try:
        for kind in ['FunctionNodeInputVector','ShaderNodeCombineXYZ','ShaderNodeSeparateXYZ']:
            tree.nodes.new(kind)
    except RuntimeError:
        print('BLENDLINK_COMPOSITOR_VECTOR_NOT_APPLICABLE')
        oracle.finish('BLENDLINK_COMPOSITOR_VECTOR_PASSED');return
    sink, source = oracle.reset();tree.links.new(source.outputs['Image'],sink.inputs[0])
    oracle.save('vector-control',source,exact_alpha=True)
    for index, values in enumerate([(0,0,0),(.25,.5,.75),(-2,.3,1.5),(-1.234567,.3333333,2**-24)]):
        for channel in ['Vector','X','Y','Z','scalar-mean']:
            sink,source=oracle.reset();node=tree.nodes.new('FunctionNodeInputVector');node.vector=values
            value=node.outputs[0]
            if channel in ['X','Y','Z']:
                separate=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(value,separate.inputs[0]);value=separate.outputs[channel]
            if channel=='scalar-mean':
                exposure=tree.nodes.new('CompositorNodeExposure');tree.links.new(source.outputs['Image'],exposure.inputs['Image']);tree.links.new(value,exposure.inputs['Exposure']);value=exposure.outputs[0]
            tree.links.new(value,sink.inputs[0]);oracle.save('vector-constant-'+str(index)+'-'+channel.lower(),source)
    for permutation in [('Red','Green','Blue'),('Blue','Red','Green'),('Alpha','Blue','Red')]:
        for channel in ['Vector','X','Y','Z']:
            sink,source=oracle.reset();channels=oracle.separate(source.outputs['Image'])
            combine=tree.nodes.new('ShaderNodeCombineXYZ')
            for incoming,name in zip(combine.inputs,permutation):tree.links.new(channels.outputs[name],incoming)
            value=combine.outputs[0]
            if channel!='Vector':
                separate=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(value,separate.inputs[0]);value=separate.outputs[channel]
            tree.links.new(value,sink.inputs[0]);oracle.save('vector-field-'+''.join(x[0].lower() for x in permutation)+'-'+channel.lower(),source)
    oracle.finish('BLENDLINK_COMPOSITOR_VECTOR_PASSED')


destination=os.environ.get('BLENDLINK_COMPOSITOR_VECTOR_REFERENCES')
if destination:main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-vector-') as directory:main(Path(directory))
