import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Agent,
  AgentTemplate,
  CodeFocus,
  CodeSnippet,
  EditedFile,
  Project,
  Settings,
  Team,
  TeamTemplate,
  VoiceStatus
} from '../../shared/types'
import { isTeamWorker, teamLead } from '../../shared/types'
import type { Selection } from './App'
import Sidebar from './components/Sidebar'
import CenterPane from './components/CenterPane'
import CodePane from './components/CodePane'
import EditorTab from './components/EditorTab'
import { CloseIcon, EditIcon, GridIcon } from './components/Icons'
import { appendToDraft } from './lib/editorText'
import { ClosedTabs, fileTabKey, isTabClosed, snippetsTabKey } from './lib/codeTabs'
import ProjectDialog from './components/ProjectDialog'
import ImportProjectsDialog from './components/ImportProjectsDialog'
import SettingsDialog from './components/SettingsDialog'
import AgentTemplateDialog from './components/AgentTemplateDialog'
import TeamTemplateDialog from './components/TeamTemplateDialog'
import VoiceSetupDialog from './components/VoiceSetupDialog'
import VoiceOverlay, { VoiceJob, VoiceRecording } from './components/VoiceOverlay'
import { DEFAULT_HOTKEYS, matchesAccelerator } from '../../shared/hotkeys'
import { isCapturingHotkey } from './lib/hotkeyCapture'
import {
  disposeTerminal,
  hasTerminal,
  dropSnapshot,
  sendEditorKey,
  snapshotTerminal,
  setAppHotkeys,
  setTerminalLocked,
  setTerminalReadOnly,
  terminalIds,
  writeToTerminal
} from './lib/terminals'
import { Recorder } from './lib/recorder'
import { errorText } from './lib/errors'
import { shownAgentIds, toggleAgent, toggleAgents, toggleProject } from './lib/selection'
import { canRememberLanguage } from '../../shared/voiceLanguage'

type VoiceTarget = { kind: 'agent'; agentId: string } | { kind: 'global' }

/** Time for claude to redraw at the new size after the terminal moves into the editor tab */
const EDITOR_REDRAW_MS = 400
/** If claude does not open an editor within this time afterwards, the tab is closed again */
const EDITOR_OPEN_TIMEOUT_MS = 4000

