"""Independent CPU archival check of native float fields and embedded raw data PNGs."""
from pathlib import Path
import argparse,hashlib,json,struct,zlib,sys
import numpy as np
p=argparse.ArgumentParser();p.add_argument('folder');a=p.parse_args();folder=Path(a.folder);ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
from normal_bake_transport import validate_encoding
report=json.loads((folder/'report.json').read_text());raw=(folder/'material.glb').read_bytes();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);binary=raw[20+length+8:]
def png(data):
 assert data[:8]==b'\x89PNG\r\n\x1a\n';i=8;payload=[];width=height=channels=0
 while i<len(data):
  n=struct.unpack_from('>I',data,i)[0];kind=data[i+4:i+8];chunk=data[i+8:i+8+n];assert zlib.crc32(kind+chunk)&0xffffffff==struct.unpack_from('>I',data,i+8+n)[0]
  if kind==b'IHDR':
   width,height,depth,color,compression,filtering,interlace=struct.unpack('>IIBBBBB',chunk);assert depth==8 and color in (2,6)and compression==filtering==interlace==0;channels=3 if color==2 else 4
  elif kind==b'IDAT':payload.append(chunk)
  i+=12+n
 packed=zlib.decompress(b''.join(payload));stride=width*channels;previous=bytearray(stride);rows=[];cursor=0
 for y in range(height):
  method=packed[cursor];cursor+=1;row=bytearray(packed[cursor:cursor+stride]);cursor+=stride
  for x in range(stride):
   left=row[x-channels]if x>=channels else 0;up=previous[x];ul=previous[x-channels]if x>=channels else 0
   if method==0:predict=0
   elif method==1:predict=left
   elif method==2:predict=up
   elif method==3:predict=(left+up)//2
   elif method==4:
    q=left+up-ul;dist=[abs(q-left),abs(q-up),abs(q-ul)];predict=(left,up,ul)[dist.index(min(dist))]
   else:raise AssertionError('Unexpected PNG filter')
   row[x]=(row[x]+predict)&255
  rows.append(row);previous=row
 assert cursor==len(packed)
 return np.frombuffer(b''.join(rows),dtype=np.uint8).reshape(height,width,channels)[::-1,:,:3].astype(np.float32)/255
material=doc['materials'][0];slots={'Normal':material['normalTexture']}
if 'Coat Normal'in report['normalChannels']:slots['Coat Normal']=material['extensions']['KHR_materials_clearcoat']['clearcoatNormalTexture']
rows=[]
for number,(channel,info)in enumerate(slots.items(),1):
 image=doc['images'][doc['textures'][info['index']]['source']];view=doc['bufferViews'][image['bufferView']];data=binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
 expected=next(row for row in report['rows']if ('Coat Normal'in row['channel'])==(channel=='Coat Normal'));assert hashlib.sha256(data).hexdigest()==expected['sha256']
 native=np.load(folder/f'float-{number}.npy');delivery=np.load(folder/f'coverage-{number}.npy');surface=np.load(folder/f'surface-coverage-{number}.npy');decoded=png(data);gate=validate_encoding(native,delivery,surface,decoded)
 assert gate['deliveryTexels']==expected['expandedCoveredTexels']and gate['actualSurfaceTexels']==expected['actualSurfaceTexels']
 assert abs(gate['maxEncodedError']-expected['maxEncodedError'])<1e-7 and abs(gate['maxSurfaceAngularDegrees']-expected['maxAngularDegrees'])<1e-6
 rows.append({'channel':channel,**gate})
print(json.dumps({'status':'VERIFIED_NATIVE_NORMAL_PNG_ARCHIVE','rows':rows,'liveNodeCredit':0}))
