# SPDX-License-Identifier: GPL-3.0-or-later
"""CPU-only immutable receipt and control assertions. No Blender/GPU imports."""
import hashlib,json,sys
from pathlib import Path
root=Path(__file__).resolve().parent
receipt=json.loads((root/'receipt.json').read_text());r=receipt['observations']
assert not receipt['productionGuardsChanged'] and receipt['renderAttempts']==receipt['supportCredit']==0
assert receipt['sceneAcceptance'] is False and r['sourceUnchanged']
fixtures={row['id']:row for row in r['fixtures']};owners={row['id']:row for row in r['owners']}
assert fixtures['ngon']['publicApi']=='refused' and not fixtures['ngon']['stockGltf']['tangentAttributePresent']
assert fixtures['tiny-uv']['uvAreaBelow1eMinus8']==1 and fixtures['tiny-uv']['publicApi']=='computed'
assert fixtures['zero-uv-normal-parallel']['nearlyParallelCornerReferences']==3
assert fixtures['zero-uv-normal-parallel']['defaultPositiveXNegativeSignCorners']==3
assert fixtures['zero-uv-normal-parallel']['zeroPositiveSignSentinelCorners']==0
assert fixtures['warped-quad']['stockGltf']['stockAccessorVsNativeMaximumDifference']>1e-5
assert owners['Walls']['ngons']==5 and owners['Walls']['triangles']==2731
assert owners['Walls']['uvAreaBelow1eMinus8']==193 and owners['Walls']['zeroUvArea']==12
assert owners['Plane.021']['triangles']==2198 and owners['Plane.021']['zeroUvArea']==173
assert owners['Plane.021']['publicVsSourceCallbackMaximumDifference']==0
for row in owners.values():
 assert row['sourceCallbackModel']['repeatedOriginalLoopDifferentOutputs']==0
 assert row['allTrianglesModel']['repeatedOriginalLoopDifferentOutputs']==44
 assert row['quadPreservationMaximumDifference']==2
 assert row['nonfiniteTangents']==0 and row['nearlyParallelCornerReferences']>0
assert owners['Walls']['privateProxy']['normalSnorm10ChangedCorners']==97
assert owners['Walls']['privateProxy']['tangentSnorm10ChangedCorners']==845
assert owners['Walls']['privateProxy']['handednessChangedCorners']==1
assert owners['Plane.021']['privateProxy']['normalMaximumDifference']==0
assert owners['Plane.021']['privateProxy']['tangentMaximumDifference']==0
quad=json.loads((root/'folded-quad-control.json').read_text())
assert quad['maximumTupleDifference']==2 and quad['supportCredit']==0
if '--verify-local' in sys.argv:
 sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
 for key in ['report','producer','cppProbe','binary','log']:
  entry=receipt[key];p=Path(entry['path']);assert p.stat().st_size==entry['bytes'] and sha(p)==entry['sha256'],key
 base=Path(receipt['report']['path']).parent
 for row in r['fixtures']+r['owners']:
  assert sha(base/(row['id']+'.json'))==row['datasetSha256']
  for mode,key in [('native-face-model','sourceCallbackModel'),('all-triangles','allTrianglesModel')]:
   assert sha(base/(row['id']+'-'+mode+'.mesh'))==row[key]['inputSha256']
   assert sha(base/(row['id']+'-'+mode+'.tangents'))==row[key]['outputSha256']
  if 'stockGltf' in row:assert sha(base/(row['id']+'-stock.glb'))==row['stockGltf']['glbSha256']
 assert sha(root/'extract.py')==r['producerSha256']
 assert sha(root/'mikk-probe.cc')==receipt['cppProbe']['sha256']
 import subprocess
 for control in quad['models'].values():
  output=subprocess.check_output([receipt['binary']['path']],input=control['input'].encode())
  assert output.decode()==control['output']
print('ARCHVIZ_TANGENT_CPU_CONTROLS_PASSED '+json.dumps({'localPinsVerified':'--verify-local' in sys.argv,'renderAttempts':0,'supportCredit':0}))
