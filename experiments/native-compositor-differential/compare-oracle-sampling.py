# SPDX-License-Identifier: GPL-3.0-or-later
"""Compare full retained compositor cases against image-only TAA1 fixtures."""
import argparse
import hashlib
import json
from pathlib import Path

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline',type=Path,required=True)
parser.add_argument('--candidate',type=Path,required=True)
parser.add_argument('--report',type=Path)
args=parser.parse_args()
baseline=args.baseline.resolve();candidate=args.candidate.resolve()
rows=json.loads((baseline/'index.json').read_text())
assert rows==json.loads((candidate/'index.json').read_text()), 'Case IDs or counts changed'
profiles=json.loads((candidate/'render-profile.json').read_text())
assert [row['case'] for row in rows]==[row['case'] for row in profiles], 'Render profiles differ from the complete native corpus'
records=[]
for row,profile in zip(rows,profiles):
    filename=row['case']+'.json'
    expected=(baseline/filename).read_bytes();actual=(candidate/filename).read_bytes()
    assert expected==actual, 'Native graph/program/input/output JSON bytes differ: '+filename
    metadata=json.loads(expected)
    assert profile['imageOnlyScene'] and profile['sceneEngine'] in {'BLENDER_EEVEE','BLENDER_EEVEE_NEXT'},profile
    assert profile['samplesDuring']==1 and profile['samplesBefore']==profile['samplesRestored'],profile
    assert profile['compositorDevice']==metadata['compositorDevice'],profile
    assert profile['compositorPrecision'] in {None,'FULL'},profile
    records.append({'case':row['case'],'sha256':hashlib.sha256(actual).hexdigest(),**profile})
report={'baseline':str(baseline),'candidate':str(candidate),'byteIdenticalCases':len(records),
    'renderSeconds':sum(row['elapsedSeconds'] for row in records),'records':records}
if args.report:
    args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(report,indent=2))
print('BLENDLINK_COMPOSITOR_SAMPLING_IDENTITY_PASSED '+str(len(records))+' byte-identical full native cases')
