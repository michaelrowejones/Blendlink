// SPDX-License-Identifier: GPL-3.0-or-later
import {readRgb8Png,mipChain,byte} from './mip-model-bsl-f32.mjs'
import {closePaired} from './paired-check.mjs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, copyFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { allowedRoots } from '../noise-color-export-preview-pilot/paths.mjs'
import {execFileSync}from'node:child_process'

const [nativeArg, outArg, lease, producerArg, colorNativeArg, colorSchemaArg] = process.argv.slice(2); assert.equal(lease, '--gpu-lease');assert.ok(producerArg,'Exact native producer checkout required');assert.equal(execFileSync('git',['-C',resolve(producerArg),'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'09b5310d8202fb191d1caeb335d169110b35c2f0')
const nativeDir = resolve(nativeArg), out = resolve(outArg), root = resolve(import.meta.dirname, '../..'), three = resolve(root, 'node_modules/three'), dist = resolve(root, 'packages/blendlink/dist'), sha = b => createHash('sha256').update(b).digest('hex')
const nativeBytes = await readFile(join(nativeDir, 'native.json')), native = JSON.parse(nativeBytes), contract = JSON.parse(await readFile(join(nativeDir, 'contract.json'))), inputs = JSON.parse(await readFile(join(nativeDir, 'geometry-inputs.json')))
assert.equal(native.status, 'CAPTURED_BOX_STORAGE_STAGE_RESEARCH')
assert.ok(colorNativeArg&&colorSchemaArg,'Original color capture and source schema are required')
const colorNativeDir=resolve(colorNativeArg),colorSchema=resolve(colorSchemaArg),colorReport=JSON.parse(await readFile(join(colorNativeDir,'native.json'))),schema=JSON.parse(await readFile(colorSchema)),colorGraph=schema.color
assert.equal(colorReport.status,'CAPTURED_ORIGINAL_PLASTER_COLOR_SIGNAL_RESEARCH');assert.equal(schema.sourceSha256,native.sourceSha256);assert.equal(colorReport.sourceSha256,native.sourceSha256)
assert.equal(colorReport.sourcePreserved,true);assert.equal(schema.sourcePreserved,true);assert.equal(schema.productionGuardsChanged,false)

await mkdir(out); const fixture = join(out, 'fixture'); await mkdir(fixture)
for (const name of ['index.html', 'geometry-inputs.mjs', 'gpu-paired-mips.js', 'gl-paired-mips.js']) await copyFile(join(import.meta.dirname, name), join(fixture, name))
await copyFile(join(import.meta.dirname,'browser-paired.js'),join(fixture,'browser.js'))
const customInputs=await Promise.all(native.images.map(async image=>{const bytes=await readFile(join(nativeDir,image.file));assert.equal(sha(bytes),image.sha256);const png=readRgb8Png(bytes);const file='input-'+image.name+'.rgba8';await writeFile(join(fixture,file),png.pixels,{flag:'wx'});assert.ok(['sRGB','Non-Color'].includes(image.colorSpace));let cpuMips
if(image.colorSpace==='Non-Color'){
 cpuMips=await Promise.all(mipChain(png,false,true).map(async(level,index)=>{const name=index===0?file:'input-'+image.name+'-mip-'+index+'.rgba8';if(index)await writeFile(join(fixture,name),Uint8Array.from(level.linear,byte),{flag:'wx'});return{file:name,width:level.size,height:level.size}}))
}
return{image:image.name,width:png.width,file,cpuMips}}))
const report = { status: 'running', nativeSha256: sha(nativeBytes), apis: [], pins: {}, supportCredit: 0 }
async function pin(path) { report.pins[path] = sha(await readFile(path)) }
async function tree(folder) { for (const entry of await readdir(folder, { withFileTypes: true })) { const path = join(folder, entry.name); if (entry.isDirectory()) await tree(path); else if (entry.isFile()) await pin(path) } }
for (const name of ['index.html', 'browser-paired.js', 'browser-paired.mjs', 'gpu-paired-mips.js', 'gl-paired-mips.js', 'mip-model-unorm-store.mjs', 'mip-model-bsl-f32.mjs', 'paired-check.mjs', 'geometry-inputs.mjs', 'cases.mjs']) await pin(join(import.meta.dirname, name))
await pin(join(root, 'experiments/box-material-stage/simplex-candidate.mjs'));await pin(colorSchema);await pin(join(colorNativeDir,'native.json')); await tree(dist); await tree(three)
const server = await createServer({ root: fixture, cacheDir: join(out, 'vite-cache'), configFile: false, publicDir: false, logLevel: 'warn', optimizeDeps: { noDiscovery: true }, resolve: { alias: [{find:'@recipe',replacement:join(dist,'tslNodeRecipe.js')}, { find: '@geometry-context', replacement: join(dist, 'tslGeometryContext.js') }, { find: '@box-candidate', replacement: join(root, 'experiments/box-material-stage/simplex-candidate.mjs') }, { find: 'three/webgpu', replacement: join(three, 'build/three.webgpu.js') }, { find: 'three/tsl', replacement: join(three, 'build/three.tsl.js') }, { find: /^three$/, replacement: join(three, 'build/three.module.js') }], dedupe: ['three'] }, server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: await allowedRoots([root, three, dist, nativeDir, out]) } } })
let browser
try {
    await server.listen(); browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-unsafe-webgpu', '--use-angle=metal'] }); report.browserVersion = browser.version()
    for (const backend of ['webgpu', 'webgl2']) {
        const page = await browser.newPage(), pageErrors = [], httpErrors = []
        page.on('crash',()=>pageErrors.push('BROWSER_PAGE_CRASH'));page.on('pageerror', error => pageErrors.push(String(error))); page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()) })
        page.on('response', response => { if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() }) })
        await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => typeof window.captureBoxNormalStage === 'function')
        let api
        if(backend==='webgl2')await page.evaluate(()=>Object.defineProperty(navigator,'gpu',{configurable:true,value:undefined}))
        try { api = await page.evaluate(p => window.captureBoxNormalStage(p), { backend, contract, native, inputs, customInputs, colorGraph, assetBase: server.resolvedUrls.local[0] + '@fs' + nativeDir + '/' }) }
        catch (error) { api = await page.evaluate(() => window.boxNormalFailure).catch(()=>({backend,status:'FAILED_CAPTURE_CONTEXT',captureError:String(error)})); report.apis.push({ ...api, pageErrors, httpErrors }); throw error }
        assert.match(JSON.stringify(api.gpu), /apple|metal/i); assert.doesNotMatch(JSON.stringify(api.gpu), /swiftshader/i)
        for(const image of api.customMipGeneration.images)for(const[level,mip]of image.levels.entries()){const bytes=Buffer.from(mip.base64,'base64');mip.file=backend+'-'+image.image+'-mip-'+level+'.rgba8';mip.sha256=sha(bytes);await writeFile(join(out,mip.file),bytes,{flag:'wx'});delete mip.base64}
        for (const row of [...api.rows, ...api.lodRows, ...api.materialColorRows, api.storageCalibration]) {
            const bytes = Buffer.alloc(row.words.length * 4); row.words.forEach((word, i) => bytes.writeUInt32LE(word, i * 4)); row.file = backend + '-' + (row.id ?? 'storage-calibration') + '.u32'; row.sha256 = sha(bytes); row.words = row.words.length; await writeFile(join(out, row.file), bytes, { flag: 'wx' })
        }
        report.apis.push({ ...api, pageErrors, httpErrors }); await page.close()
    }
    report.status = 'CAPTURED_BOX_STORAGE_BROWSER_RESEARCH'
} finally { await writeFile(join(out, 'browser.json'), JSON.stringify(report, null, 2) + '\n'); await browser?.close(); await server.close() }
const result = await closePaired(nativeDir, out, producerArg); await writeFile(join(out, 'closed.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result.stageTotals))
