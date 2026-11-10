import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Agent, CodeFocus, Project, Settings, VoiceStatus } from '../../shared/types'
import type { Selection } from './App'
import Sidebar from './components/Sidebar'
import CenterPane from './components/CenterPane'
import CodePane from './components/CodePane'
import ProjectDialog from './components/ProjectDialog'
import SettingsDialog from './components/SettingsDialog'
import VoiceSetupDialog from './components/VoiceSetupDialog'
import VoiceOverlay, { VoiceUi } from './components/VoiceOverlay'
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

type VoiceTarget = { kind: 'agent'; agentId: string } | { kind: 'global' }

function Workspace(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [rawSelection, setSelection] = useState<Selection>(null)
  const [focusByAgent, setFocusByAgent] = useState<Record<string, CodeFocus>>({})
  const [vscodeInstalled, setVscodeInstalled] = useState(false)
  const [settings, setSettings] = useState<Settings>({
    voiceModel: null,
    voiceAutoSend: true,
    hotkeyAgentVoice: DEFAULT_HOTKEYS.agentVoice,
    hotkeyGlobalVoice: DEFAULT_HOTKEYS.globalVoice
  })
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [projectDialog, setProjectDialog] = useState<{ project: Project | null } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [voiceSetupOpen, setVoiceSetupOpen] = useState(false)
  const [voiceUi, setVoiceUi] = useState<VoiceUi>({ mode: 'idle' })

  const showError = useCallback((e: unknown) => setToast(errorText(e)), [])
  const refreshVoice = useCallback(() => window.api.voice.status().then(setVoiceStatus), [])

  // ---------------------------------------------------------------- Laden & Ereignisse
  useEffect(() => {
    const offData = window.api.agents.onData((id, data) => writeToTerminal(id, data))
    const offChanged = window.api.agents.onChanged(setAgents)
    const offFocus = window.api.code.onFocus((f) =>
      setFocusByAgent((m) => ({ ...m, [f.agentId]: f }))
    )

    ;(async () => {
      setProjects(await window.api.projects.list())
      window.api.tools.vscodeInstalled().then(setVscodeInstalled)
      window.api.settings.get().then(setSettings)
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

      // Erstes Projekt mit Agents anzeigen (Raster), sofern noch nichts gewählt ist
      const agentsNow = await window.api.agents.list()
      const first = agentsNow[0]?.projectId
      if (first) setSelection((s) => s ?? { kind: 'project', projectId: first })
    })()

    return () => {
      offData()
      offChanged()
      offFocus()
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
    return sel
  }, [rawSelection, agents, projects])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
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
    return null
  }, [selection, agents])

  /** Code-Ansicht: Fokus des aktiven Agents, sonst jüngster Fokus im ausgewählten Projekt. */
  const codeFocus = useMemo(() => {
    if (activeAgentId && focusByAgent[activeAgentId]) return focusByAgent[activeAgentId]
    if (selection?.kind === 'project') {
      const ids = new Set(
        agents.filter((a) => a.projectId === selection.projectId).map((a) => a.id)
      )
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
    async (projectId: string, task?: string) => {
      try {
        const agent = await window.api.agents.start(projectId, task)
        setSelection({ kind: 'agent', agentId: agent.id })
        return agent
      } catch (e) {
        showError(e)
        return null
      }
    },
    [showError]
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

  const finishVoice = useCallback(async () => {
    const rec = recorder.current
    const target = voiceTarget.current
    recorder.current = null
    if (!rec || !target) return

    const wav = await rec.stop()
    if (!wav) {
      setVoiceUi({ mode: 'result', message: 'Aufnahme zu kurz.', error: true })
      return
    }
    try {
      setVoiceUi({ mode: 'processing', label: 'Erkenne Sprache …' })
      const text = await window.api.voice.transcribe(wav)
      if (!text) {
        setVoiceUi({ mode: 'result', message: 'Nichts verstanden.', error: true })
        return
      }

      if (target.kind === 'agent') {
        const agent = agents.find((a) => a.id === target.agentId)
        if (!agent) throw new Error('Agent läuft nicht mehr')
        if (settings.voiceAutoSend) await window.api.agents.sendLine(agent.id, text)
        else window.api.agents.write(agent.id, text)
        setVoiceUi({
          mode: 'result',
          text,
          message: settings.voiceAutoSend
            ? `→ an ${agent.name} gesendet`
            : `→ bei ${agent.name} eingetragen`
        })
        return
      }

      setVoiceUi({ mode: 'processing', label: 'Claude ordnet den Befehl zu …', text })
      const result = await window.api.voice.command(text)
      if (result.kind === 'sent') {
        setVoiceUi({ mode: 'result', text, message: `→ an ${result.agentName} gesendet` })
      } else if (result.kind === 'started') {
        const started = (await window.api.agents.list()).find((a) => a.name === result.agentName)
        if (started) setSelection({ kind: 'agent', agentId: started.id })
        setVoiceUi({
          mode: 'result',
          text,
          message: `${result.agentName} in „${result.projectName}“ gestartet${result.task ? ' mit Aufgabe' : ''}`
        })
      } else {
        setVoiceUi({ mode: 'result', text, message: result.message, error: true })
      }
    } catch (e) {
      setVoiceUi({ mode: 'result', message: errorText(e), error: true })
    }
  }, [agents, settings.voiceAutoSend])

  const cancelVoice = useCallback(() => {
    recorder.current?.cancel()
    recorder.current = null
    setVoiceUi({ mode: 'idle' })
  }, [])

  /** Startet die Aufnahme bzw. beendet sie, wenn bereits aufgenommen wird. */
  const toggleVoice = useCallback(
    async (kind: 'agent' | 'global') => {
      if (recorder.current) return finishVoice()
      if (voiceUi.mode === 'processing') return

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
        setVoiceUi({
          mode: 'result',
          message: `Mikrofon nicht verfügbar: ${errorText(e)}`,
          error: true
        })
        return
      }
      recorder.current = rec
      voiceTarget.current = target
      setVoiceUi({ mode: 'recording', target: kind, label, startedAt: Date.now() })
    },
    [agents, activeAgentId, finishVoice, voiceUi.mode]
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

  // Ergebnis-Anzeige nach einigen Sekunden ausblenden
  useEffect(() => {
    if (voiceUi.mode !== 'result') return
    const t = setTimeout(() => setVoiceUi({ mode: 'idle' }), 6000)
    return () => clearTimeout(t)
  }, [voiceUi])

  const recordingTarget = voiceUi.mode === 'recording' ? voiceUi.target : null

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
          onSelectProject={(id) => setSelection({ kind: 'project', projectId: id })}
          onSelectAgent={(id) => setSelection({ kind: 'agent', agentId: id })}
          onStartAgent={(id) => startAgent(id)}
          onStopAgent={stopAgent}
          onRenameAgent={(id, name) => window.api.agents.rename(id, name).catch(showError)}
          onAddProject={() => setProjectDialog({ project: null })}
          onEditProject={(p) => setProjectDialog({ project: p })}
          onRemoveProject={removeProject}
          onOpenProjectFile={(p) => window.api.projects.openProjectFile(p.id).catch(showError)}
          onOpenVSCode={(p) => window.api.projects.openInVSCode(p.id).catch(showError)}
          onGlobalVoice={() => toggleVoice('global')}
          onOpenSettings={() => {
            refreshVoice()
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
            setSelection((s) => (s?.kind === 'project' ? { ...s, activeAgentId: id } : s))
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
        ui={voiceUi}
        onStop={finishVoice}
        onCancel={cancelVoice}
        onDismiss={() => setVoiceUi({ mode: 'idle' })}
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
          onClose={() => setProjectDialog(null)}
          onSaved={async (p) => {
            setProjectDialog(null)
            setProjects(await window.api.projects.list())
            setSelection({ kind: 'project', projectId: p.id })
          }}
        />
      )}

      {settingsOpen && voiceStatus && (
        <SettingsDialog
          settings={settings}
          voiceStatus={voiceStatus}
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
