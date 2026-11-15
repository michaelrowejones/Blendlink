#!/usr/bin/env python3
"""Research-only canonical Blender BSL -> GLSL -> Naga WGSL function bridge.

This adapter never edits a kernel body. Generated derivatives retain GPL notices.
It deliberately supports only the three declared pure libraries, not arbitrary BSL.
"""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import time

PIN = "02f0899d78e374b63e7181d9061e1f7ab03419cc"
NAMES = ["gradient", "checker", "white_noise"]


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def run(cmd, *, input=None):
    start = time.monotonic()
    p = subprocess.run(list(map(str, cmd)), input=input, capture_output=True, text=True)
    item = dict(command=list(map(str, cmd)), seconds=time.monotonic() - start,
                returncode=p.returncode, stdout=p.stdout, stderr=p.stderr)
    return p, item


def function_span(source, name):
    """Extract exactly one named function from compiler-emitted WGSL, not a rewriter."""
    matches = list(re.finditer(r"\bfn\s+" + re.escape(name) + r"\s*\(", source))
    assert len(matches) == 1, (name, len(matches))
    start = matches[0].start()
    brace = source.index("{", matches[0].end())
    depth = 1
    end = brace + 1
    while depth:
        assert end < len(source), "Truncated function"
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return start, end


def pure_wgsl(source, wrappers):
    # The stage wrapper is intentionally generated below. Refuse a changed Naga
    # module envelope rather than dropping unfamiliar declarations or resources.
    first = source.index("fn ")
    expected = ("struct FragmentOutput {\n    @location(0) result: vec4<f32>,\n}\n\n"
                "var<private> result: vec4<f32>;\n"
                "var<private> gl_FragCoord_1: vec4<f32>;\n\n")
    assert source[:first] == expected, "Unexpected module globals/resources"
    stage_start, stage_end = function_span(source, "main_1")
    main_start, main_end = function_span(source, "main")
    assert re.fullmatch(r"\s*@fragment\s*", source[stage_end:main_start])
    assert not source[main_end:].strip()
    library = source[first:stage_start]
    assert not re.search(r"@|var<private>|\btexture_|\bsampler\b|gl_FragCoord", library)
    functions = {}
    for name in wrappers:
        start, end = function_span(library, name)
        functions[name] = library[start:end]
    # Wrapper functions are excluded from the common CodeNode so that one native
    # FunctionNode owns each public name. All internal functions stay byte-exact.
    for name in wrappers:
        start, end = function_span(library, name)
        library = library[:start] + library[end:]
    return library, functions


