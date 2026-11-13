/**
 * Attachments in the editor tab's prompt text: claude attaches `@"path"` directly on submit
 * (images as images, even with spaces in the path – verified with `claude -p`).
 */

export const attachmentToken = (path: string): string => `@"${path}"`

const TOKEN_RE = /@"([^"\r\n]+)"/g

/** All attached paths (without duplicates), in text order */
export function attachmentRefs(text: string): string[] {
  return [...new Set([...text.matchAll(TOKEN_RE)].map((m) => m[1]))]
}

/** Removes all occurrences of an attachment along with one trailing space */
export function removeAttachment(text: string, path: string): string {
  return text
    .split(attachmentToken(path) + ' ')
    .join('')
    .split(attachmentToken(path))
    .join('')
}

/** Append text (e.g. a voice command) to the draft */
export function appendToDraft(draft: string, text: string): string {
  if (!draft.trim()) return text
  return draft.replace(/\s+$/, '') + (draft.includes('\n') ? '\n' : ' ') + text
}
