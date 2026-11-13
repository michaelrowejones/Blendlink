# SPDX-License-Identifier: GPL-3.0-or-later
"""Scalar C float primitives agree with actual Blender CPU geometry fields.

The installed-extension probe calls verify_native_math with installed modules;
standalone headless discovery uses the canonical checkout modules. No render,
GPU context, Python-double trig or NumPy approximation supplies the oracle.
"""
import math
import struct
import bpy


def verify_native_math(chroma, affine, blur):
    f32=lambda value:struct.unpack('<f',struct.pack('<f',value))[0]
    word=lambda value:struct.pack('<f',value)
    sinf,cosf,tanf,sqrtf,atan2f=chroma._native_math()
    affine_sin,affine_cos=affine.native_trigonometry()
    blur_exp,blur_sqrt=blur.gaussian_float_math()
    count=16
    repeat=lambda values:[f32(values[index%len(values)]) for index in range(count)]
    angles=repeat([-math.pi,-math.pi/2,-math.pi/4,-.1,-2**-20,-0.,0.,2**-20,.1,math.pi/32,math.pi/4,math.pi/2,math.pi])
    definitions=[
        ('sinf','SINE',angles,None,[sinf,affine_sin]),
        ('cosf','COSINE',angles,None,[cosf,affine_cos]),
        ('tanf','TANGENT',repeat([math.pi/64,.1,math.pi/16,.3,math.pi/8,.5,.7,math.pi/4]),None,[tanf]),
        ('sqrtf','SQRT',repeat([1/1024,1/64,.1,.2,.5,1,1.234567,2,16]),None,[sqrtf,blur_sqrt]),
        ('atan2f','ARCTAN2',repeat([-.75,-.25,-2**-20,-0.,0.,2**-20,.25,.75]),repeat([-.5,.5,1,-1]),[atan2f]),
        ('expf','EXPONENT',repeat([-4.5,-4,-3.2,-2,-1,-.5,-.1,0]),None,[blur_exp]),
    ]
    mesh=bpy.data.meshes.new('SceneToWeb native C math field inputs')
    mesh.from_pydata([(index,0,0) for index in range(count)],[],[])
    owner=bpy.data.objects.new('SceneToWeb native C math field probe',mesh)
    bpy.context.scene.collection.objects.link(owner)
    group=bpy.data.node_groups.new('SceneToWeb native C math field evaluation','GeometryNodeTree')
    group.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry')
    group.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
    incoming=group.nodes.new('NodeGroupInput');outgoing=group.nodes.new('NodeGroupOutput')
    geometry=incoming.outputs['Geometry']
    try:
        for name,operation,a,b,functions in definitions:
            calculation=group.nodes.new('ShaderNodeMath');calculation.operation=operation
            for index,values in enumerate([a] if b is None else [a,b]):
                attribute_name='blendlink_cmath_'+name+'_'+str(index)
                attribute=mesh.attributes.new(attribute_name,type='FLOAT',domain='POINT')
                attribute.data.foreach_set('value',values)
                field=group.nodes.new('GeometryNodeInputNamedAttribute');field.data_type='FLOAT'
                field.inputs['Name'].default_value=attribute_name
                group.links.new(field.outputs['Attribute'],calculation.inputs[index])
            store=group.nodes.new('GeometryNodeStoreNamedAttribute');store.data_type='FLOAT';store.domain='POINT'
            store.inputs['Name'].default_value='blendlink_cmath_out_'+name
            group.links.new(geometry,store.inputs['Geometry']);group.links.new(calculation.outputs[0],store.inputs['Value'])
            geometry=store.outputs['Geometry']
        group.links.new(geometry,outgoing.inputs['Geometry'])
        modifier=owner.modifiers.new('Native scalar C math','NODES');modifier.node_group=group
        bpy.context.view_layer.update();depsgraph=bpy.context.evaluated_depsgraph_get()
        evaluated=owner.evaluated_get(depsgraph);result=evaluated.to_mesh(preserve_all_data_layers=True,depsgraph=depsgraph)
        try:
            assert len(result.vertices)==count
            checked=0
            for name,_operation,a,b,functions in definitions:
                values=[entry.value for entry in result.attributes['blendlink_cmath_out_'+name].data]
                for index,actual in enumerate(values):
                    assert math.isfinite(actual),(name,index,'native field is nonfinite')
                    for function in functions:
                        expected=function(a[index]) if b is None else function(a[index],b[index])
                        assert word(actual)==word(expected),(name,index,a[index],None if b is None else b[index],actual,expected)
                        checked+=1
        finally:evaluated.to_mesh_clear()
        return {'points':count,'functions':[row[0] for row in definitions],'exactScalarComparisons':checked,
                'oracle':'actual Geometry Nodes CPU float fields','renderRequired':False}
    finally:
        bpy.data.objects.remove(owner,do_unlink=True);bpy.data.meshes.remove(mesh);bpy.data.node_groups.remove(group)


if __name__=='__main__':
    import sys
    from pathlib import Path
    sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'blendlink/blender'))
    import compositor_chroma_key,compositor_affine,compositor_blur
    print('BLENDLINK_NATIVE_COMPOSITOR_MATH_PASSED '+str(verify_native_math(compositor_chroma_key,compositor_affine,compositor_blur)))
