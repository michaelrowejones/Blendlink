"""Exact 8-bit RGB(A) PNG inspection for retained private attestation assets."""
import json
from pathlib import Path
import struct
import sys
import zlib


def decode(path):
    data = Path(path).read_bytes(); assert data[:8] == b'\x89PNG\r\n\x1a\n'
    offset = 8; compressed = bytearray(); chunks = []
    while offset < len(data):
        length = struct.unpack_from('>I', data, offset)[0]; kind = data[offset+4:offset+8]; payload = data[offset+8:offset+8+length]
        chunks.append([kind.decode(), length]); offset += length + 12
        if kind == b'IHDR': width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', payload)
        elif kind == b'IDAT': compressed.extend(payload)
    assert depth == 8 and color in (2, 6) and interlace == 0
    channels = {2: 3, 6: 4}[color]; stride = width * channels; raw = zlib.decompress(compressed)
    pixels = bytearray(); previous = bytearray(stride)
    def paeth(a,b,c):
        p=a+b-c; pa,pb,pc=abs(p-a),abs(p-b),abs(p-c)
        return a if pa<=pb and pa<=pc else b if pb<=pc else c
    for y in range(height):
        method = raw[y*(stride+1)]; row = bytearray(raw[y*(stride+1)+1:(y+1)*(stride+1)])
        for x in range(stride):
            a=row[x-channels] if x>=channels else 0; b=previous[x]; c=previous[x-channels] if x>=channels else 0
            predictor = [lambda:0,lambda:a,lambda:b,lambda:(a+b)//2,lambda:paeth(a,b,c)][method]()
            row[x] = (row[x] + predictor) & 255
        pixels.extend(row); previous=row
    return width, height, channels, pixels, chunks


left,right = map(decode,sys.argv[1:3]); assert left[:3] == right[:3]
different = [index for index,(a,b) in enumerate(zip(left[3],right[3])) if a!=b]
print(json.dumps({'shape':left[:3],'chunks':[left[4],right[4]],'differentBytes':len(different),
    'byChannel':[sum(index%left[2]==channel for index in different) for channel in range(left[2])],
    'maximumByteError':max([abs(left[3][index]-right[3][index]) for index in different] or [0]),
    'examples':[(index,left[3][index],right[3][index]) for index in different[:16]]},indent=2))
