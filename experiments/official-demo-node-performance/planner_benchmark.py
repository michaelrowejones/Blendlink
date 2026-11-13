"""Fresh-process planner timing; native source/geometry are never saved."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time
import tracemalloc
import bpy


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--sdk-root', required=True); parser.add_argument('--output', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:]); root = Path(args.sdk_root); output = Path(args.output); output.mkdir(parents=True, exist_ok=False)
    source = Path(bpy.data.filepath); source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    sys.path[:0] = [str(root/'packages/blender-addon'), str(root/'packages/blendlink/blender')]
    start = time.perf_counter(); import material_compiler; import_ms = (time.perf_counter()-start)*1000
    objects = tuple(obj for obj in bpy.context.view_layer.objects if not obj.hide_render and obj.type == 'MESH')
    def state():
        return {'meshDatablocks': len(bpy.data.meshes), 'objects': [(obj.name, obj.data.as_pointer(), [(slot.material.name if slot.material else None) for slot in obj.material_slots], [(mod.name, mod.show_viewport, mod.show_render) for mod in obj.modifiers]) for obj in objects]}
    initial = state(); rows = []
    for index in range(3):
        start = time.perf_counter(); plan = material_compiler.plan_materials(objects, purpose='final', automatic_programs=True); elapsed = (time.perf_counter()-start)*1000
        value = plan.as_dict(); encoded = json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)
        (output/f'plan-{index}.json').write_text(json.dumps(value, sort_keys=True, indent=2, allow_nan=False)+'\n')
        assert state() == initial, 'Planner changed source bindings/modifiers or leaked evaluated mesh datablocks'
        rows.append({'iteration': index, 'role': 'first-call' if index == 0 else 'warm-call', 'elapsedMs': elapsed, 'fullPlanSha256': hashlib.sha256(encoded.encode()).hexdigest()})
    tracemalloc.start(); tracemalloc.reset_peak()
    plan = material_compiler.plan_materials(objects, purpose='final', automatic_programs=True)
    current, peak = tracemalloc.get_traced_memory(); tracemalloc.stop()
    assert state() == initial; assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash
    result = {'schemaVersion': 1, 'kind': 'real-cube-native-planner-benchmark-v1', 'version': list(bpy.app.version), 'nativeBuildHash': bpy.app.build_hash.decode(), 'sourceSha256': source_hash,
              'proceduralSha256': hashlib.sha256((root/'packages/blender-addon/procedural.py').read_bytes()).hexdigest(), 'materialCompilerImportMs': import_ms,
              'timings': rows, 'warmTracemalloc': {'currentBytes': current, 'peakBytes': peak, 'scope': 'Python-tracked allocations only; native Blender/GPU memory is excluded. This fourth call is not a timing sample.'},
              'sourceStatePreserved': state() == initial, 'sourceFilePreserved': True, 'meshObjects': len(objects), 'scope': 'Original Cube active view layer; first+two warm plans per fresh factory process, one Blender render thread, no render/export/source mutation.'}
    (output/'benchmark.json').write_text(json.dumps(result, indent=2)+'\n'); print('BLENDLINK_REAL_CUBE_PLANNER', json.dumps(result))


if __name__ == '__main__': main()
