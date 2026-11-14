# SPDX-License-Identifier: GPL-3.0-or-later
# Research only. No renders/GPU calls; init_socket is used only to seed owned test nodes.
import bpy,json,struct
from array import array
from pathlib import Path
root=Path(__file__).resolve().parents[2]/'artifacts/verification-box-mask-from-socket';root.mkdir(parents=True,exist_ok=True);before=set(bpy.data.node_groups.keys());trees=[]
report={'schemaVersion':1,'status':'research-only','numericalCredit':0,'rows':[]}
def words(node):
 a=array('f',[0]*len(node.inputs));node.inputs.foreach_get('default_value',a);return list(struct.unpack('='+str(len(a))+'I',a.tobytes()))
try:
 owner=bpy.data.node_groups.new('Private Actual Box Owner','CompositorNodeTree');trees.append(owner);box=owner.nodes.new('CompositorNodeBoxMask')
 target=bpy.data.node_groups.new('Private Actual Box Copy','CompositorNodeTree');trees.append(target)
 interfaces=[target.interface.new_socket(name=name,in_out='INPUT',socket_type='NodeSocketFloat')for name in ('Mask','Value','Rotation')]
 report['initSocketAvailable']=[hasattr(s,'init_socket')for s in interfaces];report['initSocketDoc']=getattr(interfaces[0].init_socket,'__doc__',None)if hasattr(interfaces[0],'init_socket')else None
 print('INIT',report['initSocketAvailable'],report['initSocketDoc'])
 for name,value in [('Mask',.25),('Value',.75),('Rotation',-.5)]:box.inputs[name].default_value=value
 for interface,name in zip(interfaces,('Mask','Value','Rotation')):interface.from_socket(box,box.inputs[name])
 instance=owner.nodes.new('CompositorNodeGroup');instance.node_tree=target
 observed=words(instance);report['actualBoxOrdinaryWords']=observed;print('BOXWORDS',observed)
 report['actualBoxSocketClasses']=[box.inputs[name].bl_idname for name in ('Mask','Value','Rotation')]
 if all(report['initSocketAvailable']):
  # Seed interface defaults via a homogeneous group instance, then copy back
  # entirely in native RNA before reading actual Box scalars through from_socket.
  for trial in ([0,0x80000000,1],[0x007fffff,0x80000001,0x807fffff],[0x3e800000,0x3f000000,0xbf800000]):
   raw=array('f');raw.frombytes(struct.pack('=3I',*trial));instance.inputs.foreach_set('default_value',raw)
   for interface,source,name in zip(interfaces,instance.inputs,('Mask','Value','Rotation')):
    interface.from_socket(instance,source)
    interface.init_socket(box,box.inputs[name],'')
   for interface,name in zip(interfaces,('Mask','Value','Rotation')):interface.from_socket(box,box.inputs[name])
   copy=owner.nodes.new('CompositorNodeGroup');copy.node_tree=target;actual=words(copy);owner.nodes.remove(copy)
   row={'expectedWords':list(trial),'actualBoxCopiedWords':actual,'exact':actual==list(trial)};report['rows'].append(row);print('ROW',json.dumps(row))
except Exception as e:report['error']=repr(e);print('ERROR',repr(e))
finally:
 for t in reversed(trees):bpy.data.node_groups.remove(t,do_unlink=True)
 report['ownershipRestored']=set(bpy.data.node_groups.keys())==before
 (root/'actual-box-report.json').write_text(json.dumps(report,indent=2)+'\n');print('RESULT',json.dumps(report))
