import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const publicDir = fileURLToPath(new URL(
  '../../artifacts/release-dogfood/blender-4-splash/public',
  import.meta.url,
))

export default defineConfig({
  root,
  publicDir,
  build: {
    emptyOutDir: true,
    outDir: 'dist',
  },
})

