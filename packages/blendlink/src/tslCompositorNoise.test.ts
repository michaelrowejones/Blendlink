import {expect,it,vi} from 'vitest'
import {cases} from '../../../experiments/compositor-noise-default-field/protocol.mjs'
import {noiseProgramFixture} from '../../../experiments/compositor-noise-default-field/schema-fixtures.mjs'
import {vec3} from 'three/tsl'
import {WebGPURenderer} from 'three/webgpu'
import {CompositorExactAxes} from './tslCompositorExactAxes.js'
import {compositorCpuDefaultNoise2d,compositorCpuDefaultNoise2dOffsets} from './tslNodeRecipe.js'
import {buildCompositorNoise,validateCompositorNoise,COMPOSITOR_NOISE_MODEL as model,COMPOSITOR_NOISE_PROFILE as profile,COMPOSITOR_NOISE_KERNEL as kernel,COMPOSITOR_NOISE_COORDINATES as coordinates,COMPOSITOR_NOISE_DEFAULTS as defaults} from './tslCompositorNoise.js'
const fail=(m:string):never=>{throw Error(m)}
const field=(color=true):any=>({id:'noise',kind:'noise-texture',type:color?'RGBA':'VALUE',source:{node:'Artist Default Noise',nodeType:'ShaderNodeTexNoise',path:[],output:color?'Color':'Fac'},properties:{noise_model:model,noise_profile:profile,noise_kernel:kernel,noise_coordinate_model:coordinates,noise_version:[5,3,0],noise_build:'02f0899d78e3',noise_evaluator:'CPU-MF',noise_dimensions:2,noise_type:'FBM',noise_normalize:true,noise_fixed_sources:[{node:'Artist Default Noise',nodeType:'ShaderNodeTexNoise',tree:'Compositor'}],noise_reference_model:'full-frame-context-zero-offset-v1',noise_export_extent:[13,9],noise_precision:'CPU_FLOAT32',noise_requested_precision:'FULL',evaluation_device:'CPU',single_value_device:'CPU'},inputs:Object.fromEntries(Object.entries(defaults).map(([name,value])=>[name,{name,socketType:'VALUE',value:{kind:'constant',type:'VALUE',value}}]))})
const nodeBuilder=(api='webgl2')=>{const renderer=new WebGPURenderer({forceWebGL:api==='webgl2',canvas:{width:13,height:9,style:{},addEventListener(){},removeEventListener(){},getContext(){throw Error('Host-only node builder must not initialize GPU')}} as any});return renderer.backend.createNodeBuilder(null,renderer)}
const bits=(value:number)=>new Uint32Array(new Float32Array([value]).buffer)[0]
it('pins the native CPU Color offsets independently of wide uint-to-float GPU conversion',()=>{
 expect(compositorCpuDefaultNoise2dOffsets.map(row=>row.map(bits))).toEqual([[0x42df4487,0x431d5e90],[0x432571fe,0x4322c4aa]])
 expect(Object.isFrozen(compositorCpuDefaultNoise2dOffsets)).toBe(true);expect(compositorCpuDefaultNoise2dOffsets.every(Object.isFrozen)).toBe(true)
})
it('builds actual TSL default Fac/Color with the genuine shared axis owner',()=>{
 const axes=new CompositorExactAxes(),dispose=vi.fn();let texture:any
 axes.node.traverse((n:any)=>{if(n.isTextureNode)texture=n.value});texture.addEventListener('dispose',dispose)
 for(const api of['webgpu','webgl2'])for(const color of[true,false]){validateCompositorNoise(field(color),fail);const built=buildCompositorNoise(field(color),fail,axes);expect(built.isNode).toBe(true);expect(built.getNodeType(nodeBuilder(api))).toBe(color?'vec4':'float')}
 expect(dispose).not.toHaveBeenCalled();axes.dispose();expect(dispose).toHaveBeenCalledOnce()
})
it('keeps a fixed three-octave Fac/nine-octave Color construction and shared texture ownership',()=>{
 const axes=new CompositorExactAxes(),loads=new Set(),source=axes.node
 source.traverse((n:any)=>{if(n.isTextureNode)loads.add(n)})
 const scalar=compositorCpuDefaultNoise2d(vec3(0) as any,false) as any,color=compositorCpuDefaultNoise2d(vec3(0) as any,true) as any
 const builder=nodeBuilder();expect(scalar.getNodeType(builder)).toBe('float');expect(color.getNodeType(builder)).toBe('vec3')
 const built=buildCompositorNoise(field(),fail,axes);const textures=new Set();built.traverse((n:any)=>{if(n.isTextureNode)textures.add(n.value)})
 const octaveCalls=(node:any)=>{const calls=new Set();node.traverse((n:any)=>{if(n.isShaderCallNodeInternal&&n.shaderNode.layout?.name==='blendlinkCompositorCpuDefaultPerlin2dV3')calls.add(n)});return calls.size}
 expect(octaveCalls(scalar)).toBe(3);expect(octaveCalls(color)).toBe(9)
 expect(loads.size).toBe(2);expect(textures.size).toBe(1);axes.dispose()
})
it('refuses shader/EEVEE/Cycles/unknown models, source contexts and altered original controls',()=>{
 for(const patch of[{noise_model:'noise_normalized'},{noise_future:true},{noise_fixed_sources:[]},{noise_profile:'eevee-metal-periodic-f32'},{noise_kernel:'cycles-neon-fma'},{noise_kernel:'staged-f32-perlin2d-default-fbm-v1'},{noise_kernel:'compensated-bli-fade-f32-outer-noise2d-v2'},{noise_dimensions:3},{noise_type:'MULTIFRACTAL'},{noise_normalize:false},{noise_requested_precision:'HALF'},{noise_precision:'GPU_HALF'},{noise_export_extent:[3,9]},{noise_export_extent:[8193,9]},{noise_export_extent:[NaN,9]},{noise_version:[5,2,0]},{noise_build:'future'},{evaluation_device:'GPU'}]){const op=field();Object.assign(op.properties,patch);expect(()=>validateCompositorNoise(op,fail)).toThrow(/Noise/)}
 for(const key of Object.keys(defaults))for(const bad of[-0,2**-149,.1,Infinity,NaN,undefined]){const op=field();op.inputs[key].value.value=bad;expect(()=>validateCompositorNoise(op,fail)).toThrow(/Noise/)}
 for(const key of['source','properties','inputs'])for(const value of[undefined,null,[],{}]){const op=field();op[key]=value;expect(()=>validateCompositorNoise(op,fail)).toThrow(/Noise/)}
 for(const mutate of[(op:any)=>op.inputs.Scale.name='Detail',(op:any)=>delete op.inputs.Scale.name,(op:any)=>op.inputs.Scale.extra=1,(op:any)=>op.inputs.Scale.value.extra=1,(op:any)=>op.source.extra=1]){const op=field();mutate(op);expect(()=>validateCompositorNoise(op,fail)).toThrow(/Noise/)}
 const vector=field();vector.inputs.Vector={socketType:'VECTOR',value:{kind:'constant',type:'VECTOR',value:[0,0,0]}};expect(()=>validateCompositorNoise(vector,fail)).toThrow(/Noise/)
 const linked=field();linked.inputs.Scale.value={kind:'ref',type:'VALUE',node:'other'};expect(()=>validateCompositorNoise(linked,fail)).toThrow(/Noise/)
 const wrong=field();wrong.kind='white-noise-texture';expect(()=>validateCompositorNoise(wrong,fail)).toThrow(/Noise/)
})
it('refuses forged axis wrappers without taking ownership of borrowed resources',()=>{
 for(const axes of[undefined,null,{node:vec3(0)},{node:{isNode:true}},{model:coordinates}])expect(()=>buildCompositorNoise(field(),fail,axes as any)).toThrow(/genuine owned/)
})

