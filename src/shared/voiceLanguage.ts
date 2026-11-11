/**
 * Darf diese Sprache gemerkt und bei der nächsten Aufnahme vorgegeben werden?
 *
 * Englisch nie: Mit `-l en` übersetzt whisper andere Sprachen stillschweigend ins Englische,
 * und das mit hoher Konfidenz (gemessen: deutsche Sprache → englischer Text, p = 0,66) – die
 * Konfidenz-Prüfung bemerkt das nicht. Eine andere vorgegebene Sprache ergibt bei falscher
 * Sprache dagegen niedriges p (≈ 0,5) → es folgt eine neue Erkennung.
 */
export const canRememberLanguage = (code: string | null | undefined): code is string =>
  !!code && code !== 'en'

/** Auswahl „Sprache der Spracheingabe“ (whisper-Codes) */
export const FIXED_LANGUAGES = ['de', 'en'] as const
