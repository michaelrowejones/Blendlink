# SPDX-License-Identifier: GPL-3.0-or-later
"""Native fixed Switch choices preserve selected fields and skip inactive graphs."""
import json
import os
import sys
import tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference, compositor_graph


def main(output):
    oracle=NativeCompositorReference(output,
        device=os.environ.get('BLENDLINK_COMPOSITOR_SWITCH_DEVICE','CPU'),name='Native Fixed Switch')
    tree=oracle.tree
    sink,source=oracle.reset();tree.links.new(source.outputs['Image'],sink.inputs[0]);oracle.save('switch-control',source,exact_alpha=True)
    for choice in [False,True]:
        for inputs in ['field-constant','constant-field','field-field','constant-constant','inactive-unsupported']:
            sink,source=oracle.reset();node=tree.nodes.new('CompositorNodeSwitch')
            if oracle.modern:node.inputs['Switch'].default_value=choice
            else:node.check=choice
            constant=oracle.color((-.25,.5,2,0));field=source.outputs['Image']
            exposure=tree.nodes.new('CompositorNodeExposure');exposure.inputs['Exposure'].default_value=1.25
            tree.links.new(field,exposure.inputs['Image'])
            pairs={'field-constant':(field,constant),'constant-field':(constant,field),
                   'field-field':(field,exposure.outputs[0]),'constant-constant':(constant,oracle.color((1.5,-.5,.25,-.5)))}
            if inputs=='inactive-unsupported':
                unsupported=tree.nodes.new('CompositorNodeTransform');tree.links.new(field,unsupported.inputs['Image'])
                off,on=(unsupported.outputs[0],field) if choice else (field,unsupported.outputs[0])
            else:off,on=pairs[inputs]
            tree.links.new(off,node.inputs['Off']);tree.links.new(on,node.inputs['On']);tree.links.new(node.outputs[0],sink.inputs[0])
            before=(len(tree.nodes),len(tree.links),len(oracle.scene.collection.objects))
            inspected=compositor_graph.extract(oracle.scene)
            assert inspected["status"]=="extracted",inspected
            assert before==(len(tree.nodes),len(tree.links),len(oracle.scene.collection.objects))
            oracle.save('switch-'+str(int(choice))+'-'+inputs,source)
            # oracle.save adds its native image replacement only after extraction.
            document=json.loads((output/(oracle.rows[-1]['case']+'.json')).read_text())
            selected=next(op for op in document['program']['ops'] if op['kind']=='switch')
            assert selected['properties']['switch_selected']==('On' if choice else 'Off')
            assert set(selected['inputs'])=={'Selected'}
            if inputs=='inactive-unsupported':
                assert all(op['source']['nodeType']!='CompositorNodeTransform' for op in document['program']['ops'])
    oracle.finish('BLENDLINK_COMPOSITOR_SWITCH_PASSED')


destination=os.environ.get('BLENDLINK_COMPOSITOR_SWITCH_REFERENCES')
if destination:main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-switch-') as directory:main(Path(directory))
