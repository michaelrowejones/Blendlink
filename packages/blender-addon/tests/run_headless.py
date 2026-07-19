# SPDX-License-Identifier: GPL-3.0-or-later
"""Headless addon test: register from source inside Blender, exercise the
operators on a scratch scene, assert the results, print a sentinel.

Run:  blender --background --factory-startup --python tests/run_headless.py --python-exit-code 1
"""
import importlib.util
import sys
from pathlib import Path

import bpy

ADDON_DIR = Path(__file__).resolve().parents[1]
PACKAGE = "blendlink_addon"


def load_addon():
    spec = importlib.util.spec_from_file_location(
        PACKAGE, ADDON_DIR / "__init__.py",
        submodule_search_locations=[str(ADDON_DIR)],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[PACKAGE] = module
    spec.loader.exec_module(module)
    module.register()
    return module


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def make_cube(name):
    bpy.ops.mesh.primitive_cube_add()
    obj = bpy.context.active_object
    obj.name = name
    return obj


def select_only(*objects):
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[-1] if objects else None


def run_conformance(vocab):
    """Execute the SHARED vocabulary fixture — the same JSON vitest runs
    against vocabulary.ts. The hand-mirrored parsers drifted three ways
    once; this block is the Python half of the contract that stops it."""
    import json

    fixture_path = ADDON_DIR.parent / "blendlink" / "conformance" / "vocabulary.json"
    cases = json.loads(fixture_path.read_text(encoding="utf8"))["cases"]
    for index, case in enumerate(cases):
        result = vocab.classify(case["name"], case.get("extras"))
        expected = case["expect"]
        label = f"conformance[{index}] {case['name']}"
        if expected["kind"] == "none":
            expect(result is None, f"{label}: expected no classification, got {result}")
            continue
        expect(result is not None, f"{label}: expected {expected['kind']}, got None")
        expect(result.kind == expected["kind"],
               f"{label}: expected {expected['kind']}, got {result.kind}")
        if "shape" in expected:
            expect(result.shape == expected["shape"],
                   f"{label}: shape {result.shape} != {expected['shape']}")
        if "proxyOnly" in expected:
            expect(result.proxy_only == expected["proxyOnly"],
                   f"{label}: proxy_only {result.proxy_only} != {expected['proxyOnly']}")
        if "base" in expected and result.kind not in ("socket", "hotspot", "audio"):
            expect(result.base == expected["base"],
                   f"{label}: base {result.base!r} != {expected['base']!r}")
        if "lodIndex" in expected:
            expect(result.lod_index == expected["lodIndex"],
                   f"{label}: lod_index {result.lod_index} != {expected['lodIndex']}")
        if "anchorName" in expected:
            expect(result.anchor_name == expected["anchorName"],
                   f"{label}: anchor_name {result.anchor_name!r} != {expected['anchorName']!r}")
    print(f"conformance: {len(cases)} cases agree with vocabulary.ts")


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    addon = load_addon()
    vocab = sys.modules[f"{PACKAGE}.vocab"]
    validation = sys.modules[f"{PACKAGE}.validation"]
    syncstatus = sys.modules[f"{PACKAGE}.syncstatus"]
    run_conformance(vocab)

    # --- tagging: multi-object, retag replaces the previous suffix ---
    crate = make_cube("Crate")
    fence = make_cube("Fence")
    select_only(crate, fence)
    bpy.ops.blendlink.tag_collider(kind="colonly")
    expect(crate.name == "Crate-colonly", f"expected Crate-colonly, got {crate.name}")
    expect(fence.name == "Fence-colonly", f"expected Fence-colonly, got {fence.name}")
    select_only(crate)
    bpy.ops.blendlink.tag_collider(kind="convcol")
    expect(crate.name == "Crate-convcol", f"retag failed: {crate.name}")

    # --- name-collision safety: never silently .001 the tag ---
    other = make_cube("Crate")
    select_only(other)
    result = bpy.ops.blendlink.tag_collider(kind="convcol")
    expect(result == {"FINISHED"}, "collision tag should finish with a warning")
    expect(other.name == "Crate", f"collision must skip rename, got {other.name}")
    select_only(fence)
    bpy.ops.blendlink.clear_tag()
    expect(fence.name == "Fence", f"clear_tag left {fence.name}")

    # --- rigid: props with native ui metadata ---
    barrel = make_cube("Barrel")
    select_only(barrel)
    bpy.ops.blendlink.tag_rigid(mass=12.5, friction=0.4)
    expect(barrel.name == "Barrel-rigid", barrel.name)
    expect(abs(barrel["blendlink_mass"] - 12.5) < 1e-6, "mass not set")
    ui_data = barrel.id_properties_ui("blendlink_mass").as_dict()
    expect("kilograms" in ui_data.get("description", ""), f"mass ui_data missing: {ui_data}")

    # --- LOD ---
    rock = make_cube("Rock")
    select_only(rock)
    bpy.ops.blendlink.set_lod(level=1, distance=12.0)
    expect(rock.name == "Rock_LOD1", rock.name)
    expect(abs(rock["blendlink_lod_distance"] - 12.0) < 1e-6, "lod_distance not set")

    # --- anchors: parented empty, one undo step, hotspot props ---
    select_only(barrel)
    bpy.ops.blendlink.add_anchor(kind="SOCKET", anchor_name="Top")
    socket = bpy.context.active_object
    expect(socket.name == "SOCKET_Top", socket.name)
    expect(socket.parent == barrel, "socket not parented to active object")
    expect(socket.type == "EMPTY", "socket should be an empty")
    select_only(barrel)
    bpy.ops.blendlink.add_anchor(kind="HOTSPOT", anchor_name="Info")
    hotspot = bpy.context.active_object
    expect(hotspot["blendlink_title"] == "Info", "hotspot title prop missing")

    # --- noimp ---
    grid = make_cube("RefGrid")
    select_only(grid)
    bpy.ops.blendlink.tag_noimp()
    expect(grid.name == "RefGrid-noimp", grid.name)

    # --- lint through the live scan: near-miss + numbered dup + fix ---
    make_cube("Wall-collonly")
    duped = make_cube("Zone-colonly.001")
    validation.recompute(bpy.context.scene)
    messages = [issue.message for issue in validation.result().issues]
    expect(any("did not match" in m for m in messages), f"near-miss lint missing: {messages}")
    expect(any("duplicate numbering" in m for m in messages), f"numbered lint missing: {messages}")
    bpy.ops.blendlink.fix_numbered(object_name=duped.name)
    expect(duped.name == "Zone.001-colonly", f"fix_numbered produced {duped.name}")
    expect(vocab.classify(duped.name).kind == "collider", "fixed name should parse")

    # --- select-issue operator ---
    bpy.ops.blendlink.select_issue(object_name="Wall-collonly")
    expect(bpy.context.view_layer.objects.active.name == "Wall-collonly", "select_issue failed")

    # --- overlay scan produced draw items (no GPU needed for the data) ---
    validation.recompute(bpy.context.scene)
    kinds = {item.kind for item in validation.result().overlay}
    expect("collider" in kinds and "socket" in kinds and "hotspot" in kinds,
           f"overlay items incomplete: {kinds}")

    # --- sync status on an unsaved file ---
    syncstatus.refresh(force=True)
    expect(syncstatus.status()[0] == "NO_FILE", f"unsaved file status: {syncstatus.status()}")

    # --- sync runner: subprocess + progress protocol + exit handling ---
    import tempfile
    syncrun = sys.modules[f"{PACKAGE}.syncrun"]
    work = Path(tempfile.mkdtemp(prefix="blendlink-syncrun-"))
    (work / "fake_sync.mjs").write_text(
        'const p = (fraction, label) => console.log("##blendlink " + JSON.stringify({ fraction, label }))\n'
        'p(0.2, "warming up")\n'
        'await new Promise(r => setTimeout(r, 150))\n'
        'p(0.7, "almost there")\n'
        'console.log("plain output line")\n'
        'p(1, "done")\n',
        encoding="utf8",
    )
    error = syncrun.start("node fake_sync.mjs", str(work))
    expect(error is None, f"syncrun.start failed: {error}")
    expect(syncrun.is_running(), "runner should be running")
    exit_code = syncrun.drain_blocking(timeout_seconds=60)
    expect(exit_code == 0, f"fake sync exited {exit_code}")
    fraction, label = syncrun.progress()
    expect(fraction == 1.0 and label == "done", f"progress ended at {fraction} {label!r}")
    expect(not syncrun.is_running(), "runner should have stopped")
    log_path = Path(syncrun.last_log_path())
    expect(log_path.exists() and "plain output line" in log_path.read_text(encoding="utf8"),
           "log file missing subprocess output")

    # failing command surfaces a nonzero exit code
    error = syncrun.start("node -e \"process.exit(3)\"", str(work))
    expect(error is None, f"syncrun.start (fail case) errored: {error}")
    exit_code = syncrun.drain_blocking(timeout_seconds=60)
    expect(exit_code == 3, f"expected exit 3, got {exit_code}")

    # --- lightmap scale (texel weight) ---
    select_only(barrel)
    bpy.ops.blendlink.set_texel_weight(weight=2.0)
    expect(abs(barrel["blendlink_texel_weight"] - 2.0) < 1e-6, "texel_weight not set")
    ui_data = barrel.id_properties_ui("blendlink_texel_weight").as_dict()
    expect("Lightmap scale" in ui_data.get("description", ""), f"texel_weight ui missing: {ui_data}")

    # --- bake-plan density readout (plan cached from the manifest) ---
    ui = sys.modules[f"{PACKAGE}.ui"]
    syncstatus._state["plan"] = {
        "Desk": {
            "name": "Desk", "pxPerMeter": 619.0, "uvShare": 0.031,
            "screenDensity": 249.0, "autoWeight": 2.0, "artistWeight": 1.0,
        },
    }
    entry = syncstatus.plan_for("Desk")
    expect(entry is not None and entry["pxPerMeter"] == 619.0, "plan_for lookup failed")
    expect(syncstatus.plan_for("Missing") is None, "plan_for must miss cleanly")
    lines = ui.density_summary(entry)
    expect(lines == ["619 px/m · 3.1% of atlas", "screen density 249 · auto 2x"],
           f"density summary wrong: {lines}")
    expect(ui.density_summary(None) == [], "empty plan should produce no lines")
    syncstatus._state["plan"] = {}

    # --- designation card + copy-hint gating ---
    select_only(hotspot)
    expect(ui.BLENDLINK_PT_designation.poll(bpy.context), "designation card should show for the active object")
    text = ui.describe(vocab.classify(hotspot.name))
    expect("Interactive marker" in text, f"hotspot consequence wrong: {text}")
    text = ui.describe(vocab.classify("Crate-colonly"))
    expect("hidden in the web build" in text, f"colonly consequence wrong: {text}")
    text = ui.describe(vocab.classify("Anything", {"blendlink_role": "convcol"}))
    expect("convex-hull" in text, f"property-role consequence wrong: {text}")
    expect(ui.describe(None).startswith("No designation"), "no-designation text wrong")
    expect(not bpy.ops.blendlink.copy_sync_hint.poll(), "copy hint should be disabled without a manifest hint")

    addon.unregister()
    print("BLENDLINK_ADDON_TESTS_PASSED")


main()
