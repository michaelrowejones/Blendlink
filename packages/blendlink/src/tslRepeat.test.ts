import {expect,it} from 'vitest'
import {buildTslColorNode,createTslBuildResources,type TslIrDocument} from './tslNodeRecipe.js'
import {validateStaticRepeat} from './tslRepeat.js'
const c=(value:number)=>({op:'const_float',value})
const ref=(index=0)=>({op:'repeat_state',index,type:'VALUE'})
const repeat=()=>({op:'repeat_static',model:'eevee-static-repeat-53-v1',sourceProfile:'darwin-arm64-eevee-metal-repeat-53-v1',sourceVersion:[5,3,0],sourceBuild:'02f0899d78e3',iterations:64,output:0,states:[{type:'VALUE',initial:c(.125),body:{op:'math',operation:'ADD',a:ref(),b:c(.0625)}}]})
const doc=(output=repeat())=>({schemaVersion:1,model:'blendlink-tsl-ir-v1',output})as TslIrDocument
const fail=(why:string):never=>{throw Error(why)}
it('builds bounded loops and independently validates state schema, copies and iteration cost',()=>{
 for(const n of[1,2,7,32,64]){const x=repeat();x.iterations=n;expect(buildTslColorNode(doc(x)).isNode).toBe(true)}
 for(const patch of[{iterations:65},{iterations:-1},{iterations:1.5},{output:1},{sourceBuild:'other'},{sourceProfile:'unmeasured'},{sourceProfile:undefined},{model:'other'},{sourceVersion:[5,2,0]}]){const x=repeat();Object.assign(x,patch);expect(()=>buildTslColorNode(doc(x))).toThrow(/Repeat/)}
 const x=repeat();x.states[0]!.body=ref()as any;expect(validateStaticRepeat(x,fail)).toHaveLength(1)
})
it('quarantines native cross-state aliasing, constant overwrite and nonlinear recurrences',()=>{
 for(const body of[c(1),{op:'math',operation:'MULTIPLY',a:ref(),b:c(2)},{op:'tex_image',pixels:[]}]){const x=repeat();x.states[0]!.body=body as any;expect(()=>buildTslColorNode(doc(x))).toThrow(/Repeat/)}
 const x=repeat();x.states.push({type:'VALUE',initial:c(1),body:{op:'math',operation:'ADD',a:ref(1),b:c(1)}});x.states[0]!.body=ref(1)as any;expect(()=>buildTslColorNode(doc(x))).toThrow(/cross-state/)
})
it('rejects orphaned/forged typed references, unrounded UV, cycles and deep payloads before allocation',()=>{
 expect(()=>buildTslColorNode(doc(ref()as any))).toThrow(/lexical/)
 for(const initial of[{op:'uv_active'},c(.1),c(-0),{op:'const_vec3',value:[0,0,0]}]){const x=repeat();x.states[0]!.initial=initial as any;expect(()=>buildTslColorNode(doc(x))).toThrow(/Repeat/)}
 const x=repeat();(x.states[0]!.body as any).a.type='VECTOR';expect(()=>buildTslColorNode(doc(x))).toThrow(/Repeat/)
})
it('bounds unique shader loops per channel and honours cancellation without owned resources',()=>{
 const resources=createTslBuildResources(),controller=new AbortController();controller.abort()
 expect(()=>buildTslColorNode(doc(),{signal:controller.signal,resources})).toThrow(/cancelled/);expect(resources.textures).toHaveLength(0)
 let expression:any=c(0)
 for(let i=0;i<9;i++){const x=repeat();x.states[0]!.initial=c(i/16);expression={op:'math',operation:'ADD',a:expression,b:x}}
 expect(()=>buildTslColorNode(doc(expression))).toThrow(/unique loops/);expect(resources.textures).toHaveLength(0);resources.dispose()
})

it('requires the exact exported node-renderer declaration for a fresh Repeat program',async()=>{
 const {validateNodeRendererRequirement,nodeRendererProgramLabel}=await import('./materialProgramRendererRequirements.js')
 const channels={BaseColor:{tslIr:doc()}},declaration={schemaVersion:1,model:'live-material-programs-v1',programs:[{op:'repeat_static',model:'eevee-static-repeat-53-v1'}]}
 expect(validateNodeRendererRequirement(channels,undefined).issue).toMatch(/Repeat Zone/)
 const accepted=validateNodeRendererRequirement(channels,declaration);expect(accepted.issue).toBeUndefined();expect(accepted.required).toHaveLength(1);expect(nodeRendererProgramLabel(accepted.required)).toBe('Repeat Zone')
})

it('refuses scalar/vector authored SNAP field seeds until coordinate phase admission is qualified',()=>{
 const constant=(n:number)=>({op:'const_vec3',value:[n,n,n]})
 const snapped=()=>({op:'vector_math',operation:'SNAP',a:{op:'vector_math',operation:'MINIMUM',a:{op:'vector_math',operation:'MAXIMUM',a:{op:'uv_active'},b:constant(0)},b:constant(1)},b:constant(.25)})
 for(const type of['VALUE','VECTOR']){
  const x=repeat();x.states[0]!.type=type;x.states[0]!.initial=(type==='VECTOR'?snapped():{op:'separate',channel:'x',input:snapped()})as any;x.states[0]!.body={op:'repeat_state',index:0,type}as any
  expect(()=>buildTslColorNode(doc(x))).toThrow(/literal seeds.*phase-margin/)
 }
 const x=repeat();x.states[0]!.initial={op:'combine',x:{op:'separate',channel:'x',input:snapped()},y:c(0),z:c(0)}as any
 expect(()=>buildTslColorNode(doc(x))).toThrow(/literal seeds/)
 // A one-ULP upstream UV difference crosses this allowed authored SNAP branch.
 const below=Math.fround(.25-2**-26),snap=(value:number)=>Math.floor(value/.25)*.25
 expect(snap(below)).toBe(0);expect(snap(.25)).toBe(.25)
})

it('bounds malformed seed traversal before recursive literal-shape checks',()=>{
 let initial:any=c(0)
 for(let depth=0;depth<10000;depth++)initial={op:'combine',x:initial,y:c(0),z:c(0)}
 const deep=repeat();deep.states[0]!.initial=initial
 expect(()=>validateStaticRepeat(deep,fail)).toThrow(/Repeat.*(deep|cost)/)
 const cycle:any={op:'combine',y:c(0),z:c(0)};cycle.x=cycle
 const cyclic=repeat();cyclic.states[0]!.initial=cycle
 expect(()=>validateStaticRepeat(cyclic,fail)).toThrow(/Repeat.*cyclic/)
})
