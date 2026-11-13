#!/usr/bin/env python3
"""Inventory actual Blender nodes and join an explicitly reviewed capability map.

Run with ordinary Python; each --blender starts an isolated factory process.
No support is inferred from node names. Newly available nodes/enums stay visible
and fail --check until their native baseline is explicitly reviewed.
"""
from __future__ import annotations
import argparse
import ast
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = ("supported", "partial", "bake-only", "unsupported", "structural")
SOURCE_FILES = (
    "packages/blender-addon/tsl_ir.py", "packages/blender-addon/material_compiler.py",
    "packages/blender-addon/procedural.py", "packages/blendlink/blender/compositor_graph.py",
    "packages/blendlink/src/tslNodeRecipe.ts", "packages/blendlink/src/tslSourceCompositor.ts",
    "packages/blendlink/src/threeRuntime.ts",
)

# Native get_channel_index()/compute_limit_channels() select exactly one color
# space's key and (only for Single) limit. RNA leaves all ten menus enabled.
# This is an audit projection, never a compiler/runtime support declaration.
CHANNEL_MATTE_SEMANTIC_MODEL = "channel-matte-active-selectors-v1"
CHANNEL_MATTE_SOURCES = (
    {"revision": "v5.2.0", "path": "source/blender/nodes/composite/nodes/node_composite_channel_key.cc",
     "sha256": "d06c0cd1b787d1b29b2251863004497f40213e9e27997457b35518187994d68e"},
    {"revision": "02f0899d78e3", "path": "source/blender/nodes/composite/nodes/node_composite_channel_key.cc",
     "sha256": "f1ad1a04060bb10739944ae5349185c7b7d078c4fa07cfb55c96cc1f2a9967df"},
)
CHANNEL_MATTE_MENUS = {
    "Color Space": ("RGB", "HSV", "YUV", "YCbCr"), "Limit Method": ("Max", "Single"),
    **{space + " " + role + " Channel": channels
       for space, channels in (("RGB", ("R", "G", "B")), ("HSV", ("H", "S", "V")),
                               ("YUV", ("Y", "U", "V")), ("YCbCr", ("Y", "Cb", "Cr")))
       for role in ("Key", "Limit")},
}


def channel_matte_semantic_scope(identifier, version, inputs, outputs, menus, booleans=()):
    """Return a proven active-selector projection, or None for generic audit.

    Inspect the complete schema/options before pruning anything. Unknown native
    versions, states, classes, availability, menus or semantic booleans retain
    generic exploration and its normal completeness/budget requirements.
    """
    if identifier != "CompositorNodeChannelMatte" or tuple(version) not in {(5, 2, 0), (5, 3, 0)} or booleans:
        return None
    expected_inputs = {
        "Image": ("RGBA", "NodeSocketColor"), "Minimum": ("VALUE", "NodeSocketFloatFactor"),
        "Maximum": ("VALUE", "NodeSocketFloatFactor"),
        **{name: ("MENU", "NodeSocketMenu") for name in CHANNEL_MATTE_MENUS},
    }
    expected_outputs = {"Image": ("RGBA", "NodeSocketColor"), "Matte": ("VALUE", "NodeSocketFloat")}
    for sockets, expected in ((inputs, expected_inputs), (outputs, expected_outputs)):
        if len(sockets) != len(expected) or {item.get("identifier") for item in sockets} != set(expected):
            return None
        if any((item.get("type"), item.get("socketClass")) != expected[item["identifier"]]
               or not item.get("enabled") or item.get("unavailable", True) for item in sockets):
            return None
    if set(menus) != {"inputs:" + name for name in CHANNEL_MATTE_MENUS}:
        return None
    settings = {item["identifier"]: item.get("default") for item in inputs}
    for name, choices in CHANNEL_MATTE_MENUS.items():
        options = menus["inputs:" + name]
        if not isinstance(options, (tuple, list, set)) or set(options) != set(choices) or settings[name] not in choices:
            return None
    space, method = settings["Color Space"], settings["Limit Method"]
    active = {"inputs:Color Space", "inputs:Limit Method", "inputs:" + space + " Key Channel"}
    if method == "Single":
        active.add("inputs:" + space + " Limit Channel")
    return {"model": CHANNEL_MATTE_SEMANTIC_MODEL, "activeSelectors": sorted(active),
            "skippedSelectors": sorted(set(menus) - active)}


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(encoded(value).encode()).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf8")


def node_selection(node_ids):
    if node_ids is None:
        return None
    if not isinstance(node_ids, (list, tuple)) or not node_ids or any(
            not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", identifier)
            for identifier in node_ids):
        raise ValueError("node_ids must be a nonempty list of native node identifiers")
    return sorted(set(node_ids))


