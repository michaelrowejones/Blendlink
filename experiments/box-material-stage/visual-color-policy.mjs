// Diagnostic proposal only. Independent display/coverage criteria do not alter
// raw numeric, input, native-storage, mip, ownership or material-scope gates.
import assert from 'node:assert/strict'
export const policy=Object.freeze({id:'unlit-ldr-standard-srgb-diagnostic-v1',status:'PROPOSAL_NOT_ACCEPTANCE_POLICY',exposure:1,linearRange:[0,1],display:'IEC sRGB OETF, nearest8-bit integer, no tone map/clipping',maximumDisplayCodeDifference:1,outlineChebyshevPixels:1,maximumViewportXorFraction:.005,maximumSourceCoverageXorFraction:.01,foregroundConnectivity:8,holeConnectivity:4,preserveOnePixelEndpoints:true,compareEveryCommonCoveredPixel:true})
export const stricterPolicy=Object.freeze({...policy,id:'unlit-ldr-standard-srgb-target512-diagnostic-v2',maximumViewportXorFraction:.001,maximumSourceCoverageXorFraction:.005,status:'FROZEN_PROPOSAL_REQUIRES_INDEPENDENT_REVIEW_AND_FRESH_CAPTURE'})
// Standard sRGB transfer, specified by W3C/IEC. This is not Blender AgX/Filmic.
// https://www.w3.org/Graphics/Color/srgb
export function displayCode(linear){assert.ok(Number.isFinite(linear)&&linear>=0&&linear<=1,'Outside declared finite LDR0..1 domain; clipping is forbidden');const encoded=linear<=.0031308?12.92*linear:1.055*Math.pow(linear,1/2.4)-.055;return Math.round(encoded*255)}
export function floats(bytes,width,height){assert.equal(bytes.length,width*height*16);const values=new Float64Array(width*height*4);for(let i=0;i<values.length;i++){values[i]=bytes.readFloatLE(i*4);assert.ok(Number.isFinite(values[i]),'Nonfinite input')}return values}
export function coverage(rgba){const mask=new Uint8Array(rgba.length/4);for(let i=0;i<mask.length;i++){const r=rgba[i*4];assert.ok((r===0||r===1)&&rgba[i*4+1]===r&&rgba[i*4+2]===r&&rgba[i*4+3]===1,'Coverage must be independent exact binary RGB with opaque Alpha');mask[i]=r}return mask}
const neighbors=(i,w,h,eight)=>{const x=i%w,y=Math.floor(i/w),result=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&(eight||!dx||!dy)&&x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h)result.push((y+dy)*w+x+dx);return result}
function components(mask,w,h,value,eight){const labels=new Int32Array(mask.length).fill(-1),groups=[];for(let i=0;i<mask.length;i++)if(mask[i]===value&&labels[i]===-1){const id=groups.length,queue=[i];labels[i]=id;let border=false;for(let at=0;at<queue.length;at++){const p=queue[at],x=p%w,y=Math.floor(p/w);border ||= x===0||y===0||x===w-1||y===h-1;for(const q of neighbors(p,w,h,eight))if(mask[q]===value&&labels[q]===-1){labels[q]=id;queue.push(q)}}groups.push({id,area:queue.length,border})}return{labels,groups}}
function correspondence(a,b,include){const aa=a.groups.filter(include),bb=b.groups.filter(include),aSet=new Set(aa.map(x=>x.id)),bSet=new Set(bb.map(x=>x.id)),ab=new Map(aa.map(x=>[x.id,new Set()])),ba=new Map(bb.map(x=>[x.id,new Set()]));for(let i=0;i<a.labels.length;i++)if(aSet.has(a.labels[i])&&bSet.has(b.labels[i])){ab.get(a.labels[i]).add(b.labels[i]);ba.get(b.labels[i]).add(a.labels[i])}return{source:aa.length,actual:bb.length,oneToOne:aa.length===bb.length&&[...ab.values(),...ba.values()].every(set=>set.size===1)}}
const outline=(mask,w,h)=>{const result=new Uint8Array(mask.length);for(let p=0;p<mask.length;p++)if(mask[p]){const x=p%w,y=Math.floor(p/w);if(x===0||y===0||x===w-1||y===h-1||neighbors(p,w,h,true).some(q=>!mask[q]))result[p]=1}return result}
function outsideNeighborhood(a,b,w,h){let violations=0;for(let p=0;p<a.length;p++)if(a[p]&&!b[p]&&!neighbors(p,w,h,true).some(q=>b[q]))violations++;return violations}
export function geometryDiagnostic(source,actual,width,height){
 assert.equal(source.length,width*height);assert.equal(actual.length,source.length)
 const sourceCovered=source.reduce((s,x)=>s+x,0),actualCovered=actual.reduce((s,x)=>s+x,0);let xorPixels=0,commonCovered=0,missingEndpoints=0
 for(let p=0;p<source.length;p++){xorPixels+=source[p]!==actual[p];commonCovered+=source[p]&&actual[p]?1:0;for(const [a,b]of[[source,actual],[actual,source]])if(a[p]&&!b[p]&&neighbors(p,width,height,true).filter(q=>a[q]).length<=1)missingEndpoints++}
 const sOutline=outline(source,width,height),aOutline=outline(actual,width,height),outlineOutsideOnePixel=outsideNeighborhood(sOutline,aOutline,width,height)+outsideNeighborhood(aOutline,sOutline,width,height)
 const foreground=correspondence(components(source,width,height,1,true),components(actual,width,height,1,true),()=>true),holes=correspondence(components(source,width,height,0,false),components(actual,width,height,0,false),g=>!g.border)
 const budget=(viewportFraction,sourceFraction)=>{const viewportPixels=Math.ceil(width*height*viewportFraction),sourcePixels=Math.ceil(sourceCovered*sourceFraction),limit=Math.min(viewportPixels,sourcePixels);return{viewportFraction,sourceFraction,viewportPixels,sourcePixels,limit,marginPixels:limit-xorPixels,withinBudget:xorPixels<=limit}}
 const proposed=budget(.005,.01),stricterDiagnostic=budget(.001,.005)
 return{sourceCovered,actualCovered,commonCovered,xorPixels,xorViewportFraction:xorPixels/source.length,xorSourceFraction:sourceCovered?xorPixels/sourceCovered:null,sourceOutlinePixels:sOutline.reduce((s,x)=>s+x,0),actualOutlinePixels:aOutline.reduce((s,x)=>s+x,0),outlineOutsideOnePixel,foreground,holes,missingEndpoints,proposedBudget:proposed,stricterDiagnosticBudget:stricterDiagnostic,proposalSatisfied:sourceCovered>0&&actualCovered>0&&commonCovered>0&&proposed.withinBudget&&outlineOutsideOnePixel===0&&foreground.oneToOne&&holes.oneToOne&&missingEndpoints===0}
}
export function displayDiagnostic(source,actual,sourceMask,actualMask){
 assert.equal(source.length,actual.length);assert.equal(source.length,sourceMask.length*4);let commonWords=0,backgroundWords=0,excludedCoverageWords=0,differences=0,violations=0,maxCodeDifference=0,sum=0,squared=0,rawMaxAbsCommon=0
 // Validate the full range, including coverage-disagreeing pixels, before any
 // geometric allowance. HDR cannot disappear through a mask or saturation.
 const s=Uint8Array.from(source,displayCode),a=Uint8Array.from(actual,displayCode)
 for(let p=0;p<sourceMask.length;p++){
  assert.equal(source[p*4+3],1);assert.equal(actual[p*4+3],1)
  if(sourceMask[p]!==actualMask[p]){excludedCoverageWords+=3;continue}
  for(let c=0;c<3;c++){const i=p*4+c,error=Math.abs(s[i]-a[i]);if(sourceMask[p])commonWords++;else backgroundWords++;if(error)differences++;if(error>1)violations++;maxCodeDifference=Math.max(maxCodeDifference,error);sum+=error;squared+=error*error;rawMaxAbsCommon=Math.max(rawMaxAbsCommon,Math.abs(source[i]-actual[i]))}
 }
 const words=commonWords+backgroundWords
 return{commonCoveredWords:commonWords,commonBackgroundWords:backgroundWords,coverageDisagreementWords:excludedCoverageWords,comparedWords:words,differences,violations,maxCodeDifference,meanCodeDifference:sum/words,rmsCodeDifference:Math.sqrt(squared/words),rawMaxAbsSameCoverage:rawMaxAbsCommon,proposalSatisfied:commonWords>0&&violations===0}
}
export function visualDiagnostic(source,actual,sourceMask,actualMask,width,height){const geometry=geometryDiagnostic(sourceMask,actualMask,width,height),display=displayDiagnostic(source,actual,sourceMask,actualMask);return{status:'DIAGNOSTIC_ONLY_NO_SUPPORT_OR_ACCEPTANCE_CREDIT',policy:policy.id,proposalSatisfied:geometry.proposalSatisfied&&display.proposalSatisfied,geometry,display}}
export function stricterVisualDiagnostic(source,actual,sourceMask,actualMask,width,height){const result=visualDiagnostic(source,actual,sourceMask,actualMask,width,height);return{...result,policy:stricterPolicy.id,proposalSatisfied:result.proposalSatisfied&&result.geometry.stricterDiagnosticBudget.withinBudget}}
