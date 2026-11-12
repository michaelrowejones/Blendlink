# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual native Set Alpha/Alpha Convert: signed/HDR, constants and fields."""
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference


def main(output):
    pixels = np.random.default_rng(9124).uniform(-.5, 2, (7, 13, 4)).astype(np.float32)
    alphas = np.asarray([0, -0., 2**-24, -(2**-24), 2**-10, -(2**-10), .125, .3, .7, 1, -1, 1.5, -.5], np.float32)
    pixels[..., 3] = alphas[None, :]
    # Keep small-alpha quotients finite and bounded, with independent hidden
    # color at exactly zero. Tiny alpha is never replaced with an epsilon.
    pixels[:, 2:6, :3] *= alphas[None, 2:6, None]
    oracle = NativeCompositorReference(output,
        device=os.environ.get('BLENDLINK_COMPOSITOR_ALPHA_CONVERSION_DEVICE', 'CPU'),
        name='Native Alpha Conversion', pixels=pixels)
    tree = oracle.tree
    sink, source = oracle.reset()
    tree.links.new(source.outputs['Image'], sink.inputs[0])
    oracle.save('alpha-conversion-control', source, exact_alpha=True)

    def mode(node, name):
        if oracle.modern: node.inputs['Type'].default_value = name
        elif node.bl_idname == 'CompositorNodeSetAlpha':
            node.mode = {'Apply Mask':'APPLY', 'Replace Alpha':'REPLACE_ALPHA'}[name]
        else:
            node.mapping = {'To Premultiplied':'STRAIGHT_TO_PREMUL','To Straight':'PREMUL_TO_STRAIGHT'}[name]

    for kind, modes in [('CompositorNodeSetAlpha', ['Apply Mask','Replace Alpha']),
                         ('CompositorNodePremulKey', ['To Premultiplied','To Straight'])]:
        for name in modes:
            for image_kind in ['field','constant-zero','constant-negative','constant-fractional']:
                alpha_values = [-.5,0,.25,1,1.5,'field'] if kind == 'CompositorNodeSetAlpha' else [None]
                for alpha in alpha_values:
                    sink, source = oracle.reset()
                    color = source.outputs['Image'] if image_kind == 'field' else oracle.color(
                        {'constant-zero':(.25,-.5,2,0), 'constant-negative':(.25,-.5,2,-.5),
                         'constant-fractional':(.25,-.5,2,.3)}[image_kind])
                    node = tree.nodes.new(kind); mode(node, name)
                    tree.links.new(color, node.inputs['Image'])
                    if alpha is not None:
                        incoming = oracle.separate(source.outputs['Image']).outputs['Alpha'] if alpha == 'field' else oracle.value(alpha)
                        tree.links.new(incoming, node.inputs['Alpha'])
                    tree.links.new(node.outputs[0], sink.inputs[0])
                    oracle.save(kind.lower()+'-'+name.lower().replace(' ','-')+'-'+image_kind+'-'+str(alpha), source,
                                exact_alpha=kind == 'CompositorNodePremulKey')
    # Chaining both conversion directions should retain RGB at alpha zero;
    # subsequent pointwise operations see the native result, not a baked image.
    for sequence in [('To Straight','To Premultiplied'),('To Premultiplied','To Straight')]:
        sink, source = oracle.reset(); color = source.outputs['Image']
        for name in sequence:
            node = tree.nodes.new('CompositorNodePremulKey');mode(node,name)
            tree.links.new(color,node.inputs['Image']);color=node.outputs[0]
        tree.links.new(color,sink.inputs[0])
        oracle.save('alpha-conversion-cascade-'+sequence[0].lower().replace(' ','-'),source,exact_alpha=True)
    oracle.finish('BLENDLINK_COMPOSITOR_ALPHA_CONVERSION_PASSED')


destination = os.environ.get('BLENDLINK_COMPOSITOR_ALPHA_CONVERSION_REFERENCES')
if destination: main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-alpha-conversion-') as directory: main(Path(directory))
