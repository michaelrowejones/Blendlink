# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded actual EEVEE ramp calibration before Color Attribute captures."""
from array import array
from pathlib import Path
import bpy
import json
import os
import struct

OUT=Path(os.environ['SCENETOWEB_VERTEX_ALPHA_PILOT']);OUT.mkdir(parents=True,exist_ok=True)
assert tuple(bpy.app.version)==(5,3,0) and bpy.app.build_hash==b'02f0899d78e3'
SIZE=64
previous=bpy.context.window.scene
scene=bpy.data.scenes.new('Owned Vertex Alpha calibration')
bpy.context.window.scene=scene
mesh=camera_data=material=plane=camera=None
try:
    scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=1
    scene.render.resolution_x=scene.render.resolution_y=SIZE;scene.render.resolution_percentage=100
    scene.render.film_transparent=False;scene.world=None
    scene.view_settings.view_transform='Raw';scene.view_settings.look='None'
    scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_depth='32'
    scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.exr_codec='NONE'
    scene.render.use_compositing=False;scene.render.use_sequencer=False
    mesh=bpy.data.meshes.new('Owned overdraw plane');mesh.from_pydata([(-2,-2,0),(2,-2,0),(2,2,0),(-2,2,0)],[],[(0,1,2),(0,2,3)])
    plane=bpy.data.objects.new('Owned overdraw plane',mesh);scene.collection.objects.link(plane)
    material=bpy.data.materials.new('Independent native geometry ramp');material.use_nodes=True;mesh.materials.append(material)
    tree=material.node_tree;tree.nodes.clear();output=tree.nodes.new('ShaderNodeOutputMaterial');emission=tree.nodes.new('ShaderNodeEmission')
    tree.links.new(emission.outputs[0],output.inputs['Surface'])
    geometry=tree.nodes.new('ShaderNodeNewGeometry');separate=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(geometry.outputs['Position'],separate.inputs[0])
    combine=tree.nodes.new('ShaderNodeCombineXYZ');combine.inputs['Z'].default_value=.5
    for axis in ('X','Y'):
        add=tree.nodes.new('ShaderNodeMath');add.operation='ADD';add.inputs[1].default_value=1
        mul=tree.nodes.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=.5
        tree.links.new(separate.outputs[axis],add.inputs[0]);tree.links.new(add.outputs[0],mul.inputs[0]);tree.links.new(mul.outputs[0],combine.inputs[axis])
    tree.links.new(combine.outputs[0],emission.inputs['Color'])
    camera_data=bpy.data.cameras.new('Owned calibrated camera');camera_data.type='ORTHO';camera_data.ortho_scale=2
    camera=bpy.data.objects.new('Owned calibrated camera',camera_data);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera
    path=OUT/'geometry-ramp.exr';scene.render.filepath=str(path);bpy.ops.render.render(write_still=True)
    image=bpy.data.images.load(str(path),check_existing=False)
    try:
        pixels=array('f',[0])*(SIZE*SIZE*4);image.pixels.foreach_get(pixels)
    finally:bpy.data.images.remove(image)
    (OUT/'geometry-ramp.rgba32f').write_bytes(pixels.tobytes())
    maximum=[0,0,0,0];offset=[0,0];count=0
    for y in range(SIZE):
        for x in range(SIZE):
            expected=((x+.5)/SIZE,(y+.5)/SIZE,.5,1)
            for lane in range(4):maximum[lane]=max(maximum[lane],abs(pixels[4*(y*SIZE+x)+lane]-expected[lane]))
            offset[0]+=pixels[4*(y*SIZE+x)]*SIZE-x-.5
            offset[1]+=pixels[4*(y*SIZE+x)+1]*SIZE-y-.5;count+=1
    import gpu
    report={'status':'VERTEX_ALPHA_INDEPENDENT_RAMP_CAPTURED','nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),
        'nativeBackend':gpu.platform.backend_type_get(),'nativeRenderer':gpu.platform.renderer_get(),
        'size':[SIZE,SIZE],'samples':scene.eevee.taa_render_samples,'filterSize':scene.render.filter_size,'frame':scene.frame_current,
        'camera':{'type':'ORTHO','scale':2,'position':list(camera.location),'rotation':list(camera.rotation_euler),'shiftX':camera_data.shift_x,'shiftY':camera_data.shift_y},
        'filmStorage':'native EEVEE half film; 32bit EXR container is not a full-F32 kernel oracle',
        'independentRampMaxAbs':maximum,'meanNativePixelOffset':[v/count for v in offset],
        'cameraAdjusted':False,'allPixels':count,'nodePortCredit':0,'FinalCredit':0,'browserCredit':0}
    (OUT/'ramp.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
    # Independent calibration is complete and immutable before this first
    # actual Color Attribute capture. Camera and render settings stay fixed.
    assert maximum == [0,0,0,0], "unqualified native sample-center calibration"
    tree.links.remove(emission.inputs['Color'].links[0])
    field=tree.nodes.new('ShaderNodeVertexColor');field.layer_name='Artist Alpha'
    tree.links.new(field.outputs['Alpha'],emission.inputs['Color'])
    # Asymmetric authored geometry avoids putting sample centers exactly on
    # a discontinuity; all seam/edge-band pixels are still measured.
    mesh.vertices[0].co.y=-2.125;mesh.update()
    captures=[]
    cases=[('zero','POINT',[0]*4),('tenth','POINT',[.1]*4),('third','POINT',[1/3]*4),
        ('one','POINT',[1]*4),('point-nonuniform','POINT',[0,.1,1/3,1]),
        ('corner-seam','CORNER',[0,.1,1/3,.25,.8,1])]
    for name,domain,alpha in cases:
        previous_layer=mesh.color_attributes.get('Artist Alpha')
        if previous_layer:mesh.color_attributes.remove(previous_layer)
        layer=mesh.color_attributes.new(name='Artist Alpha',type='FLOAT_COLOR',domain=domain)
        rgba=array('f',[lane for a in alpha for lane in (.125,.25,.5,a)])
        layer.data.foreach_set('color',rgba)
        raw=array('f',[0])*len(rgba);layer.data.foreach_get('color',raw)
        words=list(struct.unpack('='+str(len(raw))+'I',raw.tobytes()))[3::4]
        expected_alpha=list(struct.unpack('='+str(len(alpha))+'f',b''.join(struct.pack('=I',word)for word in words)))
        bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(name+'.blend')))
        target=OUT/(name+'.exr');scene.render.filepath=str(target);bpy.ops.render.render(write_still=True)
        image=bpy.data.images.load(str(target),check_existing=False)
        try:
            pixels=array('f',[0])*(SIZE*SIZE*4);image.pixels.foreach_get(pixels)
        finally:bpy.data.images.remove(image)
        (OUT/(name+'.rgba32f')).write_bytes(pixels.tobytes())
        # Geometric barycentrics are independent of the node and source
        # Float32 alpha. The Blender image is bottom-up, just as readback.
        a=(-2.,-2.125);b=(2.,-2.);c=(2.,2.);d=(-2.,2.)
        def bary(p,a,b,c):
            den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            u=((b[1]-c[1])*(p[0]-c[0])+(c[0]-b[0])*(p[1]-c[1]))/den
            v=((c[1]-a[1])*(p[0]-c[0])+(a[0]-c[0])*(p[1]-c[1]))/den
            return u,v,1-u-v
        max_abs=0;seam_max=0;edge_max=0;violations=0;seam_pixels=0;edge_pixels=0;alpha_diff=0
        for y in range(SIZE):
            for x in range(SIZE):
                point=(-1+(x+.5)*2/SIZE,-1+(y+.5)*2/SIZE)
                weights=bary(point,a,b,c)
                if min(weights)>=0:
                    values=expected_alpha[:3]
                else:
                    weights=bary(point,a,c,d)
                    values=expected_alpha[3:] if domain=='CORNER' else [expected_alpha[i]for i in(0,2,3)]
                expected=sum(w*v for w,v in zip(weights,values))
                seam=abs(point[1]-(33/32*point[0]-1/16))<=4/SIZE
                edge=x<2 or y<2 or x>=SIZE-2 or y>=SIZE-2
                diff=max(abs(pixels[4*(y*SIZE+x)+lane]-expected)for lane in range(3))
                max_abs=max(max_abs,diff);violations+=int(diff>2**-10)
                alpha_diff+=int(pixels[4*(y*SIZE+x)+3]!=1)
                if seam:seam_pixels+=1;seam_max=max(seam_max,diff)
                if edge:edge_pixels+=1;edge_max=max(edge_max,diff)
        capture={'case':name,'domain':domain,'alphaInputWords':words,'allPixels':SIZE*SIZE,'maxAbsVsIndependentBarycentrics':max_abs,
            'seamBandPixels':seam_pixels,'seamBandMaxAbs':seam_max,'edgeBandPixels':edge_pixels,'edgeBandMaxAbs':edge_max,
            'predeclaredAbsGate':2**-10,'violations':violations,'alphaOneDiffPixels':alpha_diff}
        captures.append(capture)
    result={'status':'VERTEX_ALPHA_NATIVE_MATERIAL_PILOT_CAPTURED','calibration':report,'captures':captures,
        'sourceStage':'actual native EEVEE material Float Color Alpha into Emission; half-film output',
        'nativeShaderCases':len(captures),'FinalCredit':0,'browserCredit':0,'portCredit':0}
    (OUT/'native-material-pilot.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))

finally:
    bpy.context.window.scene=previous
    for obj in (plane,camera):
        if obj is not None:bpy.data.objects.remove(obj,do_unlink=True)
    if mesh:bpy.data.meshes.remove(mesh)
    if camera_data:bpy.data.cameras.remove(camera_data)
    if material:bpy.data.materials.remove(material)
    bpy.data.scenes.remove(scene)
