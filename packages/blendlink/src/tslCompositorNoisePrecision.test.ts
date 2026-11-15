import{it,expect,vi}from'vitest'
// Evaluate the ACTUAL TSL callback under Float32 scalar operations, then
// compare with the independent primary BLI double-literal expression.
const machine=vi.hoisted(()=>{
 const counts={mul:0,add:0,sub:0,mask:0,bitcast:0,rounds:0}
 const word=(f:number)=>new Uint32Array(new Float32Array([f]).buffer)[0]!,value=(u:number)=>new Float32Array(new Uint32Array([u]).buffer)[0]!
 class Scalar{
  value:number;kind:string
  constructor(value:number,kind='float'){this.value=kind==='float'?Math.fround(value):value;this.kind=kind}
  n(b:any){return b instanceof Scalar?b.value:b}
  mul(b:any){counts.mul++;return new Scalar(this.value*this.n(b))}
  add(b:any){counts.add++;return new Scalar(this.value+this.n(b))}
  sub(b:any){counts.sub++;return new Scalar(this.value-this.n(b))}
  bitAnd(b:any){counts.mask++;return new Scalar((this.value&this.n(b))>>>0,'uint')}
  equal(b:any){return new Scalar(Number(this.value===this.n(b)),'bool')}
  toVar(){return this}
 }
 const fn=(body:any)=>{const call=(...inputs:any[])=>body(inputs);call.setLayout=(_layout:any)=>call;return call}
 return{counts,word,value,Scalar,fn,clear(){for(const k of Object.keys(counts))counts[k as keyof typeof counts]=0}}
})
vi.mock('three/tsl',()=>({Fn:machine.fn,uint:(n:number)=>new machine.Scalar(n,'uint'),select:(c:any,a:any,b:any)=>{machine.counts.rounds++;return c.value?a:b},bitcast:(n:any,type:string)=>{machine.counts.bitcast++;return new machine.Scalar(type==='uint'?machine.word(n.value):machine.value(n.value),type)}}))
import{compositorCpuBliPerlinFade}from'./tslCompositorNoisePrecision.js'
const native=(t:number)=>{const q=Math.fround(Math.fround(t*t)*t);return Math.fround(q*(t*(t*6-15)+10))}
const actual=(t:number)=>(compositorCpuBliPerlinFade as any)(new machine.Scalar(t)).value as number
it('matches independent BLI double-literal fade words over a dense Float32 grid and endpoints',()=>{
 for(let i=0;i<=65536;i++){const t=Math.fround(i/65536);expect(machine.word(actual(t))).toBe(machine.word(native(t)))}
 for(const bits of[0,1,0x00800000,0x33800000,0x3c810204,0x3d418306,0x3e71e3c8,0x3effffff,0x3f000001,0x3f7fffff,0x3f800000]){const t=machine.value(bits);expect(machine.word(actual(t))).toBe(machine.word(native(t)))}
})
it('keeps a bounded residual construction with explicit staging and mantissa split costs',()=>{
 machine.clear();actual(.375);expect(machine.counts.mul).toBe(17);expect(machine.counts.add+machine.counts.sub).toBe(25);expect(machine.counts.mask).toBe(4);expect(machine.counts.rounds).toBe(42);expect(machine.counts.bitcast).toBe(92)
})
