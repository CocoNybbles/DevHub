/**
 * Translations for main and renderer (no Electron/DOM dependency).
 *
 * - Texts live in `locales/<code>/<namespace>.ts`; English (`locales/en`) is the reference
 *   and the fallback for keys a language does not have.
 * - `t('namespace.key', { name: 'x' })` returns the text in the current language and replaces
 *   `{name}` placeholders.
 * - Plurals: define `key_one` and `key_other` (plus `key_zero`, `key_few` … where a language
 *   needs them) and call `t('namespace.key', { count })`.
 *
 * Adding a language: copy `locales/en` to `locales/<code>`, translate the values and add one
 * entry to `LANGUAGES` below. Nothing else needs to change.
 */
import en from './locales/en'
import de from './locales/de'

/** All texts of one language, grouped by namespace. */
export type Messages = typeof en

/** A language may leave out keys (or whole namespaces); English fills the gaps. */
export type LocaleMessages = { [N in keyof Messages]?: Partial<Messages[N]> }

export interface LanguageDefinition {
  /** Name of the language in that language (shown in the settings) */
  name: string
  /** BCP 47 locale for dates, numbers and plural rules */
  locale: string
  messages: LocaleMessages
}

/** Registered languages. The key is the code saved in `settings.language`. */
export const LANGUAGES = {
  en: { name: 'English', locale: 'en-US', messages: en },
  de: { name: 'Deutsch', locale: 'de-DE', messages: de }
} satisfies Record<string, LanguageDefinition>

export type Language = keyof typeof LANGUAGES
/** Value of `settings.language`: a fixed language or the language of the operating system */
export type LanguageSetting = Language | 'system'

export const FALLBACK_LANGUAGE: Language = 'en'

export const LANGUAGE_CODES = Object.keys(LANGUAGES) as Language[]

type KeysOf<N extends keyof Messages> = `${N}.${keyof Messages[N] & string}`
/** Every key that exists in the English reference, e.g. `common.cancel` */
export type MessageKey = { [N in keyof Messages]: KeysOf<N> }[keyof Messages]
/** Base name of a plural group: `sidebar.agents` for `sidebar.agents_one` / `sidebar.agents_other` */
export type PluralKey = MessageKey extends infer K
  ? K extends `${infer Base}_other`
    ? Base
    : never
  : never
export type TranslationKey = MessageKey | PluralKey
export type TranslationParams = Record<string, string | number>
export type TFunction = (key: TranslationKey, params?: TranslationParams) => string

export function isLanguage(code: unknown): code is Language {
  return typeof code === 'string' && Object.hasOwn(LANGUAGES, code)
}

/** Best registered language for a locale like `de-AT`; null if there is none. */
export function matchLanguage(locale: string | undefined | null): Language | null {
  if (!locale) return null
  const lower = locale.toLowerCase()
  if (isLanguage(lower)) return lower
  const base = lower.split(/[-_]/)[0]
  return isLanguage(base) ? base : null
}

/** Language of the operating system (works in main before `app.ready` and in the renderer). */
export function systemLanguage(): Language {
  try {
    return matchLanguage(Intl.DateTimeFormat().resolvedOptions().locale) ?? FALLBACK_LANGUAGE
  } catch {
    return FALLBACK_LANGUAGE
  }
}

/** Turns the saved setting into a language (unknown or missing values = system language). */
export function resolveLanguage(setting: unknown): Language {
  return isLanguage(setting) ? setting : systemLanguage()
}

let current: Language = systemLanguage()
let pluralRules: Intl.PluralRules | null = null
const listeners = new Set<() => void>()

export function getLanguage(): Language {
  return current
}

/** Locale of the current language for `toLocaleString` and friends */
export function getLocale(): string {
  return LANGUAGES[current].locale
}

/** Name of the current language in English, e.g. for prompts ("Answer in German") */
export function languageNameInEnglish(language: Language = current): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(language) ?? language
  } catch {
    return language
  }
}

export function setLanguage(language: Language): void {
  if (language === current) return
  current = language
  pluralRules = null
  for (const listener of [...listeners]) listener()
}

/** Applies `settings.language` and returns the language now in use. */
export function applyLanguageSetting(setting: unknown): Language {
  setLanguage(resolveLanguage(setting))
  return current
}

/** Calls `listener` whenever the language changes; returns the unsubscribe function. */
export function onLanguageChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function lookup(language: Language, namespace: string, name: string): string | undefined {
  const messages = LANGUAGES[language].messages as Record<
    string,
    Record<string, string> | undefined
  >
  const table = messages[namespace]
  return table && Object.hasOwn(table, name) ? table[name] : undefined
}

function find(namespace: string, name: string): string | undefined {
  return lookup(current, namespace, name) ?? lookup(FALLBACK_LANGUAGE, namespace, name)
}

function pluralCategory(count: number): string {
  pluralRules ??= new Intl.PluralRules(getLocale())
  return pluralRules.select(count)
}

/**
 * Text for `key` in the current language. Missing in that language → English;
 * missing everywhere → the key itself (visible, but never crashes).
 */
export function translate(key: TranslationKey, params?: TranslationParams): string {
  const dot = key.indexOf('.')
  const namespace = key.slice(0, dot)
  const name = key.slice(dot + 1)
  let text = find(namespace, name)
  if (text === undefined && typeof params?.count === 'number') {
    text =
      (params.count === 0 ? find(namespace, `${name}_zero`) : undefined) ??
      find(namespace, `${name}_${pluralCategory(params.count)}`) ??
      find(namespace, `${name}_other`)
  }
  if (text === undefined) return key
  if (!params) return text
  // `{{name}}` (placeholder syntax of the prompt library, quoted in help texts) is left alone
  return text.replace(/(?<!\{)\{(\w+)\}(?!\})/g, (match, param: string) =>
    Object.hasOwn(params, param) ? String(params[param]) : match
  )
}

/** Short name used everywhere outside React components (components use `useT()`). */
export const t: TFunction = translate
