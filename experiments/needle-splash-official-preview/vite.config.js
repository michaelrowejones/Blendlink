import { defineConfig } from 'vite'
import viteCompression from 'vite-plugin-compression2'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig(async ({ command }) => {
  const { needlePlugins, useGzip, loadConfig } = await import(
    '@needle-tools/engine/plugins/vite/index.js'
  )
  const needleConfig = await loadConfig()
  return {
    base: './',
    plugins: [
      basicSsl(),
      useGzip(needleConfig)
        ? viteCompression({ deleteOriginFile: true })
        : null,
      needlePlugins(command, needleConfig, { openBrowser: false }),
    ],
    server: {
      https: true,
      proxy: {
        'https://localhost:3000': 'https://localhost:3000',
      },
      strictPort: true,
      port: 3000,
    },
    build: {
      outDir: './dist',
      emptyOutDir: true,
      keepNames: true,
    },
  }
})
