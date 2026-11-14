import {MeshStandardNodeMaterial,MeshPhysicalNodeMaterial}from'three/webgpu'
import {materialColor,vertexColor,vec4}from'three/tsl'

type DiffuseBuilder=Parameters<MeshStandardNodeMaterial['setupDiffuseColor']>[0]
type OwnedMaterial=MeshStandardNodeMaterial&{readonly completeProgramColor:boolean}

/** Explicit Alpha owns opacity before native alpha-test/hash/opaque handling.
 * Temporary setup inputs are clone-local and restored synchronously even when
 * native graph setup throws. No source texture/material or Three prototype is
 * changed, and the public generic installer keeps its existing behavior. */
function setupOwnedDiffuse(material:OwnedMaterial,builder:DiffuseBuilder,setup:()=>void):void{
  const originalColor=material.colorNode,originalVertexColors=material.vertexColors
  // Upstream accepts every colorNode width; the vec4 overload declarations
  // do not distribute over that native union. The runtime cast is Three's
  // original vec4 conversion, before dropping only its alpha component.
  const rgba=vec4 as unknown as (node:NonNullable<MeshStandardNodeMaterial['colorNode']>|typeof materialColor)=>ReturnType<typeof vec4>
  let rgb=rgba(originalColor??materialColor).rgb
  if(!material.completeProgramColor&&originalVertexColors&&builder.geometry.hasAttribute('color'))
    rgb=rgb.mul(vertexColor().rgb)
  material.colorNode=vec4(rgb,1);material.vertexColors=false
  try{setup()}finally{material.colorNode=originalColor;material.vertexColors=originalVertexColors}
}

class OwnedStandard extends MeshStandardNodeMaterial{
  static get type():string{return'SceneToWebOwnedVertexAlphaStandardV1'}
  #completeProgramColor:boolean
  constructor(completeProgramColor=false){super();this.#completeProgramColor=completeProgramColor}
  get completeProgramColor():boolean{return this.#completeProgramColor}
  override copy(source:MeshStandardNodeMaterial):this{
    const complete=ownedColorFlag(source);super.copy(source)
    if(complete!==undefined)this.#completeProgramColor=complete
    return this
  }
  override setupDiffuseColor(builder:DiffuseBuilder):void{setupOwnedDiffuse(this,builder,()=>super.setupDiffuseColor(builder))}
  override customProgramCacheKey():string{return super.customProgramCacheKey()+':vertex-alpha-owned-v1:color='+Number(this.completeProgramColor)}
}
class OwnedPhysical extends MeshPhysicalNodeMaterial{
  static get type():string{return'SceneToWebOwnedVertexAlphaPhysicalV1'}
  #completeProgramColor:boolean
  constructor(completeProgramColor=false){super();this.#completeProgramColor=completeProgramColor}
  get completeProgramColor():boolean{return this.#completeProgramColor}
  override copy(source:MeshPhysicalNodeMaterial):this{
    const complete=ownedColorFlag(source);super.copy(source)
    if(complete!==undefined)this.#completeProgramColor=complete
    return this
  }
  override setupDiffuseColor(builder:DiffuseBuilder):void{setupOwnedDiffuse(this,builder,()=>super.setupDiffuseColor(builder))}
  override customProgramCacheKey():string{return super.customProgramCacheKey()+':vertex-alpha-owned-v1:color='+Number(this.completeProgramColor)}
}

/** Preserve private ownership only from our actual class instances; a public
 * lookalike property on an ordinary source cannot opt into complete RGB. */
function ownedColorFlag(source:unknown):boolean|undefined{
  return source instanceof OwnedStandard||source instanceof OwnedPhysical?source.completeProgramColor:undefined
}

/** Internal scoped clone construction. Call only after qualified VertexAlpha
 * is found in the actual Alpha channel and that channel built opacityNode. */
export function createOwnedVertexAlphaMaterial(physical:boolean,completeProgramColor:boolean):MeshStandardNodeMaterial{
  return physical?new OwnedPhysical(completeProgramColor):new OwnedStandard(completeProgramColor)
}
