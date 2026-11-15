import unittest

from graph import reachable, summarize


def node(kind='ShaderNodeValue', **extra):
    return {'id': kind, **extra}


def link(a, b, src='Value', dst='Value'):
    return {'fromNode': a, 'fromSocket': src, 'toNode': b, 'toSocket': dst}


def tree(nodes, links=(), context='shader'):
    return {'nodes': nodes, 'links': list(links), 'context': context}


class Discovery(unittest.TestCase):
    def test_unused_nodes_preserved_without_becoming_reachable(self):
        g = {'trees': {'m': tree({'out': node('ShaderNodeOutputMaterial'),
            'used': node(modes={'operation': 'ADD'}),
            'unused': node(modes={'operation': 'DIVIDE'})}, [link('used', 'out')])},
             'roots': [{'tree': 'm', 'node': 'out'}]}
        s = summarize(g)['shader:ShaderNodeValue']
        self.assertEqual(s['authoredNodes'], 2)
        self.assertEqual(s['reachableNodes'], 1)
        self.assertEqual(s['modes']['operation'], ['ADD', 'DIVIDE'])
        self.assertEqual(s['reachableModes']['operation'], ['ADD'])

    def test_branches_are_conservatively_retained(self):
        g = {'trees': {'m': tree({'a': node(), 'b': node(),
            'switch': node('GeometryNodeSwitch'), 'out': node('ShaderNodeOutputMaterial')},
            [link('a', 'switch', dst='False'), link('b', 'switch', dst='True'),
             link('switch', 'out')])}, 'roots': [{'tree': 'm', 'node': 'out'}]}
        self.assertEqual(len(reachable(g)), 4)

    def test_group_interface_traverses_only_contributing_socket(self):
        g = {'trees': {
            'm': tree({'a': node(), 'b': node(), 'group': node('ShaderNodeGroup', groupTree='g'),
                       'out': node('ShaderNodeOutputMaterial')},
                [link('a', 'group', dst='Socket_2'), link('b', 'group', dst='Socket_3'),
                 link('group', 'out', src='Socket_1')]),
            'g': tree({'in': node('NodeGroupInput'), 'out': node('NodeGroupOutput')},
                      [link('in', 'out', src='Socket_2', dst='Socket_1')])},
            'roots': [{'tree': 'm', 'node': 'out'}]}
        self.assertIn(('m', 'a'), reachable(g))
        self.assertNotIn(('m', 'b'), reachable(g))
        self.assertIn(('g', 'in'), reachable(g))

    def test_distinct_instances_keep_their_parent_inputs(self):
        g = {'trees': {
            'm': tree({'a': node(), 'b': node(), 'one': node('ShaderNodeGroup', groupTree='g'),
                'two': node('ShaderNodeGroup', groupTree='g'), 'out': node('ShaderNodeOutputMaterial')},
                [link('a', 'one', dst='A'), link('b', 'two', dst='A'),
                 link('one', 'out', src='B', dst='Surface'),
                 link('two', 'out', src='B', dst='Volume')]),
            'g': tree({'in': node('NodeGroupInput'), 'out': node('NodeGroupOutput')},
                      [link('in', 'out', src='A', dst='B')])},
            'roots': [{'tree': 'm', 'node': 'out'}]}
        self.assertIn(('m', 'a'), reachable(g))
        self.assertIn(('m', 'b'), reachable(g))

    def test_recursive_group_fails_closed(self):
        g = {'trees': {'g': tree({'self': node('ShaderNodeGroup', groupTree='g'),
            'out': node('NodeGroupOutput')}, [link('self', 'out', src='A', dst='A')])},
            'roots': [{'tree': 'g', 'node': 'out'}]}
        with self.assertRaisesRegex(ValueError, 'Recursive'):
            reachable(g)


if __name__ == '__main__':
    unittest.main()
