# SPDX-License-Identifier: GPL-3.0-or-later
"""Pure Python contract tests for Blender-to-web light decisions."""
import math
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import weblights  # noqa: E402


class FakeCollection:
    def __init__(self, name, *, hidden=False, children=(), objects=()):
        self.name = name
        self.hide_render = hidden
        self.children = list(children)
        self.objects = list(objects)


class FakeLayerCollection:
    def __init__(self, collection, *, excluded=False, children=()):
        self.name = collection.name
        self.collection = collection
        self.exclude = excluded
        self.children = list(children)


class FakeLight:
    def __init__(self, name, light_type="POINT", *, collections=(), hidden=False,
                 matrix_world=None, matrix_local=None, parent=None, animation_data=None,
                 properties=None, **data):
        self.name = name
        self.type = "LIGHT"
        self.hide_render = hidden
        self.users_collection = list(collections)
        self.matrix_world = matrix_world or (
            (1.0, 0.0, 0.0, 0.0),
            (0.0, 1.0, 0.0, 0.0),
            (0.0, 0.0, 1.0, 0.0),
            (0.0, 0.0, 0.0, 1.0),
        )
        self.matrix_local = matrix_local
        self.parent = parent
        self.animation_data = animation_data
        self._properties = dict(properties or {})
        defaults = {
            "name": name,
            "type": light_type,
            "energy": 1000.0,
            "exposure": 0.0,
            "normalize": True,
            "shape": "SQUARE",
            "size": 1.0,
            "size_y": 1.0,
            "color": (1.0, 1.0, 1.0),
            "use_temperature": False,
            "temperature_color": (1.0, 1.0, 1.0),
            "spread": math.pi,
            "shadow_soft_size": 0.0,
            "angle": 0.0,
            "diffuse_factor": 1.0,
            "specular_factor": 1.0,
            "transmission_factor": 1.0,
            "volume_factor": 1.0,
            "use_shadow": True,
            "shadow_buffer_clip_start": 0.05,
            "shadow_filter_radius": 1.0,
            "shadow_maximum_resolution": 0.001,
            "use_shadow_jitter": False,
            "use_soft_falloff": True,
            "use_nodes": False,
            "use_custom_distance": False,
            "cutoff_distance": 40.0,
        }
        defaults.update(data)
        self.data = SimpleNamespace(**defaults)
        self.light_linking = SimpleNamespace(
            receiver_collection=None,
            blocker_collection=None,
        )

    def get(self, key, default=None):
        return self._properties.get(key, default)

    def __getitem__(self, key):
        return self._properties[key]

    def __setitem__(self, key, value):
        self._properties[key] = value

    def __contains__(self, key):
        return key in self._properties


class FakeInstance:
    def __init__(self, name, collection, *, collections=(), hidden=False):
        self.name = name
        self.type = "EMPTY"
        self.hide_render = hidden
        self.users_collection = list(collections)
        self.instance_type = "COLLECTION"
        self.instance_collection = collection


def scene_with(
        light, root, *, engine="BLENDER_EEVEE",
        direct_light_intensity=1.0, light_threshold=0.01,
        clamp_surface_direct=0.0):
    return SimpleNamespace(
        objects=[light], collection=root,
        render=SimpleNamespace(engine=engine),
        eevee=SimpleNamespace(
            direct_light_intensity=direct_light_intensity,
            light_threshold=light_threshold,
            clamp_surface_direct=clamp_surface_direct,
        ),
    )


def cycles_light_tree(*, falloff=False, linked_color=False,
                      linked_strength=False, indirect_surface=False,
                      grouped=False):
    def socket(default_value=None):
        return SimpleNamespace(
            links=[], is_linked=False, default_value=default_value,
        )

    emission = SimpleNamespace(
        type="EMISSION",
        inputs={"Strength": socket(1.0), "Color": socket((1.0, 1.0, 1.0, 1.0))},
    )
    output = SimpleNamespace(
        type="OUTPUT_LIGHT", is_active_output=True,
        inputs={"Surface": socket()},
    )
    if grouped:
        group = SimpleNamespace(type="GROUP", inputs=[])
        output.inputs["Surface"].links.append(SimpleNamespace(from_node=group))
        mix = None
    elif indirect_surface:
        mix = SimpleNamespace(type="MIX_SHADER", inputs=[socket()])
        mix.inputs[0].links.append(SimpleNamespace(from_node=emission))
        output.inputs["Surface"].links.append(SimpleNamespace(from_node=mix))
    else:
        mix = None
        output.inputs["Surface"].links.append(SimpleNamespace(from_node=emission))
    nodes = [emission, output]
    if grouped:
        nodes.append(group)
    if falloff:
        falloff_node = SimpleNamespace(type="LIGHT_FALLOFF", inputs=[])
        emission.inputs["Strength"].links.append(
            SimpleNamespace(from_node=falloff_node),
        )
        emission.inputs["Strength"].is_linked = True
        nodes.append(falloff_node)
    elif linked_strength:
        value_node = SimpleNamespace(type="VALUE", inputs=[])
        emission.inputs["Strength"].links.append(
            SimpleNamespace(from_node=value_node),
        )
        emission.inputs["Strength"].is_linked = True
        nodes.append(value_node)
    if linked_color:
        color_node = SimpleNamespace(type="RGB", inputs=[])
        emission.inputs["Color"].links.append(SimpleNamespace(from_node=color_node))
        emission.inputs["Color"].is_linked = True
        nodes.append(color_node)
    if mix is not None:
        nodes.append(mix)
    return SimpleNamespace(nodes=nodes)


def legacy_action(*data_paths):
    return SimpleNamespace(
        fcurves=[SimpleNamespace(data_path=path) for path in data_paths],
        is_action_layered=False,
        is_empty=not data_paths,
    )


def layered_action(*data_paths):
    slot = object()
    channelbag = SimpleNamespace(
        fcurves=[SimpleNamespace(data_path=path) for path in data_paths],
    )
    strip = SimpleNamespace(
        channelbag=lambda selected: channelbag if selected is slot else None,
    )
    action = SimpleNamespace(
        is_action_layered=True,
        is_empty=not data_paths,
        slots=[slot],
        layers=[SimpleNamespace(mute=False, strips=[strip])],
    )
    return action, slot


def action_animation(action, *, slot=None):
    return SimpleNamespace(
        action=action,
        action_slot=slot,
        drivers=[],
        nla_tracks=[],
        use_nla=True,
    )


class ExporterPolicyTests(unittest.TestCase):
    def test_policy_owns_compat_units_and_render_visibility(self):
        policy = weblights.exporter_policy({
            "export_lights", "use_renderable", "use_active_scene",
            "export_import_convert_lighting_mode",
        })
        self.assertEqual(policy, {
            "export_lights": True,
            "use_renderable": True,
            "use_active_scene": True,
            "export_import_convert_lighting_mode": "COMPAT",
        })

    def test_policy_rejects_brightness_and_visibility_escape_hatches(self):
        supported = {
            "export_lights", "use_renderable", "use_active_scene",
            "export_import_convert_lighting_mode",
        }
        with self.assertRaisesRegex(ValueError, "light-fidelity contract"):
            weblights.exporter_policy(supported, {
                "export_import_convert_lighting_mode": "SPEC",
            })
        with self.assertRaisesRegex(ValueError, "use_renderable"):
            weblights.exporter_policy(supported, {"use_renderable": False})
        with self.assertRaisesRegex(ValueError, "use_active_scene"):
            weblights.exporter_policy(supported, {"use_active_scene": False})