def native_catalog(*, enum_state_budget=2048, enum_transition_budget=100000, enumeration_budgets=None,
                   node_ids=None, _node_factory=None):
    selected = node_selection(node_ids)
    import bpy
    base_properties = set(bpy.types.Node.bl_rna.properties.keys())
    editor_properties = {"select", "hide", "show_options", "show_preview", "show_texture", "use_custom_color", "mute"}
    schemas = {}

    def clean(value):
        if value is None or isinstance(value, (bool, int, float, str)):
            return value
        try:
            return [float(item) for item in value]
        except (TypeError, ValueError):
            return {"rnaType": type(value).__name__, "name": getattr(value, "name", None)}

    def new_node(tree, identifier):
        # The native regression injects different inactive defaults through a
        # real RNA factory. Ordinary inventory always uses untouched defaults.
        return _node_factory(tree, identifier) if _node_factory else tree.nodes.new(identifier)

    def socket_records(node):
        result = {}
        for direction in ("inputs", "outputs"):
            result[direction] = [{
                "identifier": socket.identifier, "name": socket.name,
                "type": socket.type, "socketClass": socket.bl_idname,
                "enabled": bool(getattr(socket, "enabled", True)),
                "unavailable": bool(getattr(socket, "is_unavailable", False)),
                **({"default": clean(socket.default_value)} if hasattr(socket, "default_value") else {}),
            } for socket in getattr(node, direction)]
        return result

    def schema(node, *, state=False, semantic=None):
        result = socket_records(node)
        skipped = set(semantic["skippedSelectors"]) if semantic else set()
        for direction, sockets in result.items():
            for socket in sockets:
                if state and (not socket["enabled"] or socket["unavailable"]
                              or direction == "inputs" and socket["type"] == "MENU"
                              and "inputs:" + socket["identifier"] in skipped):
                    socket.pop("default", None)
        key = digest(result)[:20]
        if key in schemas and schemas[key] != result:
            raise RuntimeError("Socket-schema hash collision")
        schemas[key] = result
        return key

    def modes(node):
        result = []
        owners = [("", node)]
        for name in ("color_ramp", "mapping"):
            owner = getattr(node, name, None)
            if owner is not None and hasattr(owner, "bl_rna"):
                owners.append((name + ".", owner))
        for prefix, owner in owners:
            for prop in owner.bl_rna.properties:
                if prop.type != "ENUM" or prop.is_readonly or (not prefix and prop.identifier in base_properties):
                    continue
                values = [item.identifier for item in prop.enum_items if item.identifier]
                if values:
                    result.append((prefix + prop.identifier, values, "rna"))
        for socket in node.inputs:
            if socket.type != "MENU" or not hasattr(socket, "default_value") \
                    or not socket.enabled or getattr(socket, "is_unavailable", False):
                continue
            prop = socket.bl_rna.properties.get("default_value")
            values = [item.identifier for item in prop.enum_items if item.identifier] if prop and prop.type == "ENUM" else []
            source = "rna"
            if not values:
                # Dynamic socket menus do not expose enum_items. Native RNA
                # validation returns the actual context-specific allowed list.
                try:
                    socket.default_value = "__BLENDLINK_UNKNOWN_ENUM_PROBE__"
                except (TypeError, ValueError) as error:
                    match = re.search(r"not found in (\(.*\))", str(error), re.S)
                    if match:
                        parsed = ast.literal_eval(match.group(1))
                        values = list(parsed) if isinstance(parsed, tuple) and all(isinstance(v, str) for v in parsed) else []
                        if isinstance(parsed, tuple) and not parsed:
                            source = "native-empty-menu-validation"
                if source != "native-empty-menu-validation":
                    source = "native-dynamic-menu-validation"
            result.append(("inputs:" + socket.identifier, values, source))
        return result

    def owner(node, path):
        if path.startswith("inputs:"):
            return node.inputs[path.split(":", 1)[1]], "default_value"
        parts = path.split(".")
        result = node
        for part in parts[:-1]:
            result = getattr(result, part)
        return result, parts[-1]

    def enum_candidates(node):
        """Union static RNA with the native contextual validation menu.

        Compare.operation demonstrates why enum_items alone is insufficient:
        RGBA exposes BRIGHTER/DARKER although the default FLOAT RNA list does
        not. Invalid native assignment is read-only after its expected error.
        """
        result = {}
        owners = [("", node)]
        for name in ("color_ramp", "mapping"):
            nested = getattr(node, name, None)
            if nested is not None and hasattr(nested, "bl_rna"):
                owners.append((name + ".", nested))
        for prefix, target in owners:
            for prop in target.bl_rna.properties:
                if prop.type != "ENUM" or prop.is_readonly or (not prefix and prop.identifier in base_properties):
                    continue
                values = {item.identifier for item in prop.enum_items if item.identifier}
                values.update(item.identifier for item in prop.enum_items_static if item.identifier)
                source = "rna-static-and-native-context-validation"
                try:
                    setattr(target, prop.identifier, "__BLENDLINK_UNKNOWN_ENUM_PROBE__")
                except (RuntimeError, TypeError, ValueError) as error:
                    match = re.search(r"not found in (\(.*\))", str(error), re.S)
                    if match:
                        parsed = ast.literal_eval(match.group(1))
                        if isinstance(parsed, tuple) and all(isinstance(item, str) for item in parsed):
                            values.update(parsed)
                            if not parsed and not values: source = "native-empty-menu-validation"
                result[prefix + prop.identifier] = (sorted(values), source)
        for path, values, source in modes(node):
            if path.startswith("inputs:"):
                result[path] = (values, source)
        return result

    def boolean_paths(node):
        result = []
        owners = [("", node)]
        for name in ("color_ramp", "mapping"):
            nested = getattr(node, name, None)
            if nested is not None and hasattr(nested, "bl_rna"):
                owners.append((name + ".", nested))
        for prefix, target in owners:
            result.extend(prefix + prop.identifier for prop in target.bl_rna.properties
                          if prop.type == "BOOLEAN" and not prop.is_readonly
                          and (prefix or prop.identifier not in base_properties | editor_properties))
        return sorted(result)

    def semantic_scope(node, menus, bools):
        records = socket_records(node)
        return channel_matte_semantic_scope(node.bl_idname, bpy.app.version, records["inputs"], records["outputs"],
                                            {path: values for path, (values, _) in menus.items()}, bools)

    def state_schema(node):
        if node.bl_idname != "CompositorNodeChannelMatte":
            return schema(node, state=True)
        return schema(node, state=True, semantic=semantic_scope(node, enum_candidates(node), boolean_paths(node)))

    def explore_enum_states(tree, identifier, record):
        budget = (enumeration_budgets or {}).get(domain + ":" + identifier, {})
        state_budget = min(enum_state_budget, budget.get("states", enum_state_budget))
        transition_budget = min(enum_transition_budget, budget.get("transitions", enum_transition_budget))
        pending = [()]
        seen = set()
        states = []
        transitions = 0
        failures = []
        budget_exhausted = False
        semantic_states, fallback_states, skipped, active_sets = 0, 0, set(), set()
        while pending:
            history = pending.pop(0)
            probe = new_node(tree, identifier)
            try:
                for path, value in history:
                    target, key = owner(probe, path)
                    setattr(target, key, value)
                menus = enum_candidates(probe)
                bools = boolean_paths(probe)
                semantic = semantic_scope(probe, menus, bools) if identifier == "CompositorNodeChannelMatte" else None
                if semantic:
                    menus = {path: choices for path, choices in menus.items() if path in semantic["activeSelectors"]}
                settings = {}
                for path in sorted(set(menus) | set(bools)):
                    target, key = owner(probe, path)
                    settings[path] = clean(getattr(target, key))
                state_key = encoded(settings)
                if state_key in seen:
                    continue
                if len(states) >= state_budget:
                    budget_exhausted = True
                    break
                seen.add(state_key)
                states.append({"settings": settings, "socketSchema": schema(probe, state=True, semantic=semantic),
                               **({"activeSelectors": semantic["activeSelectors"]} if semantic else {})})
                if semantic:
                    semantic_states += 1
                    skipped.update(semantic["skippedSelectors"])
                    active_sets.add(tuple(semantic["activeSelectors"]))
                else:
                    fallback_states += 1
                for path, (values, source) in menus.items():
                    observed = record["enums"].setdefault(path, {"source": source, "available": {}, "rejectedRnaValues": {}})
                    if not values and source == "native-empty-menu-validation": observed["emptyNativeMenu"] = True
                    elif not values: observed["optionsUnavailable"] = True
                    for value in values:
                        if transitions >= transition_budget:
                            budget_exhausted = True
                            break
                        transitions += 1
                        candidate = new_node(tree, identifier)
                        try:
                            for old_path, old_value in history:
                                target, key = owner(candidate, old_path)
                                setattr(target, key, old_value)
                            target, key = owner(candidate, path)
                            setattr(target, key, value)
                            observed["available"].setdefault(value, {"socketSchema": state_schema(candidate), "assignmentFromSettings": dict(settings)})
                            observed["rejectedRnaValues"].pop(value, None)
                            observed.pop("optionsUnavailable", None)
                            # Skip no-op transitions without creating an
                            # exponentially large pending queue.
                            changed = any(clean(getattr(owner(candidate, setting)[0], owner(candidate, setting)[1])) != previous
                                          for setting, previous in settings.items() if not setting.startswith("inputs:")
                                          or candidate.inputs.get(setting.split(":", 1)[1]) is not None)
                            if changed:
                                pending.append(history + ((path, value),))
                        except (RuntimeError, TypeError, ValueError, KeyError, AttributeError) as error:
                            if value not in observed["available"]:
                                observed["rejectedRnaValues"].setdefault(value, str(error))
                        finally:
                            tree.nodes.remove(candidate)
                    if budget_exhausted: break
                if budget_exhausted: break
                for path in bools:
                    if transitions >= transition_budget:
                        budget_exhausted = True
                        break
                    transitions += 1
                    pending.append(history + ((path, not settings[path]),))
            except (RuntimeError, TypeError, ValueError, KeyError, AttributeError) as error:
                failures.append(str(error))
            finally:
                tree.nodes.remove(probe)
        record["enumStateExploration"] = {
            "status": "incomplete" if budget_exhausted or failures else "complete",
            "stateBudget": state_budget, "transitionBudget": transition_budget,
            "transitions": transitions, "stateCount": len(states),
            "stateDigest": digest(sorted(states, key=encoded)),
            "representativeStates": list({state["socketSchema"]: state for state in reversed(states)}.values()),
            "failures": sorted(set(failures)),
            "scope": "Reachable enum, active MENU socket and semantic writable node/color-ramp/mapping boolean states in the first creatable context; editor flags and structural mute do not multiply menu states. Other context defaults recorded separately. Inactive socket menu cross-products, numeric/socket-boolean values, authored group interfaces, ID bindings and point handles are not enumerated. All states are counted/digested; representative states cover distinct socket schemas.",
        }
        if semantic_states:
            record["enumStateExploration"]["semanticScope"] = {
                "model": CHANNEL_MATTE_SEMANTIC_MODEL, "sources": list(CHANNEL_MATTE_SOURCES),
                "rule": "Only the selected color-space Key menu, plus its Limit menu for Single, affects native output; Color Space and Limit Method always remain active. Only proven inactive MENU defaults are omitted from state schemas; raw context/default schemas remain unchanged.",
                "appliedStates": semantic_states, "genericFallbackStates": fallback_states,
                "skippedSelectors": sorted(skipped), "activeSelectorSets": [list(value) for value in sorted(active_sets)],
            }

    candidates = selected if selected is not None else []
    if selected is None:
        for name in dir(bpy.types):
            cls = getattr(bpy.types, name)
            try:
                if issubclass(cls, bpy.types.Node):
                    candidates.append(name)
            except (TypeError, AttributeError):
                pass
    domains = {}
    for domain, tree_type in (("shader", "ShaderNodeTree"), ("compositor", "CompositorNodeTree")):
        group = bpy.data.node_groups.new("Blendlink isolated coverage " + domain, tree_type)
        for direction in ("INPUT", "OUTPUT"):
            group.interface.new_socket(name="Image" if domain == "compositor" else "Color", in_out=direction, socket_type="NodeSocketColor")
        material = None
        if domain == "shader":
            material = bpy.data.materials.new("Blendlink isolated native catalog")
            material.use_nodes = True
            root_tree = material.node_tree
        elif hasattr(bpy.context.scene, "compositing_node_group"):
            root_tree = bpy.data.node_groups.new("Blendlink isolated compositor root", tree_type)
            bpy.context.scene.compositing_node_group = root_tree
        else:
            bpy.context.scene.use_nodes = True
            root_tree = bpy.context.scene.node_tree
        nodes, unavailable = {}, []
        try:
            for context_name, tree in (("root", root_tree), ("group", group)):
                for identifier in candidates:
                    try:
                        node = new_node(tree, identifier)
                    except (RuntimeError, TypeError, ValueError) as error:
                        unavailable.append({"id": identifier, "context": context_name, "reason": str(error)})
                        continue
                    if identifier in nodes:
                        nodes[identifier]["contexts"].append(context_name)
                        nodes[identifier]["contextSocketSchemas"][context_name] = schema(node)
                        tree.nodes.remove(node)
                        continue
                    record = {"id": identifier, "label": node.bl_label or node.name,
                              "contexts": [context_name], "contextSocketSchemas": {context_name: schema(node)},
                              "defaultSocketSchema": schema(node), "enums": {}, "booleanDefaults": {},
                              "structuralDefaults": {"mute": bool(getattr(node, "mute", False))}}
                    for prop in node.bl_rna.properties:
                        if prop.identifier not in base_properties and prop.type == "BOOLEAN" and not prop.is_readonly:
                            record["booleanDefaults"][prop.identifier] = bool(getattr(node, prop.identifier))
                    explore_enum_states(tree, identifier, record)
                    if identifier == "CompositorNodeRLayers":
                        record["renderPassSocketVariants"] = {}
                        layer = bpy.context.view_layer
                        for prop in layer.bl_rna.properties:
                            if prop.identifier.startswith("use_pass_") and prop.type == "BOOLEAN" and not prop.is_readonly:
                                previous = getattr(layer, prop.identifier)
                                try:
                                    setattr(layer, prop.identifier, True)
                                    node.scene = bpy.context.scene
                                    record["renderPassSocketVariants"][prop.identifier] = schema(node)
                                finally:
                                    setattr(layer, prop.identifier, previous)
                    nodes[identifier] = record
                    tree.nodes.remove(node)
        finally:
            bpy.data.node_groups.remove(group)
            if material:
                bpy.data.materials.remove(material)
            elif hasattr(bpy.context.scene, "compositing_node_group"):
                bpy.context.scene.compositing_node_group = None
                bpy.data.node_groups.remove(root_tree)
        domains[domain] = {"nodes": sorted(nodes.values(), key=lambda n: n["id"]), "unavailable": unavailable}
    catalog = {"schemaVersion": 1, "blenderVersion": bpy.app.version_string,
            "blenderVersionTuple": list(bpy.app.version), "blenderBuildHash": bpy.app.build_hash.decode(),
            "method": "Every registered bpy.types.Node subclass is attempted in factory shader/compositor trees, without class-prefix filtering. Actual creation is authoritative; bounded breadth-first exploration of reachable enum and writable node/color-ramp/mapping boolean states discovers contextual menus by native assignment. Numeric, authored-interface and ID-binding combinations are outside this audit; incomplete/budget-exhausted state exploration is explicit and fails --check.",
            "domains": domains, "socketSchemas": schemas}
    if selected is not None:
        catalog.update({"selection": {"completeInventory": False, "nodeIds": selected},
                        "productionCases": 0, "needsOracle": True,
                        "method": "Focused node IDs use the shared root/group shader/compositor creation and enum-state explorer. This partial catalog records schema/availability only and grants no numerical qualification."})
    return catalog


