import test from'node:test';import assert from'node:assert/strict'
import{cases,expectedFinalCases,resizeCount,browserProofContract,assertPolicy,policyPositive,policyRefusals}from'./protocol.mjs'
test('Quaternion family closes four endpoint words and signed basis/scale without shader claims',()=>{assert.equal(cases.length,72);assert.equal(new Set(cases.map(r=>r.case)).size,72);assert.equal(expectedFinalCases().length,12);assert.equal(cases.reduce((n,r)=>n+r.indices.length,0),144);assert.equal(cases.filter(r=>r.manualQuaternionWords).length,50);for(const route of['direct','float-group','rotation-group','endpoint-group','reroute','selector'])assert.ok(cases.some(r=>r.route===route));assert.equal(cases.filter(resizeCount).length,2);assert.equal(Object.isFrozen(browserProofContract),true)})

test('policy closes ordered positive/refusal census and forbids GPU or render credit',()=>{const good={status:'STATIC_ROTATION_SOURCE_POLICY_PASSED',positive:policyPositive,refusals:policyRefusals,gpuInitializationCalls:0,renders:0,supportCredit:0,scriptSha256:'a'.repeat(64)};assertPolicy(good);for(const mutate of[x=>x.positive.pop(),x=>x.refusals.reverse(),x=>x.gpuInitializationCalls=1,x=>x.renders=1,x=>x.supportCredit=1,x=>x.scriptSha256='invalid']){const bad=structuredClone(good);mutate(bad);assert.throws(()=>assertPolicy(bad))}})

// Parse the actual Python producer without importing bpy. This checks its literal
// loop labels against the JS consumer instead of duplicating the intended IDs.
test('native Python scale IDs are literal and match the JavaScript closed policy',async()=>{
 const{spawnSync}=await import('node:child_process');const{resolve}=await import('node:path');const file=resolve(import.meta.dirname,'../../packages/blender-addon/tests/compositor_static_rotation_check.py');
 const script=`import ast,json,sys
tree=ast.parse(open(sys.argv[1]).read())
loops=[n for n in ast.walk(tree) if isinstance(n,ast.For) and isinstance(n.target,ast.Tuple) and [x.id for x in n.target.elts if isinstance(x,ast.Name)]==['label','scale']]
assert len(loops)==1
loop=loops[0]
labels=[ast.literal_eval(row.elts[0]) for row in loop.iter.elts]
assert any(isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='extracted' and len(n.args)==1 and isinstance(n.args[0],ast.Name) and n.args[0].id=='label' for child in loop.body for n in ast.walk(child))
print(json.dumps(labels))`;
 const result=spawnSync(process.env.PYTHON??'python3',['-c',script,file],{encoding:'utf8',timeout:10000});assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),policyPositive.filter(id=>id.startsWith('scale-')));assert.deepEqual(JSON.parse(result.stdout),['scale-min','scale-max']);
 const old={status:'STATIC_ROTATION_SOURCE_POLICY_PASSED',positive:policyPositive.map(id=>id==='scale-min'?'scale-1.52587890625e-05':id),refusals:policyRefusals,gpuInitializationCalls:0,renders:0,supportCredit:0,scriptSha256:'a'.repeat(64)};assert.throws(()=>assertPolicy(old));
})
