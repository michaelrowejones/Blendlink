# Public raw RNA array research

Research only; no support, native-evaluation, render or GPU credit.

Pinned Blender 5.3 `02f0899d78e3` exposes an uncoerced whole-array property through `owner.path_resolve(property_name, False)`. The resulting `bpy_prop_array` supports `foreach_get(array('f'))`. The C++ buffer branch calls `RNA_property_float_get_array` directly into the supplied Float32 buffer, avoiding Python-number promotion.

The owned probe tested `FunctionNodeInputRotation.rotation_euler`, `FunctionNodeInputVector.vector`, and Vector Rotate's Vector/Center socket `default_value`. All 12 pattern rows / 36 raw words round-tripped exactly, including negative zero, positive and negative minimum/maximum subnormals, minimum normal and ordinary signed normals. Source values remained unchanged after each getter check and were restored before deleting the owned tree. GPU-init/render/bake canaries refused; actual guarded calls were zero and source/context ownership was restored.

The Euler's normal coerced property has type `Euler`; its uncoerced property has type `bpy_prop_array`. Reading individual elements as Python numbers flushed the stored subnormals to signed zero. `path_resolve('rotation_euler[1]', False)` also promoted and flushed: the whole unindexed array path is required. Scalar `default_value` returned `bpy_prop` without `foreach_get`; this result supplies no scalar replacement.

Pinned `bpy_rna.cc` lines4116–4175 document `coerce` and return `pyrna_prop_CreatePyObject` when False. Lines6387–6545 distinguish direct Float32-buffer access from a Python-sequence fallback that calls `PyFloat_FromDouble`. The web documentation URL returned HTTP402; local pinned source is authoritative. No native body is copied into runtime.

`probe.py`, `capture-run.mjs`, report, native stdout and native identity/output hashes are retained. The capture runner contains the original absolute diagnostic paths and is archival, not a command for overwriting the packet. The native launcher journal was disposed rather than archived; these are research observations, not a qualification receipt. Initial setup failure `failed-r1/` is preserved (inactive Rotation socket lookup before any rows), followed by one corrected fresh-prefix successful invocation.

This identifies a public raw-input reader for a future bounded Rotation constructor. It does not prove Euler-to-quaternion semantics, arithmetic, native MF equivalence, browser transport or the safety of replacing current qualified helpers.
