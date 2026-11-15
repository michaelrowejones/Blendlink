import {expect,it,vi} from 'vitest'
import * as THREE from 'three'
import {Fn,pass,vec4} from 'three/tsl'
import {buildNativeCompositorBlur} from './tslCompositorBlur.js'
import NodeFrame from 'three/src/nodes/core/NodeFrame.js'
import {compositorProducerLookup,updateCompositorPassProducers} from './tslCompositorProducers.js'
import {realizeCompositorOrigin} from './tslCompositorImageDomain.js'
const fail=(message:string):never=>{throw Error(message)}
function host(width=13,height=9){
 let target:any=new THREE.RenderTarget(width,height),face=0,mip=0,alpha=.25,color=new THREE.Color(.125,.25,.5),mrt:any={caller:true},hook:any=vi.fn(),ratio=1,scissorTest=false
 const sourceScene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),producer:any=pass(sourceScene,camera),frame:any=new NodeFrame(),seen:any[]=[],quads:any[]=[]
 const renderer:any={isWebGPURenderer:true,backend:{isWebGPUBackend:true,device:{},has:()=>false,get:()=>{throw Error('Must not create backend entries')},delete:vi.fn()},_textures:{data:new WeakMap()},toneMapping:THREE.ACESFilmicToneMapping,toneMappingExposure:2,outputColorSpace:THREE.SRGBColorSpace,autoClear:false,transparent:true,opaque:true,contextNode:null,
 getDrawingBufferSize:(v:any)=>v.set(width,height),getSize:(v:any)=>v.set(width,height),getOutputRenderTarget:()=>null,getRenderTarget:()=>target,setRenderTarget:(v:any,f=0,m=0)=>{target=v;face=f;mip=m},getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,getPixelRatio:()=>ratio,setPixelRatio:(v:number)=>{ratio=v},getMRT:()=>mrt,setMRT:(v:any)=>{mrt=v},getRenderObjectFunction:()=>hook,setRenderObjectFunction:(v:any)=>{hook=v},getClearAlpha:()=>alpha,getClearColor:(v:THREE.Color)=>v.copy(color),setClearColor:(v:any,a:number)=>{color=v?.isColor?v.clone():new THREE.Color(v);alpha=a},getScissorTest:()=>scissorTest,setScissorTest:(v:boolean)=>{scissorTest=v},getViewport:(v:any)=>v.set(0,0,width,height),setViewport:vi.fn(),getScissor:(v:any)=>v.set(0,0,width,height),setScissor:vi.fn(),
 render(object:any){if(object===sourceScene){seen.push({alpha,color:color.toArray(),hook,tone:this.toneMapping,exposure:this.toneMappingExposure,frame:frame.frameId});hook?.()}else{quads.push({alpha,hook});frame.updateBeforeNode(producer)}}}
 frame.renderer=renderer;frame.frameId=1;frame.renderId=1
 return{renderer,producer,texture:producer.getTextureNode(),frame,seen,quads,initial:{target,alpha,color:color.toArray(),mrt,hook,tone:renderer.toneMapping,exposure:renderer.toneMappingExposure},resources:[] as any[]}
}
for(const mode of['integer','fractional','affine','crop']as const)it('schedules actual FRAME producer before owned '+mode+' reset and uses native per-frame cache',()=>{
 const h=host(),origin:any={x:mode==='fractional'?.25:0,y:0,maxPixels:4194304,roots:[{node:h.texture,extent:()=>[13,9]}],sampling:{model:'modern-cpu-v1',interpolation:'Nearest'},...(mode==='affine'?{affineMatrix:[1.1,0,0,0,1,0,0,0,1]}:mode==='crop'?{croppedWindow:{resolve:()=>({width:13,height:9,model:'modern-cpu-v1',dataSize:[13,9],displaySize:[13,9],dataOffset:[0,0]})}}:{})}
 realizeCompositorOrigin(h.texture,origin,[0,0],h.resources,fail)
 const rtt=h.resources.find(owner=>owner.node?.isRTTNode).node
 rtt.updateBefore(h.frame);rtt.updateBefore(h.frame)
 expect(h.seen).toHaveLength(1);expect(h.seen[0]).toEqual({alpha:h.initial.alpha,color:h.initial.color,hook:h.initial.hook,tone:h.initial.tone,exposure:h.initial.exposure,frame:1});expect(h.initial.hook).toHaveBeenCalledOnce();expect(h.quads.every(v=>v.alpha===1&&v.hook===null)).toBe(true)
 expect(h.renderer.getClearAlpha()).toBe(h.initial.alpha);expect(h.renderer.getClearColor(new THREE.Color()).toArray()).toEqual(h.initial.color);expect(h.renderer.getRenderTarget()).toBe(h.initial.target);expect(h.renderer.getMRT()).toBe(h.initial.mrt);expect(h.renderer.getRenderObjectFunction()).toBe(h.initial.hook)
 h.frame.frameId=2;h.frame.renderId++;rtt.updateBefore(h.frame);expect(h.seen).toHaveLength(2);expect(h.seen[1].alpha).toBe(h.initial.alpha)
 for(const owner of h.resources.reverse())owner.dispose()
})
it('refuses over-budget physical input before any borrowed producer or owned RTT render',()=>{
 const h=host(2049,2048),origin:any={x:0,y:0,maxPixels:4194304,roots:[{node:h.texture,extent:()=>[2049,2048]}]};realizeCompositorOrigin(h.texture,origin,[0,0],h.resources,fail);const rtt=h.resources[0].node
 expect(()=>rtt.updateBefore(h.frame)).toThrow(/pixel budget/);expect(h.seen).toEqual([]);expect(h.quads).toEqual([]);expect(h.renderer.getClearAlpha()).toBe(h.initial.alpha);h.resources[0].dispose()
})
it('passes already-cached producers without duplicate renders and rejects missing actual scheduler',()=>{
 const h=host();h.frame.updateBeforeNode(h.producer);updateCompositorPassProducers([h.texture,h.texture,h.producer],h.frame);expect(h.seen).toHaveLength(1);expect(()=>updateCompositorPassProducers([h.texture],{renderer:h.renderer})).toThrow(/actual NodeFrame/)
 h.producer.updateBeforeType='render';expect(()=>updateCompositorPassProducers([h.texture],h.frame)).toThrow(/FRAME/)
 updateCompositorPassProducers([vec4(1)],{renderer:h.renderer})
})
it('derives compound Blur producer identity through explicit IR refs/converts, once before render',()=>{
 const h=host(),other=host(),ref=(id:string):any=>({kind:'ref',node:id,type:'RGBA'}),ops:any[]=[{id:'pass',kind:'render-pass',inputs:{}},{id:'other',kind:'render-pass',inputs:{}},{id:'exposure',kind:'exposure',inputs:{Image:{value:ref('pass')},Exposure:{value:{kind:'constant',type:'VALUE',value:0}}}},{id:'mix',kind:'mix',inputs:{A:{value:ref('exposure')},B:{value:ref('other')}}}],memo=new Map([['pass',h.texture],['other',other.texture]]),lookup=compositorProducerLookup(ops,memo,fail)
 const roots=lookup({kind:'convert',type:'RGBA',fromType:'RGBA',input:ref('mix')} as any);expect(roots).toEqual([h.texture,other.texture]);expect(lookup(ref('exposure'))).toEqual([h.texture])
 const cyclic:any={kind:'convert'};cyclic.input=cyclic;expect(()=>lookup(cyclic)).toThrow(/acyclic/);expect(()=>compositorProducerLookup([{id:'bad',kind:'math',inputs:{Value:{value:ref('missing')}}}]as any,memo,fail)).toThrow(/preceding source refs/)
 expect(()=>compositorProducerLookup([ops[0],ops[0]],memo,fail)).toThrow(/unique/)
})