def python_constant(path, name):
    tree = ast.parse((ROOT / path).read_text(encoding="utf8"))
    for statement in tree.body:
        if isinstance(statement, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in statement.targets):
            return ast.literal_eval(statement.value)
    raise ValueError(f"Missing audited constant {path}:{name}")


def mode_status(rule, value):
    if not rule:
        return "unreviewed"
    if "sourceSet" in rule:
        path, name = rule["sourceSet"].split(":", 1)
        return "supported" if value in python_constant(path, name) else "unsupported"
    for category in ("supported", "partial", "structural", "bake-only", "unsupported"):
        if value in rule.get(category, []):
            return category
    return "unsupported"


def verify_map(capabilities):
    failures = []
    for key, entry in capabilities["entries"].items():
        if entry["category"] not in CATEGORIES:
            failures.append(key + ": invalid category")
        for evidence in entry.get("evidence", []):
            path = ROOT / evidence["path"]
            if not path.is_file():
                failures.append(key + ": missing evidence " + evidence["path"])
            elif evidence.get("anchor") and evidence["anchor"] not in path.read_text(encoding="utf8"):
                failures.append(key + ": stale evidence anchor " + evidence["anchor"])
        runtime = entry.get("runtimeOps", [])
        runtime_path = ROOT / entry.get("runtimePath", "packages/blendlink/src/tslNodeRecipe.ts")
        text = runtime_path.read_text(encoding="utf8") if runtime_path.is_file() else ""
        for op in runtime:
            if not re.search(r"case\s+['\"]" + re.escape(op) + r"['\"]\s*:", text):
                failures.append(key + ": missing runtime dispatch for " + op)
        if entry["category"] in {"supported", "partial"} and (not runtime or len(entry.get("evidence", [])) < 2):
            failures.append(key + ": live classification needs explicit compiler and runtime evidence")
    return failures


