// One declared origin adapter for all numeric fields. Raw numeric buffers are
// private here; strict, visual and Mapping paths consume the same canonical data.
import assert from'node:assert/strict'
import{lowerLeftRows}from'../box-image-storage-stage/orientation-check.mjs'
import{floats,coverage,stricterVisualDiagnostic}from'./visual-color-policy.mjs'
const numeric=new Set(['mask','mapping','color','alpha']),supportingKinds=new Set(['stock','actual','repeat','poison','unowned-no-color','unowned-color-negative','recovery-missing','recovery-corrupt','recovery-abort','disposed-stock','remount'])
const key=(id,kind,width)=>id+'/'+kind+'/'+width
export async function fieldReadback({backend,rows,readRow}){
 assert.ok(['webgpu','webgl2'].includes(backend));const fields=new Map(),supporting=new Map(),seen=new Set()
 for(const row of rows){const k=key(row.id,row.kind,row.width);assert.ok(!seen.has(k),'Duplicate readback field');seen.add(k);const raw=await readRow(row);assert.equal(raw.length,row.width*row.height*16)
  if(numeric.has(row.kind))fields.set(k,lowerLeftRows(raw,backend,row.width,row.height))
  else{assert.ok(supportingKinds.has(row.kind),'Undeclared supporting row');supporting.set(k,raw)}
 }
 const field=(id,kind,width)=>{assert.ok(numeric.has(kind),'Only canonical numeric fields are exposed here');const bytes=fields.get(key(id,kind,width));assert.ok(bytes,'Missing canonical field '+key(id,kind,width));return bytes}
 const supportingRow=(id,kind,width)=>{assert.ok(supportingKinds.has(kind),'Raw numeric field access is forbidden');const bytes=supporting.get(key(id,kind,width));assert.ok(bytes,'Missing supporting row '+key(id,kind,width));return bytes}
 const observe=(id,width,height,native)=>{
  const sourceMask=coverage(floats(native.mask,width,height)),actualMask=coverage(floats(field(id,'mask',width),width,height)),visual=stricterVisualDiagnostic(floats(native.color,width,height),floats(field(id,'color',width),width,height),sourceMask,actualMask,width,height),sourceMapping=floats(native.mapping,width,height),actualMapping=floats(field(id,'mapping',width),width,height);let words=0,violations=0,maxAbs=0
  for(let p=0;p<sourceMask.length;p++)if(sourceMask[p]&&actualMask[p])for(let c=0;c<3;c++){const error=Math.abs(sourceMapping[p*4+c]-actualMapping[p*4+c]);words++;maxAbs=Math.max(maxAbs,error);if(error>2**-10)violations++}
  return{...visual,mappingSameValidCoverage:{bound:2**-10,words,violations,maxAbs}}
 }
 return Object.freeze({origin:'lower-left',field,supporting:supportingRow,observe})
}
