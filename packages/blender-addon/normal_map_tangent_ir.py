# SPDX-License-Identifier: GPL-3.0-or-later
"""Native EEVEE tangent normal composition on an owned, finite Mikk frame."""
import math
import bpy

if __package__:
    from . import tangent_ir,normal_input_bounds
else:
    import tangent_ir
    import normal_input_bounds


def emit(node,*,emit_vector,emit_scalar,refuse,engine):
    if engine!='EEVEE':refuse('Fresh native tangent Normal Map currently uses EEVEE; Cycles retains its separate route')
    convention,base=getattr(node,'convention','OPENGL'),getattr(node,'base','ORIGINAL')
    if convention not in {'OPENGL','DIRECTX'} or base not in {'ORIGINAL','DISPLACED'}:
        refuse('Normal Map tangent has no verified convention/base selector')
    color=emit_vector(node.inputs['Color']);strength=emit_scalar(node.inputs['Strength'])
    try:normal_input_bounds.coefficients(color,strength,convention)
    except ValueError as error:refuse(str(error))
    return {"op": "normal_map_tangent_native",'model':'eevee-mikk-normal-v1','sourceEngine':'EEVEE',
            'color':color,'strength':strength,'convention':convention,'base':base,
            'frame':tangent_ir.uv_frame(str(node.uv_map),engine=engine,refuse=refuse)}


def requirements(value,result):
    if isinstance(value,dict):
        if value.get('op')=='normal_map_tangent_native':result.append(value)
        for child in value.values():requirements(child,result)
    elif isinstance(value,(tuple,list)):
        for child in value:requirements(child,result)


def pin_default_uv(value,owners):
    if isinstance(value,dict):
        if value.get('op')=='uv' and not value.get('uvMap'):
            names={next((layer.name for layer in owner.data.uv_layers if layer.active_render),None) for owner in owners}
            if None in names or len(names)!=1:
                raise ValueError('Normal Map image inputs need an unambiguous active-render UV name across these owners')
            value['uvMap']=names.pop()
        for child in value.values():pin_default_uv(child,owners)
    elif isinstance(value,(tuple,list)):
        for child in value:pin_default_uv(child,owners)


def validate_owners(value,owners):
    entries=[];requirements(value,entries)
    for entry in entries:
        pin_default_uv(entry['color'],owners);pin_default_uv(entry['strength'],owners)
        minimum,maximum=normal_input_bounds.coefficients(entry['color'],entry['strength'],entry['convention'])
        for owner in owners:
            frame=entry['frame'];bound=tangent_ir.frame_bound(owner.data,frame['uvMap'],frame['tangentStorage'])
            matrix=owner.evaluated_get(bpy.context.evaluated_depsgraph_get()).matrix_world.to_3x3().inverted().transposed()
            condition=math.sqrt(sum(item*item for row in matrix for item in row)*sum(item*item for row in matrix.inverted() for item in row))
            normal_input_bounds.certify(bound,condition,minimum,maximum)
