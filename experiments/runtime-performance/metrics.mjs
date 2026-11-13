export function distribution(samples) {
  if (!Array.isArray(samples) || samples.length === 0 || samples.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Timing samples must be a nonempty finite nonnegative array')
  const sorted = [...samples].sort((a,b)=>a-b)
  const percentile = p => sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]
  return {samples:[...samples],count:samples.length,minMs:sorted[0],maxMs:sorted.at(-1),p50Ms:percentile(.5),p95Ms:percentile(.95)}
}
export function resourceSnapshot(renderer) {
  const info=renderer.info, memory={}
  for(const key of ['geometries','textures','programs','renderTargets','attributes','indexAttributes','storageAttributes','indirectStorageAttributes','uniformBuffers','readbackBuffers','texturesSize','programsSize','total']) {
    const value=info?.memory?.[key];memory[key]=Number.isFinite(value)?value:null
  }
  const render={}
  for(const key of ['calls','frameCalls','drawCalls','triangles','points','lines']) {const value=info?.render?.[key];render[key]=Number.isFinite(value)?value:null}
  return {memory,render,autoReset:typeof info?.autoReset==='boolean'?info.autoReset:null}
}
export function programDrawBindings(meshes) {
  const bindings=new Map()
  for(const mesh of meshes){
    const materials=new Set((Array.isArray(mesh.material)?mesh.material:[mesh.material]).filter(material=>material?.isNodeMaterial===true))
    if(materials.size)bindings.set(mesh,materials)
  }
  return bindings
}
export function validateBenchmarkConfig(config) {
  for(const key of ['width','height','warmupFrames','measuredFrames','repeats','gpuSamples']) if(!Number.isInteger(config[key])||config[key]<(key==='gpuSamples'?0:1)) throw new Error('Invalid benchmark '+key)
  if(config.width>4096||config.height>4096||config.measuredFrames>3600||config.warmupFrames>600||config.repeats>10||config.gpuSamples>120)throw new Error('Benchmark exceeds bounded capture limits')
  if(!Number.isFinite(config.dpr)||config.dpr<.5||config.dpr>3||config.width*config.height*config.dpr**2>16_777_216)throw new Error('Invalid benchmark DPR/pixel count')
  if(!['paused','fixed-step'].includes(config.animation)||config.fixedDeltaSeconds!==1/60)throw new Error('Unknown animation policy')
  return config
}
export async function resolveWebglTimer(gl,extension,query,{timeoutMs=2000,now=()=>performance.now(),delay=()=>new Promise(resolve=>setTimeout(resolve,1))}={}) {
  const started=now()
  try {
    while(now()-started<timeoutMs) {
      if(gl.getParameter(extension.GPU_DISJOINT_EXT))return {value:null,reason:'GPU timer was disjoint'}
      if(gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)) {
        const value=Number(gl.getQueryParameter(query,gl.QUERY_RESULT))/1e6
        return Number.isFinite(value)&&value>=0?{value,reason:null}:{value:null,reason:'GPU timer returned invalid duration'}
      }
      await delay()
    }
    return {value:null,reason:'GPU timer query timed out'}
  } finally {gl.deleteQuery(query)}
}
export function captureOwnership(mesh){return {mesh,material:mesh.material,slots:Array.isArray(mesh.material)?[...mesh.material]:null,callback:mesh.onBeforeRender,geometry:mesh.geometry}}
export function ownershipRestored(originals){return originals.every(({mesh,material,slots,callback,geometry})=>mesh.material===material&&mesh.onBeforeRender===callback&&mesh.geometry===geometry&&(!slots||slots.length===mesh.material.length&&slots.every((slot,index)=>mesh.material[index]===slot)))}
