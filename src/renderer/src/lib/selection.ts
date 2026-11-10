import type { Agent } from '../../../shared/types'
import type { Selection } from '../App'

/** Agent-IDs, die die Auswahl in der Mitte zeigt (Einzelansicht, Projekt-Raster oder freies Raster). */
export function shownAgentIds(sel: Selection, agents: Agent[]): string[] {
  if (!sel) return []
  if (sel.kind === 'agent') return [sel.agentId]
  if (sel.kind === 'project')
    return agents.filter((a) => a.projectId === sel.projectId).map((a) => a.id)
  return sel.agentIds
}

/** Baut aus einer Liste von Agent-IDs die passende Auswahl (0 → nichts, 1 → Einzelansicht). */
function fromIds(ids: string[], activeAgentId?: string): Selection {
  if (ids.length === 0) return null
  if (ids.length === 1) return { kind: 'agent', agentId: ids[0] }
  return {
    kind: 'agents',
    agentIds: ids,
    activeAgentId: activeAgentId && ids.includes(activeAgentId) ? activeAgentId : undefined
  }
}

/**
 * Strg+Klick auf einen Agent: zur aktuell gezeigten Menge hinzufügen bzw. daraus entfernen.
 * Ausgangspunkt ist, was gerade in der Mitte zu sehen ist (auch ein Projekt-Raster).
 */
export function toggleAgent(sel: Selection, agentId: string, agents: Agent[]): Selection {
  const ids = shownAgentIds(sel, agents)
  if (ids.includes(agentId)) return fromIds(ids.filter((id) => id !== agentId))
  return fromIds([...ids, agentId], agentId)
}

/** Strg+Klick auf ein Projekt: alle seine Agents hinzufügen – oder entfernen, wenn alle schon gezeigt werden. */
export function toggleProject(sel: Selection, projectId: string, agents: Agent[]): Selection {
  const ids = shownAgentIds(sel, agents)
  const projectIds = agents.filter((a) => a.projectId === projectId).map((a) => a.id)
  if (projectIds.length === 0) return sel
  const allShown = projectIds.every((id) => ids.includes(id))
  if (allShown) return fromIds(ids.filter((id) => !projectIds.includes(id)))
  return fromIds([...ids, ...projectIds.filter((id) => !ids.includes(id))], projectIds[0])
}
