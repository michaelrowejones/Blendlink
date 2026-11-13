import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BASE = Path(os.environ['BLENDLINK_PYTHON_RESEARCH_OUTPUT']).resolve()
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()

def snapshots(directory, suffix=None):
    return {str(path.relative_to(directory)): {'sha256': sha(path), 'mtimeNs': path.stat().st_mtime_ns, 'size': path.stat().st_size}
            for path in directory.rglob('*') if path.is_file() and (suffix is None or path.suffix == suffix)}

originals = {str(path.relative_to(ROOT)): sha(path) for base in [ROOT / 'packages/blender-addon', ROOT / 'packages/blendlink/blender'] for path in base.glob('*.py')}
caller = {'pycachePrefix': sys.pycache_prefix, 'dontWriteBytecode': sys.dont_write_bytecode, 'cwd': os.getcwd(), 'environment': {key: os.environ.get(key) for key in ['PYTHONPYCACHEPREFIX', 'PYTHONDONTWRITEBYTECODE']}}
project_caches = {name: snapshots(ROOT / name, '.pyc') for name in ['packages/blender-addon', 'packages/blendlink/blender']}
results = []
for binary, launcher in [(Path(sys.argv[1]), Path(sys.argv[2]))]:
    version = binary.name
    directory = BASE
    source = directory / 'source'
    addon = directory / 'copied-addon'
    addon.mkdir()
    targets = []
    for name in ['packages/blender-addon', 'packages/blendlink/blender']:
        target = source / name
        target.mkdir(parents=True)
        for file in (ROOT / name).iterdir():
            if file.suffix not in {'.py', '.json'}:
                continue
            shutil.copy2(file, target / file.name)
            if file.suffix == '.py' or name == 'packages/blender-addon':
                shutil.copy2(file, addon / file.name)
    # Fixed timestamps before the warm import make same-size stale bytecode deterministic.
    for parent in [source / 'packages/blender-addon', addon]:
        for filename in ['squeeze_ir.py', 'tsl_ir.py']:
            path = parent / filename
            os.utime(path, (1700000000, 1700000000))
            targets.append(path)
    env_prefix = directory / 'environment-prefix'
    env_prefix.mkdir()
    env = {**os.environ, 'PYTHONPYCACHEPREFIX': str(env_prefix), 'PYTHONDONTWRITEBYTECODE': '1',
           'BLENDER_USER_RESOURCES': str(directory / 'blender-profile'),
           'BLENDLINK_CACHE_PROBE_SOURCE': str(source), 'BLENDLINK_CACHE_PROBE_ADDON': str(addon)}
    def launch(label, expression=None, executable=None):
        output = directory / (label + '.json')
        command = [str(executable or binary), '--background', '--factory-startup', '--python-exit-code', '1']
        if expression:
            command += ['--python-expr', expression]
        command += ['--python', str(Path(__file__).with_name('node-port-python.probe.py'))]
        result = subprocess.run(command, cwd=source, env={**env, 'BLENDLINK_CACHE_PROBE_OUTPUT': str(output)}, text=True, capture_output=True, timeout=90)
        (directory / (label + '.log')).write_text(result.stdout + '\n' + result.stderr)
        assert result.returncode == 0, (version, label, result.stdout[-2000:], result.stderr[-2000:])
        return json.loads(output.read_text())
    initial = launch('initial-environment-request')
    warm_source = snapshots(source, '.pyc')
    warm_package = snapshots(addon, '.pyc')
    assert warm_source and warm_package, 'Default Blender unexpectedly honored environment bytecode suppression; review this profile'
    for path in targets:
        original = path.read_bytes()
        old, new = ((b'abs(value) <= 16', b'abs(value) <= 15') if path.name == 'squeeze_ir.py'
                    else (b'IR_MODEL = "blendlink-tsl-ir-v1"', b'IR_MODEL = "blendlink-tsl-ir-v2"'))
        assert original.count(old) == 1 and len(old) == len(new)
        info = path.stat()
        path.write_bytes(original.replace(old, new))
        os.utime(path, ns=(info.st_atime_ns, info.st_mtime_ns))
        assert path.stat().st_size == len(original) and path.stat().st_mtime_ns == info.st_mtime_ns
    mutated_sources = {str(path): sha(path) for path in targets}
    stale = launch('environment-only-after-mutation')
    dont_write = launch('dont-write-only-after-mutation', 'import sys; sys.dont_write_bytecode=True')
    guarded = launch('guarded-proof-launcher', executable=launcher)
    prefix = Path(guarded['pycachePrefix'])
    assert prefix.is_relative_to(launcher.parent) and not prefix.exists(), 'Launcher must dispose its own per-invocation prefix'
    for mode in [initial, stale, dont_write, guarded]:
        assert mode['preloadedTargetModules'] == []
    for kind in ['source', 'package']:
        assert initial[kind]['helper']['literal16'] is True
        assert stale[kind]['helper']['literal16'] is True and dont_write[kind]['helper']['literal16'] is True
        assert stale[kind]['helper']['sourceSha256'] != initial[kind]['helper']['sourceSha256']
        assert stale[kind]['helper']['loadedLiteralCodeSha256'] != stale[kind]['helper']['sourceLiteralCodeSha256']
        assert stale[kind]['emitter']['loadedModel'] == stale[kind]['emitter']['emittedModel'] == 'blendlink-tsl-ir-v1'
        assert guarded[kind]['helper']['literal16'] is False
        assert guarded[kind]['helper']['loadedLiteralCodeSha256'] == guarded[kind]['helper']['sourceLiteralCodeSha256']
        assert guarded[kind]['emitter']['loadedModel'] == guarded[kind]['emitter']['emittedModel'] == 'blendlink-tsl-ir-v2'
        for entry in guarded[kind].values():
            assert Path(entry['cached']).is_relative_to(prefix) and entry['cacheExists'] is False
    assert guarded['pycachePrefix'] == str(prefix) and guarded['dontWriteBytecode'] is True
    assert snapshots(source, '.pyc') == warm_source and snapshots(addon, '.pyc') == warm_package
    assert {str(path): sha(path) for path in targets} == mutated_sources
    assert snapshots(prefix) == {} and snapshots(env_prefix) == {}
    results.append({'version': guarded['version'], 'build': guarded['build'], 'python': guarded['python'],
                    'ignoreEnvironment': initial['ignoreEnvironment'], 'isolated': initial['isolated'],
                    'environmentPrefixEffective': initial['pycachePrefix'], 'environmentDontWriteEffective': initial['dontWriteBytecode'],
                    'sameSizeFixedMtimeStaleImportsReproduced': True, 'dontWriteAloneStillStale': True,
                    'freshPrefixExecutesCurrentBytes': True, 'sourceAndPackageCachesUnchanged': True,
                    'freshOwnedPrefixEmpty': True, 'receipts': [str((directory / (label + '.json')).relative_to(ROOT)) for label in ['initial-environment-request','environment-only-after-mutation','dont-write-only-after-mutation','guarded-proof-launcher']]})
assert caller == {'pycachePrefix': sys.pycache_prefix, 'dontWriteBytecode': sys.dont_write_bytecode, 'cwd': os.getcwd(), 'environment': {key: os.environ.get(key) for key in ['PYTHONPYCACHEPREFIX', 'PYTHONDONTWRITEBYTECODE']}}
assert project_caches == {name: snapshots(ROOT / name, '.pyc') for name in project_caches}
assert all(sha(ROOT / name) == value for name, value in originals.items())
packet = {'status': 'NATIVE_PYTHON_CACHE_RESEARCH_PASSED', 'productionCases': 0, 'callerStateUnchanged': True,
          'originalProjectSourcesAndCachesUnchanged': True, 'probeSha256': sha(Path(__file__).with_name('node-port-python.probe.py')), 'controllerSha256': sha(Path(__file__)), 'profiles': results}
(BASE / 'cache-research.json').write_text(json.dumps(packet, indent=2) + '\n')
print(json.dumps(packet, indent=2))
