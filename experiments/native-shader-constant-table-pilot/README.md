# Source-static shader constant observation table

Research only; no shader rewrite or production runtime change. This tests the
alternative of evaluating fixed source helpers once, preserving their exact
native bits as data, rather than adding precision emulation to every fragment.

The exporter binds an explicitly SHA-pinned independent native closure to its
report and both literal/uniform raw offset planes. It checks the six captured
words, seeds, native library, backend and calibration. The table retains raw
words and exact representable numeric values for `random_vec3_offset(3/4)`.
Source/backend profile changes refuse reuse. This is six fixed observations,
not a generic constant folder or a claim that all devices contract identically.

```
node --test experiments/native-shader-constant-table-pilot/export.test.mjs
node experiments/native-shader-constant-table-pilot/export.mjs CLOSED EXPECTED_SHA NEW_TABLE
```

Actual export: `/tmp/scenetoweb-native-shader-constants-r1.json`, from closed
native diagnostic SHA `69278565ef2726c77ecc98d7fb496496922cca91e067d19202b44b456fbfb0f0`.
Two CPU tests cover raw/authority/calibration/profile mutations. No GPU job is
needed to export or recheck this table. It is not yet consumed by a port.

The accompanying stage diagnostic isolated a native fused vs target constant
evaluation difference. WGSL's `fma` builtin may itself expand to multiply plus
add with two rounding steps; simply spelling `fma` does not establish a portable
single-rounding contract ([WGSL specification](https://www.w3.org/TR/2026/CRD-WGSL-20261021/#floating-point-evaluation)).
The existing bounded software-FMA helper matched these witnesses, but this does
not extend that helper's qualification to every shader operand. Source-static
tables offer a prospective zero-per-fragment arithmetic cost alternative where
inputs are proven fixed and native source/profile identity remains enforced.
