// Research-only compiler adaptation. No Radial arithmetic or native branches change.
import assert from'node:assert/strict'
import{Accessor,Operator,Return,VariableDeclaration}from'three/addons/transpiler/AST.js'
const children=node=>Object.entries(node).filter(([key])=>!['parent','linker'].includes(key)).flatMap(([,value])=>Array.isArray(value)?value:value?.isASTNode?[value]:[]).filter(value=>value?.isASTNode)
function containsReturn(node){return !!node&&(node.isReturn||children(node).some(containsReturn))}
export function inspectReturns(ast){const rows=[];for(const fn of ast.body.filter(node=>node.isFunctionDeclaration)){let nested=0,total=0;const visit=(node,depth)=>{if(node.isReturn){total++;if(depth)nested++}for(const child of children(node))visit(child,depth+(node.isConditional?1:0))};fn.body.forEach(node=>visit(node,0));rows.push({name:fn.name,total,nested})}return rows}
export function lowerExhaustiveTailReturns(ast){const records=[]
 for(const fn of ast.body.filter(node=>node.isFunctionDeclaration)){
  const before=inspectReturns({body:[fn]})[0];if(!before.nested)continue
  assert.notEqual(fn.type,'void','Value-return lowering cannot rewrite a void function')
  const leaves=[]
  const plan=(body,parent)=>{assert.ok(body.length,'No tail return in empty branch');for(const node of body.slice(0,-1))assert.equal(containsReturn(node),false,'Non-tail early return needs a separate control-flow proof');const last=body.at(-1)
   if(last.isReturn){assert.ok(last.value,'Missing return value');leaves.push({body,parent,node:last});return}
   assert.equal(last.isConditional,true,'Only exhaustive tail conditionals can lower');let branch=last
   while(branch){plan(branch.body,branch);if(!branch.elseConditional){assert.equal(branch.cond,null,'A conditional return path has no final else');break}branch=branch.elseConditional}
  }
  plan(fn.body,fn)
  const reserved=new Set();const names=node=>{if(node.name)reserved.add(node.name);children(node).forEach(names)};names(fn)
  let suffix=0,name;do{name='scenetowebTailReturn'+suffix++}while(reserved.has(name))
  for(const leaf of leaves){const replacement=new Operator('=',new Accessor(name),leaf.node.value);replacement.parent=leaf.parent;leaf.body[leaf.body.length-1]=replacement}
  const variable=new VariableDeclaration(fn.type,name);variable.needsToVar=true;variable.parent=fn;const terminal=new Return(new Accessor(name));terminal.parent=fn;fn.body.unshift(variable);fn.body.push(terminal)
  records.push({function:fn.name,type:fn.type,tailLeaves:leaves.length,resultVariable:name,exhaustivePathsProved:true})
 }
 return records
}
