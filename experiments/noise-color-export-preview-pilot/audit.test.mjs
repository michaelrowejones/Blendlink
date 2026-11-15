import assert from'node:assert/strict'
import test from'node:test'
import{spawnSync}from'node:child_process'
import{readFile,mkdtemp,mkdir,symlink,rm,realpath}from'node:fs/promises'
test('actual production helper folds six Metal Color constants to captured native words',()=>{
 const child=spawnSync('python3',[new URL('./audit.py',import.meta.url).pathname],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);const r=JSON.parse(child.stdout);assert.equal(r.SDKChangeRequiredForThisOffsetIssue,false);assert.equal(r.rows.length,6);assert.equal(r.rows.filter(x=>x.stagedExperimentalWord!==x.nativeWord).length,1);for(const x of r.rows)assert.equal(x.productionLiteralWord,x.nativeWord)
})
test('all Python fixtures parse without importing bpy or rendering',async()=>{
 for(const file of['audit.py','fixture.py','reference.py']){const child=spawnSync('python3',['-c','import ast,sys; ast.parse(sys.stdin.read())'],{input:await readFile(new URL(file,import.meta.url),'utf8'),encoding:'utf8'});assert.equal(child.status,0,child.stderr)}
})

test('Vite allow roots use the same canonical artifact paths as native Python',async()=>{
 const {allowedRoots}=await import('./paths.mjs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),dir=await mkdtemp(join(tmpdir(),'noise-preview-paths-'))
 try{await mkdir(join(dir,'owned'));await symlink(join(dir,'owned'),join(dir,'alias'),'dir');const roots=await allowedRoots([join(dir,'alias'),join(dir,'owned')]);assert.ok(roots.includes(join(dir,'alias')));assert.ok(roots.includes(await realpath(join(dir,'owned'))));for(const root of roots)assert.equal(await realpath(root),await realpath(join(dir,'owned')))}finally{await rm(dir,{recursive:true,force:true})}
})

test('owned plain preview constructs explicit renderer-sizing ownership',async()=>{
 const ts=await import('typescript'),source=await readFile(new URL('./browser.js',import.meta.url),'utf8'),tree=ts.createSourceFile('browser.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let argument
 const walk=node=>{if(ts.isCallExpression(node)&&node.expression.getText(tree)==='startThreeCompiledScenePreparation')argument=node.arguments[0];ts.forEachChild(node,walk)};walk(tree);assert.ok(argument&&ts.isObjectLiteralExpression(argument));const renderer={},scene={},descriptor={},proof={assetBaseUrl:'http://127.0.0.1/'};const options=Function('renderer','scene','descriptor','proof','return ('+argument.getText(tree)+')')(renderer,scene,descriptor,proof);assert.equal(options.resizeRenderer,true);assert.equal(options.renderer,renderer);assert.deepEqual(options.viewport,{width:64,height:64})
})
