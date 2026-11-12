# Blendlink npm artifact licenses

The `blendlink` npm tarball is an aggregate containing separately licensed
programs. Its `package.json` therefore uses `SEE LICENSE IN LICENSES.md`
instead of describing every file as MIT.

## MIT

The Node/TypeScript compiler, CLI, Three.js runtime adapters, generated
JavaScript and declarations, package documentation, and sample assets are
licensed under the MIT License, except for the third-party portions listed
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

`dist/tslSpectralNodes.js`, `dist/tslBrickNodes.js`, `dist/tslColorConversion.js`,
`dist/tslSharedUtilities.js`, `dist/tslFractalNoise.js`, `dist/tslVaryingNoise.js`, `dist/staticNoise4d.js`,
`dist/tslGeometryContext.js`, `dist/tslNormalNodes.js`, `dist/tslNodeRecipe.js` and their source TypeScript include spectral color,
color conversion, image sampling, integer utility, fractal Noise/Wave, packed-normal, normal-map and Brick mathematics adapted from Apache-2.0 Cycles
code. The coefficient/CIE data in
`dist/addon/spectral_tables.json` and `dist/blender/spectral_tables.json` has the
same license. Complete attribution and modification notices are in
[`assets/blender-spectral-NOTICE.txt`](assets/blender-spectral-NOTICE.txt);
the complete license is in
[`assets/blender-spectral-apache-2.0.txt`](assets/blender-spectral-apache-2.0.txt).
The separate Blender extension also carries these texts as
`spectral-NOTICE.txt` and `spectral-LICENSE.txt` beside its GPL aggregate license.

The Perlin gradient, fade and interpolation primitives in `tslNodeRecipe.ts`,
`tslNativeNoisePrecision.ts` and `staticNoise4d.ts`, and their emitted JavaScript are separately adapted from Cycles/Open Shading
Language `noise.h` under BSD-3-Clause, copyright 2009-2010 Sony Pictures
Imageworks Inc., et al., and 2011-2022 Blender Foundation. Complete copyright,
redistribution conditions and disclaimer are retained in
[`assets/blender-noise-bsd-3-clause.txt`](assets/blender-noise-bsd-3-clause.txt).
The Blender Extension carries the same license as `noise-LICENSE.txt`;
standalone website exports include it in their third-party notices.

The first-party native UV tangent and tangent-normal runtimes
`dist/tslTangentNodes.js`, `dist/tslTangentNormalMap.js` and their source
TypeScript are also Apache-2.0, as marked by their file-level headers.
They use the same complete Apache license text linked above.

The first-party bounded Math Modulo implementation `dist/tslMathModuloNative.js`
and experimental field barrier `dist/tslNoiseFieldBarrier.js`, with their source
TypeScript, are Apache-2.0 as marked by their file-level headers,
using the complete Apache license text linked above.

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
