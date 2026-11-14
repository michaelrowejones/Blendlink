// Every discarded-bit pattern in every rounding stratum plus dense independent words.
export function uintCases(){
 const values=new Set([0,1,2,3,0xffffffff,0xfffffffe,0x80000000,0x7fffffff,0xda457153])
 for(let exponent=0;exponent<32;exponent++)for(let delta=-257;delta<=257;delta++){const value=2**exponent+delta;if(value>=0&&value<=0xffffffff)values.add(value>>>0)}
 for(let shift=1;shift<=8;shift++)for(const mantissa of [0x800000,0x800001,0x800002,0xaaaaaa,0xaaaaab,0xfffffd,0xfffffe,0xffffff])for(let rem=0;rem<2**shift;rem++){
  const value=mantissa*2**shift+rem;if(value<=0xffffffff)values.add(value>>>0)
 }
 let seed=0x9e3779b9
 while(values.size<65536){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;values.add(seed>>>0)}
 return [...values].slice(0,65536)
}
