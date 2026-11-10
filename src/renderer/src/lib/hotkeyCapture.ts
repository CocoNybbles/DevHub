/** Läuft gerade eine Kürzel-Aufnahme (Einstellungen)? Dann ignoriert Workspace seine eigenen Hotkeys. */
let capturing = false

export function isCapturingHotkey(): boolean {
  return capturing
}

export function setCapturingHotkey(value: boolean): void {
  capturing = value
}
