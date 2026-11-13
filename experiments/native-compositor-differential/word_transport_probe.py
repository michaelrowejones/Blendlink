# SPDX-License-Identifier: GPL-3.0-or-later
"""Blender-process word roundtrip; zero numerical node coverage."""
import json
from pathlib import Path
import sys
import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from word_transport import float32_words

words = [0, 0x80000000, 1, 0x80000001, 0x007fffff, 0x807fffff, 0x00800000, 0x3f800000]
array = np.asarray(words, dtype=np.uint32).view(np.float32)
packet = json.loads(json.dumps(float32_words(array)))
assert packet['words'] == words
report = {'kind': 'scenetoweb-oracle-word-transport-v1', 'blenderVersion': list(bpy.app.version),
          'blenderBuildHash': bpy.app.build_hash.decode(), 'numericalNodeCases': 0,
          'inputWords': words, 'roundtripWords': packet['words'],
          'legacyFloatListWords': np.asarray(array.tolist(), dtype=np.float32).view(np.uint32).tolist(),
          'packet': packet}
output = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, indent=2) + '\n')
print('SCENETOWEB_ORACLE_WORD_TRANSPORT_PASSED ' + str(output))
