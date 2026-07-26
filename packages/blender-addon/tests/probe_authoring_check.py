# SPDX-License-Identifier: GPL-3.0-or-later
"""Real Blender reflection render + authoring transaction smoke."""
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
from array import array
from pathlib import Path

import bpy


ADDON_DIR = Path(__file__).resolve().parents[1]
PACKAGE = "blendlink_probe_check_addon"


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


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


def select_only(*objects):
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[-1] if objects else None


def touched_state(scene):
    render = scene.render
    image = render.image_settings
    cycles = scene.cycles
    view = scene.view_settings
    try:
        preferences = bpy.context.preferences.addons["cycles"].preferences
        cycles_preferences = (
            preferences.compute_device_type,
            tuple(
                sorted(
                    (device.name, device.type, bool(device.use))
                    for device in preferences.devices
                )
            ),
        )
    except (AttributeError, KeyError, RuntimeError, TypeError):
        cycles_preferences = None
    return {
        "camera": scene.camera.as_pointer() if scene.camera is not None else None,
        "engine": render.engine,
        "resolution": (
            render.resolution_x, render.resolution_y, render.resolution_percentage,
        ),
        "filmTransparent": render.film_transparent,
        "renderPolicy": tuple(
            (key, getattr(render, key))
            for key in (
                "use_compositing", "use_sequencer", "use_stamp",
                "use_border", "use_crop_to_border", "use_multiview",
                "use_simplify", "use_freestyle", "use_motion_blur",
            )
            if hasattr(render, key)
        ),
        "filepath": render.filepath,
        "useFileExtension": render.use_file_extension,
        "image": (
            image.file_format, image.color_mode, image.color_depth, image.exr_codec,
        ),
        "cyclesSamples": cycles.samples,
        "cyclesDevice": cycles.device,
        "cyclesPreferences": cycles_preferences,
        "view": (view.view_transform, view.look, view.exposure, view.gamma),
        "objectVisibility": tuple(
            sorted((obj.as_pointer(), bool(obj.hide_render)) for obj in scene.objects)
        ),
        "objectPointers": tuple(sorted(obj.as_pointer() for obj in scene.objects)),
        "cameraPointers": tuple(sorted(camera.as_pointer() for camera in bpy.data.cameras)),
        "active": (
            bpy.context.view_layer.objects.active.as_pointer()
            if bpy.context.view_layer.objects.active is not None else None
        ),
        "selected": tuple(sorted(obj.as_pointer() for obj in bpy.context.selected_objects)),
        "frame": (scene.frame_current, scene.frame_subframe),
    }


def make_emissive_sphere(bakelib, scene, name, location, color):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=24,
        ring_count=12,
        radius=1.25,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    material = bpy.data.materials.new(f"{name} Material")
    bakelib.ensure_shader_node_tree(material)
    material.node_tree.nodes.clear()
    output = material.node_tree.nodes.new("ShaderNodeOutputMaterial")
    emission = material.node_tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (*color, 1.0)
    emission.inputs["Strength"].default_value = 1.0
    material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    obj.data.materials.append(material)
    return obj


def make_shader_to_rgb_blocker(bakelib):
    bpy.ops.mesh.primitive_plane_add(location=(8.0, 8.0, 8.0))
    obj = bpy.context.object
    obj.name = "Known Eevee-only Probe Contributor"
    material = bpy.data.materials.new("Known Eevee-only Probe Material")
    bakelib.ensure_shader_node_tree(material)
    material.node_tree.nodes.clear()
    output = material.node_tree.nodes.new("ShaderNodeOutputMaterial")
    diffuse = material.node_tree.nodes.new("ShaderNodeBsdfDiffuse")
    shader_to_rgb = material.node_tree.nodes.new("ShaderNodeShaderToRGB")
    emission = material.node_tree.nodes.new("ShaderNodeEmission")
    material.node_tree.links.new(diffuse.outputs["BSDF"], shader_to_rgb.inputs["Shader"])
    material.node_tree.links.new(shader_to_rgb.outputs["Color"], emission.inputs["Color"])
    material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    obj.data.materials.append(material)
    return obj, material


