import { useMemo, useSyncExternalStore } from 'react'
import {
  applyLanguageSetting,
  getLanguage,
  getLocale,
  onLanguageChange,
  translate,
  type Language,
  type TFunction
} from '../../../shared/i18n'

/** Current language; the component re-renders when it changes. */
export function useLanguage(): Language {
  return useSyncExternalStore(onLanguageChange, getLanguage)
}

/**
 * Translation function for components. Subscribes the component to language changes;
 * the returned function changes identity with the language, so it works as a hook dependency.
 */
export function useT(): TFunction {
  const language = useLanguage()
  return useMemo<TFunction>(() => {
    void language
    return (key, params) => translate(key, params)
  }, [language])
}

/** Applies `settings.language` in the renderer (texts, `<html lang>`). */
export function syncLanguage(setting: unknown): void {
  applyLanguageSetting(setting)
  document.documentElement.lang = getLocale()
}
