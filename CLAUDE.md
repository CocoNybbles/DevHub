# DevHub

> **Maintenance rule (always follow):** This file is kept up to date continuously while working.
> After every relevant change (new tech stack, new commands, folder structure, architecture decisions,
> conventions, setup steps, known pitfalls) CLAUDE.md is adjusted in the same work step.
> Outdated statements are removed instead of amended. Keep it short and precise.

## Project overview

Local Windows desktop app for managing projects and the AI coding agents (Claude Code) running in them.

### Requirements

**Projects**

- Register projects (folders), 3 paths per project:
  1. Agent path: working directory in which Claude / other AI coding engines are started. Folder picker without a preset (new project) starts at the last used location (`state.lastPickDir` = parent folder of the last choice, persisted)
  2. Project file: `.sln` / project file, can be opened e.g. with Visual Studio — searched automatically after the agent folder is chosen (`findSolution` in `main/tools.ts`: `.sln`/`.slnx`, up to 3 levels deep, shallowest first, name = folder name preferred; never overwrites a file set by hand)
     Open with: `project.projectFileApp` → global `settings.projectFileApp` → Windows default program (`shell.openPath`). Neutral icon (`OpenFileIcon`), not VS-specific.
  3. Folder (`folderPath`, formerly `vscodePath` – `getState()` migrates old states): always configurable. Open with: `project.folderApp` → global `settings.folderApp` → VS Code (if installed) → Windows Explorer
  - Programs = absolute path to `.exe`/`.cmd`/`.bat` (`validateProgram`/`openWithProgram` in `main/tools.ts`, started detached, cwd = the folder or the file's folder), entered via `ProgramInput`, settings section "Open with" („Öffnen mit“)
- **Import** (button to the right of "+", `ImportProjectsDialog`): folder picker with multi-selection (`projects:pickFolders`, Ctrl+click) → `projects:scan` → `findProjects` in `main/tools.ts`: a folder with a marker (Git, .sln/.slnx, .csproj …, package.json, pyproject.toml, Cargo.toml, go.mod, pom.xml/build.gradle, CMakeLists.txt, CLAUDE.md) = **one** project (no further descent, a monorepo stays one), otherwise subfolders up to 3 levels (max. 300 hits). `findSolution` per hit; already registered ones (same agent path) are greyed out. List with checkboxes + editable name, start flags apply to all; saved via `projects:save` with agent path = folder = path 3. Tested with `C:\Dev` (6 projects incl. subfolders)
  - Exception: "Open in VS Code" in the code view (`code:openInVSCode`, jumps to the line) stays VS Code-specific

**Layout**

- Left: list of all projects with their agents
  - Small button next to the project name starts a new agent
  - Agents are called "Agent 1", "Agent 2", … by default — context menu (right-click): rename, stop, send/insert voice text (per agent)
  - Agents that need an answer/input are highlighted until they continue working — on the left in the list and in the grid (yellow border + question in the cell header, `.grid-cell.attention`; active + waiting = yellow border with accent line below the header)
  - Agents can be stopped via the list
  - Agent buttons on the left in the row **✎ · 🎤 · eraser · ✕** (only on hover, `display: none` → otherwise the name has the full width; a running recording stays visible; tightly packed via the container `.agent-actions`, 20 px per button), in every agent header in the center **🎤 · eraser · ✕** (✎ only in the single view) (single view + grid cell, `AgentButtons` in `CenterPane`): voice instruction to exactly this agent (`toggleVoice('agent', id)`, `recording.agentId` → only its microphone is red), `/clear` via `sendLine` (checked with real claude: the context is gone afterwards), stop
  - **Sorting:** projects by drag & drop + button "A→Z" in the header (`localeCompare` with `numeric`); agents by drag & drop only within their group (project without team, or team), plus right-click "… sort by name". Order = order of the arrays `state.projects`/`state.agents` (`projects:reorder`, `agents:reorder` → `applyOrder` in `store.ts`, reorders only the ids passed in); `AgentManager.list()` returns them in this order (also applies to the grid)
- Center: terminal of the selected agent (`claude.exe` directly via ConPTY, **without** a shell in between – this way `/exit` really ends the agent)
  - Click on a project → all agents of the project in a grid
  - **Ctrl+click** (across projects): add/remove an agent to/from the grid; on a project = all its agents. Starting point is the current view (also a project grid). Selection type `{ kind: 'agents', agentIds }`, logic in `lib/selection.ts`; 1 agent → single view, 0 → empty
  - If an agent ends itself in the terminal (e.g. `/exit`), the view is closed and the entry on the left removed
  - **Ctrl+G** in the agent opens another tab in the center instead of an external editor (terminal + text field with dictation and images); until it is closed the agent is locked everywhere else (see Architecture)
- Right: code view (`CodePane`) with tabs (tab bar scrolls horizontally)
  - **One tab per file:** every file edited by the **active** agent (Edit/Write/MultiEdit; dot in the tab, green = newly created), changed lines of the last change highlighted. Plus the file from `show_code` (analysis/bug found; focus of the active agent / most recent one in the selected project) – same file = one tab, the newer information wins. ✕/middle click closes the tab until the file is changed again ("Snippets" can be closed too, until a new snippet arrives). Closed tabs are kept in the Workspace (`closedTabs`, `lib/codeTabs.ts`), which filters them out before `CodePane` → **all tabs closed = column closed**. Can be switched off: Settings → "File preview" („Dateivorschau“) (`settings.showEditedFiles`, on by default; affects only the edited files, not `show_code`/snippets)
  - "Snippets": all code blocks (` ``` `/`~~~`) from the answers of the **active** agent, newest first, each with a "Copy" button (`SnippetList`, highlighting via `monaco.editor.colorize`, copying via main `clipboard:writeText`)
  - The most recently updated tab is shown until the user switches themselves
  - The column is **only shown while there is something to show**, otherwise the terminal takes the width (`.layout.with-code`, column `auto`)
  - **Splitter** on the left edge (`.pane-splitter`, absolutely positioned over the gap): drag the width (min. 240 px, list + terminal keep ≥ 580 px), double-click = 420 px; remembered in `localStorage` (`devhub.codePaneWidth`, located in the data folder)

**Sessions**

- Agents running when the app is closed are restored with their session on the next start

**Voice control**

- Button + hotkey: voice instruction to the active agent
- Global button + hotkey: address an agent by name; likewise start a new agent for a project with a task by voice
- Voice commands are interpreted by a separate Claude instance using the locally available account

**Predefined agents (templates)**

- Settings → "Predefined agents" („Vordefinierte Agents“): name (unique, not "Agent N", does not end with a number), model (optional), role/guidelines (text field with dictation button `DictationButton`)
- Start: ▶ on the project or right-click (choice normal/template) or by voice („Starte einen Entwickler für DevHub …“ = "Start a developer for DevHub …"); the agent is named like the template ("Entwickler", "Entwickler 2" …) → can be addressed by name
- Model: named by voice > template > start flags. Guidelines are appended to `--append-system-prompt` (`systemPrompt()` in `agents.ts`). The agent stores only `templateId`; the template is read fresh on every start (deleted template → start without guidelines). A template that is part of a team cannot be deleted

**Teams**

- Team templates (`TeamTemplate`, Settings → "Teams", `TeamTemplateDialog`): name (not "Team N"), 2–8 members (predefined or normal agents, order can be changed), shared guidelines (`DictationTextarea`)
- Running team (`Team`, `state.teams`): from a template or **temporary** by voice („Starte einen Entwickler und einen Reviewer als Team für …“ = "Start a developer and a reviewer as a team for …", name otherwise "Team N"). Agents carry `teamId` + `teamRole`; the team disappears with its last member (`removeEmptyTeams`)
- **Orchestrator:** `AgentManager.startTeam` always additionally starts an agent `teamRole: 'orchestrator'` ("Orchestrator", "Orchestrator 2" …; smallest `createdAt`), the members are `teamRole: 'worker'`. First save all of them (names fixed), then start. The orchestrator gets the task, plans, distributes, checks, decides permission requests and reports to the user (prompt `orchestratedTeamPrompt`); it is the user's **only point of contact**. If it ends (✕, `/exit`), the whole team ends; if its start or that of all workers fails → the team is aborted. `teamLead()` (`shared/types.ts`) = orchestrator, for teams from older states (without `teamRole`) the first member with the old behaviour
- **Workers can only be watched** (`isTeamWorker`): main blocks `write`, `sendLine` (throws), `rename`, an individual `stop` (throws; only ending the team); `sendVoice` to a worker goes to the orchestrator with the prefix `[Message from the user about X]` (also via the global voice command). Renderer: terminal `setTerminalReadOnly` (no typing, selecting/copying works), no buttons/no context menu, the header shows "👁 watching" („👁 beobachten“), Ctrl+G/pen → notice, agent voice shortcut with an active worker → goes to the orchestrator. Worker status: `Stop` → idle "Done" („Fertig“) (never highlighted, the user cannot answer), `Notification` ignored
- **Workers' permission requests:** worker settings have a `PermissionRequest` hook (curl **without** `-m`, hook `timeout` 24 h) on `POST /permission/<token>/<id>` and `permissions.deny: ["AskUserQuestion"]`. The bridge keeps the request open → `requestPermission` sends the orchestrator `[Permission request #N from X] … tool … input …` → it answers with the MCP tool `answer_permission(request_id, allow|deny, message)` → response `{hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior,message}}}`. Worker status meanwhile "Waiting for approval by the orchestrator" („Wartet auf Freigabe durch den Orchestrator“). Connection dropped (worker ended) → the request expires. Tested with real claude 2.1 + the real `AgentBridge` (allow → command runs, deny → the reason reaches the agent)
- Communication: MCP tools `team_members` + `send_team_message(to|"all", message)` for team members (the bridge asks `tools(agentId)`), `answer_permission` only for the orchestrator. **Workers write only to the orchestrator**, it writes to everyone. Delivery (`deliver`) = line into the terminal with the prefix `[Team message from X]`; held back (`pending`) while the recipient is starting, is in the editor tab, has an `AskUserQuestion` open or the user is currently typing (`mustHold`, see Architecture). If a worker ends its turn without a report to the orchestrator, the orchestrator gets `[Team status] X finished its turn without sending you a report` once
- Left: team header (icon, "temporary", count, ✕ = end team) with indented members (orchestrator with the tag "Orchestrator", workers with an eye); click = grid (`kind: 'agents'`), Ctrl+click = add/remove (`toggleAgents`)
- Voice: `start_team` (template or `members` list, the orchestrator is added automatically) · addressing a running team by name → goes to the orchestrator

**Workbench** (details under Architecture)

- **Inbox** (`InboxPanel`, at the bottom of the sidebar, only when not empty): open permission requests (Allow / Deny with reason / Always = rule for the project / in the terminal), waiting agents (finished ones with direct reply), notices (`notify_user`, context warning), file conflicts (two running agents edited the same path; computed from `editsByAgent` in the Workspace). Plus a Windows notification + taskbar flashing when DevHub is in the background (`settings.notifyOnWaiting`; a click shows the agent)
- **Worktree per agent** (`project.useWorktrees`): own branch `devhub/<name>-<id8>` under `<repo>/.devhub/worktrees/`; marker "wt" in the list
- **Review changes** (`ReviewDialog`; right-click on project/agent, MCP `show_diff`): choose the target (main folder / worktrees), file list, Monaco diff (editable on the right, arrows in the margin revert individual changes → "Save"), discard, commit a file/everything, merge/delete the worktree, line comments sent to the agent in one batch
- **Checks on "Done"** (`project.checks`, one command per line): if they fail, the agent continues working with the output
- **Queued instructions**: queue per agent (`agent.queue`, right-click "Instruction / prompt from the library", `QueueDialog`) – goes out as soon as the agent reports done; **task board** (`TaskBoardDialog`, button at the bottom left): open → in progress → done, start with a new agent or queue for a running one
- **History** (`HistoryDialog`): resume/fork finished sessions, full-text search across all transcripts, usage per project (today/total, costs only with prices entered). Right-click "Fork conversation" = copy of a running agent
- **Activity/usage**: current step or `report_progress` below the agent name (grey) and in the cell header, context size in the header of the single view, tab "Activity" on the right (last 60 steps), tabs for plans (`show_plan`, `Markdown` component without a dependency, no Mermaid)
- **Run** (`RunDialog`, right-click on the project): start/stop `project.runCommands` ("Name = command") with live output; web preview (`project.previewUrl`) in its own window, screenshot as `@"path"` into the prompt of the active agent
- **Prompt library** (Settings): placeholders `{{name}}` are asked for when sending; by voice „Agent 2, Prompt Code-Review“
- **Daily report** (`ReportDialog`): facts from the state, worded by `claude -p` (Haiku)
- **Read aloud** (`settings.voiceReadback`): short version of the answer of finished agents (Haiku → `speechSynthesis`)
- **Other engines** (Settings): any terminal program (e.g. `codex`) instead of Claude Code – without hooks, i.e. without status/file tabs/checks/permission requests/history
- **Remote access** (`settings.remoteEnabled`, off by default): phone page in the local network

**Startup check**

- On app start, check whether Claude Code is installed and logged in; if the login has expired, the user has to log in again first

## Tech stack

- **Electron + TypeScript** (decided 2026-11-10: most stable, easy to distribute)
- Build: electron-vite (Vite 8), Electron 44, electron-builder 26 — Windows only, **program folder as ZIP (target `zip`) — deliberately no installer and no `portable` target** (uninstall = delete the folder, data is in `data\` next to it; `portable` extracts ~100 MB to `%TEMP%` on every start → slow start). `build/README.txt` (English + German) is placed next to the .exe via `extraFiles`
- UI: React 19, plain CSS (`assets/main.css` = variables/base, `assets/components.css` = components), dark theme
- Terminal: `@xterm/xterm` 6 + `@xterm/addon-fit` (renderer), `node-pty` 1.1 (main, ConPTY, N-API prebuilds)
- Code view: `monaco-editor` 0.57, **slim import** (`monaco-editor/editor/editor.api` + `basic-languages/monaco.contribution` + only `editor.worker`)
- Speech → text: whisper.cpp locally (release `b5454`, `whisper-bin-x64.zip`), multilingual quantized models, language automatic (`-l auto`) or remembered (see Architecture)
  - Engine (~9 MB) **and** model are **not** shipped but downloaded to `<data>\whisper\` on first use (data folder next to the .exe, see Architecture)
  - First voice attempt without a model → `VoiceSetupDialog` (model choice base ~60 MB / small ~190 MB [default] / large-v3-turbo ~550 MB, download with progress directly in the dialog)
  - Settings: the same choice (`VoiceModels`), switch/delete the model
- Runtime dependencies (`dependencies`) only: `node-pty`, `@electron-toolkit/utils`. Everything that Vite bundles (React, xterm, Monaco) belongs in `devDependencies` (otherwise it ends up in the package twice).
- **License:** DevHub = MIT (`LICENSE`, holder "CocoNybbles"). `npm run build` generates `out/THIRD_PARTY_NOTICES.txt` at the end (`scripts/notices.mjs`: license texts of all `dependencies` + the bundled packages in `BUNDLED`, each with their dependencies; aborts if a license file is missing). electron-builder places `LICENSE.txt` + `THIRD_PARTY_NOTICES.txt` next to the .exe. **New library in renderer/main → add it to `BUNDLED`.** Checked: no GPL/non-commercial licenses in `node_modules`; MPL/CC packages are build tools only.

## Architecture

**Agent start** (`main/agents.ts`): `claude.exe` directly via node-pty in the agent folder (for a `.cmd` installation via `cmd.exe /c`, special characters are removed):
`claude [user flags]  --session-id <uuid> | --resume <uuid>  --settings <agent>/settings.json  --mcp-config <agent>/mcp.json  --append-system-prompt <hint> [task]`

- **User flags** (`shared/agentArgs.ts`): global `settings.agentArgs` + per project `project.agentArgs`, text as in a shell (quotes, backslashes are kept). `mergeAgentArgs(global, project, agent)`: a flag of the same name on a higher level replaces the lower one; level "agent" = `agent.model` (named in the voice command, persisted) or otherwise the template's model → `--model` (also applies on restore; checked with `isValidModelName`). They come **before** the DevHub flags (ends variadic values, the task stays positional). `validateAgentArgs` (dialogs live + main when saving) rejects free text and reserved flags (`--session-id`, `--resume`/`-r`, `--continue`/`-c`, `--fork-session`, `--no-session-persistence`, `--settings`, `--mcp-config`, `--append-system-prompt`, `--print`/`-p`, `--help`, `--version`). Unknown flags are only checked by claude itself → start failure (see below).
- `--resume` only if `~/.claude/projects/*/<sessionId>.jsonl` exists, otherwise `--session-id` (same id). Forking (`agent.forkFrom`): `--resume <old> --fork-session --session-id <new>` – only on the first start, afterwards the agent has its own transcript
- Working directory = agent folder or worktree (`worktreeCwd`: same subfolder as the agent folder within the repo); stored in `RunningAgent.cwd`, relative paths of the MCP tools refer to it
- **Other engine** (`agent.engineId`, `spawnEngine`): `cmd.exe /d /s /c "<command>"` in the same pty, no DevHub flags/hooks. Status = "working" while output arrives, after 2.5 s of silence "ready"; task and queued instructions are typed in (queued instructions immediately, as there is no "done"). No history, no `--resume` (restart = fresh program)
- Per-agent files in `<data>\agents\<agentId>\` (rewritten on every start because port/token change)
- Env without the session markers of a parent Claude instance (`claudeEnv()` in `main/tools.ts`)

**Back channel agent → app** (`main/agentBridge.ts`): HTTP server on `127.0.0.1:<random port>` with a random token

- `POST /hook/<token>/<agentId>`: hooks post their JSON via `curl.exe … --data-binary @-`
  Status: `SessionStart`→idle · `UserPromptSubmit`/`PreToolUse`/`PostToolUse`→working · `PreToolUse(AskUserQuestion)`/`Notification`/`Stop`→**needsInput** (highlighted on the left). `PreToolUse` additionally provides the activity (`describeTool` in `shared/permissions.ts` → `agent.activity` + `activityLog`)
- `POST /stop/<token>/<agentId>`: **Stop hook of all agents** (curl without `-m`, hook `timeout` 1 h) – stays open while the checks are running; empty response = stop, `{decision:"block",reason}` = continue working (see Checks). Only afterwards does `handleStop` process the event the way the Stop hook used to
- `POST /permission/<token>/<agentId>`: `PermissionRequest` hook of **all** Claude agents, stays open until the decision (see Permission requests)
- `POST /mcp/<token>/<agentId>`: minimal MCP server (Streamable HTTP, JSON responses only). For all (`COMMON_TOOLS`): `show_code(file_path, start_line, end_line?, note?)` → `code:focus`, `show_plan(title, markdown)` → `code:plan`, `show_diff(file_path?)` → `code:showDiff` (opens the review window), `notify_user(message)`, `report_progress(message, percent?)`, `run_list`/`run_output(name, lines?)`/`run_start`/`run_stop` (project commands, `runTool` in `index.ts`); for team members additionally `team_members`/`send_team_message` (see Teams). Tools are allowed via `permissions.allow`. **New tool:** definition + `ToolName` in `agentBridge.ts`, `COMMON_TOOLS` if applicable, handler in `handleToolCall`, hint in `SYSTEM_HINT`.

**Ctrl+G editor tab** (instead of an external editor): agents start with `EDITOR`/`VISUAL` = `devhub-notepad` and `<data>\agents\<id>\bin` at the front of `PATH`; it contains `devhub-notepad.cmd` = `curl.exe -s -o NUL -X POST <bridge>/editor/<token>/<agentId> --data-binary "%~1"`. On Ctrl+G claude calls `$EDITOR "<temp-prompt.md>"` via cmd and waits for the process to end; the bridge keeps the request open (`requestTimeout = 0`) until `AgentManager.finishEditor` writes the file and responds → claude loads the text as the prompt. `submit` → `\r` after 500 ms.

- While the tab is open: `agent.editing = true` (not persisted). Main ignores `write`, `sendLine` throws, `sendVoice` → `editor:append` (the text lands in the draft), team messages → `pending` (`flushPending` after closing). Renderer: `disableStdin` (`setTerminalLocked`), single view/grid show `LockedTerminal` = terminal/still image + a dimmed layer `.locked-overlay` on top with a notice at the bottom (where the input field is – otherwise the still image looks usable; absolutely positioned, does not shrink the terminal) + badge "🔒 in tab" („🔒 im Tab“) in the header (click anywhere → tab, via `onMouseDownCapture`; works because the agents view and the editor tab are never rendered at the same time – an xterm is only ever attached in one place), click on the agent on the left → tab.
- **Freezing the size:** claude waits blockingly (`spawnSync`) for the editor and does not redraw on a size change → xterm would cut off the content. Therefore **first the tab, then Ctrl+G** (`openEditor` in `Workspace`): the tab opens immediately (`preparing`, text field still locked), the terminal is attached in the tab column → fit → claude redraws itself at this size; after 400 ms `sendEditorKey`. If claude does not open an editor within 4 s (e.g. a selection is open), the tab closes with a notice. `setTerminalLocked` (already in the `editor:opened` handler) remembers the pixel size (`lockedSize`) and no longer fits; in smaller containers it is scaled via CSS `transform` (fallback only, e.g. Ctrl+G directly in the terminal when the DevHub shortcut is assigned differently). Do not put anything above/next to the terminal that shrinks its container (notices go into the header).
- **Still image for the agents view:** `openEditor` calls `snapshotTerminal` beforehand (DOM copy of the `.xterm` root element; xterm draws via DOM, colors/dimensions depend on the owner class on it). While the tab is open, `LockedTerminal` shows this still image at full width via `TerminalView snapshot`, the live terminal is attached in the narrower tab. `dropSnapshot` on close/abort/`disposeTerminal`.
- Center: tab bar (`.center-tabs`) only with open editor tabs: "Agents" + one tab per agent; ✕ = take over the text without sending. `EditorTab`: terminal on the left (locked), on the right a text field with dictation, attach, discard / take over into the prompt / send (Ctrl+Enter). In the tab the agent is the active one → the voice shortcut dictates into the draft.
- Images/files as `@"path"` (claude attaches them on sending, images as images): Ctrl+V saves to `<data>\agents\<id>\images\`, drag & drop uses the original path (`webUtils.getPathForFile`), button "Attach" = file picker. Chips with a preview (`editor:imagePreview` → data: URL).
- Agent ends while the tab is open → `closeEditor` answers the request (otherwise an orphaned curl would remain).
- Triggering: **DevHub shortcut** `settings.hotkeyEditor` (default `Ctrl+G`, Settings → Keyboard shortcuts) for the active agent, pen button in the single-view header, right-click "Write instruction in tab". All via `openEditor` in `Workspace`: tab open → switch to it, otherwise `sendEditorKey` (`lib/terminals.ts`, sends `\x07` = claude's Ctrl+G). Ctrl+G directly in the terminal keeps working independently of this (claude's own binding `chat:externalEditor`).
- **Why "notepad" in the name:** claude (2.1, read from the binary) classifies `EDITOR` as a GUI editor if the program name (first word without `start`/`cmd`/switches, base name) contains `code`, `cursor`, `windsurf`, `codium`, `subl`, `atom`, `gedit`, `notepad++` or `notepad`. GUI → the interface stays, the input field shows "Save and close editor to continue..." (as natively). Otherwise (e.g. `curl.exe`) = terminal editor → claude switches to the alternate screen and clears it → the terminal would be empty. Do not use `code`: claude may then append `-g file:line`. EDITOR must not contain a path with spaces (claude splits at spaces) → call via `PATH`. Checked with real claude (spaces in the bin path are ok).

**Edited files** (`main/snippets.ts`, `EditedFile`): live from `PostToolUse` (`tool_response` with `filePath` + `structuredPatch` → `editFromToolResult`, `changedRanges` = `+` lines, a deletion marks the following line); after a restore from the transcript (`user` entries, `toolUseResult` = same format, `editsFromLines`). `mergeEdits`: the same file keeps its place (order = first edit), the newer change wins, max. 30; a duplicate report (hook + transcript) does not trigger an event. Event/query `code:edits`. Format checked with real claude 2.1 (Edit, Write `type: "create"`).

**Snippets** (`main/snippets.ts`): every hook event contains `transcript_path` → a `TranscriptReader` per agent reads the JSONL transcript incrementally (byte offset, complete lines only; first read = whole file, so after a restore old snippets are back). Read on `SessionStart`, `Stop` (+ again after 1.5 s), `Notification`, `PreToolUse(AskUserQuestion)`. Only `type: "assistant"`, not `isSidechain` (subagents), text blocks → code fences. Max. 30 per agent, the same code only once. Event `code:snippets` (full list), `code:snippets` query after a renderer reload. No cooperation by the agent needed (no MCP tool).

**Worktrees** (`main/git.ts`, without Electron → testable by script; always `execFile('git', …)`): `prepareWorktree` before the first start (`start`, team workers in `startTeam`; the orchestrator stays in the main folder and gets the branch names in its prompt – `worktreeBranch(name, id)` can be computed before creation; workers are supposed to commit, the orchestrator merges via `git merge`). `createWorktree` adds `.devhub/` to `.git/info/exclude`. On ending (`forget`): a worktree without changes and without own commits is removed (`removeWorktreeIfUnused`), otherwise it stays for review; resuming from the history re-creates a removed one at the old path (`restoreWorktree`, sessions can only be resumed in their directory). A fork shares the worktree of the original.

**Review** (`git:*` in `index.ts`): the renderer only names `(projectId, targetId)`, main resolves the directory via `reviewTargets` (main folder = `main`, worktrees under `<repo>/.devhub/worktrees` = `wt:<branch>`); paths are checked by `insideWorkdir` (no `..`, no `.git`). Comparison base (`reviewRef`): main folder = `HEAD`, worktree = `merge-base(HEAD, base)` → the agent's commits count too; repo without a commit = empty tree. `mergeWorktree`: `--no-ff` into the branch checked out in the main folder; requires a clean worktree, on conflict `merge --abort`.

**Checks** (`handleStop`): only if the agent has changed files since the last check (`editedThisTurn`, from `PostToolUse`). Commands run one after another via `exec` in the working directory (10 min per command); first failure → `block` with the last 6000 characters of the output, at most 3 times per instruction (`MAX_GATE_ROUNDS`). If the agent then reports done without having changed anything (e.g. it explains why it is not fixing it), no further check is run. Status text: "Done – checks green" / "… fails" („Fertig – Prüfungen grün“ / „… schlägt fehl“).

**Permission requests** (`requestPermission`): 1. A rule of the project matches (`matchesRule`: `Tool` or `Bash:<prefix>`, chained/redirected commands never match) → `allow` immediately. 2. Worker → orchestrator (see Teams). 3. `settings.permissionInbox` on → entry in the inbox (`PermissionInfo`, event `inbox:permissions`), answer via `answerUserPermission` (`always` saves `ruleFor(...)` in `project.permissionRules`). 4. Otherwise empty response → claude's normal dialog in the terminal. While a permission request is open, `Notification`/`PostToolUse` do not overwrite the status.

**Queued instructions/tasks**: `enqueue` appends to `agent.queue` (persisted) and calls `sendNextQueued`: it is only sent when the turn has ended (`turnDone`, set in the stop) and `mustHold` has no objection; otherwise retried after the next stop or every 5 s. `agent.currentTaskId` → on stop the task becomes "done"; if the agent ends before that, it goes back to "open". Tasks are stored in `state.tasks`.

**Hardened delivery** (`mustHold`): automatic inputs (team messages, queued instructions) wait while the agent is starting, the editor tab is open, an `AskUserQuestion` is open (`r.asking`, no longer via the status text) or the user is currently typing (`r.draftAt`: printable characters in `write()`, cleared on Enter/Ctrl+C/Ctrl+U, valid for 45 s).

**History** (`state.archive`, max. 200): `forget` takes over regularly ended Claude agents without a team that have a transcript (title = first instruction, usage). `resumeArchived` starts with the same session (the entry disappears) or as a copy. Search (`main/history.ts`): raw-line pre-filter, then only `user`/`assistant` texts, max. 3 excerpts per session, transcripts > 60 MB are skipped.

**Usage** (`UsageTracker` in `main/snippets.ts`): `message.usage` of the `assistant` lines, counted only once per `message.id` (one answer is spread over several lines); context = input + cache of the last answer (without subagents); `byDay` in local time. Read on the snippet occasions and throttled (4 s) on `PostToolUse`. Context warning from `settings.contextWarnTokens`. Costs only from `settings.priceInput/priceOutput` (cache read 10 %, cache write 125 %) – DevHub does not know any model prices.

**Run** (`main/runs.ts`): `spawn(command, { shell: true })` in the agent folder, output without ANSI, 300 KB per command; stop via `taskkill /T /F`. Processes keep running until the app ends. Preview = own `BrowserWindow` (sandbox, no preload), only `http(s)`.

**Remote access** (`main/remote.ts`): HTTP on `0.0.0.0:<settings.remotePort>`, everything under `/<remoteToken>/` (otherwise 404, comparison with `timingSafeEqual`): page, `GET api/state`, `POST api/send`, `POST api/permission` (only allow/deny/always). Unencrypted – deliberately only as an opt-in for your own network/VPN; the token is created when first switched on, clearing it = new address.

**Agent lifecycle**

- Names: smallest free number **globally** ("Agent N") → unique for voice commands
- Process ends (`/exit` or ✕ in the list) → agent removed from the state (session → history), the view closes
- Start failure: if an agent ends < 8 s after the start with an exit code ≠ 0 (not via ✕), main reports `agents:startFailed` with the last output lines (without ANSI) → toast
- App is quit (`before-quit`) → processes stopped, agents stay saved → on the next start `agents:restore` (once per app start)
- The waiting state survives restarts: `setStatus` saves `needsInput` (notice text) on the saved agent; the restore starts with this status, `SessionStart` with `source: "resume"` does not reset it to idle (only `UserPromptSubmit`/tool hooks do)

**Terminals in the renderer** (`lib/terminals.ts`): one xterm per agent, lives independently of React and collects output even when invisible; `attachTerminal()` attaches the DOM element in the single view or a grid cell. Main additionally keeps a 200 KB output buffer (`agents:buffer`) for renderer reloads.

- **Copy/paste as in Windows Terminal** (`clipboardKey`/`pasteInto`): Ctrl+C **with** a selection copies (without a selection = ^C to the agent), likewise Ctrl+Shift+C/Ctrl+Insert. Ctrl+V/Ctrl+Shift+V/Shift+Insert: main reads the clipboard (`clipboard:read`) → text via `term.paste` (bracketed paste); only an image → `ESC v` (= Alt+V, claude's image paste on Windows, from the binary; checked with real claude → `[Image #1]`). `preventDefault`, otherwise the browser pastes additionally. Without this, xterm.js only sends `^V` on Ctrl+V.
- Electron 44: `clipboard` is **asynchronous** (W3C style: `readText()`/`has(mime)`/`read()` return promises, no `readImage`); Windows bitmaps appear as `image/png`.

**Voice control**: the renderer records WAV (`lib/recorder.ts`, 16 kHz mono) → `voice:transcribe` (whisper-cli, priority "below normal", threads = half the cores) →

- **Fixed language** (`settings.voiceFixedLanguage`, Settings "Spoken language": Automatic / Always German / Always English): always `-l <code>`, no detection, remembering does not apply.
- **Remember language** (`settings.voiceRememberLanguage`, on by default; remembered in `settings.voiceLanguage`): first `-l <remembered>` (≈1.5 s instead of ≈3 s with `auto`). Evaluation via `-ojf` (JSON: language + token probability `p`). Empty result or avg. p < 0.6 → second run with `auto`, whose language is saved. **English is never remembered/preset** (`canRememberLanguage` in `shared/voiceLanguage.ts`): with `-l en` whisper translates German speech into English with p = 0.66 (measured, model small) → the check does not catch it (was a user bug). Forced `de` with English speech, on the other hand, yields p ≈ 0.5. To be safe, every 5th recording still uses `auto`. The job card shows the remembered language in advance (`[DE] Converting to text …`), without a remembered language "Detecting language and text …"; after an `auto` run the renderer reloads the settings.
- **Background:** "Done" only ends the recording; recognition/routing continue as a `VoiceJob` (cards at the bottom of the center, several at once), new recordings are possible immediately. The overlay lets clicks through (`.voice-stack` with `pointer-events: none`).
- **Send or only insert:** `agents:sendVoice` decides in main: `agent.voiceAutoSend` (per agent, context menu, persisted) → otherwise global `settings.voiceAutoSend`. Also applies to global commands (`send`).
- active agent (default `Ctrl+Shift+Space` / microphone in the center): text to the agent (`sendLine` = text, 150 ms, Enter)
- global (default `Ctrl+Alt+Space` via `globalShortcut` / microphone on the left): `voice:command` → `claude -p --model haiku --output-format json --tools "" --strict-mcp-config --no-session-persistence` (prompt via stdin) returns JSON `send` | `start` (+ optional `model`: alias `fable`/`opus`/`sonnet`/`haiku`, with a named version the full name such as `claude-opus-5-5`) | `none`
- **Shortcuts configurable** (Settings → `HotkeyInput`): saved as an Electron accelerator in `settings.hotkeyAgentVoice` / `hotkeyGlobalVoice` / `hotkeyEditor` (all three must differ, checked by main). `shared/hotkeys.ts` translates key presses (layout-independent via `KeyboardEvent.code`) and formats the display. Main re-registers the global shortcut (`registerGlobalHotkey`; taken → old one back + error in the dialog); during a recording it is released via `settings:suspendGlobalHotkey`. The terminal lets the agent and editor shortcuts through via `setAppHotkeys()`.

**Languages (i18n)**: setting `settings.language` (`'system'` | language code, default `'system'` = OS language via `Intl`, fallback English), chosen in Settings → Language, saved in `devhub-state.json`, applied immediately without a restart (`applyLanguageSetting` in main at startup and in `settings:update`; renderer `syncLanguage` before the first render in `main.tsx` and after every settings change). Adding a language = copy `locales/en` to `locales/<code>`, translate, add one entry to `LANGUAGES` in `src/shared/i18n/index.ts` (it then appears in the settings automatically). Status texts created in main keep the language they were created in.

**Data folder** (`main/dataPath.ts`, first import in `index.ts`): **all data next to the .exe** in `<exe folder>\data\` (`app.setPath('userData')` before `ready`, so the Chromium cache too). Folder of the .exe (`PORTABLE_EXECUTABLE_DIR` only if a `portable` build ever runs again); development: `<project>\data\` (gitignored). Not writable → error message + quit. One-time takeover of `devhub-state.json` + `whisper\` from the old `%APPDATA%\DevHub`. Referred to as `<data>` below.

**Persistence** (`main/store.ts`): `<data>\devhub-state.json` (projects, running agents, settings, `view` = last shown view, plus `tasks`, `archive`, `prompts`, `engines`), written atomically. Add new agent fields that should survive restarts to `persisted()` (`agents.ts`); runtime fields are in the `Omit` of `PersistedAgent`.

- View (`Selection` in `shared/types.ts`): the renderer saves every change via `view:set` (only after `view:get` has been loaded at startup, ref `viewLoaded`); at startup `savedView` → otherwise the first project with agents. Agents that are no longer running are filtered out by `selection` (useMemo) → set `agents` before the selection.

## Commands

| Purpose                                                       | Command                           |
| ------------------------------------------------------------- | --------------------------------- |
| Development (hot reload)                                      | `npm run dev`                     |
| Type check                                                    | `npm run typecheck`               |
| Lint / format                                                 | `npm run lint` / `npm run format` |
| Build (type check + bundle to `out/`)                         | `npm run build`                   |
| Unpacked package for testing (`dist/win-unpacked/DevHub.exe`) | `npm run build:unpack`            |
| ZIP of the program folder to `dist/` (`DevHub-<ver>-win.zip`) | `npm run build:win`               |

**Debug environment variables**

- `DEVHUB_DEBUG=1`: logs agent starts, hook events and MCP calls to the console
- `DEVHUB_SCREENSHOT=<path.png>` (+ `DEVHUB_SCREENSHOT_DELAY=<ms>`, default 8000): saves a window image and logs the DOM state (agent rows, code note)
- `DEVHUB_DATA_DIR=<folder>`: own data folder → **second instance next to a running one** (the single-instance lock is tied to the data folder), without taking over old data. This allows testing the interface while DevHub is open: pre-fill `devhub-state.json`, start `node_modules/electron/dist/electron.exe . --remote-debugging-port=<port>` (after `npm run build`) and click and save images via the DevTools protocol (`/json` → WebSocket, `Runtime.evaluate`, `Page.captureScreenshot`)

**Tests by script** (no test runner in the project): bundle modules without Electron (`git.ts`, `snippets.ts`, `history.ts`, `shared/*`) with `npx rolldown <test.ts> --file <out.mjs> --platform node` and run them with node. `AgentManager` also runs under node: `electron` via `resolve.alias` to a stub (`app.getPath` → test folder), `external: ['node-pty']`, put the output under `node_modules/` (otherwise node-pty is not found) – this is how worktree, permission requests, checks, queue, forking and history were checked with real claude.

## Project structure

```
src/
  shared/types.ts          Shared types + DevHubApi
  shared/hotkeys.ts        Shortcuts: defaults, key press → accelerator, display format
  shared/agentArgs.ts      Start flags: tokenizer, validation, merging global/project
  shared/voiceLanguage.ts  Which language may be remembered (never English), choice of the fixed language
  shared/permissions.ts    Permission rules (`ruleFor`, `matchesRule`, `validateRule`), `describeTool` (activity)
  shared/i18n/             Languages: index.ts = core (`t`, `LANGUAGES`, `getLocale`), locales/<code>/<namespace>.ts = texts (en = reference)
  main/
    git.ts                 Worktrees + review (changes, diff, discard, commit, merge), without Electron
    runs.ts                Project commands as managed processes (RunManager)
    history.ts             Find the transcript, full-text search across sessions
    reports.ts             Daily report + short version for reading aloud (`claude -p`)
    remote.ts              Remote access: HTTP server + phone page
    index.ts               Window, IPC handlers, global hotkey, microphone permission
    agents.ts              AgentManager: node-pty, start/stop/rename/restore, hook status, show_code
    agentBridge.ts         Local HTTP server: hooks + MCP (show_code)
    dataPath.ts            Data folder next to the .exe (imported before everything else)
    store.ts               JSON persistence, dataDir()
    tools.ts               claude/VS Code detection, claudeEnv(), openInVSCode(), openWithProgram()
    claudeAuth.ts          `claude auth status --json`, login console
    voice.ts               whisper.cpp download/transcription, model management
    voiceCommands.ts       Global voice commands via `claude -p`
    voicePrompt.ts         Router prompt (pure, testable with real claude via an esbuild script)
    snippets.ts            Transcript incrementally: code blocks, edited files, usage (`UsageTracker`); without Electron
  preload/index.ts         window.api (contextBridge)
  renderer/src/
    App.tsx                Auth gate → Workspace; type `Selection`
    Workspace.tsx          State, selection, voice flow, hotkeys, dialogs
    lib/                   terminals.ts, recorder.ts, errors.ts, hotkeyCapture.ts, selection.ts,
                           monaco.ts (slim Monaco import, theme, language for file/code fence),
                           editorText.ts (attachments `@"path"` in the editor tab),
                           format.ts (tokens, costs, date, prompt placeholders),
                           i18n.ts (`useT()` hook for components, `syncLanguage()`)
    assets/workbench.css   Styles of the workbench (inbox, review, tasks, history, run, Markdown)
    components/            Sidebar, CenterPane, EditorTab, TerminalView, CodePane, SnippetList, ProjectDialog, SettingsDialog,
                           VoiceSetupDialog, VoiceModels, VoiceOverlay, HotkeyInput, ProgramInput, AgentArgsHelp, Modal,
                           AgentTemplateDialog, TeamTemplateDialog, DictationButton, DictationTextarea,
                           ContextMenu, AuthGate, Icons, ImportProjectsDialog,
                           InboxPanel, ReviewDialog, TaskBoardDialog, HistoryDialog, RunDialog, ReportDialog,
                           QueueDialog, LibraryDialogs (PromptDialog, EngineDialog), Markdown
electron-builder.yml       Windows targets, asarUnpack node-pty, only languages de/en-US
```

**IPC pattern:** channel `area:action` (e.g. `agents:start`) → handler in `main/index.ts`, method in `preload/index.ts`,
type in `DevHubApi` (`shared/types.ts`). Always adjust all three together. Events main→renderer: `agents:data`,
`agents:changed` (agents + running teams; also carries the non-persisted fields `activity`, `progress`, `usage`, `lastMessage`), `agents:startFailed`, `agents:focusRequest`, `code:focus`, `code:snippets`, `code:edits`, `code:plan`, `code:showDiff`, `inbox:permissions`, `inbox:notice`, `tasks:changed`, `runs:changed`, `runs:output`, `editor:opened`, `editor:append`, `voice:progress`, `voice:globalHotkey`, `voice:speak` (subscribing returns an unsubscribe function).

## Status

- [x] Login check at startup (blocks the app until logged in)
- [x] Create/edit/remove projects (3 paths), open project file / folder with a selectable program (global + per project; start with paths containing spaces tested, **dialogs not yet tested in the UI**)
- [x] Start/rename (right-click)/stop agents, terminal, grid view, self-termination closes the view
- [x] Input detection via hooks, highlighting on the left — **tested**
- [x] Code view + MCP `show_code` — **tested end to end**
- [x] Snippets with copy button — evaluation tested on real transcripts, `transcript_path` in the Stop hook checked via `claude -p`, build ok; **display/copying not yet tested in the app**
- [x] File tabs for edited files + splitter for the code column — evaluation tested on a real hook log/transcript, build/lint ok, app starts; **tabs/splitter not yet tested in the app UI**
- [x] Ctrl+G editor tab — real `AgentBridge` + real claude via node-pty tested (initial text arrives, new text is taken over, send → answer), `@"path with spaces"` attaches images (`claude -p`); **tab/lock/images not yet tested in the app UI**
- [x] Session restore — saving/restart tested; `--resume` with a real transcript **not** yet tested
- [x] Voice control incl. download dialog — routing via `claude -p` tested; **whisper download/transcription + microphone not yet tested**
- [x] Voice shortcuts changeable in the settings — build/type check ok, **not yet tested in the UI**
- [x] Start flags global + per project — parser tested, claude's behaviour checked via PTY (unknown flag → exit 1, `--enable-auto-mode` is valid but undocumented); **not yet tested in the UI**
- [x] Free grid via Ctrl+click — selection logic tested by script, **not yet tested in the UI**
- [x] Sorting projects/agents (drag & drop, A→Z) — build/lint ok, app starts; **dragging not yet tested in the UI**
- [x] Team orchestrator + watch-only workers — permission path (hook → bridge → allow/deny) tested with real claude, build/type check/lint ok; **orchestrator prompt/interplay and UI not yet tested in the app**
- [x] Teams (fixed + temporary by voice, communication via MCP) — router tested with real `claude -p` (6 cases: team template, ad-hoc team with task/name/"two developers"/normal agents, a single start stays `start`, addressing a team → lead); team tools called by `claude -p` through the real bridge; **delivery between running agents and UI not yet tested in the app**
- [x] Predefined agents (templates) — router tested with real `claude -p` (7 cases: template de/en, misheard name, model from speech, a running agent is addressed instead of started anew), multi-line guidelines passed to claude via node-pty tested; **UI/dictation not yet tested in the app**
- [x] Model by voice command („Starte mit Opus einen Agent für …“ = "Start an agent with Opus for …") — router prompt tested with real `claude -p` (de/en, „Sonett“, version), flag merging tested; **agent start not yet tested in the app**
- [x] Remembered language for faster recognition — flow tested by script with TTS files (de/en), **not yet tested in the app**
- [x] Speech recognition in the background + auto-send per agent — build/lint ok, whisper with low priority tested (file test); **microphone/UI not yet tested**
- [x] Automatic `.sln` search when creating a project — search tested, **not yet tested in the UI**
- [x] Packaging (`build:unpack`) tested: `app.asar` ~8 MB, ZIP ~147 MB (the rest is Electron), start from the unpacked folder ≈1.3 s
- [x] Initial Git commit (after review by the user)
- [x] **Workbench** (branch `feature/workbench`) – build/type check/lint ok. Checked:
  - by script (47 cases): Git/worktrees (create, changes, diff, discard, partial commit, merge, conflict abort, remove/re-create, repo without a commit), permission rules, usage (also on a real transcript), search
  - **with real claude through the real `AgentManager`**: worktree agent, permission request via the inbox + "Always" rule (second call allowed automatically), check fails → agent fixes → "checks green", task via the queue → "done", forking (`--fork-session`, the copy knows the conversation), history + resume; default case inbox off → claude's dialog in the terminal, afterwards rule → without asking
  - by script: MCP tools `show_plan`/`show_diff`/`notify_user`/`report_progress`/`run_*` through the real bridge, other engine (start, task/queued instruction typed in), remote access (token, page, state, send, switch off)
  - Interface clicked through in a second instance via the DevTools protocol (without renderer errors): inbox, tasks, history with costs, review with diff, run with live output, queue dialog, project dialog, settings, daily report (real Haiku)
  - **not yet tested:** teams with worktrees (prompts/merge by the orchestrator), voice router with `promptId`, preview window + screenshot, Windows notification/flashing, read aloud, tabs "Plan"/"Activity" and file conflict in the interface, permission cards in the inbox (only the logic behind them), remote access from a real phone
- [x] **Languages English + German** (branch `feature/i18n`) – build/type check/lint ok. By script: all keys present in `de` with the same placeholders, no unused keys, plurals, fallback. In a second instance via the DevTools protocol: start in the saved language, switch in Settings → Language changes sidebar, tooltips and dialog immediately, choice survives a restart. **Not yet tested:** the English texts of most dialogs in the interface (only settings and main window were looked at), agent status texts and the phone page in English, texts with a running agent
- **Releases by hand only** (user's wish: nothing automatic on push): `npm run release -- <notes.md> [x.y.z]` (`scripts/release.mjs`). Checks: notes contain the non-empty sections `## English` and `## Deutsch` (`NOTE_LANGUAGES` in the script), branch `main`, no open changes, in sync with `origin/main`, tag/release does not exist yet. Then version = patch +1 from `package.json` (or the given x.y.z for minor/major) → `npm version --no-git-tag-version` → `npm run build:win` (failure → version reset) → push commit "Version x.y.z" + tag `vx.y.z` → GitHub release for this tag in the main repo + upload the ZIP (GitHub API, login from the Git Credential Manager). Claude writes the release notes for testers **in English and German** (one file: `## English` first, then `## Deutsch` with the same content, sub-headings `###`; features instead of a commit list) into a file in the scratchpad and shows them beforehand. v1.0.0 = tag on 0aecc72 (published by hand), from v1.0.1 on by script (ran end to end). Download info for users: `README.md`.
- Local test ZIP: `npm run build:win` → `dist/DevHub-<ver>-win.zip` (contains `README.txt`)

## Conventions

- Environment: Windows 11, PowerShell / Git Bash
- Available: Node 26, npm 11, .NET 10, Claude Code 2.1 (on 2026-11-13: npm installation `%APPDATA%\npm\claude.cmd`, no `claude.exe` in the PATH), Git, VS Code, Visual Studio 2022 Community (without C++ build tools)
- **Language: English** (open-source project): source code, comments (incl. JSDoc, CSS/YAML/HTML comments), identifiers, prompts/tool descriptions for Claude, console messages, docs. Always write new and changed comments in English.
- **UI texts are never hard-coded**: every user-visible text goes through `t('namespace.key')`. Components use `const t = useT()` (`renderer/src/lib/i18n.ts`); main, `shared/` and non-component helpers import `t` from `shared/i18n`. Texts live in `src/shared/i18n/locales/<code>/<namespace>.ts`; English (`locales/en`) is the reference and runtime fallback, `de` is typed `typeof en` (missing key = type error). Placeholders `{name}`, plurals via `key_one`/`key_other` + `t(key, { count })`. No module-level constants with translated text (evaluated once → would not switch). Dates/numbers use `getLocale()`.
- Texts sent to Claude/agents (prompts, terminal messages, MCP tool descriptions) are fixed English and not translated.

## Known pitfalls

- **Only one instance** (`requestSingleInstanceLock` in `main/index.ts`): two instances would restore the same agents/sessions. `npm run dev` therefore exits immediately if DevHub is already running → close the open window first. `electron-vite dev` does **not** reload main changes (no `-w`) → restart the app after changes in `src/main`.

- **claude's trust dialog:** in a folder that has not been trusted yet, claude shows "Is this a project you trust?" on start – preselected **"No, exit"** (Enter ends the agent with code 1). Subfolders of a trusted folder count as trusted. That is why worktrees are located **inside the repository** (`<repo>/.devhub/worktrees/`), not in the data folder; never send keys into this dialog automatically. Consequence: tools that walk the whole main folder see the worktrees – exclude `.devhub` where needed (here: `.gitignore`, `.prettierignore`, eslint `ignores`, electron-builder `files`).
- **Auto mode = no permission requests:** with `--permission-mode auto` (or a globally configured auto mode) claude does not trigger a `PermissionRequest` for edits → the inbox and the rules then have no effect. For testing put `--permission-mode default` into the start flags.
- **claude as `.cmd` (npm installation):** the agent then runs via `cmd.exe /c` and the characters `" % ^ & | < >` as well as line breaks in arguments (task, system prompt) are replaced by spaces – so do not rely on them in prompts for claude.
- node-pty occasionally writes "AttachConsole failed" (helper process `conpty_console_list_agent`) to stderr when an agent ends – harmless.
- Tests with `DEVHUB_SCREENSHOT`: do **not kill the app hard** (`timeout`/kill): without `before-quit` the pty processes end as "agent ended" → the agents are deleted from the state. Close the window normally.
- Packages in `dist/` are not rebuilt automatically → run `npm run build:unpack` before testing new features with the .exe (otherwise an old build runs).
- **No native rebuild:** `postinstall` is only `install-electron`. `electron-builder install-app-deps` would build node-pty from source and fails without C++ build tools; the N-API prebuilds work directly in Electron. After a failed rebuild: `rm -rf node_modules/node-pty && npm install`.
- Do not reintroduce an installer (NSIS or similar): it would delete `data\` on uninstall/update, and there are no write permissions under "Program Files".
- node-pty must be listed in `asarUnpack` (DLLs/OpenConsole.exe cannot be loaded from asar).
- `data\` in the project folder (development data folder) must stay excluded in `electron-builder.yml` under `files` (`!data{,/**}`): otherwise Chromium caches, the whisper model and the app's own state end up in `app.asar` (was 270 MB instead of ~8 MB → noticeably slower start).
- If DevHub is started from a Claude terminal, agents otherwise inherit `CLAUDE_CODE_CHILD_SESSION` etc. → "Transcript saving is off" → no restore. Always use `claudeEnv()` for Claude processes.
- Hooks: `curl.exe` with `.exe` (in PowerShell 5.1 `curl` is an alias). No `|| exit 0` (syntax error in PS 5.1); exit codes ≠ 2 do not block.
- **Monaco ships its own copy of DOMPurify** (`esm/vs/base/browser/dompurify/dompurify.js`, 0.57 = 3.4.15 with security vulnerabilities). An npm `overrides` alone is not enough: `electron.vite.config.ts` redirects the import `./dompurify/dompurify.js` via an alias to `node_modules/dompurify`, version via `overrides.dompurify` in `package.json`. Check: `grep -o "@license DOMPurify [0-9.]*" out/renderer/assets/*.js`. Tested with Monaco's `sanitizeHtml` in Electron. On a Monaco update, check whether the redirect is still needed.
- Monaco 0.57 has an export map: paths without `esm/vs/` (e.g. `monaco-editor/editor/editor.worker?worker`). A full `monaco-editor` import bundles ~15 MB of language workers.
- `.cmd`/`.bat` with spaces in the path: `cmd.exe /d /s /c ""prog" "arg""` + `windowsVerbatimArguments: true` (Node's default quoting breaks with `cmd /c`).
- Call `claude` with `exec` + a command string (not `execFile` + `shell: true` → DEP0190). Fixed arguments only.
- Lint `react-refresh/only-export-components`: component files export only components → move shared state/functions to `lib/` (e.g. `hotkeyCapture.ts`).
- Lint `react-hooks/set-state-in-effect`: no synchronous `setState` in `useEffect` — derive the state (`useMemo`, see `selection` in Workspace) or set it in the `.then()`.
- React StrictMode runs effects twice in dev mode → keep side effects in main idempotent (e.g. `restore()` only once).
- `capturePage` returns a stale image when the window is covered → `show()/focus()/invalidate()` the window beforehand.
- Heredocs in the Bash tool corrupt `\\`, `\r`/`\n` in strings and umlauts (Python stdin) → write code/JSON with backslashes or umlauts using the Edit/Write tool.
- Line endings: **LF** everywhere (`.gitattributes`: `* text=auto eol=lf`, Prettier expects LF). Python `open(..., 'w')` writes CRLF on Windows → change files with the Edit tool (or `newline=''`, then `npx prettier --write`). Check: `git ls-files --eol | grep w/crlf`.
- Git: default branch is `main`, remote `origin` = https://github.com/CocoNybbles/DevHub (**public** – do not commit secrets). `main` is protected by the ruleset „main schützen“ ("protect main"): changes only via pull request with 1 approval (collaborators with write access), no force push/deletion; only the owner (repository admin) bypasses this and pushes directly (also `npm run release`). Second ruleset „Release-Tags schützen“ ("protect release tags"): creating/changing/deleting tags `v*` only by the owner. Also enabled: secret scanning + push protection, Dependabot alerts + security updates (PRs), private vulnerability reporting (`SECURITY.md`), delete branch after merge. **GitHub Actions are disabled** (no workflows) – re-enable them first for a workflow. `gh` is not installed.