def expect_cardinal_panorama(image):
    width, height = (int(value) for value in image.size[:2])
    values = array("f", [0.0]) * (width * height * 4)
    image.pixels.foreach_get(values)
    locations = {
        "red": [], "cyan": [], "green": [],
        "magenta": [], "blue": [], "yellow": [],
    }
    for index in range(width * height):
        red, green, blue = values[index * 4:index * 4 + 3]
        x = index % width
        y = index // width
        if red > 0.25 and green < red * 0.35 and blue < red * 0.35:
            locations["red"].append((x, y))
        if green > 0.25 and blue > 0.25 and red < min(green, blue) * 0.35:
            locations["cyan"].append((x, y))
        if green > 0.25 and red < green * 0.35 and blue < green * 0.35:
            locations["green"].append((x, y))
        if red > 0.25 and blue > 0.25 and green < min(red, blue) * 0.35:
            locations["magenta"].append((x, y))
        if blue > 0.25 and red < blue * 0.35 and green < blue * 0.35:
            locations["blue"].append((x, y))
        if red > 0.25 and green > 0.25 and blue < min(red, green) * 0.35:
            locations["yellow"].append((x, y))
    expect(
        all(len(points) >= 20 for points in locations.values()),
        "reflection panorama did not contain all six cardinal emitters: "
        + ", ".join(f"{name}={len(points)}" for name, points in locations.items()),
    )
    centers = {
        name: (
            sum(x for x, _y in points) / len(points),
            sum(y for _x, y in points) / len(points),
        )
        for name, points in locations.items()
    }
    tolerance_x = width * 0.1
    tolerance_y = height * 0.14
    expect(
        abs(centers["red"][0] - width * 0.5) < tolerance_x
        and abs(centers["red"][1] - height * 0.5) < tolerance_y,
        f"+X/red did not land at panorama center: {centers['red']}",
    )
    expect(
        abs(centers["green"][0] - width * 0.25) < tolerance_x
        and abs(centers["green"][1] - height * 0.5) < tolerance_y,
        f"+Y/green did not land at quarter width: {centers['green']}",
    )
    expect(
        abs(centers["magenta"][0] - width * 0.75) < tolerance_x
        and abs(centers["magenta"][1] - height * 0.5) < tolerance_y,
        f"-Y/magenta did not land at three-quarter width: {centers['magenta']}",
    )
    expect(
        any(x < width * 0.08 for x, _y in locations["cyan"])
        and any(x > width * 0.92 for x, _y in locations["cyan"]),
        "-X/cyan did not wrap across both sides of the equirectangular seam",
    )
    expect(
        centers["blue"][1] > height * 0.75
        and centers["yellow"][1] < height * 0.25,
        f"vertical probe orientation was wrong: blue={centers['blue']}, "
        f"yellow={centers['yellow']}",
    )