function Workspace(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [rawSelection, setSelection] = useState<Selection>(null)
  /** Saved view has been loaded → changes may be saved */
  const viewLoaded = useRef(false)
  const [focusByAgent, setFocusByAgent] = useState<Record<string, CodeFocus>>({})
  /** Code blocks from the replies, per agent (newest first) */
  const [snippetsByAgent, setSnippetsByAgent] = useState<Record<string, CodeSnippet[]>>({})
  /** Files edited by the agent (one tab each on the right) */
  const [editsByAgent, setEditsByAgent] = useState<Record<string, EditedFile[]>>({})
  /** Ctrl+G editor tabs: selected tab in the center (agent id, null = agents view) + drafts */
  const [editorTab, setEditorTab] = useState<string | null>(null)
  /** Tab is opening, but claude has not started the editor yet (see openEditor) */
  const [preparing, setPreparing] = useState<string | null>(null)
  const prepareTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  /** Current agents for timer callbacks */
  const agentsRef = useRef<Agent[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [vscodeInstalled, setVscodeInstalled] = useState(false)
  const [settings, setSettings] = useState<Settings>({
    voiceModel: null,
    voiceAutoSend: true,
    hotkeyAgentVoice: DEFAULT_HOTKEYS.agentVoice,
    hotkeyGlobalVoice: DEFAULT_HOTKEYS.globalVoice,
    hotkeyEditor: DEFAULT_HOTKEYS.editor,
    agentArgs: '',
    projectFileApp: '',
    folderApp: '',
    voiceRememberLanguage: true,
    voiceLanguage: null,
    voiceFixedLanguage: null,
    showEditedFiles: true
  })
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [projectDialog, setProjectDialog] = useState<{ project: Project | null } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [templates, setTemplates] = useState<AgentTemplate[]>([])
  /** Edit template (template null = new); opened from within the settings */
  const [templateDialog, setTemplateDialog] = useState<{ template: AgentTemplate | null } | null>(
    null
  )
  const [teamTemplates, setTeamTemplates] = useState<TeamTemplate[]>([])
  const [teamDialog, setTeamDialog] = useState<{ team: TeamTemplate | null } | null>(null)
  /** Running teams */
  const [teams, setTeams] = useState<Team[]>([])
  const [voiceSetupOpen, setVoiceSetupOpen] = useState(false)
  const [recording, setRecording] = useState<VoiceRecording | null>(null)
  const [voiceJobs, setVoiceJobs] = useState<VoiceJob[]>([])

  const showError = useCallback((e: unknown) => setToast(errorText(e)), [])
  const refreshVoice = useCallback(() => window.api.voice.status().then(setVoiceStatus), [])

  // ---------------------------------------------------------------- Loading & events
  useEffect(() => {
    const offData = window.api.agents.onData((id, data) => writeToTerminal(id, data))
    const offChanged = window.api.agents.onChanged((list, teamList) => {
      setAgents(list)
      setTeams(teamList)
    })
    const offFailed = window.api.agents.onStartFailed((name, output) =>
      setToast(output ? `${name} konnte nicht starten:\n${output}` : `${name} konnte nicht starten`)
    )
    const offFocus = window.api.code.onFocus((f) =>
      setFocusByAgent((m) => ({ ...m, [f.agentId]: f }))
    )
    const offSnippets = window.api.code.onSnippets((id, list) =>
      setSnippetsByAgent((m) => ({ ...m, [id]: list }))
    )
    const offEdits = window.api.code.onEdits((id, list) =>
      setEditsByAgent((m) => ({ ...m, [id]: list }))
    )
    // Ctrl+G in the agent → open the editor tab and switch to it
    const offEditorOpened = window.api.editor.onOpened((id, text) => {
      // Lock immediately, before the tab moves the terminal into another container
      // (otherwise the size changes, and claude cannot redraw right now)
      setTerminalLocked(id, true)
      setDrafts((d) => ({ ...d, [id]: text }))
      setEditorTab(id)
    })
    // Voice text for a locked agent goes into the draft
    const offEditorAppend = window.api.editor.onAppend((id, text) =>
      setDrafts((d) => ({ ...d, [id]: appendToDraft(d[id] ?? '', text) }))
    )
    // After a UI reload: snippets collected so far for the running agents
    window.api.code.snippets().then((all) => setSnippetsByAgent((m) => ({ ...all, ...m })))
    window.api.code.edits().then((all) => setEditsByAgent((m) => ({ ...all, ...m })))

    ;(async () => {
      setProjects(await window.api.projects.list())
      window.api.tools.vscodeInstalled().then(setVscodeInstalled)
      window.api.settings.get().then(setSettings)
      window.api.templates.list().then(setTemplates)
      window.api.teamTemplates.list().then(setTeamTemplates)
      window.api.teams.list().then(setTeams)
      refreshVoice()

      const running = await window.api.agents.list()
      if (running.length > 0) {
        // UI was reloaded, agents are still running → load previous output
        for (const a of running) {
          if (!hasTerminal(a.id)) writeToTerminal(a.id, await window.api.agents.buffer(a.id))
          // Show open editor tabs again
          if (a.editing) {
            const text = await window.api.editor.text(a.id)
            if (text !== null) setDrafts((d) => ({ ...d, [a.id]: d[a.id] ?? text }))
          }
        }
        setAgents(running)
      } else {
        // Fresh app start → restore the agents of the last session
        await window.api.agents.restore().catch(showError)
      }

      // Restore the last shown view (agents no longer running are dropped via
      // `selection`), otherwise the first project with agents (grid)
      const [agentsNow, savedView] = await Promise.all([
        window.api.agents.list(),
        window.api.view.get().catch(() => null)
      ])
      // Set agents in the same render pass, otherwise `selection` discards the view
      setAgents(agentsNow)
      const first = agentsNow[0]?.projectId
      setSelection((s) => s ?? savedView ?? (first ? { kind: 'project', projectId: first } : null))
      viewLoaded.current = true
    })()

    return () => {
      offData()
      offChanged()
      offFocus()
      offSnippets()
      offEdits()
      offEditorOpened()
      offEditorAppend()
      offFailed()
    }
  }, [refreshVoice, showError])

  // Exited agents: release the terminal
  useEffect(() => {
    const ids = new Set(agents.map((a) => a.id))
    for (const id of terminalIds()) if (!ids.has(id)) disposeTerminal(id)
  }, [agents])

  // Restrict the selection to agents/projects that still exist → the view of an exited agent closes
  const selection = useMemo<Selection>(() => {
    const sel = rawSelection
    if (sel?.kind === 'agent' && !agents.some((a) => a.id === sel.agentId)) return null
    if (sel?.kind === 'project') {
      if (!projects.some((p) => p.id === sel.projectId)) return null
      if (sel.activeAgentId && !agents.some((a) => a.id === sel.activeAgentId)) {
        return { kind: 'project', projectId: sel.projectId }
      }
    }
    if (sel?.kind === 'agents') {
      const ids = sel.agentIds.filter((id) => agents.some((a) => a.id === id))
      if (ids.length === 0) return null
      if (ids.length === 1) return { kind: 'agent', agentId: ids[0] }
      const active =
        sel.activeAgentId && ids.includes(sel.activeAgentId) ? sel.activeAgentId : undefined
      if (ids.length !== sel.agentIds.length || active !== sel.activeAgentId)
        return { kind: 'agents', agentIds: ids, activeAgentId: active }
    }
    return sel
  }, [rawSelection, agents, projects])

  // Save the view – only after the saved one has been loaded (otherwise the initial value overwrites it)
  useEffect(() => {
    if (viewLoaded.current) window.api.view.set(selection).catch(() => {})
  }, [selection])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.length > 120 ? 15000 : 6000)
    return () => clearTimeout(t)
  }, [toast])

  // ---------------------------------------------------------------- Derived values
  /** Agents whose instruction is currently being written in an editor tab (locked) */
  /** Tabs: locked agents + possibly a tab that is currently opening (`preparing`) */
  const tabAgents = useMemo(
    () => agents.filter((a) => a.editing || a.id === preparing),
    [agents, preparing]
  )
  /** Visible editor tab (null = agents view); closed tabs drop out */
  const activeEditor = tabAgents.find((a) => a.id === editorTab) ?? null

  const activeAgentId = useMemo(() => {
    // In the editor tab: the voice hotkey dictates into this draft
    if (activeEditor) return activeEditor.id
    if (selection?.kind === 'agent') return selection.agentId
    if (selection?.kind === 'project') {
      return (
        selection.activeAgentId ??
        agents.find((a) => a.projectId === selection.projectId)?.id ??
        null
      )
    }
    if (selection?.kind === 'agents') return selection.activeAgentId ?? selection.agentIds[0]
    return null
  }, [selection, agents, activeEditor])

  // Terminals of locked agents accept no input
  useEffect(() => {
    agentsRef.current = agents
    for (const a of agents) {
      setTerminalReadOnly(a.id, isTeamWorker(a)) // team worker: observe only
      setTerminalLocked(a.id, !!a.editing)
    }
  }, [agents])

  /** Close the editor tab and hand the text back to claude */
  const finishEditor = useCallback(
    (agentId: string, text: string | null, submit: boolean) => {
      // Tab was still being set up (editor not open) → just cancel
      clearTimeout(prepareTimers.current[agentId])
      setPreparing((p) => (p === agentId ? null : p))
      dropSnapshot(agentId) // agents view shows the live terminal again
      if (agents.find((a) => a.id === agentId)?.editing) {
        window.api.editor.finish(agentId, text, submit).catch(showError)
      }
      setDrafts((d) => {
        const rest = { ...d }
        delete rest[agentId]
        return rest
      })
      setEditorTab(null)
    },
    [agents, showError]
  )

  /** Tabs on the right closed by the user (until newer content arrives) */
  const [closedTabs, setClosedTabs] = useState<ClosedTabs>({})

  /** Code view: focus of the active agent, otherwise the most recent focus in the selected project. */
  const shownFocus = useMemo(() => {
    if (activeAgentId && focusByAgent[activeAgentId]) return focusByAgent[activeAgentId]
    if (selection?.kind === 'project' || selection?.kind === 'agents') {
      const ids = new Set(shownAgentIds(selection, agents))
      return (
        Object.values(focusByAgent)
          .filter((f) => ids.has(f.agentId))
          .sort((a, b) => b.at - a.at)[0] ?? null
      )
    }
    return null
  }, [activeAgentId, focusByAgent, selection, agents])
  const codeFocus =
    shownFocus && !isTabClosed(closedTabs, fileTabKey(shownFocus.filePath), shownFocus.at)
      ? shownFocus
      : null

  /** Snippets of the active agent (right, "Snippets" tab) – empty while the tab is closed */
  const activeSnippets = useMemo(() => {
    const list = activeAgentId ? (snippetsByAgent[activeAgentId] ?? []) : []
    if (!activeAgentId || !list.length) return list
    return isTabClosed(closedTabs, snippetsTabKey(activeAgentId), list[0].at) ? [] : list
  }, [activeAgentId, snippetsByAgent, closedTabs])
  /** Files edited by the active agent (right, one tab each), excluding closed ones */
  const activeEdits = useMemo(
    () =>
      activeAgentId && settings.showEditedFiles
        ? (editsByAgent[activeAgentId] ?? []).filter(
            (e) => !isTabClosed(closedTabs, fileTabKey(e.filePath), e.at)
          )
        : [],
    [activeAgentId, editsByAgent, settings.showEditedFiles, closedTabs]
  )
  // Column only while a tab is open – all closed → column closed
  const showCodePane = !!codeFocus || activeSnippets.length > 0 || activeEdits.length > 0

  // ---------------------------------------------------------------- Actions
  const startAgent = useCallback(
    async (projectId: string, task?: string, templateId?: string) => {
      try {
        const agent = await window.api.agents.start(projectId, task, templateId)
        setSelection({ kind: 'agent', agentId: agent.id })
        return agent
      } catch (e) {
        showError(e)
        return null
      }
    },
    [showError]
  )

  /** Start a team from a team template and show all members in the grid. */
  const startTeam = useCallback(
    async (projectId: string, teamTemplateId: string) => {
      try {
        const team = await window.api.teams.start(projectId, teamTemplateId)
        const ids = (await window.api.agents.list())
          .filter((a) => a.teamId === team.id)
          .map((a) => a.id)
        if (ids.length) setSelection({ kind: 'agents', agentIds: ids })
      } catch (e) {
        showError(e)
      }
    },
    [showError]
  )

  const stopTeam = useCallback(
    (team: Team) => {
      const count = agents.filter((a) => a.teamId === team.id).length
      if (!confirm(`Team „${team.name}“ mit ${count} Agent(s) beenden?`)) return
      window.api.teams.stop(team.id).catch(showError)
    },
    [agents, showError]
  )

  const stopAgent = useCallback(
    (agent: Agent) => {
      const question =
        agent.teamRole === 'orchestrator'
          ? `„${agent.name}“ steuert ein Team – das ganze Team beenden?`
          : `„${agent.name}“ beenden?`
      if (!confirm(question)) return
      window.api.agents.stop(agent.id).catch(showError)
    },
    [showError]
  )

  const removeProject = useCallback(
    async (p: Project) => {
      const count = agents.filter((a) => a.projectId === p.id).length
      const msg = count
        ? `Projekt „${p.name}“ entfernen? ${count} laufende Agent(s) werden beendet.`
        : `Projekt „${p.name}“ entfernen? (Die Dateien bleiben unverändert.)`
      if (!confirm(msg)) return
      await window.api.projects.remove(p.id).catch(showError)
      setProjects(await window.api.projects.list())
      setSelection((s) => (s?.kind === 'project' && s.projectId === p.id ? null : s))
    },
    [agents, showError]
  )

  // ---------------------------------------------------------------- Voice control
  const recorder = useRef<Recorder | null>(null)
  const voiceTarget = useRef<VoiceTarget | null>(null)

  const nextJobId = useRef(1)

  const updateJob = useCallback(
    (id: number, patch: Partial<VoiceJob>) =>
      setVoiceJobs((jobs) => jobs.map((j) => (j.id === id ? { ...j, ...patch } : j))),
    []
  )

  /**
   * Stops the recording immediately and continues processing it in the background (recognition,
   * routing via Claude if needed). The app stays usable, new recordings are possible right away.
   */
  const finishVoice = useCallback(async () => {
    const rec = recorder.current
    const target = voiceTarget.current
    recorder.current = null
    voiceTarget.current = null
    setRecording(null)
    if (!rec || !target) return

    const id = nextJobId.current++
    const targetName =
      target.kind === 'agent'
        ? (agents.find((a) => a.id === target.agentId)?.name ?? 'Agent')
        : 'Sprachbefehl'
    // Show the remembered language so it is visible that automatic detection is skipped
    const knownLanguage =
      settings.voiceFixedLanguage ??
      (settings.voiceRememberLanguage && canRememberLanguage(settings.voiceLanguage)
        ? settings.voiceLanguage
        : null)
    setVoiceJobs((jobs) => [
      ...jobs,
      {
        id,
        state: 'processing',
        target: targetName,
        language: knownLanguage ?? undefined,
        message: knownLanguage ? 'Wandle in Text um …' : 'Erkenne Sprache und Text …'
      }
    ])
    const fail = (message: string, text?: string): void =>
      updateJob(id, { state: 'error', message, text })

    try {
      const wav = await rec.stop()
      if (!wav) return fail('Aufnahme zu kurz.')
      const { text, language, remembered } = await window.api.voice.transcribe(wav)
      // Auto-detected → main may have remembered a new language; refresh the display
      if (!remembered) window.api.settings.get().then(setSettings)
      if (!text) return fail('Nichts verstanden.')
      if (language) updateJob(id, { language })

      if (target.kind === 'agent') {
        const sent = await window.api.agents.sendVoice(target.agentId, text)
        updateJob(id, { state: 'done', text, message: sent ? '→ gesendet' : '→ eingetragen' })
        return
      }

      updateJob(id, { text, message: 'Claude ordnet den Befehl zu …' })
      const result = await window.api.voice.command(text)
      if (result.kind === 'sent') {
        updateJob(id, {
          state: 'done',
          message: `→ an ${result.agentName} ${result.sent ? 'gesendet' : 'eingetragen'}`
        })
      } else if (result.kind === 'teamStarted') {
        // Show the grid with all team members
        const names = new Set(result.agentNames)
        const ids = (await window.api.agents.list())
          .filter((a) => names.has(a.name))
          .map((a) => a.id)
        if (ids.length) setSelection({ kind: 'agents', agentIds: ids })
        updateJob(id, {
          state: 'done',
          message: `${result.temporary ? 'Temporäres Team' : 'Team'} „${result.teamName}“ in „${result.projectName}“ gestartet: ${result.agentNames.join(', ')}${result.task ? ' (mit Aufgabe)' : ''}`
        })
      } else if (result.kind === 'started') {
        const started = (await window.api.agents.list()).find((a) => a.name === result.agentName)
        if (started) setSelection({ kind: 'agent', agentId: started.id })
        updateJob(id, {
          state: 'done',
          message: `${result.agentName} in „${result.projectName}“ gestartet${result.model ? ` (Modell ${result.model})` : ''}${result.task ? ' mit Aufgabe' : ''}`
        })
      } else {
        fail(result.message, text)
      }
    } catch (e) {
      fail(errorText(e))
    }
  }, [
    agents,
    updateJob,
    settings.voiceRememberLanguage,
    settings.voiceLanguage,
    settings.voiceFixedLanguage
  ])

  const cancelVoice = useCallback(() => {
    recorder.current?.cancel()
    recorder.current = null
    voiceTarget.current = null
    setRecording(null)
  }, [])

  const showVoiceError = useCallback((message: string) => {
    const id = nextJobId.current++
    setVoiceJobs((jobs) => [...jobs, { id, state: 'error', target: 'Sprache', message }])
  }, [])

  /** Starts recording, or stops it if a recording is already running. */
  const toggleVoice = useCallback(
    /** agentId: target agent (microphone on the agent); otherwise the active agent */
    async (kind: 'agent' | 'global', agentId?: string) => {
      if (recorder.current) return finishVoice()

      const status = await window.api.voice.status()
      setVoiceStatus(status)
      if (!status.activeModel) {
        setVoiceSetupOpen(true)
        return
      }

      let target: VoiceTarget
      let label: string
      if (kind === 'agent') {
        let agent = agents.find((a) => a.id === (agentId ?? activeAgentId))
        if (!agent) {
          setToast('Kein aktiver Agent ausgewählt.')
          return
        }
        // Team workers can only be observed → instruction goes to their orchestrator
        const watched = isTeamWorker(agent) ? agent : null
        if (watched) agent = teamLead(agents, watched.teamId!) ?? agent
        if (isTeamWorker(agent)) {
          setToast(`${agent.name} kann nur beobachtet werden – kein Orchestrator läuft.`)
          return
        }
        // Target stays the worker: main forwards the text to the orchestrator, referring to the worker
        target = { kind: 'agent', agentId: (watched ?? agent).id }
        label = watched
          ? `Anweisung an ${agent.name} (zu ${watched.name})`
          : `Anweisung an ${agent.name}`
      } else {
        target = { kind: 'global' }
        label =
          'z. B. „Agent 2, schreib Tests für den Login“ oder „Starte einen Agent für DevHub …“'
      }

      const rec = new Recorder()
      try {
        await rec.start()
      } catch (e) {
        showVoiceError(`Mikrofon nicht verfügbar: ${errorText(e)}`)
        return
      }
      recorder.current = rec
      voiceTarget.current = target
      setRecording({
        target: kind,
        agentId: target.kind === 'agent' ? target.agentId : undefined,
        label,
        startedAt: Date.now()
      })
    },
    [agents, activeAgentId, finishVoice, showVoiceError]
  )

  /**
   * Editor tab for an agent: already open → switch to it. Otherwise show the tab first so claude
   * redraws itself in the (narrower) terminal column, and only then send Ctrl+G –
   * while the editor is open, claude can no longer redraw (see terminals.ts).
   */
  const openEditor = useCallback(
    (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId)
      if (!agent) return
      if (agent.editing) return setEditorTab(agentId)
      if (isTeamWorker(agent)) {
        setToast(
          `${agent.name} kann nur beobachtet werden – Anweisungen gehen an den Orchestrator.`
        )
        return
      }
      clearTimeout(prepareTimers.current[agentId])
      // Capture the full-width view → the agents view shows it while the tab is open
      snapshotTerminal(agentId)
      setPreparing(agentId)
      setEditorTab(agentId)
      prepareTimers.current[agentId] = setTimeout(() => {
        sendEditorKey(agentId)
        // No editor? (e.g. an open question/dialog in the agent) → close the tab again
        prepareTimers.current[agentId] = setTimeout(() => {
          if (agentsRef.current.find((a) => a.id === agentId)?.editing) return
          dropSnapshot(agentId)
          setPreparing((p) => (p === agentId ? null : p))
          setToast(
            `${agent.name} hat den Editor nicht geöffnet – evtl. ist im Terminal gerade eine Auswahl offen.`
          )
        }, EDITOR_OPEN_TIMEOUT_MS)
      }, EDITOR_REDRAW_MS)
    },
    [agents]
  )

  // Hotkeys: agent recording + editor tab (in the app), global voice command (from the main process), Esc
  const agentHotkey = settings.hotkeyAgentVoice
  const editorHotkey = settings.hotkeyEditor
  // The terminal must not swallow these hotkeys
  useEffect(() => setAppHotkeys([agentHotkey, editorHotkey]), [agentHotkey, editorHotkey])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isCapturingHotkey()) return // hotkey is currently being reassigned in the settings
      if (matchesAccelerator(e, agentHotkey)) {
        e.preventDefault()
        e.stopPropagation()
        toggleVoice('agent')
      } else if (matchesAccelerator(e, editorHotkey)) {
        e.preventDefault()
        e.stopPropagation()
        // No effect inside the editor tab itself; otherwise for the active agent
        if (!activeEditor && activeAgentId) openEditor(activeAgentId)
      } else if (e.key === 'Escape' && recorder.current) {
        e.preventDefault()
        cancelVoice()
      }
    }
    window.addEventListener('keydown', onKey, true)
    const off = window.api.voice.onGlobalHotkey(() => toggleVoice('global'))
    return () => {
      window.removeEventListener('keydown', onKey, true)
      off()
    }
  }, [toggleVoice, cancelVoice, agentHotkey, editorHotkey, activeEditor, activeAgentId, openEditor])

  // Hide finished jobs after a few seconds
  const finishedJobIds = voiceJobs
    .filter((j) => j.state !== 'processing')
    .map((j) => j.id)
    .join(',')
  useEffect(() => {
    if (!finishedJobIds) return
    const ids = new Set(finishedJobIds.split(',').map(Number))
    const t = setTimeout(() => setVoiceJobs((jobs) => jobs.filter((j) => !ids.has(j.id))), 6000)
    return () => clearTimeout(t)
  }, [finishedJobIds])

  const recordingTarget = recording?.target ?? null
  const recordingAgentId = recording?.agentId ?? null

  /** `/clear` to an agent: clears its conversation (as if typed in the terminal) */
  const clearAgent = (id: string): void => {
    window.api.agents.sendLine(id, '/clear').catch(showError)
  }

  // ---------------------------------------------------------------- Render
  return (
    <>
      <div className={showCodePane ? 'layout with-code' : 'layout'}>
        <Sidebar
          projects={projects}
          agents={agents}
          selection={selection}
          vscodeInstalled={vscodeInstalled}
          globalVoiceActive={recordingTarget === 'global'}
          globalHotkey={settings.hotkeyGlobalVoice}
          onSelectProject={(id, multi) => {
            setEditorTab(null)
            setSelection(
              multi ? toggleProject(selection, id, agents) : { kind: 'project', projectId: id }
            )
          }}
          onSelectAgent={(id, multi) => {
            // Locked agent → back to its editor tab
            if (!multi && agents.find((a) => a.id === id)?.editing) return setEditorTab(id)
            setEditorTab(null)
            setSelection(
              multi ? toggleAgent(selection, id, agents) : { kind: 'agent', agentId: id }
            )
          }}
          templates={templates}
          teamTemplates={teamTemplates}
          teams={teams}
          onStartAgent={(id, templateId) => startAgent(id, undefined, templateId)}
          onStartTeam={startTeam}
          onStopTeam={stopTeam}
          onSelectTeam={(team, multi) => {
            setEditorTab(null)
            const ids = agents.filter((a) => a.teamId === team.id).map((a) => a.id)
            setSelection(
              multi ? toggleAgents(selection, ids, agents) : { kind: 'agents', agentIds: ids }
            )
          }}
          onStopAgent={stopAgent}
          onRenameAgent={(id, name) => window.api.agents.rename(id, name).catch(showError)}
          onAgentVoiceFor={(id) => toggleVoice('agent', id)}
          onClearAgent={clearAgent}
          recordingAgentId={recordingAgentId}
          onEditPrompt={openEditor}
          editorHotkey={editorHotkey}
          onReorderProjects={(ids) => {
            // show immediately, then take over the saved list
            setProjects((list) => ids.map((id) => list.find((p) => p.id === id)!).filter(Boolean))
            window.api.projects.reorder(ids).then(setProjects).catch(showError)
          }}
          onReorderAgents={(ids) => window.api.agents.reorder(ids).catch(showError)}
          globalVoiceAutoSend={settings.voiceAutoSend}
          onSetVoiceAutoSend={(id, value) =>
            window.api.agents.setVoiceAutoSend(id, value).catch(showError)
          }
          onAddProject={() => setProjectDialog({ project: null })}
          onImportProjects={() => setImportOpen(true)}
          onEditProject={(p) => setProjectDialog({ project: p })}
          onRemoveProject={removeProject}
          onOpenProjectFile={(p) => window.api.projects.openProjectFile(p.id).catch(showError)}
          globalProjectFileApp={settings.projectFileApp}
          globalFolderApp={settings.folderApp}
          onOpenFolder={(p) => window.api.projects.openFolder(p.id).catch(showError)}
          onGlobalVoice={() => toggleVoice('global')}
          onOpenSettings={() => {
            refreshVoice()
            // remembered language is updated in main → reload
            window.api.settings.get().then(setSettings)
            setSettingsOpen(true)
          }}
        />
        <div className="center-column">
          {tabAgents.length > 0 && (
            <nav className="center-tabs">
              <button
                className={`center-tab ${activeEditor ? '' : 'active'}`}
                onClick={() => setEditorTab(null)}
              >
                <GridIcon size={12} /> Agents
              </button>
              {tabAgents.map((a) => (
                <div
                  key={a.id}
                  className={`center-tab ${activeEditor?.id === a.id ? 'active' : ''}`}
                  onClick={() => setEditorTab(a.id)}
                  title={`Anweisung für ${a.name} – der Agent ist gesperrt, bis der Tab geschlossen wird`}
                >
                  <EditIcon size={12} /> {a.name}
                  <button
                    className="icon"
                    title="Schließen – Text in den Prompt übernehmen, ohne abzuschicken"
                    onClick={(e) => {
                      e.stopPropagation()
                      finishEditor(a.id, drafts[a.id] ?? null, false)
                    }}
                  >
                    <CloseIcon size={10} />
                  </button>
                </div>
              ))}
            </nav>
          )}
          {activeEditor ? (
            <EditorTab
              key={activeEditor.id}
              agent={activeEditor}
              projectName={projects.find((p) => p.id === activeEditor.projectId)?.name}
              draft={drafts[activeEditor.id] ?? ''}
              onDraftChange={(text) => setDrafts((d) => ({ ...d, [activeEditor.id]: text }))}
              onFinish={(text, submit) => finishEditor(activeEditor.id, text, submit)}
              onError={showError}
            />
          ) : (
            <CenterPane
              selection={selection}
              projects={projects}
              agents={agents}
              activeAgentId={activeAgentId}
              agentVoiceActive={recordingTarget === 'agent'}
              agentHotkey={agentHotkey}
              onActivate={(id) =>
                setSelection((s) =>
                  s?.kind === 'project' || s?.kind === 'agents' ? { ...s, activeAgentId: id } : s
                )
              }
              onOpenAgent={(id) => setSelection({ kind: 'agent', agentId: id })}
              onStartAgent={(id) => startAgent(id)}
              onStopAgent={stopAgent}
              onAgentVoice={() => toggleVoice('agent')}
              onAgentVoiceFor={(id) => toggleVoice('agent', id)}
              onClearAgent={clearAgent}
              recordingAgentId={recordingAgentId}
              onOpenEditor={setEditorTab}
              onEditPrompt={openEditor}
              editorHotkey={editorHotkey}
            />
          )}
        </div>
        {showCodePane && (
          <CodePane
            focus={codeFocus}
            snippets={activeSnippets}
            edits={activeEdits}
            agentName={agents.find((a) => a.id === codeFocus?.agentId)?.name}
            editsAgentName={agents.find((a) => a.id === activeAgentId)?.name}
            vscodeInstalled={vscodeInstalled}
            snippetsKey={snippetsTabKey(activeAgentId ?? '')}
            onCloseTab={(key, at) => setClosedTabs((c) => ({ ...c, [key]: at }))}
          />
        )}
      </div>

      <VoiceOverlay
        recording={recording}
        jobs={voiceJobs}
        onStop={finishVoice}
        onCancel={cancelVoice}
        onDismiss={(id) => setVoiceJobs((jobs) => jobs.filter((j) => j.id !== id))}
      />

      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}

      {importOpen && (
        <ImportProjectsDialog
          onClose={() => setImportOpen(false)}
          onImported={async (added) => {
            setProjects(await window.api.projects.list())
            if (added.length) setToast(`${added.length} Projekt(e) importiert.`)
          }}
        />
      )}
      {projectDialog && (
        <ProjectDialog
          project={projectDialog.project}
          vscodeInstalled={vscodeInstalled}
          globalProjectFileApp={settings.projectFileApp}
          globalFolderApp={settings.folderApp}
          onClose={() => setProjectDialog(null)}
          onSaved={async (p) => {
            setProjectDialog(null)
            setProjects(await window.api.projects.list())
            setSelection({ kind: 'project', projectId: p.id })
          }}
        />
      )}

      {/* Template dialog replaces the settings while it is open (no stacked modals) */}
      {teamDialog && (
        <TeamTemplateDialog
          team={teamDialog.team}
          templates={templates}
          onClose={() => setTeamDialog(null)}
          onSaved={async () => {
            setTeamDialog(null)
            setTeamTemplates(await window.api.teamTemplates.list())
          }}
        />
      )}

      {templateDialog && (
        <AgentTemplateDialog
          template={templateDialog.template}
          onClose={() => setTemplateDialog(null)}
          onSaved={async () => {
            setTemplateDialog(null)
            setTemplates(await window.api.templates.list())
          }}
        />
      )}

      {settingsOpen && !templateDialog && !teamDialog && voiceStatus && (
        <SettingsDialog
          settings={settings}
          voiceStatus={voiceStatus}
          vscodeInstalled={vscodeInstalled}
          templates={templates}
          onEditTemplate={(template) => setTemplateDialog({ template })}
          onRemoveTemplate={async (t) => {
            await window.api.templates.remove(t.id).catch(showError)
            setTemplates(await window.api.templates.list())
          }}
          teamTemplates={teamTemplates}
          onEditTeam={(team) => setTeamDialog({ team })}
          onRemoveTeam={async (t) => {
            await window.api.teamTemplates.remove(t.id).catch(showError)
            setTeamTemplates(await window.api.teamTemplates.list())
          }}
          onSettingsChanged={setSettings}
          onVoiceChanged={refreshVoice}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {voiceSetupOpen && voiceStatus && (
        <VoiceSetupDialog
          status={voiceStatus}
          onChanged={refreshVoice}
          onReady={() => {
            setVoiceSetupOpen(false)
            setToast('Sprachsteuerung ist bereit.')
          }}
          onClose={() => setVoiceSetupOpen(false)}
        />
      )}
    </>
  )
}

export default Workspace
