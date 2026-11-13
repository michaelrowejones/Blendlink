import bpy,json,os
from pathlib import Path
tree=bpy.data.node_groups.new('Channel Key probe','CompositorNodeTree')
node=tree.nodes.new('CompositorNodeChannelMatte')
def value(item):
    if isinstance(item,(str,int,float,bool)) or item is None:return item
    try:return list(item)
    except:return str(item)
def sockets(items):
    result=[]
    for item in items:
        prop=item.bl_rna.properties.get('default_value')
        result.append({'id':item.identifier,'name':item.name,'type':item.type,'enabled':item.enabled,'hide':item.hide,
            'default':value(getattr(item,'default_value',None)),
            'enum':[e.identifier for e in prop.enum_items] if prop and prop.type=='ENUM' else None,
            'min':prop.hard_min if prop and prop.type in {'FLOAT','INT'} else None,
            'max':prop.hard_max if prop and prop.type in {'FLOAT','INT'} else None})
    return result
props={}
for prop in node.bl_rna.properties:
    if prop.identifier in {'rna_type'} or prop.identifier in bpy.types.Node.bl_rna.properties:continue
    if prop.type in {'ENUM','FLOAT','INT','BOOLEAN','STRING'}:
        props[prop.identifier]={'type':prop.type,'value':value(getattr(node,prop.identifier)),
            'enum':[e.identifier for e in prop.enum_items] if prop.type=='ENUM' else None}
report={'version':bpy.app.version_string,'hash':bpy.app.build_hash.decode(),'inputs':sockets(node.inputs),
    'outputs':sockets(node.outputs),'properties':props}
out=Path(os.environ['BLENDLINK_CHANNEL_PROBE']);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2))
print('CHANNEL_PROBE',json.dumps(report))
