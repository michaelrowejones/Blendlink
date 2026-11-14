# SPDX-License-Identifier: GPL-3.0-or-later
# Research only. No renders/GPU calls; init_socket is used only to seed owned test nodes.
import bpy,sys,json,struct
from array import array
from pathlib import Path
root=Path(__file__).resolve().parents[2]/'artifacts/verification-box-mask-from-socket';root.mkdir(parents=True,exist_ok=True)
before=set(bpy.data.node_groups.keys());trees=[]
report={'schemaVersion':1,'status':'research-only','numericalCredit':0,'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'promotionDoubleWord':struct.pack('<d',struct.unpack('<f',b'\1\0\0\0')[0]).hex(),'rows':[]}
def buf(words):
 a=array('f');a.frombytes(struct.pack('='+str(len(words))+'I',*words));return a
def get(node):
 a=array('f',[0]*len(node.inputs));node.inputs.foreach_get('default_value',a);return list(struct.unpack('='+str(len(a))+'I',a.tobytes()))
try:
 source=bpy.data.node_groups.new('Private Scalar Source','CompositorNodeTree');trees.append(source)
 for name in ('Mask','Value','Rotation'):source.interface.new_socket(name=name,in_out='INPUT',socket_type='NodeSocketFloat')
 owner=bpy.data.node_groups.new('Private Scalar Owner','CompositorNodeTree');trees.append(owner)
 donor=owner.nodes.new('CompositorNodeGroup');donor.node_tree=source
 target=bpy.data.node_groups.new('Private Scalar Copy','CompositorNodeTree');trees.append(target)
 sockets=[target.interface.new_socket(name=name,in_out='INPUT',socket_type='NodeSocketFloat')for name in ('Mask','Value','Rotation')]
 report['fromSocketAvailable']=[hasattr(s,'from_socket')for s in sockets]
 print('FROM_SOCKET',report['fromSocketAvailable'])
 if not all(report['fromSocketAvailable']):raise RuntimeError('Public from_socket API unavailable')
 for words in ([0,0x80000000,1],[0x007fffff,0x80000001,0x807fffff],[0x3e800000,0x3f000000,0xbf800000]):
  donor.inputs.foreach_set('default_value',buf(words));realized=get(donor)
  for interface,original in zip(sockets,donor.inputs):interface.from_socket(donor,original)
  copied=owner.nodes.new('CompositorNodeGroup');copied.node_tree=target
  result=get(copied)
  row={'inputWords':list(words),'donorStoredWords':realized,'copiedStoredWords':result,'exact':realized==list(words)and result==list(words)};report['rows'].append(row);print('ROW',json.dumps(row));owner.nodes.remove(copied)
 report['allExact']=all(r['exact']for r in report['rows'])
except Exception as error:
 report['error']=repr(error);print('ERROR',repr(error))
finally:
 for t in reversed(trees):bpy.data.node_groups.remove(t,do_unlink=True)
 report['ownershipRestored']=set(bpy.data.node_groups.keys())==before
 (root/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 print('RESULT',json.dumps(report))
