/**
 * Closed tabs of the code view (right): key → version (`at`) at the time of closing.
 * A tab stays closed until newer content arrives (file changed again, new snippet).
 * Lives in Workspace so the column disappears as soon as all tabs are closed.
 */
export type ClosedTabs = Record<string, number>

export const fileTabKey = (path: string): string => 'file:' + path.toLowerCase()
export const snippetsTabKey = (agentId: string): string => 'snippets:' + agentId

export const isTabClosed = (closed: ClosedTabs, key: string, at: number): boolean =>
  closed[key] !== undefined && closed[key] >= at
