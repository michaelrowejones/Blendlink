# Normal field and film-stage boundaries

Source audit only, with no implementation, GPU work, fallback, support promotion
or change to the retained raw-field failure. The pinned revision and exact
source hashes are in `film-boundary-sources.json`. Native source remains under
GPL-2.0-or-later; no shader/kernel text is copied into the MIT SDK.

The pinned EEVEE `Film.store_combined` processes spatial/luminance weighting,
temporal/history blending and conversion back to scene RGB before its final
NaN check. If any RGBA component is NaN, it replaces the entire pixel with
opaque black. It subsequently clamps components that are not positive,
applies the half-storage handling and stores the combined film. `store_color_ex`
has the same whole-pixel NaN policy for color passes; `store_value` replaces
scalar NaN with zero. These are specific late-film policies, not a general
`isFinite` rule or an established infinity contract.

`Film::read_pass` reads the processed combined storage using GPU float readback.
Writing EXR32 does not recover a raw pre-film Normal Map vector or full-precision
pre-storage radiance. The native black carrier in the pure-B tests therefore
does not establish that ordinary normalization of zero returned zero. An encoded
zero normal would itself produce mid-gray before later processing.

Other stages also matter. `node_emission` applies a channel-wise nonnegative
operation before accumulation; its observed Metal NaN behavior was not isolated.
The deferred-combine path separately cleans radiance feedback and can substitute
magenta for invalid combined lighting. These policies must not be collapsed into
one global black fallback. The exact stage that made the observed native pure-B
carrier finite remains unresolved without an intermediate capture.

A future shared film/presentation implementation could benefit several ports,
but belongs after the matching scene-radiance/accumulation stage and before
compositor/display processing. It must not replace NormalMap vector mathematics
or silently make every nonfinite field a positive node proof. The existing
34 finite NormalMap diagnostic fields and six unqualified boundary fields keep
their separate classifications.

The smallest useful future controls include partial-NaN RGB with other finite
channels, NaN Alpha, negative/signed-zero and finite HDR. An AOV color path can
isolate film policy from the earlier Emission operation; a separate Emission
path distinguishes channel-wise processing from whole-pixel replacement.
All-RGB-NaN alone cannot distinguish those alternatives. No such native control
or production presentation change is claimed by this source audit.
