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
# Reconstructing the integrated private candidate

The later integrated candidate `43840cc6` combines the experimental BOX source
with the qualified Shadow path, ObjectNormal camera guard and private bitmap
cleanup from public `a1684d3a`. It remains unqualified. The original 17-file
patch and R3 failure records stay unchanged.

`integrated-sdk-43840.patch`, the raw Git commit object and the reconstruction
manifest preserve this exact candidate without depending on an unpublished
branch. In a clone containing public `a1684d3a`, run:

```sh
node experiments/box-material-stage/reconstruct-integrated-sdk.mjs /ABS/NEW_WORKTREE
```

This creates a new detached worktree, checks the full source-tree and commit
hashes, and aligns only that new worktree. It installs nothing and opens no
scene or GPU. The source reconstruction was independently executed successfully
at `/tmp/scenetoweb-box-reconstructed-43840-check`, yielding source tree
`45a9e62cef2a6cb94fa5c41ac0478d22f0b4ad82` and exact commit `43840cc6`.

For a new capture, copy the current `experiments/box-material-stage` directory
into that isolated worktree, commit only those experiment files, install the
lockfile dependencies and build the SDK there. Run the integrated SDK byte
guard before using the documented hardware lease. A matching source checkout
alone does not establish matching emitted/dependency bytes or accepted fidelity.
The 2,064-file guard and fresh proof census remain mandatory. No production
admission, package publication or whole-scene acceptance follows from this helper.
