# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual owned EEVEE scene, plus separate native UV calibration; never save source."""
from array import array
from pathlib import Path
import hashlib,json,sys,math
import bpy,gpu
source=Path(sys.argv[sys.argv.index('--')+1]).resolve();out=Path(sys.argv[sys.argv.index('--')+2]).resolve();out.mkdir(parents=True,exist_ok=True);sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();pin=sha(source)
bpy.ops.wm.open_mainfile(filepath=str(source));scene=bpy.context.scene;assert scene.render.engine=='BLENDER_EEVEE'and bpy.app.version==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
material=bpy.data.materials['Owned Default Noise Color'];tree=material.node_tree;surface=next(n for n in tree.nodes if n.bl_idname=='ShaderNodeBsdfPrincipled');uv=next(n for n in tree.nodes if n.bl_idname=='ShaderNodeUVMap');noise=next(n for n in tree.nodes if n.bl_idname=='ShaderNodeTexNoise')
rows=[]
def render(kind,size):
 scene.render.resolution_x=scene.render.resolution_y=size;scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_depth='32';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.exr_codec='NONE';path=out/(kind+'-'+str(size)+'.exr');scene.render.filepath=str(path);bpy.ops.render.render(write_still=True)
 image=bpy.data.images.load(str(path),check_existing=False);pixels=array('f',[0])*(size*size*4);image.pixels.foreach_get(pixels);bpy.data.images.remove(image)
 assert all(math.isfinite(x)for x in pixels);assert all(pixels[i]==1 for i in range(3,len(pixels),4))
 pixel=out/(kind+'-'+str(size)+'.rgba32f');pixel.write_bytes(pixels.tobytes());row={'kind':kind,'width':size,'height':size,'pixelFile':str(pixel),'pixelSha256':sha(pixel),'exrSha256':sha(path),'words':len(pixels)}
 if kind=='uv':
  errors=[abs(pixels[(y*size+x)*4+c]-((x+.5)/size if c==0 else(y+.5)/size if c==1 else 0))for y in range(size)for x in range(size)for c in range(3)];row['maxUVCalibrationError']=max(errors);assert max(errors)<=2**-10
 if kind=='color'and size==64:
  scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_depth='8';png=out/'native-color.png';bpy.data.images['Render Result'].save_render(filepath=str(png),scene=scene);row['visualFile']=str(png);row['visualSha256']=sha(png)
 rows.append(row)
for size in(64,128):render('color',size)
link=surface.inputs['Emission Color'].links[0];tree.links.remove(link);tree.links.new(uv.outputs['UV'],surface.inputs['Emission Color'])
for size in(64,128):render('uv',size)
tree.links.remove(surface.inputs['Emission Color'].links[0]);tree.links.new(noise.outputs['Color'],surface.inputs['Emission Color'])
assert sha(source)==pin
backend={'backend':gpu.platform.backend_type_get(),'vendor':gpu.platform.vendor_get(),'renderer':gpu.platform.renderer_get()};assert backend['backend']=='METAL'and'M5 Pro'in backend['vendor']
(out/'reference.json').write_text(json.dumps({'status':'CAPTURED_OWNED_EEVEE_NOISE_COLOR_SCENE','sourceFile':str(source),'sourceSha256':pin,'sourcePreserved':True,'backend':backend,'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'gate':{'rgbMaxAbs':2**-10,'alphaExact':True,'scope':'existing EEVEE field/half-film comparison; no broader shader precision claim'},'rows':rows,'renders':4,'supportCredit':0},indent=2)+'\n')
