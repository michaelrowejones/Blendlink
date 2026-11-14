import {createHash} from 'node:crypto'
import type {Document, Accessor} from '@gltf-transform/core'

const MODEL='eevee53-float-color-alpha-scalar-v1', PROFILE='blender53-eevee-metal-float-color-alpha-v1'
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
function fail(message:string):never{throw Error('Vertex Color Alpha optimization: '+message)}
export interface VertexAlphaOptimizationEvidence {
  semantics:string[]; positionVertices:number; associations:{owner:string;mesh:string;material:string;variant:string;semantic:string;triangles:number;digest:string}[]
}

/** Compact actual indexed-field associations. Names alone never protect data. */
export function captureVertexAlphaOptimization(document:Document):VertexAlphaOptimizationEvidence|null {
  const root=document.getRoot(),marked=root.listMeshes().filter(mesh=>{
    const runtime=mesh.getExtras().blendlink_tsl_runtime
    return record(runtime)&&runtime.vertexColorAlpha!==undefined
  })
  if(!marked.length)return null
  const positions=new Set<Accessor>()
  for(const mesh of root.listMeshes())for(const primitive of mesh.listPrimitives()){
    for(const stream of [primitive,...primitive.listTargets()]){
      const position=stream.getAttribute('POSITION');if(position)positions.add(position)
    }
  }
  const positionVertices=[...positions].reduce((sum,value)=>sum+value.getCount(),0)
  if(positionVertices>1_000_000)fail('initial asset-wide Float32 POSITION protection is limited to 1,000,000 unique position vertices')
  const semantics=new Set<string>(),associations:VertexAlphaOptimizationEvidence['associations']=[]
  let renderedCorners=0
  for(const mesh of marked){
    const runtime=mesh.getExtras().blendlink_tsl_runtime as Record<string,unknown>,bindings=runtime.vertexColorAlpha
    if(!record(bindings)||!Object.keys(bindings).length)fail('malformed source-layer bindings')
    const markers=new Map<string,{materials:Set<string>}>()
    for(const value of Object.values(bindings)){
      if(!record(value)||value.model!==MODEL||value.sourceProfile!==PROFILE||typeof value.semantic!=='string'
        ||!/^_SCENETOWEB_VCOL_ALPHA_[0-9A-F]{16}$/.test(value.semantic)||value.attribute!==value.semantic.toLowerCase()
        ||typeof value.sourceLayer!=='string'||!value.sourceLayer||!['POINT','CORNER'].includes(String(value.domain))
        ||!Array.isArray(value.materials)||!value.materials.length||!value.materials.every(name=>typeof name==='string'&&name.length>0))
        fail('unqualified scalar source profile or material mapping')
      const semantic=value.semantic as string, prior=markers.get(semantic)??{materials:new Set<string>()}
      for(const material of value.materials as string[])prior.materials.add(material)
      markers.set(semantic,prior);semantics.add(semantic)
    }
    if(markers.size>4)fail('private mesh layer budget exceeded')
    const owners=root.listNodes().filter(node=>node.getMesh()===mesh)
    if(!owners.length||owners.some(node=>!node.getName()||node.getSkin()||node.getExtension('EXT_mesh_gpu_instancing')))
      fail('missing static actual mesh owner')
    const aggregates=new Map<string,{material:string;variant:string;semantic:string;hashes:string[]}>()
    const matched=new Set<string>()
    for(const primitive of mesh.listPrimitives()){
      const material=primitive.getMaterial()?.getExtras()??{},source=material.blendlink_source_material,variant=material.blendlink_material_variant
      for(const[semantic,marker]of markers){
        if(typeof source!=='string'||!marker.materials.has(source))continue
        matched.add(JSON.stringify([semantic,source]))
        const alpha=primitive.getAttribute(semantic),position=primitive.getAttribute('POSITION'),indices=primitive.getIndices()
        if(primitive.getMode()!==4||primitive.listTargets().length||typeof variant!=='string'||!variant
          ||!alpha||alpha.getType()!=='SCALAR'||alpha.getComponentType()!==5126||alpha.getNormalized()
          ||!position||position.getType()!=='VEC3'||position.getComponentType()!==5126||position.getNormalized()
          ||alpha.getCount()!==position.getCount()||position.getCount()>300000)
          fail('actual primitive requires matched raw Float32 SCALAR/POSITION without morphs')
        const av=alpha.getArray(),pv=position.getArray(),iv=indices?.getArray()
        if(!(av instanceof Float32Array)||!(pv instanceof Float32Array)
          ||indices&&(!iv||!['Uint8Array','Uint16Array','Uint32Array'].includes(iv.constructor.name)||indices.getNormalized()||indices.getType()!=='SCALAR'))
          fail('actual primitive storage is not raw Float32 and unsigned indices')
        const count=iv?.length??position.getCount();renderedCorners+=count
        if(count%3||!count||renderedCorners>3_000_000)fail('rendered corner budget/span exceeded')
        const key=JSON.stringify([source,variant,semantic]),entry=aggregates.get(key)??{material:source,variant,semantic,hashes:[] as string[]}
        const corner=Buffer.alloc(16)
        for(let start=0;start<count;start+=3){
          const corners:Buffer[]=[]
          for(let lane=0;lane<3;lane++){
            const vertex=iv?iv[start+lane]!:start+lane
            if(!Number.isInteger(vertex)||vertex<0||vertex>=position.getCount())fail('out-of-range rendered index')
            for(let c=0;c<3;c++){
              const value=pv[vertex*3+c]!
              if(!Number.isFinite(value))fail('nonfinite actual position')
              corner.writeFloatLE(value===0?0:value,c*4)
            }
            const alphaValue=av[vertex]!
            if(!Number.isFinite(alphaValue)||alphaValue<0||alphaValue>1||Object.is(alphaValue,-0)||alphaValue!==0&&alphaValue<2**-126)
              fail('alpha raw word is outside +0/normal [0,1]')
            corner.writeFloatLE(alphaValue,12);corners.push(Buffer.from(corner))
          }
          const rotations=[0,1,2].map(i=>Buffer.concat([...corners.slice(i),...corners.slice(0,i)]))
          rotations.sort(Buffer.compare)
          entry.hashes.push(createHash('sha256').update(rotations[0]!).digest('hex'))
        }
        aggregates.set(key,entry)
      }
    }
    if(matched.size!==[...markers.values()].reduce((sum,marker)=>sum+marker.materials.size,0))fail('declared scalar has no actual owned material primitive')
    for(const entry of aggregates.values()){
      const digest=createHash('sha256').update(JSON.stringify(entry.hashes.sort())).digest('hex')
      for(const owner of owners)associations.push({owner:owner.getName(),mesh:mesh.getName(),material:entry.material,
        variant:entry.variant,semantic:entry.semantic,triangles:entry.hashes.length,digest})
    }
  }
  associations.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return{semantics:[...semantics].sort(),positionVertices,associations}
}
