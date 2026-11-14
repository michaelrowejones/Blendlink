# SPDX-License-Identifier: GPL-3.0-or-later
import sys,json,os,hashlib,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from oracle import capture,word,OracleUnsupported,snapshot
from array import array
import struct,bpy
OUT=Path(os.environ['SCENETOWEB_CPU_MF_ORACLE']);OUT.mkdir(parents=True,exist_ok=True)
specs=[]
for i in [-2147483648,2147483647,2049]:specs.append({'id':'int-'+str(i),'kind':'int','value':i,'expectedValues':[i]})
for label,bits in [('ordinary',word(.1)),('third',word(1/3)),('half-film-loss',word(2016.125)),('odd-hdr',word(2049.0)),('normal-min',0x00800000),('positive-zero',0),('negative-normal',word(-.1))]:specs.append({'id':'float-'+label,'kind':'float','word':bits,'expectedWords':[bits]})
for label,text,base,value,length in [('min','-2147483648',10,-2147483648,11),('max','2147483647',10,2147483647,10),('hex-min','-80000000🙂',16,-2147483648,9),('overflow','2147483648',10,0,0)]:
 for output,wanted in [('Value',value),('Length',length)]:specs.append({'id':'parse-'+label+'-'+output,'kind':'parse','text':text,'base':base,'output':output,'expectedValues':[wanted]})
values=[i/16 for i in range(1,17)]
for kind in ['matrix','matrix-multiply']:specs.append({'id':kind,'kind':kind,'values':values,'expectedWords':[word(v)for v in values]})
for label,values in [('identity',[1,0,0,0]),('x',[0,1,0,0]),('y',[0,0,1,0]),('z',[0,0,0,1]),('negative-w',[-1,0,0,0])]:specs.append({'id':'quaternion-'+label,'kind':'quaternion','values':values,'expectedWords':[word(v)for v in values]})
# Raw carrier calibration bypasses Python float arithmetic and node evaluation.
carrier=[];before=snapshot();mesh=bpy.data.meshes.new('Owned direct Float32 calibration');mesh.from_pydata([(0,0,0)],[],[])
try:
 for i,bits in enumerate([0x80000000,1,0x007fffff,0x00800000]):
  attribute=mesh.attributes.new('raw'+str(i),'FLOAT','POINT');source=array('f');source.frombytes(struct.pack('=I',bits));attribute.data.foreach_set('value',source);actual=array('f',[0]);attribute.data.foreach_get('value',actual);value=struct.unpack('=I',actual.tobytes())[0];assert value==bits;carrier.append({'requestedWord':bits,'actualWord':value})
finally:bpy.data.meshes.remove(mesh)
assert before==snapshot()
refusals=[]
for label,spec in [('negative-zero',{'id':'bad','kind':'float','word':0x80000000,'expectedWords':[0x80000000]}),('subnormal-min',{'id':'bad','kind':'float','word':1,'expectedWords':[1]}),('subnormal-max',{'id':'bad','kind':'float','word':0x007fffff,'expectedWords':[0x007fffff]}),('context-node',{'id':'bad','kind':'GeometryNodeInputPosition'}),('implicit-field',{'id':'bad','kind':'float','word':0,'expectedWords':[0],'field':'Position'}),('dynamic',{'id':'bad','kind':'float','word':0,'expectedWords':[0],'driver':'frame'})]:
 baseline=snapshot()
 try:capture([spec])
 except OracleUnsupported as error:refusals.append({'kind':label,'message':str(error)})
 else:raise AssertionError('Unqualified oracle input accepted '+label)
 assert baseline==snapshot()
start=time.perf_counter();report=capture(specs);report['status']='CPU_MF_ATTRIBUTE_PROTOTYPE_CALIBRATED'if report['wordOrIntegerMismatches']==0 else'CPU_MF_ATTRIBUTE_PROTOTYPE_RESEARCH_FAILURE';report['rawCarrierCalibration']=carrier;report['refusals']=refusals;report['sourceHashes']={name:hashlib.sha256((Path(__file__).parent/name).read_bytes()).hexdigest()for name in ['oracle.py','probe.py','sources.json']};report['elapsedMilliseconds']=(time.perf_counter()-start)*1000
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(report['rows']),report['wordOrIntegerMismatches'])