class VisibilityTests(unittest.TestCase):
    def test_one_visible_collection_path_keeps_a_multi_linked_light_visible(self):
        member = FakeCollection("Lights")
        hidden_parent = FakeCollection("Hidden Set", hidden=True, children=[member])
        visible_parent = FakeCollection("Visible Set", children=[member])
        root = FakeCollection("Scene", children=[hidden_parent, visible_parent])
        light = FakeLight("Key", collections=[member])

        result = weblights.render_visibility(light, scene_with(light, root))

        self.assertTrue(result.exported)
        self.assertEqual(result.code, "visible")

    def test_all_hidden_collection_paths_name_the_blockers(self):
        member = FakeCollection("Lights")
        hidden_parent = FakeCollection("Hidden Set", hidden=True, children=[member])
        root = FakeCollection("Scene", children=[hidden_parent])
        light = FakeLight("Key", collections=[member])

        result = weblights.render_visibility(light, scene_with(light, root))

        self.assertFalse(result.exported)
        self.assertEqual(result.code, "collectionHidden")
        self.assertEqual(result.hidden_collections, ("Hidden Set",))

    def test_object_render_switch_wins_before_collection_visibility(self):
        root = FakeCollection("Scene")
        light = FakeLight("Key", collections=[root], hidden=True)

        result = weblights.render_visibility(light, scene_with(light, root))

        self.assertFalse(result.exported)
        self.assertEqual(result.code, "objectHidden")

    def test_active_view_layer_exclusion_blocks_every_matching_path(self):
        member = FakeCollection("Excluded Lights")
        root = FakeCollection("Scene", children=[member])
        light = FakeLight("Key", collections=[member])
        layer = SimpleNamespace(layer_collection=FakeLayerCollection(
            root,
            children=[FakeLayerCollection(member, excluded=True)],
        ))

        result = weblights.render_visibility(
            light, scene_with(light, root), view_layer=layer,
        )

        self.assertFalse(result.exported)
        self.assertEqual(result.code, "viewLayerExcluded")
        self.assertIn("Excluded Lights", result.detail)


class InstanceSourceTests(unittest.TestCase):
    @staticmethod
    def scene(root, objects):
        return SimpleNamespace(
            objects=list(objects), collection=root,
            render=SimpleNamespace(engine="BLENDER_EEVEE"),
        )

    def test_collection_instance_empty_exposes_nested_child_light_once(self):
        light = FakeLight("Nested Key")
        child = FakeCollection("Nested Lights", objects=[light])
        source = FakeCollection("Library Set", children=[child])
        root = FakeCollection("Scene")
        instance = FakeInstance("Library Instance", source, collections=[root])

        objects = weblights.render_visible_instance_source_objects(
            self.scene(root, [instance]),
        )

        self.assertEqual(objects, (light,))

    def test_discovered_external_area_reaches_automatic_rect_area_diagnostics(self):
        light = FakeLight("Instanced Softbox", "AREA")
        source = FakeCollection("Library Set", objects=[light])
        root = FakeCollection("Scene")
        instance = FakeInstance("Library Instance", source, collections=[root])
        scene = self.scene(root, [instance])

        sources = weblights.render_visible_instance_source_objects(scene)
        analysis = weblights.analyze_scene(
            scene, instance_source_objects=sources,
        )

        self.assertEqual(len(analysis.diagnostics), 1)
        diagnostic = analysis.diagnostics[0]
        self.assertEqual(diagnostic.object_name, "Instanced Softbox")
        self.assertEqual(diagnostic.outcome, weblights.OUTCOME_APPROXIMATED)
        self.assertEqual(diagnostic.web_type, "rectArea")
        self.assertEqual(diagnostic.visibility.code, "collectionInstance")
        self.assertEqual(analysis.warnings[0].code, "rect-area-light-planned")

    def test_hidden_collections_objects_and_nested_instances_do_not_leak(self):
        visible = FakeLight("Visible Key")
        hidden_object = FakeLight("Hidden Object", hidden=True)
        hidden_collection_light = FakeLight("Hidden Collection Key")
        hidden_child = FakeCollection(
            "Hidden Child", hidden=True, objects=[hidden_collection_light],
        )
        nested_source = FakeCollection(
            "Nested Source", objects=[visible, hidden_object],
        )
        hidden_nested = FakeInstance("Hidden Nested", nested_source, hidden=True)
        visible_nested = FakeInstance("Visible Nested", nested_source)
        source = FakeCollection(
            "Library Set",
            objects=[hidden_nested, visible_nested],
            children=[hidden_child],
        )
        root = FakeCollection("Scene")
        instance = FakeInstance("Library Instance", source, collections=[root])

        objects = weblights.render_visible_instance_source_objects(
            self.scene(root, [instance]),
        )

        self.assertIn(visible, objects)
        self.assertIn(visible_nested, objects)
        self.assertNotIn(hidden_object, objects)
        self.assertNotIn(hidden_nested, objects)
        self.assertNotIn(hidden_collection_light, objects)
        self.assertEqual(objects.count(visible), 1)

    def test_any_visible_root_instance_path_keeps_shared_sources(self):
        light = FakeLight("Shared Key")
        source = FakeCollection("Library Set", objects=[light])
        root = FakeCollection("Scene")
        hidden = FakeInstance(
            "Stored Instance", source, collections=[root], hidden=True,
        )
        visible = FakeInstance("Hero Instance", source, collections=[root])

        objects = weblights.render_visible_instance_source_objects(
            self.scene(root, [hidden, visible]),
        )

        self.assertEqual(objects, (light,))

    def test_active_view_layer_exclusion_hides_the_root_instance(self):
        light = FakeLight("Excluded Key")
        source = FakeCollection("Library Set", objects=[light])
        instances = FakeCollection("Instances")
        root = FakeCollection("Scene", children=[instances])
        instance = FakeInstance(
            "Excluded Instance", source, collections=[instances],
        )
        view_layer = SimpleNamespace(layer_collection=FakeLayerCollection(
            root,
            children=[FakeLayerCollection(instances, excluded=True)],
        ))

        objects = weblights.render_visible_instance_source_objects(
            self.scene(root, [instance]), view_layer=view_layer,
        )

        self.assertEqual(objects, ())

    def test_recursive_collection_instances_fail_loudly_without_hanging(self):
        source = FakeCollection("Recursive Source")
        nested = FakeInstance("Recursive Nested", source)
        source.objects.append(nested)
        root = FakeCollection("Scene")
        instance = FakeInstance("Root Instance", source, collections=[root])

        with self.assertRaisesRegex(RuntimeError, "recursive Collection Instance"):
            weblights.render_visible_instance_source_objects(
                self.scene(root, [instance]),
            )

    def test_collection_hierarchy_cycles_fail_loudly_without_hanging(self):
        source = FakeCollection("Recursive Collection")
        source.children.append(source)
        root = FakeCollection("Scene")
        instance = FakeInstance("Root Instance", source, collections=[root])

        with self.assertRaisesRegex(RuntimeError, "collection hierarchy cycle"):
            weblights.render_visible_instance_source_objects(
                self.scene(root, [instance]),
            )


