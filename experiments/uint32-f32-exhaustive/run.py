#!/usr/bin/env python3
"""Owned CPU experiment only. No Blender, GPU, runtime or node support credit."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import time


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    out = args.out.resolve()
    source = Path(__file__).with_name('probe.cpp').resolve()
    # /usr/bin/clang++ is an xcrun-style dispatcher on this host. Pin the
    # selected toolchain driver itself, preserving its C++ invocation name.
    compiler_command = subprocess.check_output(['/usr/bin/xcrun', '--find', 'clang++'], text=True).strip()
    compiler = Path(compiler_command).resolve()
    flags = ['-std=c++20', '-O3', '-fno-fast-math', '-ffp-contract=off', '-pthread']
    version = subprocess.check_output([compiler_command, '--version'], text=True)
    snapshot = out / 'probe.cpp'
    shutil.copyfile(source, snapshot)
    source_sha, compiler_sha = sha(source), sha(compiler)
    executable, assembly = out / 'probe', out / 'probe.s'
    compile_command = [compiler_command, *flags, str(snapshot), '-o', str(executable)]
    subprocess.run(compile_command, check=True, timeout=30)
    subprocess.run([compiler_command, *flags, '-S', str(snapshot), '-o', str(assembly)], check=True, timeout=30)
    started = time.monotonic()
    result = subprocess.run([str(executable)], capture_output=True, text=True, timeout=115)
    elapsed = time.monotonic() - started
    (out / 'stdout.json').write_text(result.stdout)
    (out / 'stderr.log').write_text(result.stderr)
    result.check_returncode()
    measured = json.loads(result.stdout)
    assert measured['checked'] == 2**32 and measured['mismatches'] == 0
    assert measured['roundingUnchangedNearestEven'] is True
    assert measured['shiftCounts'] == [2**24, 2**24, 2**25, 2**26, 2**27, 2**28, 2**29, 2**30, 2**31]
    assert measured['referenceWordSum'] == measured['lawWordSum']
    assert sha(source) == source_sha == sha(snapshot) and sha(compiler) == compiler_sha
    record = {
        'status': 'exhaustive-owned-cpu-law-pass',
        'credit': {'liveNodes': 0, 'blender': 0, 'gpu': 0, 'savedFinal': 0},
        'host': {'system': platform.platform(), 'machine': platform.machine(), 'cpuCount': os.cpu_count()},
        'compiler': {'command': compiler_command, 'canonicalPath': str(compiler), 'sha256': compiler_sha, 'version': version},
        'compileCommand': compile_command,
        'files': {name: {'path': str(path), 'sha256': sha(path)} for name, path in {
            'source': snapshot, 'runner': Path(__file__).resolve(), 'executable': executable,
            'assembly': assembly, 'stdout': out / 'stdout.json', 'stderr': out / 'stderr.log',
        }.items()},
        'measured': measured, 'processWallSeconds': elapsed, 'exitCode': result.returncode,
        'boundSeconds': 115,
        'formula': 'RN-even(u / 2^32), compared to float(u)/float(UINT32_MAX)',
        'runtimeRoundingChanged': False,
        'limitations': 'Owned host C++20 exhaustive identity only; does not qualify a shader backend, Blender node, compiler elsewhere or GPU conversion.'
    }
    (out / 'receipt.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record, indent=2))


if __name__ == '__main__':
    main()