import {buildSourceCompositor} from './tslSourceCompositor.js'
import {validateNoiseFieldGraph,validateNoisePresentation} from './tslCompositorNoise.js'
const program=(op=field()):any=>({version:1,status:'extracted',ops:[op],passes:[],diagnostics:[],output:{kind:'ref',type:op.type,node:op.id}})
it('integrates a field with one table, shares it between bounded Noise operations and preserves root guards',()=>{
 const p:any={version:1,diagnostics:[],...noiseProgramFixture(cases.find((row:any)=>row.route==='shared-fac-color'))}
 const built=buildSourceCompositor(p,()=>null),textures=new Set<any>();built.node.traverse((n:any)=>{if(n.isTextureNode)textures.add(n.value)})
 expect(textures.size).toBe(1);const texture=[...textures][0],disposed=vi.fn();texture.addEventListener('dispose',disposed);built.dispose();built.dispose();expect(disposed).toHaveBeenCalledOnce()
 const constant=program();constant.output={kind:'constant',type:'RGBA',value:[0,0,0,1]};expect(()=>buildSourceCompositor(constant,()=>null)).toThrow(/proven pointwise topology/)
})
it('closes other producer families and declared passes before resolution or allocation',()=>{
 for(const kind of['white-noise-texture','wave-texture','box-mask','ellipse-mask','gradient-texture','image-info','image-input','render-pass','flip','blur','curves']){
  const p=program();p.ops.push({id:'foreign',kind,type:'RGBA',source:{path:[],node:'Foreign',nodeType:'Other',output:'Image'},properties:{},inputs:{}})
  const resolve=vi.fn();expect(()=>buildSourceCompositor(p,resolve)).toThrow(/Noise.*pointwise/);expect(resolve).not.toHaveBeenCalled()
 }
 const p=program();p.passes.push({pass:'Image'});expect(()=>validateNoiseFieldGraph(p,fail)).toThrow(/scene-pass/)
 const image=program();image.images={unused:{}};expect(()=>validateNoiseFieldGraph(image,fail)).toThrow(/scene-pass\/image/)
 const alias=program();alias.ops[0].kind='rgb';expect(()=>validateNoiseFieldGraph(alias,fail)).toThrow(/actual native/)
 const duplicate=program();duplicate.ops.push(field());expect(()=>validateNoiseFieldGraph(duplicate,fail)).toThrow(/unique nonempty/)
})
it('bounds real construction cost at eighteen Perlin calls and axis/display samplers at eight',()=>{
 for(const route of ['two-color','six-fac']){const p:any=noiseProgramFixture(cases.find((row:any)=>row.route===route));expect(()=>validateNoiseFieldGraph(p,fail)).not.toThrow();p.ops.push({...field(),id:'invalid'});expect(()=>validateNoiseFieldGraph(p,fail)).toThrow(/eighteen/)}
 const presentation:any={compositor:program(),display:{ops:Array.from({length:7},()=>({type:'Lut3DTransform'}))}}
 expect(()=>validateNoisePresentation(presentation,0,fail)).not.toThrow();presentation.display.ops.push({type:'Lut1DTransform'});expect(()=>validateNoisePresentation(presentation,0,fail)).toThrow(/eight/);presentation.display.ops.pop()
 expect(()=>validateNoisePresentation(presentation,1,fail)).toThrow(/registered/);expect(()=>validateNoisePresentation(presentation,0,fail,1)).toThrow(/registered/)
})

