/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {readdir,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {hash} from '../../scripts/lib/runtime-provenance.mjs'
export const familyFiles=['cases.json','browser-contract.mjs','same-frame.mjs','readback-transport.mjs','readback-server.mjs','protocol.mjs','source.py','reference.py','export.test.ts','sources.json','capture.mjs','inputs.mjs']
export async function nativeInputs(root){
 const files=familyFiles.map(name=>'experiments/compositor-displace-single/'+name)
 files.push('packages/blender-addon/tests/compositor_reference.py','experiments/compositor-ellipse-scene-mix/raw-display-sources.json')
 for(const folder of['packages/blendlink/blender','packages/blender-addon'])for(const name of await readdir(join(root,folder)))if(name.endsWith('.py')||name.endsWith('.json'))files.push(folder+'/'+name)
 return Object.fromEntries(await Promise.all(files.sort().map(async file=>[file,hash(await readFile(join(root,file)))])))
}

export async function assertPackagedInputs(root,entries){
 assert.ok(Array.isArray(entries)&&entries.length>0,'Missing packaged Python/addon provenance')
 for(const row of entries)for(const path of[row.source,row.artifact])assert.equal(hash(await readFile(join(root,path))),row.sha256,'Packaged Python/addon drift: '+path)
}
