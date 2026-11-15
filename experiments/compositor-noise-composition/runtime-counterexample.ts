import {it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {validateNoiseFieldGraph} from '../../packages/blendlink/src/tslCompositorNoise.js'
const fail=(message:string):never=>{throw Error(message)}
it('records actual extracted amplification graphs as currently runtime-admitted (zero numerical credit)',()=>{
 for(const label of ['multiply-1024','exposure-plus10']){
  const p=JSON.parse(readFileSync(new URL('../../artifacts/verification-noise-amplification-r2/'+label+'.program.json',import.meta.url),'utf8'))
  expect(p.status).toBe('extracted');expect(()=>validateNoiseFieldGraph(p,fail)).not.toThrow()
 }
})
