# Native Ellipse zero-Size scheduling canary

Eight actual Cycles CPU + CPU-compositor FULL renders show that all four
operations with Size(0,.5) and Mask .25 produce a single value. Passing that
result to native Image Info Dimensions yields RGBA(0,0,0,1). The same operations
with Size(.5,.5) yield(13,9,0,1), the full image domain. Image Info explicitly
returns default outputs for single-value input; it does not expose a1×1 identity
domain. The initial1×1 expectation failed and remains a zero-credit observation.

[scheduling-review.json](scheduling-review.json) pins both raw logs, the actual
eight-row report, primary Image Info/Ellipse sources, script bytes, and fresh
guarded Python prefixes/cleanup. These were direct-helper review captures; no
immutable native-binary/Node identity archive was captured or retrospectively
claimed. No additional native jobs were run to make this archival record.

The source/runtime Ellipse extractor must distinguish actual zero-Size identity
from a spatially uniform nonzero-Size field. Terminal RGBA equality alone cannot
prove this distinction. Existing Image Info admission still refuses the canary
producer; no Image Info, Ellipse, browser or downstream-composition coverage is
promoted by this record. The earlier87-case prototype receipt is unchanged.