def native_baseline(catalog):
    return {domain: {node["id"]: {
        "enums": {key: {value: observed["socketSchema"] for value, observed in mode["available"].items()}
                  for key, mode in node["enums"].items()},
        "defaultSocketSchema": node["defaultSocketSchema"],
        "contextSocketSchemas": node.get("contextSocketSchemas", {}),
        "renderPassSocketVariants": node.get("renderPassSocketVariants", {}),
        "booleanDefaults": node.get("booleanDefaults", {}),
        "structuralDefaults": node.get("structuralDefaults", {}),
        "enumStateDigest": node.get("enumStateExploration", {}).get("stateDigest"),
    } for node in data["nodes"]} for domain, data in catalog["domains"].items()}


def enumeration_review(node, domain, version, capabilities):
    key = domain + ":" + node["id"]
    limitation = capabilities.get("nativeEnumerationLimitations", {}).get(key)
    entry = capabilities["entries"].get(key, {"category": "unsupported"})
    entry = {**entry, **entry.get("versionOverrides", {}).get(version, {})}
    return limitation, bool(limitation) and entry["category"] == "unsupported"


def baseline_changes(current, previous):
    changes = []
    def enums(record):
        return record.get("enums", record)
    for domain, nodes in current.items():
        prior = previous.get(domain, {})
        for identifier, record in nodes.items():
            if identifier not in prior:
                changes.append(f"{domain}:{identifier}: new native node")
            previous_record = prior.get(identifier, {})
            if previous_record.get("defaultSocketSchema") and record.get("defaultSocketSchema") != previous_record["defaultSocketSchema"]:
                changes.append(f"{domain}:{identifier}: native default socket schema changed")
            for field in ("contextSocketSchemas", "renderPassSocketVariants", "booleanDefaults", "structuralDefaults", "enumStateDigest"):
                if field in previous_record and record.get(field) != previous_record[field]:
                    changes.append(f"{domain}:{identifier}: native {field} changed")
            for prop, values in enums(record).items():
                prior_values = enums(previous_record).get(prop, {})
                for value in sorted(set(values) - set(prior_values)):
                    changes.append(f"{domain}:{identifier}:{prop}={value}: new native enum value")
                if isinstance(values, dict) and isinstance(prior_values, dict):
                    for value in set(values).intersection(prior_values):
                        if values[value] != prior_values[value]:
                            changes.append(f"{domain}:{identifier}:{prop}={value}: native mode socket schema changed")
    return changes


