/** Is a hotkey capture running (settings)? If so, Workspace ignores its own hotkeys. */
let capturing = false

export function isCapturingHotkey(): boolean {
  return capturing
}

export function setCapturingHotkey(value: boolean): void {
  capturing = value
}
