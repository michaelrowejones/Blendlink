/** SPDX-License-Identifier: MIT */
import {f} from './classifier.mjs';
const rows=[];const add=(id,w,h,more={})=>rows.push({id,width:w,height:h,settings:{operation:'ADD',position:[.5,.5],size:[.2,.1].map(f),mask:.25,value:.75,...more}});
for(const operation of ['ADD','SUBTRACT','MULTIPLY','NOT']){
 add('default-'+operation,13,9,{operation});
 for(const size of [[0,.5],[.5,0],[0,0]])add('zero-'+size.join('-')+'-'+operation,5,5,{operation,size});
 for(const n of [.4999999701976776,.5,.5000000596046448])add('boundary-size-'+n+'-'+operation,5,5,{operation,size:[n,n]});
}
for(const[w,h]of [[9,13],[14,10],[13,9],[2,2],[3,3],[4,4],[31,17],[17,31]])add('aspect-'+w+'-'+h,w,h,{size:[1,.75]});
for(const position of [[-.5,.5],[1.25,.25],[-2,2],[.25,-.5],[0,0]])add('offscreen-'+position.join('-'),17,13,{position,size:[1.5,1.25]});
for(const p of [.4999999701976776,.5,.5000000596046448])add('position-next-'+p,17,17,{position:[p,.5],size:[1,1]});
add('normal-minimum',5,5,{size:[2**-16,2**-16],mask:2**-16,value:2**-16,operation:'MULTIPLY'});
add('normal-difference',9,9,{size:[2,2],mask:.5,value:.4999999701976776,operation:'SUBTRACT'});
add('not-zero-mask',7,5,{mask:0,size:[1,1],operation:'NOT'});
let found=0,seed=1001;const rng=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
for(let i=0;i<300000&&found<8;i++){
 const u=f(.5+rng()*.36),v=f(Math.sqrt(1-u*u));const size=[f(1/u),f(1/v)];const x=f(-.5/f(size[0]/2)),y=f(-.5/f(size[1]/2));
 const split=f(f(x*x)+f(y*y)),fused=f(x*x+f(y*y));if((f(Math.sqrt(split))<1)!==(f(Math.sqrt(fused))<1)){add('split-fma-distinction-'+found,3,3,{size});found++;}
}
let randomSeed=71241;const random=()=>{randomSeed=(1664525*randomSeed+1013904223)>>>0;return randomSeed/2**32;};
for(let i=0;i<32;i++)add('seeded-'+i,7+i%12,5+(i*7)%14,{position:[f(random()*2-.5),f(random()*2-.5)],size:[f(.05+random()*1.9),f(.05+random()*1.9)]});
export const cases=rows;
