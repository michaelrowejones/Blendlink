// A queue wait/readback wall clock is NEVER a GPU duration.
export function timerCapability(renderer){
 const gl=renderer.backend?.gl
 if(gl){const extension=gl.getExtension('EXT_disjoint_timer_query_webgl2');return{kind:extension?'webgl2-disjoint-timer':'unavailable',extension,reason:extension?null:'EXT_disjoint_timer_query_webgl2 unavailable'}}
 return{kind:'unavailable',reason:renderer.backend?.device?.features?.has('timestamp-query')?'WebGPU timestamp feature present; fresh raw query resolution is not implemented/verified in this bounded harness':'WebGPU timestamp-query unavailable'}
}
export async function webglGpuSample(gl,extension,draw,{timeoutMs=2000,now=()=>performance.now(),delay=()=>new Promise(r=>setTimeout(r,1))}={}){
 if(!extension)return{gpuMs:null,reason:'timer unavailable'}
 const query=gl.createQuery();if(!query)return{gpuMs:null,reason:'query allocation failed'}
 let begun=false
 try{
  if(gl.getParameter(extension.GPU_DISJOINT_EXT))return{gpuMs:null,reason:'disjoint before query'}
  gl.beginQuery(extension.TIME_ELAPSED_EXT,query);begun=true;draw();gl.endQuery(extension.TIME_ELAPSED_EXT);begun=false
  const start=now()
  while(now()-start<timeoutMs){
   if(gl.getParameter(extension.GPU_DISJOINT_EXT))return{gpuMs:null,reason:'disjoint query'}
   if(gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)){const ns=gl.getQueryParameter(query,gl.QUERY_RESULT);return Number.isFinite(ns)&&ns>0?{gpuMs:ns/1e6,reason:null,verified:'actual-available-nondisjoint-query'}:{gpuMs:null,reason:'invalid query duration'}}
   await delay()
  }
  return{gpuMs:null,reason:'query timeout'}
 }finally{if(begun)gl.endQuery(extension.TIME_ELAPSED_EXT);gl.deleteQuery(query)}
}
