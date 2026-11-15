import assert from'node:assert/strict'
import test from'node:test'
import {createHash}from'node:crypto'
import {DataTexture,FloatType,RGBAFormat}from'three'
import{observeFinitePayloadCosts}from'./finite-cost.mjs'
const hash=async bytes=>createHash('sha256').update(bytes).digest('hex')
function backend(){const map=new WeakMap();return{isWebGPUBackend:true,has:t=>map.has(t),get:t=>map.get(t),createTexture(t){map.set(t,{texture:{}})},updateTexture(){},createBindings(){},updateBindings(){}}}
test('actual-object observers forward backend work and distinguish CPU payload objects from physical use',async()=>{
 const b=backend(),renderer={backend:b},old=DataTexture.prototype.dispose,original=b.createTexture,cost=observeFinitePayloadCosts(renderer),input=new DataTexture(new Float32Array(24).fill(.25),3,2,RGBAFormat,FloatType)
 b.createTexture(input);b.updateTexture(input);b.createBindings({},[{bindings:[{isSampledTexture:true,texture:input}]}]);assert.equal(cost.canary(input).physicalHandles,1)
 const mark=cost.mark(),payload=new DataTexture(new Float32Array(24).fill(.5),3,2,RGBAFormat,FloatType);payload.dispose()
 const row=await cost.finish(mark,{producer:'float',size:[3,2]},[input],hash);assert.equal(row.cpuObjects,1);assert.equal(row.observedCpuBytes,96);assert.equal(row.gpuCreations,0);assert.equal(row.gpuUploads,0);assert.equal(row.physicalGpuHandles,0);assert.equal(row.sampledTextureBindings,0)
 input.dispose();cost.restore();cost.restore();assert.equal(DataTexture.prototype.dispose,old);assert.equal(b.createTexture,original)
})
test('observer rejects missing methods before interposing and preserves replacement wrappers',()=>{
 const old=DataTexture.prototype.dispose;assert.throws(()=>observeFinitePayloadCosts({backend:{}}),/method missing/);assert.equal(DataTexture.prototype.dispose,old)
 const b=backend(),original=b.createTexture,cost=observeFinitePayloadCosts({backend:b}),wrapped=b.createTexture,later=function(...args){return wrapped.apply(this,args)};b.createTexture=later;cost.restore();assert.equal(b.createTexture,later);b.createTexture=original
})
