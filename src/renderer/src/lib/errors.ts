/** Entfernt den Electron-IPC-Präfix aus Fehlermeldungen ("Error invoking remote method …"). */
export function errorText(e: unknown): string {
  return String(e instanceof Error ? e.message : e)
    .replace(/^Error invoking remote method '[^']+': /, '')
    .replace(/^(Error: )+/, '')
}
