# Blender Gaussian Blur and Glare transport

Measured September 7, 2026 against Blender 5.2.0 LTS, commit `fbe6228777e7`. Research prototypes and generated fixtures are in `artifacts/verification-look/compositor/`. No production code was changed for this investigation.

## Gaussian Blur

Modern constant `Size` is a two-component radius in pixels. Each axis is clamped to zero or greater. For radius `r`, generate positive half-kernel indices `i=0..ceil(r)`, including the center. The normalized weights are equivalent to:

```
q[i] = exp(-4.5 * (i / r)^2)
w[i] = q[i] / (q[0] + 2 * sum(q[1:]))
```

For `r=0`, the kernel is `[1]`. Blender retains the final `ceil(r)` tap even when its normalized coordinate exceeds 1. Gaussian has no cutoff check. Fractional radii therefore cannot use `floor(r)` or drop the final tap. The source calculates a Gaussian prefactor that cancels during normalization, but retaining its float32 arithmetic gives slightly closer numerical agreement. The prototype does this.

Blender filters horizontally, then vertically. Both passes convolve RGBA directly, including alpha and negative/HDR RGB. They use edge-clamped integer texels when `Extend Bounds=false`. There is no per-edge renormalization or alpha division. Blender transposes the intermediate texture for cache locality; a browser implementation can keep conventional texture orientation and swap the sampling direction. Gaussian is separable regardless of the `Separable` flag. `Fast Gaussian` is a different recursive algorithm and should not be mapped to this finite kernel.

The 12 generated cases cover central impulses, bright edges with negative channels, premultiplied HDR input, radii `(0,0)`, `(2,2)`, `(.7,2.3)`, and `(0,3.5)`. CPU prototype maximum absolute error against Blender EXR32 was `1.9073486e-6`; the impulse maximum was `4.7683716e-7`. This supports a matching two-pass runtime with float targets and exact texel sampling. It does not establish behavior for varying Size or extended output bounds.

Primary sources: [node dispatch and Size semantics](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/nodes/composite/nodes/node_composite_blur.cc), [half-kernel construction and normalization](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/compositor/cached_resources/intern/symmetric_separable_blur_weights.cc), [RGBA passes and boundaries](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/compositor/algorithms/intern/symmetric_separable_blur.cc), [Gaussian evaluation](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/blenlib/intern/math_filter.cc).

## Shared Glare operations

For an image texture, highlights are computed before the spatial effect. High quality uses full-resolution pixels. Medium averages 2x2 blocks and Low averages 4x4 blocks before thresholding. Reduced-resolution outputs are bilinearly enlarged with edge clamping. Quality thus changes the mathematical result, beyond a performance setting.

Highlights convert RGB to HSV, adjust Value, then convert back. Alpha is discarded and the Highlights output alpha is 1. Threshold uses HSV Value, which is maximum RGB, rather than luminance. Let `lo=max(0,threshold)`, `hi=lo+max(0,maximum)` when Clamp Highlights is enabled, otherwise float32 maximum. Let `k=max(0,smoothness)`.

```
smin(a,b,k) = min(a,b) - max(k-abs(a-b),0)^2 / (4*k)
smax(a,b,k) = -smin(-a,-b,k)
```

Use ordinary min/max when `k=0`. Set lower smoothing to `min(k,lo,hi-lo)` and upper smoothing to `min(k,hi,hi-lo)`. The new HSV Value is `smin(hi,smax(lo,V,lowerSmooth),upperSmooth)-lo`. This also explains why threshold zero disables lower smoothing. The source does not unpremultiply RGB first.

After the spatial effect, bilinearly sample glare at original pixel centers, convert to HSV, multiply saturation by `max(0,saturation)`, clamp the resulting saturation to `[0,1]`, and convert back. Multiply RGB by `tint.rgb * max(0,strength) / normalization`. Tint alpha has no effect. The Glare output has alpha 1. The Image output adds this adjusted glare RGB to `max(input.rgb,0)` and takes `max(input.alpha,0)` as alpha. Highlights are unaffected by tint, strength, and saturation.

A single-value socket result has a separate fast path. It shares the original Image and writes transparent black to Glare and Highlights. A spatially uniform image texture still runs normal glare processing. The constant probe measured unchanged `(4,0,2,.25)` Image and `(0,0,0,0)` auxiliary outputs. Blender clamps a negative authored color default to zero before execution, which is recorded separately in the probe output.

Primary source for these operations and the algorithms below: [pinned Glare node implementation](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/nodes/composite/nodes/node_composite_glare.cc).

## Bloom

Bloom needs its own pyramid to match Blender. Its chain length is `floor(log2(max(1,min(highlightWidth,highlightHeight)*clamp(size,0,1))))`. Count less than two returns a copy of the highlights. Otherwise, copy highlights to level zero and create `count-1` levels by integer halving dimensions.

The first downsample uses 13 bilinear taps grouped into five four-tap Karis averages. Karis weight is `1/(max(rgb)+1)` and the weighted sum is normalized by total weight. The central group's contribution is one-half, and the other four groups contribute one-eighth each. Later levels use the same taps with fixed weights. Upsampling uses a 3x3 tent over bilinear samples: center `4/16`, each axial neighbor `2/16`, each diagonal `1/16`. Offsets are measured in output pixels. Add the upsampled result to the existing next larger level. Normalize final RGB by `max(1,count)` during tint/strength multiplication.

