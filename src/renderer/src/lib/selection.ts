import type { Agent } from '../../../shared/types'
import type { Selection } from '../App'

/** Agent IDs shown by the selection in the center (single view, project grid or free grid). */
export function shownAgentIds(sel: Selection, agents: Agent[]): string[] {
  if (!sel) return []
  if (sel.kind === 'agent') return [sel.agentId]
  if (sel.kind === 'project')
    return agents.filter((a) => a.projectId === sel.projectId).map((a) => a.id)
  return sel.agentIds
}

/** Builds the matching selection from a list of agent IDs (0 → nothing, 1 → single view). */
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
 * Ctrl+click on an agent: add it to or remove it from the currently shown set.
 * The starting point is whatever is currently visible in the center (including a project grid).
 */
export function toggleAgent(sel: Selection, agentId: string, agents: Agent[]): Selection {
  const ids = shownAgentIds(sel, agents)
  if (ids.includes(agentId)) return fromIds(ids.filter((id) => id !== agentId))
  return fromIds([...ids, agentId], agentId)
}

/**
 * Ctrl+click on a group (project, team): add all its agents – or remove them
 * if all are already shown.
 */
export function toggleAgents(sel: Selection, groupIds: string[], agents: Agent[]): Selection {
  const ids = shownAgentIds(sel, agents)
  if (groupIds.length === 0) return sel
  const allShown = groupIds.every((id) => ids.includes(id))
  if (allShown) return fromIds(ids.filter((id) => !groupIds.includes(id)))
  return fromIds([...ids, ...groupIds.filter((id) => !ids.includes(id))], groupIds[0])
}

/** Ctrl+click on a project: add or remove all its agents. */
export function toggleProject(sel: Selection, projectId: string, agents: Agent[]): Selection {
  const projectIds = agents.filter((a) => a.projectId === projectId).map((a) => a.id)
  return toggleAgents(sel, projectIds, agents)
}
