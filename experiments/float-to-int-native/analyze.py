# SPDX-License-Identifier: GPL-3.0-or-later
"""Verify pinned native captures without turning undefined controls into passes."""
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

from values import controls, from_word, word

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'artifacts/float-to-int')
FILES = {}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    FILES[str(path)] = digest(path)
    return json.loads(path.read_text())


def expected_integer(value, mode):
    if mode == 'ROUND':
        integer = math.floor(abs(value))
        if abs(value) - integer >= .5:
            integer += 1
        return -integer if value < 0 else integer
    return {'FLOOR': math.floor, 'CEILING': math.ceil, 'TRUNCATE': math.trunc}[mode](value)


def candidate(item):
    bits = int(item['word'], 16)
    value = from_word(bits)
    normal_or_zero = (bits & 0x7fffffff) == 0 or (bits & 0x7f800000) != 0
    return math.isfinite(value) and normal_or_zero and abs(value) <= 2**24


primary_sources = read(ROOT / 'experiments/float-to-int-native/sources.json')
for entry in primary_sources['primarySources']:
    cached = DIRECTORY / 'sources' / (entry['revision'] + '-' + Path(entry['path']).name)
    if cached.exists():
        assert digest(cached) == entry['sha256']

items = controls()
summary = {'status': 'VERIFIED_NATIVE_RESEARCH_ONLY', 'productionCoverage': False,
           'controls': len(items), 'candidatePointsPerMode': sum(map(candidate, items)),
           'provenance': FILES, 'availability': {}, 'models': {}, 'definedModelCounterexamples': []}
for version in ['42', '52', '53']:
    schema = read(DIRECTORY / ('schema' + version + '.json'))
    assert schema['fixtureSha256'] == digest(ROOT / 'experiments/float-to-int-native/schema_probe.py')
    assert schema['contexts']['shader']['available'] is False
    assert schema['contexts']['geometry']['available'] is True
    assert schema['contexts']['compositor']['available'] is (version == '53')
    summary['availability'][version] = schema['contexts']['compositor']['available']
    geometry = read(DIRECTORY / ('geometry' + version + '.json'))
    assert geometry['fixtureSha256'] == digest(ROOT / 'experiments/float-to-int-native/geometry_probe.py')
    assert geometry['valuesSha256'] == digest(ROOT / 'experiments/float-to-int-native/values.py')
    assert geometry['sourcePreserved'] and len(geometry['controls']) == len(items)
    for row in geometry['rows']:
        for index, item in enumerate(items):
            if candidate(item):
                assert row['integerResults'][index] == expected_integer(item['value'], row['mode'])
    if version != '53':
        for device in ['cpu', 'gpu']:
            packet = read(DIRECTORY / ('compositor' + version + '-' + device) / 'unavailable.json')
            assert packet['status'] == 'NATIVE_NODE_UNAVAILABLE' and packet['numericalCases'] == 0
            assert packet['fixtureSha256'] == digest(ROOT / 'experiments/float-to-int-native/compositor_probe.py')

captures = {}
for device in ['cpu', 'gpu']:
    directory = DIRECTORY / ('compositor53-' + device)
    capture = captures[device] = read(directory / 'report.json')
    assert capture['status'] == 'CAPTURED_RESEARCH_ONLY' and capture['device'].lower() == device
    assert capture['fixtureSha256'] == digest(ROOT / 'experiments/float-to-int-native/compositor_probe.py')
    assert capture['valuesSha256'] == digest(ROOT / 'experiments/float-to-int-native/values.py')
    assert capture['oracleHelperSha256'] == digest(ROOT / 'packages/blender-addon/tests/compositor_reference.py')
    assert capture['gpu']['backend'] == 'METAL' and capture['sourcePreserved']
    assert len(capture['rows']) == 241 and len(capture['controls']) == len(items)
    source = directory / 'source-input.rgba32f'
    assert digest(source) == capture['sourceInputSha256']
    identity = next(row for row in capture['rows'] if row['kind'] == 'identity-image')
    assert source.read_bytes() == (directory / identity['pixelFile']).read_bytes()
    for row in capture['rows']:
        if row['kind'] == 'constant-rna-refusal':
            raise AssertionError('Unexpected RNA refusal; review it explicitly before analyzing')
        for file_key, hash_key in [('pixelFile', 'pixelSha256'), ('exrFile', 'exrSha256')]:
            assert digest(directory / row[file_key]) == row[hash_key]
        assert row['alphaWords'] == ['3f800000'] and row['sourcePreserved']
        if row['kind'] in {'constant', 'linked-constant'}:
            assert len(set(row['redWords'])) == 1
            item = next(item for item in items if item['word'] == row['inputWord'])
            if candidate(item):
                assert row['redWords'][0] == f'{word(expected_integer(item["value"], row["mode"])):08x}'
        if row['kind'] != 'image-field':
            continue
        for index, item in enumerate(items):
            if candidate(item):
                assert row['redWords'][index] == f'{word(expected_integer(item["value"], row["mode"])):08x}'
            if item['domain'] == 'finite-int32-conversion':
                expected = expected_integer(item['value'], row['mode'])
                actual = from_word(int(row['redWords'][index], 16))
                if actual != expected:
                    summary['definedModelCounterexamples'].append({
                        'device': device, 'mode': row['mode'], 'inputWord': item['word'],
                        'exactRealRounding': expected, 'nativeResult': actual})
    summary['models'][device] = {'nativeGraphs': len(capture['rows']), 'gpu': capture['gpu'],
                                 'candidateComparisons': sum(map(candidate, items)) * 4,
                                 'undefinedControlsPerMode': sum(item['domain'] == 'undefined-int32-conversion' for item in items)}

for cpu, gpu in zip(captures['cpu']['rows'], captures['gpu']['rows']):
    assert cpu['case'] == gpu['case'] and cpu['redWords'] == gpu['redWords']
    assert (DIRECTORY / 'compositor53-cpu' / cpu['pixelFile']).read_bytes() == (DIRECTORY / 'compositor53-gpu' / gpu['pixelFile']).read_bytes()
summary['cpuGpuCapturedWordMismatches'] = 0
summary['candidateDomain'] = 'Proposal only: Blender 5.3 compositor; finite exact Float32 normal-or-zero inputs with abs(value)<=2**24, all four rounding modes. Requires enforceable live input proof and actual browser trial before any production admission.'
(DIRECTORY / 'analysis.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({key: value for key, value in summary.items() if key not in {'provenance', 'models'}}, indent=2))
