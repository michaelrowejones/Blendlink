"""CPU normal PNG gate controls; no native/render/bake credit."""
from pathlib import Path
import sys
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'packages/blendlink/blender'))
from normal_bake_transport import validate_encoding
native=np.array([[[.5,.5,1],[.5,.5,.5]]],dtype=np.float32);delivery=np.array([[True,True]]);surface=np.array([[True,False]]);decoded=np.round(native*255)/255
result=validate_encoding(native,delivery,surface,decoded);assert result['actualSurfaceTexels']==1 and result['deliveryTexels']==2
for args in [(native,delivery,delivery,decoded),(native,delivery,np.zeros_like(surface),decoded),(native,np.zeros_like(surface),surface,decoded),(native,delivery,surface,decoded+.01),(native,delivery,surface,decoded[:,:,:2])]:
 try:validate_encoding(*args)
 except ValueError:pass
 else:raise AssertionError('Invalid normal encoding proof admitted')
field=np.array([[[.5,.5,.75]]],dtype=np.float32);quant=field+np.array([[[.0039,.0039,0]]],dtype=np.float32)
try:validate_encoding(field,np.array([[True]]),np.array([[True]]),quant)
except ValueError as error:assert 'one degree'in str(error)
else:raise AssertionError('Angular gate was bypassed by a small component error')
print('CYCLES_NORMAL_ENCODING_CONTROLS_PASSED_NO_GPU')
