# Compositor White Noise feasibility

Research only: **zero port, saved Final, browser, or GPU credit**. The retained
receipt records twelve actual CPU compositor constant-unit renders on Blender
5.3.0 build `02f0899d78e3`. All 768 full-Float32 EXR words match the independently
computed Jenkins hashes: 1D–4D, Value/Color, plus raw +0, −0, smallest subnormal,
and minimum-normal 1D inputs. Source producers are linked Value/CombineXYZ nodes;
inputs are set/read in raw bulk storage, not converted through scalar getters.

`sources.json` pins the actual node MF, CPU hash implementation, and shader
wrapper. The CPU and GPU wrappers use the same raw-float-bit Jenkins hashes and
channel seed/permutation rules. Existing SceneToWeb TSL hash kernels can be
reused; no new native GPL body belongs in the MIT browser runtime. The node and
wrapper are GPL-2.0-or-later; `noise.cc` also carries BSD-3-Clause attribution.
This research reference is GPL-3.0-or-later and stays outside the SDK.

The important boundary is input materialization. Native fused Value→White Noise
preserves negative-zero/subnormal bits in this probe; silently canonicalizing
either before hashing changes the result. An initial compositor route should
admit raw stored **+0 or finite normal Float32 only**, with explicit literal,
Value, CombineXYZ, and typed group/reroute leaves. It must reject raw −0 and
subnormals before Python promotion, clocks/animation, computed/field producers,
and implicit Vector coordinates. Compositor defaults are 2D and Uniform Image
Coordinates, unlike the shader's 3D default: treating an unlinked Vector as zero
would be incorrect. CPU compositor proof is distinct from EEVEE/GPU proof.

The initial source probe is retained under
`artifacts/verification-compositor-white-noise-feasibility-r1` (ignored generated
files), with one archived guarded native Python invocation and twelve raw EXRs.
`evidence.json` retains report/archive digests and case words. This does not
qualify exported programs or the existing shader route.

Next qualification should compare all dimensions and outputs on native CPU,
actual saved Final artifacts, and both browser APIs/profiles, with exact bit
gates and refusal controls. Include fractional/non-half-exact seeds, signed
normal extrema, dimensional ignored-component controls, distinct group
instances, reroutes, and raw-word −0/subnormal refusal witnesses. No
transcendental approximation or field interpolation is needed for this scope.

Other shortlisted contexts were compositor Vector Rotate (existing shader
kernels, but CPU matrix/trig staging differs) and Blank Image (tiny fill kernel,
but native INT2 image-domain propagation needs a separate foundation). White
Noise offers a useful new compositor context with the least new arithmetic.
