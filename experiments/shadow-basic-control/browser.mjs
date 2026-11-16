// SPDX-License-Identifier: MIT
// Independent upstream Three shadow control. No SceneToWeb runtime installation.
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
if(process.argv[4]!=='--gpu-lease')throw Error('Use NATIVE_DIRECTORY NEW_DIRECTORY --gpu-lease after coordination');
const native=resolve(process.argv[2]),out=resolve(process.argv[3]),root=resolve(import.meta.dirname,'../..');await mkdir(out);
const sha=b=>createHash('sha256').update(b).digest('hex');
const fixture=`
import * as T from 'three';import {WebGPURenderer} from 'three/webgpu';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
window.run=async(backend,kind)=>{
 const errors=[],r=new WebGPURenderer({forceWebGL:backend==='webgl2',antialias:false});await r.init();
 const actualBackend=r.backend.isWebGPUBackend?'webgpu':r.backend.isWebGLBackend?'webgl2':'unknown';if(actualBackend!==backend)throw Error('Unexpected backend '+actualBackend);
 let gpu;if(backend==='webgpu'){const i=r.backend.device.adapterInfo;gpu=i?{vendor:i.vendor,architecture:i.architecture,device:i.device,description:i.description}:null;if(!gpu)throw Error('Missing actual device adapterInfo');}else{const gl=r.backend.gl,ext=gl.getExtension('WEBGL_debug_renderer_info');gpu={vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};}
 if(!JSON.stringify(gpu).match(/Apple|Metal|apple/))throw Error('Expected Apple Metal identity: '+JSON.stringify(gpu));
 r.setSize(128,128);r.outputColorSpace=T.LinearSRGBColorSpace;r.toneMapping=T.NoToneMapping;r.shadowMap.enabled=true;r.shadowMap.type=T.PCFShadowMap;
 r.debug.onShaderError=(g,p)=>errors.push(g.getProgramInfoLog(p));r.backend.device?.addEventListener('uncapturederror',e=>errors.push(String(e.error)));
 const scene=new T.Scene();scene.background=new T.Color(0);let camera,caster;const meshes=[];
 if(kind==='basic'){
  camera=new T.OrthographicCamera(-3,3,3,-3,.1,50);camera.position.set(0,6,0);camera.up.set(0,0,-1);camera.lookAt(0,0,0);
  const ground=new T.Mesh(new T.PlaneGeometry(30,30),new T.MeshStandardMaterial({color:0x808080,roughness:1,side:T.DoubleSide}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);meshes.push(ground);
  caster=new T.Mesh(new T.BoxGeometry(1.5,.2,1.5),new T.MeshStandardMaterial({color:0xffffff,roughness:1}));caster.position.set(4,4,0);scene.add(caster);meshes.push(caster);
 }else{
  const gltf=await new GLTFLoader().loadAsync('/shadow.glb');scene.add(gltf.scene);camera=gltf.cameras[0];
  gltf.scene.traverse(o=>{if(o.isLight)o.visible=false;if(o.isMesh){meshes.push(o);o.receiveShadow=true;if(o.material.userData.blendlink_source_material==='White Shadow Branch')caster=o;}});if(!caster)throw Error('No stock GLB caster');
 }
 caster.castShadow=true;let shadowDraws=0;caster.onBeforeShadow=()=>shadowDraws++;
 const light=new T.DirectionalLight(0xffffff,2);light.position.set(8,8,0);light.castShadow=true;light.shadow.mapSize.set(512,512);Object.assign(light.shadow.camera,{left:-8,right:8,top:8,bottom:-8,near:.1,far:30});light.shadow.camera.updateProjectionMatrix();scene.add(light,light.target);scene.updateMatrixWorld(true);
 const target=new T.RenderTarget(128,128,{type:T.FloatType});target.texture.colorSpace=T.NoColorSpace;r.setRenderTarget(target);
 const capture=async()=>{light.shadow.needsUpdate=true;await new Promise((res,rej)=>{r.setAnimationLoop(()=>{try{r.render(scene,camera);r.setAnimationLoop(null);res();}catch(e){r.setAnimationLoop(null);rej(e);}}).catch(rej);});const raw=await r.readRenderTargetPixelsAsync(target,0,0,128,128);const bytes=new Uint8Array(raw.buffer,raw.byteOffset,raw.byteLength);let s='';for(let i=0;i<bytes.length;i+=4096)s+=String.fromCharCode(...bytes.subarray(i,i+4096));return btoa(s);};
 try{const opaque=await capture();caster.castShadow=false;const clear=await capture();caster.castShadow=true;const repeat=await capture();return {backend:actualBackend,gpu,kind,opaque,clear,repeat,errors,shadowDraws,meshes:meshes.map(o=>({name:o.name,material:o.material.type,normal:Array.from(o.geometry.attributes.normal.array.slice(0,3)),castShadow:o.castShadow,receiveShadow:o.receiveShadow,bounds:{min:new T.Box3().setFromObject(o).min.toArray(),max:new T.Box3().setFromObject(o).max.toArray()}}))};}
 finally{target.dispose();light.shadow.dispose();light.dispose();for(const m of meshes){m.geometry.dispose();m.material.dispose();}r.dispose();}
};`;
const producer=await readFile(import.meta.filename);await writeFile(join(out,'producer.mjs'),producer);await writeFile(join(out,'fixture.js'),fixture);await writeFile(join(out,'index.html'),'<link rel="icon" href="data:,"><script type="module" src="/fixture.js"></script>');
const aliases=[['three/webgpu','build/three.webgpu.js'],['three/addons','examples/jsm'],['three','build/three.module.js']].map(([find,suffix])=>({find:find==='three'?/^three$/:find,replacement:root+'/node_modules/three/'+suffix}));
const server=await createServer({root:out,publicDir:native,configFile:false,logLevel:'warn',resolve:{alias:aliases},server:{host:'127.0.0.1',port:0,fs:{allow:[root,out,native]}}});
const report={status:'RUNNING',supportCredit:0,producerSha256:sha(producer),finalGlbSha256:sha(await readFile(join(native,'shadow.glb'))),rows:[],errors:[]};let browser;
const diff=(a,b)=>{let n=0,max=0;for(let i=0;i<a.length;i+=4){if(a.readUInt32LE(i)!==b.readUInt32LE(i))n++;max=Math.max(max,Math.abs(a.readFloatLE(i)-b.readFloatLE(i)));}return{differentWords:n,maxAbs:max}};
try{await server.listen();browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']});
 for(const backend of ['webgpu','webgl2'])for(const kind of ['basic','stock-glb']){
  const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())});page.on('response',r=>{if(r.status()>=400)report.errors.push(r.status()+' '+r.url())});await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>typeof window.run==='function');
  const row=await page.evaluate(([b,k])=>window.run(b,k),[backend,kind]),raw={};row.fields={};for(const field of ['opaque','clear','repeat']){const bytes=Buffer.from(row[field],'base64'),file=backend+'-'+kind+'-'+field+'.f32';assert.equal(bytes.length,128*128*16);await writeFile(join(out,file),bytes);raw[field]=bytes;row.fields[field]={file,sha256:sha(bytes)};delete row[field];}
  row.opaqueVsClear=diff(raw.opaque,raw.clear);row.repeatVsOpaque=diff(raw.repeat,raw.opaque);report.rows.push(row);await page.close();
 }
 assert.deepEqual(report.errors,[]);for(const row of report.rows){assert.deepEqual(row.errors,[]);assert.ok(row.opaqueVsClear.differentWords>100,'Missing shadow: '+row.backend+'/'+row.kind);assert.equal(row.repeatVsOpaque.differentWords,0)}report.status='BASIC_AND_STOCK_GLB_SHADOW_CONTROLS_PASS';
}catch(e){report.status='FAILED';report.failure=String(e);process.exitCode=1}
finally{await browser?.close();await server.close();await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
