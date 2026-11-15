#!/usr/bin/env python3
"""Research: one canonical, dependency-deduplicated procedural shader library."""
import argparse
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import time

PIN = '02f0899d78e374b63e7181d9061e1f7ab03419cc'
FAMILIES = ['gradient', 'checker', 'white_noise', 'noise', 'voronoi']
WRAPPERS = {
    'bridge_gradient': 'vec4 bridge_gradient(vec3 p) { vec4 c; float f; node_tex_gradient(p, 4.0, c, f); return vec4(c.rgb,f); }',
    'bridge_checker': 'vec4 bridge_checker(vec3 p) { vec4 c; float f; node_tex_checker(p, vec4(0.125,0.25,0.5,0.75), vec4(0.875,0.625,0.375,0.125), 3.0, c, f); return vec4(c.rgb,f); }',
    'bridge_white': 'vec4 bridge_white(vec3 p) { vec4 c; float f; node_white_noise_3d(p, 0.0, f, c); return vec4(c.rgb,f); }',
    'bridge_noise': 'vec4 bridge_noise(vec3 p) { vec4 c; float f; node_noise_tex_fbm_3d(p, 0.0, 5.0, 2.0, 0.5, 2.0, 0.0, 1.0, 0.0, 1.0, 1.0, f, c); return vec4(c.rgb,f); }',
    'bridge_voronoi_first': 'vec4 bridge_voronoi_first(vec3 p) { float d,w,r; vec4 c; vec3 position; node_tex_voronoi_f1_3d(p, 0.0, 5.0, 0.0, 0.5, 2.0, 1.0, 0.5, 1.0, 0.0, 0.0, d,c,position,w,r); return vec4(c.rgb,d); }',
    'bridge_voronoi_second': 'vec4 bridge_voronoi_second(vec3 p) { float d,w,r; vec4 c; vec3 position; node_tex_voronoi_f2_3d(p, 0.0, 5.0, 0.0, 0.5, 2.0, 1.0, 0.5, 1.0, 0.0, 0.0, d,c,position,w,r); return vec4(c.rgb,d); }',
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def declarations(source, language):
    """Split compiler output at top-level delimiters; never edit a function body.

    The accepted output grammar is deliberately closed. Comments are absent from
    Naga's output. This is module packaging, not a shader-language transpiler.
    """
    out, i = [], 0
    while i < len(source):
        while i < len(source) and source[i].isspace():
            i += 1
        if i == len(source):
            break
        start = i
        if source[i] == '#':
            i = source.index('\n', i)+1
        else:
            brace = source.find('{', i)
            semi = source.find(';', i)
            if semi >= 0 and (brace < 0 or semi < brace):
                i = semi+1
            else:
                assert brace >= 0, source[i:i+100]
                depth, i = 1, brace+1
                while depth:
                    assert i < len(source), 'Unbalanced compiler output'
                    depth += (source[i] == '{')-(source[i] == '}')
                    i += 1
                if i < len(source) and source[i] == ';':
                    i += 1
        out.append(source[start:i])
    return out


def package_module(source, language):
    functions, kept, removed = {}, [], []
    for declaration in declarations(source, language):
        if language == 'wgsl':
            match = re.match(r'(?:@fragment\s+)?fn (\w+)\s*\(', declaration)
        else:
            match = re.match(r'\w+\s+(\w+)\s*\(', declaration)
        if match:
            name = match.group(1)
            if name in ['main', 'main_1', 'main_1_']:
                removed.append(declaration)
            elif name in WRAPPERS:
                assert name not in functions, name
                functions[name] = declaration
            else:
                kept.append(declaration)
            continue
        if declaration.startswith('struct FragmentOutput '):
            removed.append(declaration)
        elif language == 'wgsl' and re.fullmatch(r'var<private> (bridge_stage_output|gl_FragCoord_1): vec4<f32>;', declaration):
            removed.append(declaration)
        elif language == 'glsl' and (declaration in ['#version 300 es\n','precision highp float;','precision highp int;'] or re.fullmatch(r'vec4 (bridge_stage_output|gen_gl_FragCoord_1_) = vec4\(0.0\);', declaration) or declaration == 'layout(location = 0) out vec4 _fs2p_location0;'):
            removed.append(declaration)
        else:
            assert re.match(r'struct \w+\s*\{', declaration), ('Unexpected module declaration', declaration[:200])
            kept.append(declaration)
    assert set(functions) == set(WRAPPERS), set(functions)
    assert len(removed) == (5 if language == 'wgsl' else 9), len(removed)
    body = '\n\n'.join(kept)+'\n'
    assert not re.search(r'\bgl_FragCoord\b|var<private>|@group|@binding|\bsampler\w*\b|\buniform\b', body)
    names = re.findall(r'^fn (\w+)\(', body, re.M) if language == 'wgsl' else re.findall(r'^\w+ (\w+)\(', body, re.M)
    assert len(names) == len(set(names)), 'Name collision after canonical generation'
    return body, functions, names


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--blender-source', type=pathlib.Path, required=True)
    ap.add_argument('--shader-tool', type=pathlib.Path, required=True)
    ap.add_argument('--naga', type=pathlib.Path, required=True)
    ap.add_argument('--out', type=pathlib.Path, required=True)
    a = ap.parse_args(); a.out.mkdir(parents=True, exist_ok=False)
    report = dict(schemaVersion=1, status='running', supportCredit=0, sourcePins={}, commands=[], families=FAMILIES)
    def save():
        (a.out/'generation.json').write_text(json.dumps(report,indent=2)+'\n')
    def pin(path):
        path = path.resolve(); report['sourcePins'][str(path)] = sha(path.read_bytes())
    def run(cmd, *, input=None):
        start = time.monotonic()
        p = subprocess.run(list(map(str,cmd)),input=input,capture_output=True,text=True,timeout=45)
        report['commands'].append(dict(command=list(map(str,cmd)),seconds=time.monotonic()-start,returncode=p.returncode,stdout=p.stdout,stderr=p.stderr))
        save(); assert p.returncode == 0, p.stderr+p.stdout
        return p.stdout
    try:
        assert run(['git','-C',a.blender_source,'rev-parse','HEAD']).strip() == PIN
        for path in [pathlib.Path(__file__),a.shader_tool,a.naga,pathlib.Path(shutil.which('clang'))]:
            pin(path)
        report['nagaVersion'] = run([a.naga,'--version']).strip()
        report['clangVersion'] = run(['clang','--version']).strip()
        src = a.blender_source/'source/blender/gpu/shaders'
        compiler = a.blender_source/'source/blender/gpu/shader_tool'
        for path in compiler.rglob('*'):
            if path.is_file() and path.suffix in ['.cc','.hh','.txt']:
                pin(path)
        includes = sorted(str(p)for p in src.rglob('*')if p.is_dir())
        compat = src/'compat/gpu_shader_compat_glsl.glsl'; pin(compat)
        macros=[]
        # Native preprocessor definitions only. The full compatibility header
        # also defines texture helpers: these are not part of this pure library.
        # Preserve multiline macros byte-for-byte; never synthesize operators.
        continuation=False
        for line in compat.read_text().splitlines():
            if continuation or line.startswith('#define '):
                macros.append(line)
                continuation=line.endswith('\\')
        preamble='\n'.join(macros)+'\n'
        report['compatibilityPolicy']='Exact native GLSL compatibility preprocessor definitions only; resource functions excluded; no math replacements.'
        lowered, metadata, visiting = {}, {}, set()
        def lower(path):
            name=path.name
            if name in lowered:
                return
            assert name not in visiting, 'Dependency cycle: '+name
            visiting.add(name); pin(path)
            target=a.out/name
            run([a.shader_tool,path,str(target)+'.il',str(target)+'.metadata',str(target)+'.infos',str(target)+'.d',*includes])
            meta=pathlib.Path(str(target)+'.metadata').read_text();metadata[name]=meta
            deps=[]
            for dep in re.findall(r'source.add_dependency\("([^"]+)"\);',meta):
                found=list(src.rglob(dep));assert len(found)==1,dep
                if dep=='gpu_shader_compat.hh':
                    pin(found[0]);continue
                lower(found[0]);deps.append(dep)
            for token in pathlib.Path(str(target)+'.d').read_text().split(' : ',1)[1].strip().split():
                if pathlib.Path(token).is_file():pin(pathlib.Path(token))
            lowered[name]=dict(code=pathlib.Path(str(target)+'.il').read_text(),deps=deps)
            visiting.remove(name)
        roots=[]
        for family in FAMILIES:
            p=src/'material'/('gpu_shader_material_tex_'+family+'.bsl.hh');lower(p);roots.append(p.name)
        order=[]
        def visit(name):
            for dep in lowered[name]['deps']:visit(dep)
            if name not in order:order.append(name)
        for name in roots:visit(name)
        assert len(order)==len(set(order))
        raw=preamble+'\n'.join(lowered[n]['code']for n in order)
        lib=run(['clang','-x','c','-E','-P','-'],input=raw)
        canonical_file=a.out/'canonical-library.glsl';canonical_file.write_text(lib)
        abi_file=a.out/'canonical-abi.glsl';abi_file.write_text('\n'.join(WRAPPERS.values())+'\n')
        # Canonical member prototypes are intentionally excluded on Metal by
        # SourceProcessor::lower_method_forward_declaration. Keep that backend
        # choice for the independent native compiler; browser GLSL stays intact.
        guards=[]
        for name in order:
            guards+=re.findall(r'#ifndef GPU_METAL\n([\s\S]*?)#endif',lowered[name]['code'])
        assert len(guards)==20 and all('_noise_fn('in block and '{'not in block for block in guards)
        native_lib=run(['clang','-x','c','-E','-P','-DGPU_METAL=1','-'],input=raw)
        prototype=r'\bfloat\s+Noise\w+_noise_fn\s*\([^;{}]*\)\s*;'
        removed=re.findall(prototype,lib);assert len(removed)==20
        tokens=lambda text:re.findall(r'\w+|[^\s]',text)
        assert tokens(re.sub(prototype,'',lib))==tokens(native_lib),'Native flag changed more than canonical forward declarations'
        native_file=a.out/'canonical-metal-library.glsl';native_file.write_text(native_lib)
        guard_owner=a.blender_source/'source/blender/gpu/shader_tool/struct.cc';pin(guard_owner)
        report['nativeMetalPreprocess']=dict(sourceGuardOwner=str(guard_owner),guardBlocks=len(guards),forwardDeclarationsRemoved=20,allBodyTokensUnchanged=True,sha256=sha(native_file.read_bytes()),browserCanonicalSha256=sha(canonical_file.read_bytes()))
        stage='#version 450\n'+lib+'\n'+'\n'.join(WRAPPERS.values())+'\nlayout(location=0) out vec4 bridge_stage_output; void main() { vec3 p=gl_FragCoord.xyz; bridge_stage_output = '+ '+'.join(name+'(p)'for name in WRAPPERS)+'; }\n'
        stage_file=a.out/'combined.frag';stage_file.write_text(stage)
        wgsl_file=a.out/'combined.wgsl';es_file=a.out/'combined.es.frag'
        run([a.naga,'--input-kind','glsl','--shader-stage','frag','--compact','--entry-point','main',stage_file,wgsl_file])
        run([a.naga,wgsl_file])
        run([a.naga,'--profile','es300',wgsl_file,es_file])
        wgsl, wgsl_fn, wgsl_names=package_module(wgsl_file.read_text(),'wgsl')
        glsl, glsl_fn, glsl_names=package_module(es_file.read_text(),'glsl')
        # Retain each original source notice, including Voronoi's MIT AND GPL.
        notices=[]
        for name in order:
            path=next(src.rglob(name));header=re.match(r'/\*.*?\*/',path.read_text(),re.S)
            assert header and 'SPDX-License-Identifier:'in header.group(),name
            notices.append('// '+name+'\n'+header.group())
        notice='\n'.join(notices)+'\n'
        module=dict(sourceSha256=sha((lib+abi_file.read_text()).encode()),glslLibrary=notice+glsl,wgslLibrary=notice+wgsl,glslFunctions=glsl_fn,wgslFunctions=wgsl_fn)
        (a.out/'module.json').write_text(json.dumps(module,indent=2)+'\n')
        report.update(status='COMBINED_LIBRARY_GENERATED',moduleSha256=sha((a.out/'module.json').read_bytes()),canonicalLibrarySha256=sha(canonical_file.read_bytes()),canonicalAbiSha256=sha(abi_file.read_bytes()),dependencyOrder=order,dependencyCount=len(order),wrappers=list(WRAPPERS),nativeEntrypoints={name:re.findall(r'source.add_function\("([^"]+)"',metadata[name])for name in roots},wgslFunctions=len(wgsl_names),glslFunctions=len(glsl_names),functionNamesUnique=True,sharedHashCopies=order.count('gpu_shader_common_hash.bsl.hh'),moduleBytes={p.name:p.stat().st_size for p in[stage_file,wgsl_file,es_file]})
        for path,expected in report['sourcePins'].items():assert sha(pathlib.Path(path).read_bytes())==expected,path
    except BaseException as error:
        report.update(status='FAILED_ZERO_CREDIT',error=str(error));raise
    finally:
        save()


if __name__=='__main__':main()
