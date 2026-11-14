# SPDX-License-Identifier: GPL-3.0-or-later
"""Source policy only, before numerical captures or saved Final publication."""
from pathlib import Path
import json,os,runpy
ROOT=Path(__file__).resolve().parents[2]
result=runpy.run_path(str(ROOT/'packages/blender-addon/tests/compositor_wave_axis_check.py'))
record={'status':'WAVE_AXIS_SOURCE_POLICY_PASSED','positive':result['positive'],'refusals':result['refusals'],'nativeRenders':0,'gpuInitializations':0,'supportCredit':0,'injectedReaderWordControls':3}
Path(os.environ['SCENETOWEB_WAVE_AXIS_POLICY']).write_text(json.dumps(record,indent=2)+'\n')
