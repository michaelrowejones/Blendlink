// Test-owned COLOR0 control only; no SDK/Three prototype or cache changes.
import {Float32BufferAttribute} from 'three'
const assert=(ok,message)=>{if(!ok)throw Error(message)}
const arrayOf=attribute=>attribute.isInterleavedBufferAttribute?attribute.data.array:attribute.array
const bytes=array=>new Uint8Array(array.buffer,array.byteOffset,array.byteLength)
function equalBytes(a,b){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true}
export function poisonGeometryPair(source){
 const records=Object.entries(source.attributes).map(([name,attribute])=>({name,attribute,array:arrayOf(attribute),snapshot:bytes(arrayOf(attribute)).slice()})),index=source.index,indexBytes=index?bytes(index.array).slice():null
 const positive=source.clone(),negative=source.clone(),poison=new Float32Array(source.getAttribute('position').count*4)
 for(let i=0;i<poison.length;i+=4)poison.set([.125,.25,.5,.125],i)
 // The generic negative receives a distinct geometry and distinct COLOR0. Its
 // first draw consumes COLOR0. Three0.184's geometry-dispose callback captures
 // only the first RenderObject's active attributes; a later shader activating
 // COLOR0 on the positive geometry otherwise leaves that test-owned buffer.
 for(const owned of[positive,negative]){
  assert(owned!==source&&owned!==undefined,'Control geometry ownership missing')
  for(const record of records){const attribute=owned.getAttribute(record.name);assert(attribute!==record.attribute&&arrayOf(attribute)!==record.array&&equalBytes(bytes(arrayOf(attribute)),record.snapshot),'Control changed source attribute bytes/ownership: '+record.name)}
  assert(owned.index!==source.index||source.index===null,'Control shares source index')
  if(indexBytes)assert(equalBytes(bytes(owned.index.array),indexBytes),'Control changed index bytes')
  owned.setAttribute('color',new Float32BufferAttribute(poison.slice(),4))
 }
 assert(positive!==negative&&positive.getAttribute('color')!==negative.getAttribute('color'),'Independent negative ownership missing')
 const assertSourceUnchanged=()=>{
  assert(source.index===index&&(!indexBytes||equalBytes(bytes(index.array),indexBytes)),'Caller index changed')
  assert(Object.keys(source.attributes).length===records.length,'Caller attribute census changed')
  for(const record of records)assert(source.getAttribute(record.name)===record.attribute&&arrayOf(record.attribute)===record.array&&equalBytes(bytes(record.array),record.snapshot),'Caller attribute changed: '+record.name)
 }
 assertSourceUnchanged();return{positive,negative,assertSourceUnchanged}
}
