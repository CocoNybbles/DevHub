# DevHub

Windows app for managing projects and the AI coding agents (Claude Code) running in them: one terminal per agent, grid view, file preview with highlighted changes, voice control and teams with an orchestrator.

**[Download the latest version](https://github.com/CocoNybbles/DevHub/releases/latest)** – changes are listed with the individual [releases](https://github.com/CocoNybbles/DevHub/releases).

## Installation

1. Download the ZIP and extract it to a writable folder (e.g. `C:\Tools\DevHub`, not under "Program Files").
2. Run `DevHub.exe` – no installation needed. If Windows reports "Windows protected your PC" (the file is not signed): "More info" → "Run anyway".

**Requirements:** Windows 10/11 (64-bit) and [Claude Code](https://claude.com/claude-code), installed and signed in. Optional: a microphone for voice control.

**Update:** extract the new version over the old folder – data and settings in the `data` folder are kept. To uninstall, delete the folder.

**Language:** the interface is available in English and German. It follows the Windows language by default and can be changed under Settings → Language.

## Features

- **Projects:** agent folder, project file (`.sln` is found automatically) and folder per project; import several projects at once; open them with programs of your choice
- **Agents:** any number of Claude Code agents per project, each with its own terminal, grid view, highlighting of agents that are waiting, restore after a restart, instructions in a separate tab (Ctrl+G) with dictation and images, predefined agents with role and model
- **Code view:** edited files as tabs with highlighted changes, code locations shown by the agent, snippets with a copy button
- **Teams:** several agents with an automatically started orchestrator that distributes the task and decides on permission requests; the members can be watched
- **Inbox:** everything that is waiting for you in one place – waiting agents with direct reply, permission requests (including "always allow" per project), notices from the agents, a warning when files are edited by two agents at once; Windows notification when DevHub is in the background
- **Worktrees and review:** if you like, every agent works in its own Git worktree; review changes in a diff, revert them individually, commit, merge and send comments to the agent
- **Checks:** commands such as type check, lint or tests run automatically when an agent reports it is done – if they fail, the agent fixes the problems
- **Queue and tasks:** queue instructions ("when you are done, then …"), task board per project, prompt library with placeholders
- **Overview:** current step and progress per agent, context size and token usage, history of finished sessions (resume, fork, search), daily report
- **Run:** dev server, tests and other project commands with live output that the agents can read too; web preview with a screenshot for the agent
- **Also:** other coding agents as a terminal program (limited), remote access for your phone within your own network (can be switched off, off by default)
- **Voice control:** instruction to the active agent or a system-wide voice command ("Agent 2, write tests for the login", "Start an agent for …"); speech recognition runs locally with whisper.cpp

## Development

Electron + TypeScript + React (electron-vite). Node 22+ and npm.

```sh
npm install
npm run dev        # development with hot reload
npm run build:win  # ZIP to dist/
```

Details on architecture, conventions and pitfalls: [CLAUDE.md](CLAUDE.md).

## License

[MIT](LICENSE). The included open-source libraries and their licenses are listed in `THIRD_PARTY_NOTICES.txt` in the program folder (generated during the build).

Claude Code is not included: DevHub starts the locally installed `claude`, which is subject to Anthropic's terms of use.
