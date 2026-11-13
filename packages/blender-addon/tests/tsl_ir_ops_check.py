# SPDX-License-Identifier: GPL-3.0-or-later
"""Conformance check for the TSL IR op vocabulary (emitter side).

The emitter (packages/blender-addon/tsl_ir.py) and the builder
(packages/blendlink/src/tslNodeRecipe.ts) are ~4,700 lines of
hand-mirrored implementation on either side of a language gap, sharing 43
op names. conformance/tsl-ir-ops.json is the artifact that binds them:
this module asserts the emitter's half, and tslIrOps.conformance.test.ts
asserts the builder's half against the same file.

Without it, an op emitted but never built survives until a Blender e2e
happens to exercise that exact node — the failure mode
conformance/vocabulary.json already exists to prevent for the node
vocabulary, after those parsers drifted three ways.

Vocabulary only: per-op native numeric fidelity has separate gates, with
EEVEE the reference for new live shading ports.
"""
import ast
import json
import re
from pathlib import Path


REPO = Path(__file__).resolve().parents[3]
EMITTER = REPO / "packages" / "blender-addon" / "tsl_ir.py"
FIXTURE = (
    REPO / "packages" / "blendlink" / "conformance" / "tsl-ir-ops.json"
)


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


expect(EMITTER.is_file(), f"emitter not found at {EMITTER}")
expect(FIXTURE.is_file(), f"conformance fixture not found at {FIXTURE}")

declared = json.loads(FIXTURE.read_text(encoding="utf-8"))["ops"]
expect(declared == sorted(declared), "the fixture's ops must stay sorted")
expect(
    len(set(declared)) == len(declared),
    "the fixture lists a duplicate op",
)

def literal_ops(tree):
    """Read executable dictionary literals, independent of quote style."""
    return {
        value.value
        for node in ast.walk(tree) if isinstance(node, ast.Dict)
        for key, value in zip(node.keys, node.values)
        if isinstance(key, ast.Constant) and key.value == "op"
        and isinstance(value, ast.Constant) and isinstance(value.value, str)
        and re.fullmatch(r"[a-z0-9_]+", value.value)
    }


# Comments and docstrings cannot manufacture producer support. In particular,
# the native Magic delegate uses single quotes while the older emitter uses
# double quotes; both are the same executable Python dictionary convention.
sample = ast.parse('''"docstring: {\\"op\\": \\"not_emitted\\"}"
# {"op": "also_not_emitted"}
first = {"op": "first"}
second = {'op': 'second'}
''')
expect(literal_ops(sample) == {"first", "second"}, "opcode discovery lost literal/comment semantics")

pending, visited, emitted = [EMITTER], set(), set()
while pending:
    path = pending.pop()
    if path in visited:
        continue
    visited.add(path)
    expect(path.is_file(), "Missing delegated IR emitter " + path.stem)
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    emitted.update(literal_ops(tree))
    # Follow actual imports, including package-relative delegates and their
    # delegated emitters, without executing Blender or importing helpers.
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module and re.fullmatch(r"[a-z0-9_]+_ir", node.module):
            pending.append(EMITTER.with_name(node.module + ".py"))
expect(
    len(emitted) > 30,
    f"only {len(emitted)} ops parsed out of the emitter; the op-literal "
    "convention changed and this check can no longer see the vocabulary",
)

missing = sorted(set(declared) - emitted)
extra = sorted(emitted - set(declared))
expect(
    not missing and not extra,
    "the TSL IR op vocabulary drifted from the shared conformance fixture. "
    f"Declared but never emitted: {missing or 'none'}. Emitted but not "
    f"declared: {extra or 'none'}. Update "
    "packages/blendlink/conformance/tsl-ir-ops.json together with BOTH "
    "sides, so the builder learns the op in the same change.",
)

print(
    "BLENDLINK_TSL_IR_OPS_CHECK_PASSED "
    f"ops={len(declared)}"
)
