import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import { captureRuntimeSnapshot, hash } from '../../scripts/lib/runtime-provenance.mjs'
import { freezeTslHarness } from '../../scripts/lib/frozen-tsl-harness.mjs'


const root = resolve(import.meta.dirname, '../..'), baseline = resolve(process.argv[2]), reference = resolve(process.argv[3]), evidence = resolve(process.argv[4])
const before = await captureRuntimeSnapshot({ root:baseline, built:false, destination:join(evidence,'baseline'), label:'finite-field-old-serialized-baseline' })
const candidate = await captureRuntimeSnapshot({ root, built:true, destination:join(evidence,'candidate'), label:'finite-field-production-candidate' })
const harness = freezeTslHarness(root, join(evidence,'candidate'))
const facade = `export {createTslBuildResources,prepareTslNoiseFields} from '@candidate'
import {buildTslColorNode as candidate} from '@candidate'
import {buildTslColorNode as baseline} from '@baseline'
export const buildTslColorNode=(document,options)=>new URLSearchParams(location.search).get('runtime')==='baseline'?baseline(document,options):candidate(document,options)
`
await writeFile(join(evidence, 'facade.ts'), facade)
const names = ['noise-4d', 'noise-4d-color-distortion']
await mkdir(join(evidence, 'ir'), { recursive: true })
const documents = []
for (const name of names) {
  const bytes = await readFile(join(root, 'experiments/tsl-node-differential/output/reference/ir', name + '.json'))
  assert.equal(JSON.parse(bytes).output.op, 'noise')
  await writeFile(join(evidence, 'ir', name + '.json'), bytes)
  documents.push({ name, sha256: hash(bytes) })
}
const index=JSON.parse(await readFile(join(reference,'index.json')))
const input=JSON.parse(await readFile(join(reference,'ir',index.cases.find(cell=>cell.kind==='noise').id+'.json')))
const visit=x=>!x||typeof x!=='object'?[]:[...(['noise_fractal','noise_normalized'].includes(x.op)?[x]:[]),...Object.values(x).flatMap(visit)]
for(const [name,change]of Object.entries({
 'fresh-low-detail': x=>{x.detail=3},
 'fresh-fac': x=>{x.output='fac'},
 'fresh-direct-uv': x=>{x.detail=1;x.input={op:'uv'};x.w={op:'const_float',value:.375}},
 'fresh-distorted': x=>{x.detail=1;x.distortion=.5;x.distortionOffsets=[[.125,.25,.375,.5],[.25,.375,.5,.625],[.375,.5,.625,.75],[.5,.625,.75,.875]]},
})){
 const document=structuredClone(input),nodes=visit(document);assert.ok(nodes.length)
 for(const node of nodes){change(node)}
 const bytes=Buffer.from(JSON.stringify(document));await writeFile(join(evidence,'ir',name+'.json'),bytes)
 names.push(name);documents.push({name,sha256:hash(bytes),nativeReferenceClaim:false,kind:'baseline-vs-overlay byte compatibility'})
}
// The previously eligible old precise field MUST remain the GPU program.
// Merely being an image/control pattern is not a new serialized profile.
const oldBytes=Buffer.from(JSON.stringify(input));await writeFile(join(evidence,'ir/old-precise-field.json'),oldBytes)
names.push('old-precise-field');documents.push({name:'old-precise-field',sha256:hash(oldBytes)})
for(const [name,output]of Object.entries({
 'math-large-modulo':{op:'math',operation:'MODULO',a:{op:'const_float',value:1074100096},b:{op:'const_float',value:100000}},
 'math-cancellation':{op:'math',operation:'SUBTRACT',a:{op:'math',operation:'ADD',a:{op:'const_float',value:1e8},b:{op:'const_float',value:1}},b:{op:'const_float',value:1e8}},
 'math-round-negative-half':{op:'math',operation:'ROUND',a:{op:'const_float',value:-.5}},
 'math-negative-zero':{op:'math',operation:'MULTIPLY',a:{op:'const_float',value:-0},b:{op:'const_float',value:1}},
})){
 let text=JSON.stringify({schemaVersion:1,model:'blendlink-tsl-ir-v1',output})
 if(name==='math-negative-zero')text=text.replace('"value":0','"value":-0')
 const bytes=Buffer.from(text);await writeFile(join(evidence,'ir',name+'.json'),bytes)
 names.push(name);documents.push({name,sha256:hash(bytes)})
}
await writeFile(join(evidence, 'ir/control.json'), JSON.stringify({ schemaVersion: 1, model: 'blendlink-tsl-ir-v1',
  output: { op: 'const_vec3', value: [.125, .5, .875] } }))
