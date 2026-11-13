/**
 * May this language be remembered and forced for the next recording?
 *
 * Never English: with `-l en` whisper silently translates other languages into English,
 * and does so with high confidence (measured: German speech → English text, p = 0.66) – the
 * confidence check doesn't notice. Any other forced language, on the other hand, yields a low
 * p (≈ 0.5) when the speech is in a different language → a new detection follows.
 */
export const canRememberLanguage = (code: string | null | undefined): code is string =>
  !!code && code !== 'en'

/** Options for "voice input language" (whisper codes) */
export const FIXED_LANGUAGES = ['de', 'en'] as const
