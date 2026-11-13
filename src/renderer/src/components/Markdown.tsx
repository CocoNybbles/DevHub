/**
 * Small Markdown renderer without dependencies (agents' plans, daily report): headings,
 * lists with checkboxes, code blocks, `code` and **bold**. Everything else (tables, links) stays text.
 * Builds React elements – HTML from the text is never inserted.
 */

function inline(text: string): React.ReactNode[] {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, i) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
        return <code key={i}>{part.slice(1, -1)}</code>
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
        return <strong key={i}>{part.slice(2, -2)}</strong>
      return part
    })
}

interface Item {
  indent: number
  ordered: boolean
  /** undefined = no checkbox */
  checked?: boolean
  text: string
}

function Markdown({ text }: { text: string }): React.JSX.Element {
  const blocks: React.ReactNode[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let paragraph: string[] = []
  let items: Item[] = []
  let key = 0

  const flushParagraph = (): void => {
    if (paragraph.length) blocks.push(<p key={key++}>{inline(paragraph.join(' '))}</p>)
    paragraph = []
  }
  const flushItems = (): void => {
    if (items.length) {
      blocks.push(
        <ul key={key++} className="md-list">
          {items.map((it, i) => (
            <li
              key={i}
              className={it.checked !== undefined ? 'md-check' : it.ordered ? 'md-ordered' : ''}
              style={{ marginLeft: it.indent * 16 }}
            >
              {it.checked !== undefined && (
                <span className={`md-box ${it.checked ? 'checked' : ''}`}>
                  {it.checked ? '✓' : ''}
                </span>
              )}
              <span className={it.checked ? 'md-done' : ''}>{inline(it.text)}</span>
            </li>
          ))}
        </ul>
      )
    }
    items = []
  }
  const flush = (): void => {
    flushParagraph()
    flushItems()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      flush()
      const code: string[] = []
      for (i++; i < lines.length && !lines[i].trimStart().startsWith(fence[1]); i++)
        code.push(lines[i])
      blocks.push(
        <pre key={key++} className="md-code">
          {code.join('\n')}
        </pre>
      )
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      const level = heading[1].length
      blocks.push(
        <div key={key++} className={`md-h md-h${level}`}>
          {inline(heading[2])}
        </div>
      )
      continue
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line)
    if (item) {
      flushParagraph()
      items.push({
        indent: Math.floor(item[1].replace(/\t/g, '  ').length / 2),
        ordered: /\d/.test(item[2]),
        checked: item[3] === undefined ? undefined : item[3] !== ' ',
        text: /\d/.test(item[2]) ? `${item[2]} ${item[4]}` : item[4]
      })
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      // Table row: unchanged, in monospace
      flush()
      blocks.push(
        <pre key={key++} className="md-table">
          {line}
        </pre>
      )
      continue
    }
    // Continuation line of a list item
    if (items.length && /^\s+/.test(line)) items[items.length - 1].text += ' ' + line.trim()
    else {
      flushItems()
      paragraph.push(line.trim())
    }
  }
  flush()
  return <div className="markdown">{blocks}</div>
}

export default Markdown
