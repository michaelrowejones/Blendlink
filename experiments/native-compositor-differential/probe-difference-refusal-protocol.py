"""Protocol routing test with injected unmeasured context, NOT Linux fidelity evidence."""
import ast,copy,hashlib,json,os,sys,math,itertools
from pathlib import Path
from unittest.mock import patch
import bpy,numpy as np
root=Path(__file__).resolve().parents[2];sys.path.insert(0,str(root/'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference
import compositor_graph,compositor_difference_key as model
# Keep native rendering on the actual Metal device; inject only source routing
# metadata to exercise the unknown-profile declaration over real RNA graphs.
class Proxy:
 def __init__(self,target,**overrides):self.target=target;self.overrides=overrides
 def __getattr__(self,key):return self.overrides.get(key,getattr(self.target,key))
system=Proxy(bpy.context.preferences.system,gpu_backend='OPENGL')
preferences=Proxy(bpy.context.preferences,system=system)
context=Proxy(bpy.context,preferences=preferences)
proxy=Proxy(bpy,context=context)
profile=model.native_gpu_profile()
profile.update(requestedBackend='OPENGL',version='unmeasured-test-driver')
fixture=root/'packages/blender-addon/tests/compositor_difference_key_check.py'
definitions=[node for node in ast.parse(fixture.read_text()).body if isinstance(node,ast.FunctionDef)]
namespace={'bpy':proxy,'np':np,'math':math,'itertools':itertools,'hashlib':hashlib,'json':json,'os':os,'Path':Path,'NativeCompositorReference':NativeCompositorReference,
 'compositor_graph':compositor_graph,'native_gpu_profile':lambda:copy.deepcopy(profile),
 'is_measured_rne_profile':model.is_measured_rne_profile,'UNVERIFIED_GPU_MESSAGE':model.UNVERIFIED_GPU_MESSAGE}
exec(compile(ast.fix_missing_locations(ast.Module(body=definitions,type_ignores=[])),str(fixture),'exec'),namespace)
os.environ['BLENDLINK_COMPOSITOR_DIFFERENCE_KEY_DEVICE']='GPU'
output=Path(os.environ.get('BLENDLINK_DIFFERENCE_PROTOCOL_EVIDENCE',str(root/'artifacts/refusal-protocol-routing-test'))).resolve();output.mkdir(exist_ok=True)
with patch.object(compositor_graph,'bpy',proxy),patch.object(model,'native_gpu_profile',return_value=profile):namespace['main'](output)
qualification=json.loads((output/'qualification.json').read_text())
assert qualification['cases']==0 and qualification['controlCases']==1
assert qualification['status']=='source-profile-refused' and len(qualification['profileRefusals'])==2
assert {r['output'] for r in qualification['profileRefusals']}=={'Image','Matte'}
for record in qualification['profileRefusals']:
 assert Path(record['file']).name==record['file']
 raw=(output/record['file']).read_bytes();assert hashlib.sha256(raw).hexdigest()==record['sha256']
 payload=json.loads(raw);assert payload['compositorDevice']=='GPU' and payload['sourcePreserved']
 assert payload['program']['status']=='unsupported' and payload['diagnostics'][0]['message']==model.UNVERIFIED_GPU_MESSAGE
 assert len(payload['input'])==len(payload['expected'])==payload['width']*payload['height']*4
(output/'TEST_ONLY_CONTEXT_INJECTION.txt').write_text('Source-routing simulation over real RNA/native Metal pixels. Not native Linux profile or numerical-fidelity proof.')
print('REFUSAL_PROTOCOL_ROUTING_TEST_PASSED 0 numeric Difference cases,1 separate control,2 hashed native refusal files')
