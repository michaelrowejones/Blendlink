# Blendlink npm artifact licenses

The `blendlink` npm tarball is an aggregate containing separately licensed
programs. Its `package.json` therefore uses `SEE LICENSE IN LICENSES.md`
instead of describing every file as MIT.

## MIT

The Node/TypeScript compiler, CLI, Three.js runtime adapters, generated
JavaScript and declarations, package documentation, and sample assets are
licensed under the MIT License, except for the third-party runtime copy listed
below. The complete text is in [`LICENSE`](LICENSE).

`blender/bakelib.py`, `dist/blender/bakelib.py`, and
`dist/addon/bakelib.py` also carry an `SPDX-License-Identifier: MIT` header.
Embedding that compatible helper in the Blender Extension does not remove its
file-level MIT permission.

## GPL-3.0-or-later

Blender-dependent Python files carry an
`SPDX-License-Identifier: GPL-3.0-or-later` header. This includes:

- `blender/environment_compress.py` and `blender/export_scene.py`;
- GPL-marked Python files under `dist/blender/`; and
- the Blender Extension aggregate under `dist/addon/`, except for the
  separately MIT-licensed `bakelib.py` described above.

The complete GNU General Public License version 3 text is in
[`dist/addon/LICENSE`](dist/addon/LICENSE). The extension manifest declares
`GPL-3.0-or-later`.

## Third-party notice

`dist/vendor/n8ao-webgpu/` contains the unchanged runtime from
`n8ao-webgpu@0.1.0`, licensed CC0-1.0. Its complete `LICENSE`, upstream
`NOTICE.md`, and original package metadata ship in that directory. The build
copies the lockfile-pinned package and redirects the WebGPU pipeline's lazy
import to that copy. It uses the website's Three instance. No separate Three
runtime or package-manager peer override is installed for it.

[`assets/basis-apache-2.0.txt`](assets/basis-apache-2.0.txt) contains the
complete Apache-2.0 license text distributed with the Basis Universal
transcoder artifacts that Blendlink may copy from a compatible Three.js
installation into a compiled scene graph.

File-level SPDX headers are authoritative where present.
