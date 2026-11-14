# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Coordinated direct GPU kernel research, no material/port qualification credit.
import hashlib,json,os,sys
from pathlib import Path
import bpy,gpu,numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'experiments/native-f32-oracle-research'),str(Path(__file__).parent)]
from framebuffer_oracle import FramebufferOracle,initialize_metal,calibration,VERTEX_SOURCE
from adapter import assemble
OUT=Path(os.environ['SCENETOWEB_RADIAL_F32_DESTINATION']).resolve();OUT.mkdir(parents=True,exist_ok=True);SOURCES=Path(os.environ['SCENETOWEB_F32_ORACLE_SOURCES']).resolve();CASE_PATH=Path(os.environ['SCENETOWEB_RADIAL_F32_CASES']).resolve();sha=lambda value:hashlib.sha256(value).hexdigest()
manifest_path=Path(__file__).with_name('sources.json');manifest=json.loads(manifest_path.read_text());assert tuple(bpy.app.version)==tuple(manifest['nativeVersion'])and bpy.app.build_hash.decode()==manifest['nativeBuild']
for entry in manifest['sources']:assert sha((SOURCES/Path(entry['path']).name).read_bytes())==entry['sha256'],entry['path']
case_bytes=CASE_PATH.read_bytes();census=json.loads(case_bytes);cases=census['cases'];assert 1<=len(cases)<=1024 and len({row['case']for row in cases})==len(cases)
words=np.asarray([row['inputWords']for row in cases],np.uint32);assert words.shape==(len(cases),4);inputs=words.view(np.float32)
assert np.isfinite(inputs).all()
for row,value in zip(cases,inputs):assert row['sides']in[3,8,12]and row['roundness']==1 and value[2]==row['sides']and value[3]==int(row['normalize'])
(OUT/'cases.json').write_bytes(case_bytes);(OUT/'input.rgba32f').write_bytes(words.tobytes());assembled=assemble(SOURCES)
for key in ['kernel','diagnostic','angle','phase','input']:(OUT/(key+'.glsl')).write_text(assembled[key])
identity=initialize_metal();surface=FramebufferOracle(len(cases));input_texture=None
try:
 controls=calibration(surface)
 input_texture=gpu.types.GPUTexture((len(cases),1),format='RGBA32F',data=gpu.types.Buffer('FLOAT',inputs.size,inputs.ravel()))
 result={};runs=[]
 for name in ['input','diagnostic','angle','phase','kernel']:
  shader=surface.compile(assembled[name],samplers=['oracle_input']);actual=surface.draw(shader,samplers={'oracle_input':input_texture});filename=name+'.rgba32f';(OUT/filename).write_bytes(actual.tobytes());result[name]=actual;runs.append({'name':name,'pixelFile':filename,'pixelSha256':sha(actual.tobytes()),'words':int(actual.size),'finiteWords':int(np.isfinite(actual).sum())})
finally:input_texture=None;surface.release()
assert sha(CASE_PATH.read_bytes())==sha(case_bytes),'Shared case census changed during capture'
read_words=result['input'].view(np.uint32);input_diff=np.count_nonzero(read_words!=words);rows=[]
for index,row in enumerate(cases):
 source_words=words[index];realized=read_words[index];magnitudes=source_words[:2]&np.uint32(0x7fffffff);tiny=bool(np.any((magnitudes>0)&(magnitudes<0x00800000)))
 rows.append({**row,'sourceInputWords':source_words.astype(np.uint64).tolist(),'realizedInputWords':realized.astype(np.uint64).tolist(),'inputWordMismatches':int(np.count_nonzero(source_words!=realized)),'subnormalInputControl':tiny,'rawOutputWords':result['kernel'][index].view(np.uint32).astype(np.uint64).tolist(),'diagnosticWords':result['diagnostic'][index].view(np.uint32).astype(np.uint64).tolist(),'angleDiagnosticWords':result['angle'][index].view(np.uint32).astype(np.uint64).tolist(),'phaseDiagnosticWords':result['phase'][index].view(np.uint32).astype(np.uint64).tolist(),'finiteRawOutput':bool(np.isfinite(result['kernel'][index]).all()),'finiteDiagnostic':bool(np.isfinite(result['diagnostic'][index]).all())})
report={'schemaVersion':1,'status':'CAPTURED_RADIAL_REGULAR_PYTHON_GPU_F32_RESEARCH','model':'blender53-python-glsl-native-shared-radial-rgba32f-v1','qualificationCredit':{'node':0,'actualMaterial':0,'fullScene':0},'sourceStage':'Unchanged native shared GLSL function under PythonGPU GLSL frontend/native Metal compiler; independently assembled aliases/helpers. Not actual EEVEE material/film.','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'backend':identity,'sourceManifestSha256':sha(manifest_path.read_bytes()),'sourcePins':manifest['sources'],'assembly':assembled['pins'],'adaptation':assembled['adaptation'],'caseCensusSha256':sha(case_bytes),'caseCount':len(cases),'textureLayout':'RGBA32F exact inputWords: x,y,literalSides,normalize0or1; roundness literal1. Raw outputRGBA=(postprocessedRadius,postprocessedPhase,width,rotation); SegmentCoordinates=(raw.y,raw.x,0).','inputWordMismatches':int(input_diff),'subnormalControls':sum(row['subnormalInputControl']for row in rows),'independentCalibration':{'cases':len(controls),'words':len(controls)*len(cases)*4,'wordMismatches':0,'rows':controls},'runs':runs,'rows':rows,'prototypePins':{str(path.relative_to(ROOT)):sha(path.read_bytes())for path in[Path(__file__),Path(__file__).with_name('adapter.py'),ROOT/'experiments/native-f32-oracle-research/framebuffer_oracle.py']},'sourceFlags':{'origin':'Pinned gpu_shader.cc/mtl_shader.mm; no runtime flag introspection','frontEnd':'PythonGPU SourceProcessor(Language::GLSL)','metalFastMathEnabled':True,'metalPreserveInvariance':True,'sameMaterialCreateInfoOrGeneratedShader':False}}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print('SCENETOWEB_RADIAL_F32_ORACLE_CAPTURED '+json.dumps({'cases':len(cases),'inputWordMismatches':int(input_diff),'subnormalControls':report['subnormalControls'],'finiteKernelRows':sum(row['finiteRawOutput']for row in rows),'backend':identity,'qualificationCredit':0}))