The research CPU port matches the 8x8 HDR-alpha reference at high quality: Image maximum error `1.9073486e-6`, Glare `1.6689301e-6`, Highlights `2.5033951e-6`. This validates the core implementation seam. Larger, odd-sized images and quality downsampling still need browser fixtures before claiming comprehensive parity. Generic Three.js bloom settings cannot express all these operations exactly.

## Fog Glow

Fog Glow uses a radial, nonseparable kernel and zero-padded FFT convolution. It is not Gaussian blur. Let `K=max(highlightWidth,highlightHeight)`. Each FFT dimension is the next even 7-smooth number at least `imageDimension+K-1`. The field of view in degrees is `180+(10-180)*pow(clamp(size,0,1),1/3)`. For centered kernel texel `(x,y)`, let `theta=hypot(x,y)*FOV/K`:

```
f0 = 2.61e6 * exp(-(theta/.02)^2)
f1 = 20.91 / (theta+.02)^3
f2 = 72.37 / (theta+.02)^2
kernel = .384*f0 + .478*f1 + .138*f2
```

Evaluate the kernel across the entire padded FFT domain, normalize by its sum, shift its center to coordinate zero, convolve zero-padded RGB and crop back to the original domain. Do not truncate the kernel to K pixels: the pinned source normalizes the entire padded domain. FFTW's dimension selection therefore affects results slightly. The CPU prototype uses NumPy FFT with Blender's padding and kernel and matches Image within `3.8146973e-6` and Glare within `4.2915344e-6` on the 8x8 HDR fixture.

Exact browser matching is feasible with a dedicated FFT or a direct convolution for very small images. A mip bloom approximation cannot provide numeric equivalence. Blender itself transfers GPU highlights to CPU for this FFTW path, then uploads the result. For normal preview sizes, either implement/cache the FFT kernel and transforms or name Fog Glow as an approximation until that work is complete.

Primary sources: [radial kernel and normalization domain](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/compositor/cached_resources/intern/fog_glow_kernel.cc), [FFT padding selection](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/blenlib/intern/fftw.cc).

## Reproduce and consume

Run `generate_kernel_cases.py` with isolated Blender `--background --factory-startup --python`. It uses the production compositor extractor before replacing the RenderLayers Image source with a known float image. The 18 fixtures in `kernel-browser-cases` have the established `input`, `expected`, and `program` schema, plus settings and output socket. Arrays are RGBA, x-fastest, bottom row first, scene-linear Linear Rec.709, premultiplied, with no display transform. EXR32 readback preserves HDR and alpha.

Run `verify_glare_cpu.py` with Blender's bundled Python for independent Bloom, highlights, and Fog Glow comparisons. Run `probe_glare_constant.py` through Blender for the single-value optimization. Index and result JSON files are metadata rather than browser cases and should be excluded when globbing fixtures.

## Follow-up: quality settings and deeper pyramids

`generate_kernel_cases.py -- --bloom-quality` generates 27 extra cases in `bloom-browser-cases`: dimensions 8x8, 31x23, and 32x24; all three qualities; all three outputs. Inputs include negative RGB, partial alpha, a 64-unit impulse, and a bright corner. The larger High cases exercise four pyramid levels. Production programs still reference RenderLayers Image and are extracted before injecting the test image.

The quality prefilter has different dimensions from later Bloom mip levels:

- High uses the original image.
- Medium uses `ceil(width/2), ceil(height/2)` and averages each fixed 2x2 source block before highlight extraction.
- Low uses `ceil(width/4), ceil(height/4)` and averages each fixed 4x4 source block before highlight extraction.

For incomplete edge blocks, clamp coordinates to the original image edge; repeated last-row/column samples retain their full weight. Do not resize the source uniformly into the rounded output dimensions. Medium samples normalized coordinates `(2*texel+1)/originalSize`. Low samples four bilinear taps with offsets `(1,1),(3,1),(1,3),(3,3)` inside each 4x4 block. These taps reduce to the block averages above. The threshold operation happens after averaging, so thresholding at full resolution and then downsizing is incorrect.

Bloom chain length and normalization use this reduced highlight domain. At Size .8, the 8x8 case has High/Medium/Low chain lengths 2/1/0 and normalization 2/1/1. The 31x23 and 32x24 cases both have chain lengths 4/3/2. Later mip dimensions are floor halves of the preceding domain, as described above. For odd dimensions, sample coordinates still use the actual source and destination sizes. Finally enlarge the unadjusted glare by bilinear edge-clamped sampling, then apply saturation/tint/strength. Highlights are independently enlarged without those adjustments.

`verify_glare_cpu.py --bloom-quality` matches all 27 Blender outputs. Worst absolute error is `7.6293945e-6` across all qualities and HDR inputs. The 31x23 High cases are within `3.0994415e-6`, and 32x24 High within `2.8610230e-6`. Float32 rounding accounts for these measured differences. The quality formula and ceil division are explicit in [Glare get_glare_image_size, get_quality_factor, and execute_highlights_cpu](https://github.com/blender/blender/blob/fbe6228777e7/source/blender/nodes/composite/nodes/node_composite_glare.cc).