def classify(catalog, capabilities):
    result = {"blenderVersion": catalog["blenderVersion"], "domains": {}}
    for domain, data in catalog["domains"].items():
        nodes, counts = [], Counter({key: 0 for key in CATEGORIES})
        for node in data["nodes"]:
            key = domain + ":" + node["id"]
            declared = capabilities["entries"].get(key)
            entry = declared or {"category": "unsupported", "limits": "No audited compiler/extractor + runtime route; an Appearance capture is not a live node port."}
            version = ".".join(map(str, catalog.get("blenderVersionTuple", [])))
            entry = {**entry, **entry.get("versionOverrides", {}).get(version, {})}
            category = entry["category"]
            enum_coverage = {prop: {value: (category if category in {"unsupported", "bake-only", "structural"} else mode_status(entry.get("modes", {}).get(prop), value))
                                    for value in values["available"]}
                             for prop, values in node["enums"].items()}
            if category == "supported" and any(value not in {"supported", "structural"}
                                                  for values in enum_coverage.values() for value in values.values()):
                category = "partial"
            counts[category] += 1
            nodes.append({"id": node["id"], "label": node["label"], "category": category,
                          "declaredCategory": entry["category"], "unreviewedCapability": declared is None and key not in capabilities.get("knownUnsupported", []),
                          "limits": entry["limits"], "enumCoverage": enum_coverage,
                          "runtimeOps": entry.get("runtimeOps", []), "evidence": entry.get("evidence", [])})
        enum_counts = Counter(status for node in nodes for values in node["enumCoverage"].values()
                              for status in values.values())
        result["domains"][domain] = {"counts": dict(counts), "total": len(nodes),
                                      "enumValueCounts": dict(enum_counts), "nodes": nodes}
    return result


