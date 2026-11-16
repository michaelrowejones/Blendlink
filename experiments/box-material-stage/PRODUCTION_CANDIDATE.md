# Private BOX color experiment — strict qualification failed

This public checkpoint contains experiments only. It does not modify the SDK,
addon, catalog or support metadata. The implementation is retained as a
hash-pinned private patch; see the reproduction section in README.md. The full
four-tuple proof failed, and the later poison-geometry resource repair is
uncaptured. Nothing below describes an admitted public feature.

The isolated candidate reuses the existing image table, atomic sidecar publication,
compiled-material audit and scoped material installer. `texture_box_ref` is a new
exact op/model requiring a fresh declaration on each actual primitive; historical
`texture_ref` behavior is unchanged.

Current source domain is deliberately narrow: Blender5.3.0 build02f0899d78e3,
macOS arm64 Metal EEVEE, SNORM10, native anisotropy2, Linear/Repeat, explicit
vector, blend0.09966777265071869, saved opaque noninterlaced1024-square RGB8 sRGB
PNG. Alpha output, other blends/storage/profiles, and all BOX tangent NormalMap
composition remain refused. No camera or normal-frame guard is weakened.

Native Python uses public background APIs to extract typed storage with zero
render calls. Its cache key binds source PNG SHA256, native build, storage/model
and policy. The publisher writes one hash-pinned deflate companion per distinct
image entry; existing staging declares and relocates it with the PNG and sidecar.
The runtime and Node audit independently verify source/decoded/mip hashes and the
complete fixed ten-level census. Inflated data and network reads are bounded.
The browser only decodes and uploads; it does not generate mips or request another
GPU context. Preparation happens before any caller material mutation.

The MIT runtime geometric implementation is independently written from an inset
simplex/edge construction, as recorded in the preceding CPU and color proof. No
GPL native BOX kernel or GPL research sampler is copied into it. Export-side
Blender Python is GPL; its immutable mip bytes are assets, not executable native
kernel source. The prior Apache paired generator remains research only.

Each prepared image retains5,592,404RGBA8 bytes for base plus mips (additional
mips1,398,100bytes). The production Python mip bundle is552,096deflate bytes;
550,045bytes was the earlier Node-zlib encoding of identical raw mip storage.
A transaction permits at most8 BOX image entries. Configured BOX and historical
flat sampler clones use distinct owned Sources and share immutable CPU pixels;
disposal clears scoped textures/certificates and closes default owned bitmaps.
Map/source revision, sampling, mip ownership and layout changes cause a named
refusal. Cross-attempt caching and steady-state GPU timing are not claimed.

A fresh Base Color containing the exact BOX model uses the existing owned
complete-RGB material class and requires direct ungrouped Principled, opaque
Alpha1, all five core source/built channels and zero source/runtime skips. This avoids an
implicit second COLOR0/RGBA multiply without changing historical programs or
Three prototypes. Unit fixtures exercise source/clone revision separation,
corrupt/missing/truncated assets, cancellation, cleanup, last-good preservation,
legacy refusal and strict primitive declarations. GPU qualification remains open.

Saved Final fixtures keep the original Plaster BSDF/color graph in owned copies,
explicitly disconnect only its unqualified Normal link, and use declared private
zero-shift observation cameras. They are not original-scene acceptance. The
native RGB oracle may use a separate owned emission observation; public installed
checks must also exercise actual material draws, repeated frames, COLOR0 poison,
Alpha completeness, resize, failure recovery and resource cleanup. Production
metadata/support credit must stay unchanged until those checks close.
