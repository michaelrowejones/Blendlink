"""Audit Blender's global file paths versus typed libraries and weak ID refs.

Read-only: Blender --background --factory-startup --disable-autoexec SOURCE
--python experiments/release-scene-corpus/weak_reference_audit.py -- REPORT.json
"""
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import sys


def id_closure(user_map, roots):
    """Invert Blender's dependency -> owners map, then follow owned IDs."""
    forward = {}
    for dependency, owners in user_map.items():
        for owner in owners:
            forward.setdefault(owner, set()).add(dependency)
    pending = list(roots)
    reached = set()
    while pending:
        current = pending.pop()
        if current in reached:
            continue
        reached.add(current)
        pending.extend(forward.get(current, ()))
    return reached


def main():
    import bpy

    source = Path(bpy.data.filepath)
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    users = bpy.data.user_map()
    reached = id_closure(users, {bpy.context.scene})

    def label(item):
        return {'name': item.name_full, 'type': item.bl_rna.identifier,
                'library': item.library.filepath if item.library else None}

    def canonical(path):
        return os.path.normpath(bpy.path.abspath(path))

    refs = []
    for item in users:
        ref = getattr(item, 'library_weak_reference', None)
        if ref:
            refs.append({'owner': label(item), 'filepath': ref.filepath,
                'canonicalPath': canonical(ref.filepath), 'idName': ref.id_name,
                'users': item.users, 'fakeUser': item.use_fake_user,
                'directUsers': sorted([label(x) for x in users.get(item, ())],
                                      key=lambda x: (x['type'], x['name'])),
                'reachableFromSceneID': item in reached,
                'isTool': getattr(item, 'is_tool', None)})
    refs.sort(key=lambda x: (x['canonicalPath'], x['owner']['type'], x['owner']['name']))
    paths = Counter(canonical(p) for p in bpy.utils.blend_paths(
        absolute=True, packed=False, local=False))
    weak_paths = Counter(r['canonicalPath'] for r in refs)
    report = {
        'schemaVersion': 1, 'kind': 'release-scene-weak-reference-audit-v1',
        'source': {'fileName': source.name, 'bytes': source.stat().st_size, 'sha256': before},
        'programSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'blender': {'version': bpy.app.version_string, 'buildHash': bpy.app.build_hash.decode()},
        'scope': 'Current loaded scene ID dependency closure, no UI/workspace roots. Weak local-ID provenance is not a linked library. This does not prove arbitrary edits, other scenes or visual equivalence.',
        'blendPaths': [{'path': path, 'occurrences': count, 'exists': Path(path).is_file()}
                       for path, count in sorted(paths.items())],
        'libraries': [{'name': lib.name, 'filepath': lib.filepath,
            'users': sorted([label(x) for x in lib.users_id], key=lambda x: (x['type'], x['name']))}
            for lib in bpy.data.libraries],
        'weakReferences': refs,
        'sceneIDClosure': sorted([label(x) for x in reached], key=lambda x: (x['type'], x['name'])),
        'activeObjectNodeModifiers': [{'object': obj.name, 'group': mod.node_group.name if mod.node_group else None}
            for obj in bpy.context.scene.objects for mod in obj.modifiers
            if mod.type == 'NODES' and mod.show_render and not obj.hide_render],
        'allBlendPathsAccountedByWeakReferences': paths == weak_paths,
        'allWeakOwnersLocal': all(r['owner']['library'] is None for r in refs),
        'allWeakOwnersOutsideCurrentSceneIDClosure': all(not r['reachableFromSceneID'] for r in refs),
        'renderCalls': 0, 'bakeCalls': 0, 'saveCalls': 0,
        'sourceUnchanged': hashlib.sha256(source.read_bytes()).hexdigest() == before,
        'supportPromotion': False, 'sceneAcceptance': False,
    }
    assert report['sourceUnchanged']
    target = Path(sys.argv[sys.argv.index('--') + 1])
    target.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print('SCENETOWEB_WEAK_REFERENCE_AUDIT', len(refs), len(paths))


if __name__ == '__main__':
    main()
