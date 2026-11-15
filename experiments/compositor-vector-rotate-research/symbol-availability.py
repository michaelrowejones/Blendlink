# SPDX-License-Identifier: GPL-3.0-or-later
"""Symbol lookup only. No native function calls, addresses, ABI guesses or GPU."""
from pathlib import Path
import ctypes,json,sys
import bpy,gpu
calls=[0]
def deny(*args,**kwargs):calls[0]+=1;raise RuntimeError('Symbol-only Vector Rotate research denies GPU initialization')
gpu.init=deny
library=ctypes.CDLL(None)
def available(name):
    try:getattr(library,name)
    except AttributeError:return False
    return True
report={'status':'RESEARCH_ONLY_NATIVE_SYMBOL_AVAILABILITY','supportCredit':0,'nativeFunctionCalls':0,
    'nativeRenders':0,'gpuInitializations':calls[0],'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),
    'lookup':'ctypes.CDLL(None), symbol availability only','control':{'printf':available('printf')},
    'symbols':{name:available(name)for name in ['eul_to_mat3','axis_angle_to_mat3','invert_m3_m3']}}
Path(sys.argv[sys.argv.index('--')+1]).write_text(json.dumps(report,indent=2)+'\n')
print(report['status'],report['symbols'])
