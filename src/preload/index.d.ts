import type { DevHubApi } from '../shared/types'

declare global {
  interface Window {
    api: DevHubApi
  }
}
