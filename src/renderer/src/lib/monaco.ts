// Slim import: editor core + syntax highlighting (without TS/JSON/CSS/HTML language services)
import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/basic-languages/monaco.contribution'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'

// Base worker only: the view is read-only, syntax highlighting needs no language workers
self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

// Set the theme globally: `colorize` (snippets without an editor) needs the color classes too
monaco.editor.setTheme('vs-dark')

export { monaco }

/** Language for a file (extension or file name) */
export function languageForPath(path: string): string {
  const ext = '.' + (path.split('.').pop() ?? '').toLowerCase()
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  const lang = monaco.languages
    .getLanguages()
    .find((l) => l.extensions?.includes(ext) || l.filenames?.some((f) => f.toLowerCase() === name))
  if (lang) return lang.id
  // JSON is not among the basic languages → JavaScript highlighting fits it well
  if (['.json', '.jsonc', '.json5'].includes(ext)) return 'javascript'
  return 'plaintext'
}

/** Language for a Markdown code fence (```sql, ```ps1, ```bash …) */
export function languageForFence(fence: string): string {
  const f = fence.toLowerCase()
  if (!f) return 'plaintext'
  if (['json', 'jsonc', 'json5'].includes(f)) return 'javascript'
  if (['bash', 'sh', 'zsh', 'console', 'shell'].includes(f)) return 'shell'
  if (['ps', 'ps1', 'pwsh'].includes(f)) return 'powershell'
  if (['cmd', 'batch'].includes(f)) return 'bat'
  const lang = monaco.languages
    .getLanguages()
    .find(
      (l) =>
        l.id === f ||
        l.aliases?.some((a) => a.toLowerCase() === f) ||
        l.extensions?.includes('.' + f)
    )
  return lang?.id ?? 'plaintext'
}
