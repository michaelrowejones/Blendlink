#!/usr/bin/env python3
"""Optional isolated tool bootstrap; no project dependencies or global installs."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import tarfile
import time
import urllib.request

ap=argparse.ArgumentParser()
ap.add_argument('--blender-source',required=True,type=pathlib.Path)
ap.add_argument('--out',required=True,type=pathlib.Path)
a=ap.parse_args();a.out.mkdir(parents=True,exist_ok=False)
pin='02f0899d78e374b63e7181d9061e1f7ab03419cc'
assert subprocess.check_output(['git','-C',str(a.blender_source),'rev-parse','HEAD'],text=True).strip()==pin
src=a.blender_source/'source/blender/gpu/shader_tool'
files=sorted(src.glob('*.cc'))+sorted((src/'bsl').glob('*.cc'))+sorted((src/'lexit').glob('*.cc'))
cmd=['clang++','-std=c++20','-O1','-DNDEBUG','-I'+str(src),'-I'+str(src/'bsl'),'-I'+str(src/'lexit'),*map(str,files),'-o',str(a.out/'shader_tool')]
start=time.monotonic()
with(a.out/'build.log').open('w')as log:
    subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,check=True)
elapsed=time.monotonic()-start
# Immutable Homebrew arm64 Tahoe bottle, Naga 30.0.2. The bottle is a local
# bootstrap convenience; the transpiler itself is gfx-rs Naga, not a JS rewrite.
sha='18205ddf1be0fd9c7bad1c3c34d7207ea6a89b47d67bbdbfc528424d5048354e'
url='https://ghcr.io/v2/homebrew/core/naga-cli/blobs/sha256:'+sha
token=json.load(urllib.request.urlopen('https://ghcr.io/token?service=ghcr.io&scope=repository:homebrew/core/naga-cli:pull'))['token']
raw=urllib.request.urlopen(urllib.request.Request(url,headers={'Authorization':'Bearer '+token})).read()
assert hashlib.sha256(raw).hexdigest()==sha
bottle=a.out/'naga-bottle.tar.gz';bottle.write_bytes(raw)
with tarfile.open(bottle)as tf:
    for member in tf.getmembers():
        p=pathlib.PurePosixPath(member.name)
        assert not p.is_absolute() and '..'not in p.parts and not member.issym() and not member.islnk()
    tf.extractall(a.out/'naga')
binary=next(p for p in(a.out/'naga').rglob('naga')if p.is_file())
version=subprocess.check_output([str(binary),'--version'],text=True).strip();assert version=='30.0.2'
report=dict(blenderCommit=pin,command=cmd,buildSeconds=elapsed,nagaVersion=version,nagaBottle=dict(url=url,sha256=sha),tools={str(p):hashlib.sha256(p.read_bytes()).hexdigest()for p in[a.out/'shader_tool',binary]})
(a.out/'build.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
