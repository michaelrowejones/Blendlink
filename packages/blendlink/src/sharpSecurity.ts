import sharp from 'sharp'

/**
 * Sharp versions before 0.35 inherit vulnerable libvips loaders for GIF,
 * TIFF, and native VIPS files (GHSA-f88m-g3jw-g9cj). Blendlink's portable
 * compiler formats do not require those loaders, so apply Sharp's documented
 * process-wide workaround before decoding any artist-controlled bytes.
 *
 * Keep this narrow. PNG, JPEG, WebP, AVIF, and raw buffers remain available.
 */
sharp.block({
  operation: [
    'VipsForeignLoadNsgif',
    'VipsForeignLoadTiff',
    'VipsForeignLoadVips',
  ],
})

export default sharp
