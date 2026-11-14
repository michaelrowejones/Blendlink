# SPDX-License-Identifier: GPL-3.0-or-later
"""Source admission only; actual numerical qualification is separate."""
from pathlib import Path
import json,os,runpy
ROOT=Path(__file__).resolve().parents[2]
field=runpy.run_path(str(ROOT/'packages/blender-addon/tests/compositor_white_noise_fields_check.py'))
fixed=runpy.run_path(str(ROOT/'packages/blender-addon/tests/compositor_white_noise_check.py'))['packet']
fixed.update(status='WHITE_NOISE_SOURCE_POLICY_PASSED',gpuInitializationCalls=0)
packet={'status':'WHITE_NOISE_DEFAULT_FIELD_SOURCE_POLICY_PASSED','field':{'positive':field['positive'],'refusals':field['refusals'],'renders':0,'gpuInitializationCalls':0,'portCredit':0},'fixed':fixed,'renders':0,'gpuInitializationCalls':0,'portCredit':0}
Path(os.environ['SCENETOWEB_WHITE_NOISE_DEFAULT_FIELD_POLICY']).write_text(json.dumps(packet,indent=2)+'\n')
