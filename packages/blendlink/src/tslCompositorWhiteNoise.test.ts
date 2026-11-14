import {expect,it} from 'vitest'
import {buildSourceCompositor} from './tslSourceCompositor.js'
import {COMPOSITOR_WHITE_NOISE_MODEL as model,COMPOSITOR_WHITE_NOISE_PROFILE as profile,whiteNoiseWord} from './tslCompositorWhiteNoise.js'
const source=(dimensions=4,color=true):any=>({id:'noise',kind:'white-noise-texture',type:color?'RGBA':'VALUE',
  source:{path:[],node:'Artist White Noise',nodeType:'ShaderNodeTexWhiteNoise',output:color?'Color':'Value'},
  properties:{white_noise_model:model,white_noise_profile:profile,white_noise_version:[5,3,0],white_noise_build:'02f0899d78e3',white_noise_evaluator:'CPU-MF',noise_dimensions:dimensions,evaluation_device:'CPU',single_value_device:'CPU'},
  inputs:Object.fromEntries((dimensions===1?['W']:dimensions===4?['Vector','W']:['Vector']).map(name=>[name,{name,socketType:name==='Vector'?'VECTOR':'VALUE',value:{kind:'constant',type:name==='Vector'?'VECTOR':'VALUE',value:name==='Vector'?[.1,-.8,1/3].map(Math.fround):Math.fround(.5678912)}}]))})
const build=(op:any)=>buildSourceCompositor({version:1,status:'extracted',ops:[op],passes:[],diagnostics:[],output:{kind:'ref',type:op.type,node:op.id}},()=>null)
it('builds all CPU fixed-seed dimensions and outputs with existing hash arithmetic',()=>{
  for(const dimension of [1,2,3,4])for(const color of [false,true]){const built=build(source(dimension,color));expect(built.node.isNode).toBe(true);built.dispose();built.dispose()}
  for(const seed of [0,2**-126,-(2**-126),Math.fround(3.4028234663852886e38),-Math.fround(3.4028234663852886e38)]){
    const op=source(1);op.inputs.W.value.value=seed;const built=build(op);built.dispose()
  }
})
it('refuses changed source profiles/schema and GPU-authored or field inputs',()=>{
  for(const patch of [{white_noise_model:'shader'},{white_noise_profile:'unknown'},{white_noise_version:[5,2,0]},{white_noise_build:'other'},
    {white_noise_evaluator:'GPU'},{evaluation_device:'GPU'},{single_value_device:'GPU'},{noise_dimensions:0},{noise_dimensions:5},{noise_dimensions:'2'},{noise_dimensions:NaN}]){
    const op=source();Object.assign(op.properties,patch);expect(()=>build(op)).toThrow(/White Noise/)
  }
  for(const field of [{kind:'ref',type:'VALUE',node:'field'},{kind:'constant',type:'VECTOR',value:[0,0,0]},{kind:'constant',type:'VALUE',value:true}]){
    const op=source(1);op.inputs.W.value=field;expect(()=>build(op)).toThrow(/White Noise/)
  }
  for(const patch of [{type:'VECTOR'},{inputs:{}}])expect(()=>build(Object.assign(source(),patch))).toThrow(/White Noise/)
  const wrongSource=source();wrongSource.source.nodeType='Other';expect(()=>build(wrongSource)).toThrow(/White Noise/)
  const extra=source();extra.inputs.Extra=extra.inputs.W;expect(()=>build(extra)).toThrow(/White Noise/)
  for(const key of ['source','properties','inputs'])for(const invalid of [undefined,null,{},[]]){
    const malformed=source();malformed[key]=invalid;expect(()=>build(malformed)).toThrow(/White Noise/)
  }
  for(const invalid of [undefined,null,{},[]]){const malformed=source();malformed.inputs.W=invalid;expect(()=>build(malformed)).toThrow(/White Noise/)}
})
it('rejects raw signed-zero/subnormal/nonfinite or non-Float32 values before building hashes',()=>{
  for(const value of [-0,2**-149,-(2**-149),NaN,Infinity,-Infinity,.1,2**128,Number.MIN_VALUE]){
    expect(whiteNoiseWord(value)).toBe(false)
    const scalar=source(1);scalar.inputs.W.value.value=value;expect(()=>build(scalar)).toThrow(/White Noise/)
    for(let axis=0;axis<3;axis++){const vector=source(3);vector.inputs.Vector.value.value[axis]=value;expect(()=>build(vector)).toThrow(/White Noise/)}
  }
  for(const vector of [[],[0,0],[0,0,0,0],null,{},[0,0,true]]){const op=source(3);op.inputs.Vector.value.value=vector;expect(()=>build(op)).toThrow(/White Noise/)}
})
