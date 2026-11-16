import { Cache, ImageBitmapLoader, type Source, type Texture } from 'three'
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

export interface PrivateGltfImageBitmaps { dispose(): unknown[] }

/** Observe only decodes made by the private parser's own ImageBitmapLoader.
 * Custom loaders/manager handlers and anything exposed through Three.Cache
 * retain application ownership. In particular Cache.clear() cannot turn a
 * formerly shared bitmap into an owned one. Never inspect arbitrary image.close. */
export function ownPrivateGltfImageBitmaps(loader: GLTFLoader): PrivateGltfImageBitmaps {
  let disposed = false
  const pending = new Set<ImageBitmap>(), owned = new WeakSet<ImageBitmap>()
  const sources = new Map<Source<unknown>, ImageBitmap>()
  const close = (bitmap: ImageBitmap, errors: unknown[]): void => {
    pending.delete(bitmap)
    try { bitmap.close() } catch (error) { errors.push(error) }
  }
  const reportLate = (errors: unknown[]): void => {
    if (errors.length) console.error('SceneToWeb could not release a late private glTF ImageBitmap:', ...errors)
  }
  loader.register(parser => {
    const images = parser.textureLoader
    // This instance was constructed by this private parser. URI-specific
    // application manager handlers bypass it in GLTFLoader.loadTexture().
    if (!(images instanceof ImageBitmapLoader)) return { name: 'SCENETOWEB_private_image_bitmaps' }
    const load = images.load
    images.load = function (url, onLoad, onProgress, onError) {
      const cacheWasEnabled = Cache.enabled
      return load.call(this, url, bitmap => {
        // r184 publishes a newly decoded shared bitmap into Cache.files before
        // invoking onLoad. Checking the result also covers Cache being enabled
        // while the asynchronous fetch/decode was in flight. No cache mutation.
        const shared = cacheWasEnabled || Cache.enabled || Object.values(Cache.files).includes(bitmap)
        if (!shared && !owned.has(bitmap)) {
          owned.add(bitmap)
          pending.add(bitmap)
          if (disposed) { const errors: unknown[] = []; close(bitmap, errors); reportLate(errors) }
        }
        onLoad?.(bitmap)
      }, onProgress, onError)
    }
    return {
      name: 'SCENETOWEB_private_image_bitmaps',
      async afterRoot() {
        // Associations are parser-created textures, including glTF clones that
        // share a Source. Snapshot before the graph is exposed to the caller.
        for (const object of parser.associations.keys()) {
          const texture = object as Texture
          if (!texture.isTexture || !owned.has(texture.source.data as ImageBitmap)) continue
          const source = texture.source, bitmap = source.data as ImageBitmap
          if (disposed) { if (source.data === bitmap) source.data = null }
          else sources.set(source, bitmap)
        }
      },
    }
  })
  return {
    dispose() {
      if (disposed) return []
      disposed = true
      const errors: unknown[] = []
      for (const [source, bitmap] of sources) {
        try { if (source.data === bitmap) source.data = null } catch (error) { errors.push(error) }
      }
      sources.clear()
      for (const bitmap of [...pending]) close(bitmap, errors)
      return errors
    },
  }
}
