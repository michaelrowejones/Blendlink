# SPDX-License-Identifier: GPL-3.0-or-later
"""Native Flip rearranges exact pixels, including signed/zero alpha and HDR."""
import json
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference


def main(output):
    pixels=np.random.default_rng(12392).uniform(-.4,2,(7,13,4)).astype(np.float32)
    pixels[...,3]=np.resize(np.asarray([0,-0.,-.5,.25,.5,1,1.5],np.float32),(7,13))
    oracle=NativeCompositorReference(output,pixels=pixels,
        device=os.environ.get('BLENDLINK_COMPOSITOR_FLIP_DEVICE','CPU'),name='Native Flip')
    tree=oracle.tree
    def flip(color, flags):
        node=tree.nodes.new('CompositorNodeFlip')
        if oracle.modern:
            node.inputs['Flip X'].default_value=flags[0];node.inputs['Flip Y'].default_value=flags[1]
        else:node.axis={ (True,False):'X',(False,True):'Y',(True,True):'XY'}[flags]
        tree.links.new(color,node.inputs['Image']);return node.outputs[0]
    def save(name,source):
        oracle.save(name,source)
        path=output/(oracle.rows[-1]['case']+'.json');doc=json.loads(path.read_text())
        # Flip -> Blur needs one materialization pass before the two convolution
        # passes. Include the harness caller-state pass, as for other fixtures.
        budget=5 if name.endswith('before-blur') else 4
        doc.update(assertTextureCleanup=True,assertMrtState=True,assertShaderCost={'maxPasses':budget,'maxFragmentBytes':12000})
        path.write_text(json.dumps(doc,separators=(',',':')))
    sink,source=oracle.reset();tree.links.new(source.outputs['Image'],sink.inputs[0]);save('flip-control',source)
    flags=[(False,False),(True,False),(False,True),(True,True)] if oracle.modern else [(True,False),(False,True),(True,True)]
    for axes in flags:
        for kind in ['field','constant','after-exposure','before-posterize','before-alpha-over','cascade','after-blur','before-blur']:
            sink,source=oracle.reset();color=source.outputs['Image']
            if kind=='constant':color=oracle.color((-.25,.5,2,0))
            if kind=='after-exposure':
                exposure=tree.nodes.new('CompositorNodeExposure');exposure.inputs['Exposure'].default_value=1.25
                tree.links.new(color,exposure.inputs['Image']);color=exposure.outputs[0]
            if kind=='after-blur':
                blur=tree.nodes.new('CompositorNodeBlur')
                if oracle.modern:blur.inputs['Size'].default_value=(2,3)
                else:blur.size_x,blur.size_y=2,3
                tree.links.new(color,blur.inputs['Image']);color=blur.outputs[0]
            color=flip(color,axes)
            if kind=='before-blur':
                blur=tree.nodes.new('CompositorNodeBlur')
                if oracle.modern:blur.inputs['Size'].default_value=(2,3)
                else:blur.size_x,blur.size_y=2,3
                tree.links.new(color,blur.inputs['Image']);color=blur.outputs[0]
            if kind=='before-posterize':
                posterize=tree.nodes.new('CompositorNodePosterize');posterize.inputs['Steps'].default_value=7
                tree.links.new(color,posterize.inputs['Image']);color=posterize.outputs[0]
            if kind=='before-alpha-over':
                over=tree.nodes.new('CompositorNodeAlphaOver')
                tree.links.new(color,over.inputs['Foreground'] if oracle.modern else over.inputs['Image_001'])
                tree.links.new(oracle.color((.25,.5,.75,1)),over.inputs['Background'] if oracle.modern else over.inputs['Image'])
                color=over.outputs[0]
            if kind=='cascade':color=flip(color,axes)
            tree.links.new(color,sink.inputs[0]);save('flip-'+str(int(axes[0]))+str(int(axes[1]))+'-'+kind,source)
    oracle.finish('BLENDLINK_COMPOSITOR_FLIP_PASSED')


destination=os.environ.get('BLENDLINK_COMPOSITOR_FLIP_REFERENCES')
if destination:main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-flip-') as directory:main(Path(directory))
