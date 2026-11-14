# SPDX-License-Identifier: GPL-3.0-or-later
"""Explicit mono context fixture; shared selection proof framework stays unchanged."""
import json
from pathlib import Path

def cases():
    return json.loads((Path(__file__).parent/'view-cases.json').read_text())

def build(tree,row,context,field=None):
    import bpy
    from array import array
    assert context=='compositor'
    scene=bpy.context.scene;scene.render.use_multiview=False
    right=next(view for view in scene.render.views if view.name in {'right','Artist right'})
    right.name='right';right.use=True;scene.render.views['left'].use=row['kind']not in {'view-disabled','view-renamed'}
    if row['kind']=='view-renamed':right.name='Artist right'
    node=tree.nodes.new('CompositorNodeSwitchView');assert node.inputs
    for index,socket in enumerate(node.inputs):socket.default_value=(.125,.25,.5,1)if index==0 else(.75,.5,.25,1)
    if row['kind']=='view-inactive':
        assert len(node.inputs)>1
        time=tree.nodes.new('CompositorNodeSceneTime');tree.links.new(time.outputs['Frame'],node.inputs[1])
    if row['kind']=='view-group':
        group=bpy.data.node_groups.new('Artist selected view branch','CompositorNodeTree');group.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');out=group.nodes.new('NodeGroupOutput');rgb=group.nodes.new('CompositorNodeRGB');rgb.outputs[0].default_value=(.125,.25,.5,1);reroute=group.nodes.new('NodeReroute');group.links.new(rgb.outputs[0],reroute.inputs[0]);group.links.new(reroute.outputs[0],out.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;tree.links.new(instance.outputs[0],node.inputs[0])
    if row['kind']=='view-image':
        # Existing admitted byte-PNG input; endpoints survive sRGB exactly.
        # PNG rows are top-down, while Blender's pixel collection is bottom-up.
        import os,struct,zlib
        samples=[(int(x<3),int(y<5),int((x+2*y)%3==0),1)for y in range(8)for x in range(8)]
        def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
        scanlines=b''.join(b'\x00'+bytes(lane*255 for rgba in samples[y*8:(y+1)*8]for lane in rgba)for y in reversed(range(8)))
        file=Path(os.environ['SCENETOWEB_SWITCH_REFERENCES'])/'view-field-source.png';file.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',8,8,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(scanlines))+chunk(b'IEND',b''))
        image=bpy.data.images.load(str(file),check_existing=False);image.alpha_mode='STRAIGHT';image.colorspace_settings.name='sRGB';back=array('f',[0])*256;image.pixels.foreach_get(back);assert list(back)==[float(lane)for rgba in samples for lane in rgba]
        image.pack();assert image.packed_file is not None and not image.is_float
        source=tree.nodes.new('CompositorNodeImage');source.image=image;tree.links.new(source.outputs['Image'],node.inputs[0])
    if row['kind']=='view-domain':
        tree.links.new(field,node.inputs[0]);info=tree.nodes.new('CompositorNodeImageInfo');tree.links.new(node.outputs['Image'],info.inputs['Image']);return info.outputs['Dimensions'],node
    return node.outputs['Image'],node
