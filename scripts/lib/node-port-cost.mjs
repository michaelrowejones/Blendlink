/** Structural graph facts only. This is not a shader compiler or timing model. */
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'

export const NODE_PORT_COST_MODEL='material-ir-structure-v1'
export const NODE_PORT_COST_METRICS=Object.freeze([
 'programs','expressionOccurrences','maximumExpressionDepth','literalExpressions',
 'imageExpressionOccurrences','externalImageExpressionOccurrences','embeddedPixelElements',
 'tableExpressionOccurrences','opaqueTableElements','declaredFloat32PayloadBytes',
 'externalImageDeclarations','declaredExternalImageBytes'
])
export const NODE_PORT_COST_BOUNDS=Object.freeze({inputBytes:64*1024*1024,containers:100000,scalars:1000000,depth:256,programs:4096,materials:4096,imageDeclarations:4096,pixelDigestElements:262144})
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)
const own=(value,key)=>Object.hasOwn(value,key)
const integer=(value,label)=>{assert.ok(Number.isSafeInteger(value)&&value>=0,label+' must be a nonnegative safe integer');return value}
const leaf=value=>typeof value==='number'?(Object.is(value,-0)?'number:-0':'number:'+value):JSON.stringify(value)
const TABLES=new Set(['curve_native','curve_rgb','ramp_lut'])
const DECLARATIONS=new Set(['sourceEngine','sourceProfile','nativeGpuBackend','perlinModel','model','sourceModel','evaluation_device','single_value_device'])

export function validateNodePortCostLimits(value){
 assert.ok(plain(value)&&value.schemaVersion===1&&value.model==='node-port-structural-limits-v1','Unknown structural limits contract')
 assert.deepEqual(Object.keys(value).sort(),['maximum','model','schemaVersion'])
 assert.ok(plain(value.maximum)&&Object.keys(value.maximum).length>0,'Structural limits need at least one maximum')
 for(const[key,limit]of Object.entries(value.maximum)){assert.ok(NODE_PORT_COST_METRICS.includes(key),'Unknown structural metric '+key);integer(limit,key)}
 return value
}

function documents(input){
 assert.ok(plain(input),'Input must be a material IR or material-program document')
 if(input.schemaVersion===1&&input.model==='blendlink-tsl-ir-v1'){
  assert.ok(plain(input.output)&&typeof input.output.op==='string','Material IR requires an expression output')
  return[{scope:'ir',ir:input}]
 }
 assert.ok(input.schemaVersion===1&&input.model==='blendlink-material-programs-v1'&&plain(input.materials),'Unknown material-program document')
 const result=[]
 assert.ok(Object.keys(input.materials).length<=NODE_PORT_COST_BOUNDS.materials,'Material record count exceeds analysis work bound')
 for(const[name,material]of Object.entries(input.materials)){
  assert.ok(plain(material)&&plain(material.channels),'Material channels must be a record')
  assert.ok(Object.keys(material.channels).length<=NODE_PORT_COST_BOUNDS.programs,'Channel count exceeds analysis work bound')
  for(const[channel,value]of Object.entries(material.channels)){
   assert.ok(plain(value)&&plain(value.tslIr),'Actual material channels require .tslIr')
   const ir=value.tslIr
   assert.ok(ir.schemaVersion===1&&ir.model==='blendlink-tsl-ir-v1'&&plain(ir.output)&&typeof ir.output.op==='string','Unsupported channel IR')
   result.push({scope:JSON.stringify([name,channel]),ir})
   assert.ok(result.length<=NODE_PORT_COST_BOUNDS.programs,'Material program count exceeds analysis work bound')
  }
 }
 return result
}

