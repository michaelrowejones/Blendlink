# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Requires matrix-owned references, saved Final exports and actual browser proof.
# blendlink-headless-sentinel: BLENDLINK_TEXTURE_FIELDS_CHECK_PASSED
"""Native default/linked full-frame texture fields; raw F32 references, no JSON float transport."""
import hashlib,json,os,sys
from pathlib import Path
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT/'packages/blendlink/blender'));sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
import compositor_graph,compositor_procedural_texture as helper
from compositor_reference import NativeCompositorReference
DEVICE=os.environ.get('SCENETOWEB_TEXTURE_FIELD_DEVICE','CPU');DEST=Path(os.environ['SCENETOWEB_TEXTURE_FIELD_REFERENCES']).resolve();DEST.mkdir(parents=True,exist_ok=True)
sha=lambda path:hashlib.sha256(Path(path).read_bytes()).hexdigest()
SIZES=[(13,9,1),(26,18,2),(9,13,1),(18,26,2),(19,11,1),(38,22,2)]
MODES=['LINEAR','QUADRATIC','EASING','DIAGONAL']
SAVED={('implicit','gradient',mode,'Color')for mode in MODES}|{('implicit','checker','5','Color'),('Uniform','gradient','DIAGONAL','Fac'),('Normalized','gradient','EASING','Fac'),('Normalized','checker','5','Color')}
source_paths=sorted({Path(__file__),ROOT/'packages/blender-addon/tests/compositor_reference.py',*(ROOT/'packages/blendlink/blender').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.py')});source_hashes={str(p.relative_to(ROOT)):sha(p)for p in source_paths}
rows=[]
def run_frame(width,height,pixel_ratio,fullhd=False,dyadic=False):
 yy,xx=np.mgrid[:height,:width];pixels=np.stack([xx%31/64,yy%37/64,(xx+yy*3)%41/64,np.ones_like(xx)],axis=-1).astype(np.float32)
 oracle=NativeCompositorReference(DEST,device=DEVICE,name='Artist Texture Fields',pixels=pixels,image_only_scene=True);scene,tree=oracle.scene,oracle.tree;scene.world=None;scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=1
 def render(label):
  for node in tree.nodes:node.show_preview=False
  scene.render.filepath=str(DEST/(label+'.exr'))
  bpy.ops.render.render(write_still=True);image=bpy.data.images.load(scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL';actual=np.empty(width*height*4,np.float32);image.pixels.foreach_get(actual);bpy.data.images.remove(image);assert np.isfinite(actual).all();path=DEST/(label+'.rgba32f');path.write_bytes(actual.tobytes());return path
 controls={}
 for output in (['Uniform','Normalized']if not fullhd else[]):
  sink,source=oracle.reset();coord=tree.nodes.new('CompositorNodeImageCoordinates');tree.links.new(source.outputs['Image'],coord.inputs['Image']);tree.links.new(coord.outputs[output],sink.inputs[0]);path=render(f'control-{width}x{height}-{output.lower()}');controls[output]=(path.name,sha(path))
 signatures=[(route,'gradient','DIAGONAL',output)for route in ['implicit','Uniform']for output in ['Fac','Color']]if dyadic else [('implicit','checker','5','Fac')]if fullhd else [('implicit','gradient',mode,out)for mode in MODES for out in ['Fac','Color']]+[('implicit','checker','5',out)for out in ['Fac','Color']]+[(route,'gradient',mode,'Fac')for route in ['Uniform','Normalized']for mode in MODES]+[(route,'checker','5','Color')for route in ['Uniform','Normalized']]
 signatures=[row for row in signatures if row[2]!='DIAGONAL' or row[0]=='Normalized' or dyadic]
 for route,kind,mode,output in signatures:
  sink,source=oracle.reset();node=tree.nodes.new('ShaderNodeTexGradient'if kind=='gradient'else'ShaderNodeTexChecker')
  if kind=='gradient':node.gradient_type=mode
  else:
   node.inputs['Scale'].default_value=5;node.inputs['Color1'].default_value=[-.25,1.5,.125,-.5];node.inputs['Color2'].default_value=[2,-.125,.75,1.5]
  if route!='implicit':
   coord=tree.nodes.new('CompositorNodeImageCoordinates');tree.links.new(source.outputs['Image'],coord.inputs['Image']);tree.links.new(coord.outputs[route],node.inputs['Vector'])
  tree.links.new(node.outputs[output],sink.inputs[0]);label=f'{width}x{height}-{route.lower()}-{kind}-{mode.lower()}-{output.lower()}';case='blender-5-3-'+DEVICE.lower()+'-'+label
  source_file=None
  if ((width==13 and not dyadic)or(width==64 and dyadic)) and (route,kind,mode,output)in SAVED:source_file=DEST/(label+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(source_file));source_sha=sha(source_file)
  program=compositor_graph.extract(scene);assert program['status']=='extracted',(label,program);program_path=DEST/(case+'.program.json');program_path.write_text(json.dumps(program,indent=2)+'\n')
  # Same source graph supplies the saved Final; only proof rendering replaces RLayers
  # with the exact fixture input, whose full-frame domain is unchanged.
  replacement=tree.nodes.new('CompositorNodeImage');replacement.image=oracle.image
  for link in list(source.outputs['Image'].links):tree.links.new(replacement.outputs['Image'],link.to_socket)
  pixel_path=render(case);input_path=DEST/(case+'.input32f');input_path.write_bytes(pixels.tobytes())
  row={'case':case,'width':width,'height':height,'pixelRatio':pixel_ratio,'route':route,'kind':kind,'mode':mode,'textureOutput':output,'coordinateOutput':'Uniform'if route=='implicit'else route,'resizeEligible':(width==13 or width==64 and dyadic)and(route,kind,mode,output)in SAVED,'programFile':program_path.name,'programSha256':sha(program_path),'pixelFile':pixel_path.name,'pixelSha256':sha(pixel_path),'inputFile':input_path.name,'inputSha256':sha(input_path)}
  if not fullhd:row.update(controlFile=controls[row['coordinateOutput']][0],controlSha256=controls[row['coordinateOutput']][1])
  if source_file:assert sha(source_file)==source_sha;row.update(sourceFile=source_file.name,sourceSha256=source_sha)
  rows.append(row)
for size in SIZES:run_frame(*size)
run_frame(64,48,1,dyadic=True)
run_frame(48,64,2,dyadic=True)
run_frame(1920,1080,1,fullhd=True)
for width,height,expected in [(1920,1080,True),(1280,720,True),(3840,2160,True),(4,5,False),(5,4,False),(15,10,False),(1920,1081,False)]:assert helper.checker_field_admitted(width,height,'Uniform',5)==expected
assert source_hashes=={str(p.relative_to(ROOT)):sha(p)for p in source_paths},'Native closure changed during capture'
(DEST/'qualification.json').write_text(json.dumps({'status':'native-texture-fields-qualified','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'device':DEVICE,'sourceHashes':source_hashes,'cases':rows},indent=2)+'\n')
print('BLENDLINK_TEXTURE_FIELDS_CHECK_PASSED',DEVICE,len(rows))