def synthetic_render(bakelib, scene, path, resolution, samples):
    """Fast valid staged EXR for lifecycle tests; the primitive is tested real below."""
    width = int(resolution) * 4
    height = int(resolution) * 2
    image = bpy.data.images.new(
        "BLENDLINK_PROBE_TRANSACTION_SOURCE", width=width, height=height,
        alpha=False, float_buffer=True,
    )
    try:
        image.generated_color = (0.08, 0.12, 0.2, 1.0)
        bakelib.save_linear_exr(image, str(path))
    finally:
        bpy.data.images.remove(image)
    return {
        "path": str(path), "width": width, "height": height,
        "samples": int(samples), "format": "exr",
        "encoding": "scene-linear-half-zip",
        "deviceClass": "cpu", "backend": "cpu",
        "bytes": Path(path).stat().st_size,
        "hash": bakelib.file_sha256(str(path)),
    }


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    load_addon()
    bakelib = sys.modules[f"{PACKAGE}.bakelib_loader"].bakelib
    probe_authoring = sys.modules[f"{PACKAGE}.probe_authoring"]

    scene = bpy.context.scene
    world = bpy.data.worlds.new("Probe Smoke World")
    bakelib.ensure_shader_node_tree(world)
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.12, 0.2, 0.35, 1.0)
    background.inputs["Strength"].default_value = 0.4
    scene.world = world

    bpy.ops.mesh.primitive_cube_add(location=(0.0, 0.0, 0.0))
    cube = bpy.context.active_object
    cube.name = "Probe Subject"
    cardinal_objects = (
        make_emissive_sphere(bakelib, scene, "PX", (3.0, 0.0, 0.0), (1.0, 0.0, 0.0)),
        make_emissive_sphere(bakelib, scene, "NX", (-3.0, 0.0, 0.0), (0.0, 1.0, 1.0)),
        make_emissive_sphere(bakelib, scene, "PY", (0.0, 3.0, 0.0), (0.0, 1.0, 0.0)),
        make_emissive_sphere(bakelib, scene, "NY", (0.0, -3.0, 0.0), (1.0, 0.0, 1.0)),
        make_emissive_sphere(bakelib, scene, "PZ", (0.0, 0.0, 3.0), (0.0, 0.0, 1.0)),
        make_emissive_sphere(bakelib, scene, "NZ", (0.0, 0.0, -3.0), (1.0, 1.0, 0.0)),
    )
    camera_data = bpy.data.cameras.new("Artist Camera")
    camera = bpy.data.objects.new("Artist Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = (4.0, -5.0, 3.0)
    scene.camera = camera
    select_only(cube)

    # Deliberately non-contract values prove every touched setting comes back.
    scene.render.resolution_x = 333
    scene.render.resolution_y = 197
    scene.render.resolution_percentage = 47
    scene.render.film_transparent = True
    for key in (
        "use_compositing", "use_sequencer", "use_stamp", "use_border",
        "use_crop_to_border", "use_multiview", "use_simplify",
        "use_freestyle", "use_motion_blur",
    ):
        if hasattr(scene.render, key):
            setattr(scene.render, key, True)
    scene.render.filepath = "//artist-render/beauty"
    scene.render.use_file_extension = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.exr_codec = "PIZ"
    scene.cycles.samples = 7
    scene.view_settings.exposure = 1.125

    with tempfile.TemporaryDirectory(prefix="blendlink-probe-headless-") as directory:
        root = Path(directory)
        panorama = root / "real-panorama.exr"
        # Backend discovery can populate Blender's read-only device inventory.
        # Prime that inventory once, then make the render prove every mutable
        # scene/preference value is restored exactly.
        discovery_state = bakelib.snapshot_cycles_compute_state(scene)
        bakelib.configure_cycles_compute_device(
            scene,
            restore_state=discovery_state,
            purpose="reflection probe test discovery",
        )
        bakelib.restore_cycles_compute_state(discovery_state)
        before = touched_state(scene)
        rendered = bakelib.render_reflection_panorama_exr(
            scene,
            (0.0, 0.0, 0.0),
            str(panorama),
            resolution=64,
            samples=1,
            exclude_objects=(cube,),
        )
        after = touched_state(scene)
        expect(after == before, f"panorama render leaked Blender state:\n{before}\n!=\n{after}")
        expect(
            rendered["width"] == 256 and rendered["height"] == 128
            and rendered["samples"] == 1 and rendered["format"] == "exr",
            f"panorama contract was wrong: {rendered}",
        )
        payload = panorama.read_bytes()
        expect(
            len(payload) == rendered["bytes"] and len(payload) > 100
            and payload[:4] == bytes((0x76, 0x2F, 0x31, 0x01))
            and bakelib.file_sha256(str(panorama)) == rendered["hash"],
            "real panorama was not an exact, non-empty OpenEXR artifact",
        )
        inspected = bpy.data.images.load(str(panorama), check_existing=False)
        try:
            expect(
                tuple(inspected.size) == (256, 128),
                f"real EXR loaded at {tuple(inspected.size)}",
            )
            expect_cardinal_panorama(inspected)
        finally:
            bpy.data.images.remove(inspected)

        failed_panorama = root / "failed-panorama.exr"
        before_failure = touched_state(scene)
        try:
            bakelib.render_reflection_panorama_exr(
                scene,
                (0.0, 0.0, 0.0),
                str(failed_panorama),
                resolution=16,
                samples=1,
                exclude_objects=(cube,),
                log=lambda _message: (_ for _ in ()).throw(
                    RuntimeError("intentional capture-stage failure")
                ),
            )
        except RuntimeError as error:
            expect(
                "intentional capture-stage failure" in str(error),
                f"capture failure lost its cause: {error}",
            )
        else:
            raise AssertionError("forced reflection capture failure reported success")
        expect(
            touched_state(scene) == before_failure and not cube.hide_render,
            "failed reflection capture leaked receiver visibility or Blender state",
        )

        # Exercise the complete authoring install path using a cheap valid EXR
        # producer now that the canonical panoramic renderer itself is proven.
        blend_path = root / "probe-authoring.blend"
        bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
        select_only(cube)
        expect(
            bpy.ops.blendlink.setup_website_export() == {"FINISHED"},
            "website scene setup failed",
        )
        select_only(cube)
        expect(
            bpy.ops.blendlink.add_reflection_probe() == {"FINISHED"},
            "reflection probe creation failed",
        )
        project = scene.blendlink_project
        probe = project.reflection_probes[0]
        probe.name = "Hero Chrome"
        probe.capture_mode = "BAKED"
        probe.resolution = "64"
        probe.samples = 1

        blocker_object, blocker_material = make_shader_to_rgb_blocker(bakelib)
        try:
            try:
                probe_authoring.bake(bpy.context, [probe])
            except ValueError as error:
                expect(
                    "known Eevee-only material" in str(error)
                    and blocker_material.name in str(error)
                    and "Custom Texture" in str(error),
                    f"known Cycles probe blocker was not artist-readable: {error}",
                )
            else:
                raise AssertionError("offline probe accepted a known Eevee-only contributor")
        finally:
            blocker_mesh = blocker_object.data
            bpy.data.objects.remove(blocker_object, do_unlink=True)
            if blocker_mesh.users == 0:
                bpy.data.meshes.remove(blocker_mesh)
            if blocker_material.users == 0:
                bpy.data.materials.remove(blocker_material)
            bpy.context.view_layer.update()

        scene_fingerprint = bakelib.fingerprint_reflection_scene_dependencies(scene)
        hash_with_receiver = bakelib.fingerprint_reflection_probe_dependencies(
            scene,
            probe_authoring.probe_origin(probe),
            int(probe.resolution),
            int(probe.samples),
            scene_fingerprint=scene_fingerprint,
            excluded_objects=(cube,),
        )
        hash_without_receiver = bakelib.fingerprint_reflection_probe_dependencies(
            scene,
            probe_authoring.probe_origin(probe),
            int(probe.resolution),
            int(probe.samples),
            scene_fingerprint=scene_fingerprint,
            excluded_objects=(),
        )
        expect(
            hash_with_receiver != hash_without_receiver,
            "reflection receiver assignment membership did not invalidate source evidence",
        )

        real_renderer = bakelib.render_reflection_panorama_exr
        captured_exclusions = []
        def staged_renderer(
                current_scene, position, path, *, resolution, samples,
                exclude_objects=(), log=print):
            captured_exclusions.append(tuple(exclude_objects))
            return synthetic_render(
                bakelib, current_scene, path, resolution, samples,
            )
        bakelib.render_reflection_panorama_exr = staged_renderer
        try:
            results = probe_authoring.bake(bpy.context, [probe])
        finally:
            bakelib.render_reflection_panorama_exr = real_renderer
        expect(len(results) == 1, f"single-probe bake returned {results}")
        expect(
            captured_exclusions == [(cube,)],
            f"authoring bake did not exclude its assigned receiver: {captured_exclusions}",
        )
        result = results[0]
        final_path = Path(result.path)
        expect(
            final_path.is_file() and final_path.parent.name == "reflection-probes"
            and tuple(probe.baked_image.size) == (256, 128),
            "baked probe was not installed under the owned derived directory",
        )
        exact_bytes = final_path.read_bytes()
        recipe = json.loads(scene["blendlink_recipe"])
        authored = recipe["reflectionProbes"][0]
        expect(
            authored["source"] == "baked" and authored["samples"] == 1
            and authored["texture"] == {
                "imageName": probe.baked_image.name,
                "width": 256, "height": 128, "format": "exr",
                "colorSpace": "linear", "sourceHash": result.source_hash,
                "contentHash": result.content_hash,
            },
            f"baked source evidence was not embedded exactly: {authored}",
        )
        status = probe_authoring.evaluate_status(scene, probe)
        expect(
            status.code == "READY" and status.evidence.content_hash == result.content_hash,
            f"fresh bake did not report Ready: {status}",
        )

        exporter_path = ADDON_DIR.parent / "blendlink" / "blender" / "export_scene.py"
        exporter_spec = importlib.util.spec_from_file_location(
            "blendlink_probe_check_exporter", exporter_path,
        )
        exporter = importlib.util.module_from_spec(exporter_spec)
        exporter_spec.loader.exec_module(exporter)
        _settings, resolved_recipe = exporter.resolve_scene_recipe({"draft": False})
        published = exporter.publish_reflection_probe_assets(
            resolved_recipe, str(root / "published-scene.glb"),
        )
        published_asset = published["hero-chrome"]
        expect(
            Path(published_asset["path"]).read_bytes() == exact_bytes
            and published_asset["hash"] == result.content_hash
            and published_asset["sourceHash"] == result.source_hash
            and published_asset["width"] == 256 and published_asset["height"] == 128,
            f"exporter did not publish exact baked probe evidence: {published_asset}",
        )

        original_location = cube.location.copy()
        cube.location.x += 0.5
        bpy.context.view_layer.update()
        stale = probe_authoring.evaluate_status(scene, probe)
        expect(
            stale.code == "STALE" and stale.expected_source_hash != stale.source_hash,
            f"scene dependency change did not stale the probe: {stale}",
        )
        try:
            exporter.resolve_scene_recipe({"draft": False})
        except SystemExit as error:
            expect("stale" in str(error) and "bake it again" in str(error),
                   f"exporter stale-source failure was vague: {error}")
        else:
            raise AssertionError("exporter published a stale baked reflection source")
        cube.location = original_location
        bpy.context.view_layer.update()

        # A render-stage failure must retain both prior bytes and authored RNA.
        prior = (
            probe.baked_image.as_pointer(), probe.baked_source_hash,
            probe.baked_content_hash, probe.baked_at_utc, probe.derived_asset_path,
            probe.baked_width, probe.baked_height,
        )
        def fail_renderer(
                _scene, _position, path, *, resolution, samples,
                exclude_objects=(), log=print):
            Path(path).write_bytes(b"incomplete staged reflection")
            raise RuntimeError("intentional render-stage failure")

        bakelib.render_reflection_panorama_exr = fail_renderer
        try:
            try:
                probe_authoring.bake(bpy.context, [probe])
            except RuntimeError as error:
                expect("intentional render-stage failure" in str(error), f"failure lost context: {error}")
            else:
                raise AssertionError("failed reflection render reported success")
        finally:
            bakelib.render_reflection_panorama_exr = real_renderer
        after_failure = (
            probe.baked_image.as_pointer(), probe.baked_source_hash,
            probe.baked_content_hash, probe.baked_at_utc, probe.derived_asset_path,
            probe.baked_width, probe.baked_height,
        )
        expect(after_failure == prior, "failed bake mutated authored reflection evidence")
        expect(final_path.read_bytes() == exact_bytes, "failed bake replaced prior exact bytes")
        leftovers = list(final_path.parent.glob(".*.pending-*.exr")) + list(
            final_path.parent.glob(".*.backup-*")
        )
        expect(not leftovers, f"failed bake leaked transactional files: {leftovers}")

        # Bake All uses the same transaction and renders every source before
        # it replaces any prior asset.
        select_only(cube)
        expect(
            bpy.ops.blendlink.add_reflection_probe() == {"FINISHED"},
            "second reflection probe creation failed",
        )
        second = project.reflection_probes[1]
        second.capture_mode = "BAKED"
        second.resolution = "64"
        second.samples = 1
        calls = 0
        def fail_second(
                current_scene, position, path, *, resolution, samples,
                exclude_objects=(), log=print):
            nonlocal calls
            calls += 1
            if calls == 2:
                Path(path).write_bytes(b"partial second probe")
                raise RuntimeError("intentional second-probe failure")
            return synthetic_render(bakelib, current_scene, path, resolution, samples)

        bakelib.render_reflection_panorama_exr = fail_second
        try:
            try:
                probe_authoring.bake(bpy.context, [probe, second])
            except RuntimeError as error:
                expect("second-probe failure" in str(error), f"Bake All lost failure: {error}")
            else:
                raise AssertionError("partially failed Bake All reported success")
        finally:
            bakelib.render_reflection_panorama_exr = real_renderer
        expect(calls == 2, "Bake All did not stage every source in order")
        expect(final_path.read_bytes() == exact_bytes, "Bake All partially replaced the first probe")
        expect(
            not list(final_path.parent.glob(".*.pending-*.exr"))
            and not list(final_path.parent.glob(".*.backup-*")),
            "Bake All failure leaked transactional files",
        )

        baked_image = probe.baked_image
        probe.baked_image = None
        if baked_image is not None and baked_image.users == 0:
            bpy.data.images.remove(baked_image)

    print("BLENDLINK_PROBE_AUTHORING_CHECK_PASSED")


if __name__ == "__main__":
    main()
