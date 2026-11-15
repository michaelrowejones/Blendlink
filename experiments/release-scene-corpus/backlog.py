"""Close source inventories and build a scene-driven port backlog; no support writes."""
import argparse
import hashlib
import json
from pathlib import Path

from graph import summarize, reachable


def sha(data):
    return hashlib.sha256(data).hexdigest()


def validate_inventory(inventory, scene, program_hashes):
    assert inventory['kind'] == 'release-scene-source-node-inventory-v1'
    assert inventory['schemaVersion'] == 1
    assert inventory['sourceUnchanged'] is True
    assert all(inventory[k] == 0 for k in ['renderCalls', 'saveCalls', 'bakeCalls'])
    assert inventory['source']['sha256'] == scene['source']['sha256']
    assert inventory['source']['bytes'] == scene['source']['bytes']
    assert inventory['blender'] == scene['inventoryBlender']
    assert inventory['discoveryProgramSha256'] == program_hashes
    assert inventory['nodeUsage'] == summarize(inventory['graph'])
    return inventory


def build_backlog(manifest, inventories, categories):
    rows = {}
    scenes = []
    for scene in manifest['scenes']:
        inv = inventories[scene['id']]
        scenes.append({'id': scene['id'], 'source': inv['source'],
            'scene': inv['scene'], 'sceneDependencies': inv['sceneDependencies'],
            'particleSystems': inv['particleSystems'],
            'sourceClosure': inv['sourceClosure'],
            'authoredNodeKinds': len(inv['nodeUsage']),
            'reachableNodeKinds': sum(v['reachableNodes'] > 0 for v in inv['nodeUsage'].values()),
            'nodeUsage': inv['nodeUsage'],
            'acceptance': {'sourceInventory': 'passed-read-only',
                'allUsedNodeModes': 'pending', 'export': 'pending',
                'nativeVisualReference': 'pending', 'installedBrowser': 'pending',
                'performance': 'pending', 'originalSceneAccepted': False}})
        active = set(reachable(inv['graph']))
        for key, usage in inv['nodeUsage'].items():
            row = rows.setdefault(key, {'key': key,
                'catalogCategory53': categories.get(key, 'not-in-shader-compositor-catalog'),
                'reachableScenes': [], 'authoredScenes': [], 'reachableModes': {},
                'upstreamNodeKinds': set(), 'witnesses': [],
                'releaseQualification': 'pending', 'newSupportCredit': False})
            row['authoredScenes'].append(scene['id'])
            if usage['reachableNodes']:
                row['reachableScenes'].append(scene['id'])
                for prop, values in usage['reachableModes'].items():
                    row['reachableModes'].setdefault(prop, set()).update(values)
            for tree, data in inv['graph']['trees'].items():
                if not key.startswith(data['context'] + ':'):
                    continue
                for node, n in data['nodes'].items():
                    if data['context'] + ':' + n['id'] != key or (tree, node) not in active:
                        continue
                    row['witnesses'].append({'scene': scene['id'], 'tree': tree, 'node': node})
                    for link in data['links']:
                        if link['toNode'] == node:
                            src = data['nodes'][link['fromNode']]
                            row['upstreamNodeKinds'].add(data['context'] + ':' + src['id'])
    for row in rows.values():
        for field in ['reachableScenes', 'authoredScenes', 'upstreamNodeKinds']:
            row[field] = sorted(set(row[field]))
        row['reachableModes'] = {k: sorted(v) for k, v in sorted(row['reachableModes'].items())}
        domain = row['key'].split(':')[0]
        row['scope'] = 'shader-compositor-port' if domain in {'shader', 'compositor'} else 'evaluated-geometry-ingest-separate'
        row['priority'] = ('P0 Shared scene dependency' if len(row['reachableScenes']) >= 2
            else 'P1 Selected scene dependency') if row['reachableScenes'] else 'P2 Authored but unreachable'
    ordered = sorted(rows.values(), key=lambda x: (x['priority'], -len(x['reachableScenes']), x['key']))
    return {'schemaVersion': 1, 'kind': 'release-scene-node-port-backlog-v1',
        'targetBlender': '5.3.0', 'sourceCommit': manifest['sourceCommit'],
        'meaning': 'Conservative source usage only. Catalog category does not qualify these scene modes/graphs. Baking a scene earns no live-node credit. Geometry modifier nodes remain a separate evaluated-ingest scope.',
        'acceptedOriginalScenes': 0, 'supportPromotions': 0,
        'scenes': scenes, 'nodes': ordered}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inventory-dir', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    manifest = json.loads((root / 'docs/release-scene-corpus.json').read_text())
    pins = {p.name: sha(p.read_bytes()) for p in [Path(__file__).with_name('inventory.py'), Path(__file__).with_name('graph.py')]}
    inventories = {}
    for scene in manifest['scenes']:
        raw = (args.inventory_dir / scene['inventoryFile']).read_bytes()
        assert sha(raw) == scene['inventorySha256'], scene['id'] + ': inventory digest drift'
        inventories[scene['id']] = validate_inventory(json.loads(raw), scene, pins)
    coverage = json.loads((root / 'docs/node-coverage/coverage.json').read_text())
    report = next(r for r in coverage['reports'] if r['blenderVersion'] == '5.3.0')
    categories = {domain + ':' + n['id']: n['category'] for domain, data in report['domains'].items() for n in data['nodes']}
    result = build_backlog(manifest, inventories, categories)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
    print('SCENETOWEB_RELEASE_BACKLOG', len(result['scenes']), len(result['nodes']))


if __name__ == '__main__':
    main()
