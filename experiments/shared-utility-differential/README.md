# Shared integer and boolean node proof

The production material emitter and compositor extractor now retain native
boolean and signed 32-bit integer values. The shared TSL helper runs through
`WebGPURenderer` using both actual WebGPU and forced WebGL2.

Native availability is version/context-specific:

| Node | Blender 5.2 shader/compositor | Blender 5.3 shader | Blender 5.3 compositor |
| --- | --- | --- | --- |
| InputBool / InputInt | Available | Available | Available |
| BooleanMath / IntegerMath | Unavailable | Available | Available |
| Compare | Unavailable | Unavailable | Available |

None of these five classes is creatable in Blender 4.2 shader/compositor trees.
The native catalog validates creation; an RNA class existing is insufficient.

The shader fixture proves all 9 Boolean Math operations and all 18 Integer Math
operations with authored constants and live object-property operands, int32
overflow/low-bit observations, negative inputs, zero divisors and negative
powers.522 native Blender 5.3 graphs (Cycles CPU and EEVEE) and 20 Blender 5.2
input/carrier graphs passed both browser backends with maximum absolute error 0.

The compositor fixture proves 251 Blender 5.3 CPU graphs and 251 GPU graphs,
including spatial inputs and every numeric Compare mode. 9 InputBool/InputInt
graphs on each Blender 5.2 compositor device also pass. All 520 native graphs
passed both browser backends with maximum absolute error 0. Color equality
ignores alpha; negative integer/float inputs convert to boolean using `>0`.

Native CPU constant/spatial evaluation, Cycles shader evaluation and native GPU
evaluation are explicit models. LCM and Floored Modulo have observable overflow
differences between these models. Operations stay integer-typed until a native
socket conversion requires float transport. The fixture observes low integer
bits before the float render target can round large values.

Integer Round requires provably bounded inputs: `2*abs(A)+abs(B)` and
`2*abs(B)` must fit signed 32-bit integers. Native CPU signed overflow here is
undefined and can differ from native GPU. LCM requires provable inputs above
INT_MIN because native CPU `std::lcm` has an undefined absolute-value domain
there. Explicit Clamp inputs establish bounds for live fields; unproven
configurations receive a named refusal. Float-to-integer links cover finite
values in the native signed 32-bit domain. Unmodeled vector/color/identity
conversions refuse.

Compare live numeric transport covers Float and Integer six operations, Vector
all five modes times six operations, and Color Equal/NotEqual/Brighter/Darker.
String/Object/Font comparisons with authored unlinked inputs are folded to the
actual boolean result; this is static identity comparison, not live string or
data-block transport. Linked identity comparisons refuse. Animated/driven node
trees remain outside the current live graph contract.

Run native compositor reference generation with either actual device:

```sh
BLENDLINK_SHARED_UTILITY_REFERENCES=artifacts/utilities/compositor-cpu \
  "$BLENDER" --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/shared_utility_check.py
BLENDLINK_SHARED_UTILITY_DEVICE=GPU \
BLENDLINK_SHARED_UTILITY_REFERENCES=artifacts/utilities/compositor-gpu \
  "$BLENDER" --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/shared_utility_check.py
node experiments/native-compositor-differential/run.mjs \
  artifacts/utilities/compositor-cpu artifacts/utilities/compositor-gpu \
  --out artifacts/utilities/compositor-browser
```

Run native shader extraction, image references and actual browser readback:

```sh
BLENDLINK_BLENDER="$BLENDER" \
BLENDLINK_UTILITY_EVIDENCE=artifacts/utilities/shader \
  node experiments/shared-utility-differential/run.mjs
```

Use `--built` after a parent-coordinated package build; use `--reuse-reference`
to replay the retained native pixels. This proof never rebuilds shared dist.
The shared whole-program provenance guard independently derives current
TypeScript emission and refuses stale changed dependencies in built mode;
entry-file timestamps alone are insufficient. It snapshots immutable native
and runtime modules so parallel edits cannot change a running proof. Built
native modules must exactly match their canonical source. Actual node creation
in the native ShaderNodeTree supplies the capability report: Blender 4.2 runs
only two carrier calibrations and records the five unavailable utility classes.
Those calibrations are not utility support evidence. Node 24 is the development
baseline.
