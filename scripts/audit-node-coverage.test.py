"""Focused discovery routing and full-catalog compatibility without native RNA."""
import importlib.util
import hashlib
import json
from pathlib import Path
import sys
import types
import unittest
import tempfile


spec = importlib.util.spec_from_file_location('node_catalog_test', Path(__file__).with_name('audit-node-coverage.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class Properties(list):
    def keys(self):
        return []


class Node:
    bl_rna = types.SimpleNamespace(properties=Properties())


class Registered(Node):
    pass


def fake_native():
    tree = lambda: types.SimpleNamespace(interface=types.SimpleNamespace(new_socket=lambda **_: None))
    groups = types.SimpleNamespace(new=lambda *_: tree(), remove=lambda _: None)
    materials = types.SimpleNamespace(new=lambda *_: types.SimpleNamespace(node_tree=tree()), remove=lambda _: None)
    return types.SimpleNamespace(types=types.SimpleNamespace(Node=Node, Registered=Registered),
        data=types.SimpleNamespace(node_groups=groups, materials=materials),
        context=types.SimpleNamespace(scene=types.SimpleNamespace(node_tree=tree())),
        app=types.SimpleNamespace(version=(5, 3, 0), version_string='5.3.0', build_hash=b'known-build'))


class FocusedCatalogTests(unittest.TestCase):
    def setUp(self):
        self.previous = sys.modules.get('bpy')
        sys.modules['bpy'] = fake_native()

    def tearDown(self):
        if self.previous is None:
            sys.modules.pop('bpy', None)
        else:
            sys.modules['bpy'] = self.previous

    @staticmethod
    def unavailable(_tree, identifier):
        raise RuntimeError('Actual factory refusal: ' + identifier)

    def test_absent_filter_preserves_full_output_schema_and_bytes(self):
        full = audit.native_catalog(_node_factory=self.unavailable)
        explicit_none = audit.native_catalog(node_ids=None, _node_factory=self.unavailable)
        self.assertEqual(audit.encoded(full), audit.encoded(explicit_none))
        self.assertEqual(set(full), {'schemaVersion', 'blenderVersion', 'blenderVersionTuple',
                                    'blenderBuildHash', 'method', 'domains', 'socketSchemas'})
        self.assertTrue(full['method'].startswith('Every registered bpy.types.Node subclass'))
        for data in full['domains'].values():
            self.assertEqual([(row['id'], row['context']) for row in data['unavailable']],
                             [('Node', 'root'), ('Registered', 'root'), ('Node', 'group'), ('Registered', 'group')])

    def test_selection_attempts_unknown_ids_in_both_domains_and_contexts(self):
        focused = audit.native_catalog(node_ids=['Registered', 'MissingNode', 'Registered'],
                                       _node_factory=self.unavailable)
        self.assertEqual(focused['selection'], {'completeInventory': False, 'nodeIds': ['MissingNode', 'Registered']})
        self.assertEqual(focused['productionCases'], 0)
        self.assertIs(focused['needsOracle'], True)
        for data in focused['domains'].values():
            self.assertEqual(data['nodes'], [])
            self.assertEqual([(row['id'], row['context']) for row in data['unavailable']],
                             [('MissingNode', 'root'), ('Registered', 'root'), ('MissingNode', 'group'), ('Registered', 'group')])
            self.assertTrue(all('Actual factory refusal' in row['reason'] for row in data['unavailable']))

    def test_empty_or_invalid_selection_never_becomes_full_discovery(self):
        for selection in [[], (), 'Node', [''], ['bad/path'], [None], [True]]:
            with self.subTest(selection=selection), self.assertRaises(ValueError):
                audit.native_catalog(node_ids=selection, _node_factory=self.unavailable)


class RetainedCatalogTests(unittest.TestCase):
    def fixture(self, directory, partial=False):
        catalog = {'schemaVersion': 1, 'blenderVersion': '5.3.0', 'blenderVersionTuple': [5, 3, 0],
                   'blenderBuildHash': 'a' * 12, 'domains': {'shader': {'nodes': []}, 'compositor': {'nodes': []}}}
        if partial:
            catalog['selection'] = {'completeInventory': False, 'nodeIds': ['Test']}
        data = json.dumps(catalog).encode()
        (directory / 'blender-5.3.0.json').write_bytes(data)
        previous = {'generatedAt': '2026-11-13T18:00:00+00:00', 'classificationRefresh': {
            'nativeInventoryAuditGeneratedAt': '2026-11-13T14:17:00+00:00',
            'catalogSha256': {'docs/node-coverage/blender-5.3.0.json': hashlib.sha256(data).hexdigest()}}}
        (directory / 'coverage.json').write_text(json.dumps(previous))

    def test_classification_preserves_inventory_date_without_claiming_native_work(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            self.fixture(directory)
            catalogs, provenance = audit.retained_catalogs(directory)
            self.assertEqual(len(catalogs), 1)
            self.assertFalse(provenance['nativeInventoryRefreshed'])
            self.assertEqual(provenance['nativeInventoryAuditGeneratedAt'], '2026-11-13T14:17:00+00:00')

    def test_changed_catalog_or_partial_probe_refuses_without_rewriting_the_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            self.fixture(directory)
            before = (directory / 'coverage.json').read_bytes()
            with (directory / 'blender-5.3.0.json').open('a') as stream:
                stream.write(' ')
            with self.assertRaisesRegex(ValueError, 'digest changed'):
                audit.retained_catalogs(directory)
            self.assertEqual((directory / 'coverage.json').read_bytes(), before)
            self.fixture(directory, partial=True)
            with self.assertRaisesRegex(ValueError, 'partial'):
                audit.retained_catalogs(directory)


if __name__ == '__main__':
    unittest.main()
