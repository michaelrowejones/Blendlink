# SPDX-License-Identifier: GPL-3.0-or-later
"""Color Correction region boundaries preserve native quotient rounding.

OpenGL's native quotient and Metal's reciprocal can choose different ordered
branches at nextafter(0.6,-infinity). Collapsed/reversed regions remain defined:
the native implementation has no division by an interval width.
"""
import json
import os
from pathlib import Path
import sys
import tempfile
import bpy
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference


def main(destination):
    oracle=NativeCompositorReference(destination,device=os.environ.get('BLENDLINK_COLOR_INTERVAL_DEVICE','CPU'),name='Color Correction Interval Boundary')
    levels=[np.nextafter(np.float32(level),np.float32(direction))
        for level in (.1,.3,.4,.5,.6,.7,.8) for direction in (-np.inf,np.inf)]
    for index,level in enumerate(levels):oracle.pixels[index//8,index%8,:3]=level
    oracle.image.pixels.foreach_set(oracle.pixels.ravel())
    def setting(node,name,value,source):
        if node.inputs.get(name) is not None:
            incoming=oracle.separate(source.outputs['Image']).outputs['Red'] if value=='spatial' else oracle.value(value)
            oracle.tree.links.new(incoming,node.inputs[name])
        else:setattr(node,name.lower().replace(' ','_').replace('offset','lift'),value)
    for start,end in [(.2,.7),(.5,.5),(.65,.35),(.25,.3),(.4,.6)]:
        for constant in [False,True]:
            sink,source=oracle.reset();node=oracle.tree.nodes.new('CompositorNodeColorCorrection')
            color=oracle.color((float(np.nextafter(np.float32(.6),np.float32(-np.inf))),)*3+(.35,)) if constant else source.outputs['Image']
            oracle.tree.links.new(color,node.inputs['Image']);oracle.tree.links.new(node.outputs[0],sink.inputs[0])
            for name,value in [('Master Contrast',1.2),('Master Saturation',.8),('Master Gamma',1.1),('Master Gain',1.2),('Master Offset',-.15),
                ('Shadows Gain',.7),('Shadows Offset',.1),('Midtones Gamma',1.4),('Midtones Saturation',1.3),('Highlights Contrast',.65),('Highlights Offset',.25),
                ('Midtones Start',start),('Midtones End',end)]:setting(node,name,value,source)
            oracle.save(f'color-correction-boundary-{start}-{end}-constant-{int(constant)}',source,exact_alpha=True)
            data=json.loads((oracle.output/(oracle.rows[-1]['case']+'.json')).read_text())
            op=next(op for op in data['program']['ops'] if op['kind']=='color-correction')
            assert op['properties']['native_gpu_backend']==str(bpy.context.preferences.system.gpu_backend)
    if node.inputs.get('Midtones End') is not None:
        for control in ['Midtones Start','Midtones End']:
            sink,source=oracle.reset();node=oracle.tree.nodes.new('CompositorNodeColorCorrection')
            oracle.tree.links.new(source.outputs['Image'],node.inputs['Image']);oracle.tree.links.new(node.outputs[0],sink.inputs[0])
            setting(node,'Midtones Start',.2,source);setting(node,'Midtones End',.7,source)
            setting(node,'Midtones Gamma',1.4,source);setting(node,'Highlights Contrast',.65,source);setting(node,control,'spatial',source)
            oracle.save('color-correction-boundary-'+control.lower().replace(' ','-'),source,exact_alpha=True)
    oracle.finish('BLENDLINK_COLOR_INTERVAL_PASSED')


destination=os.environ.get('BLENDLINK_COLOR_INTERVAL_REFERENCES')
if destination:main(destination)
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-color-interval-') as directory:main(directory)
