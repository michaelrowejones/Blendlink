# SPDX-License-Identifier: Apache-2.0
"""Maintainer-only build. Artists consume the pinned WASM, never this toolchain."""
import hashlib,json,subprocess,sys
from pathlib import Path
sdk,upstream,out=map(Path,sys.argv[1:]);out.mkdir(exist_ok=False)
root=Path(__file__).resolve().parents[2];sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
pins=json.loads((root/'experiments/archviz-tangent-frame/sources.json').read_text())
for entry in pins['files']:
 if entry['path'].startswith('intern/mikktspace/'):
  assert entry['license']=='Apache-2.0'and sha(upstream/entry['path'])==entry['sha256']
args=[str(sdk/'bin/clang++'),'--target=wasm32-wasip1','-std=c++17','-O2','-ffp-contract=off','-fno-exceptions','-I',str(upstream/'intern/mikktspace'),'experiments/archviz-tangent-frame/mikk-probe.cc','-o',str(out/'mikk-probe.wasm')]
log=subprocess.run(args,cwd=root,capture_output=True,check=True);(out/'build.log').write_bytes(log.stdout+log.stderr)
subprocess.run([str(sdk/'bin/llvm-strip'),'--strip-all',str(out/'mikk-probe.wasm'),'-o',str(out/'mikk-probe.stripped.wasm')],check=True)
version=subprocess.check_output([str(sdk/'bin/clang++'),'--version'],text=True)
(out/'build.json').write_text(json.dumps({'compilerVersion':version,'compilerSha256':sha(sdk/'bin/clang++'),'compilerArguments':args,'adapterSha256':sha(root/'experiments/archviz-tangent-frame/mikk-probe.cc'),'wasmSha256':sha(out/'mikk-probe.stripped.wasm'),'wasmBytes':(out/'mikk-probe.stripped.wasm').stat().st_size,'headerSourceCommit':pins['blenderSourceCommit'],'supportCredit':0},indent=2)+'\n')
