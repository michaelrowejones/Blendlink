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
    def test_native_menu_rules_reject_value_to_status_maps_and_string_lists(self):
        self.assertEqual(audit.mode_status({'partial': ['Uppercase', 'Lowercase']}, 'Uppercase'), 'partial')
        for rule in [{'Uppercase': 'partial'}, {'partial': 'Uppercase'}, {'partial': [1]}]:
            with self.subTest(rule=rule), self.assertRaisesRegex(ValueError, 'native enum rule'):
                audit.mode_status(rule, 'Uppercase')

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


class CompileTimeRouteTests(unittest.TestCase):
    def test_recorded_compositor_string_route_proves_real_call_full_record_and_final_refusal(self):
        previous = audit.ROOT
        route = {'path': 'packages/blender-addon/static_strings.py', 'function': 'evaluate_output', 'nodeSet': 'NODES'}
        graph_path = 'packages/blendlink/blender/compositor_graph.py'
        graph = (previous / graph_path).read_text()
        compiler = (previous / route['path']).read_text()
        with tempfile.TemporaryDirectory() as temporary:
            audit.ROOT = directory = Path(temporary)
            try:
                for path in [graph_path, route['path']]:
                    (directory / path).parent.mkdir(parents=True, exist_ok=True)
                (directory / graph_path).write_text(graph)
                (directory / route['path']).write_text(compiler)
                self.assertTrue(audit.verify_recorded_static_string_forwarding(route))
                mutations = [
                    ('record = static_strings.evaluate_input(socket, stack)', "record = {'value': 0}"),
                    ("('string',socket,stack,record,", "('string',socket,stack,record['value'],"),
                    ('        return record\n', "        return record['value']\n"),
                    ('    static_policy_reads = []', '    unused_policy_reads = []'),
                    ('current = static_strings.evaluate_input(socket, stack)', "current = {'value': 0}"),
                    ('if current != expected:', "if current['value'] != expected['value']:"),
                    ("fail('static-policy-source-changed',", "fail('unreviewed-policy',"),
                ]
                for before, after in mutations:
                    self.assertIn(before, graph)
                    (directory / graph_path).write_text(graph.replace(before, after, 1))
                    with self.subTest(mutation=before), self.assertRaises(ValueError):
                        audit.verify_recorded_static_string_forwarding(route)
                (directory / graph_path).write_text(graph)
                self.assertIn('return evaluate_output(socket, stack)', compiler)
                (directory / route['path']).write_text(compiler.replace('return evaluate_output(socket, stack)', 'return {}', 1))
                with self.assertRaisesRegex(ValueError, 'wrapper must forward'):
                    audit.verify_recorded_static_string_forwarding(route)
            finally:
                audit.ROOT = previous

    def test_forwarding_route_requires_real_function_node_set_and_call_site(self):
        with tempfile.TemporaryDirectory() as temporary:
            previous = audit.ROOT
            audit.ROOT = directory = Path(temporary)
            try:
                (directory / 'compiler.py').write_text("NODES={'GeometryNodeSwitch'}\ndef select():\n    pass\n")
                (directory / 'caller.py').write_text('selected = select(node)\n')
                (directory / 'runtime.ts').write_text("case 'constant': return value\n")
                entry = {'category': 'unsupported', 'versionOverrides': {'5.3.0': {'category': 'partial'}},
                    'runtimeOps': [], 'runtimePath': 'runtime.ts',
                    'evidence': [{'path': 'compiler.py'}, {'path': 'caller.py'}],
                    'compileTime': {'path': 'compiler.py', 'function': 'select', 'nodeSet': 'NODES',
                        'callers': [{'path': 'caller.py', 'anchor': 'selected = select('}]}}
                validate = lambda value: audit.verify_map({'entries': {'shader:GeometryNodeSwitch': value}})
                self.assertEqual(validate(entry), [])
                for mutate in [lambda value: value['compileTime'].update(function='missing'),
                               lambda value: value['compileTime']['callers'][0].update(anchor='missing('),
                               lambda value: value.update(runtimeOps=['constant'])]:
                    altered = json.loads(json.dumps(entry))
                    mutate(altered)
                    self.assertTrue(any('invalid compile-time' in failure for failure in validate(altered)))
                (directory / 'compiler.py').write_text("NODES={'OtherNode'}\ndef select():\n    pass\n")
                self.assertTrue(any('outside the compiler node set' in failure for failure in validate(entry)))
            finally:
                audit.ROOT = previous

    def test_partial_version_override_cannot_bypass_live_evidence_checks(self):
        entry = {'category': 'unsupported', 'versionOverrides': {'5.3.0': {'category': 'partial'}}, 'runtimeOps': []}
        self.assertTrue(any('live classification needs' in failure for failure in audit.verify_map({'entries': {'shader:Test': entry}})))


