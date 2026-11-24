import './assets/main.css'
import './assets/components.css'
import './assets/workbench.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { syncLanguage } from './lib/i18n'

// The saved language has to be known before the first render (otherwise the login check
// would flash in the system language first).
window.api.settings
  .get()
  .then((settings) => syncLanguage(settings.language))
  .catch(() => undefined)
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  })
