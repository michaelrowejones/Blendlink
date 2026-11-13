import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'
const url=process.argv[2],output=resolve(process.argv[3]??'artifacts/camera-data/preview-proof.json')
if(!url)throw new Error('Pass the actual Preview Studio URL for an ordinary Camera Data fixture')
const status=await(await fetch(new URL('/.blendlink-preview-status.json',url))).json()
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),sourceHash=hash(await readFile(status.blendPath))
const browser=await chromium.launch({headless:true,...(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL?{channel:process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL}:{}),
  args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS??'[]')]})
const rows=[]
try{
  for(const backend of ['webgpu','webgl2']){
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),programs=[],errors=[]
    page.on('pageerror',error=>errors.push(error.message))
    page.on('response',response=>{if(/\.materials\.json(?:\?|$)/.test(response.url()))programs.push(response.json())})
    await page.addInitScript(()=>{
      window.cameraDevices=[]
      if(!globalThis.GPUAdapter)return
      const original=GPUAdapter.prototype.requestDevice
      GPUAdapter.prototype.requestDevice=async function(...args){
        const device=await original.apply(this,args),row={vendor:this.info?.vendor,architecture:this.info?.architecture,description:this.info?.description,destroyed:false}
        window.cameraDevices.push(row);const destroy=device.destroy.bind(device)
        device.destroy=()=>{row.destroyed=true;return destroy()};return device
      }
    })
    const target=new URL(url);if(backend==='webgl2')target.searchParams.set('backend','webgl2')
    await page.goto(target.href)
    const ready=()=>page.waitForFunction(()=>document.querySelector('#status-chip')?.dataset.phase==='ready',null,{timeout:60000})
    await page.waitForFunction(()=>['ready','failed'].includes(document.querySelector('#status-chip')?.dataset.phase),null,{timeout:60000})
    if(await page.locator('#retry-preview').isVisible())await page.locator('#retry-preview').click()
    await ready()
    assert.ok((await Promise.all(programs)).some(program=>JSON.stringify(program).includes('"op":"camera_data_native"')))
    const captures=[]
    for(const [name,size] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
      await page.setViewportSize(size);await page.waitForTimeout(300);await ready()
      const canvas=page.locator('canvas.active');assert.equal(await canvas.count(),1)
      captures.push({name,viewport:size,...await canvas.evaluate(element=>{
        const rect=element.getBoundingClientRect(),gl=element.getContext('webgl2'),debug=gl?.getExtension('WEBGL_debug_renderer_info')
        return {css:[rect.width,rect.height],drawingBuffer:[element.width,element.height],dpr:devicePixelRatio,gpu:gl?{vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}:window.cameraDevices}
      })})
    }
    await page.setViewportSize({width:180,height:180})
    await page.waitForFunction(()=>document.querySelector('#status-chip')?.dataset.phase==='failed',null,{timeout:15000})
    await page.setViewportSize({width:1440,height:1000})
    const details=page.getByRole('button',{name:'View error details',exact:true});if(await details.isVisible())await details.click()
    const failure=await page.locator('body').innerText();assert.match(failure,/Camera Data angular footprint is unproven/)
    await page.setViewportSize({width:1440,height:1000});await page.locator('#retry-preview').click();await ready()
    assert.deepEqual(errors,[])
    rows.push({backend,captures,resizeFailure:failure,recovered:true,devices:await page.evaluate(()=>window.cameraDevices)})
    await page.close()
  }
  assert.equal(hash(await readFile(status.blendPath)),sourceHash)
  await mkdir(resolve(output,'..'),{recursive:true})
  await writeFile(output,JSON.stringify({source:status.blendPath,sourceSha256:sourceHash,sourceUnchanged:true,rows},null,2)+'\n')
  console.log('BLENDLINK_CAMERA_DATA_PREVIEW_PASSED '+output)
}finally{await browser.close()}
