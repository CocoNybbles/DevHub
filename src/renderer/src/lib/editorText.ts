/**
 * Anhänge im Prompt-Text des Editor-Tabs: claude hängt `@"pfad"` beim Abschicken direkt an
 * (Bilder als Bild, auch mit Leerzeichen im Pfad – mit `claude -p` geprüft).
 */

export const attachmentToken = (path: string): string => `@"${path}"`

const TOKEN_RE = /@"([^"\r\n]+)"/g

/** Alle angehängten Pfade (ohne Doppelte), in Reihenfolge des Textes */
export function attachmentRefs(text: string): string[] {
  return [...new Set([...text.matchAll(TOKEN_RE)].map((m) => m[1]))]
}

/** Entfernt alle Vorkommen eines Anhangs samt einem folgenden Leerzeichen */
export function removeAttachment(text: string, path: string): string {
  return text
    .split(attachmentToken(path) + ' ')
    .join('')
    .split(attachmentToken(path))
    .join('')
}

/** Text (z. B. Sprachbefehl) an den Entwurf anhängen */
export function appendToDraft(draft: string, text: string): string {
  if (!draft.trim()) return text
  return draft.replace(/\s+$/, '') + (draft.includes('\n') ? '\n' : ' ') + text
}
