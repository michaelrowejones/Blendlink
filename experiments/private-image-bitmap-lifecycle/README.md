# Native private ImageBitmap lifecycle

This verifies the cleanup change at SDK source commit `1abed642ba742858f3aa2b02bb0fcd42255e3423`. It grants no node coverage, native-engine/Three rendering equivalence, scene appearance or performance acceptance.

The fresh browser run at `/tmp/scenetoweb-private-imagebitmap-browser-r2` passes on actual Chromium ANGLE Metal / Apple M5 Pro. All eight decoded objects are native `ImageBitmap` instances, initially 2x2:

- Detached default preparation, two default install/dispose reloads, public cancellation during a non-abortable native decode, and a genuine fresh Light Path legacy-renderer refusal each close their owned bitmap exactly once. Actual native close changes width/height to zero.
- Application loader, preloaded graph and Three.Cache-shared image controls remain open at installer disposal. The cached image is shared by two installations and remains borrowed after Cache.clear().
- Private Source data clears after disposal; borrowed Source data remains intact. Default texture disposal is observed once. The fresh legacy control loads an actual GLB with the required primitive declaration and hash-verified sidecar; its error explicitly names the Light Path shadow program.

`browser.js` observes native decoding by wrapping the test page's factory and each returned object's close method, calling the actual native methods. It never modifies production SDK files or Three prototypes. The cancellation test delays the decoder's return after a real bitmap exists; it does not claim that network/decode work was aborted. Borrowed test images are manually closed through the native method only after the observation gates, to avoid leaking the test itself.

`run.mjs` builds small packed GLB/external-image fixtures and a valid PNG, serves the frozen built SDK, records actual GL identity, and rejects page/HTTP/console errors. Source and emitted-module hashes are checked before and after capture. The producer intentionally requires the frozen source commit. To reproduce, create a worktree at that commit, copy this experiment directory into it, install local dependencies/build, then run with a new directory after coordinating browser ownership:

```
node experiments/private-image-bitmap-lifecycle/run.mjs NEW_DIRECTORY --browser-lease
```

The first attempt `/tmp/scenetoweb-private-imagebitmap-browser-r1` failed before decoding because Vite's allow list used /tmp while its resolved request used /private/tmp. Its failed producer/report remain untouched. The second producer fixes only output-directory canonicalization; all frozen SDK source/module hashes are unchanged.

`evidence.json` pins the successful report, captured producer/browser source, fixtures, sidecar and immutable SDK snapshots. CPU replay checks these hashes, the public refusal and cancellation errors, all close/dimension/source observations and sidecar binding:

```
node experiments/private-image-bitmap-lifecycle/read.mjs /tmp/scenetoweb-private-imagebitmap-browser-r2
```
