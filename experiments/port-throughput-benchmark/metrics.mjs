const assert={ok(v,m='assertion failed'){if(!v)throw Error(m)},equal(a,b,m='equality failed'){if(a!==b)throw Error(m)},deepEqual(a,b,m='structural equality failed'){const key=v=>Array.isArray(v)?v.map(key):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,key(v[k])])):v;if(JSON.stringify(key(a))!==JSON.stringify(key(b)))throw Error(m)},match(v,r,m='pattern failed'){if(typeof v!=='string'||!r.test(v))throw Error(m)}}
export const modes=['hand-tsl','native-generated']
export function validatePlan(p){
 assert.equal(p.schemaVersion,1);assert.deepEqual(p.modes,modes);assert.equal(p.supportCredit,0);assert.equal(p.nativeParityCredit,0)
 for(const key of['warmupFramesDiscardedPerBlock','framesPerSubmissionBatch','repetitions','gpuQueriesPerBlock','drawsPerGpuQuery','maximumWorkloadsPerLease','maximumLeaseMs','minimumVerifiedGpuSamplesPerMode'])assert.ok(Number.isSafeInteger(p[key])&&p[key]>0,key)
 assert.ok(p.repetitions>=3&&p.repetitions<=5);assert.equal(p.minimumVerifiedGpuSamplesPerMode,p.repetitions*p.gpuQueriesPerBlock);assert.ok(p.maximumLeaseMs<=120000);assert.ok(p.maximumWorkloadsPerLease<=8);assert.equal(p.performancePolicy.submissionOnlyWinnerAllowed,false)
 assert.deepEqual(p.renderTarget,{format:'RGBA',type:'Float32',samples:0,depthBuffer:false,colorSpace:'none'});return p
}
export function workloads(plan,selectedKinds,{shapes=plan.shapes,projection='rgba'}={}){
 assert.ok(Array.isArray(shapes)&&shapes.length>0&&new Set(shapes).size===shapes.length);for(const shape of shapes)assert.ok(plan.shapes.includes(shape),'Undeclared graph shape')
 assert.ok(Array.isArray(selectedKinds)&&selectedKinds.length>0&&new Set(selectedKinds).size===selectedKinds.length)
 for(const kind of selectedKinds)assert.ok(plan.availableKinds.includes(kind),'Undeclared kind')
 assert.ok(plan.projections.includes(projection),'Undeclared output projection')
 const rows=selectedKinds.flatMap(kind=>{const shape=plan.composedKinds.includes(kind)?'adapter-composed':'single';return shapes.includes(shape)?plan.extents.map(([width,height])=>({id:kind+'/'+shape+'/'+projection+'/'+width+'x'+height,kind,shape,projection,width,height})):[]})
 assert.ok(rows.length>0,'No selected lawful workloads')
 assert.ok(rows.length<=plan.maximumWorkloadsPerLease,'Select fewer kinds per bounded lease');return rows
}
export function pairedOrder(workloadIndex,repetition){return(workloadIndex+repetition)%2?modes.slice().reverse():modes.slice()}
export function distribution(values){
 assert.ok(Array.isArray(values)&&values.length>0);assert.ok(values.every(v=>Number.isFinite(v)&&v>=0),'Finite nonnegative timings required')
 const sorted=values.slice().sort((a,b)=>a-b),n=values.length,mean=values.reduce((s,x)=>s+x,0)/n,q=p=>sorted[Math.min(n-1,Math.ceil(p*n)-1)]
 return{n,minimum:sorted[0],p50:q(.5),p90:q(.9),p95:q(.95),maximum:sorted[n-1],mean,standardDeviation:Math.sqrt(values.reduce((s,x)=>s+(x-mean)**2,0)/n)}
}
export function performanceDecision({profile,accuracyPassed,handGpu,nativeGpu,plan}){
 if(!accuracyPassed)return{status:'accuracy-failed-no-comparison'}
 if(profile!=='metal')return{status:'correctness-only-profile'}
 if(handGpu.length<plan.minimumVerifiedGpuSamplesPerMode||nativeGpu.length!==handGpu.length)return{status:'insufficient-verified-gpu-timing',gpu:null}
 if([...handGpu,...nativeGpu].some(x=>!Number.isFinite(x)||x<=0))return{status:'invalid-gpu-timing',gpu:null}
 const ratio=distribution(nativeGpu.map((x,i)=>x/handGpu[i])),p=plan.performancePolicy
 return{status:ratio.p50>p.regressionMedianRatioAbove&&ratio.p95>p.regressionP95RatioAbove?'bounded-regression-signal':ratio.p50<p.improvementMedianRatioBelow&&ratio.p95<p.improvementP95RatioBelow?'bounded-improvement-signal':'no-threshold-signal',pairedGpuRatio:ratio}
}
export function assertComparable(a,b){
 for(const key of['kind','parameterContract','outputContract','resourceSignature'])assert.deepEqual(a[key],b[key],'Incomparable adapter '+key)
 assert.ok(typeof a.outputContract==='string'&&a.outputContract);assert.ok(a.kernelSourceSha256&&b.kernelSourceSha256);return true
}
export function assertAccuracyRecord(record){
 assert.equal(record?.passed,true,'Independent accuracy failed');assert.ok(typeof record.contractId==='string'&&record.contractId);assert.match(record.independentSourceSha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(record.comparedWords)&&record.comparedWords>0);assert.equal(record.contractViolations,0);return record
}
export function normalizeWords(words,width,height,rowFlip){assert.equal(typeof rowFlip,'boolean');assert.equal(words.length,width*height*4);return rowFlip?Array.from({length:words.length},(_,i)=>words[((height-1-Math.floor(i/(width*4)))*width*4)+(i%(width*4))]):Array.from(words)}
export function verifyNative64Words(words,sourceWords,phase,rowFlip){
 assert.equal(sourceWords.length,256);assert.ok(Number.isInteger(phase)&&phase>=0&&phase<64);const actual=normalizeWords(words,8,8,rowFlip)
 for(let p=0;p<64;p++)for(let c=0;c<4;c++)assert.equal(actual[p*4+c],sourceWords[((p+phase)%64)*4+c],'Exact native64 input transport')
 return{comparedWords:256,exactDifferences:0}
}
export function classifyNative64Words(words,sourceWords,phase){for(const rowFlip of[false,true]){try{verifyNative64Words(words,sourceWords,phase,rowFlip);return{rowFlip,comparedWords:256,exactDifferences:0}}catch{}}throw Error('Native64 exact input/phase calibration failed')}
