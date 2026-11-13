"""Compare discrete source-shaped arithmetic hypotheses, not fitted outputs.

No runtime implementation or source admission is changed by this diagnostic.
Any successful hypothesis would still need independent primitive and predicate
proofs; a continuous HSV match alone cannot establish Color Key boundaries.
"""
import itertools
import os
import json
from pathlib import Path
import numpy as np

data = json.loads(Path(os.environ['BLENDLINK_COLOR_KEY_HSV_CONTROL']).read_text())
color = np.asarray(data['input'], np.float32).reshape(-1, 4)[:, :3]
expected_values = data.get('expected')
if expected_values is None:
    expected_values = next(row['values'] for row in data['rows'] if row['control'] == 'separate-hsv')
expected = np.asarray(expected_values, np.float32).reshape(-1, 4)[:, :3]
f = np.float32
high, low = np.max(color, axis=1), np.min(color, axis=1)
delta = f(high - low)
safe = np.where(delta == 0, f(1), delta)
inverse = f(f(1) / safe)


def fused(a, b, c):
    # Bounded Float32 RGB arithmetic here has exact binary64 products. This
    # diagnostic does not claim a general-purpose fused multiply/add routine.
    return f(np.float64(a) * np.float64(b) + np.float64(c))


rows=[]
numerators=f(high[:,None]-color);c=f(numerators*inverse[:,None])
models=['fma-first','fma-second','offset-first','offset-negative-fused','offset-positive-fused','offset-double-fused','offset-subtract-first','offset-negative-first']
def diff(i,j,model,offset=0):
 if model=='fma-first':return f(fused(numerators[:,i],inverse,-c[:,j])+f(offset))
 if model=='fma-second':return f(fused(-numerators[:,j],inverse,c[:,i])+f(offset))
 if model=='offset-first':return f(f(f(offset)+c[:,i])-c[:,j])
 if model=='offset-negative-fused':return fused(-numerators[:,j],inverse,f(f(offset)+c[:,i]))
 if model=='offset-positive-fused':return f(fused(numerators[:,i],inverse,f(offset))-c[:,j])
 if model=='offset-double-fused':return fused(-numerators[:,j],inverse,fused(numerators[:,i],inverse,f(offset)))
 if model=='offset-subtract-first':return fused(numerators[:,i],inverse,f(f(offset)-c[:,j]))
 return f(fused(-numerators[:,j],inverse,f(offset))+c[:,i])
for red,green,blue,wrap,saturation in itertools.product(models[:2],models,models,['separate','fused'],['divide','reciprocal']):
 raw=np.where(color[:,0]==high,diff(2,1,red),np.where(color[:,1]==high,diff(0,2,green,2),diff(1,0,blue,4)))
 h=f(raw*f(1/6));h=np.where(h<0,f(h+f(1)) if wrap=='separate' else fused(raw,f(1/6),f(1)),h)
 denominator=np.where(high==0,f(1),high)
 s=np.where(high==0,f(0),f(delta/denominator) if saturation=='divide' else f(delta*f(f(1)/denominator)));h=np.where(s==0,f(0),h)
 result=np.column_stack([h,s,high]).astype(np.float32)
 rows.append({'red':red,'green':green,'blue':blue,'wrap':wrap,'saturation':saturation,'exactWords':int(np.count_nonzero(result.view(np.uint32)==expected.view(np.uint32))),
  'criticalHue':result[[17,22,80],0].tolist(),'maximumError':float(np.max(np.abs(result-expected)))})
rows.sort(key=lambda row:(-row['exactWords'],row['maximumError']))
print(json.dumps({'models':rows[:12]},indent=2))
model=rows[0]
raw=np.where(color[:,0]==high,diff(2,1,model['red']),np.where(color[:,1]==high,diff(0,2,model['green'],2),diff(1,0,model['blue'],4)))
h=f(raw*f(1/6));h=np.where(h<0,f(h+f(1)),h);denominator=np.where(high==0,f(1),high)
s=np.where(high==0,f(0),f(delta*f(f(1)/denominator)));h=np.where(s==0,f(0),h)
r=np.column_stack([h,s,high]).astype(np.float32)
for i,ch in zip(*np.where(r.view(np.uint32)!=expected.view(np.uint32))):print(int(i),int(ch),color[i].tolist(),float(r[i,ch]),float(expected[i,ch]))
