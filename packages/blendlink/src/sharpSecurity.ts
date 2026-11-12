import sharp from 'sharp'

/**
 * Keep the compiler's established input boundary after upgrading to patched
 * Sharp/libvips. Portable scene images do not need GIF, TIFF or native VIPS
 * loaders. This format restriction is no longer an advisory exception.
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
