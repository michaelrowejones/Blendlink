# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual native kernels, alpha behavior, constants, signed fields and composition."""
import json
import os
import sys
import tempfile
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference, compositor_graph


def main(output):
    pixels=np.random.default_rng(6512).uniform(-.4,2,(7,13,4)).astype(np.float32)
    pixels[...,3]=np.resize(np.asarray([0,-.5,.25,.5,1,1.5,.75],np.float32),(7,13))
    impulse=np.zeros_like(pixels);impulse[3,6]=[2,-.25,.75,1.5];impulse[0,0]=[1,.5,-.25,-.5]
    oracle=NativeCompositorReference(output,pixels=pixels,
        device=os.environ.get('BLENDLINK_COMPOSITOR_FILTER_DEVICE','CPU'),name='Native Filter')
    tree=oracle.tree
    modes={'SOFTEN':'Soften','SHARPEN':'Box Sharpen','SHARPEN_DIAMOND':'Diamond Sharpen',
           'LAPLACE':'Laplace','SOBEL':'Sobel','PREWITT':'Prewitt','KIRSCH':'Kirsch','SHADOW':'Shadow'}
    def filter(color,mode,factor):
        node=tree.nodes.new('CompositorNodeFilter')
        if oracle.modern:node.inputs['Type'].default_value=modes[mode]
        else:node.filter_type=mode
        tree.links.new(color,node.inputs['Image']);tree.links.new(factor,node.inputs['Fac']);return node.outputs[0]
    def save(name,source):
        oracle.save(name,source)
        p=output/(oracle.rows[-1]['case']+'.json');d=json.loads(p.read_text())
        d.update(assertTextureCleanup=True,assertMrtState=True,assertShaderCost={'maxPasses':5,'maxFragmentBytes':20000})
        p.write_text(json.dumps(d,separators=(',',':')))
    sink,source=oracle.reset();tree.links.new(source.outputs['Image'],sink.inputs[0]);save('filter-control',source)
    for pattern in ['random','impulse','constant','negative-constant']:
        oracle.pixels[:]=impulse if pattern=='impulse' else pixels
        oracle.image.pixels.foreach_set(oracle.pixels.ravel())
        for mode in modes:
            for amount in [-.5,0,.25,1,1.5,'field']:
                sink,source=oracle.reset()
                image=oracle.color((-.25,.5,2,0) if pattern=='constant' else (.3,-.5,2,-.5)) if 'constant' in pattern else source.outputs['Image']
                factor=oracle.separate(source.outputs['Image']).outputs['Red'] if amount=='field' else oracle.value(amount)
                color=filter(image,mode,factor);tree.links.new(color,sink.inputs[0])
                save('filter-'+pattern+'-'+mode.lower()+'-'+str(amount),source)
    oracle.pixels[:]=pixels;oracle.image.pixels.foreach_set(oracle.pixels.ravel())
    for mode in modes:
        for composed in ['before-posterize','after-flip','before-blur']:
            sink,source=oracle.reset();image=source.outputs['Image']
            if composed=='after-flip':
                flip=tree.nodes.new('CompositorNodeFlip')
                if oracle.modern:flip.inputs['Flip X'].default_value=True
                else:flip.axis='X'
                tree.links.new(image,flip.inputs['Image']);image=flip.outputs[0]
            color=filter(image,mode,oracle.value(.75))
            if composed=='before-posterize':
                posterize=tree.nodes.new('CompositorNodePosterize');posterize.inputs['Steps'].default_value=7
                tree.links.new(color,posterize.inputs['Image']);color=posterize.outputs[0]
            if composed=='before-blur':
                blur=tree.nodes.new('CompositorNodeBlur')
                if oracle.modern:blur.inputs['Size'].default_value=(2,3)
                else:blur.size_x,blur.size_y=2,3
                tree.links.new(color,blur.inputs['Image']);color=blur.outputs[0]
            tree.links.new(color,sink.inputs[0]);save('filter-'+mode.lower()+'-'+composed,source)
    # Refusals preserve the authored node, links and selector values.
    def snapshot():
        return ([node.as_pointer() for node in tree.nodes],
                [(link.from_socket.as_pointer(), link.to_socket.as_pointer()) for link in tree.links],
                oracle.scene.render.compositor_precision)
    sink, source = oracle.reset()
    color = filter(source.outputs['Image'], 'SOFTEN', oracle.value(.5))
    tree.links.new(color, sink.inputs[0])
    node = color.node
    if oracle.modern:
        # A reroute keeps this a real linked menu socket without introducing
        # another unported dependency which might hide the selector refusal.
        selector = tree.nodes.new('NodeReroute')
        tree.links.new(selector.outputs[0], node.inputs['Type'])
        before = snapshot()
        result = compositor_graph.extract(oracle.scene)
        assert result['status'] == 'unsupported' and any(
            item['code'] == 'unsupported-filter-mode' and 'fixed kernel' in item['message']
            for item in result['diagnostics']), result
        assert snapshot() == before
        tree.links.remove(node.inputs['Type'].links[0])
    precision_modes = {item.identifier for item in oracle.scene.render.bl_rna.properties['compositor_precision'].enum_items}
    if oracle.device == 'GPU' and 'HALF' in precision_modes:
        oracle.scene.render.compositor_precision = 'HALF'
        before = snapshot()
        result = compositor_graph.extract(oracle.scene)
        assert result['status'] == 'unsupported' and any(
            item['code'] == 'unsupported-filter-mode' and 'precision' in item['message']
            for item in result['diagnostics']), result
        assert snapshot() == before
        oracle.scene.render.compositor_precision = 'FULL'
    oracle.finish('BLENDLINK_COMPOSITOR_FILTER_PASSED')


destination=os.environ.get('BLENDLINK_COMPOSITOR_FILTER_REFERENCES')
if destination:main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-filter-') as directory:main(Path(directory))
