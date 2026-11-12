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


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(encoded(value).encode()).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf8")


def native_catalog():
    import bpy
    base_properties = set(bpy.types.Node.bl_rna.properties.keys())
    schemas = {}

    def clean(value):
        if value is None or isinstance(value, (bool, int, float, str)):
            return value
        try:
            return [float(item) for item in value]
        except (TypeError, ValueError):
            return {"rnaType": type(value).__name__, "name": getattr(value, "name", None)}

    def schema(node):
        result = {}
        for direction in ("inputs", "outputs"):
            result[direction] = [{
                "identifier": socket.identifier, "name": socket.name,
                "type": socket.type, "socketClass": socket.bl_idname,
                "enabled": bool(getattr(socket, "enabled", True)),
                "unavailable": bool(getattr(socket, "is_unavailable", False)),
                **({"default": clean(socket.default_value)} if hasattr(socket, "default_value") else {}),
            } for socket in getattr(node, direction)]
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
            if socket.type != "MENU" or not hasattr(socket, "default_value"):
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

    candidates = []
    for name in dir(bpy.types):
        if not name.startswith(("ShaderNode", "CompositorNode")) and name not in {
            "NodeFrame", "NodeReroute", "NodeGroupInput", "NodeGroupOutput",
        }:
            continue
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
                    cls = getattr(bpy.types, identifier)
                    try:
                        node = tree.nodes.new(identifier)
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
                              "defaultSocketSchema": schema(node), "enums": {}, "booleanDefaults": {}}
                    for prop in node.bl_rna.properties:
                        if prop.identifier not in base_properties and prop.type == "BOOLEAN" and not prop.is_readonly:
                            record["booleanDefaults"][prop.identifier] = bool(getattr(node, prop.identifier))
                    for path, values, source in modes(node):
                        observed = {"source": source, "available": {}, "rejectedRnaValues": {}}
                        for value in values:
                            probe = tree.nodes.new(identifier)
                            try:
                                target, key = owner(probe, path)
                                setattr(target, key, value)
                                observed["available"][value] = {"socketSchema": schema(probe)}
                            except (RuntimeError, TypeError, ValueError, KeyError) as error:
                                observed["rejectedRnaValues"][value] = str(error)
                            finally:
                                tree.nodes.remove(probe)
                        if not values:
                            observed["optionsUnavailable"] = True
                        record["enums"][path] = observed
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
    return {"schemaVersion": 1, "blenderVersion": bpy.app.version_string,
            "blenderVersionTuple": list(bpy.app.version), "blenderBuildHash": bpy.app.build_hash.decode(),
            "method": "Factory Blender actual node creation (Python poll/registration methods are not authoritative for generic shader nodes in modern compositor trees); enum values validated by assignment in the actual tree context; single-setting socket schema probes, not all cross-products",
            "domains": domains, "socketSchemas": schemas}


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
    } for node in data["nodes"]} for domain, data in catalog["domains"].items()}


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
            for field in ("contextSocketSchemas", "renderPassSocketVariants", "booleanDefaults"):
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
        "The inventory includes registered types creatable through Blender API, including internal/editor types; it is not an Add-menu or asset-group count. Actual creation is authoritative: Python class poll can incorrectly exclude shared ShaderNodes from modern compositor trees.", "",
        "Live material programs require `WebGPURenderer` (WebGPU or its WebGL2 backend), not legacy `WebGLRenderer`. Compositor programs use the same node renderer; whole reachable graphs build or refuse. Animated/driven node parameters, graph cycles, unmodeled socket conversions, unsupported render passes and renderer-specific lighting impose additional limits. Node/menu coverage is not a guarantee that every arbitrary graph combination is representable.", "",
        "Counts are node **types**, not node instances or percentages of all shader looks. Shader and compositor contexts are separate; shared ShaderNode types in modern compositor trees are inventoried separately. RNA values rejected by assignment (for example geometry-only Mix Rotation in a shader tree) are excluded from available mode counts.", "",
        "| Blender | Context | Types | Supported | Partial | Bake-only | Unsupported | Structural |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for report in reports:
        for domain, data in report["domains"].items():
            c = data["counts"]
            lines.append("| " + " | ".join([report["blenderVersion"], domain, str(data["total"]), *(str(c[k]) for k in CATEGORIES)]) + " |")
    lines += ["", "Enum-value counts, including modes of unsupported nodes, are retained separately in `coverage.json`. They are single-setting observations rather than counts of valid combinations. `partial` also covers parameter/output restrictions that are not enums."]
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
              "`--update-baseline` acknowledges observed native availability and schemas only; it never promotes support. New node types or enum values, changed socket schemas and changed boolean defaults fail `--check` until reviewed. New types also need an explicit capability entry or an acknowledged `knownUnsupported` entry; live routes need explicit enum rules. Source hashes and evidence anchors expose stale capability claims. Enumerated menu/property schemas are single-setting probes, not exhaustive setting cross-products.", ""]
    if unreviewed:
        lines += ["### Native availability changes needing review", ""] + ["- " + item for item in unreviewed] + [""]
    return "\n".join(lines)


def self_test():
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
    parser.add_argument("--blender", action="append", default=[])
    parser.add_argument("--output", type=Path, default=ROOT / "docs/node-coverage")
    parser.add_argument("--capabilities", type=Path, default=ROOT / "docs/node-capabilities.json")
    parser.add_argument("--update-baseline", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.catalog_output:
        catalog = native_catalog()
        write_json(args.catalog_output, catalog)
        print("BLENDLINK_NATIVE_NODE_CATALOG_PASSED " + catalog["blenderVersion"])
        return
    if args.self_test:
        self_test()
        return
    if not args.blender:
        parser.error("Pass one or more --blender executables")
    capabilities = json.loads(args.capabilities.read_text(encoding="utf8"))
    failures = verify_map(capabilities)
    catalogs = []
    with tempfile.TemporaryDirectory(prefix="blendlink-native-node-inventory-") as temporary:
        for index, executable in enumerate(args.blender):
            out = Path(temporary) / f"{index}.json"
            env = {**os.environ, "BLENDER_USER_RESOURCES": str(Path(temporary) / f"profile-{index}")}
            result = subprocess.run([executable, "--background", "--factory-startup", "--python-exit-code", "1",
                                     "--python", str(Path(__file__).resolve()), "--", "--catalog-output", str(out)],
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
    source_hashes = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in SOURCE_FILES}
    output = {"schemaVersion": 1, "generatedAt": datetime.now(timezone.utc).isoformat(),
              "capabilityMapSha256": hashlib.sha256(args.capabilities.read_bytes()).hexdigest(),
              "sourceSha256": source_hashes, "reports": reports,
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
