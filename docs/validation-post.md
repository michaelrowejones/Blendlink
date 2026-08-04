# Validation post — draft

Per the v1.3 validation gate: post before building further. Venues in
order: three.js Discourse (Resources), r/threejs, pmndrs Discord
#showcase. 10-day window. Green: ≥25 combined likes, ≥60 link-clicks, ≥3
substantive replies/DMs. Track "I hand-rolled this myself" replies and the
click:view ratio, not comment counts.

---

**Title:** Typed scene modules from Blender files — `scene.nodes.Lamp`
autocompletes, renames become compile errors

**Body:**

I keep hitting the same two problems moving Blender scenes into three.js:

1. `getObjectByName("Lamp")` fails silently when someone renames a mesh.
2. Every re-export is a manual ritual (export dialog → gltfjsx → re-wire).

So I built a small CLI that treats the `.blend` as the source of truth:

```
blendlink compile            # .blend → .glb + manifest + typed module
blendlink compile --watch    # re-syncs on save (~2.6s on a real 17MB file)
blendlink typegen x.glb   # types for ANY GLB — no Blender needed
```

The generated module exports every object, material, animation clip, and
custom property as literal types:

```ts
import { desk } from './generated/desk.gen'

desk.nodes.Lamp          // "Lamp" — autocompleted
desk.extras.lamp_spot    // Blender custom props, typed
useGLTF(desk.url)        // hashed URL, cache-busts on re-export
```

Rename `Lamp` in Blender, save, and the next typecheck fails at every
stale call site. First time I ran it on my own site it immediately caught
a lookup for an object that no longer existed in the scene.

Details that took research to get right: Blender discovered and
version-gated against the .blend header (a 5.2 file opened by 5.1 corrupts
silently), exporter kwargs filtered by RNA introspection (the glTF
exporter's signature churns every release), and success detected via a
sentinel + artifacts rather than the exit code — Blender 5.2 sometimes
crashes during process shutdown *after* a fully successful export.

Everything is standard glTF + generated TypeScript: delete the tool and
your assets keep working. Would this fit your pipeline, or do you
hand-roll something like it today?

[GIF: split screen — move a lamp in Blender, ctrl-S, browser updates;
rename the mesh, VS Code shows the red squiggle]

**Preempt (in a reply if asked, or a footnote):** *How is this different
from gltfjsx?* gltfjsx types one export snapshot and generates JSX you
then own; this types the live `.blend` (including custom properties, which
gltfjsx doesn't type) with a watch loop and no generated component code —
and the type shapes cover stable authored glTF nodes, so `useGLTF` casts work
unchanged.

---

**Assets needed before posting:**
- [ ] The split-screen GIF (watch mode + rename → type error)
- [ ] Public repo with README quickstart
- [ ] The typed-output snippet as a gist for click-tracking
