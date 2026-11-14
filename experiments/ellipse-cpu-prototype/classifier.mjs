/** SPDX-License-Identifier: MIT
 * Research-only host classifier. No SDK/runtime integration or support claim.
 */
export const f = Math.fround;
export function settings(s) {
 if(!['ADD','SUBTRACT','MULTIPLY','NOT'].includes(s.operation))throw Error('operation');
 const valid=n=>typeof n==='number'&&Number.isFinite(n)&&f(n)===n&&!Object.is(n,-0)&&(n===0||Math.abs(n)>=2**-16);
 if(!Array.isArray(s.position)||s.position.length!==2||!s.position.every(n=>valid(n)&&Math.abs(n)<=2))throw Error('position');
 if(!Array.isArray(s.size)||s.size.length!==2||!s.size.every(n=>valid(n)&&n>=0&&n<=2))throw Error('size');
 if(![s.mask,s.value].every(n=>valid(n)&&n>=0&&n<=1))throw Error('scalars');
 return {operation:s.operation,position:[...s.position],size:[...s.size],mask:s.mask,value:s.value};
}
function dimensions(w,h){if(![w,h].every(n=>Number.isInteger(n)&&n>=2&&n<=8192))throw Error('extent');}
export function values(s){return [s.operation==='ADD'?Math.max(s.mask,s.value):s.operation==='SUBTRACT'?Math.min(1,Math.max(0,f(s.mask-s.value))):s.operation==='MULTIPLY'?f(s.mask*s.value):s.mask>0?0:s.value,s.operation==='MULTIPLY'?0:s.mask];}
export function stagedAxes(w,h,s){dimensions(w,h);const aspect=f(h/w),radius=s.size.map(n=>f(n/2));return {x:Float32Array.from({length:w},(_,p)=>f(f(f(p/(w-1))-s.position[0])/radius[0])),y:Float32Array.from({length:h},(_,p)=>f(f(f(f(p/(h-1))-s.position[1])*aspect)/radius[1]))};}
/** Native pinned arm64 worker: separate FMUL, FMUL, FADD, FSQRT. */
export function inside(x,y){return f(Math.sqrt(f(f(x*x)+f(y*y))))<1;}
export function intervals(w,h,input){const s=settings(input);dimensions(w,h);if(s.size.some(n=>n===0))return {identity:true,bounds:new Int32Array(),evaluations:0,precomputedCoordinates:0};
 const{x,y}=stagedAxes(w,h,s);let pivot=0;for(let i=1;i<w;i++)if(Math.abs(x[i])<Math.abs(x[pivot]))pivot=i;
 const bounds=new Int32Array(h*2);let evaluations=0;
 for(let row=0;row<h;row++){
  const test=i=>{evaluations++;return inside(x[i],y[row]);};
  let first=w,last=-1;
  if(test(pivot)){
   let lo=0,hi=pivot;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(test(mid))hi=mid;else lo=mid+1;}first=lo;
   lo=pivot;hi=w-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(test(mid))lo=mid;else hi=mid-1;}last=lo;
  }
  bounds[row*2]=first;bounds[row*2+1]=last;
 }
 return {identity:false,bounds,evaluations,precomputedCoordinates:w+h};
}
export function materialize(w,h,s,result=intervals(w,h,s)){const [a,b]=values(s),out=new Float32Array(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=result.identity?s.mask:(x>=result.bounds[y*2]&&x<=result.bounds[y*2+1]?a:b),i=(y*w+x)*4;out[i]=out[i+1]=out[i+2]=v;out[i+3]=1;}return out;}
