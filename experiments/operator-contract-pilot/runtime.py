"""Shared structural engine; no numerical equations/expected pixel generation."""
import json,math,re

def validate(schema,value,schemas,path='$',budget=None,depth=0):
    budget={'count':0,'maxValues':100000,'maxDepth':64} if budget is None else budget
    budget['count']+=1
    def fail(): raise ValueError(path+': structural contract')
    if budget['count']>budget['maxValues'] or depth>budget['maxDepth']: fail()
    def child(s,v,p=path): return validate(s,v,schemas,p,budget,depth+1)
    if 'ref' in schema: return child(schemas[schema['ref']],value)
    def equal(a,b):
        if isinstance(a,bool) != isinstance(b,bool): return False
        return a==b
    if 'constant' in schema:
        if not equal(value,schema['constant']): fail()
        return
    if 'enum' in schema:
        if not any(equal(value,x) for x in schema['enum']): fail()
        return
    if 'union' in schema:
        for item in schema['union']:
            try: child(item,value);return
            except ValueError:
                if budget['count']>budget['maxValues']: raise
        fail()
    t=schema.get('type')
    if t=='json':
        if value is None or isinstance(value,(str,bool)): return
        if isinstance(value,(float,int)) and math.isfinite(value): return
        if isinstance(value,(list,dict)):
            for v in value if isinstance(value,list) else value.values(): child(schema,v)
            return
        fail()
    if t=='string':
        if not isinstance(value,str) or len(value)<schema.get('minLength',0) or ('pattern' in schema and not re.search(schema['pattern'],value)): fail()
        return
    if t in ('number','integer'):
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or (t=='integer' and int(value)!=value) or (schema.get('rejectNegativeZero') and value==0 and math.copysign(1,value)<0) or value<schema.get('minimum',-math.inf) or value>schema.get('maximum',math.inf): fail()
        return
    if t=='array':
        if not isinstance(value,list) or not schema['minItems']<=len(value)<=schema['maxItems']: fail()
        for i,v in enumerate(value): child(schema['tuple'][i] if 'tuple' in schema else schema['items'],v,path+'['+str(i)+']')
        return
    if t in ('object','map'):
        if not isinstance(value,dict): fail()
        if t=='map':
            if len(value)>schema['maxKeys']: fail()
            for k,v in value.items(): child(schema['values'],v,path+'.'+k)
            return
        fields=schema['fields'];optional=schema.get('optional',[])
        if any(k not in fields for k in value) or any(k not in value and k not in optional for k in fields): fail()
        for k,v in value.items(): child(fields[k],v,path+'.'+k)
        return
    fail()