class RectAreaLightPolicyTests(unittest.TestCase):
    @staticmethod
    def opted_in(root, **data):
        return FakeLight(
            "Softbox", "AREA", collections=[root],
            properties={
                weblights.AREA_LIGHT_MODE_PROPERTY:
                    weblights.AREA_LIGHT_MODE_THREE_RECT,
            },
            **data,
        )

    def test_absence_selects_the_automatic_supported_rectangle_plan(self):
        root = FakeCollection("Scene")
        light = FakeLight("Softbox", "AREA", collections=[root])

        plan = weblights.plan_rect_area_light(light, scene_with(light, root))

        self.assertEqual(plan.mode, weblights.AREA_LIGHT_MODE_AUTO)
        self.assertEqual(plan.outcome, weblights.OUTCOME_APPROXIMATED)
        self.assertEqual(plan.descriptor.size, (1.0, 1.0))
        self.assertEqual(plan.descriptor.power, 1000.0)
        self.assertEqual(plan.refusals, ())
        self.assertEqual(plan.fallbacks, ())

    def test_explicit_auto_value_is_accepted_for_external_authoring_tools(self):
        root = FakeCollection("Scene")
        light = FakeLight(
            "Softbox", "AREA", collections=[root],
            properties={
                weblights.AREA_LIGHT_MODE_PROPERTY:
                    weblights.AREA_LIGHT_MODE_AUTO,
            },
        )

        plan = weblights.plan_rect_area_light(light, scene_with(light, root))

        self.assertEqual(plan.mode, weblights.AREA_LIGHT_MODE_AUTO)
        self.assertEqual(plan.outcome, weblights.OUTCOME_APPROXIMATED)
        self.assertIsNotNone(plan.descriptor)

    def test_explicit_bake_only_remains_authored_and_never_infers_a_descriptor(self):
        root = FakeCollection("Scene")
        light = FakeLight(
            "Softbox", "AREA", collections=[root],
            properties={
                weblights.AREA_LIGHT_MODE_PROPERTY:
                    weblights.AREA_LIGHT_MODE_BAKE_ONLY,
            },
        )
        scene = scene_with(light, root)

        plan = weblights.plan_rect_area_light(light, scene)
        analysis = weblights.analyze_scene(scene)

        self.assertEqual(plan.mode, weblights.AREA_LIGHT_MODE_BAKE_ONLY)
        self.assertEqual(plan.outcome, weblights.OUTCOME_BAKE_ONLY)
        self.assertIsNone(plan.descriptor)
        self.assertEqual(plan.refusals, ())
        self.assertEqual(plan.fallbacks, ())
        self.assertEqual(
            analysis.diagnostics[0].outcome,
            weblights.OUTCOME_BAKE_ONLY,
        )
        self.assertIn("explicitly Bake Only", analysis.diagnostics[0].detail)
        self.assertEqual(analysis.warnings[0].code, "light-bake-only")

    def test_eevee_direct_light_intensity_is_folded_into_automatic_power(self):
        root = FakeCollection("Scene")
        light = FakeLight(
            "Softbox", "AREA", collections=[root],
            energy=4.0, exposure=1.0,
        )

        eevee = weblights.plan_rect_area_light(
            light,
            scene_with(light, root, direct_light_intensity=0.25),
        )
        cycles = weblights.plan_rect_area_light(
            light,
            scene_with(
                light, root, engine="CYCLES", direct_light_intensity=0.25,
            ),
        )

        self.assertEqual(eevee.descriptor.power, 2.0)
        self.assertEqual(cycles.descriptor.power, 8.0)

    def test_animated_eevee_direct_light_intensity_keeps_automatic_bake_only(self):
        root = FakeCollection("Scene")
        light = FakeLight(
            "Softbox", "AREA", collections=[root],
            energy=4.0, exposure=1.0,
        )
        animated_scene = scene_with(
            light, root, direct_light_intensity=0.25,
        )
        animated_scene.animation_data = action_animation(
            legacy_action("eevee.direct_light_intensity"),
        )
        unrelated_scene = scene_with(
            light, root, direct_light_intensity=0.25,
        )
        unrelated_scene.animation_data = action_animation(
            legacy_action("render.film_transparent"),
        )

        animated = weblights.plan_rect_area_light(light, animated_scene)
        unrelated = weblights.plan_rect_area_light(light, unrelated_scene)

        self.assertIsNone(animated.descriptor)
        self.assertEqual(animated.outcome, weblights.OUTCOME_BAKE_ONLY)
        self.assertIn(
            "rect-area-scene-direct-light-animated",
            {issue.code for issue in animated.fallbacks},
        )
        self.assertEqual(unrelated.descriptor.power, 2.0)

    def test_spread_is_cycles_only_for_automatic_area_lights(self):
        root = FakeCollection("Scene")
        light = FakeLight(
            "Softbox", "AREA", collections=[root], spread=1.0,
        )

        eevee = weblights.plan_rect_area_light(light, scene_with(light, root))
        cycles = weblights.plan_rect_area_light(
            light, scene_with(light, root, engine="CYCLES"),
        )

        self.assertIsNotNone(eevee.descriptor)
        self.assertNotIn(
            "rect-area-spread-unsupported",
            {issue.code for issue in eevee.approximations},
        )
        self.assertIsNone(cycles.descriptor)
        self.assertEqual(cycles.outcome, weblights.OUTCOME_BAKE_ONLY)
        self.assertIn(
            "rect-area-spread-unsupported",
            {issue.code for issue in cycles.fallbacks},
        )

    def test_node_tree_animation_is_ignored_by_eevee_but_not_cycles(self):
        root = FakeCollection("Scene")
        animation = SimpleNamespace(
            action=object(), drivers=[], nla_tracks=[], use_nla=True,
        )
        tree = cycles_light_tree()
        tree.animation_data = animation
        light = FakeLight(
            "Softbox", "AREA", collections=[root],
            use_nodes=True, node_tree=tree,
        )

        eevee = weblights.plan_rect_area_light(light, scene_with(light, root))
        cycles = weblights.plan_rect_area_light(
            light, scene_with(light, root, engine="CYCLES"),
        )

        self.assertIsNotNone(eevee.descriptor)
        self.assertEqual(eevee.fallbacks, ())
        self.assertIsNone(cycles.descriptor)
        self.assertEqual(cycles.outcome, weblights.OUTCOME_BAKE_ONLY)
        self.assertIn(
            "rect-area-source-animated",
            {issue.code for issue in cycles.fallbacks},
        )

    def test_eevee_light_data_animation_allows_only_ignored_action_curves(self):
        root = FakeCollection("Scene")
        layered_ignored, layered_ignored_slot = layered_action(
            "spread", "use_nodes",
        )
        layered_relevant, layered_relevant_slot = layered_action("energy")
        fixtures = (
            (
                "legacy ignored",
                action_animation(legacy_action("spread", "use_nodes")),
                True,
            ),
            (
                "legacy relevant",
                action_animation(legacy_action("energy")),
                False,
            ),
            (
                "layered ignored",
                action_animation(layered_ignored, slot=layered_ignored_slot),
                True,
            ),
            (
                "layered relevant",
                action_animation(layered_relevant, slot=layered_relevant_slot),
                False,
            ),
        )
        for label, animation, accepted in fixtures:
            with self.subTest(layout=label):
                light = FakeLight("Softbox", "AREA", collections=[root])
                light.data.animation_data = animation
                plan = weblights.plan_rect_area_light(
                    light, scene_with(light, root),
                )

                self.assertEqual(plan.descriptor is not None, accepted)
                self.assertEqual(
                    "rect-area-source-animated"
                    in {issue.code for issue in plan.fallbacks},
                    not accepted,
                )

        cycles_ignored = FakeLight("Cycles Softbox", "AREA", collections=[root])
        cycles_ignored.data.animation_data = action_animation(
            legacy_action("spread", "use_nodes"),
        )
        cycles_plan = weblights.plan_rect_area_light(
            cycles_ignored,
            scene_with(cycles_ignored, root, engine="CYCLES"),
        )
        self.assertIn(
            "rect-area-source-animated",
            {issue.code for issue in cycles_plan.fallbacks},
        )

    def test_automatic_keeps_unsupported_static_semantics_bake_only(self):
        root = FakeCollection("Scene")
        fixtures = (
            (
                {"specular_factor": 0.25}, {},
                "rect-area-contributions-unsupported",
            ),
            (
                {"transmission_factor": 0.25}, {},
                "rect-area-contributions-unsupported",
            ),
            (
                {"use_custom_distance": True, "cutoff_distance": 12.0}, {},
                "rect-area-custom-distance-unsupported",
            ),
            (
                {"shape": "DISK"}, {},
                "rect-area-shape-unsupported",
            ),
            (
                {}, {"clamp_surface_direct": 2.0},
                "rect-area-direct-clamp-unsupported",
            ),
        )
        for data, scene_options, code in fixtures:
            with self.subTest(code=code):
                light = FakeLight(
                    "Softbox", "AREA", collections=[root], **data,
                )
                scene = scene_with(light, root, **scene_options)
                plan = weblights.plan_rect_area_light(light, scene)
                analysis = weblights.analyze_scene(scene)

                self.assertEqual(plan.mode, weblights.AREA_LIGHT_MODE_AUTO)
                self.assertEqual(plan.outcome, weblights.OUTCOME_BAKE_ONLY)
                self.assertIsNone(plan.descriptor)
                self.assertEqual(plan.refusals, ())
                self.assertIn(code, {issue.code for issue in plan.fallbacks})
                self.assertEqual(
                    analysis.warnings[0].code,
                    "rect-area-auto-bake-only",
                )
                self.assertFalse(analysis.warnings[0].blocking)

        linked = FakeLight("Linked Softbox", "AREA", collections=[root])
        linked.light_linking.receiver_collection = FakeCollection("Characters")
        linked_plan = weblights.plan_rect_area_light(
            linked, scene_with(linked, root),
        )
        self.assertIn(
            "rect-area-light-linking-unsupported",
            {issue.code for issue in linked_plan.fallbacks},
        )

        disabled_closures = FakeLight(
            "Portable Softbox", "AREA", collections=[root],
            transmission_factor=0.0, volume_factor=0.0,
        )
        disabled_plan = weblights.plan_rect_area_light(
            disabled_closures, scene_with(disabled_closures, root),
        )
        self.assertIsNotNone(disabled_plan.descriptor)
        self.assertNotIn(
            "rect-area-contributions-unsupported",
            {issue.code for issue in disabled_plan.approximations},
        )

    def test_eevee_micro_area_cull_and_clamp_preserve_automatic_artwork(self):
        root = FakeCollection("Scene")
        fixtures = (
            (
                {"shape": "SQUARE", "size": 0.004},
                "rect-area-eevee-micro-cull-unsupported",
            ),
            (
                {
                    "shape": "RECTANGLE",
                    "size": 0.004,
                    "size_y": 10.0,
                },
                "rect-area-eevee-micro-clamp-unsupported",
            ),
        )
        for data, code in fixtures:
            with self.subTest(code=code):
                automatic = FakeLight(
                    "Automatic Micro Area", "AREA", collections=[root], **data,
                )
                explicit = self.opted_in(root, **data)

                automatic_plan = weblights.plan_rect_area_light(
                    automatic, scene_with(automatic, root),
                )
                explicit_plan = weblights.plan_rect_area_light(
                    explicit, scene_with(explicit, root),
                )
                cycles_plan = weblights.plan_rect_area_light(
                    automatic,
                    scene_with(automatic, root, engine="CYCLES"),
                )

                self.assertEqual(
                    automatic_plan.outcome,
                    weblights.OUTCOME_BAKE_ONLY,
                )
                self.assertIn(
                    code,
                    {issue.code for issue in automatic_plan.fallbacks},
                )
                self.assertEqual(
                    explicit_plan.outcome,
                    weblights.OUTCOME_NOT_PUBLISHED,
                )
                self.assertIn(
                    code,
                    {issue.code for issue in explicit_plan.refusals},
                )
                self.assertIsNotNone(cycles_plan.descriptor)

    def test_square_normalized_plan_uses_local_size_and_exposure_power(self):
        root = FakeCollection("Scene")
        light = self.opted_in(
            root, shape="SQUARE", size=0.49, energy=2.5, exposure=1.0,
            matrix_world=(
                (2.0, 0.0, 0.0, 0.0),
                (0.0, 3.0, 0.0, 0.0),
                (0.0, 0.0, 4.0, 0.0),
                (0.0, 0.0, 0.0, 1.0),
            ),
        )

        plan = weblights.plan_rect_area_light(light, scene_with(light, root))

        self.assertEqual(plan.outcome, weblights.OUTCOME_APPROXIMATED)
        self.assertEqual(plan.refusals, ())
        self.assertEqual(plan.descriptor.size, (0.49, 0.49))
        self.assertAlmostEqual(plan.descriptor.power, 5.0)
        self.assertIsNone(plan.descriptor.intensity)
        self.assertEqual(plan.descriptor.as_dict(), {
            "schemaVersion": 1,
            "color": [1.0, 1.0, 1.0],
            "size": [0.49, 0.49],
            "power": 5.0,
        })

    def test_rectangle_unnormalized_plan_uses_three_intensity_convention(self):
        root = FakeCollection("Scene")
        light = self.opted_in(
            root, shape="RECTANGLE", size=2.0, size_y=3.5,
            energy=4.0, exposure=1.0, normalize=False,
        )

        descriptor = weblights.plan_rect_area_light(
            light, scene_with(light, root),
        ).descriptor

        self.assertEqual(descriptor.size, (2.0, 3.5))
        self.assertIsNone(descriptor.power)
        self.assertAlmostEqual(descriptor.intensity, 8.0 / math.pi)
        self.assertNotIn("power", descriptor.as_dict())

    def test_cycles_color_multiplies_constant_emission_and_temperature(self):
        root = FakeCollection("Scene")
        tree = cycles_light_tree()
        tree.nodes[0].inputs["Color"].default_value = (2.0, 0.5, 1.0, 1.0)
        light = self.opted_in(
            root,
            color=(0.5, 0.5, 0.5),
            use_nodes=True,
            node_tree=tree,
            use_temperature=True,
            temperature_color=(0.8, 1.0, 0.25),
        )

        descriptor = weblights.plan_rect_area_light(
            light, scene_with(light, root, engine="CYCLES"),
        ).descriptor

        self.assertEqual(descriptor.color, (0.8, 0.25, 0.125))

    def test_cycles_nondefault_emission_strength_is_not_guessed(self):
        root = FakeCollection("Scene")
        tree = cycles_light_tree()
        tree.nodes[0].inputs["Strength"].default_value = 4.0
        automatic = FakeLight(
            "Automatic Cycles Softbox", "AREA", collections=[root],
            use_nodes=True, node_tree=tree,
        )
        explicit = self.opted_in(
            root, use_nodes=True, node_tree=tree,
        )

        automatic_plan = weblights.plan_rect_area_light(
            automatic, scene_with(automatic, root, engine="CYCLES"),
        )
        explicit_plan = weblights.plan_rect_area_light(
            explicit, scene_with(explicit, root, engine="CYCLES"),
        )

        self.assertEqual(automatic_plan.outcome, weblights.OUTCOME_BAKE_ONLY)
        self.assertIn(
            "rect-area-emission-strength-nondefault",
            {issue.code for issue in automatic_plan.fallbacks},
        )
        self.assertEqual(explicit_plan.outcome, weblights.OUTCOME_NOT_PUBLISHED)
        self.assertIn(
            "rect-area-emission-strength-nondefault",
            {issue.code for issue in explicit_plan.refusals},
        )

    def test_eevee_ignores_light_node_color_like_the_installed_exporter_policy(self):
        root = FakeCollection("Scene")
        tree = cycles_light_tree()
        tree.nodes[0].inputs["Color"].default_value = (0.1, 0.2, 0.3, 1.0)
        light = self.opted_in(
            root, color=(0.4, 0.5, 0.6), use_nodes=True, node_tree=tree,
        )

        descriptor = weblights.plan_rect_area_light(
            light, scene_with(light, root),
        ).descriptor

        self.assertEqual(descriptor.color, (0.4, 0.5, 0.6))

    def test_bad_mode_and_non_area_source_are_named_refusals(self):
        root = FakeCollection("Scene")
        bad_mode = FakeLight(
            "Typo", "AREA", collections=[root],
            properties={weblights.AREA_LIGHT_MODE_PROPERTY: "rect-area"},
        )
        point = FakeLight(
            "Point", collections=[root],
            properties={
                weblights.AREA_LIGHT_MODE_PROPERTY:
                    weblights.AREA_LIGHT_MODE_THREE_RECT,
            },
        )
        stale_bake_only = FakeLight(
            "Stale Point", collections=[root],
            properties={
                weblights.AREA_LIGHT_MODE_PROPERTY:
                    weblights.AREA_LIGHT_MODE_BAKE_ONLY,
            },
        )

        bad_mode_plan = weblights.plan_rect_area_light(
            bad_mode, scene_with(bad_mode, root),
        )
        point_plan = weblights.plan_rect_area_light(
            point, scene_with(point, root),
        )
        stale_plan = weblights.plan_rect_area_light(
            stale_bake_only, scene_with(stale_bake_only, root),
        )

        self.assertEqual(bad_mode_plan.refusals[0].code, "rect-area-mode-invalid")
        self.assertEqual(point_plan.refusals[0].code, "rect-area-source-type-invalid")
        self.assertEqual(stale_plan.refusals[0].code, "rect-area-source-type-invalid")

    def test_invalid_dimensions_strength_shape_and_controls_refuse_loudly(self):
        root = FakeCollection("Scene")
        fixtures = (
            ({"size": 0.0}, "rect-area-size-invalid"),
            ({"size": float("nan")}, "rect-area-size-invalid"),
            ({"energy": -1.0}, "rect-area-energy-invalid"),
            ({"energy": float("inf")}, "rect-area-energy-invalid"),
            ({"exposure": float("nan")}, "rect-area-exposure-invalid"),
            ({"exposure": 1024.0}, "rect-area-strength-invalid"),
            ({"shape": "DISK"}, "rect-area-shape-unsupported"),
            ({"shape": "ELLIPSE"}, "rect-area-shape-unsupported"),
            ({"normalize": 1}, "rect-area-normalize-invalid"),
            ({"spread": float("nan")}, "rect-area-control-invalid"),
        )
        for index, (data, code) in enumerate(fixtures):
            with self.subTest(code=code, index=index):
                light = self.opted_in(root, **data)
                plan = weblights.plan_rect_area_light(
                    light, scene_with(light, root),
                )
                self.assertIn(code, {issue.code for issue in plan.refusals})
                self.assertIsNone(plan.descriptor)

    def test_linked_grouped_and_animated_sources_refuse_static_compilation(self):
        root = FakeCollection("Scene")
        animation = SimpleNamespace(
            action=object(), drivers=[], nla_tracks=[], use_nla=True,
        )
        fixtures = []

        linked_color = self.opted_in(
            root, use_nodes=True,
            node_tree=cycles_light_tree(linked_color=True),
        )
        fixtures.append((linked_color, "rect-area-emission-color-linked"))
        linked_strength = self.opted_in(
            root, use_nodes=True,
            node_tree=cycles_light_tree(linked_strength=True),
        )
        fixtures.append((linked_strength, "rect-area-emission-strength-linked"))
        grouped = self.opted_in(
            root, use_nodes=True, node_tree=cycles_light_tree(grouped=True),
        )
        fixtures.append((grouped, "rect-area-node-group-unresolved"))
        data_animated = self.opted_in(root)
        data_animated.data.animation_data = animation
        fixtures.append((data_animated, "rect-area-source-animated"))
        transform_animated = self.opted_in(root, animation_data=animation)
        fixtures.append((transform_animated, "rect-area-transform-animation-pending"))

        for light, code in fixtures:
            with self.subTest(code=code):
                plan = weblights.plan_rect_area_light(
                    light, scene_with(light, root, engine="CYCLES"),
                )
                self.assertIn(code, {issue.code for issue in plan.refusals})

    def test_singular_sheared_and_reflected_transforms_are_refused(self):
        root = FakeCollection("Scene")
        fixtures = (
            ((
                (1.0, 0.0, 0.0, 0.0),
                (0.0, 1.0, 0.0, 0.0),
                (0.0, 0.0, 0.0, 0.0),
                (0.0, 0.0, 0.0, 1.0),
            ), "rect-area-transform-singular"),
            ((
                (1.0, 0.25, 0.0, 0.0),
                (0.0, 1.0, 0.0, 0.0),
                (0.0, 0.0, 1.0, 0.0),
                (0.0, 0.0, 0.0, 1.0),
            ), "rect-area-transform-sheared"),
            ((
                (-1.0, 0.0, 0.0, 0.0),
                (0.0, 1.0, 0.0, 0.0),
                (0.0, 0.0, 1.0, 0.0),
                (0.0, 0.0, 0.0, 1.0),
            ), "rect-area-transform-reflected"),
        )
        for matrix, code in fixtures:
            with self.subTest(code=code):
                light = self.opted_in(root, matrix_world=matrix)
                plan = weblights.plan_rect_area_light(
                    light, scene_with(light, root),
                )
                self.assertIn(code, {issue.code for issue in plan.refusals})

    def test_local_shear_is_refused_even_when_world_basis_is_orthogonal(self):
        root = FakeCollection("Scene")
        local_shear = (
            (1.0, 0.0, 0.25, 0.0),
            (0.0, 1.0, 0.0, 0.0),
            (0.0, 0.0, 1.0, 0.0),
            (0.0, 0.0, 0.0, 1.0),
        )
        light = self.opted_in(root, matrix_local=local_shear)

        plan = weblights.plan_rect_area_light(light, scene_with(light, root))

        self.assertIn(
            "rect-area-local-transform-sheared",
            {issue.code for issue in plan.refusals},
        )
        self.assertIsNone(plan.descriptor)

    def test_approximation_reasons_name_every_material_source_loss(self):
        root = FakeCollection("Scene")
        light = self.opted_in(
            root, spread=1.0, specular_factor=0.25,
        )
        light.light_linking.receiver_collection = FakeCollection("Characters")
        light.light_linking.blocker_collection = FakeCollection("Blockers")

        plan = weblights.plan_rect_area_light(
            light, scene_with(light, root, engine="CYCLES"),
        )
        codes = {issue.code for issue in plan.approximations}

        self.assertTrue({
            "rect-area-pbr-only",
            "rect-area-direct-transmission-volume-unsupported",
            "rect-area-indirect-volume-unsupported",
            "rect-area-shadows-unsupported",
            "rect-area-spread-unsupported",
            "rect-area-contributions-unsupported",
            "rect-area-light-linking-unsupported",
            "rect-area-shadow-linking-unsupported",
        }.issubset(codes))

        eevee = self.opted_in(root)
        eevee_codes = {
            issue.code for issue in weblights.plan_rect_area_light(
                eevee, scene_with(eevee, root),
            ).approximations
        }
        self.assertIn(
            "rect-area-eevee-ltc-horizon-approximation",
            eevee_codes,
        )

    def test_descriptor_parser_enforces_v1_and_one_strength_form(self):
        payload = {
            "schemaVersion": 1,
            "color": [1.0, 2.0, 3.0],
            "size": [4.0, 5.0],
            "power": 6.0,
            "futureAdditiveField": True,
        }

        self.assertEqual(
            weblights.parse_rect_area_light_descriptor(payload).as_dict(),
            {key: value for key, value in payload.items()
             if key != "futureAdditiveField"},
        )
        invalid = (
            ({**payload, "schemaVersion": 2}, "schemaVersion"),
            ({**payload, "schemaVersion": 1.0}, "schemaVersion"),
            ({**payload, "intensity": 1.0}, "exactly one"),
            ({key: value for key, value in payload.items() if key != "power"},
             "exactly one"),
            ({**payload, "size": [0.0, 1.0]}, "positive"),
            ({**payload, "color": [-1.0, 1.0, 1.0]}, "non-negative"),
            ({**payload, "power": float("nan")}, "finite non-negative"),
        )
        for malformed, message in invalid:
            with self.subTest(message=message):
                with self.assertRaisesRegex(ValueError, message):
                    weblights.parse_rect_area_light_descriptor(malformed)

    def test_source_planning_accepts_valid_opt_in_before_final_evidence_exists(self):
        root = FakeCollection("Scene")
        light = self.opted_in(root)

        analysis = weblights.analyze_scene(scene_with(light, root))
        diagnostic = analysis.diagnostics[0]
        warning = analysis.warnings[0]

        self.assertEqual(diagnostic.status, weblights.STATUS_APPROXIMATED)
        self.assertEqual(diagnostic.outcome, weblights.OUTCOME_APPROXIMATED)
        self.assertEqual(diagnostic.web_type, "rectArea")
        self.assertIn("Final export will attach", diagnostic.detail)
        self.assertEqual(warning.code, "rect-area-light-planned")
        self.assertFalse(warning.blocking)
        self.assertEqual(warning.severity, "WARNING")

    def test_finished_descriptor_evidence_promotes_opt_in_to_approximated(self):
        root = FakeCollection("Scene")
        light = self.opted_in(root)

        analysis = weblights.analyze_scene(
            scene_with(light, root),
            published_object_names={light.name},
            published_rect_area_objects=[light],
        )
        diagnostic = analysis.diagnostics[0]
        warning = analysis.warnings[0]

        self.assertEqual(diagnostic.status, weblights.STATUS_APPROXIMATED)
        self.assertEqual(diagnostic.outcome, weblights.OUTCOME_APPROXIMATED)
        self.assertEqual(diagnostic.web_type, "rectArea")
        self.assertEqual(
            diagnostic.expected_three_power,
            weblights.plan_rect_area_light(
                light, scene_with(light, root),
            ).descriptor.power,
        )
        self.assertIn("exactly one finalized glTF node", diagnostic.detail)
        self.assertEqual(warning.code, "rect-area-light-approximated")
        self.assertFalse(warning.blocking)
        self.assertEqual(warning.severity, "WARNING")

    def test_finished_scope_blocks_inconsistent_rect_area_evidence(self):
        root = FakeCollection("Scene")
        light = self.opted_in(root)

        missing = weblights.analyze_scene(
            scene_with(light, root),
            published_object_names={light.name},
            published_rect_area_objects=[],
        )
        self.assertEqual(
            missing.diagnostics[0].outcome,
            weblights.OUTCOME_NOT_PUBLISHED,
        )
        self.assertEqual(
            missing.warnings[0].code,
            "rect-area-light-final-evidence-missing",
        )
        self.assertTrue(missing.warnings[0].blocking)

        omitted = weblights.analyze_scene(
            scene_with(light, root),
            published_object_names=set(),
            published_rect_area_objects=[],
        )
        self.assertEqual(omitted.diagnostics[0].visibility.code, "exportScope")
        self.assertEqual(omitted.diagnostics[0].status, weblights.STATUS_NOT_EXPORTED)


