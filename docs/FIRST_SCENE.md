# Your first scene on a website

Blendlink is public source in pre-release development. Use a local package built from this
checkout, or an archive supplied by the maintainer. The package's `0.9.0`
version is not evidence that an installable public release exists.

This walkthrough starts with a saved Blender scene, previews it without a web
project, then attaches it to a small existing Three.js or React Three Fiber
site. No hosting account is needed.

## Install from an extension ZIP

The artist installation starts in Blender: **Preferences → Get Extensions →
Install from Disk**, choose the matching Blendlink extension ZIP, and enable it.
No global Node or npm installation is required for Preview Website or Export
Website Folder. On first use, Blendlink downloads Node 24.22.3 from nodejs.org,
checks its pinned SHA-256, and keeps it with a private npm cache in Blender's
extension data. Later uses reuse those tools. Blender remains responsive during
setup. Allow Online Access must be enabled for the first download; existing
cached tools can be used offline.

A public registry release is still pending. When testing an unpublished build,
follow the source installation below. `addon install` connects that local
compiler automatically. For a ZIP installed separately, set **Local Preview Package**
in Blendlink preferences to the built `packages/blendlink` folder. That connects
an installed extension to the matching local compiler even for scenes saved
outside this repository. The source guide requires Node only to build the
compiler; the artist buttons use their private runtime.

## Build and install the local tools

Use Node 22.15 or later on the Node 22 line, or Node 24. Blender 4.2+ is the
declared range; the [September audit](FIRST_USER_AUDIT_2026-09-07.md) ran on
Windows with Node 24.15 and Blender 5.2. KTX-Software is optional unless you
enable KTX2 compression.

From the Blendlink checkout:

```sh
npm ci
npm run build
node packages/blendlink/dist/cli.js discover
node packages/blendlink/dist/cli.js addon install
```

The last command installs and enables this compiler's matching Blender add-on.
Restart Blender if it was already open. When returning to an older installation,
run it again after building the new compiler. `doctor` checks the add-on version
and file fingerprint, not just whether an add-on named Blendlink exists.

Keep compiler rebuilds separate from running Preview sessions: rebuilding this
checkout replaces `dist`, which a source-based preview still uses.

## Prepare a small authored scene

1. Save a copy of your `.blend`. For a team website, keep it under that site's
   `assets/hero.blend` and pack or preserve its external images and linked files.
2. In Blender's 3D View sidebar, open Blendlink and choose **Set Up Blendlink
   Scene**. Follow **Website Readiness**. Save after changing settings.
3. Start with a few meshes, a camera aimed at them, and straightforward
   Principled materials. Designate the **Website Camera** if the scene should
   own framing. An existing site's camera remains an explicit integration choice.
   Use **Responsive Frames** when a phone needs a different composition; a
   desktop camera can crop objects in portrait even when export works correctly.
4. Hybrid is the default. Keep the Main atlas, then mark moving objects Realtime.
   **Bake Lighting** retains PBR material detail and bakes indirect illumination;
   direct lights and reflections still need runtime sources. **Bake Appearance**
   captures the complete baked look as unlit pixels. It is useful when flattening
   a stylized material is intentional. Fully Realtime avoids lighting bakes for
   scenes whose materials and lights already have portable representations.
5. Check **Blendlink Web Material** for unsupported shader branches. A `.blend`
   can render correctly in Blender while containing shader logic glTF cannot
   carry. Choose the named bake/material route before expecting the browser to
   match it. TSL programs require the WebGPU renderer family.
6. Run **Check Atlas Fit** before an expensive bake. An oversized Final atlas
   blocks with a remedy; Preview may scale it down and report the detail loss.

For an HDR environment, load a real Radiance `.hdr` or OpenEXR `.exr` file.
If you create one from a generated Blender image, save it, reload that saved
file, select the loaded image in **HDR Environment**, and then pack it. A
generated image can contain PNG bytes despite an HDR filename. Blendlink refuses
that mismatch instead of publishing an environment the browser cannot decode.

## Preview before connecting a site

Choose **Preview Website** in Blender, or run this from the checkout with the
absolute path to your saved scene:

```sh
node packages/blendlink/dist/cli.js preview --blend "/path/to/site/assets/hero.blend"
```

The first run installs a disposable local viewer, then opens its loading screen
while Blender compiles. The loading screen and **Details** show the current
stage, elapsed time, and Cycles backend/sample count once selected. The bar
tracks compiler stages, not estimated time remaining. Geometry and UV preparation
run on the CPU even when Cycles later bakes on the GPU. Large environments can
take several minutes on their first bake. Leave the command running.
Wait for **Ready**, which requires browser installation and a completed render.
Save in Blender to rebuild. Unsaved viewport edits do not appear in the browser.
Use **Inspect** to pause and orbit, **Reset view** to restore the Blender camera,
**Phone** to check portrait framing, and **Save image** to capture the rendered
canvas. **Compare** overlays a Blender reference so visual differences are easier
to spot. These preview controls do not change your saved Blender scene.
Use **Details** for warnings. Failed initial loads show the exact error on screen;
**View error details** opens the full error. If browser loading fails, **Retry
preview** reloads the compiled scene without another Blender save or bake.
A failed update retains an existing good scene. A first failed load has no good
scene yet, so playback and camera controls stay disabled until loading succeeds.
Compile errors require fixing the scene and saving. A runtime failure pauses the
broken renderer; saving again recreates it even when the compiled scene is unchanged.
Stop the command with Ctrl+C when finished.

