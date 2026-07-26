# Responsive Frame and visual-reference workflow

Blendlink treats a Blender render and a website screenshot as two different
pieces of evidence. It never renders a Blender viewport image and calls that
the Three.js result.

## Check a Responsive Frame while authoring

In **Website Camera & Frames → Responsive Preview & Visual Checks**:

1. Select a **Responsive Frame** in the parent panel.
2. Choose a representative **Reference Pixel Ratio**. This is a verification
   target, not a command that overrides the website's renderer.
3. Press **Preview Selected Frame**.

Blendlink switches to the designated Website Camera and applies the Responsive
Frame's aspect at its backing-buffer dimensions. The viewport then
shows:

- dark crop outside the exact camera frame;
- a blue final-frame boundary;
- an amber page-safe zone;
- CSS dimensions, reference DPR, and resulting backing-buffer dimensions.

If Blender is showing another camera or a different render aspect, the overlay
turns red and explains how to make the crop exact. **Restore** returns the
camera, resolution, percentage, and pixel aspect that were active before the
preview.

## Build the audit matrix

The visual audit is the full cross product:

```
cameras × lighting states × Responsive Frames × animation poses × Preview/Final
```

Choose the Website Camera or all render-visible scene cameras. Enter
poses as `current`, `start`, `end`, individual frames, or inclusive stepped
ranges such as `1,24,48` or `1-120x12`. Blendlink caps a plan at 128 unique
poses and an 8192-pixel backing-buffer edge so a typo cannot silently schedule
thousands of enormous renders.

Save the scene before either action so the compiler and reference capture use
the same bytes; the plan records the same 16-character `.blend` SHA-256 prefix
used by Blendlink's build manifest.

**Build Plan** writes `comparison-manifest.json` without rendering. **Capture
Blender** writes one clean source render for each unique camera/state/
Responsive Frame/pose and updates the manifest after every successful image. The
same authored source reference is intentionally shared by Preview and Final:
those qualities change the compiled website artifact, not the Blender truth it
is compared against.

The output is organized as:

```
blendlink-references/
  comparison-manifest.json
  blender/             # captured by Blender
  browser/preview/     # required from the actual Preview website
  browser/final/       # required from the actual Final website
  diff/preview/        # expected comparison output
  diff/final/
```

## Browser-adapter contract

Every comparison cell contains a build command, CSS viewport, DPR, stable
camera ID, lighting-state name, animation frame/time, required website image
path, and expected diff path. A browser adapter must:

1. run the cell's Preview or Final build;
2. verify that build's source `.blend` hash matches `sourceBlendHash`;
3. open the real website at the requested viewport and DPR;
4. select the stable camera and lighting state;
5. pause animation and seek to the requested time;
6. save the unscaled screenshot at `browser.path` and verify its backing size;
7. compare it against the referenced Blender PNG and write `comparison.path`.

Browser cells remain `required` after Blender capture. Fill them from the real
website through the exported `runVisualReferenceAudit()` seam:

```ts
import { runVisualReferenceAudit } from 'blendlink'

await runVisualReferenceAudit('blendlink-references/comparison-manifest.json', {
  prepareQuality: async (quality, buildCommand) => {
    // Run or select the requested Preview/Final artifact in your own tooling.
  },
  captureBrowser: async ({ comparison }) => {
    // Your Playwright/browser adapter applies comparison.browser.viewport,
    // cameraObjectId, lightingState, and timeSeconds, then returns PNG bytes.
    return captureWebsiteCell(comparison)
  },
  // Optional and project-owned. Omit to measure without arbitrary pass/fail.
  acceptance: { maxMeanAbsoluteError: 0.03, pixelThreshold: 2 / 255 },
})
```

The runner verifies the source `.blend` hash, refuses missing Blender truth,
requires an unscaled PNG at the exact CSS size × DPR, writes browser evidence,
generates an amplified absolute premultiplied-RGBA diff with Sharp, and records
MAE, RMSE, maximum channel error, and changed-pixel ratio after every cell.
Premultiplication ignores invisible RGB noise while alpha-only page-composition
differences remain visible and measurable. Capture or
dimension failures remain in the manifest and are thrown together at the end.
Blendlink never launches a browser or executes `buildCommand` invisibly; those
structural choices stay in the website adapter.