class DiagnosticTests(unittest.TestCase):
    def test_exact_point_light_reports_three_power_not_spec_lumens(self):
        root = FakeCollection("Scene")
        light = FakeLight("Key", collections=[root], energy=1000.0)

        analysis = weblights.analyze_scene(scene_with(light, root))
        diagnostic = analysis.diagnostics[0]

        self.assertEqual(diagnostic.status, weblights.STATUS_EXACT)
        self.assertAlmostEqual(
            diagnostic.expected_web_intensity, 1000.0 / (4.0 * math.pi),
        )
        self.assertEqual(diagnostic.expected_three_power, 1000.0)
        self.assertEqual(analysis.warnings, ())

    def test_light_exposure_is_part_of_the_exported_power_prediction(self):
        root = FakeCollection("Scene")
        light = FakeLight("Key", collections=[root], energy=1000.0, exposure=1.0)

        diagnostic = weblights.analyze_scene(scene_with(light, root)).diagnostics[0]

        self.assertEqual(diagnostic.source_exposure, 1.0)
        self.assertAlmostEqual(
            diagnostic.expected_web_intensity, 2000.0 / (4.0 * math.pi),
        )
        self.assertEqual(diagnostic.expected_three_power, 2000.0)

    def test_spot_power_uses_three_spotlights_pi_convention(self):
        root = FakeCollection("Scene")
        light = FakeLight("Key", "SPOT", collections=[root], energy=1000.0)

        diagnostic = weblights.analyze_scene(scene_with(light, root)).diagnostics[0]

        self.assertAlmostEqual(
            diagnostic.expected_web_intensity, 1000.0 / (4.0 * math.pi),
        )
        self.assertAlmostEqual(diagnostic.expected_three_power, 250.0)
        self.assertIn("one quarter", diagnostic.detail)

    def test_default_eevee_light_nodes_do_not_create_a_false_approximation(self):
        root = FakeCollection("Scene")
        light = FakeLight(
            "Key", collections=[root], use_nodes=True, node_tree=object(),
        )

        diagnostic = weblights.analyze_scene(scene_with(light, root)).diagnostics[0]

        self.assertEqual(diagnostic.status, weblights.STATUS_EXACT)
        self.assertAlmostEqual(
            diagnostic.expected_web_intensity, 1000.0 / (4.0 * math.pi),
        )

    def test_default_cycles_point_nodes_keep_the_energy_prediction(self):
        root = FakeCollection("Scene")
        light = FakeLight(
            "Key", collections=[root], use_nodes=True,
            node_tree=cycles_light_tree(),
        )

        diagnostic = weblights.analyze_scene(
            scene_with(light, root, engine="CYCLES"),
        ).diagnostics[0]

        self.assertEqual(diagnostic.status, weblights.STATUS_EXACT)
        self.assertAlmostEqual(
            diagnostic.expected_web_intensity, 1000.0 / (4.0 * math.pi),
        )

    def test_cycles_light_falloff_is_reported_without_guessing_its_output(self):
        root = FakeCollection("Scene")
        light = FakeLight(
            "Key", collections=[root], use_nodes=True,
            node_tree=cycles_light_tree(falloff=True),
        )

        diagnostic = weblights.analyze_scene(
            scene_with(light, root, engine="CYCLES"),
        ).diagnostics[0]

        self.assertEqual(diagnostic.status, weblights.STATUS_APPROXIMATED)
        self.assertIsNone(diagnostic.expected_web_intensity)
        self.assertIn("Light Falloff", diagnostic.detail)

    def test_cycles_procedural_strength_keeps_glb_energy_but_warns_about_the_render_gap(self):
        root = FakeCollection("Scene")
        light = FakeLight(
            "Key", collections=[root], use_nodes=True,
            node_tree=cycles_light_tree(linked_strength=True),
        )

        diagnostic = weblights.analyze_scene(
            scene_with(light, root, engine="CYCLES"),
        ).diagnostics[0]

        self.assertEqual(diagnostic.status, weblights.STATUS_APPROXIMATED)
        self.assertAlmostEqual(
            diagnostic.expected_web_intensity, 1000.0 / (4.0 * math.pi),
        )
        self.assertIn("falls back to the light data-block Energy", diagnostic.detail)

    def test_cycles_indirect_emission_surface_is_never_labelled_exact(self):
        root = FakeCollection("Scene")
        light = FakeLight(
            "Key", collections=[root], use_nodes=True,
            node_tree=cycles_light_tree(indirect_surface=True),
        )

        diagnostic = weblights.analyze_scene(
            scene_with(light, root, engine="CYCLES"),
        ).diagnostics[0]

        self.assertEqual(diagnostic.status, weblights.STATUS_APPROXIMATED)
        self.assertIn("intermediate shader graph", diagnostic.detail)

    def test_cycles_light_node_group_suppresses_numeric_overclaims(self):
        root = FakeCollection("Scene")
        light = FakeLight(
            "Key", collections=[root], use_nodes=True,
            node_tree=cycles_light_tree(grouped=True),
        )

        diagnostic = weblights.analyze_scene(
            scene_with(light, root, engine="CYCLES"),
        ).diagnostics[0]

        self.assertEqual(diagnostic.status, weblights.STATUS_APPROXIMATED)
        self.assertIsNone(diagnostic.expected_web_intensity)
        self.assertIsNone(diagnostic.expected_three_power)
        self.assertIn("Shader Node Group", diagnostic.detail)

    def test_default_area_light_gets_a_nonblocking_automatic_source_plan(self):
        root = FakeCollection("Scene")
        light = FakeLight("Softbox", "AREA", collections=[root])

        analysis = weblights.analyze_scene(scene_with(light, root))
        diagnostic = analysis.diagnostics[0]
        warning = analysis.warnings[0]

        self.assertEqual(diagnostic.status, weblights.STATUS_APPROXIMATED)
        self.assertEqual(diagnostic.outcome, weblights.OUTCOME_APPROXIMATED)
        self.assertEqual(diagnostic.web_type, "rectArea")
        self.assertIn("automatic Three Rect Area source plan", diagnostic.detail)
        self.assertIn("Final export will attach", diagnostic.detail)
        self.assertIn("Point, Spot, or Sun", diagnostic.remedy)
        self.assertEqual(warning.code, "rect-area-light-planned")
        self.assertFalse(warning.blocking)
        self.assertEqual(warning.severity, "WARNING")

    def test_finished_scope_requires_the_automatic_area_descriptor(self):
        root = FakeCollection("Scene")
        light = FakeLight("Softbox", "AREA", collections=[root])

        analysis = weblights.analyze_scene(
            scene_with(light, root), published_object_names=set(),
        )
        diagnostic = analysis.diagnostics[0]

        self.assertEqual(diagnostic.outcome, weblights.OUTCOME_NOT_PUBLISHED)
        self.assertEqual(diagnostic.visibility.code, "exportScope")
        self.assertEqual(analysis.warnings, ())

    def test_nonportable_light_fields_are_approximated_and_explained(self):
        root = FakeCollection("Scene")
        light = FakeLight(
            "Fill", collections=[root], shadow_soft_size=0.5,
            specular_factor=0.25,
        )

        analysis = weblights.analyze_scene(
            scene_with(light, root, engine="CYCLES"),
        )
        diagnostic = analysis.diagnostics[0]

        self.assertEqual(diagnostic.status, weblights.STATUS_APPROXIMATED)
        self.assertIn("emitter radius", diagnostic.detail)
        self.assertIn("Specular 0.25", diagnostic.detail)
        self.assertEqual(analysis.warnings[0].code, "light-approximated")

    def test_transmission_and_soft_falloff_are_never_labelled_exact(self):
        root = FakeCollection("Scene")
        light = FakeLight(
            "Fill", collections=[root], shadow_soft_size=0.5,
            use_soft_falloff=False, transmission_factor=0.25,
        )

        diagnostic = weblights.analyze_scene(scene_with(light, root)).diagnostics[0]

        self.assertEqual(diagnostic.status, weblights.STATUS_APPROXIMATED)
        self.assertIn("Soft Falloff Off", diagnostic.detail)
        self.assertIn("Transmission 0.25", diagnostic.detail)

    def test_object_light_and_shadow_linking_are_never_labelled_exact(self):
        root = FakeCollection("Scene")
        light = FakeLight("Rim", collections=[root])
        light.light_linking.receiver_collection = FakeCollection("Characters")
        light.light_linking.blocker_collection = FakeCollection("Hero Blockers")

        diagnostic = weblights.analyze_scene(scene_with(light, root)).diagnostics[0]

        self.assertEqual(diagnostic.status, weblights.STATUS_APPROXIMATED)
        self.assertIn('Light Linking collection "Characters"', diagnostic.detail)
        self.assertIn('Shadow Linking collection "Hero Blockers"', diagnostic.detail)

    def test_authored_blender_shadow_tuning_is_never_labelled_exact(self):
        root = FakeCollection("Scene")
        light = FakeLight(
            "Key", collections=[root], shadow_buffer_clip_start=0.2,
            shadow_filter_radius=2.0, shadow_maximum_resolution=0.004,
            use_shadow_jitter=True,
        )

        diagnostic = weblights.analyze_scene(scene_with(light, root)).diagnostics[0]

        self.assertEqual(diagnostic.status, weblights.STATUS_APPROXIMATED)
        self.assertIn("Clip Start 0.2", diagnostic.detail)
        self.assertIn("Filter Radius 2", diagnostic.detail)
        self.assertIn("Maximum Resolution 0.004", diagnostic.detail)
        self.assertIn("Jitter On", diagnostic.detail)

    def test_native_shadows_off_is_a_portable_blendlink_intent(self):
        root = FakeCollection("Scene")
        light = FakeLight("Fill", collections=[root], use_shadow=False)

        diagnostic = weblights.analyze_scene(scene_with(light, root)).diagnostics[0]

        self.assertEqual(diagnostic.status, weblights.STATUS_EXACT)
        self.assertEqual(diagnostic.outcome, weblights.OUTCOME_EXACT)

    def test_render_hidden_area_light_does_not_create_a_false_warning(self):
        root = FakeCollection("Scene")
        light = FakeLight("Stored Softbox", "AREA", collections=[root], hidden=True)

        analysis = weblights.analyze_scene(scene_with(light, root))

        self.assertEqual(analysis.diagnostics[0].visibility.code, "objectHidden")
        self.assertEqual(analysis.warnings, ())

    def test_finished_export_scope_can_explain_a_visible_omitted_light(self):
        root = FakeCollection("Scene")
        light = FakeLight("Key", collections=[root])

        analysis = weblights.analyze_scene(
            scene_with(light, root), published_object_names={"Other Light"},
        )
        diagnostic = analysis.diagnostics[0]

        self.assertEqual(diagnostic.status, weblights.STATUS_NOT_EXPORTED)
        self.assertEqual(diagnostic.outcome, weblights.OUTCOME_NOT_PUBLISHED)
        self.assertEqual(diagnostic.visibility.code, "exportScope")
        self.assertIn("absent from this export scope", diagnostic.detail)
        self.assertEqual(analysis.warnings, ())

    def test_finished_export_scope_keeps_a_published_light_exact(self):
        root = FakeCollection("Scene")
        light = FakeLight("Key", collections=[root])

        diagnostic = weblights.analyze_scene(
            scene_with(light, root), published_object_names={"Key"},
        ).diagnostics[0]

        self.assertEqual(diagnostic.status, weblights.STATUS_EXACT)
        self.assertEqual(diagnostic.visibility.code, "visible")

    def test_finished_collection_instance_source_is_diagnosed_once(self):
        root = FakeCollection("Scene")
        source_collection = FakeCollection("Library Lights")
        source = FakeLight("Instanced Key", collections=[source_collection])
        scene = scene_with(source, root)
        scene.objects = []

        analysis = weblights.analyze_scene(
            scene,
            published_object_names={"Collection Instance.001"},
            published_source_objects=[source, source],
        )

        self.assertEqual(len(analysis.diagnostics), 1)
        diagnostic = analysis.diagnostics[0]
        self.assertEqual(diagnostic.object_name, "Instanced Key")
        self.assertEqual(diagnostic.visibility.code, "collectionInstance")
        self.assertTrue(diagnostic.visibility.exported)
        self.assertNotEqual(diagnostic.status, weblights.STATUS_NOT_EXPORTED)

    def test_scene_light_is_not_duplicated_by_published_source_evidence(self):
        root = FakeCollection("Scene")
        light = FakeLight("Key", collections=[root])
        scene = scene_with(light, root)

        analysis = weblights.analyze_scene(
            scene,
            published_object_names={"Key"},
            published_source_objects=[light],
        )

        self.assertEqual(len(analysis.diagnostics), 1)

    def test_external_instance_area_reports_automatic_artifact_fallback(self):
        root = FakeCollection("Scene")
        source_collection = FakeCollection("Library Lights")
        source = FakeLight(
            "Instanced Softbox", "AREA", collections=[source_collection],
        )
        scene = scene_with(source, root)
        scene.objects = []

        analysis = weblights.analyze_scene(
            scene,
            published_object_names=set(),
            instance_source_objects=[source, source],
            rect_area_artifact_fallbacks={
                source.name: weblights.RectAreaLightIssue(
                    "rect-area-instance-transform-unproven",
                    "the composed instance transform is not proven",
                ),
            },
        )

        self.assertEqual(len(analysis.diagnostics), 1)
        diagnostic = analysis.diagnostics[0]
        self.assertEqual(diagnostic.outcome, weblights.OUTCOME_BAKE_ONLY)
        self.assertEqual(diagnostic.visibility.code, "collectionInstance")
        self.assertEqual(
            analysis.warnings[0].code,
            "rect-area-auto-artifact-bake-only",
        )
        self.assertFalse(analysis.warnings[0].blocking)

    def test_external_instance_punctual_absent_from_khr_is_not_published(self):
        root = FakeCollection("Scene")
        source_collection = FakeCollection("Library Lights")
        source = FakeLight("Instanced Key", collections=[source_collection])
        scene = scene_with(source, root)
        scene.objects = []

        analysis = weblights.analyze_scene(
            scene,
            published_object_names=set(),
            instance_source_objects=[source],
        )

        diagnostic = analysis.diagnostics[0]
        self.assertEqual(diagnostic.status, weblights.STATUS_NOT_EXPORTED)
        self.assertEqual(diagnostic.outcome, weblights.OUTCOME_NOT_PUBLISHED)
        self.assertEqual(diagnostic.visibility.code, "exportScope")
        self.assertEqual(analysis.warnings, ())

    def test_external_instance_punctual_present_in_khr_keeps_instance_visibility(self):
        root = FakeCollection("Scene")
        source_collection = FakeCollection("Library Lights")
        source = FakeLight("Instanced Key", collections=[source_collection])
        scene = scene_with(source, root)
        scene.objects = []

        diagnostic = weblights.analyze_scene(
            scene,
            published_object_names={"Instanced Key"},
            instance_source_objects=[source],
        ).diagnostics[0]

        self.assertEqual(diagnostic.status, weblights.STATUS_EXACT)
        self.assertEqual(diagnostic.visibility.code, "collectionInstance")

    def test_instance_and_published_evidence_dedupe_the_same_source_identity(self):
        root = FakeCollection("Scene")
        source_collection = FakeCollection("Library Lights")
        source = FakeLight("Instanced Key", collections=[source_collection])
        scene = scene_with(source, root)
        scene.objects = []

        analysis = weblights.analyze_scene(
            scene,
            published_object_names={"Instanced Key"},
            published_source_objects=[source],
            instance_source_objects=[source, source],
        )

        self.assertEqual(len(analysis.diagnostics), 1)


if __name__ == "__main__":
    program = unittest.main(argv=[sys.argv[0]], verbosity=2, exit=False)
    if not program.result.wasSuccessful():
        raise SystemExit(1)
    print("BLENDLINK_WEBLIGHTS_PURE_PASSED")
