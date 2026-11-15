// Native source output is input evidence, never generated from either candidate.
const scratch=new ArrayBuffer(4),f32=new Float32Array(scratch),u32=new Uint32Array(scratch)
const number=w=>{u32[0]=w;return f32[0]},ordered=w=>(w&0x80000000)?0x80000000-(w&0x7fffffff):0x80000000+w
export function checkAccuracy({scenario,phase,words,width,height,rowFlip=false,oracleData}){
 const c=oracleData?.contract,reference=oracleData?.references?.[scenario.kind]
 if(c?.contractId!=='independent-native64-kernel-output-research-v1'||c.maximumAbsoluteError!==2**-20||c.maximumUlps!==8||c.bothRequired!==true||!['rgba','scalar'].includes(scenario.projection)||width<8||height<8||width%8!==0||height%8!==0||words.length!==width*height*4||reference?.words?.length!==256||!String(reference.sha256).match(/^[a-f0-9]{64}$/)||![0,17,43].includes(phase))throw Error('Missing exact declared independent native64 oracle/contract')
 let contractViolations=0,wordDifferences=0,maxUlps=0,maxAbsoluteError=0
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let lane=0;lane<4;lane++){
  const p=(y%8)*8+x%8,index=((rowFlip?height-1-y:y)*width+x)*4+lane
  const expected=scenario.projection==='scalar'?(lane===3?0x3f800000:reference.words[((p+phase)%64)*4+3]):reference.words[((p+phase)%64)*4+lane],actual=words[index],a=number(actual),b=number(expected),abs=Math.abs(a-b),ulps=Math.abs(ordered(actual)-ordered(expected))
  wordDifferences+=actual!==expected?1:0;maxUlps=Math.max(maxUlps,ulps);maxAbsoluteError=Math.max(maxAbsoluteError,abs)
  if(!Number.isFinite(a)||!Number.isFinite(b)||abs>c.maximumAbsoluteError||ulps>c.maximumUlps||scenario.projection==='scalar'&&lane===3&&actual!==0x3f800000)contractViolations++
 }
 return{passed:contractViolations===0,contractId:c.contractId,independentSourceSha256:reference.sha256,comparedWords:words.length,contractViolations,wordDifferences,maxUlps,maxAbsoluteError,projection:scenario.projection,scope:c.scope}
}
