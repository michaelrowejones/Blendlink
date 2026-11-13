# SPDX-License-Identifier: GPL-3.0-or-later
"""Compare independent native paths. Reports counterexamples, never fits math."""
import hashlib
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'artifacts/radial'


def floats(path):
    payload = path.read_bytes()
    return struct.unpack('<' + 'f' * (len(payload) // 4), payload)


def load(name):
    directory = OUTPUT / name
    result = json.loads((directory / 'index.json').read_text())
    fixture = 'native_mf.py' if name.startswith('mf') else 'native_eevee.py'
    assert result['fixtureSha256'] == hashlib.sha256((Path(__file__).parent / fixture).read_bytes()).hexdigest()
    for case in result['cases'] + result.get('calibrations', []) + result.get('primitiveControls', []):
        for file_key, hash_key in [('decoded', 'sha256'), ('packed', 'packedSha256'), ('coarse', 'coarseSha256'), ('finiteBandMask', 'finiteBandMaskSha256'), ('file', 'sha256')]:
            if file_key in case:
                assert hashlib.sha256((directory / case[file_key]).read_bytes()).hexdigest() == case[hash_key]
    return directory, result


def primitive_comparison(name):
    directory, data = load(name)
    by_id = {row['id']: row for row in data['cases'] + data['primitiveControls']}
    a = by_id['primitive-separately-authored-five-sided-id']
    b = by_id['field-s5-r0-n0-segment-id']
    av = floats(directory / a['decoded'])
    bv = floats(directory / b['decoded'])
    am = (directory / a['finiteBandMask']).read_bytes()
    bm = (directory / b['finiteBandMask']).read_bytes()
    pairs = [(x, y) for i, (x, y) in enumerate(zip(av, bv)) if am[i] and bm[i]]
    return {'dataset': name, 'comparedFiniteBandSamples': len(pairs), 'differentSamples': sum(x != y for x, y in pairs), 'maximum': max(abs(x - y) for x, y in pairs), 'excludedRadialSamples': b['unqualifiedSamples'], 'note': 'Native Shader Math composition vs native Radial ID, not a browser port.'}


def native_comparison(a_name, b_name):
    a_dir, a = load(a_name)
    b_dir, b = load(b_name)
    other = {row['id']: row for row in b['cases']}
    rows = []
    for case in a['cases']:
        if case['id'] not in other:
            continue
        target = other[case['id']]
        av = floats(a_dir / case.get('decoded', case.get('file')))
        bv = floats(b_dir / target.get('decoded', target.get('file')))
        a_mask = (a_dir / case['finiteBandMask']).read_bytes() if 'finiteBandMask' in case else bytes([1] * len(av))
        b_mask = (b_dir / target['finiteBandMask']).read_bytes() if 'finiteBandMask' in target else bytes([1] * len(bv))
        values = [(abs(x - y), i, x, y) for i, (x, y) in enumerate(zip(av, bv)) if a_mask[i] and b_mask[i] and math.isfinite(x) and math.isfinite(y)]
        maximum = max(values) if values else None
        rows.append({'id': case['id'], 'maximum': maximum, 'finiteComparableValues': len(values), 'bitIdentical': (a_dir / case.get('decoded', case.get('file'))).read_bytes() == (b_dir / target.get('decoded', target.get('file'))).read_bytes()})
    return {'a': a_name, 'b': b_name, 'cases': rows, 'maximum': max((row['maximum'][0] for row in rows if row['maximum']), default=None), 'bitIdenticalCases': sum(row['bitIdentical'] for row in rows)}


def shader_to_mf(name, mf_name):
    directory, shader = load(name)
    mf_dir, mf = load(mf_name)
    by_id = {case['id']: case for case in mf['cases']}
    coordinates = floats(mf_dir / mf['coordinates']['file'])
    coordinates = [coordinates[i:i + 3] for i in range(0, len(coordinates), 3)]
    rows = []
    for case in shader['cases']:
        mf_case = by_id.get(case['case']['id'])
        if mf_case is None:
            continue
        channel = case['channel'] if case['channel'] is not None else {'Segment ID': 3, 'Segment Width': 4, 'Segment Rotation': 5}[case['output']]
        native = floats(mf_dir / mf_case['file'])
        actual = floats(directory / case['decoded'])
        mask = (directory / case['finiteBandMask']).read_bytes()
        counterexamples = []
        for index, value in enumerate(actual):
            point_index = index % len(coordinates)
            expected = native[point_index * 6 + channel]
            if mask[index] and math.isfinite(expected) and abs(value - expected) > 2e-5:
                counterexamples.append({'index': index, 'coordinate': coordinates[point_index], 'sourceStageA': value, 'nativeMf': expected, 'absoluteDifference': abs(value - expected)})
        rows.append({'id': case['id'], 'unqualifiedPackedSamples': case['unqualifiedSamples'], 'differentNativePathSamplesBeyond2e5': len(counterexamples), 'firstCounterexamples': counterexamples[:4]})
    return {'shader': name, 'mf': mf_name, 'thisIsNotABrowserPortComparison': True, 'cases': rows}


summary = {'proofRole': 'RESEARCH_NATIVE_VIABILITY_AND_COUNTEREXAMPLES_NO_PORT', 'schemas': {}, 'nativeComparisons': [], 'shaderToMf': [], 'carrierCalibrations': {}, 'independentNativePrimitives': []}
for version in ['42', '52', '53']:
    path = OUTPUT / ('schema' + version) / 'schema.json'
    data = json.loads(path.read_text())
    summary['schemas'][version] = {'version': data['version'], 'buildHash': data['buildHash'], 'availability': {case['context']: case['available'] for case in data['records']}, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
for a, b in [('mf52', 'mf53'), ('eevee52-calibrated', 'eevee53-calibrated'), ('cycles52', 'cycles53')]:
    summary['nativeComparisons'].append(native_comparison(a, b))
for version in ['52', '53']:
    for evaluator in ['eevee' + version + '-calibrated', 'cycles' + version]:
        summary['shaderToMf'].append(shader_to_mf(evaluator, 'mf' + version))
        summary['independentNativePrimitives'].append(primitive_comparison(evaluator))
        _, data = load(evaluator)
        summary['carrierCalibrations'][evaluator] = data['calibrations']
    _, mf = load('mf' + version)
    summary['nativeMfNonfinite' + version] = [{'id': row['id'], 'nonfinite': row['nonfinite']} for row in mf['cases'] if row['nonfinite']]
(OUTPUT / 'analysis.json').write_text(json.dumps(summary, indent=2, allow_nan=False) + '\n')
print(json.dumps({'nativeComparisons': [{k: row[k] for k in ['a', 'b', 'maximum', 'bitIdenticalCases']} for row in summary['nativeComparisons']], 'nativeMfNonfinite52': summary['nativeMfNonfinite52'], 'nativeMfNonfinite53': summary['nativeMfNonfinite53']}, indent=2))
