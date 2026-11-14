import {expect,it} from 'vitest'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {buildSourceCompositor} from './tslSourceCompositor.js'
import {BLACKBODY_MODEL,BLACKBODY_PROFILE,blackbodyTermScales,blackbodyErrorBounds} from './tslCompositorBlackbody.js'
import {BLACKBODY_R,BLACKBODY_G,BLACKBODY_B,BLACKBODY_TABLE_SHA256,BLACKBODY_OCIO_SHA256} from './tslBlackbodyCoefficients.js'
const specs=JSON.parse(readFileSync(new URL('../../../experiments/compositor-blackbody/cases.json',import.meta.url),'utf8')).filter((row:any)=>row.kind==='blackbody')
const source=(temperature=6500)=>({id:'blackbody',kind:'blackbody-color',type:'RGBA',source:{path:[],node:'Artist Blackbody',nodeType:'ShaderNodeBlackbody',output:'Color'},inputs:{Temperature:{name:'Temperature',socketType:'VALUE',value:{kind:'constant',type:'VALUE',value:temperature}}},properties:{blackbody_model:BLACKBODY_MODEL,blackbody_profile:BLACKBODY_PROFILE,blackbody_version:[5,3,0],blackbody_build:'02f0899d78e3',blackbody_evaluator:'CPU-MF',blackbody_working_space:'lin_rec709_scene',blackbody_color_transform:'native-rec709-bypass-53-v1',blackbody_ocio_sha256:BLACKBODY_OCIO_SHA256,blackbody_table_sha256:BLACKBODY_TABLE_SHA256,evaluation_device:'CPU',single_value_device:'CPU'}})
const build=(op:any)=>buildSourceCompositor({version:1,status:'extracted',ops:[op],passes:[],diagnostics:[],output:{kind:'ref',type:'RGBA',node:op.id}},()=>null)
it('shares exact canonical Float32 coefficients and source table identity',()=>{
 const raw=readFileSync(new URL('../../blender-addon/spectral_tables.json',import.meta.url)),tables=JSON.parse(raw.toString())
 expect(createHash('sha256').update(raw).digest('hex')).toBe(BLACKBODY_TABLE_SHA256)
 for(const[channel,values]of[['r',BLACKBODY_R],['g',BLACKBODY_G],['b',BLACKBODY_B]]as const)expect(values.map(Math.fround)).toEqual(tables['blackbody_table_'+channel].flat().map(Math.fround))
})
it('builds arbitrary stored Float32 literal colors and interval neighbors without textures',()=>{
 for(const row of specs){const built=build(source(row.temperature));expect(built.node.isNode).toBe(true);built.dispose();built.dispose()}
 for(const row of specs){const scales=blackbodyTermScales(row.temperature);expect(scales.every(value=>value<16)).toBe(true);expect(blackbodyErrorBounds(row.temperature).every(value=>value<2**-15)).toBe(true)}
 // Unit source-term upper bounds cover entire intervals, not sampled-grid admission.
 const boundaries=[800,965,1167,1449,1902,3315,6365,12000]
 for(let i=0;i<7;i++){
  const low=boundaries[i]!,high=boundaries[i+1]!
  for(const coefficients of[BLACKBODY_R,BLACKBODY_G])expect(Math.abs(Math.fround(coefficients[3*i]!))/low+Math.abs(Math.fround(coefficients[3*i+1]!))*high+Math.abs(Math.fround(coefficients[3*i+2]!))).toBeLessThan(16)
  expect([0,1,2,3].reduce((sum,p)=>sum+Math.abs(Math.fround(BLACKBODY_B[4*i+p]!))*high**(3-p),0)).toBeLessThan(16)
 }
})
it('refuses unqualified source/evaluator/working-space and field or malformed temperatures',()=>{
 for(const patch of[{blackbody_model:'other'},{blackbody_profile:'other'},{blackbody_version:[5,2,0]},{blackbody_build:'other'},{blackbody_evaluator:'GPU-LUT'},{blackbody_working_space:'lin_ap1_scene'},{blackbody_ocio_sha256:'other'},{blackbody_table_sha256:'other'},{blackbody_color_transform:'unknown'},{single_value_device:'GPU'},{evaluation_device:'GPU',native_gpu_backend:'OPENGL'}]){const op=source();Object.assign(op.properties,patch);expect(()=>build(op)).toThrow(/Blackbody/)}
 for(const temperature of[799,12001,NaN,Infinity,6500.1])expect(()=>build(source(temperature))).toThrow(/Blackbody/)
 const op=source();(op.inputs.Temperature.value as any)={kind:'ref',node:'field',type:'VALUE'};expect(()=>build(op)).toThrow(/Blackbody/)
 const extra=source();(extra.inputs as any).Unexpected=extra.inputs.Temperature;expect(()=>build(extra)).toThrow(/Blackbody/)
})
