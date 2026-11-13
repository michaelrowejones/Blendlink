# SPDX-License-Identifier: GPL-3.0-or-later
"""Old documents remain renderer fixtures, never fresh Cycles source ports."""
import ast
import json
from pathlib import Path
import sys
import bpy
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'packages/blender-addon'))
sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
import tsl_ir
path=ROOT/'experiments/tsl-node-differential/reference.py'
names={'build_tex_magic','build_tex_magic_fac','legacy_magic_document'}
functions=[node for node in ast.parse(path.read_text()).body if isinstance(node,ast.FunctionDef) and node.name in names]
assert len(functions)==3
namespace={'bpy':bpy,'tsl_ir':tsl_ir}
exec(compile(ast.fix_missing_locations(ast.Module(body=functions,type_ignores=[])),str(path),'exec'),namespace)
cells=json.loads((path.parent/'cells.json').read_text())['cells']
for identifier,builder,output in [('tex-magic','build_tex_magic','color'),('tex-magic-fac','build_tex_magic_fac','fac')]:
    cell=next(item for item in cells if item['id']==identifier)
    assert cell['pipeline']=='legacy-ir' and cell['scope']=='legacy-serialized-runtime-only'
    material=bpy.data.materials.new(identifier);material.use_nodes=True;tree=material.node_tree;tree.nodes.clear()
    emission=tree.nodes.new('ShaderNodeEmission');namespace[builder](tree,emission)
    state=lambda:(len(tree.nodes),[(link.from_node.name,link.from_socket.identifier,link.to_node.name,link.to_socket.identifier) for link in tree.links])
    before=state();document,reason=namespace['legacy_magic_document'](material,cell)
    assert state()==before and 'requires EEVEE' in reason
    assert document=={'schemaVersion':1,'model':'blendlink-tsl-ir-v1','output':{'op':'tex_magic','depth':2,'output':output,'vector':{'op':'uv'},
        'scale':{'op':'const_float','value':3},'distortion':{'op':'const_float','value':1.2000000476837158}}}
    next(node for node in tree.nodes if node.bl_idname=='ShaderNodeTexMagic').inputs['Scale'].default_value=4
    try:namespace['legacy_magic_document'](material,cell)
    except AssertionError:pass
    else:raise AssertionError('Legacy fixture silently changed its serialized semantics')
    bpy.data.materials.remove(material,do_unlink=True)
print('BLENDLINK_MAGIC_LEGACY_COMPAT_PASSED '+bpy.app.version_string)
