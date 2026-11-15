// SPDX-License-Identifier: GPL-3.0-or-later
// Independent diagnostic adapter. Preserves original failed archive/reader.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { closeStage } from './compare.mjs'
import { compare } from '../box-image-transport-prototype/compare.mjs'
// W3C WebGPU coordinate systems: framebuffer origin is top-left.
// Three WebGPUTextureUtils.copyTextureToBuffer returns raw API rows.
// GL readPixels uses lower-left origin. These declared origins select the
// adapter, before the independent face/position/normal controls validate it.
// https://www.w3.org/TR/webgpu/#coordinate-systems
// https://registry.khronos.org/OpenGL/specs/es/2.0/es_full_spec_2.0.pdf (ReadPixels)
export function lowerLeftRows(raw, backend, width, height) {
    assert.ok(['webgpu','webgl2'].includes(backend));assert.equal(raw.length,width*height*16)
    if(backend==='webgl2')return raw
    const result=Buffer.alloc(raw.length),stride=width*16
    for(let y=0;y<height;y++)raw.copy(result,(height-y-1)*stride,y*stride,(y+1)*stride)
    return result
}
export async function orientedDiagnostic(nativeDir,browserDir){
    const original=await closeStage(nativeDir,browserDir),n=JSON.parse(await readFile(join(nativeDir,'native.json'))),b=JSON.parse(await readFile(join(browserDir,'browser.json'))),rows=[]
    for(const row of original.rows){
        const nr=[...n.rows,...n.inputControls].find(r=>r.id===row.id||(row.kind==='sampler'&&row.id===r.id+'-'+row.policy)),br=b.apis.find(a=>a.backend===row.api).rows.find(r=>r.id===row.id)
        assert.ok(nr);assert.ok(br)
        const raw=await readFile(join(browserDir,br.file)),expected=await readFile(join(nativeDir,nr.file))
        rows.push({...row,...compare(lowerLeftRows(raw,row.api,64,4),expected,['input','mask','face'].includes(row.kind)?0:2**-10)})
    }
    return {status:'ROW_ORIGIN_DIAGNOSTIC_ZERO_SUPPORT_CREDIT',supportCredit:0,originalStatus:original.status,adapter:'One backend-declared whole-image row reversal for WebGPU to lower-left order; WebGL2 unchanged. No native answers drive adapter.',rows,stageTotals:['mask','input','normal','weights','face','position','sampler'].map(kind=>{const r=rows.filter(r=>r.kind===kind);return {kind,words:r.reduce((s,r)=>s+r.words,0),violations:r.reduce((s,r)=>s+r.violations,0),maxAbs:Math.max(...r.map(r=>r.maxAbs))}})}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){const result=await orientedDiagnostic(resolve(process.argv[2]),resolve(process.argv[3]));await writeFile(resolve(process.argv[4]),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.stageTotals))}
