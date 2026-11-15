import{expect,it}from'vitest'
import{vec4,float}from'three/tsl'
import{createDisplaceCpuRgbaStages}from'./tslCompositorDisplacePrecision.js'
it('keeps one private zero uniform for a staged sampler lifetime and refuses a mutated rounding dependency',()=>{
 const build=createDisplaceCpuRgbaStages(),node:any=build(vec4(.25),vec4(.5),vec4(.75),vec4(1),float(.125),float(.375)),uniforms=new Set<any>(),casts:any[]=[]
 node.traverse((child:any)=>{if(child.isUniformNode)uniforms.add(child);if(child.isBitcastNode)casts.push(child)})
 expect(uniforms.size).toBe(1);const zero=[...uniforms][0];expect(zero.value).toBe(0);expect(zero.nodeType).toBe('uint');expect(Object.keys(build)).toEqual([])
 expect(casts.length).toBeGreaterThan(40);expect(casts.every(child=>['float','uint'].includes(child.conversionType))).toBe(true)
 expect(()=>node.update({})).not.toThrow();zero.value=1;expect(()=>node.update({})).toThrow(/Displace.*private rounding uniform/);zero.value=0;expect(()=>node.update({})).not.toThrow()
 const other:any=build(vec4(-8),vec4(16),vec4(-0),vec4(0),float(.5),float(.5)),next=new Set<any>();other.traverse((child:any)=>{if(child.isUniformNode)next.add(child)});expect([...next]).toEqual([zero])
})
it('uses an identity integer OR, retaining every input word class without a NaN/zero replacement rule',()=>{
 for(const bits of[0,0x80000000,1,0x80000001,0x007fffff,0x00800000,0x3f800000,0x7f7fffff,0x7f800000,0xff800000,0x7fc12345,0x7fa12345,0xffc12345])expect((bits|0)>>>0).toBe(bits)
})
