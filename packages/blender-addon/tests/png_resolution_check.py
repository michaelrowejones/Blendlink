# SPDX-License-Identifier: GPL-3.0-or-later
"""Background byte edits preserve live PNG resolution metadata and RGB."""
from pathlib import Path
import struct
import sys
import tempfile
import bpy
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"blendlink/blender"))
import bakelib

def chunks(path,kind):
    raw=Path(path).read_bytes();offset=8;values=[]
    while offset<len(raw):
        size=struct.unpack_from('>I',raw,offset)[0]
        if raw[offset+4:offset+8]==kind:values.append(raw[offset+8:offset+8+size])
        offset+=size+12
    return values

before=len(bpy.data.images)
with tempfile.TemporaryDirectory(prefix="blendlink-png-resolution-") as temporary:
    for index,density in enumerate([(72/.0254,72/.0254),(300/.0254,150/.0254)]):
        image=bpy.data.images.new("Live resolution",width=4,height=4,float_buffer=True,alpha=True)
        try:
            image.resolution=density;prior=tuple(image.resolution)
            image.pixels.foreach_set(np.tile(np.float32([.25,.5,.75,1]),16))
            expected=Path(temporary)/f'expected-{index}.png';actual=Path(temporary)/f'actual-{index}.png'
            bakelib.save_data_png(image,str(expected))
            mask=np.ones((4,4),dtype=bool);mask[0,0]=False
            bakelib.save_resolved(image,str(actual),4,coverage=mask,data=True,delivery_sizes=[])
            assert chunks(expected,b'eXIf')==chunks(actual,b'eXIf'),"Private PNG rewrite changed original physical resolution metadata"
            assert chunks(expected,b'IDAT')==chunks(actual,b'IDAT'),"Metadata preservation changed encoded constant RGB"
            assert tuple(image.resolution)==prior,"Caller image resolution was changed"
        finally:bpy.data.images.remove(image)
assert len(bpy.data.images)==before
print("BLENDLINK_PNG_RESOLUTION_PASSED",bpy.app.version_string)
