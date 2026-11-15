import unittest

from weak_reference_audit import id_closure


class IDClosure(unittest.TestCase):
    def test_unrelated_tool_assets_are_separate_from_scene_dependencies(self):
        users = {'object': {'scene'}, 'mesh': {'object'}, 'material': {'mesh'},
                 'active_group': {'material'}, 'unused_group': {'tool'},
                 'unused_nested': {'unused_group'}}
        self.assertEqual(id_closure(users, {'scene'}),
                         {'scene', 'object', 'mesh', 'material', 'active_group'})

    def test_a_new_active_binding_brings_the_whole_group_closure_into_scope(self):
        users = {'material': {'scene'}, 'group': {'tool', 'material'},
                 'nested': {'group'}, 'tool': set()}
        self.assertEqual(id_closure(users, {'scene'}), {'scene', 'material', 'group', 'nested'})

    def test_cycles_terminate_without_changing_dependency_direction(self):
        users = {'one': {'scene', 'two'}, 'two': {'one'}, 'other_scene': set()}
        self.assertEqual(id_closure(users, {'scene'}), {'scene', 'one', 'two'})


if __name__ == '__main__':
    unittest.main()
