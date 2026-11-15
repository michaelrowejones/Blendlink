"""CPU-only production source audit; no bpy/GPU or candidate arithmetic copy."""
import ast,json,hashlib,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def audit():
    file=ROOT/'packages/blender-addon/tsl_ir.py';module=ast.parse(file.read_text());names={'_jenkins_rot','_jenkins_final','_float_bits','_hash_float2_to_float','_hash_float_to_float','_noise_random_offset','_noise_shader_offset_profile','_normalized_noise_source_profile'}
    functions=[n for n in module.body if isinstance(n,ast.FunctionDef) and n.name in names];assert len(functions)==len(names)
    namespace={};exec(compile(ast.Module(body=functions,type_ignores=[]),str(file),'exec'),namespace)
    profile=namespace['_noise_shader_offset_profile']('EEVEE','darwin','arm64','METAL',(5,3,0),'Apple M5 Pro');assert profile is None
    assert namespace['_normalized_noise_source_profile']('EEVEE','darwin','arm64')=='native-standard-f32'
    reference=json.loads((Path(__file__).parent/'native-offsets.json').read_text());assert reference['status']=='CLOSED_NATIVE_NOISE_OFFSET_DIAGNOSTIC'
    word=lambda n:struct.unpack('<I',struct.pack('<f',n))[0]
    rows=[];values=[]
    for seed in (3.,4.):
        raw=namespace['_noise_random_offset'](seed,3);values.append(raw)
        staged=namespace['_noise_random_offset'](seed,3,native_shader_f32=True)
        fused=namespace['_noise_random_offset'](seed,3,native_shader_fused=True)
        for lane in range(3):
            native=next(r for r in reference['comparisons']if r['seed']==seed and r['lane']==lane)
            rows.append({'seed':int(seed),'lane':lane,'productionDouble':raw[lane],'productionLiteralWord':word(raw[lane]),'nativeWord':native['nativeOffsetWord'],'stagedExperimentalWord':word(staged[lane]),'fusedModelWord':word(fused[lane])})
    assert all(r['productionLiteralWord']==r['nativeWord']==r['fusedModelWord']for r in rows)
    assert sum(r['stagedExperimentalWord']!=r['nativeWord']for r in rows)==1
    return {'status':'PRODUCTION_EEVEE_METAL_3D_COLOR_OFFSETS_ALREADY_MATCH','sourceSha256':hashlib.sha256(file.read_bytes()).hexdigest(),'sourceProfile':'EEVEE/darwin/arm64/Metal shader evaluation, dimensions3, FBM normalized, distortion0','offsetProfile':profile,'emittedOffsetModel':'shader-folded','colorOffsets':values,'rows':rows,'nativeClosedReference':reference['sourceClosedReceipt'],'gpuCalls':0,'renderCalls':0,'SDKChangeRequiredForThisOffsetIssue':False,'supportCredit':0}
if __name__=='__main__': print(json.dumps(audit(),indent=2))
