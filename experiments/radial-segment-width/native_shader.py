# SPDX-License-Identifier: GPL-3.0-or-later
"""One actual EEVEE field atlas and an independent exact-half digit carrier."""
import hashlib,json
from pathlib import Path
import bpy,numpy as np

def capture_shader_width(directory):
    directory=Path(directory);directory.mkdir(exist_ok=True)
    scene=bpy.data.scenes.new('Native Radial Width Shader Atlas');scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=1;scene.world=None
    scene.render.resolution_x=128;scene.render.resolution_y=4;scene.render.resolution_percentage=100;scene.render.use_compositing=False;scene.render.use_sequencer=False;scene.render.dither_intensity=0
    scene.view_settings.view_transform='Raw';scene.view_settings.look='None';scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_depth='32';scene.render.image_settings.color_mode='RGBA'
    camera_data=bpy.data.cameras.new('Atlas Orthographic');camera_data.type='ORTHO';camera_data.ortho_scale=32
    camera=bpy.data.objects.new(camera_data.name,camera_data);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera
    specs=[{'sides':s,'normalize':n}for s in range(2,65)for n in [False,True]]
    # Two known Float32 values test low and high carrier mantissas, independently
    # of any Radial output or host-side reference formula.
    controls=[float(np.float32(.049123456)),float(np.float32(1.5678912))]
    vertices=[];faces=[]
    for x in range(128):
        left=-16+x*.25;index=len(vertices);vertices +=[(left,-.5,0),(left+.25,-.5,0),(left+.25,.5,0),(left,.5,0)];faces.append((index,index+1,index+2,index+3))
    mesh=bpy.data.meshes.new('Atlas carriers');mesh.from_pydata(vertices,[],faces);owner=bpy.data.objects.new(mesh.name,mesh);scene.collection.objects.link(owner)
    def math(tree,operation,a,b=None):
        node=tree.nodes.new('ShaderNodeMath');node.operation=operation
        for index,value in enumerate([a,b]):
            if value is None:continue
            if isinstance(value,(int,float)):node.inputs[index].default_value=value
            else:tree.links.new(value,node.inputs[index])
        return node.outputs[0]
    for index in range(128):
        material=bpy.data.materials.new('Width atlas '+str(index));material.use_nodes=True;tree=material.node_tree;tree.nodes.clear();output=tree.nodes.new('ShaderNodeOutputMaterial');emission=tree.nodes.new('ShaderNodeEmission');tree.links.new(emission.outputs[0],output.inputs['Surface'])
        if index<126:
            spec=specs[index];radial=tree.nodes.new('ShaderNodeRadialTiling');radial.normalize=spec['normalize'];radial.inputs['Sides'].default_value=spec['sides'];radial.inputs['Roundness'].default_value=1
            coords=tree.nodes.new('ShaderNodeTexCoord');tree.links.new(coords.outputs['Object'],radial.inputs['Vector']);scalar=radial.outputs['Segment Width']
        else:
            value=tree.nodes.new('ShaderNodeValue');value.outputs[0].default_value=controls[index-126];scalar=value.outputs[0]
        # For0<=v<2: decode2*(a/512+b/(512*1024)+c/(512*1024²)).
        scaled=math(tree,'MULTIPLY',scalar,256);red=math(tree,'MULTIPLY',math(tree,'FLOOR',scaled),1/1024)
        green=math(tree,'MULTIPLY',math(tree,'FLOOR',math(tree,'MULTIPLY',math(tree,'FRACT',scaled),1024)),1/1024)
        blue=math(tree,'MULTIPLY',math(tree,'FLOOR',math(tree,'MULTIPLY',math(tree,'FRACT',math(tree,'MULTIPLY',scalar,262144)),1024)),1/1024)
        color=tree.nodes.new('ShaderNodeCombineXYZ')
        for channel,value in enumerate([red,green,blue]):tree.links.new(value,color.inputs[channel])
        tree.links.new(color.outputs[0],emission.inputs['Color']);owner.data.materials.append(material);mesh.polygons[index].material_index=index
    scene.render.filepath=str(directory/'native-atlas.exr');bpy.ops.render.render(write_still=True,scene=scene.name)
    image=bpy.data.images.load(scene.render.filepath,check_existing=False);raw=np.empty(128*4*4,np.float32);image.pixels.foreach_get(raw);bpy.data.images.remove(image);raw=raw.reshape(4,128,4)
    assert np.isfinite(raw).all() and np.array_equal(raw[:,:,3],np.ones((4,128),np.float32))
    assert np.array_equal(raw[0],raw[1]) and np.array_equal(raw[0],raw[2]) and np.array_equal(raw[0],raw[3])
    digits=raw[0,:,:3]*1024;assert np.array_equal(digits,np.floor(digits));assert (digits>=0).all() and (digits<1024).all() and (digits[:,0]<512).all()
    decoded=np.asarray(2*(digits[:,0].astype(np.float64)/512+digits[:,1].astype(np.float64)/(512*1024)+digits[:,2].astype(np.float64)/(512*1024*1024)),np.float32)
    assert np.array_equal(decoded[-2:].view(np.uint32),np.asarray(controls,np.float32).view(np.uint32)),(decoded[-2:],controls)
    # Carrier exactness controls are independent; compare formula only after
    # actual native capture, keeping the CPU/GPU rounding distinction visible.
    gpu_anchor=np.asarray([np.float32(np.pi)/np.float32(s['sides'])for s in specs],np.float32)
    errors=np.abs(decoded[:126].view(np.int32).astype(np.int64)-gpu_anchor.view(np.int32).astype(np.int64));assert errors.max()<=2,errors
    (directory/'packed.rgba32f').write_bytes(raw.tobytes());(directory/'decoded.f32').write_bytes(decoded.tobytes())
    bpy.ops.wm.save_as_mainfile(filepath=str(directory/'shader-atlas.blend'))
    report={'width':128,'height':4,'cases':[{**spec,'column':i,'word':int(decoded.view(np.uint32)[i])}for i,spec in enumerate(specs)],'controls':controls,'controlWords':[int(v)for v in decoded[-2:].view(np.uint32)],'maxGpuAnchorUlps':int(errors.max()),'sourceStage':'actual EEVEE Metal shader field','outputs':'Segment Width only; other outputs disconnected','files':{name:hashlib.sha256((directory/name).read_bytes()).hexdigest()for name in ['native-atlas.exr','packed.rgba32f','decoded.f32','shader-atlas.blend']}}
    (directory/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    return{(s['sides'],s['normalize']):float(decoded[i])for i,s in enumerate(specs)},report
