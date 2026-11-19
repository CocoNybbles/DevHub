import type en from '../en/auth'

/** German texts: namespace `auth` */
const de: typeof en = {
  checkingLogin: 'Prüfe Claude-Anmeldung …',
  notInstalledTitle: 'Claude Code wurde nicht gefunden',
  notInstalledText:
    'DevHub benötigt die Claude-Code-CLI. Bitte installiere sie und starte danach die Prüfung erneut.',
  instructions: 'Anleitung:',
  loggedOutTitle: 'Bitte bei Claude anmelden',
  notLoggedIn: 'Du bist aktuell nicht bei Claude angemeldet.',
  loginFirst: 'Melde dich zuerst an, danach geht es weiter.',
  loginButton: 'Anmelden …',
  // Sentence around `<code>claude auth login</code>`
  loginHintBefore: 'Es öffnet sich ein Konsolenfenster mit',
  loginHintAfter: '. Nach dem Login hier auf „Erneut prüfen“ klicken.',
  checkFailedTitle: 'Prüfung fehlgeschlagen',
  checking: 'Prüfe …',
  recheck: 'Erneut prüfen'
}

export default de
