import assert from 'node:assert/strict'
import {cp,readFile,writeFile,readdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import ts from 'typescript'
import {hash} from '../../scripts/lib/runtime-provenance.mjs'

/** Explicit research overlay. The reviewed production snapshot stays intact;
 * every modified/tested byte is retained separately and labeled experimental. */
export async function applyFieldScheduleOverlay({root,snapshot,built,provenance}){
 const destination=snapshot+'-color-schedule';await rm(destination,{recursive:true,force:true});await cp(snapshot,destination,{recursive:true})
 const extension=built?'js':'ts',name='tslNodeRecipe.'+extension,path=join(destination,name)
 const before=await readFile(path,'utf8'),anchor='const fac = fractal(position)'
 assert.ok(!before.includes('position = buildNoiseFieldBarrier'), 'Remove the failed coordinate-uniform activation before testing its successor')
 assert.equal(before.split(anchor).length,2,'Field schedule anchor drifted')
 const after="import { buildFieldColorSchedule } from './fieldColorSchedule.js'\nimport { usesNoiseFieldBarrier } from './tslNoiseFieldBarrier.js'\n"+
  before.replace(anchor,"if (usesNoiseFieldBarrier(expression)) return buildFieldColorSchedule(position, expression.colorOffsets, fractal, fail);\n      "+anchor)
 await writeFile(path,after)
 const helperPath=join(root,'experiments/noise-field-kernel/color-schedule.mts'),source=await readFile(helperPath,'utf8')
 const helper=built?ts.transpileModule(source,{fileName:helperPath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText:source
 const helperName='fieldColorSchedule.'+extension;await writeFile(join(destination,helperName),helper)
 const files=[]
 for(const file of (await readdir(destination)).sort())if(file.endsWith('.'+extension))files.push({name:file,sha256:hash(await readFile(join(destination,file)))})
 return {snapshot:destination,provenance:{mode:'experimental-overlay',baseline:provenance,
  experimentalOverlay:{name:'fixed-three-lane-color-schedule-v1',helperSource:helperPath,helperSourceSha256:hash(source),
   helperName,helperSha256:hash(helper),recipeBeforeSha256:hash(before),recipeAfterSha256:hash(after),typescript:ts.version},
  snapshot:{directory:destination,files,sourceMaps:[]}}}
}

export async function applyFieldTableOverlay({root,snapshot,built,provenance}){
 const destination=snapshot+'-nearest-table';await rm(destination,{recursive:true,force:true});await cp(snapshot,destination,{recursive:true})
 const extension=built?'js':'ts',name='tslNodeRecipe.'+extension,path=join(destination,name)
 const before=await readFile(path,'utf8'),anchor="let position = build(child(expression, 'input'))"
 assert.ok(!before.includes('position = buildNoiseFieldBarrier'),'Remove failed coordinate-uniform activation first')
 assert.equal(before.split(anchor).length,2,'Nearest field lowering anchor drifted')
 const after="import { lowerNearestNoiseField } from './fieldNearestTable.js'\n"+before.replace(anchor,
  "const finiteField = lowerNearestNoiseField(expression);\n      if (finiteField) { globalThis.__fieldTableDiagnostic?.(finiteField.stats); return build(finiteField.image); }\n      "+anchor)
 await writeFile(path,after)
 const helperPath=join(root,'experiments/noise-field-kernel/nearest-table.mts'),source=await readFile(helperPath,'utf8')
 const mapped=source.replaceAll('../../packages/blendlink/src/','./')
 const helper=built?ts.transpileModule(mapped,{fileName:helperPath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText:mapped
 const helperName='fieldNearestTable.'+extension;await writeFile(join(destination,helperName),helper)
 const files=[]
 for(const file of(await readdir(destination)).sort())if(file.endsWith('.'+extension))files.push({name:file,sha256:hash(await readFile(join(destination,file)))})
 return {snapshot:destination,provenance:{mode:'experimental-overlay',baseline:provenance,
  experimentalOverlay:{name:'finite-nearest-field-table-v1',helperSource:helperPath,helperSourceSha256:hash(source),
   sourceImportRewrite:'../../packages/blendlink/src/ to ./',helperName,helperSha256:hash(helper),recipeBeforeSha256:hash(before),recipeAfterSha256:hash(after),typescript:ts.version},
  snapshot:{directory:destination,files,sourceMaps:[]}}}
}