def render_markdown(reports, capabilities, unreviewed):
    lines = ["# Native Blender node coverage", "",
        "Generated by `scripts/audit-node-coverage.py`; the native catalogs record actual node creation, context-valid enum values and deduplicated socket schemas.", "",
        "**Supported** means an explicit compiler/extractor and runtime implementation within the stated limits; it is not whole-scene pixel parity. **Partial** has missing modes, outputs or parameter domains. **Bake-only** is a deliberate static native evaluation route and is never counted as live translation. **Structural** is graph traversal/editor structure. **Unsupported** has no audited live route.", "",
        "Every registered Node subclass is attempted, without ShaderNode/CompositorNode prefix filtering. This includes shared FunctionNode/GeometryNode utilities and internal/editor/closure/bundle types where actual context creation succeeds; it is not an Add-menu or asset-group count. Python class poll can incorrectly exclude usable shared nodes.", "",
        "Live material programs require `WebGPURenderer` (WebGPU or its WebGL2 backend), not legacy `WebGLRenderer`. Compositor programs use the same node renderer; whole reachable graphs build or refuse. Animated/driven node parameters, graph cycles, unmodeled socket conversions, unsupported render passes and renderer-specific lighting impose additional limits. Node/menu coverage is not a guarantee that every arbitrary graph combination is representable.", "",
        "Counts are node **types**, not node instances or percentages of all shader looks. Shader and compositor contexts are separate; shared types are inventoried in each context where they can actually be created. RNA values rejected by assignment (for example geometry-only Mix Rotation in a shader tree) are excluded from available mode counts.", "",
        "| Blender | Context | Types | Supported | Partial | Bake-only | Unsupported | Structural |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for report in reports:
        for domain, data in report["domains"].items():
            c = data["counts"]
            lines.append("| " + " | ".join([report["blenderVersion"], domain, str(data["total"]), *(str(c[k]) for k in CATEGORIES)]) + " |")
    lines += ["", "The former prefix-only inventory missed 36 shader-context and 69 compositor-context types in Blender 5.3, including shared FunctionNode and GeometryNode classes and graph-composition types. The corrected all-subclasses catalogs are authoritative; newly discovered types remain unsupported until an explicit measured implementation is reviewed.", "",
              "Enum-value counts are unions of observed native values, not counts of valid combinations. Bounded breadth-first exploration changes enum selections, active MENU sockets and semantic node/color-ramp/mapping booleans, discovers contextual menus through native assignment, and records state counts/digests with representative socket schemas. Compare's Color-only Brighter/Darker modes are therefore visible. All live routes must finish this scoped exploration. Editor flags and structural mute are excluded from menu products; defaults remain recorded. Numeric/socket-boolean values, ID bindings, authored interfaces and point handles are outside this audit. `partial` also covers parameter/output restrictions that are not enums."]
    if capabilities.get("nativeEnumerationLimitations"):
        lines += ["", "### Explicit incomplete native enumeration", "",
                  "The following unsupported types have reviewed bounds on large selector products. Their observed enum unions are lower bounds; no exhaustive-combination or live-support claim is made. `coverage.json` lists each affected native version, explored state/transition counts and acknowledgement. Unacknowledged truncation fails `--check`; promotion to a live route also fails until its scoped state exploration completes.", ""]
        lines += ["- `" + key + "`: " + reason for key, reason in sorted(capabilities["nativeEnumerationLimitations"].items())]
    versions = [report["blenderVersion"] for report in reports]
    lines += ["", "## Audited live/structural routes and deliberate bake routes", "",
              "All remaining native type IDs and every observed enum value are listed in `coverage.json`; native socket schemas are in `blender-*.json`. Explicit compiler/runtime evidence and version limits are in `../node-capabilities.json`.", "",
              "| Context / node | " + " | ".join(versions) + " | Limits |",
              "| --- | " + " | ".join("---" for _ in versions) + " | --- |"]
    merged = {}
    for report in reports:
        for domain, data in report["domains"].items():
            for node in data["nodes"]:
                row = merged.setdefault((domain, node["id"]), {})
                row[report["blenderVersion"]] = node
    for (domain, identifier), row in sorted(merged.items()):
        if all(node["category"] == "unsupported" for node in row.values()):
            continue
        limits = list(dict.fromkeys(node["limits"] for node in row.values()))
        lines.append(f"| {domain} / `{identifier}` | " + " | ".join(
            row[version]["category"] if version in row else "not available" for version in versions
        ) + " | " + " / ".join(limits).replace("|", "/") + " |")
    lines += ["", "## Remaining work by batch", ""]
    for batch in capabilities["prioritizedBatches"]:
        lines.append(f"- **{batch['name']}**: {batch['scope']}")
    lines += ["", "These batches are a coverage roadmap, not evidence that the listed nodes have been ported. Preserve explicit refusals or declared bake paths until native/compiler/runtime and numeric differential evidence agree.", "",
              "## Regenerate and check", "", "```sh",
              "python3 scripts/audit-node-coverage.py --blender /path/to/blender-4.2 --blender /path/to/blender-5.3 --check",
              "python3 scripts/audit-node-coverage.py --self-test", "```", "",
              "`--update-baseline` acknowledges observed native availability and schemas only; it never promotes support. New node types or enum values, changed socket schemas/boolean defaults/state digests fail `--check` until reviewed. New types need an explicit capability entry or an acknowledged `knownUnsupported` entry; live routes need explicit enum rules and completed scoped menu-state exploration. Source hashes and evidence anchors expose stale capability claims. State and transition budgets are configurable; reviewed limits on unsupported families remain explicit in the capability map and output.", ""]
    if unreviewed:
        lines += ["### Native availability changes needing review", ""] + ["- " + item for item in unreviewed] + [""]
    return "\n".join(lines)


def self_test():
    import copy
    def record(name, kind, cls, default=None):
        return {"identifier": name, "type": kind, "socketClass": cls, "enabled": True,
                "unavailable": False, "default": default}
    inputs = [record("Image", "RGBA", "NodeSocketColor"),
              record("Minimum", "VALUE", "NodeSocketFloatFactor"), record("Maximum", "VALUE", "NodeSocketFloatFactor")]
    inputs += [record(name, "MENU", "NodeSocketMenu", choices[0]) for name, choices in CHANNEL_MATTE_MENUS.items()]
    outputs = [record("Image", "RGBA", "NodeSocketColor"), record("Matte", "VALUE", "NodeSocketFloat")]
    menus = {"inputs:" + name: list(values) for name, values in CHANNEL_MATTE_MENUS.items()}
    def scope(given=inputs, result=outputs, choices=menus, version=(5, 3, 0), identifier="CompositorNodeChannelMatte", bools=()):
        return channel_matte_semantic_scope(identifier, version, given, result, choices, bools)
    for version in [(5, 2, 0), (5, 3, 0)]:
        for space in ["RGB", "HSV", "YUV", "YCbCr"]:
            for method in ["Max", "Single"]:
                given = copy.deepcopy(inputs)
                for item in given:
                    if item["identifier"] == "Color Space": item["default"] = space
                    if item["identifier"] == "Limit Method": item["default"] = method
                projected = scope(given, version=version)
                expected = {"inputs:Color Space", "inputs:Limit Method", "inputs:" + space + " Key Channel"}
                if method == "Single": expected.add("inputs:" + space + " Limit Channel")
                assert set(projected["activeSelectors"]) == expected
                assert set(projected["skippedSelectors"]) == set(menus) - expected
                assert projected["model"] == CHANNEL_MATTE_SEMANTIC_MODEL
    for kwargs in [{"version": (4, 2, 0)}, {"version": (5, 4, 0)}, {"version": (5, 2, 1)},
                   {"version": (5, 3, 1)}, {"identifier": "FutureNode"},
                   {"bools": ("new_semantic_switch",)}, {"given": inputs[:-1]}, {"result": outputs[:-1]}]:
        assert scope(**kwargs) is None, kwargs
    for field, value in [("type", "INT"), ("socketClass", "FutureMenu"), ("enabled", False),
                         ("unavailable", True), ("default", "Unknown Space")]:
        given = copy.deepcopy(inputs)
        next(item for item in given if item["identifier"] == "Color Space")[field] = value
        assert scope(given) is None, (field, value)
    given = copy.deepcopy(inputs)
    next(item for item in given if item["identifier"] == "Limit Method")["default"] = "Average"
    assert scope(given) is None
    for name in CHANNEL_MATTE_MENUS:
        choices = copy.deepcopy(menus); choices["inputs:" + name].append("NEW_MODE")
        assert scope(choices=choices) is None, name
    assert scope(choices={key: value for key, value in menus.items() if key != "inputs:RGB Key Channel"}) is None
    baseline = {"shader": {"ShaderNodeMath": {"operation": ["ADD"]}}}
    changed = {"shader": {"ShaderNodeMath": {"operation": ["ADD", "NEW_MODE"]}, "ShaderNodeFuture": {}}}
    failures = baseline_changes(changed, baseline)
    assert any("ShaderNodeFuture" in item for item in failures)
    assert any("NEW_MODE" in item for item in failures)
    assert mode_status({"supported": ["ADD"]}, "NEW_MODE") == "unsupported"
    schema_change = baseline_changes({"shader": {"Node": {"enums": {}, "defaultSocketSchema": "changed"}}}, {"shader": {"Node": {"enums": {}, "defaultSocketSchema": "original"}}})
    assert any("socket schema changed" in item for item in schema_change)
    context_change = baseline_changes({"shader": {"Node": {"enums": {}, "contextSocketSchemas": {"root": "changed"}}}}, {"shader": {"Node": {"enums": {}, "contextSocketSchemas": {"root": "original"}}}})
    assert any("contextSocketSchemas changed" in item for item in context_change)
    state_change = baseline_changes({"shader": {"Node": {"enums": {}, "enumStateDigest": "changed"}}},
                                    {"shader": {"Node": {"enums": {}, "enumStateDigest": "original"}}})
    assert any("enumStateDigest changed" in item for item in state_change)
    node = {"id": "Unported"}
    limited = {"entries": {}, "nativeEnumerationLimitations": {"compositor:Unported": "Explicit incomplete Cartesian scope"}}
    assert enumeration_review(node, "compositor", "5.3.0", limited)[1]
    limited["entries"]["compositor:Unported"] = {"category": "partial"}
    assert not enumeration_review(node, "compositor", "5.3.0", limited)[1], "Live routes cannot acknowledge incomplete menu exploration"
    assert not enumeration_review(node, "compositor", "5.3.0", {"entries": {}})[1]
    fake = {"blenderVersion": "test", "domains": {"shader": {"nodes": [
        {"id": "ShaderNodeFuture", "label": "Future", "enums": {}},
    ]}}}
    result = classify(fake, {"entries": {}})["domains"]["shader"]
    assert result["counts"]["unsupported"] == 1 and result["nodes"][0]["unreviewedCapability"]
    fake["domains"]["shader"]["nodes"] = [{
        "id": "ShaderNodeMath", "label": "Math",
        "enums": {"operation": {"available": {"ADD": {}, "NEW_MODE": {}}}},
    }]
    result = classify(fake, {"entries": {"shader:ShaderNodeMath": {
        "category": "supported", "limits": "Synthetic policy test",
        "modes": {"operation": {"supported": ["ADD"]}},
    }}})["domains"]["shader"]
    assert result["counts"]["partial"] == 1
    assert result["nodes"][0]["enumCoverage"]["operation"]["NEW_MODE"] == "unsupported"
    print("BLENDLINK_NODE_COVERAGE_POLICY_PASSED new nodes/enums remain unsupported and visible; schema drift is detected")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--python" in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog-output", type=Path)
    parser.add_argument("--node", action="append", help="Focus native schema capture on a node ID; repeatable, only with --catalog-output")
    parser.add_argument("--blender", action="append", default=[])
    parser.add_argument("--output", type=Path, default=ROOT / "docs/node-coverage")
    parser.add_argument("--capabilities", type=Path, default=ROOT / "docs/node-capabilities.json")
    parser.add_argument("--update-baseline", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--enum-state-budget", type=int, default=2048)
    parser.add_argument("--enum-transition-budget", type=int, default=100000)
    args = parser.parse_args(argv)
    if args.node is not None:
        if not args.catalog_output or args.check or args.update_baseline or args.self_test or args.blender:
            parser.error("--node is only available with --catalog-output for partial schema discovery, not coverage checks or baseline updates")
        try:
            node_selection(args.node)
        except ValueError as error:
            parser.error(str(error))
    if args.catalog_output:
        catalog = native_catalog(enum_state_budget=args.enum_state_budget, enum_transition_budget=args.enum_transition_budget,
                                 enumeration_budgets=json.loads(args.capabilities.read_text()).get("nativeEnumerationBudgets", {}),
                                 node_ids=args.node)
        write_json(args.catalog_output, catalog)
        print(("BLENDLINK_NATIVE_NODE_SCHEMA_CAPTURED " if args.node is not None else "BLENDLINK_NATIVE_NODE_CATALOG_PASSED ")
              + catalog["blenderVersion"])
        return
    if args.self_test:
        self_test()
        return
    if not args.blender:
        parser.error("Pass one or more --blender executables")
    capabilities = json.loads(args.capabilities.read_text(encoding="utf8"))
    failures = verify_map(capabilities)
    catalogs = []
    unresolved_enumerations = []
    with tempfile.TemporaryDirectory(prefix="blendlink-native-node-inventory-") as temporary:
        for index, executable in enumerate(args.blender):
            out = Path(temporary) / f"{index}.json"
            env = {**os.environ, "BLENDER_USER_RESOURCES": str(Path(temporary) / f"profile-{index}")}
            result = subprocess.run([executable, "--background", "--factory-startup", "--python-exit-code", "1",
                                     "--python", str(Path(__file__).resolve()), "--", "--catalog-output", str(out),
                                     "--enum-state-budget", str(args.enum_state_budget), "--enum-transition-budget", str(args.enum_transition_budget),
                                     "--capabilities", str(args.capabilities.resolve())],
                                    env=env, capture_output=True, text=True, timeout=180)
            if result.returncode or not out.is_file():
                raise RuntimeError(f"Native catalog failed for {executable}:\n{result.stdout[-5000:]}\n{result.stderr[-5000:]}")
            catalogs.append(json.loads(out.read_text(encoding="utf8")))
    args.output.mkdir(parents=True, exist_ok=True)
    baseline_path = args.output / "native-baselines.json"
    baseline = json.loads(baseline_path.read_text(encoding="utf8")) if baseline_path.is_file() else {}
    changes = []
    for catalog in catalogs:
        for domain, data in catalog["domains"].items():
            for node in data["nodes"]:
                if node.get("enumStateExploration", {}).get("status") == "incomplete":
                    key = domain + ":" + node["id"]
                    limitation, acknowledged = enumeration_review(node, domain, ".".join(map(str, catalog["blenderVersionTuple"])), capabilities)
                    if not acknowledged:
                        failures.append(f"{catalog['blenderVersion']} {key}: enum state exploration incomplete (unacknowledged, or a live route)")
                    else:
                        node["enumStateExploration"]["reviewedIncompleteScope"] = limitation
                    unresolved_enumerations.append({"blenderVersion": catalog["blenderVersion"], "node": key,
                        "acknowledged": acknowledged, "reason": limitation,
                        "stateCount": node["enumStateExploration"]["stateCount"],
                        "transitions": node["enumStateExploration"]["transitions"]})
                for prop, mode in node["enums"].items():
                    if mode.get("optionsUnavailable"):
                        failures.append(f"{catalog['blenderVersion']} {domain}:{node['id']}:{prop}: native menu options could not be enumerated")
        version = ".".join(map(str, catalog["blenderVersionTuple"]))
        current = native_baseline(catalog)
        changes += [version + ": " + item for item in baseline_changes(current, baseline.get(version, {}))]
        if args.update_baseline:
            baseline[version] = current
        write_json(args.output / f"blender-{version}.json", catalog)
    if args.update_baseline:
        write_json(baseline_path, baseline)
        changes = []
    reports = [classify(catalog, capabilities) for catalog in catalogs]
    for report in reports:
        for domain, data in report["domains"].items():
            for node in data["nodes"]:
                prefix = f"{report['blenderVersion']} {domain}:{node['id']}"
                if node["unreviewedCapability"]:
                    failures.append(prefix + ": native node needs explicit capability review")
                for prop, values in node["enumCoverage"].items():
                    if any(status == "unreviewed" for status in values.values()):
                        failures.append(prefix + ": native enum needs explicit review: " + prop)
    source_paths = set(SOURCE_FILES)
    for entry in capabilities["entries"].values():
        for evidence in entry.get("evidence", []):
            path = evidence["path"]
            if path.startswith("packages/") and "/tests/" not in path and ".test." not in path \
                    and path.endswith((".py", ".ts", ".json")):
                source_paths.add(path)
    source_hashes = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in sorted(source_paths)}
    output = {"schemaVersion": 1, "generatedAt": datetime.now(timezone.utc).isoformat(),
              "capabilityMapSha256": hashlib.sha256(args.capabilities.read_bytes()).hexdigest(),
              "sourceSha256": source_hashes, "reports": reports,
              "nativeEnumerationUnresolved": unresolved_enumerations,
              "nativeAvailabilityChanges": changes, "capabilityValidationFailures": failures}
    write_json(args.output / "coverage.json", output)
    (args.output / "README.md").write_text(render_markdown(reports, capabilities, changes), encoding="utf8")
    for report in reports:
        print(report["blenderVersion"], {key: value["counts"] for key, value in report["domains"].items()})
    if failures or (args.check and changes):
        raise SystemExit("\n".join(failures + changes))
    print("BLENDLINK_NODE_COVERAGE_READY " + str(args.output / "README.md"))


if __name__ == "__main__":
    main()
