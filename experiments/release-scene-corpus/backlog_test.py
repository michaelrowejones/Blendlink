import copy
import unittest
import zipfile
from pathlib import Path

from backlog import validate_inventory, build_backlog
from fetch import safe_member
from graph import summarize


def fixture():
    graph = {'trees': {'m': {'context': 'shader',
        'nodes': {'n': {'id': 'ShaderNodeValue', 'modes': {}},
                  'out': {'id': 'ShaderNodeOutputMaterial', 'modes': {}}},
        'links': [{'fromNode': 'n', 'fromSocket': 'Value', 'toNode': 'out', 'toSocket': 'Surface'}]}},
        'roots': [{'tree': 'm', 'node': 'out'}]}
    inv = {'kind': 'release-scene-source-node-inventory-v1', 'schemaVersion': 1,
        'source': {'sha256': 'a' * 64, 'bytes': 10}, 'sourceUnchanged': True,
        'renderCalls': 0, 'saveCalls': 0, 'bakeCalls': 0,
        'blender': {'version': '5.3.0', 'buildHash': '02f0899d78e3'},
        'discoveryProgramSha256': {'inventory.py': 'b' * 64},
        'graph': graph, 'nodeUsage': summarize(graph), 'scene': {'name': 'Example'},
        'sceneDependencies': ['Example'], 'particleSystems': [], 'sourceClosure': {}}
    scene = {'id': 'example', 'source': inv['source'], 'inventoryBlender': inv['blender']}
    return inv, scene


class Contracts(unittest.TestCase):
    def test_closer_recomputes_usage_and_retains_zero_credit(self):
        inv, scene = fixture()
        validate_inventory(inv, scene, inv['discoveryProgramSha256'])
        result = build_backlog({'scenes': [scene], 'sourceCommit': 'c' * 40},
            {'example': inv}, {'shader:ShaderNodeValue': 'supported'})
        self.assertEqual(result['acceptedOriginalScenes'], 0)
        self.assertEqual(result['supportPromotions'], 0)
        self.assertTrue(all(n['releaseQualification'] == 'pending' and not n['newSupportCredit'] for n in result['nodes']))

    def test_inventory_drift_or_native_work_cannot_close(self):
        inv, scene = fixture()
        for key, value in [('sourceUnchanged', False), ('renderCalls', 1),
                           ('saveCalls', 1), ('bakeCalls', 1)]:
            bad = copy.deepcopy(inv)
            bad[key] = value
            with self.assertRaises(AssertionError):
                validate_inventory(bad, scene, inv['discoveryProgramSha256'])
        bad = copy.deepcopy(inv)
        bad['nodeUsage']['shader:ShaderNodeValue']['reachableNodes'] = 0
        with self.assertRaises(AssertionError):
            validate_inventory(bad, scene, inv['discoveryProgramSha256'])

    def test_source_build_and_discovery_pins_are_required(self):
        inv, scene = fixture()
        for key in ['source', 'blender', 'discoveryProgramSha256']:
            bad = copy.deepcopy(inv)
            bad[key] = {}
            with self.assertRaises((AssertionError, KeyError)):
                validate_inventory(bad, scene, inv['discoveryProgramSha256'])

    def test_archive_traversal_and_symlink_refuse_before_extraction(self):
        for filename in ['../escape.blend', '/escape.blend', '..\\escape.blend', 'C:/escape.blend']:
            with self.assertRaises(ValueError):
                safe_member(Path('/tmp/test-corpus-root'), zipfile.ZipInfo(filename))
        symbolic = zipfile.ZipInfo('link.blend')
        symbolic.external_attr = 0o120777 << 16
        with self.assertRaises(ValueError):
            safe_member(Path('/tmp/test-corpus-root'), symbolic)


if __name__ == '__main__':
    unittest.main()