it('admits exactly the native proof topologies and refuses disconnected or amplifying compositions before allocation',()=>{
 const fixture=(route:string,output='Color'):any=>({version:1,diagnostics:[],...noiseProgramFixture(cases.find((row:any)=>row.route===route&&row.output===output))})
 for(const row of cases)expect(()=>validateNoiseFieldGraph(noiseProgramFixture(row) as any,fail)).not.toThrow()
 const mutations:(()=>any)[]=[
  ()=>{const p=fixture('direct');p.ops.push({...field(),id:'unused'});return p},
  ()=>{const p=fixture('direct');p.output={kind:'constant',type:'RGBA',value:[0,0,0,1]};return p},
  ()=>{const p=fixture('six-fac','Fac');p.ops.find((o:any)=>o.properties.operation==='MULTIPLY').inputs.Value_001.value.value=1024;return p},
  ()=>{const p=fixture('six-fac','Fac');p.ops.find((o:any)=>o.properties.operation==='MULTIPLY').inputs.Value_001.value.value=.500001;return p},
  ()=>{const p=fixture('six-fac','Fac');p.ops.find((o:any)=>o.properties.operation==='ADD').properties.operation='SUBTRACT';return p},
  ()=>{const p=fixture('six-fac','Fac');p.ops.find((o:any)=>o.properties.operation==='ADD').properties.use_clamp=true;return p},
  ()=>{const p=fixture('six-fac','Fac');const leaves=p.ops.filter((o:any)=>o.kind==='noise-texture');leaves[1].source.node=leaves[0].source.node;return p},
  ()=>{const p=fixture('shared-fac-color');p.ops.find((o:any)=>o.source.output==='Fac').source.node='Another physical node';return p},
  ()=>{const p=fixture('shared-fac-color');p.ops.find((o:any)=>o.kind==='separate-color').source.output='Red';return p},
  ()=>{const p=fixture('two-color');p.ops.at(-1).inputs.Alpha.value.value=.5;return p},
  ()=>{const p=fixture('two-color');p.ops.at(-1).inputs.Red.value.type='RGBA';return p},
  ()=>{const p=fixture('two-color');p.ops.at(-1).source.nodeType='ShaderNodeCombineColor';return p},
  ()=>{const p=fixture('two-color');p.ops.at(-1).properties.mode='HSV';return p},
  ()=>{const p=fixture('two-color');p.ops.at(-1).inputs.Green.value.node='missing';return p},
  ()=>{const p=fixture('two-color');p.ops.at(-1).inputs.Green.value.node=p.ops.at(-1).id;return p},
  ()=>{const p=fixture('two-color');p.ops.at(-1).inputs.Green.value.extra=true;return p},
  ()=>{const p=fixture('direct','Fac');p.output.fromType='INT';return p},
 ]
 for(const make of mutations){const p=make(),resolve=vi.fn();expect(()=>buildSourceCompositor(p,resolve)).toThrow(/Noise/);expect(resolve).not.toHaveBeenCalled()}
 for(const kind of ['exposure','gamma','map-range','math']){
  const p=fixture('direct'),n=p.ops[0];p.ops.push({id:'amplify',kind,type:'RGBA',source:{path:[],node:'Unproven consumer',nodeType:'CompositorNodeExposure',output:'Image'},properties:{},inputs:{Image:{name:'Image',socketType:'RGBA',value:{kind:'ref',node:n.id,type:'RGBA'}}}});p.output={kind:'ref',type:'RGBA',node:'amplify'}
  expect(()=>validateNoiseFieldGraph(p,fail)).toThrow(/proven pointwise topology/)
 }
})

