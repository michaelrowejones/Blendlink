import hashlib
import importlib
import importlib.util
import json
import marshal
import os
from pathlib import Path
import sys
import types

import bpy

root = Path(os.environ['BLENDLINK_CACHE_PROBE_SOURCE']).resolve()
package = Path(os.environ['BLENDLINK_CACHE_PROBE_ADDON']).resolve()
output = Path(os.environ['BLENDLINK_CACHE_PROBE_OUTPUT']).resolve()
preloaded = [name for name in sys.modules if name in {'tsl_ir', 'squeeze_ir'} or name.startswith('blendlink_cache_probe_package')]
assert preloaded == [], preloaded
sys.path.insert(0, str(root / 'packages/blender-addon'))
sys.path.insert(0, str(root / 'packages/blendlink/blender'))
# These are the real source-reference imports.
import tsl_ir
import squeeze_ir

# This is the existing package probe's actual dynamic add-on namespace seam.
name = 'blendlink_cache_probe_package'
spec = importlib.util.spec_from_file_location(name, package / '__init__.py', submodule_search_locations=[str(package)])
addon = importlib.util.module_from_spec(spec)
sys.modules[name] = addon
spec.loader.exec_module(addon)
compiler = importlib.import_module(name + '.material_compiler')
package_helper = importlib.import_module(name + '.squeeze_ir')
assert Path(package_helper.__file__).resolve().parent == package
assert Path(compiler.tsl_ir.__file__).resolve().parent == package

sha = lambda data: hashlib.sha256(data).hexdigest()

def helper_state(module):
    path = Path(module.__file__).resolve()
    source = path.read_bytes()
    compiled = compile(source, str(path), 'exec', dont_inherit=True, optimize=sys.flags.optimize)
    expected = next(item for item in compiled.co_consts if isinstance(item, types.CodeType) and item.co_name == '_literal')
    return {'file': str(path), 'sourceSha256': sha(source), 'cached': module.__cached__,
            'cacheExists': Path(module.__cached__).is_file(), 'literal16': module._literal(16),
            'loadedLiteralCodeSha256': sha(marshal.dumps(module._literal.__code__)),
            'sourceLiteralCodeSha256': sha(marshal.dumps(expected))}

def emitter_state(module):
    path = Path(module.__file__).resolve()
    material = bpy.data.materials.new('Owned cache import emission')
    material.use_nodes = True
    root = next(item for item in material.node_tree.nodes if item.type == 'BSDF_PRINCIPLED')
    document = module.emit_channel(root.inputs['Base Color'], evaluation_engine='EEVEE')
    bpy.data.materials.remove(material)
    return {'file': str(path), 'sourceSha256': sha(path.read_bytes()), 'cached': module.__cached__,
            'cacheExists': Path(module.__cached__).is_file(), 'loadedModel': module.IR_MODEL,
            'emittedModel': document['model']}

packet = {'version': list(bpy.app.version), 'build': bpy.app.build_hash.decode(),
          'python': sys.version, 'ignoreEnvironment': sys.flags.ignore_environment,
          'isolated': sys.flags.isolated, 'pycachePrefix': sys.pycache_prefix,
          'dontWriteBytecode': sys.dont_write_bytecode,
          'environment': {key: os.environ.get(key) for key in ['PYTHONPYCACHEPREFIX', 'PYTHONDONTWRITEBYTECODE']},
          'preloadedTargetModules': preloaded,
          'source': {'helper': helper_state(squeeze_ir), 'emitter': emitter_state(tsl_ir)},
          'package': {'helper': helper_state(package_helper), 'emitter': emitter_state(compiler.tsl_ir)}}
output.write_text(json.dumps(packet, indent=2) + '\n')
print('BLENDLINK_CACHE_IMPORT_RESEARCH_CAPTURED', json.dumps({'version': packet['version'],
    'prefix': packet['pycachePrefix'], 'dontWrite': packet['dontWriteBytecode'],
    'sourceLiteral16': packet['source']['helper']['literal16'],
    'packageLiteral16': packet['package']['helper']['literal16']}))
