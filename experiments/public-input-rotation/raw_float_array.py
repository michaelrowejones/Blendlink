# SPDX-License-Identifier: GPL-3.0-or-later
"""Research-only public Float32 array reader; callers still own source admission."""
from array import array
import struct
import bpy

def raw_float_array_words(owner,property_name,length):
    # Reject indexed/nested paths: path_resolve indexes promote through pyrna_array_index.
    if not isinstance(owner,bpy.types.bpy_struct)or not isinstance(property_name,str)or not property_name.isidentifier()or type(length)is not int or not 1<=length<=16:
        raise ValueError('Raw Float32 array requires a native owner, whole property identifier and bounded length')
    metadata=owner.bl_rna.properties.get(property_name)
    if metadata is None or metadata.type!='FLOAT'or not metadata.is_array:
        raise ValueError('Raw Float32 array requires actual native Float array metadata')
    prop=owner.path_resolve(property_name,False)
    if type(prop).__name__!='bpy_prop_array'or len(prop)!=length:
        raise ValueError('Raw Float32 array native width changed')
    buffer=array('f',[0])*length
    prop.foreach_get(buffer)
    return struct.unpack('='+str(length)+'I',buffer.tobytes())
