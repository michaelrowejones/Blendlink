# Ready PMREM lifetime across renderer epochs

These diagnostics close a separate lifetime edge after the normal-order PMREM/Color receipts. They earn **zero node, native-scene or numerical qualification credit**.

With an externally supplied WebGPU device, disposing Three's renderer erases its texture manager while the device remains alive. A detached shader compile may settle later, causing ordinary RenderTarget disposal to find no manager record and leave the ready color/depth allocations alive. The retained CPU counterexample uses actual Three Textures/Info and does not initialize a GPU.

The fix snapshots only the ready output's original attachments, allocation records, manager WeakMap and device/context. Intact old-manager disposal remains authoritative even when the renderer points at a new manager. If a saved renderer disposal erased the current map, cleanup destroys only captured physical handles. Reading the retained old map prevents double destruction when normal cleanup completed before a later callback reset the manager. Borrowed replacement handles and records remain untouched, and captured manager/device references are cleared after retirement.

Independent review found a combined case: an adopted texture's native Three dispose listener ran before the complete-target owner, destroying a foreign replacement. The follow-up transfers that exact owned color listener to the complete-target owner; normal RenderTarget disposal still calls Three's direct texture cleanup. Both adopted foreign-handle and foreign-FBO controls now pass.

The host suite exercises 22 backend scenarios through actual Three Textures/Info. A bounded actual browser probe then runs ready cleanup, caller-adopted cleanup, and cancellation during an awaited real shader compile after saved-original renderer disposal. Metal and SwiftShader each pass WebGPU and WebGL2: 12 controls, 24 original attachment destroy calls and six original GL framebuffer delete calls, each exactly once. Reset counters remain zero; caller adoption persists until release. Supplied WebGPU devices are verified alive after renderer disposal. GL context-loss facts are recorded separately from explicit deletion calls.

`evidence.json` pins production source, actual scripts, raw report and preserved failing logs. The invocation snapshots retain their original output paths and should be replayed only in a new namespace. No root failed evidence or historical normal-order receipt was rewritten. This folder is not an automatic node-port proof registration; fresh integrated matrices remain authoritative.
