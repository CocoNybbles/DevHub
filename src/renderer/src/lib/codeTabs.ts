/**
 * Geschlossene Reiter der Code-Ansicht (rechts): Schlüssel → Stand (`at`) beim Schließen.
 * Ein Reiter bleibt zu, bis neuere Inhalte kommen (Datei erneut geändert, neues Snippet).
 * Liegt im Workspace, damit die Spalte verschwindet, sobald alle Reiter geschlossen sind.
 */
export type ClosedTabs = Record<string, number>

export const fileTabKey = (path: string): string => 'file:' + path.toLowerCase()
export const snippetsTabKey = (agentId: string): string => 'snippets:' + agentId

export const isTabClosed = (closed: ClosedTabs, key: string, at: number): boolean =>
  closed[key] !== undefined && closed[key] >= at
