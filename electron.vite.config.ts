import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: [
        { find: '@renderer', replacement: resolve('src/renderer/src') },
        // Monaco ships its own (outdated) copy of DOMPurify and imports it only
        // in vs/base/browser/domSanitize.js. Use the npm package instead, whose version is
        // pinned by `overrides` in package.json (security fixes, Dependabot).
        {
          find: /^\.\/dompurify\/dompurify\.js$/,
          replacement: resolve('node_modules/dompurify/dist/purify.es.mjs')
        }
      ]
    },
    plugins: [react()]
  }
})
