// Schlanker Import: Editor-Kern + Syntax-Hervorhebung (ohne TS/JSON/CSS/HTML-Sprachdienste)
import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/basic-languages/monaco.contribution'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'

// Nur der Basis-Worker: Ansicht ist schreibgeschützt, Syntax-Hervorhebung braucht keine Sprach-Worker
self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

// Theme global setzen: auch `colorize` (Snippets ohne Editor) braucht die Farbklassen
monaco.editor.setTheme('vs-dark')

export { monaco }

/** Sprache für eine Datei (Endung oder Dateiname) */
export function languageForPath(path: string): string {
  const ext = '.' + (path.split('.').pop() ?? '').toLowerCase()
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  const lang = monaco.languages
    .getLanguages()
    .find((l) => l.extensions?.includes(ext) || l.filenames?.some((f) => f.toLowerCase() === name))
  if (lang) return lang.id
  // JSON gehört nicht zu den Basis-Sprachen → JavaScript-Hervorhebung passt dafür gut
  if (['.json', '.jsonc', '.json5'].includes(ext)) return 'javascript'
  return 'plaintext'
}

/** Sprache für einen Markdown-Code-Zaun (```sql, ```ps1, ```bash …) */
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
