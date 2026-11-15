# Signed unit-axis Vector Rotate

This extends the existing Blender 5.3 CPU compositor Vector Rotate slice to `AXIS_ANGLE` with exactly one raw Axis component equal to +1 or -1 and the other components positive zero. Both Invert settings and the untouched native defaults (Axis +Z and Angle +0) are included. Arbitrary, zero, linked and animated axes remain refused; Euler rotation remains unsupported.

Angle is static positive zero or a normal Float32 magnitude in [2^-16, 1] radians. Center and literal Vector components are positive zero or normal magnitudes in [2^-16, 16]. The only varying Vector is the existing qualified direct Normalized coordinate input with native Z=+0. Original Axis/mode/control storage, private native MF carrier configuration, ownership, source mutations and pre-store component hashes are checked. No shader or EEVEE arithmetic claim is made.

The fresh automatic next58 transaction captured 35 native graphs, 5 independent Pixel controls, 110 CPU renders and 10 saved Finals. Metal and SwiftShader each passed actual WebGPU and WebGL2: 180 browser cases and 1,134,688 primary Float32 words matched exactly. The archive additionally contains 3,478,944 linear words, 912 calibration captures containing 4,651,072 words, and 209,244 pre-store hash words. All three closed-reader outputs are byte-identical:

`a5103e72f871f089c8a7440baf4f68ebc98296634164e6152390e638644e7b82`

There are 16 resize checks, 120 installation cycles and 13 isolated native Python prefixes. The separate existing Raw display contract is clamp01 absolute error at most 3e-5, with exact alpha words and finite classes; this run observed zero differences in 112,320 display words. The automatic wrapper reports a stable workspace and no category promotion.

Normalized input uses one owned two-row R32F table, at most 64 KiB logical storage and O(W+H) refresh on a valid extent change, with zero warm uploads. Rotation adds no owned RTT. Render Layers and complete pipeline resources still apply; the 21 arithmetic barriers are not an FPS claim. Actual row handles are retired once, including retained saved-dispose callbacks, without destroying the external WebGPU device.

`evidence.json` embeds the unchanged full receipt and pins the automatic wrapper, all three readers and the older fixed-axis receipt. Raw archives remain ignored, machine-local files under `/tmp/scenetoweb-vector-rotate-unit-axis-qualification/artifacts/verification-vector-rotate-unit-axis-next58-manifest`.

To reproduce in a fresh namespace:

```sh
node scripts/test-node-port.mjs compositor-vector-rotate-unit-axis \
  --profile mac-53 --blender /Applications/Blender.app/Contents/MacOS/Blender \
  --evidence artifacts/verification-vector-rotate-unit-axis-fresh
```

Only this bounded compositor extension is newly qualified. Existing fixed-axis counters, shader support, older versions and other family receipts retain their own snapshots.