def pure_glsl_es(source, wrappers):
    # A typed Naga round trip is necessary: desktop GLSL implicit promotions
    # accepted by Naga are not valid in WebGL2 GLSL ES. No body substitutions.
    declarations = list(re.finditer(r"^(?:void|float|vec[234]|[iu]vec[234]|int|uint)\s+\w+\s*\(", source, re.M))
    assert declarations, "No ES functions"
    first = declarations[0].start()
    expected = ("#version 300 es\n\nprecision highp float;\nprecision highp int;\n\n"
                "struct FragmentOutput {\n    vec4 result;\n};\n"
                "vec4 result = vec4(0.0);\n\n"
                "vec4 gen_gl_FragCoord_1_ = vec4(0.0);\n\n"
                "layout(location = 0) out vec4 _fs2p_location0;\n\n")
    assert source[:first] == expected, "Unexpected ES module globals/resources"
    end = source.index("void main_1_()")
    library = source[first:end]
    assert not re.search(r"\b(?:gl_FragCoord|layout|sampler\w*|uniform)\b", library)
    functions = {}
    for name in wrappers:
        matches = list(re.finditer(r"^vec4 " + re.escape(name) + r"\(", library, re.M))
        assert len(matches) == 1, name
        start = matches[0].start()
        brace = library.index("{", matches[0].end())
        depth, finish = 1, brace+1
        while depth:
            assert finish < len(library)
            depth += (library[finish] == "{") - (library[finish] == "}")
            finish += 1
        functions[name] = library[start:finish]
        library = library[:start]+library[finish:]
    return library, functions


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blender-source", required=True, type=pathlib.Path)
    ap.add_argument("--shader-tool", required=True, type=pathlib.Path)
    ap.add_argument("--naga", required=True, type=pathlib.Path)
    ap.add_argument("--out", required=True, type=pathlib.Path)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    report = dict(schemaVersion=1, status="running", supportCredit=0,
                  nativeBlenderParityCredit=0, finalExports=0, commands=[], sources={}, modules={})
    def save():
        (args.out / "generation.json").write_text(json.dumps(report, indent=2) + "\n")
    def pin(path):
        path = path.resolve()
        report["sources"][str(path)] = digest(path.read_bytes())
    def checked(cmd, **kw):
        p, receipt = run(cmd, **kw)
        report["commands"].append(receipt)
        save()
        assert p.returncode == 0, p.stderr + p.stdout
        return p.stdout
    try:
        actual = checked(["git", "-C", args.blender_source, "rev-parse", "HEAD"]).strip()
        assert actual == PIN, actual
        report["blenderCommit"] = actual
        for tool in [args.shader_tool, args.naga]:
            pin(tool)
        report["nagaVersion"] = checked([args.naga, "--version"]).strip()
        report["clangVersion"] = checked(["clang", "--version"]).strip()
        src = args.blender_source / "source/blender/gpu/shaders"
        compiler = args.blender_source / "source/blender/gpu/shader_tool"
        for path in compiler.rglob("*"):
            if path.is_file() and path.suffix in [".cc", ".hh", ".txt"]:
                pin(path)
        pin(args.blender_source / "COPYING")
        pin(args.blender_source / "doc/license/GPL-license.txt")
        compat = src / "compat/gpu_shader_compat_glsl.glsl"
        pin(compat)
        # Exact macro lines from Blender's own GLSL backend. No operator or math
        # emulation is introduced here. The admitted kernels use this subset only.
        text = compat.read_text()
        macro_names = ["float2", "float3", "float4", "int2", "int3", "int4",
                       "uint2", "uint3", "uint4", "_ref"]
        macro_lines = []
        for name in macro_names:
            matches = re.findall(r"^#define " + re.escape(name) + r"(?:\(|\s).*", text, re.M)
            assert len(matches) == 1, name
            macro_lines += matches
        preamble = "\n".join(macro_lines) + "\n"
        report["compatibilityMacros"] = macro_lines
        includes = sorted(str(p) for p in src.rglob("*") if p.is_dir())
        lowered = {}
        metadata = {}
        def lower(path):
            name = path.name
            if name in lowered:
                return
            pin(path)
            stem = args.out / name
            checked([args.shader_tool, path, str(stem)+".il", str(stem)+".metadata",
                     str(stem)+".infos", str(stem)+".d", *includes])
            metadata[name] = pathlib.Path(str(stem)+".metadata").read_text()
            # Native compiler metadata, not a handwritten dependency list.
            deps = re.findall(r'source.add_dependency\("([^"]+)"\);', metadata[name])
            parts = []
            for dep in deps:
                found = list(src.rglob(dep))
                assert len(found) == 1, dep
                if dep == "gpu_shader_compat.hh":
                    pin(found[0])
                    continue
                lower(found[0])
                parts.append(dep)
            # Modern BSL may inline constexpr dependencies; retain its depfile too.
            depfile = pathlib.Path(str(stem)+".d").read_text().split(" : ", 1)[1]
            for token in depfile.strip().split():
                if pathlib.Path(token).is_file():
                    pin(pathlib.Path(token))
            lowered[name] = dict(code=pathlib.Path(str(stem)+".il").read_text(), deps=parts)
        notice = ("/* Research derivative of Blender 5.3 shader libraries.\n"
                  " * SPDX-FileCopyrightText: 2019-2025 Blender Authors\n"
                  " * SPDX-License-Identifier: GPL-2.0-or-later\n"
                  " * Source revision: " + PIN + "\n */\n")
        modules = {}
        for family in NAMES:
            path = src / "material" / ("gpu_shader_material_tex_"+family+".bsl.hh")
            lower(path)
            ordered = []
            def visit(name):
                for dep in lowered[name]["deps"]:
                    visit(dep)
                if name not in ordered:
                    ordered.append(name)
            visit(path.name)
            body = preamble + "\n".join(lowered[n]["code"] for n in ordered)
            wrapper = {}
            if family == "gradient":
                wrapper["bridge_gradient"] = "vec4 bridge_gradient(vec3 p, float mode) { vec4 c; float f; node_tex_gradient(p, mode, c, f); return vec4(c.rgb, f); }"
                invoke = "bridge_gradient(vec3(gl_FragCoord.xyz), 2.0)"
            elif family == "checker":
                wrapper["bridge_checker"] = "vec4 bridge_checker(vec3 p, float scale) { vec4 c; float f; node_tex_checker(p, vec4(0.125,0.25,0.5,0.75), vec4(0.875,0.625,0.375,0.125), scale, c, f); return vec4(c.rgb, f); }"
                invoke = "bridge_checker(vec3(gl_FragCoord.xyz), 3.0)"
            else:
                for dim, suffix in enumerate(["one", "two", "three", "four"], 1):
                    name = "bridge_white_"+suffix
                    wrapper[name] = f"vec4 {name}(vec3 p, float w) {{ float f; vec4 c; node_white_noise_{dim}d(p, w, f, c); return vec4(c.rgb, f); }}"
                wrapper["bridge_hash_words"] = "vec4 bridge_hash_words(vec3 p, float w) { uint h = hash_uint4(floatBitsToUint(p.x), floatBitsToUint(p.y), floatBitsToUint(p.z), floatBitsToUint(w)); return vec4(float(h & 65535u), float(h >> 16u), 0.0, 1.0); }"
                invoke = "bridge_white_four(vec3(gl_FragCoord.xyz), 0.25)"
            # Macro expansion is delegated to clang; no regex arithmetic lowering.
            glsl_lib = checked(["clang", "-x", "c", "-E", "-P", "-"], input=body)
            glsl_wrappers = {n:checked(["clang","-x","c","-E","-P","-"],input=s).strip() for n,s in wrapper.items()}
            stage = ("#version 450\n" + glsl_lib + "\n" + "\n".join(glsl_wrappers.values()) +
                     "\nlayout(location=0) out vec4 result; void main() { result = " + invoke + "; }\n")
            glsl_file = args.out / (family+".frag")
            wgsl_file = args.out / (family+".wgsl")
            glsl_file.write_text(notice+stage)
            checked([args.naga,"--input-kind","glsl","--shader-stage","frag",glsl_file,wgsl_file])
            checked([args.naga,wgsl_file])
            wgsl_lib, wgsl_wrappers = pure_wgsl(wgsl_file.read_text(), wrapper)
            es_file = args.out / (family+".es.frag")
            checked([args.naga,"--profile","es300",wgsl_file,es_file])
            es_lib, es_wrappers = pure_glsl_es(es_file.read_text(), wrapper)
            modules[family] = dict(glslLibrary=notice+es_lib,wgslLibrary=notice+wgsl_lib,
                                   glslFunctions=es_wrappers,wgslFunctions=wgsl_wrappers)
            report["modules"][family] = dict(dependencies=ordered,
                entrypoints=re.findall(r'source.add_function\("([^"]+)"',metadata[path.name]),
                wrappers=list(wrapper),glslSha256=digest(glsl_file.read_bytes()),
                wgslSha256=digest(wgsl_file.read_bytes()),esSha256=digest(es_file.read_bytes()),esBytes=es_file.stat().st_size,glslBytes=glsl_file.stat().st_size,
                wgslBytes=wgsl_file.stat().st_size)
        (args.out/"modules.json").write_text(json.dumps(modules,indent=2)+"\n")
        report["modulesSha256"] = digest((args.out/"modules.json").read_bytes())
        for path, expected in report["sources"].items():
            assert digest(pathlib.Path(path).read_bytes()) == expected, path
        report["status"] = "CANONICAL_LOWERING_AND_NAGA_VALIDATION_PASSED"
    except BaseException as error:
        report["status"] = "FAILED_ZERO_CREDIT"
        report["error"] = str(error)
        raise
    finally:
        save()


if __name__ == "__main__":
    main()
