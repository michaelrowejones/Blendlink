# SPDX-License-Identifier: GPL-3.0-or-later
"""Apply the source-only guard to byte-identical retained native IR documents."""
import hashlib
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'packages/blender-addon'))
from noise_static_inputs import require_shader_constant_inputs

def refuse(message): raise AssertionError(message)
def expressions(value):
    if isinstance(value, dict):
        if value.get('op') in {'noise_fractal','noise_normalized'}: yield value
        for child in value.values(): yield from expressions(child)
    elif isinstance(value,list):
        for child in value: yield from expressions(child)

rows=[]
for argument in sys.argv[1:]:
    directory=Path(argument)
    manifest=json.loads((directory/'index.json').read_text())
    for cell in manifest['cases']:
        path=directory/'ir'/(cell['id']+'.json');data=path.read_bytes()
        count=0
        for node in expressions(json.loads(data)):
            require_shader_constant_inputs(node,refuse);count+=1
        rows.append({'id':cell['id'],'expressions':count,'sha256':hashlib.sha256(data).hexdigest()})
print('BLENDLINK_NOISE_ISLAND_ADMISSION_REGRESSION_PASSED '+json.dumps({'documents':len(rows),'expressions':sum(row['expressions'] for row in rows),'rows':rows}))
