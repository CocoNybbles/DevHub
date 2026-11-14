import { useT } from '../lib/i18n'

interface Props {
  scope: 'global' | 'project'
}

/** Short help below the start-flag fields (settings and project dialog). */
function AgentArgsHelp({ scope }: Props): React.JSX.Element {
  const t = useT()
  return (
    <p className="muted small args-help">
      {scope === 'global' ? t('settings.argsHelpGlobal') : t('settings.argsHelpProject')}{' '}
      {t('settings.argsHelpExamples')} <code>--permission-mode auto</code> ·{' '}
      <code>--model opus</code> · <code>--add-dir &quot;C:\Dev\Shared&quot;</code>.{' '}
      {t('settings.argsHelpApplies')}
    </p>
  )
}

export default AgentArgsHelp