it('permits only one contributing folded Alpha1 literal without admitting numeric wrappers or unused operations',()=>{
 const make=(route='shared-fac-color'):any=>{
  const p:any=noiseProgramFixture(cases.find((row:any)=>row.route===route)),root=p.ops.at(-1)
  const literal={id:'alpha-literal',kind:'value',type:'VALUE',value:1,source:{path:['Compositor'],node:'Actual native folded matrix',nodeType:'FunctionNodeSeparateMatrix',output:'Column 1 Row 1'},properties:{},inputs:{}}
  p.ops.splice(p.ops.length-1,0,literal);root.inputs.Alpha.value={kind:'ref',node:literal.id,type:'VALUE'};return p
 }
 for(const route of ['shared-fac-color','two-color','six-fac']){
  const p=make(route);expect(()=>validateNoiseFieldGraph(p,fail)).not.toThrow()
  for(const value of [0,2,NaN,Infinity,-0,true]){const q=structuredClone(p);q.ops.find((o:any)=>o.id==='alpha-literal').value=value;expect(()=>validateNoiseFieldGraph(q,fail)).toThrow(/Noise/)}
 }
 for(const mutate of [(p:any)=>p.ops.find((o:any)=>o.id==='alpha-literal').inputs.extra={name:'extra',socketType:'VALUE',value:{kind:'constant',type:'VALUE',value:1}},(p:any)=>p.ops.at(-1).inputs.Alpha.value={kind:'constant',type:'VALUE',value:1},(p:any)=>p.ops.find((o:any)=>o.id==='alpha-literal').type='INT']){const p=make();mutate(p);expect(()=>validateNoiseFieldGraph(p,fail)).toThrow(/Noise/)}
})
