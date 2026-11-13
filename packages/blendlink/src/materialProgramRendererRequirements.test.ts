import { describe, expect, it } from 'vitest'
import { validateNodeRendererRequirement } from './materialProgramRendererRequirements.js'
const magic={op:'tex_magic_native',model:'eevee-magic-f32-v1'}
const squeeze={op:'squeeze_native',model:'eevee-squeeze-f32-v1'}
const marker=(programs:unknown=[magic])=>({schemaVersion:1,model:'live-material-programs-v1',programs})
const channel=(output:unknown)=>({Roughness:{tslIr:{output}}})
describe('actual material program renderer declarations',()=>{
 it('matches exact op/model pairs in every channel and preserves the old Squeeze declaration',()=>{
  expect(validateNodeRendererRequirement(channel(magic),marker()).required).toEqual([magic])
  expect(validateNodeRendererRequirement(channel(squeeze),{schemaVersion:1,model:'squeeze-native-v1'}).issue).toBeUndefined()
  expect(validateNodeRendererRequirement(channel(magic),{schemaVersion:1,model:'squeeze-native-v1'}).issue).toMatch(/Magic Texture requires/)
  expect(validateNodeRendererRequirement(channel(squeeze),undefined).issue).toMatch(/Squeeze Value requires/)
  expect(validateNodeRendererRequirement(channel({...magic,model:'different'}),marker()).issue).toMatch(/declaration model/)
  expect(validateNodeRendererRequirement(channel({op:'const_float',value:.5}),marker()).required).toEqual([])
 })
 it('supports a declared future family without granting an unimplemented opcode a build exemption',()=>{
  const future={op:'future_native',model:'test-only-v1'}
  expect(validateNodeRendererRequirement(channel(future),marker([future])).required).toEqual([future])
  expect(validateNodeRendererRequirement(channel({...future,model:'other'}),marker([future])).issue).toMatch(/declaration model/)
 })
 it('fails closed for malformed or unknown declarations, including sparse and duplicate selector arrays',()=>{
  for(const declaration of [null,false,{}, {...marker(),schemaVersion:2},{...marker(),model:'future'},
   marker([]),marker(null),marker(new Array(1)),marker([magic,magic]),marker([null]),marker([{op:magic.op}]),
   marker([{...magic,extra:'unknown'}]),{...marker(),extra:'unknown'},marker([{op:1,model:magic.model}]),
  ])expect(validateNodeRendererRequirement(channel(magic),declaration).issue).toMatch(/unsupported or malformed/)
 })
})
