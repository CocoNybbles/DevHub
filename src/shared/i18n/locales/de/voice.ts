import type en from '../en/voice'

/** German texts: namespace `voice` */
const de: typeof en = {
  modelSmallLabel: 'Small (empfohlen)',
  modelBaseDescription: 'Sehr schnell, brauchbare Erkennung',
  modelSmallDescription: 'Gute Erkennung, auch bei Fachbegriffen',
  modelLargeDescription: 'Sehr gute Erkennung, braucht einen stärkeren Rechner',
  unknownModel: 'Unbekanntes Modell',
  downloadRunning: 'Es läuft bereits ein Download',
  engineMissingInArchive: 'whisper-cli.exe fehlt im Archiv',
  notSetUp: 'Sprachsteuerung ist noch nicht eingerichtet',
  downloadFailed: 'Download fehlgeschlagen ({status}): {url}',
  downloadIncomplete: 'Download unvollständig',
  noProjects: 'Es sind noch keine Projekte angelegt.',
  agentOrInstructionNotRecognized: 'Agent oder Anweisung nicht erkannt.',
  savedPrompt: 'Prompt „{name}“',
  projectNotRecognized: 'Projekt nicht erkannt.',
  modelNotRecognized: 'Modell „{model}“ nicht erkannt.',
  teamNeedsTwoAgents: 'Für ein Team bitte mindestens zwei Agents nennen.',
  commandNotUnderstood: 'Befehl nicht verstanden.',
  noUsableAnswer: 'Keine verwertbare Antwort.',
  answerUnreadable: 'Antwort konnte nicht gelesen werden.',
  claudeNotFound: 'Claude Code wurde nicht gefunden',
  claudeFailed: 'claude -p fehlgeschlagen: {output}'
}

export default de
