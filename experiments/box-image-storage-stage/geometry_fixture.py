# SPDX-License-Identifier: GPL-3.0-or-later
"""CPU-authored inputs, not captured per-pixel answers, for BOX normal research."""
import bpy
import numpy as np
from mathutils import Matrix,Vector,Euler


def settings(scene):
    prop=scene.render.bl_rna.properties['anisotropic_filter']
    viewport=bpy.context.preferences.system
    return {'normalStorage':'SNORM16'if scene.render.use_high_quality_normals else'SNORM10',
            'renderAnisotropic':scene.render.anisotropic_filter,
            'renderAnisotropicSamples':prop.enum_items[scene.render.anisotropic_filter].value,
            'viewportAnisotropic':viewport.anisotropic_filter}


def snapshot(owner,camera,scene,id,basis,origin):
    mesh=owner.data;mesh.calc_loop_triangles()
    layer=mesh.color_attributes.get('BOXFaceID')or mesh.color_attributes.new(name='BOXFaceID',type='FLOAT_COLOR',domain='CORNER')
    face_ids=[0]*len(mesh.loops)
    for poly in mesh.polygons:
        for index in poly.loop_indices:
            face_ids[index]=(poly.index+1)/2048
            layer.data[index].color=(face_ids[index],face_ids[index],face_ids[index],1)
    frame=camera.data.view_frame(scene=scene)
    points=[tuple(mesh.vertices[loop.vertex_index].co)for loop in mesh.loops]
    normals=[tuple(mesh.corner_normals[loop.index].vector)for loop in mesh.loops]
    return {'id':id,'basis':basis,'origin':origin,'position':[list(v)for v in points],
            'normal':[list(v)for v in normals],'faceId':face_ids,
            'index':[int(i)for triangle in mesh.loop_triangles for i in triangle.loops],
            'modelMatrix':[list(row)for row in owner.matrix_world],
            'camera':{'type':camera.data.type,'matrix':[list(row)for row in camera.matrix_world],
                      'near':camera.data.clip_start,'far':camera.data.clip_end,
                      'viewFrame':[list(v)for v in frame]}}


def fixture(source_scene):
    native_settings=settings(source_scene)
    actual=[];depsgraph=bpy.context.evaluated_depsgraph_get()
    for name in ['Plane.021','Walls']:
        original=bpy.data.objects[name]
        private=bpy.data.meshes.new_from_object(original.evaluated_get(depsgraph),preserve_all_data_layers=True,depsgraph=depsgraph)
        actual.append((name,private,original.matrix_world.copy(),source_scene.camera.matrix_world.copy(),source_scene.camera.data.copy()))
    scene=bpy.data.scenes.new('Owned BOX normal-stage research');bpy.context.window.scene=scene
    scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=1;scene.world=None
    scene.render.resolution_x=64;scene.render.resolution_y=4;scene.render.resolution_percentage=100
    scene.render.use_compositing=False;scene.render.use_sequencer=False;scene.render.film_transparent=False;scene.render.dither_intensity=0
    scene.render.anisotropic_filter=native_settings['renderAnisotropic']
    scene.render.use_high_quality_normals=native_settings['normalStorage']=='SNORM16'
    scene.view_settings.view_transform='Raw';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
    scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32';scene.render.image_settings.exr_codec='NONE'
    owner=bpy.data.objects.new('Owned BOX source geometry',bpy.data.meshes.new('Owned BOX empty'));scene.collection.objects.link(owner)
    camera=bpy.data.objects.new('Owned BOX source camera',bpy.data.cameras.new('Owned BOX source camera'));scene.collection.objects.link(camera);scene.camera=camera
    cases=[];meshes={};cameras={};matrices={}
    for i,n in enumerate([[0,0,1],[1,.95,.1],[-1,.95,-.95],[1,-.95,.95]]):
        normal=Vector(n).normalized();u=normal.cross(Vector((0,0,1))if abs(normal.z)<.99 else Vector((0,1,0))).normalized();v=normal.cross(u).normalized()
        mesh=bpy.data.meshes.new('Owned BOX native plane '+str(i));mesh.from_pydata([tuple(u*x+v*y)for x,y in[(-2,-2),(2,-2),(2,2),(-2,2)]],[],[(0,1,2,3)]);mesh.update()
        matrix=Matrix.Identity(4)
        if i==2:matrix=Matrix.Translation((.25,-.125,.0625))@Euler((.2,-.3,.1)).to_matrix().to_4x4()@Matrix.Diagonal((1.25,.75,1.5,1))
        world_normal=(matrix.to_3x3().inverted().transposed()@normal).normalized()
        data=bpy.data.cameras.new('Owned BOX camera '+str(i));data.type='ORTHO';data.ortho_scale=2
        transform=world_normal.to_track_quat('Z','Y').to_matrix().to_4x4();transform.translation=matrix.translation+world_normal*2
        id='plane-'+str(i);meshes[id]=mesh;matrices[id]=matrix;cameras[id]=(data,transform)
        owner.data=mesh;owner.matrix_world=matrix;camera.data=data;camera.matrix_world=transform;bpy.context.view_layer.update()
        cases.append(snapshot(owner,camera,scene,id,'gltf-y-up'if i>=2 else'blender-z-up','authored native mesh vertices/corner normals'))
    for name,mesh,matrix,transform,data in actual:
        id='source-'+name;meshes[id]=mesh;matrices[id]=matrix;cameras[id]=(data,transform)
        owner.data=mesh;owner.matrix_world=matrix;camera.data=data;camera.matrix_world=transform;bpy.context.view_layer.update()
        cases.append(snapshot(owner,camera,scene,id,'gltf-y-up','read-only Archviz render-evaluated '+name))
    def activate(id):
        owner.data=meshes[id];owner.matrix_world=matrices[id]
        camera.data,camera.matrix_world=cameras[id]
        bpy.context.view_layer.update()
    return scene,owner,camera,cases,activate,native_settings


def diagnostic_pixels():
    p=np.zeros((8,8,4),np.float32);p[:,:,3]=1
    for x in [3,4]:p[5,x,:3]=[1,0,0];p[1,x,:3]=[0,0,1]
    for x in [1,6]:p[5,x,:3]=[0,1,0]
    return p
