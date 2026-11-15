"""Conservative socket reachability for exported Blender node graphs.

This is dependency discovery, not a native-evaluation or compiler-support proof.
Both dynamic branches remain dependencies; muted nodes remain authored usage.
Group interfaces are traversed by identifier rather than display label.
"""

def reachable(graph):
    trees = graph['trees']
    found = set()
    seen = set()
    stack = []

    def input_links(tree, node, socket=None):
        return [x for x in trees[tree]['links'] if x['toNode'] == node and
                (socket is None or x['toSocket'] == socket)]

    def visit(tree, node, output, frames):
        # Include the complete instance path: the same group may have distinct
        # contributing inputs in different material/object instances.
        token = (tree, node, output, tuple(frames))
        if token in seen:
            return
        seen.add(token)
        if len(frames) > 32:
            raise ValueError('Node group depth exceeds discovery limit')
        found.add((tree, node))
        item = trees[tree]['nodes'][node]
        if item['id'] == 'NodeGroupInput' and frames:
            parent_tree, parent_node, child_tree = frames[-1]
            if child_tree != tree:
                raise ValueError('Group ownership mismatch')
            for link in input_links(parent_tree, parent_node, output):
                visit(parent_tree, link['fromNode'], link['fromSocket'], frames[:-1])
            return
        child = item.get('groupTree')
        if child:
            if child in [f[2] for f in frames]:
                raise ValueError('Recursive node group')
            for group_output, n in trees[child]['nodes'].items():
                if n['id'] == 'NodeGroupOutput' and n.get('activeOutput', True):
                    found.add((child, group_output))
                    for link in input_links(child, group_output, output):
                        visit(child, link['fromNode'], link['fromSocket'],
                              frames + [(tree, node, child)])
            # Linked group inputs that do not contribute to this output are
            # intentionally excluded; defaults remain in authored metadata.
            return
        for link in input_links(tree, node):
            visit(tree, link['fromNode'], link['fromSocket'], frames)

    for root in graph['roots']:
        visit(root['tree'], root['node'], None, [])
    return sorted(found)


def summarize(graph):
    active = set(reachable(graph))
    counts = {}
    for tree, data in graph['trees'].items():
        for name, node in data['nodes'].items():
            key = data['context'] + ':' + node['id']
            row = counts.setdefault(key, {'authoredNodes': 0,
                'reachableNodes': 0, 'modes': {}, 'reachableModes': {}, 'owners': set(),
                'groupDependencies': set()})
            row['authoredNodes'] += 1
            if (tree, name) in active:
                row['reachableNodes'] += 1
            row['owners'].add(tree)
            for prop, value in node.get('modes', {}).items():
                row['modes'].setdefault(prop, set()).add(str(value))
                if (tree, name) in active:
                    row['reachableModes'].setdefault(prop, set()).add(str(value))
            if node.get('groupTree'):
                row['groupDependencies'].add(node['groupTree'])
    for row in counts.values():
        row['owners'] = sorted(row['owners'])
        row['groupDependencies'] = sorted(row['groupDependencies'])
        row['modes'] = {k: sorted(v) for k, v in sorted(row['modes'].items())}
        row['reachableModes'] = {k: sorted(v) for k, v in sorted(row['reachableModes'].items())}
    return {k: counts[k] for k in sorted(counts)}
