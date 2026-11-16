# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only original Plaster graph extraction, candidate image seam only.

Production emitter guards remain unchanged. Only this process intercepts the
already identified BOX Image outputs; every other node uses the actual emitter.
The result is candidate research, never an export plan or support certificate.
"""
import hashlib,json,sys
from pathlib import Path
import bpy
ROOT=Path(__file__).resolve().parents[2]
source,out=map(lambda p:Path(p).resolve(),sys.argv[sys.argv.index('--')+1:][:2])
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(source)=='9f636b2e1a59b3d181f90caf1b1703658eeadebad57f3c6207737d2fe3ffd85e'
assert bpy.app.version==(5,3,0) and bpy.app.build_hash==b'02f0899d78e3'
bpy.ops.wm.open_mainfile(filepath=str(source))
# Full file load is intentional: version-converted material trees require scene
# versioning; library-appending just one material does not reproduce that graph.
sys.path.insert(0,str(ROOT/'packages/blender-addon'))
import tsl_ir,tangent_ir,normal_map_tangent_ir
material=bpy.data.materials['Plaster'];tree=material.node_tree;original=tsl_ir._emit_output
images=[]
def candidate_image(node,socket,stack=()):
    if node.bl_idname!='ShaderNodeTexImage':return original(node,socket,stack)
    assert node.id_data==tree and node.name in {'Image Texture','Image Texture.002'}
    image=node.image
    assert node.projection=='BOX' and node.projection_blend==0.09966777265071869
    assert node.interpolation=='Linear' and node.extension=='REPEAT'
    assert image.size[:]==(1024,1024) and not image.is_float and image.alpha_mode=='STRAIGHT'
    assert image.colorspace_settings.name in {'sRGB','Non-Color'} and image.packed_file
    return {'op':'texture_ref','sourceEngine':'EEVEE','ref':{'image':image.name,'interpolation':'Linear','extension':'REPEAT'},'image':{'name':image.name,'width':1024,'height':1024,'colorSpace':image.colorspace_settings.name},'interpolation':'Linear','extension':'REPEAT','output':'alpha' if socket.name=='Alpha' else 'color','vector':tsl_ir.emit_input(node.inputs['Vector'],stack=stack,as_vector=True),'candidateBox':{'model':'independent-inset-simplex-v1','blend':node.projection_blend,'normalStorage':'SNORM16' if bpy.context.scene.render.use_high_quality_normals else 'SNORM10'}}
report={'status':'RUNNING_RESEARCH_ZERO_CREDIT','supportCredit':0,'materialCredit':0,'sceneCredit':0,'source':str(source),'sourceSha256':sha(source),'extractSha256':sha(__file__),'nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'sourceSettings':{'normalStorage':'SNORM16' if bpy.context.scene.render.use_high_quality_normals else 'SNORM10','anisotropy':bpy.context.scene.render.anisotropic_filter},'productionGuardsChanged':False,'owners':[],'errors':[]}
try:
    tsl_ir._emit_output=candidate_image
    with tsl_ir.emission_context(tree=tree,target='EEVEE'):
        root,stack=tsl_ir.find_principled_root(tree,target='EEVEE')
        report['color']=tsl_ir.emit_channel(root.inputs['Base Color'],stack)
        report['normal']=tsl_ir.emit_normal_channel(root.inputs['Normal'],stack)
    entries=[];tangent_ir.requirements(report['normal'],entries);assert len(entries)==1
    original_owners=[o for o in bpy.context.scene.objects if o.type=='MESH' and any(s.material==material for s in o.material_slots)]
    depsgraph=bpy.context.evaluated_depsgraph_get();owners=[]
    for source_owner in original_owners:
        mesh=bpy.data.meshes.new_from_object(source_owner.evaluated_get(depsgraph),preserve_all_data_layers=True,depsgraph=depsgraph)
        owner=bpy.data.objects.new('Owned candidate '+source_owner.name,mesh);bpy.context.scene.collection.objects.link(owner);owner.hide_render=True;owner.matrix_world=source_owner.matrix_world.copy();owners.append(owner)
        mesh.calc_loop_triangles();layer=next((x for x in mesh.uv_layers if x.active_render),None)
        triangles=[]
        for triangle in mesh.loop_triangles:
            points=[layer.data[i].uv[:] for i in triangle.loops] if layer else []
            area=(points[1][0]-points[0][0])*(points[2][1]-points[0][1])-(points[1][1]-points[0][1])*(points[2][0]-points[0][0]) if points else None
            triangles.append({'index':triangle.index,'polygon':triangle.polygon_index,'materialIndex':triangle.material_index,'material':mesh.materials[triangle.material_index].name if triangle.material_index<len(mesh.materials) and mesh.materials[triangle.material_index] else None,'uvArea2':area})
        degenerate=[x for x in triangles if x['uvArea2'] is None or abs(x['uvArea2'])<1e-8]
        record={'triangles':len(triangles),'plasterTriangles':sum(x['material']=='Plaster' for x in triangles),'degenerateTriangles':len(degenerate),'degeneratePlasterTriangles':sum(x['material']=='Plaster' for x in degenerate),'degenerateExamples':degenerate[:6],'name':source_owner.name,'vertices':len(mesh.vertices),'loops':len(mesh.loops),'uvNames':[x.name for x in mesh.uv_layers],'matrix':[list(row) for row in owner.matrix_world]};report['owners'].append(record)
        try:
            local=json.loads(json.dumps(report['normal']));choices={};tangent_ir.bind_owners(local,[owner],choices);normal_map_tangent_ir.validate_owners(local,[owner]);record['frameCertificate']='passed';record['boundFrame']=local['output']['input']['frame']
        except ValueError as error:record['frameCertificate']='refused';record['refusal']=str(error)
        if layer:
            import math
            try:mesh.calc_tangents(uvmap=layer.name)
            except RuntimeError as error:
                record['nativeMikkRefusal']=str(error)
                continue
            vectors=[mesh.loops[i].tangent[:] for tri in mesh.loop_triangles for i in tri.loops]
            record['mikkFallbackObservation']={'finite':all(math.isfinite(v) for vector in vectors for v in vector),'minimumLength':min(math.sqrt(sum(v*v for v in vector)) for vector in vectors),'maximumLength':max(math.sqrt(sum(v*v for v in vector)) for vector in vectors)}
    tangent_ir.bind_owners(report['normal'],owners,{})
    normal_map_tangent_ir.validate_owners(report['normal'],owners)
    report['status']='ORIGINAL_GRAPH_EMITTED_WITH_CANDIDATE_BOX_SEAM_ZERO_CREDIT'
except Exception as error:
    report['status']='ORIGINAL_GRAPH_FRAME_REFUSED_RESEARCH_ZERO_CREDIT'
    report['errors'].append({'type':type(error).__name__,'message':str(error)})
    raise
finally:
    tsl_ir._emit_output=original
    assert sha(source)==report['sourceSha256'];report['sourcePreserved']=True
    out.with_suffix('.extract.py').write_bytes(Path(__file__).read_bytes())
    out.write_text(json.dumps(report,indent=2)+'\n')
print('SCENETOWEB_BOX_MATERIAL_SCHEMA '+json.dumps({'status':report['status'],'owners':len(report['owners'])}))