class ScenePresentationRouteTests(unittest.TestCase):
    def entry(self):
        return {'category': 'unsupported', 'versionOverrides': {'5.3.0': {'category': 'partial'}},
            'runtimeOps': [], 'runtimePath': 'packages/blendlink/src/threeRuntime.ts',
            'evidence': [{'path': 'packages/blendlink/blender/export_scene.py'},
                         {'path': 'packages/blendlink/src/threeRuntime.ts'}],
            'scenePresentation': {'model': 'constant-world-background-v1',
                'path': 'packages/blendlink/blender/export_scene.py',
                'function': 'analyze_authoring_preview_world',
                'runtimeFunction': 'installAuthoringPreviewWorld',
                'callers': [{'path': 'packages/blendlink/src/threeRuntime.ts',
                    'anchor': 'const stagingPreviewWorld = installAuthoringPreviewWorld('},
                    {'path': 'packages/blendlink/src/threeRuntime.ts',
                    'anchor': 'livePreviewWorld = installAuthoringPreviewWorld('}]}}

    def test_only_reviewed_world_classes_model_and_real_routes_admit(self):
        for key in ('shader:ShaderNodeBackground', 'shader:ShaderNodeOutputWorld'):
            self.assertEqual(audit.verify_map({'entries': {key: self.entry()}}), [])
        mutations = [lambda value: value['scenePresentation'].update(model='new-model'),
            lambda value: value['scenePresentation'].update(function='collect_authoring_preview'),
            lambda value: value['scenePresentation'].update(runtimeFunction='missing'),
            lambda value: value['scenePresentation']['callers'].pop(),
            lambda value: value['scenePresentation']['callers'][0].update(anchor='missing('),
            lambda value: value.update(runtimeOps=['invented'])]
        for mutate in mutations:
            altered = self.entry(); mutate(altered)
            self.assertTrue(any('invalid scene-presentation' in failure for failure in
                audit.verify_map({'entries': {'shader:ShaderNodeBackground': altered}})))
        for key in ('shader:ShaderNodeValue', 'compositor:ShaderNodeBackground'):
            self.assertTrue(any('invalid scene-presentation' in failure for failure in
                audit.verify_map({'entries': {key: self.entry()}})))

    def test_ast_constraints_and_live_callers_cannot_be_replaced_by_comments(self):
        original = audit.ROOT
        source = 'packages/blendlink/blender/export_scene.py'
        runtime = 'packages/blendlink/src/threeRuntime.ts'
        contents = {name: (original / name).read_text() for name in (source, runtime)}
        variants = [(source, 'background.type != "BACKGROUND"', 'background.type != "OTHER"'),
            (source, 'output.type != "OUTPUT_WORLD"', 'output.type != "OTHER"'),
            (source, 'tree.get_output_node(target)', 'tree.other_output_node(target)'),
            (source, 'volume.is_linked', 'volume.other_linked'),
            (source, 'color_input.is_linked', 'color_input.other_linked'),
            (source, 'strength_input.is_linked', 'strength_input.other_linked'),
            (runtime, 'const stagingPreviewWorld = installAuthoringPreviewWorld(',
                      'const stagingPreviewWorld = missing(')]
        with tempfile.TemporaryDirectory() as temporary:
            audit.ROOT = directory = Path(temporary)
            try:
                for name, old, new in variants:
                    for path, text in contents.items():
                        target = directory / path; target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_text(text.replace(old, new) if path == name else text)
                    failures = audit.verify_map({'entries': {'shader:ShaderNodeBackground': self.entry()}})
                    self.assertTrue(any('invalid scene-presentation' in failure for failure in failures), (old, failures))
            finally:
                audit.ROOT = original


if __name__ == '__main__':
    unittest.main()
