# Compositor Blackbody: native CPU-MF literal slice

This is a next-port candidate, with zero qualification credit until its future fresh native → actual saved Final → both-profile/both-API browser closure. No native or GPU rendering has run for this batch.

The useful initial domain is every exact stored Float32 temperature800..12000 through literal, Value, reroute and bound group inputs. It has no artificial temperature grid. The actual Blender5.3 compositor evaluates single-value graphs with the CPU multi-function even in GPU-authored trees; its analytical IMB polynomial differs from the257texel EEVEE GPU-field LUT. Only the literal MF route is admitted.

Runtime and existing shader spectral nodes share a polynomial builder. The new route explicitly stages1/T before coefficient multiplication, retaining the native MF arithmetic order. Existing shader models retain their existing direct division. Both use the existing canonical coefficient registry; tests pin derived Float32 coefficient identity. Native default bundled OCIO/lin_rec709_scene is required: pinned source bypasses matrix arithmetic for this working space. Custom/unmeasured transforms refuse.

The numeric contract predates capture and conservatively includes both APIs’2.5ULP division allowance and either-adjacent-result primitive rounding: every RGB word must satisfy the cancellation-aware32u*S(T) source forward envelope AND the absolute2^-15 ceiling; alpha is exactly1. Near true zero crossings, fixed ULP counts would misrepresent cancellation, so ULP/word differences are reported separately. Native FULL compositor32bit EXR captures read node RGBA directly without an emission carrier. No output repair or tolerance widening is allowed.

The scaffold retains ordinary artist temperatures, all source interval boundaries with adjacent Float32 values, and actual typed group/reroute sources. The policy suite is no-render only. Full proof integration, actual saved Final/browser lifecycle and generated shader-cost checks are still required; this branch changes no capability classifications or original-demo acceptance.


Future proof closure must independently pin and validate:38actual native graphs per authored device (37Blackbody cases plus a separate non-half-representable HDR Float32 RGB/alpha calibration),16unchanged saved sources per device (15Blackbody plus calibration), actual built Final exports, real WebGPU and WebGL2 on Metal/SwiftShader, exact calibration/alpha and per-word dual bounds, no adapter fallback, current source/artifact/native launch inventories, fresh closing runtime emission, resize and install/dispose ownership/resource baseline. These are planned counts, not observed numerical results. Source profile/temperature/working-space/field refusal controls need actual browser coverage. The immutable family protocol, production runner/reader and stripped saved Final projection checks are registered together in preflight. Full expected totals are76native graphs,32saved Finals,432browser cases and110592Float32 words across both authoring devices/APIs/profiles. Every non-Final native script and actual Final source is checked by the shared strict archive census, expected35fresh Python prefixes. All counts remain unearned until the fresh matrix completes.

The native reference scaffold is `reference.py`; it uses `NativeCompositorReference` and never the exporter or ported kernel as its numerical oracle. It may run only in the coordinated render window through the guarded native launcher, with `SCENETOWEB_BLACKBODY_REFERENCES` and `SCENETOWEB_BLACKBODY_DEVICE=CPU|GPU`. No capture result or qualification receipt is committed in this candidate.

Run after the coordinated queue release and a built source freeze: `PATH=/tmp/mrj-tooling:$PATH node experiments/compositor-blackbody/matrix.mjs artifacts/verification-blackbody-NEW --built`. The matrix captures and exports every saved source once; do not repeat exports. It reuses one immutable runtime transaction through all browser children and performs an independent fresh closing emission. The closing reader is `verify.mjs DEST [RECEIPT]`; no capability update is automatic.

The fresh [integrated receipt](evidence.json) closes76native graphs (74production),
32actual saved Finals,432browser cases/110592Float32 words and35fresh Python
prefixes.3840word differences (max2350ULP near cancellation, maxabsolute
1.1920928955078125e-7) stay within both predeclared gates, with zero violations.
48actual resize/DPR frames and both Metal/SwiftShader APIs are included. The
predeclared contract alone grants zero credit; this complete receipt qualifies
only the stated partial compositor literal/working-space scope.