it('schedules a wrapped Relative Blur producer before every owned reset and validates radii first',()=>{
 const h=host(),ref:any={kind:'ref',node:'exposure',type:'RGBA'},ops:any[]=[{id:'pass',kind:'render-pass',inputs:{}},{id:'exposure',kind:'exposure',inputs:{Image:{value:{kind:'ref',node:'pass',type:'RGBA'}}}}]
 const roots=compositorProducerLookup(ops,new Map([['pass',h.texture]]),fail)(ref),constant=(type:string,value:unknown)=>({name:'',socketType:type,value:{kind:'constant',type,value}})
 const op:any={id:'blur',kind:'blur',type:'RGBA',source:{node:'Artist Blur'},properties:{blur_model:'legacy-cpu-f32-v1',blur_weights:[[.5,.25],[.5,.25]],blur_relative_model:'legacy-percent-f32-v1',blur_relative_percent:[12.5,25],blur_relative_aspect:'NONE',blur_relative_multiplier:1},inputs:{Image:{value:ref},Size:constant('VECTOR',[1,1]),Type:constant('MENU','Tent'),'Extend Bounds':constant('BOOLEAN',false),Separable:constant('BOOLEAN',true)}}
 const image=Fn(()=>h.texture.mul(1))();buildNativeCompositorBlur(op,image,false,h.resources,fail,frame=>updateCompositorPassProducers(roots,frame))
 const rtts=h.resources.filter(owner=>owner.node?.isRTTNode)
 expect(rtts.length).toBeGreaterThan(1)
 for(const owner of rtts)owner.node.updateBefore(h.frame)
 expect(h.seen).toHaveLength(1);expect(h.seen[0].alpha).toBe(h.initial.alpha);expect(h.seen[0].hook).toBe(h.initial.hook);expect(h.quads.every(v=>v.alpha===1&&v.hook===null)).toBe(true)
 for(const owner of h.resources.reverse())owner.dispose()
 const large=host(8192,8192);op.properties.blur_relative_percent=[100,100]
 buildNativeCompositorBlur(op,large.texture,false,large.resources,fail,frame=>updateCompositorPassProducers([large.texture],frame))
 expect(()=>large.resources.find(owner=>owner.node?.isRTTNode).node.updateBefore(large.frame)).toThrow(/radii between/);expect(large.seen).toEqual([]);expect(large.quads).toEqual([])
 for(const owner of large.resources.reverse())owner.dispose()
})

