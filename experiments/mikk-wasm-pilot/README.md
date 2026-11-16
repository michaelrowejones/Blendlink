# Portable mixed-face Mikk CPU oracle pilot

Experimental CPU helper only. No Normal Map production admission, native draw
frame certificate, runtime integration or scene acceptance is claimed.

The maintainer-built **wasm32-wasip1** command executes the existing independent
Apache adapter from `../archviz-tangent-frame/mikk-probe.cc`, including its mixed
quad/triangle callbacks. N-gons are represented by the frozen native loop
triangulation, while authored quads remain quads. No GPL Blender shader/draw
implementation is compiled or linked. No source mesh is triangulated or saved.

The official WASI SDK34 macOS-arm64 archive is SHA-pinned in `receipt.json`.
LLVM23.1.0 builds with `-O2 -ffp-contract=off -fno-exceptions`, without fast-math,
SIMD or threads; `llvm-strip --strip-all` reduces the command from 3MiB to about
264KiB. The first build omitted `-fno-exceptions` and failed to link the absent
C++ exception ABI; that failed build/log remains retained separately. There is
no change to Mikk arithmetic. Invalid-input/OOM packaging and process resource
limits remain later integration work; this pilot executes known pinned inputs.

The generated WASM is retained locally at
`/tmp/scenetoweb-mikk-wasm-r3/mikk-probe.stripped.wasm`, pinned by the receipt.
It runs with Node24.22.1's built-in WASI preview1: **no artist compiler is needed**.
A future installer can bundle a maintainer-built, pinned artifact. This is not
part of the released SDK. The compiler/toolchain itself remains under `/tmp`.

```sh
node experiments/mikk-wasm-pilot/run.mjs /ABS/PATH/mikk-probe.stripped.wasm \
  < /ABS/FROZEN/Walls-native-face-model.mesh > /ABS/NEW_OUTPUT.tangents
python3 experiments/mikk-wasm-pilot/build.py /ABS/WASI_SDK /ABS/PINNED_BLENDER_SOURCE NEW_BUILD
python3 experiments/mikk-wasm-pilot/compare.py /ABS/BUILT_WASM \
  /tmp/scenetoweb-archviz-tangent-cpu-r2 \
  /tmp/scenetoweb-mikk-public-native-r2 NEW_COMPARISON
```

`build.py` verifies the four Apache Mikk header hashes before compilation.
`compare.py` checks the frozen input/native-output hashes, every callback loop
ID, **Float32 words including signed zero**, tangent SNORM10 packing and sign
words. All 14 mixed/all-triangle/small/folded-quad cases pass, totaling **24,842
callback rows with zero differences**. The all-triangle control remains a
separate result; it does not replace the quad-preserving model.

A new read-only actual Blender5.3 public-Mikk witness verifies original position,
corner-normal and UV Float32 words plus face/corner identity against the frozen
datasets before `calc_tangents`. Plane.021's 4,444 public native loops match
WASM with **zero Float32 word and packed-SNORM10 differences**. Walls' public
API still refuses n-gons. Its WASM/native-C++ equality therefore remains a
source-model CPU result, not proof of the EEVEE draw buffer. Source SHA remains
unchanged; all render/save counts are zero. No GPU jobs ran.

This removes the host C++ compiler dependency for the oracle computation. The
remaining Normal Map barrier is a native corner-frame certificate and portable
export transport preserving those frames through welding/optimization, including
degenerate UV and nearly parallel tangent cases. Matching an oracle does not
prove shading output or justify removing the current production refusal.

## License/source audit

The four pinned Mikk headers declare **Apache-2.0**, with original Morten S.
Mikkelsen/Blender Authors notices. The adapter and Node/build/comparison helpers
are independently written Apache-2.0 code. The optional Blender public-API
witness is a separate GPL-3.0-or-later Python producer; none of its code enters
WASM. Runtime dependencies are compiler-rt/libc++/libc++abi from pinned LLVM
(**Apache-2.0 with LLVM exceptions**) and pinned wasi-libc, whose license manifest
lists Apache/LLVM-exception, Apache, MIT and inherited CC0/BSD2/BSD3 components.
Exact license files, versions, runtime archives and hashes are retained in the
receipt. This pilot does not label wasi-libc as solely Apache or copy GPL kernels.
Node is an existing runtime, not bundled here. A distributed helper package must
retain the applicable component license texts/notices along with the artifact.

Primary references: [official WASI SDK34 release](https://github.com/WebAssembly/wasi-sdk/releases/tag/wasi-sdk-34),
[SDK build/target documentation](https://github.com/WebAssembly/wasi-sdk/blob/wasi-sdk-34/README.md),
[LLVM license](https://github.com/llvm/llvm-project/blob/895aa2c896ada719451be2e3673c83da8ddf1141/llvm/LICENSE.TXT),
[pinned wasi-libc license manifest](https://github.com/WebAssembly/wasi-libc/blob/2e6fb9d8ee0cdf9e431fbcabe8af3115de000a13/LICENSE),
[Node WASI API](https://nodejs.org/docs/latest-v24.x/api/wasi.html).
The Node WASI API remains experimental; this runner uses only the trusted pinned
module, empty environment and no preopened directories, not an untrusted-code
sandbox. Captured CPU timings are not a performance qualification.
