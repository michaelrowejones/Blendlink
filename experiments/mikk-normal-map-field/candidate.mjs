// SPDX-License-Identifier: MIT
// Independently written experiment graph from the functional frame equations.
// No Blender shader text is copied; no production normal/guard admission.
import {Matrix3} from 'three'
import {Fn,If,attribute,cross,dot,frontFacing,ivec3,normalize,select,uniform,vec3,vec4} from 'three/tsl'
const safeUnit=Fn(([v])=>{const result=vec3(1,0,0).toVar();If(dot(v,v).greaterThan(1e-35),()=>{result.assign(normalize(v))});return result}).setLayout({name:'stwFrameExperimentSafeUnit',type:'vec3',inputs:[{name:'v',type:'vec3'}]})
export function sourceFrameNodes(frame){
 if(frame.normalStorage!=='SNORM10'||frame.normalMap.displacementLinked||frame.normalMap.base!=='ORIGINAL'||frame.normalMap.space!=='TANGENT'||frame.normalMap.convention!=='OPENGL'||frame.normalMap.strength!==1||frame.basis!=='blender-z-up')throw Error('Outside frozen initial frame experiment')
 const matrix=uniform(new Matrix3().set(...frame.normalMatrix.flat()))
 // Integer storage truncates and erases signed zero before normalized fetch.
 const packed=v=>vec3(ivec3(v.mul(511).clamp(-511,511))).div(511)
 const ni=normalize(matrix.mul(packed(attribute('_stw_frame_n','vec3')))).toVarying()
 const t=safeUnit(matrix.mul(packed(attribute('_stw_frame_t','vec3')))).toVarying()
 const h=attribute('_stw_frame_sign','float').toVarying(),raw=vec4(t,h),face=select(frontFacing,1,-1),base=ni.mul(face),tangent=raw.mul(face)
 const bitangent=cross(base,tangent.xyz).mul(tangent.w).mul(frame.negativeObjectScale?-1:1)
 return{base,tangent,bitangent,raw,normal:safeUnit(ni).mul(face),resolve(color){
  const q=color.mul(2).sub(1),combined=tangent.xyz.mul(q.x).add(bitangent.mul(q.y)).add(base.mul(q.z))
  const sentinel=raw.x.equal(0).and(raw.y.equal(0)).and(raw.z.equal(0)).and(raw.w.equal(1))
  return select(sentinel,base,normalize(combined))
 }}
}