it('restores real PassNode temporary state when the actual producer draw throws and permits a next-frame retry without editing the native cache',()=>{
 const h=host(),scene=h.producer.scene,camera=h.producer.camera,originalRender=h.renderer.render.bind(h.renderer)
 scene.name='Caller scene';scene.overrideMaterial=new THREE.MeshBasicMaterial();camera.layers.mask=7
 h.producer.name='Temporary pass';h.producer.overrideMaterial=new THREE.MeshBasicMaterial();h.producer._layers=new THREE.Layers();h.producer._layers.mask=2
 const callerContext={caller:true};h.renderer.contextNode=callerContext;h.renderer.transparent=false;h.renderer.opaque=false
 h.producer.contextNode={pass:true};h.producer._contextNodeCache={version:h.producer.version,context:{temporary:true}}
 const originalOverride=scene.overrideMaterial
 h.renderer.render=()=>{throw Error('Actual producer draw failed')}
 expect(()=>updateCompositorPassProducers([h.texture],h.frame)).toThrow('Actual producer draw failed')
 expect(h.renderer.getRenderTarget()).toBe(h.initial.target);expect(h.renderer.getMRT()).toBe(h.initial.mrt);expect(h.renderer.autoClear).toBe(false);expect(h.renderer.transparent).toBe(false);expect(h.renderer.opaque).toBe(false);expect(h.renderer.contextNode).toBe(callerContext)
 expect(h.renderer.getClearAlpha()).toBe(h.initial.alpha);expect(h.renderer.getRenderObjectFunction()).toBe(h.initial.hook);expect(scene.name).toBe('Caller scene');expect(scene.overrideMaterial).toBe(originalOverride);expect(camera.layers.mask).toBe(7)
 h.renderer.render=originalRender;h.frame.frameId++;updateCompositorPassProducers([h.texture],h.frame);expect(h.seen).toHaveLength(1)
 expect(scene.name).toBe('Caller scene');expect(scene.overrideMaterial).toBe(originalOverride);expect(camera.layers.mask).toBe(7)
 originalOverride.dispose();h.producer.overrideMaterial.dispose()
})
