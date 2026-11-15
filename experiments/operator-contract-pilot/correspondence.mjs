// Explicit per-family semantic hooks into UNCHANGED existing policy.
// Shared transport does not generate these rules from structural schemas.
let imports=Promise.resolve()
const cache=new Map()
export function existingPolicy(family){
 if(cache.has(family))return cache.get(family)
 const task=imports.then(async()=>{
  const previous=process.env.SCENETOWEB_SWITCH_VARIANT
  try{process.env.SCENETOWEB_SWITCH_VARIANT=family;const p=await import('../static-switch-family/protocol.mjs?operator-contract-pilot='+family);return family==='integer-vector3'?p.assertIntegerVectorProgram:p.assertFiniteImageInfoProgram}
  finally{if(previous===undefined)delete process.env.SCENETOWEB_SWITCH_VARIANT;else process.env.SCENETOWEB_SWITCH_VARIANT=previous}
 });imports=task.then(()=>undefined);cache.set(family,task);return task
}
