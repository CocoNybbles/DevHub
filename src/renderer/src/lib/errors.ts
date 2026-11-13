/** Strips the Electron IPC prefix from error messages ("Error invoking remote method …"). */
export function errorText(e: unknown): string {
  return String(e instanceof Error ? e.message : e)
    .replace(/^Error invoking remote method '[^']+': /, '')
    .replace(/^(Error: )+/, '')
}
