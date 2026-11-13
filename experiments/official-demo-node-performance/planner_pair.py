"""Freeze exact old/new canonical source trees and compare real Cube plans."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile


def git(root, *args): return subprocess.check_output(['git', '-C', str(root), *args])
def sha(data): return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--sdk-root', type=Path, required=True); parser.add_argument('--baseline', required=True); parser.add_argument('--candidate', required=True); parser.add_argument('--blend', type=Path, required=True); parser.add_argument('--blender', action='append', required=True); parser.add_argument('--output', type=Path, required=True); parser.add_argument('--order', choices=['baseline-first', 'candidate-first'], default='baseline-first')
    args = parser.parse_args(); root = args.sdk_root.resolve(); output = args.output.resolve(); output.mkdir(parents=True, exist_ok=False)
    original = args.blend.resolve(); original_hash = sha(original.read_bytes()); assert original_hash == 'a9906942c7100612cdcbc086b31179c96d1125c034140b39a87b9fe9fe65ab7e'
    copy = output/'original-cube-private-copy.blend'; shutil.copyfile(original, copy)
    baseline = git(root, 'rev-parse', '--verify', args.baseline+'^{commit}').decode().strip(); candidate = git(root, 'rev-parse', '--verify', args.candidate+'^{commit}').decode().strip()
    changed = git(root, 'diff', '--name-only', baseline, candidate, '--', 'packages/blender-addon', 'packages/blendlink/blender').decode().splitlines(); assert changed == ['packages/blender-addon/procedural.py'], changed
    snapshots = {}
    for label, revision in [('baseline', baseline), ('candidate', candidate)]:
        destination = output/label; destination.mkdir(); records = []
        archive = git(root, 'archive', revision, 'packages/blender-addon', 'packages/blendlink/blender')
        with tarfile.open(fileobj=io.BytesIO(archive)) as source:
            for member in source:
                path = PurePosixPath(member.name); assert not path.is_absolute() and '..' not in path.parts
                if member.isdir(): continue
                assert member.isfile(), 'Source snapshot cannot contain symlinks or special files'
                if path.suffix not in {'.py', '.json'}: continue
                target = destination/Path(*path.parts); target.parent.mkdir(parents=True, exist_ok=True); data = source.extractfile(member).read(); target.write_bytes(data)
                records.append({'path': member.name, 'sha256': sha(data)})
        snapshots[label] = {'revision': revision, 'directory': str(destination), 'files': records}
    results = {'schemaVersion': 1, 'kind': 'real-cube-material-index-pair-v1', 'sourceSha256': original_hash, 'sourceChanges': changed, 'executionOrder': args.order, 'snapshots': snapshots, 'runs': []}
    for index, blender in enumerate(args.blender):
        pair = {}
        for label in (['baseline', 'candidate'] if args.order == 'baseline-first' else ['candidate', 'baseline']):
            run_output = output/(str(index)+'-'+label)
            with tempfile.TemporaryDirectory(prefix='.python-cache-', dir=output) as pycache:
                initialize_python = 'import sys, os; sys.pycache_prefix=' + json.dumps(pycache) + '; sys.dont_write_bytecode=True; assert os.path.isdir(sys.pycache_prefix) and sys.dont_write_bytecode; print("BLENDLINK_DEMO_PYTHON_CACHE", sys.pycache_prefix, sys.dont_write_bytecode)'
                command = [blender, '--background', '--factory-startup', '--disable-autoexec', str(copy), '-t', '1', '--python-exit-code', '1', '--python-expr', initialize_python, '--python', str(Path(__file__).with_name('planner_benchmark.py').resolve()), '--', '--sdk-root', snapshots[label]['directory'], '--output', str(run_output)]
                process = subprocess.run(command, capture_output=True, text=True, timeout=180)
            (output/(str(index)+'-'+label+'.stdout.log')).write_text(process.stdout); (output/(str(index)+'-'+label+'.stderr.log')).write_text(process.stderr)
            assert process.returncode == 0, process.stderr[-3000:]+process.stdout[-3000:]
            pair[label] = json.loads((run_output/'benchmark.json').read_text())
        old_plans = [json.loads((output/(str(index)+'-baseline')/f'plan-{iteration}.json').read_text()) for iteration in range(3)]
        new_plans = [json.loads((output/(str(index)+'-candidate')/f'plan-{iteration}.json').read_text()) for iteration in range(3)]
        pair['fullPlanJsonIdentical'] = old_plans == new_plans; assert pair['fullPlanJsonIdentical'], 'Full material plan JSON differs; no fields stripped'
        results['runs'].append(pair); assert sha(copy.read_bytes()) == original_hash and sha(original.read_bytes()) == original_hash
        (output/'paired-results.json').write_text(json.dumps(results, indent=2)+'\n')
        print(json.dumps({'version': pair['baseline']['version'], 'fullPlanJsonIdentical': True, 'oldMs': [row['elapsedMs'] for row in pair['baseline']['timings']], 'newMs': [row['elapsedMs'] for row in pair['candidate']['timings']], 'oldPythonPeak': pair['baseline']['warmTracemalloc']['peakBytes'], 'newPythonPeak': pair['candidate']['warmTracemalloc']['peakBytes']}), flush=True)


if __name__ == '__main__': main()