const server = await createServer({ configFile: false, root: harness.directory,
  cacheDir: join(evidence, 'vite-cache'), logLevel: 'warn', optimizeDeps: { noDiscovery: true },
  resolve: { dedupe: ['three'], alias: { '@blendlink-tsl-recipe': join(evidence, 'facade.ts'),
    '@candidate': join(evidence, 'candidate/tslNodeRecipe.js'), '@baseline': join(evidence, 'baseline/tslNodeRecipe.ts') } },
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: [root, baseline, evidence] } } })
const rows = [], comparisons = [], profiles = ['shell', 'chromium']
try {
  await server.listen()
  for (const profile of profiles) {
    const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'],
      ...(profile === 'chromium' ? { channel: 'chromium' } : {}) })
    try {
      for (const backend of ['webgpu', 'webgl2']) {
        const buffers = new Map()
        for (const runtime of ['baseline', 'candidate']) {
          const page = await browser.newPage(), errors = []
          page.on('pageerror', error => errors.push(String(error)))
          page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
          try {
            await page.goto(server.resolvedUrls.local[0] + '?backend=' + backend + '&runtime=' + runtime)
            const initialized = await page.evaluate(() => window.__tslDiffInit())
            assert.equal(initialized.error, null); assert.equal(initialized.backend, backend === 'webgpu')
            for (const name of ['control', ...names]) {
              const rendered = await page.evaluate(({ name, path }) => window.__tslDiffRun(name, 'ir', path, false, null),
                { name, path: '/@fs/' + join(evidence, 'ir', name + '.json') })
              assert.ok(rendered.ok, rendered.error)
              const bytes = Buffer.from(rendered.base64, 'base64'), values = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
              assert.ok(values.every(Number.isFinite))
              if (name === 'control') {
                for (let index = 0; index < values.length; index += rendered.components)
                  assert.deepEqual(Array.from(values.subarray(index, index + 3)), [.125, .5, .875])
              } else {
                let low = Infinity, high = -Infinity
                for (let index = 0; index < values.length; index += rendered.components) { low = Math.min(low, values[index]); high = Math.max(high, values[index]) }
                if (!name.startsWith('math-')) assert.ok(high - low > .01, 'Legacy control unexpectedly became a flat field')
                const file = `${profile}-${backend}-${runtime}-${name}.f32`
                await writeFile(join(evidence, file), bytes)
                rows.push({ profile, backend, runtime, name, file, sha256: hash(bytes), environment: await page.evaluate(() => window.__tslDiffEnvironment()) })
                if (runtime === 'baseline') buffers.set(name, bytes)
                else {
                  const old = buffers.get(name); assert.equal(bytes.length, old.length)
                  let mismatches = 0
                  for (let index = 0; index < bytes.length; index += 4) if (bytes.readUInt32LE(index) !== old.readUInt32LE(index)) mismatches++
                  comparisons.push({ profile, backend, name, words: bytes.length / 4, mismatches })
                  assert.equal(mismatches, 0, profile + '/' + backend + '/' + name)
                }
              }
              assert.deepEqual(errors, [])
            }
          } finally { await page.close() }
        }
      }
    } finally { await browser.close() }
  }
} finally {
  await server.close()
  await writeFile(join(evidence, 'report.json'), JSON.stringify({ reference, root, documents, facadeSha256: hash(facade),
    candidateProvenance: candidate.provenance, baselineProvenance: before.provenance, rows, comparisons }, null, 2))
}
assert.equal(comparisons.length, names.length * 4)
console.log('BLENDLINK_PRODUCTION_FINITE_NOISE_LEGACY_PASSED', comparisons.reduce((sum, row) => sum + row.words, 0), 'Float32 words')
