import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {ownedInputRotationFile} from './input-rotation-owned-files.mjs'
test('owned native and Final captures reject equal-byte aliases, escapes, missing and truncated files',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'input-owned-'));t.after(()=>rm(parent,{recursive:true,force:true}));const root=join(parent,'evidence'),external=join(parent,'external');await mkdir(join(root,'cpu','compiled'),{recursive:true});await mkdir(external)
 const bytes=Buffer.alloc(256,42),native=join(root,'cpu','source.rgba32f'),asset=join(root,'cpu','compiled','scene.glb'),foreign=join(external,'foreign.bin')
 for(const file of [native,asset,foreign])await writeFile(file,bytes)
 assert.equal(await ownedInputRotationFile(root,native,{expectedBytes:256}),await realpath(native));assert.equal(await ownedInputRotationFile(root,'cpu/compiled/scene.glb',{within:'cpu/compiled'}),await realpath(asset))
 await assert.rejects(ownedInputRotationFile(root,foreign));await assert.rejects(ownedInputRotationFile(root,native,{within:'cpu/compiled'}));await assert.rejects(ownedInputRotationFile(root,'cpu/missing.bin'))
 await writeFile(native,bytes.subarray(4));await assert.rejects(ownedInputRotationFile(root,native,{expectedBytes:256}));await writeFile(native,bytes)
 for(const target of [foreign,asset]){await rm(native);await symlink(target,native);await assert.rejects(ownedInputRotationFile(root,native));await rm(native);await writeFile(native,bytes)}
 await symlink(external,join(root,'cpu','alias'));await assert.rejects(ownedInputRotationFile(root,'cpu/alias/foreign.bin'))
 const actual=await readFile(await ownedInputRotationFile(root,asset,{within:'cpu/compiled',expectedBytes:256}));assert.deepEqual(actual,bytes)
})
