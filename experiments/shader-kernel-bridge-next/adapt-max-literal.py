#!/usr/bin/env python3
"""One value-preserving Naga 30 WGSL literal compatibility adapter.

No generic numeric rewriting: only the observed FLT_MAX spelling is accepted.
Original compiler output and the original native-source receipt stay immutable.
"""
import argparse
import hashlib
import json
import pathlib
import shutil
import struct
import subprocess
import time
from generate import package_module

VERSION='naga30-f32max-exact-hex-v1'
DECIMAL='340282350000000000000000000000000000000f'
HEX='0x1.fffffep+127f'
sha=lambda raw:hashlib.sha256(raw).hexdigest()


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--generated',type=pathlib.Path,required=True);ap.add_argument('--naga',type=pathlib.Path,required=True);ap.add_argument('--out',type=pathlib.Path,required=True);a=ap.parse_args()
    assert not a.out.exists();source=a.generated.resolve()
    original=(source/'generation.json').read_bytes();report=json.loads(original)
    assert report['status']=='COMBINED_LIBRARY_GENERATED' and report['nagaVersion']=='30.0.2'
    for path,pin in report['sourcePins'].items():assert sha(pathlib.Path(path).read_bytes())==pin,path
    # Independent integer proof: the decimal is above exact FLT_MAX but below
    # its RNE overflow midpoint. Both this spelling and exact hex round to MAX.
    max_integer=((1<<24)-1)<<104
    decimal_integer=int(DECIMAL[:-1])
    assert max_integer < decimal_integer < max_integer+(1<<103)
    decimal_bits=struct.unpack('<I',struct.pack('<f',float(decimal_integer)))[0]
    hex_bits=struct.unpack('<I',struct.pack('<f',float.fromhex(HEX[:-1])))[0]
    assert decimal_bits==hex_bits==0x7f7fffff
    compat=next(pathlib.Path(p)for p in report['sourcePins']if p.endswith('/gpu_shader_compat_glsl.glsl'))
    assert '#define FLT_MAX uintBitsToFloat(0x7F7FFFFFu)'in compat.read_text()
    raw=(source/'combined.wgsl').read_bytes();text=raw.decode();assert text.count(DECIMAL)==3
    for start in [i for i in range(len(text))if text.startswith(DECIMAL,i)]:
        assert not(text[start-1].isalnum()or text[start-1]in'_.')
        end=start+len(DECIMAL);assert not(text[end].isalnum()or text[end]in'_.')
    adapted=text.replace(DECIMAL,HEX);assert adapted.count(HEX)==3 and DECIMAL not in adapted
    shutil.copytree(source,a.out)
    (a.out/'original-generation.json').write_bytes(original)
    (a.out/'combined.naga-original.wgsl').write_bytes(raw)
    (a.out/'combined.wgsl').write_text(adapted)
    repro='@fragment fn main() -> @location(0) vec4<f32> { return vec4<f32>('+DECIMAL+'); }\n'
    (a.out/'literal-original-repro.wgsl').write_text(repro)
    (a.out/'literal-adapted-repro.wgsl').write_text(repro.replace(DECIMAL,HEX))
    start=time.monotonic();p=subprocess.run([str(a.naga),str(a.out/'combined.wgsl')],capture_output=True,text=True);assert p.returncode==0,p.stderr
    library,functions,_=package_module(adapted,'wgsl')
    module=json.loads((source/'module.json').read_bytes())
    # Retain exact notices already attached by the canonical generator.
    marker='struct VoronoiParams {'
    notice=module['wgslLibrary'].split(marker,1)[0];assert 'SPDX-License-Identifier:'in notice
    module['wgslLibrary']=notice+library;module['wgslFunctions']=functions
    (a.out/'module.json').write_text(json.dumps(module,indent=2)+'\n')
    report['moduleSha256']=sha((a.out/'module.json').read_bytes())
    report['moduleBytes']['combined.wgsl']=len(adapted.encode())
    report['sourcePins'][str(pathlib.Path(__file__).resolve())]=sha(pathlib.Path(__file__).read_bytes())
    report['literalCompatibility']=dict(version=VERSION,adapterSha256=sha(pathlib.Path(__file__).read_bytes()),source=DECIMAL,target=HEX,replacements=3,decimalRoundedBits=decimal_bits,hexBits=hex_bits,integerRneProof=True,nativeFltMaxSource=str(compat),originalWgslSha256=sha(raw),adaptedWgslSha256=sha(adapted.encode()),originalGenerationSha256=sha(original),nagaValidationMs=(time.monotonic()-start)*1000,kernelArithmeticChanged=False)
    (a.out/'generation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report['literalCompatibility']))


if __name__=='__main__':main()
