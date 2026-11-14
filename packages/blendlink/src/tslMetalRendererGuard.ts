/* SPDX-License-Identifier: MIT */
/** Actual draw-time adapter admission for the measured Apple M5 Pro WebGL2 Metal math profile. */
type RuntimeObject = Record<string, any>
const message='Radial Tiling Segment Coordinates requires an actual WebGL2 ANGLE Apple M5 Pro Metal renderer; software and unknown adapters are unqualified'
const object=(value:unknown):value is RuntimeObject=>!!value&&typeof value==='object'
export function assertRadialMetalRenderer(value:unknown):void{
 if(!object(value)||value.isRenderer!==true||!object(value.backend))throw new Error(message)
 const backend=value.backend,constructors=globalThis as unknown as RuntimeObject
 if(backend.isWebGPUBackend===true)throw new Error(message+'; WebGPU device identity is privacy-redacted and cannot verify the measured M5 Pro profile')
 if(backend.isWebGLBackend===true){
  const gl=backend.gl
  if(typeof constructors.WebGL2RenderingContext!=='function'||!(gl instanceof constructors.WebGL2RenderingContext)||gl.isContextLost())throw new Error(message)
  const debug=gl.getExtension('WEBGL_debug_renderer_info')
  if(!debug)throw new Error(message)
  const vendor=gl.getParameter(debug.UNMASKED_VENDOR_WEBGL),renderer=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
  if(vendor!=='Google Inc. (Apple)'||typeof renderer!=='string'||renderer!=='ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)'||/swiftshader|software|llvmpipe/i.test(renderer))throw new Error(message)
  return
 }
 throw new Error(message)
}
/** Materialize the result so constant-join optimization cannot remove its draw hook; no floating arithmetic is added. */
export function guardRadialMetalNode<T extends {toVar:()=>T;onRenderUpdate:(callback:(frame:RuntimeObject)=>void)=>unknown}>(node:T):T{
 const guarded=node.toVar()
 guarded.onRenderUpdate(frame=>assertRadialMetalRenderer(frame.renderer))
 return guarded
}
