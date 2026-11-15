// Shared structural engine, deliberately independent of numerical oracles.
type Schema=Record<string,any>
const equal=(a:unknown,b:unknown):boolean=>JSON.stringify(a)===JSON.stringify(b)
export function validate(schema:Schema,value:unknown,schemas:Record<string,Schema>,path='$',budget={count:0,maxValues:100000,maxDepth:64},depth=0):void{
 if(++budget.count>budget.maxValues||depth>budget.maxDepth)throw Error(path+': structural budget')
 const fail=()=>{throw Error(path+': structural contract')}
 if(schema.ref)return validate(schemas[schema.ref],value,schemas,path,budget,depth+1)
 if('constant'in schema){if(!equal(value,schema.constant))fail();return}
 if(schema.enum){if(!schema.enum.some((x:unknown)=>equal(value,x)))fail();return}
 if(schema.union){for(const item of schema.union){try{validate(item,value,schemas,path,budget,depth+1);return}catch(e){if(budget.count>budget.maxValues)throw e}}return fail()}
 if(schema.type==='json'){if(value===null||typeof value==='boolean'||typeof value==='string')return;if(typeof value==='number'&&Number.isFinite(value))return;if(Array.isArray(value)){for(const x of value)validate(schema,x,schemas,path,budget,depth+1);return}if(value&&typeof value==='object'){for(const x of Object.values(value))validate(schema,x,schemas,path,budget,depth+1);return}return fail()}
 if(schema.type==='string'){if(typeof value!=='string'||value.length<(schema.minLength??0)||schema.pattern&&!new RegExp(schema.pattern).test(value))fail();return}
 if(schema.type==='number'||schema.type==='integer'){if(typeof value!=='number'||!Number.isFinite(value)||schema.type==='integer'&&!Number.isInteger(value)||schema.rejectNegativeZero&&Object.is(value,-0)||value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity))fail();return}
 if(schema.type==='array'){if(!Array.isArray(value)||value.length<schema.minItems||value.length>schema.maxItems||Object.keys(value).join()!==Array.from({length:value.length},(_,i)=>String(i)).join())return fail();for(let i=0;i<value.length;i++)validate(schema.tuple?.[i]??schema.items,value[i],schemas,path+'['+i+']',budget,depth+1);return}
 if(schema.type==='object'||schema.type==='map'){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return fail();const v=value as Record<string,unknown>,keys=Object.keys(v);if(keys.some(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return !d||!('value'in d)}))return fail();if(schema.type==='map'){if(keys.length>schema.maxKeys)return fail();for(const k of keys)validate(schema.values,v[k],schemas,path+'.'+k,budget,depth+1);return}const fields=schema.fields,optional=schema.optional??[];if(keys.some(k=>!Object.hasOwn(fields,k))||Object.keys(fields).some(k=>!Object.hasOwn(v,k)&&!optional.includes(k)))return fail();for(const k of keys)validate(fields[k],v[k],schemas,path+'.'+k,budget,depth+1);return}
 return fail()
}
