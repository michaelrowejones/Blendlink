import {createHash} from 'node:crypto'

export const GLSL_CENSUS_LIMITS=Object.freeze({sourceBytes:1048576,tokens:250000,nesting:128,functions:256,parameters:32,globals:512})
export class GlslSourceCensusError extends Error{
 constructor(message,details={}){super('GLSL source census: '+message);this.name='GlslSourceCensusError';this.details=Object.freeze({...details,numericalCredit:0})}
}
const fail=(message,details)=>{throw new GlslSourceCensusError(message,details)}
const identifier=value=>typeof value==='string'&&/^[A-Za-z_]\w*$/.test(value)
const precision=new Set(['lowp','mediump','highp'])
const directions=new Set(['in','out','inout'])

/** Independent bounded lexer. Input must already be explicitly preprocessed GLSL. */
function lex(source){
 if(typeof source!=='string'||Buffer.byteLength(source)>GLSL_CENSUS_LIMITS.sourceBytes)fail('source exceeds the bounded UTF8 byte limit or is not text')
 const tokens=[];let i=0
 const push=text=>{if(tokens.length>=GLSL_CENSUS_LIMITS.tokens)fail('source exceeds the token limit');tokens.push(text)}
 while(i<source.length){
  const rest=source.slice(i),ch=source[i]
  if(/\s/.test(ch)){i++;continue}
  if(rest.startsWith('//')){const end=source.indexOf('\n',i+2);i=end<0?source.length:end+1;continue}
  if(rest.startsWith('/*')){const end=source.indexOf('*/',i+2);if(end<0)fail('unterminated block comment');i=end+2;continue}
  if(ch==='#')fail('preprocessor directives require an explicit preprocessing stage')
  if(ch==='"'||ch==="'")fail('string/character literals are outside the reviewed GLSL grammar')
  const match=/^(?:[A-Za-z_]\w*|0[xX][0-9a-fA-F]+[uU]?|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[fFuU]?|<<=|>>=|\+\+|--|==|!=|<=|>=|&&|\|\||<<|>>|[{}()[\];,.?:+*/%<>=!&|^~\-])/.exec(rest)
  if(!match)fail('unsupported source token at offset '+i)
  push(match[0]);i+=match[0].length
 }
 return tokens
}
function groups(tokens){
 const stack=[],pairs=new Map(),opening={'(':')','[':']','{':'}'}
 for(let i=0;i<tokens.length;i++){
  const token=tokens[i]
  if(opening[token]){stack.push([token,i]);if(stack.length>GLSL_CENSUS_LIMITS.nesting)fail('source exceeds delimiter nesting limit')}
  else if([')',']','}'].includes(token)){
   const previous=stack.pop();if(!previous||opening[previous[0]]!==token)fail('unbalanced source delimiters')
   pairs.set(previous[1],i)
  }
 }
 if(stack.length)fail('unbalanced source delimiters')
 return pairs
}
function parameter(tokens){
 let immutable=false,qualifier=null,index=0
 while(tokens[index]==='const'||directions.has(tokens[index])){
  const token=tokens[index++]
  if(token==='const'){if(immutable)fail('duplicate const parameter qualifier');immutable=true}
  else{if(qualifier!==null)fail('duplicate parameter direction qualifier');qualifier=token}
 }
 if(precision.has(tokens[index]))fail('parameter precision qualifiers are outside the reviewed AST signature model')
 if(tokens.length-index!==2||!identifier(tokens[index])||!identifier(tokens[index+1]))fail('parameters require one explicit type/name; arrays and unnamed parameters are outside the reviewed grammar')
 return{type:tokens[index],name:tokens[index+1],qualifier,immutable}
}
function parameters(tokens){
 if(!tokens.length)return[]
 const segments=[];let start=0
 for(let i=0;i<=tokens.length;i++)if(i===tokens.length||tokens[i]===','){segments.push(tokens.slice(start,i));start=i+1}
 if(segments.length>GLSL_CENSUS_LIMITS.parameters)fail('function exceeds parameter limit')
 const result=segments.map(parameter)
 if(new Set(result.map(p=>p.name)).size!==result.length)fail('duplicate parameter name')
 return result
}
function globalDeclarations(header){
 let i=0,immutable=false
 if(header[i]==='const'){immutable=true;i++}
 const type=header[i++],name=header[i++]
 if(!identifier(type)||!identifier(name)||['return','break','continue','discard','struct','uniform','layout'].includes(type))fail('unexpected native top-level executable or unsupported declaration')
 const rows=[];let current=name
 while(true){
  rows.push({kind:'global',type,name:current,immutable})
  if(i===header.length)break
  if(header[i]!=='=')fail('global arrays/qualifiers are outside the reviewed declaration grammar')
  i++;const start=i;let depth=0
  for(;i<header.length;i++){
   const token=header[i]
   if(token==='(')depth++
   if(token===')')depth--
   if(['[',']','{','}'].includes(token))fail('global aggregate/array initializers are outside the reviewed grammar')
   if(token===','&&depth===0)break
  }
  if(i===start)fail('empty global initializer')
  if(i===header.length)break
  i++;current=header[i++];if(!identifier(current))fail('global declaration is missing a name')
 }
 return rows
}
const identity=fn=>fn.name+'('+fn.parameters.map(p=>p.type).join(',')+')'
function uniqueFunctions(rows,side){
 const functions=rows.filter(row=>row.kind==='function'),keys=functions.map(identity)
 if(functions.length>GLSL_CENSUS_LIMITS.functions)fail(side+' exceeds function limit')
 if(new Set(keys).size!==keys.length)fail(side+' has duplicate function definitions',{side,functionCount:functions.length})
 return functions
}
/** No dependency on Three's lexer/parser: signatures are read from native text. */
export function nativeGlslCensus(source){
 const tokens=lex(source),pairs=groups(tokens),rows=[];let start=0
 while(start<tokens.length){
  let end=start
  for(;end<tokens.length;end++){
   if(tokens[end]==='('){end=pairs.get(end);continue}
   if(tokens[end]==='{'||tokens[end]===';')break
   if(tokens[end]==='}')fail('unexpected native top-level closing brace')
  }
  if(end===tokens.length)fail('unfinished native top-level declaration')
  const header=tokens.slice(start,end)
  if(tokens[end]==='{'){
   if(header[0]==='[')fail('function attributes require an explicit GLSL ABI adaptation')
   if(header.length<4||!identifier(header[0])||!identifier(header[1])||header[2]!=='('||header.at(-1)!==')')fail('unexpected native top-level executable block or unsupported function signature',{headerStart:header.slice(0,6),headerEnd:header.slice(-6)})
   rows.push({kind:'function',returnType:header[0],name:header[1],parameters:parameters(header.slice(3,-1))})
   start=pairs.get(end)+1
  }else{
   if(header[2]==='(')fail('function prototypes are outside the reviewed definition census')
   rows.push(...globalDeclarations(header));start=end+1
  }
  if(rows.length>GLSL_CENSUS_LIMITS.functions+GLSL_CENSUS_LIMITS.globals)fail('source exceeds top-level declaration limit')
 }
 const functions=uniqueFunctions(rows,'native source')
 if(rows.length-functions.length>GLSL_CENSUS_LIMITS.globals)fail('source exceeds global declaration limit')
 return{rows,functions,tokenCount:tokens.length}
}
function astCensus(ast){
 if(ast?.isProgram!==true||!Array.isArray(ast.body))fail('decoder did not return a Program AST')
 if(ast.body.length>GLSL_CENSUS_LIMITS.functions+GLSL_CENSUS_LIMITS.globals)fail('AST exceeds top-level declaration limit')
 const rows=[]
 for(const node of ast.body){
  if(node?.isComment===true)continue
  if(node?.isFunctionDeclaration===true){
   if(!identifier(node.name)||!identifier(node.type)||!Array.isArray(node.params)||!Array.isArray(node.body)||node.params.length>GLSL_CENSUS_LIMITS.parameters)fail('malformed AST function')
   const parameters=node.params.map(p=>{
    if(p?.isFunctionParameter!==true||!identifier(p.type)||!identifier(p.name)||![null,'in','out','inout'].includes(p.qualifier)||typeof p.immutable!=='boolean')fail('malformed AST parameter signature')
    return{type:p.type,name:p.name,qualifier:p.qualifier,immutable:p.immutable}
   })
   rows.push({kind:'function',returnType:node.type,name:node.name,parameters})
  }else if(node?.isVariableDeclaration===true){
   const seen=new Set();let current=node
   while(current){
    if(seen.has(current)||seen.size>=GLSL_CENSUS_LIMITS.globals)fail('cyclic or excessive AST global declaration chain')
    seen.add(current)
    if(current.isVariableDeclaration!==true||!identifier(current.name)||!identifier(current.type)||typeof current.immutable!=='boolean')fail('malformed AST global declaration')
    rows.push({kind:'global',type:current.type,name:current.name,immutable:current.immutable});current=current.next
   }
  }else fail('unexpected AST top-level executable statement',{kind:node?.constructor?.name??typeof node})
  if(rows.length>GLSL_CENSUS_LIMITS.functions+GLSL_CENSUS_LIMITS.globals)fail('AST exceeds top-level declaration limit')
 }
 uniqueFunctions(rows,'decoder AST')
 return rows
}
/** Validation only. Never mutates source/AST, repairs grammar or emits TSL. */
export function assertGlslSourceCensus(source,ast){
 const native=nativeGlslCensus(source)
 const detail={nativeFunctionCount:native.functions.length,decodedFunctionCount:Array.isArray(ast?.body)?ast.body.filter(row=>row?.isFunctionDeclaration===true).length:0}
 let decoded
 try{decoded=astCensus(ast)}catch(error){
  if(error instanceof GlslSourceCensusError)throw new GlslSourceCensusError(error.message.replace(/^GLSL source census: /,''),{...detail,...error.details})
  throw error
 }
 const functions=decoded.filter(row=>row.kind==='function')
 if(JSON.stringify(native.rows)!==JSON.stringify(decoded)){
  const nativeIds=native.functions.map(identity),astIds=functions.map(identity)
  fail('native/decoded function signatures or top-level declarations differ',{...detail,missing:nativeIds.filter(id=>!astIds.includes(id)),extra:astIds.filter(id=>!nativeIds.includes(id))})
 }
 return Object.freeze({status:'PASSED_GLSL_SOURCE_AST_CENSUS',schemaVersion:1,nativeFunctionCount:native.functions.length,decodedFunctionCount:functions.length,globalDeclarations:decoded.length-functions.length,sourceSha256:createHash('sha256').update(source).digest('hex'),numericalCredit:0})
}
