# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Requires coordinated native rendering and future full browser/Final proof closure.
"""Actual native Blackbody MF pixels, never the exporter/kernel as numerical oracle."""
import hashlib,json,os,sys
from pathlib import Path
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[2];FAMILY=Path(__file__).parent
sys.path[:0]=[str(ROOT/'packages/blendlink/dist/blender'),str(ROOT/'packages/blendlink/dist/addon'),str(ROOT/'packages/blender-addon/tests'),str(FAMILY)]
import compositor_graph
from compositor_reference import NativeCompositorReference
from cases import CASES,build
sys.path.insert(0,str(ROOT/'experiments/static-string-family'))
from artifact_closure import native_artifact_closure
OUT=Path(os.environ['SCENETOWEB_BLACKBODY_REFERENCES']).resolve();OUT.mkdir(parents=True,exist_ok=True);DEVICE=os.environ.get('SCENETOWEB_BLACKBODY_DEVICE','CPU')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
packaging=native_artifact_closure(ROOT)
source_files=sorted(set(packaging['sourceFiles'])|{'experiments/compositor-blackbody/cases.py','experiments/compositor-blackbody/cases.json','experiments/compositor-blackbody/reference.py','experiments/compositor-blackbody/numeric-contract.json','experiments/static-string-family/artifact_closure.py','packages/blender-addon/tests/compositor_reference.py','packages/blender-addon/tests/compositor_blackbody_policy.py'})
source_hashes={name:sha(ROOT/name)for name in source_files};artifact_inputs=packaging['artifactInputs']
for entry in artifact_inputs:assert sha(ROOT/entry['source'])==sha(ROOT/entry['artifact'])==entry['sha256'],'Staged helper differs '+entry['artifact']
for target,expected in packaging['inventories'].items():
 actual=sorted(path.name for path in(ROOT/'packages/blendlink/dist'/target).iterdir()if path.suffix in{'.py','.json'});assert actual==expected,('Independent native artifact census differs',target,actual,expected)
oracle=NativeCompositorReference(OUT,device=DEVICE,name='Artist Blackbody MF',image_only_scene=True);scene,tree=oracle.scene,oracle.tree;scene.render.engine='BLENDER_EEVEE';scene.world=None
scene.render.compositor_precision='FULL';scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_depth='32';scene.render.image_settings.color_mode='RGBA'

def render(name):
 scene.render.filepath=str(OUT/(name+'.exr'))
 with oracle._render_sampling():bpy.ops.render.render(write_still=True,scene=scene.name)
 image=bpy.data.images.load(scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL';pixels=np.empty(8*8*4,np.float32);image.pixels.foreach_get(pixels);bpy.data.images.remove(image)
 assert np.isfinite(pixels).all();assert np.array_equal(pixels.reshape(-1,4)[:,3],np.ones(64,np.float32))
 assert np.array_equal(pixels.reshape(-1,4),np.tile(pixels[:4],(64,1)))
 path=OUT/(name+'.rgba32f');path.write_bytes(pixels.tobytes());return pixels,{'pixelFile':path.name,'pixelSha256':sha(path)}

rows=[]
for row in CASES:
 tree.nodes.clear();sink=tree.nodes.new('NodeGroupOutput');node=build(tree,row);tree.links.new(node.outputs['Color'],sink.inputs[0]);before=(len(tree.nodes),len(tree.links))
 source=OUT/(row['case']+'.blend')if row['saved']else None
 if source:bpy.ops.wm.save_as_mainfile(filepath=str(source));source_sha=sha(source)
 program=compositor_graph.extract(scene);assert program['status']=='extracted',(row,program);
 if row['kind']=='blackbody':
  op=next(op for op in program['ops']if op['kind']=='blackbody-color');assert op['properties']['blackbody_evaluator']=='CPU-MF'
 path=OUT/(row['case']+'.program.json');path.write_text(json.dumps(program,indent=2)+'\n');pixels,pin=render(row['case']);assert (pixels>=0).all()
 if row['kind']=='control':assert np.array_equal(pixels.reshape(-1,4),np.tile(np.asarray(row['expectedRGBA'],np.float32),(64,1)))
 if source:assert sha(source)==source_sha
 assert before==(len(tree.nodes),len(tree.links))
 rows.append({**row,**pin,'programFile':path.name,'programSha256':sha(path),**({'sourceFile':source.name,'sourceSha256':source_sha}if source else{})})
assert source_hashes=={name:sha(ROOT/name)for name in source_files}
record={'status':'CAPTURED_COMPOSITOR_BLACKBODY','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'device':DEVICE,'width':8,'height':8,'sourcePreserved':True,'cases':rows,'sourceHashes':source_hashes,'nativeGraphsIncludingCalibration':len(rows),'artifactInputs':artifact_inputs,'nativePackaging':packaging,'nativeBackend':{'evaluator':'host-cpu-multi-function','requestedCompositorDevice':DEVICE,'configuredGpuBackend':bpy.context.preferences.system.gpu_backend,'gpuEvaluationCredit':False},'nativeEvaluator':'CPU-MF; single-value units remain CPU even in GPU-authored graphs','nativeColorSpace':{'workingSpace':bpy.data.colorspace.working_space_interop_id,'configSource':bpy.data.colorspace.ocio_config_source,'configFile':bpy.data.colorspace.ocio_config_path,'configSha256':sha(bpy.data.colorspace.ocio_config_path)}}
(OUT/'qualification.json').write_text(json.dumps(record,indent=2)+'\n');print('SCENETOWEB_COMPOSITOR_BLACKBODY_NATIVE_CAPTURED '+json.dumps({'device':DEVICE,'productionGraphs':len(rows)-1,'calibrationGraphs':1,'savedFinalSources':sum(row['saved']for row in CASES)}))