For a repeatable stylized test scene, the checkout includes a small woodland
diorama generator. Substitute your Blender executable if it is not on PATH:

```sh
blender --background --factory-startup --python scripts/make-preview-diorama.py -- artifacts/verification-diorama/woodland.blend
node packages/blendlink/dist/cli.js preview --blend artifacts/verification-diorama/woodland.blend
```

It authors a cabin, trees, stone path, camera and lighting with a 512px Appearance
atlas. It has no external image dependencies. The desktop camera crops the outer
island on a narrow phone; use it to practice authoring Responsive Frames too.

## Export a standalone website

Choose **Export Website Folder** in Blender and select a new or empty output
folder. Blendlink saves the scene, compiles Final quality, verifies every scene
artifact, builds a minimal viewer, and verifies again. Progress and errors stay
in Blender's Website Task panel. You can also run:

```sh
node packages/blendlink/dist/cli.js export --blend "/path/to/scene.blend" --out "/path/to/Scene Website"
```

Upload the folder contents to a static web host. A subfolder is supported; you
do not need Blender, npm, or a server application on the host. The result has
no watermark and requires no Blendlink account. Use the hosted page URL in an
iframe to embed it in another website. Serve the folder through HTTP for local
inspection; double-clicking `index.html` does not bypass browser file security.

A later export can replace this scene's own prior export. An unrelated folder
is refused. Failed compilation/build leaves the previous export intact. Keep
custom application code in your own project using the connection route below.

## Attach your existing website

The supported integration currently requires exact `three: "0.184.0"`.
For R3F, use React 19 with React Three Fiber 9. Check the site's dependencies
first; `connect` refuses incompatible declarations. Upgrading a site's renderer
is a separate change that needs testing. Matching r184 `@types/three` patches
are supported.

From the Blendlink checkout, use the actual website folder and saved scene:

```sh
node packages/blendlink/dist/cli.js connect "/path/to/site" --blend "/path/to/site/assets/hero.blend"
npm run dogfood:package -- --install "/path/to/site"
```

`connect` creates config and scene integration modules and adds scripts. It
leaves your application source for you to edit. The second command builds a
local archive, installs it into that site, and verifies its installed identity.
It also installs the site's declared dependencies through npm. This workflow
assumes an npm-managed site; do not mix lockfile managers in a pnpm/yarn project.
For those projects, build with `npm run dogfood:package`, then use the site's
package manager to add the exact archive path printed by that command.

For a recipient who already has an archive, install its absolute path with
`npm install "/path/to/blendlink-0.9.0-<hash>.tgz"` in the website, then run
`npx blendlink connect . --blend assets/hero.blend`. Retain the archive at the
location recorded in the lockfile for future installs. It is a local dependency,
not a registry release.

### React Three Fiber

For a scene named `hero`, mount the generated component inside your existing
Canvas. Give the Canvas container a nonzero height:

```tsx
import { Canvas } from '@react-three/fiber'
import { HeroScene } from './blendlink/HeroScene'

export function Hero() {
  return (
    <div style={{ height: '60vh' }}>
      <Canvas>
        <HeroScene />
      </Canvas>
    </div>
  )
}
```

Keep an existing Canvas if the page already has one. The component owns loading,
frame updates and cleanup. Add your site's Error Boundary for load failures.
The default Canvas uses WebGL; an initialized WebGPURenderer also works. The
[R3F example](../examples/react-three-fiber/src/main.tsx) shows its async factory.
Start by letting authored playback and lighting states run as configured.
Hard-coded state or light-group names from another scene are not portable.

### Plain Three.js

Use your existing renderer and scene with the generated installer:

```ts
import { installHeroScene } from './blendlink/HeroScene'

const installed = await installHeroScene({ renderer, scene })
// Inside your existing animation loop, with elapsed time in seconds:
installed.update(deltaSeconds)
installed.render(deltaSeconds)
// On container resize:
installed.resize(width, height)
// On page/route teardown:
installed.dispose()
```

These are lifecycle excerpts, not calls to run once in sequence. The
[complete Three example](../examples/vanilla-three/src/main.ts) shows the loop.
An initialized WebGPURenderer or a WebGLRenderer is supported. If your site owns
a composer, coordinate render ownership before combining it with authored
post-processing. Avoid rendering the same Canvas twice each frame.

## Compile, inspect, and build

After adding the integration, run from the website:

```sh
npx blendlink compile --preview
npx blendlink preview
```

The first command also creates the generated imports an editor may initially
report as missing. The second starts the site's own dev server and watches
saved scene changes. Check the scene at desktop and mobile sizes, then stop
Preview and run:

```sh
npx blendlink publish
npx blendlink verify
```

Here **publish** means Final compile, artifact verification, the site's build,
and another verification. It does not upload or deploy. Serve that production
build locally and inspect it too; passing TypeScript does not prove the scene
renders or its textures load.

Commit the config, generated modules, GLB and all compiler-produced companion
files in the configured output folders. The default paths are `src/generated`
and `public/models`. Copying only `hero.glb` loses lighting states, environment
and other authored behavior. The generated loader follows the manifest and
those companions. Static hosting needs the built files, not Blender.

See [project setup](PROJECT_SETUP.md) for custom paths and URL prefixes,
[the manifest contract](MANIFEST.md) for output details, and
[release steps](RELEASE.md) for the separate public-beta process.
