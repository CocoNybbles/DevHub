import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Agent,
  AgentTemplate,
  CodeFocus,
  Project,
  Settings,
  Team,
  TeamTemplate,
  VoiceStatus
} from '../../shared/types'
import type { Selection } from './App'
import Sidebar from './components/Sidebar'
import CenterPane from './components/CenterPane'
import CodePane from './components/CodePane'
import ProjectDialog from './components/ProjectDialog'
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
  setAppHotkeys,
  terminalIds,
  writeToTerminal
} from './lib/terminals'
import { Recorder } from './lib/recorder'
import { errorText } from './lib/errors'
import { shownAgentIds, toggleAgent, toggleAgents, toggleProject } from './lib/selection'

type VoiceTarget = { kind: 'agent'; agentId: string } | { kind: 'global' }

function Workspace(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [rawSelection, setSelection] = useState<Selection>(null)
  /** Gespeicherte Ansicht ist geladen → Änderungen dürfen gespeichert werden */
  const viewLoaded = useRef(false)
  const [focusByAgent, setFocusByAgent] = useState<Record<string, CodeFocus>>({})
  const [vscodeInstalled, setVscodeInstalled] = useState(false)
  const [settings, setSettings] = useState<Settings>({
    voiceModel: null,
    voiceAutoSend: true,
    hotkeyAgentVoice: DEFAULT_HOTKEYS.agentVoice,
    hotkeyGlobalVoice: DEFAULT_HOTKEYS.globalVoice,
    agentArgs: '',
    projectFileApp: '',
    folderApp: '',
    voiceRememberLanguage: true,
    voiceLanguage: null
  })
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [projectDialog, setProjectDialog] = useState<{ project: Project | null } | null>(null)
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
  const activeAgentId = useMemo(() => {
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
  }, [selection, agents])

  /** Code-Ansicht: Fokus des aktiven Agents, sonst jüngster Fokus im ausgewählten Projekt. */
  const codeFocus = useMemo(() => {
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
      if (!confirm(`„${agent.name}“ beenden?`)) return
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
    const knownLanguage = settings.voiceRememberLanguage ? settings.voiceLanguage : null
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
  }, [agents, updateJob, settings.voiceRememberLanguage, settings.voiceLanguage])

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
    async (kind: 'agent' | 'global') => {
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
        const agent = agents.find((a) => a.id === activeAgentId)
        if (!agent) {
          setToast('Kein aktiver Agent ausgewählt.')
          return
        }
        target = { kind: 'agent', agentId: agent.id }
        label = `Anweisung an ${agent.name}`
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
      setRecording({ target: kind, label, startedAt: Date.now() })
    },
    [agents, activeAgentId, finishVoice, showVoiceError]
  )

  // Hotkeys: Agent-Aufnahme (in der App), globaler Sprachbefehl (vom Hauptprozess), Esc
  const agentHotkey = settings.hotkeyAgentVoice
  useEffect(() => setAppHotkeys([agentHotkey]), [agentHotkey])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isCapturingHotkey()) return // Kürzel wird gerade in den Einstellungen neu belegt
      if (matchesAccelerator(e, agentHotkey)) {
        e.preventDefault()
        e.stopPropagation()
        toggleVoice('agent')
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
  }, [toggleVoice, cancelVoice, agentHotkey])

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

  // ---------------------------------------------------------------- Render
  return (
    <>
      <div className={codeFocus ? 'layout with-code' : 'layout'}>
        <Sidebar
          projects={projects}
          agents={agents}
          selection={selection}
          vscodeInstalled={vscodeInstalled}
          globalVoiceActive={recordingTarget === 'global'}
          globalHotkey={settings.hotkeyGlobalVoice}
          onSelectProject={(id, multi) =>
            setSelection(
              multi ? toggleProject(selection, id, agents) : { kind: 'project', projectId: id }
            )
          }
          onSelectAgent={(id, multi) =>
            setSelection(
              multi ? toggleAgent(selection, id, agents) : { kind: 'agent', agentId: id }
            )
          }
          templates={templates}
          teamTemplates={teamTemplates}
          teams={teams}
          onStartAgent={(id, templateId) => startAgent(id, undefined, templateId)}
          onStartTeam={startTeam}
          onStopTeam={stopTeam}
          onSelectTeam={(team, multi) => {
            const ids = agents.filter((a) => a.teamId === team.id).map((a) => a.id)
            setSelection(
              multi ? toggleAgents(selection, ids, agents) : { kind: 'agents', agentIds: ids }
            )
          }}
          onStopAgent={stopAgent}
          onRenameAgent={(id, name) => window.api.agents.rename(id, name).catch(showError)}
          globalVoiceAutoSend={settings.voiceAutoSend}
          onSetVoiceAutoSend={(id, value) =>
            window.api.agents.setVoiceAutoSend(id, value).catch(showError)
          }
          onAddProject={() => setProjectDialog({ project: null })}
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
        />
        {codeFocus && (
          <CodePane
            focus={codeFocus}
            agentName={agents.find((a) => a.id === codeFocus.agentId)?.name}
            vscodeInstalled={vscodeInstalled}
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
