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
        // Monaco bringt eine eigene (veraltete) Kopie von DOMPurify mit und importiert sie nur
        // in vs/base/browser/domSanitize.js. Stattdessen das npm-Paket nehmen, dessen Version
        // `overrides` in package.json festlegt (Sicherheitskorrekturen, Dependabot).
        {
          find: /^\.\/dompurify\/dompurify\.js$/,
          replacement: resolve('node_modules/dompurify/dist/purify.es.mjs')
        }
      ]
    },
    plugins: [react()]
  }
})
