# Channel Matte selector audit

This is an inventory optimization, not a live-node support declaration. Normal
completeness checks, native availability discovery, default/context schemas and
support classifications remain unchanged.

Modern Channel Key (`CompositorNodeChannelMatte`) exposes ten enabled MENU
sockets. The pinned Blender 5.2.0 and measured 5.3.0 sources select only the key
channel for the current Color Space, and only that color space's limit channel
when Limit Method is Single. Max ignores every limit-channel selector. The
reviewed `channel-matte-active-selectors-v1` scope therefore has 48 states:

```text
4 color spaces × 3 active key channels × (1 Max + 3 Single limit channels)
```

`CHANNEL_MATTE_SOURCES` in `scripts/audit-node-coverage.py` pins the SHA256 and
revision of the native `get_channel_index()` / `compute_limit_channels()` rules:

- [Blender 5.2.0 native implementation](https://raw.githubusercontent.com/blender/blender/v5.2.0/source/blender/nodes/composite/nodes/node_composite_channel_key.cc)
- [Measured Blender 5.3.0 implementation](https://raw.githubusercontent.com/blender/blender/02f0899d78e3/source/blender/nodes/composite/nodes/node_composite_channel_key.cc)

The rule applies only to exact native versions 5.2.0 and 5.3.0, the known full
input/output identifier/type/class/availability schema, the complete expected
native menu options, valid current choices and absence of semantic booleans.
Unknown versions (including unreviewed patch versions), extra/missing menus or
sockets, changed socket classes/availability, new options or unknown states use
the generic explorer. No incomplete live route can be acknowledged by this rule.

The state key records the active selectors. State schemas omit **only defaults
of proven inactive MENU inputs**; socket identity, type, class, availability and
all observed native menu options remain present. Raw default/context schemas
keep every native default unchanged. Each projected state records its active
selector set; `semanticScope` records the model, source pins, skipped selectors,
applied-state count and generic-fallback count.

## Independent native proof

```sh
python3 scripts/audit-node-coverage.py --self-test
BLENDLINK_CHANNEL_MATTE_AUDIT_REFERENCES=/absolute/retained-directory \
BLENDLINK_CHANNEL_MATTE_FULL_CATALOG=/absolute/full-or-control-native-catalog.json \
/path/to/Blender --background --factory-startup --python-exit-code 1 \
  --python experiments/channel-matte-audit/check_native.py
```

The comparison environment variable is optional. The native check uses real
registered RNA nodes and captures the complete node catalog three times:
untouched defaults, deliberately changed inactive Channel Key defaults, and
untouched defaults again. It verifies 48 completed states / 540 transitions,
identical menu unions and state digests, unchanged raw defaults in ordinary
captures and distinctly recorded raw defaults in the perturbed capture. Every
projected state is checked for the exact set of omitted MENU defaults.

Blender 5.2.0 and 5.3.0 each passed all three captures with state digest
`2fff3b376c1747c01baa4e14b86b3957e2560370f0052313c08adce0188c3385`.
The default raw schema remained `54754cd562b7d8429a72`; deliberately changed
inactive initial values produced raw schema `14a3d9a49d4ec7204b0a`, with the
same semantic state digest. The 5.3 menu union equals the full Cartesian native
audit; the 5.2 union equals its prior generic control catalog.

The original complete Cartesian audit is retained separately:
52,488 states / 1,574,640 transitions, zero failures,
390.65 seconds, 1,379,270,656 bytes maximum RSS, and a 250,305,660-byte catalog.
Its state digest is
`9846c1ae2d1164f83ef17b9b3ee6ccc5578cdbaca090093a155168f9bbc5e72c`.
A direct complete 5.3 catalog with the semantic rule took 11.93 seconds and
269,647,872 bytes maximum RSS, producing a 4,939,662-byte catalog. The expensive
full output and its timing log
remain in the Channel Key worker's artifact directory; generated catalogs and
references are not committed.
