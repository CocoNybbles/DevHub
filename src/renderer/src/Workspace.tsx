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

/** Zeit für claude, sich nach dem Umhängen in den Editor-Tab in neuer Größe zu zeichnen */
const EDITOR_REDRAW_MS = 400
/** Öffnet claude danach so lange keinen Editor, wird der Tab wieder geschlossen */
const EDITOR_OPEN_TIMEOUT_MS = 4000

function Workspace(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [rawSelection, setSelection] = useState<Selection>(null)
  /** Gespeicherte Ansicht ist geladen → Änderungen dürfen gespeichert werden */
  const viewLoaded = useRef(false)
  const [focusByAgent, setFocusByAgent] = useState<Record<string, CodeFocus>>({})
  /** Code-Blöcke aus den Antworten je Agent (neueste zuerst) */
  const [snippetsByAgent, setSnippetsByAgent] = useState<Record<string, CodeSnippet[]>>({})
  /** Vom Agent bearbeitete Dateien (rechts je ein Reiter) */
  const [editsByAgent, setEditsByAgent] = useState<Record<string, EditedFile[]>>({})
  /** Strg+G-Editor-Tabs: gewählter Tab in der Mitte (Agent-Id, null = Agents-Ansicht) + Entwürfe */
  const [editorTab, setEditorTab] = useState<string | null>(null)
  /** Tab wird geöffnet, claude hat den Editor aber noch nicht gestartet (s. openEditor) */
  const [preparing, setPreparing] = useState<string | null>(null)
  const prepareTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  /** Aktuelle Agents für Timer-Rückrufe */
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
  /** Vorlage bearbeiten (template null = neu); öffnet sich aus den Einstellungen heraus */
  const [templateDialog, setTemplateDialog] = useState<{ template: AgentTemplate | null } | null>(
    null
  )
  const [teamTemplates, setTeamTemplates] = useState<TeamTemplate[]>([])
  const [teamDialog, setTeamDialog] = useState<{ team: TeamTemplate | null } | null>(null)
  /** Laufende Teams */
  const [teams, setTeams] = useState<Team[]>([])
  const [voiceSetupOpen, setVoiceSetupOpen] = useState(false)
  const [recording, setRecording] = useState<VoiceRecording | null>(null)
  const [voiceJobs, setVoiceJobs] = useState<VoiceJob[]>([])

  const showError = useCallback((e: unknown) => setToast(errorText(e)), [])
  const refreshVoice = useCallback(() => window.api.voice.status().then(setVoiceStatus), [])

  // ---------------------------------------------------------------- Laden & Ereignisse
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
    // Strg+G im Agent → Editor-Tab öffnen und dorthin wechseln
    const offEditorOpened = window.api.editor.onOpened((id, text) => {
      // Sofort sperren, bevor der Tab das Terminal in einen anderen Container hängt
      // (sonst ändert sich die Größe, und claude kann gerade nicht neu zeichnen)
      setTerminalLocked(id, true)
      setDrafts((d) => ({ ...d, [id]: text }))
      setEditorTab(id)
    })
    // Sprachtext für einen gesperrten Agent landet im Entwurf
    const offEditorAppend = window.api.editor.onAppend((id, text) =>
      setDrafts((d) => ({ ...d, [id]: appendToDraft(d[id] ?? '', text) }))
    )
    // Nach Neuladen der Oberfläche: bisher gesammelte Snippets der laufenden Agents
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
        // Oberfläche wurde neu geladen, Agents laufen noch → bisherige Ausgabe nachladen
        for (const a of running) {
          if (!hasTerminal(a.id)) writeToTerminal(a.id, await window.api.agents.buffer(a.id))
          // Offene Editor-Tabs wieder anzeigen
          if (a.editing) {
            const text = await window.api.editor.text(a.id)
            if (text !== null) setDrafts((d) => ({ ...d, [a.id]: d[a.id] ?? text }))
          }
        }
        setAgents(running)
      } else {
        // Frischer App-Start → Agents der letzten Sitzung wiederherstellen
        await window.api.agents.restore().catch(showError)
      }

      // Zuletzt gezeigte Ansicht wiederherstellen (nicht mehr laufende Agents fallen über
      // `selection` weg), sonst das erste Projekt mit Agents (Raster)
      const [agentsNow, savedView] = await Promise.all([
        window.api.agents.list(),
        window.api.view.get().catch(() => null)
      ])
      // Agents im selben Render-Durchlauf setzen, sonst verwirft `selection` die Ansicht
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

  // Beendete Agents: Terminal freigeben
  useEffect(() => {
    const ids = new Set(agents.map((a) => a.id))
    for (const id of terminalIds()) if (!ids.has(id)) disposeTerminal(id)
  }, [agents])

  // Auswahl auf noch laufende Agents/Projekte beschränken → Ansicht eines beendeten Agents schließt sich
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

  // Ansicht speichern – erst nachdem die gespeicherte geladen wurde (sonst überschreibt der Startwert sie)
  useEffect(() => {
    if (viewLoaded.current) window.api.view.set(selection).catch(() => {})
  }, [selection])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.length > 120 ? 15000 : 6000)
    return () => clearTimeout(t)
  }, [toast])

  // ---------------------------------------------------------------- Abgeleitete Werte
  /** Agents, deren Anweisung gerade in einem Editor-Tab geschrieben wird (gesperrt) */
  /** Tabs: gesperrte Agents + ggf. ein Tab, der sich gerade öffnet (`preparing`) */
  const tabAgents = useMemo(
    () => agents.filter((a) => a.editing || a.id === preparing),
    [agents, preparing]
  )
  /** Sichtbarer Editor-Tab (null = Agents-Ansicht); geschlossene Tabs fallen weg */
  const activeEditor = tabAgents.find((a) => a.id === editorTab) ?? null

  const activeAgentId = useMemo(() => {
    // Im Editor-Tab: Sprach-Kürzel diktiert in diesen Entwurf
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

  // Terminals gesperrter Agents nehmen keine Eingaben an
  useEffect(() => {
    agentsRef.current = agents
    for (const a of agents) {
      setTerminalReadOnly(a.id, isTeamWorker(a)) // Team-Worker: nur beobachten
      setTerminalLocked(a.id, !!a.editing)
    }
  }, [agents])

  /** Editor-Tab schließen und den Text an claude zurückgeben */
  const finishEditor = useCallback(
    (agentId: string, text: string | null, submit: boolean) => {
      // Tab war noch im Aufbau (Editor nicht offen) → nur abbrechen
      clearTimeout(prepareTimers.current[agentId])
      setPreparing((p) => (p === agentId ? null : p))
      dropSnapshot(agentId) // Agents-Ansicht zeigt wieder das live-Terminal
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

  /** Vom Nutzer geschlossene Reiter rechts (bis neuere Inhalte kommen) */
  const [closedTabs, setClosedTabs] = useState<ClosedTabs>({})

  /** Code-Ansicht: Fokus des aktiven Agents, sonst jüngster Fokus im ausgewählten Projekt. */
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

  /** Snippets des aktiven Agents (rechts, Reiter „Snippets“) – leer, solange der Reiter zu ist */
  const activeSnippets = useMemo(() => {
    const list = activeAgentId ? (snippetsByAgent[activeAgentId] ?? []) : []
    if (!activeAgentId || !list.length) return list
    return isTabClosed(closedTabs, snippetsTabKey(activeAgentId), list[0].at) ? [] : list
  }, [activeAgentId, snippetsByAgent, closedTabs])
  /** Vom aktiven Agent bearbeitete Dateien (rechts, je ein Reiter), ohne geschlossene */
  const activeEdits = useMemo(
    () =>
      activeAgentId && settings.showEditedFiles
        ? (editsByAgent[activeAgentId] ?? []).filter(
            (e) => !isTabClosed(closedTabs, fileTabKey(e.filePath), e.at)
          )
        : [],
    [activeAgentId, editsByAgent, settings.showEditedFiles, closedTabs]
  )
  // Spalte nur, solange ein Reiter offen ist – alle geschlossen → Spalte zu
  const showCodePane = !!codeFocus || activeSnippets.length > 0 || activeEdits.length > 0

  // ---------------------------------------------------------------- Aktionen
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

  /** Team aus einer Team-Vorlage starten und alle Mitglieder im Raster zeigen. */
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

  // ---------------------------------------------------------------- Sprachsteuerung
  const recorder = useRef<Recorder | null>(null)
  const voiceTarget = useRef<VoiceTarget | null>(null)

  const nextJobId = useRef(1)

  const updateJob = useCallback(
    (id: number, patch: Partial<VoiceJob>) =>
      setVoiceJobs((jobs) => jobs.map((j) => (j.id === id ? { ...j, ...patch } : j))),
    []
  )

  /**
   * Beendet die Aufnahme sofort und verarbeitet sie im Hintergrund weiter (Erkennung,
   * ggf. Zuordnung per Claude). Die App bleibt bedienbar, neue Aufnahmen sind sofort möglich.
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
    // Gemerkte Sprache anzeigen, damit sichtbar ist, dass die automatische Erkennung entfällt
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
      // Automatisch erkannt → Main hat ggf. eine neue Sprache gemerkt; Anzeige aktualisieren
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
        // Raster mit allen Teammitgliedern zeigen
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

  /** Startet die Aufnahme bzw. beendet sie, wenn bereits aufgenommen wird. */
  const toggleVoice = useCallback(
    /** agentId: Ziel-Agent (Mikrofon am Agent); sonst der aktive Agent */
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
        // Team-Worker sind nur beobachtbar → Anweisung an ihren Orchestrator
        const watched = isTeamWorker(agent) ? agent : null
        if (watched) agent = teamLead(agents, watched.teamId!) ?? agent
        if (isTeamWorker(agent)) {
          setToast(`${agent.name} kann nur beobachtet werden – kein Orchestrator läuft.`)
          return
        }
        // Ziel bleibt der Worker: Main reicht den Text mit Bezug auf ihn an den Orchestrator weiter
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
   * Editor-Tab für einen Agent: offen → hinwechseln. Sonst zuerst den Tab zeigen, damit claude
   * sich in der (schmaleren) Terminal-Spalte neu zeichnet, und erst dann Strg+G schicken –
   * während der Editor offen ist, kann claude nicht mehr neu zeichnen (s. terminals.ts).
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
      // Ansicht in voller Breite festhalten → Agents-Ansicht zeigt sie, solange der Tab offen ist
      snapshotTerminal(agentId)
      setPreparing(agentId)
      setEditorTab(agentId)
      prepareTimers.current[agentId] = setTimeout(() => {
        sendEditorKey(agentId)
        // Kein Editor? (z. B. offene Rückfrage/Dialog im Agent) → Tab wieder schließen
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

  // Hotkeys: Agent-Aufnahme + Editor-Tab (in der App), globaler Sprachbefehl (vom Hauptprozess), Esc
  const agentHotkey = settings.hotkeyAgentVoice
  const editorHotkey = settings.hotkeyEditor
  // Terminal soll diese Kürzel nicht verschlucken
  useEffect(() => setAppHotkeys([agentHotkey, editorHotkey]), [agentHotkey, editorHotkey])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isCapturingHotkey()) return // Kürzel wird gerade in den Einstellungen neu belegt
      if (matchesAccelerator(e, agentHotkey)) {
        e.preventDefault()
        e.stopPropagation()
        toggleVoice('agent')
      } else if (matchesAccelerator(e, editorHotkey)) {
        e.preventDefault()
        e.stopPropagation()
        // Im Editor-Tab selbst ohne Wirkung; sonst für den aktiven Agent
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

  // Abgeschlossene Aufträge nach einigen Sekunden ausblenden
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

  /** `/clear` an einen Agent: leert seine Unterhaltung (wie im Terminal getippt) */
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
            // Gesperrter Agent → zurück in seinen Editor-Tab
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
            // sofort anzeigen, dann gespeicherte Liste übernehmen
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
            // gemerkte Sprache wird im Main aktualisiert → frisch laden
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

      {/* Vorlagen-Dialog ersetzt die Einstellungen, solange er offen ist (keine gestapelten Modals) */}
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