/** Object API has no input attestation. Use analyzeNodePortCostBytes for pinned receipts. */
export function inspectNodePortCost(input,{limits=null,profile=null,pixelDigestElements=0}={}){
 if(limits)validateNodePortCostLimits(limits)
 integer(pixelDigestElements,'Pixel digest budget');assert.ok(pixelDigestElements<=NODE_PORT_COST_BOUNDS.pixelDigestElements,'Pixel digest budget exceeds bounded work')
 assert.ok(profile===null||typeof profile==='string','Profile is an optional declared label, never observed identity')
 const programs=documents(input),metrics=Object.fromEntries(NODE_PORT_COST_METRICS.map(name=>[name,0]))
 metrics.programs=programs.length
 const operations=Object.create(null),declarations=Object.create(null),duplicates=new Map(),opaque=[],ancestors=new WeakSet()
 let containers=0,scalars=0,inspectedPixelElements=0
 const imageDigests=new Map(),unverifiedImages=[]
 const add=(metric,amount=1)=>{metrics[metric]+=amount;assert.ok(Number.isSafeInteger(metrics[metric]),'Structural metric overflow: '+metric)}
 const walk=(value,path,depth,expressionDepth,scope)=>{
  assert.ok(depth<=NODE_PORT_COST_BOUNDS.depth,'Graph nesting exceeds analysis work bound')
  if(value===null||typeof value!=='object'){
   assert.ok(++scalars<=NODE_PORT_COST_BOUNDS.scalars,'Scalar inspection exceeds analysis work bound')
   assert.ok(value===null||['string','boolean','number'].includes(typeof value),'Graph contains non-JSON data')
   assert.ok(typeof value!=='number'||Number.isFinite(value),'Graph contains a nonfinite number outside opaque payloads')
   return{digest:hash(leaf(value)),expressions:0}
  }
  assert.ok(++containers<=NODE_PORT_COST_BOUNDS.containers,'Graph expansion exceeds analysis work bound')
  assert.ok(!ancestors.has(value),'Graph contains a cycle');ancestors.add(value)
  try{
   if(Array.isArray(value)){
    assert.ok(value.length<=NODE_PORT_COST_BOUNDS.scalars-scalars,'Array exceeds analysis work bound')
    const entries=[];let expressions=0,complete=true
    for(let index=0;index<value.length;index++){
     assert.ok(own(value,index),'Graph contains a sparse non-payload array')
     const item=Object.getOwnPropertyDescriptor(value,String(index));assert.ok(item&&'value' in item,'Graph contains an array accessor')
     const child=walk(item.value,path+'/'+index,depth+1,expressionDepth,scope)
     entries.push(child.digest);expressions+=child.expressions;complete&&=child.digest!==null
    }
    return{digest:complete?hash(JSON.stringify(['array',entries])):null,expressions}
   }
   assert.ok(plain(value),'Graph contains a non-JSON object')
   const keys=Object.keys(value).sort(),descriptors=Object.getOwnPropertyDescriptors(value)
   assert.ok(keys.length<=NODE_PORT_COST_BOUNDS.scalars-scalars,'Object exceeds analysis work bound')
   for(const key of keys)assert.ok('value' in descriptors[key],'Graph contains an accessor')
   const isExpression=own(value,'op'),op=isExpression?descriptors.op.value:null
   if(isExpression){
    assert.ok(typeof op==='string'&&op.length>0&&op.length<=128,'Expression op must be a nonempty bounded string')
    add('expressionOccurrences');operations[op]=(operations[op]??0)+1;expressionDepth++
    metrics.maximumExpressionDepth=Math.max(metrics.maximumExpressionDepth,expressionDepth)
    if(op==='const_float'){assert.ok(typeof value.value==='number'&&Number.isFinite(value.value),'const_float needs a finite number');add('literalExpressions')}
    if(op==='const_vec3'){
     assert.ok(Array.isArray(value.value)&&value.value.length===3,'const_vec3 needs three finite numbers')
     const lanes=Object.getOwnPropertyDescriptors(value.value)
     assert.ok([0,1,2].every(index=>lanes[index]&&'value' in lanes[index]&&typeof lanes[index].value==='number'&&Number.isFinite(lanes[index].value)),'const_vec3 needs three finite numbers');add('literalExpressions')
    }
    if(op==='tex_image'){assert.ok(own(value,'pixels'),'Embedded image has no declared payload');add('imageExpressionOccurrences')}
    if(TABLES.has(op))assert.ok(own(value,'values'),'Table expression has no declared payload')
    if(op==='texture_ref'){add('imageExpressionOccurrences');add('externalImageExpressionOccurrences')}
    for(const key of DECLARATIONS)if(own(value,key)){
     const declared=value[key];assert.ok(typeof declared==='string','Source stage/model declarations must be strings')
     const label=JSON.stringify([key,declared]);declarations[label]=(declarations[label]??0)+1
    }
   }
   const parts=[];let expressions=isExpression?1:0,complete=true
   for(const key of keys){
    const childValue=descriptors[key].value
    if(isExpression&&(op==='tex_image'&&key==='pixels'||TABLES.has(op)&&key==='values')){
     assert.ok(Array.isArray(childValue),'Opaque image/table payload must be an array')
     const length=integer(childValue.length,'Opaque payload length');let elementValuesValidated=false
     if(op==='tex_image'){
      const width=integer(value.width,'Image width'),height=integer(value.height,'Image height')
      assert.ok(width>0&&height>0&&Number.isSafeInteger(width*height*4)&&length===width*height*4,'Image dimensions do not match declared RGBA payload')
      add('embeddedPixelElements',length)
      if(pixelDigestElements===0||length>pixelDigestElements-inspectedPixelElements){
       unverifiedImages.push({path:path+'/'+key,elements:length,reason:pixelDigestElements===0?'not-requested':'element-budget'})
      }else{
       const bytes=Buffer.alloc(length*4)
       for(let index=0;index<length;index++){
        const element=Object.getOwnPropertyDescriptor(childValue,String(index)),number=element?.value
        assert.ok(element&&'value' in element&&typeof number==='number'&&Number.isFinite(number)&&Math.fround(number)===number,'Pixel digest requires finite exact Float32 elements')
        bytes.writeFloatLE(number,index*4)
       }
       inspectedPixelElements+=length;elementValuesValidated=true
       const digest=createHash('sha256').update(JSON.stringify([width,height])).update(bytes).digest('hex')
       const previous=imageDigests.get(digest)
       if(previous){previous.occurrences++;previous.scopes.add(scope)}
       else imageDigests.set(digest,{digest,width,height,logicalBytes:length*4,occurrences:1,scopes:new Set([scope])})
      }
     }else{add('tableExpressionOccurrences');add('opaqueTableElements',length)}
     assert.ok(Number.isSafeInteger(length*4),'Declared Float32 payload overflows')
     add('declaredFloat32PayloadBytes',length*4)
     opaque.push({path:path+'/'+key,op,elements:length,elementValuesValidated})
     complete=false;continue
    }
    const child=walk(childValue,path+'/'+key,depth+1,expressionDepth,scope)
    parts.push([key,child.digest]);expressions+=child.expressions;complete&&=child.digest!==null
   }
   const digest=complete?hash(JSON.stringify(['object',parts])):null
   if(isExpression&&digest){
    const previous=duplicates.get(digest)
    if(previous){previous.occurrences++;previous.scopes.add(scope)}
    else duplicates.set(digest,{digest,op,expressionsPerOccurrence:expressions,occurrences:1,scopes:new Set([scope])})
   }
   return{digest,expressions}
  }finally{ancestors.delete(value)}
 }
 for(const program of programs)walk(program.ir.output,'/'+program.scope,0,0,program.scope)
 if(input.model==='blendlink-material-programs-v1'&&own(input,'images')){
  assert.ok(plain(input.images),'External image metadata must be a record')
  assert.ok(Object.keys(input.images).length<=NODE_PORT_COST_BOUNDS.imageDeclarations,'External image count exceeds analysis work bound')
  for(const image of Object.values(input.images)){
   assert.ok(plain(image),'External image metadata must be an object');add('externalImageDeclarations')
   add('declaredExternalImageBytes',integer(image.bytes,'Declared external image bytes'))
  }
 }
 const repeated=[...duplicates.values()].filter(item=>item.occurrences>1).map(item=>({...item,scopes:[...item.scopes].sort()})).sort((a,b)=>a.digest.localeCompare(b.digest))
 const imageGroups=[...imageDigests.values()].map(item=>({...item,scopes:[...item.scopes].sort()})).sort((a,b)=>a.digest.localeCompare(b.digest))
 const violations=limits?Object.entries(limits.maximum).filter(([name,maximum])=>metrics[name]>maximum).map(([metric,maximum])=>({metric,maximum,actual:metrics[metric]})):[]
 return{schemaVersion:1,kind:'blendlink-node-port-static-cost-v1',model:NODE_PORT_COST_MODEL,
  status:violations.length?'structural-budget-exceeded':'analyzed',productionCases:0,performanceQualified:false,
  input:{source:'object-only',bytes:null,sha256:null},profile:{label:profile,observed:false},metrics,
  operations:Object.fromEntries(Object.entries(operations).sort()),sourceDeclarations:Object.fromEntries(Object.entries(declarations).sort()),
  repeatedSubtrees:{candidates:repeated,claim:'Structural equality only; purity, runtime sharing, GPU CSE and savings are not established. Payload-containing subtrees are excluded.'},
  embeddedImagePayloads:{mode:pixelDigestElements?'bounded-exact-f32-digest-v1':'counts-only',elementBudget:pixelDigestElements,
   inspectedElements:inspectedPixelElements,coverageComplete:unverifiedImages.length===0,
   occurrenceLogicalBytes:metrics.embeddedPixelElements*4,
   confirmedUniqueLogicalBytes:imageGroups.reduce((sum,item)=>sum+item.logicalBytes,0),
   confirmedRepeatedLogicalBytes:imageGroups.reduce((sum,item)=>sum+(item.occurrences-1)*item.logicalBytes,0),
   groups:imageGroups,unverified:unverifiedImages,
   claim:'Only inspected numeric payload bytes/layout are compared. These are not unique source-file storage, runtime texture allocations, GPU residency or predicted savings.'},
  opaquePayloads:opaque,work:{containers,scalars,bounds:NODE_PORT_COST_BOUNDS},
  structuralGate:{status:limits?(violations.length?'exceeded':'within-structural-limits'):'not-configured',limits:limits?structuredClone(limits):null,violations},
  runtimeCost:{instructions:null,physicalTextureSamples:null,renderPasses:null,gpuMemoryBytes:null,timings:null,
   loweringNotEstimated:Object.keys(operations).sort(),semanticValidation:false,
   note:'IR occurrences and declared payload bytes are not compiled instructions, actual allocations or timings. Opaque values and external asset pins are not validated.'}}
}

export function analyzeNodePortCostBytes(bytes,options={}){
 assert.ok(bytes instanceof Uint8Array,'Analyze pinned UTF-8 JSON bytes')
 assert.ok(bytes.byteLength<=NODE_PORT_COST_BOUNDS.inputBytes,'Input exceeds bounded static analysis size')
 const document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
 const report=inspectNodePortCost(document,options)
 report.input={source:'json-bytes',bytes:bytes.byteLength,sha256:hash(bytes)}
 return report
}
