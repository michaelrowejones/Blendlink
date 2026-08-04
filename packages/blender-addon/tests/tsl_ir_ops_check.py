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

Vocabulary only: per-op numeric fidelity belongs to
experiments/tsl-node-differential, measured against Cycles.
"""
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

# The emitter expresses its vocabulary as `"op": "<name>"` literals in the
# documents it builds. A regex that stops matching fails this check loudly
# rather than silently shrinking the compared set.
emitted = set(re.findall(r'"op":\s*"([a-z0-9_]+)"', EMITTER.read_text(encoding="utf-8")))
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
