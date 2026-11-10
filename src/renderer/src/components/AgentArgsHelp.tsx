interface Props {
  scope: 'global' | 'project'
}

/** Kurzhilfe unter den Start-Flag-Feldern (Einstellungen und Projektdialog). */
function AgentArgsHelp({ scope }: Props): React.JSX.Element {
  return (
    <p className="muted small args-help">
      {scope === 'global'
        ? 'Werden an jeden neu gestarteten oder wiederhergestellten Agent übergeben. '
        : 'Ergänzen die globalen Flags aus den Einstellungen; gleichnamige Flags ersetzen die globalen. '}
      Beispiele: <code>--permission-mode auto</code> · <code>--model opus</code> ·{' '}
      <code>--add-dir &quot;C:\Dev\Shared&quot;</code>. Gilt ab dem nächsten Agent-Start.
    </p>
  )
}

export default AgentArgsHelp
