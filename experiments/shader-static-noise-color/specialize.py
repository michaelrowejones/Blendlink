"""Closed call-span specialization. No arithmetic expression rewriting."""
import re

HELPER='noise_fractal_distortedTfloat3TNoiseFBMTfloat3'
CLONE='noise_fractal_distorted_static_color_profile'
ENTRY='node_noise_tex_fbm_3d'
ENTRY_CLONE='node_noise_tex_fbm_static_color_3d'


def lex(source):
    pattern=r'\s+|//[^\n]*|/\*[\s\S]*?\*/|[A-Za-z_]\w*|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?[fu]?|==|!=|<=|>=|&&|\|\||<<|>>|[^\s]'
    out=[]
    for m in re.finditer(pattern,source):
        t=m.group()
        if not t.isspace()and not t.startswith('//')and not t.startswith('/*'):
            out.append((t,m.start(),m.end()))
    return out


def matching(tokens,start,left,right):
    assert tokens[start][0]==left
    depth=1
    for i in range(start+1,len(tokens)):
        depth+=(tokens[i][0]==left)-(tokens[i][0]==right)
        if depth==0:return i
    raise AssertionError('Unbalanced source tokens')


def function(source,name,parameter_prefix=None):
    tokens=lex(source);found=[]
    for i,t in enumerate(tokens):
        if t[0]!=name or i+1>=len(tokens)or tokens[i+1][0]!='(':continue
        end=matching(tokens,i+1,'(',')')
        if end+1>=len(tokens)or tokens[end+1][0]!='{':continue
        if parameter_prefix and [x[0]for x in tokens[i+2:i+2+len(parameter_prefix)]]!=parameter_prefix:continue
        close=matching(tokens,end+1,'{','}')
        # A definition has exactly one simple return-type token in this profile.
        assert tokens[i-1][0]in['void','float','vec4']
        found.append((tokens[i-1][1],tokens[close][2]))
    assert len(found)==1,(name,len(found))
    start,end=found[0];return source[start:end]


def apply(source,changes):
    changes=sorted(changes)
    assert all(a[1]<=b[0]for a,b in zip(changes,changes[1:])), 'Overlapping edits'
    for start,end,value in reversed(changes):source=source[:start]+value+source[end:]
    return source


def clone_helper(source,table):
    assert len(table)==2 and [r['seed']for r in table]==[3,4]
    # The source type, not a payload assertion, fixes color seed base to3.
    seed=function(source,'color_seed_offset',['vec3','_0'])
    assert [x[0]for x in lex(seed)]==['float','color_seed_offset','(','vec3','_0',')','{','return','3.0f',';','}']
    original=function(source,HELPER,['vec3','p'])
    tokens=lex(original);values=[t[0]for t in tokens]
    binding=['float','seed_base','=','color_seed_offset','(','p',')',';']
    assert sum(values[i:i+len(binding)]==binding for i in range(len(values)))==1
    changes=[];calls=[]
    for i,t in enumerate(tokens):
        if t[0]==HELPER and i==1:changes.append((t[1],t[2],CLONE))
        if t[0]!='random_offsetTfloat3':continue
        end=matching(tokens,i+1,'(',')');args=[x[0]for x in tokens[i+2:end]]
        assert args in[['seed_base','+','0.0f'],['seed_base','+','1.0f']],args
        seed_value=3 if args[-1]=='0.0f'else 4
        row=next(row for row in table if row['seed']==seed_value)
        assert len(row['words'])==3 and all(type(w)is int and 0<=w<=0xffffffff for w in row['words'])
        replacement='uintBitsToFloat(uvec3('+','.join(str(w)+'u'for w in row['words'])+'))'
        changes.append((t[1],tokens[end][2],replacement));calls.append({'seed':seed_value,'originalCall':original[t[1]:tokens[end][2]],'words':row['words']})
    assert [x['seed']for x in calls]==[3,4] and len(changes)==3,'Expected exactly two source helper call spans'
    clone=apply(original,changes)
    return clone,dict(originalFunction=HELPER,derivedFunction=CLONE,substitutedCalls=calls,editedSpans=len(changes),original=original)


def clone_entry(source):
    original=function(source,ENTRY,['vec3','co']);tokens=lex(original);changes=[]
    for i,t in enumerate(tokens):
        if i==1 and t[0]==ENTRY:changes.append((t[1],t[2],ENTRY_CLONE))
        elif t[0]==HELPER:
            assert tokens[i+1][0]=='(';changes.append((t[1],t[2],CLONE))
    assert len(changes)==2
    return apply(original,changes),dict(originalFunction=ENTRY,derivedFunction=ENTRY_CLONE,editedSpans=2,original=original)
