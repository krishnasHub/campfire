import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { campaignToMermaid } from '../lib/mermaidGraph.js'

mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose', flowchart: { curve: 'basis' } })

let counter = 0

export default function StoryGraphView({ campaign }) {
  const [svg, setSvg] = useState('')
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    const def = campaignToMermaid(campaign)
    mermaid.render('storygraph-' + (counter++), def)
      .then(r => { if (alive) { setSvg(r.svg); setErr(null) } })
      .catch(e => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [campaign])

  if (err) return <div className="text-xs text-red-400 p-3">graph render error: {err}</div>
  return <div className="overflow-auto bg-ash-900 rounded border border-ash-600 p-3 [&_svg]:max-w-none" dangerouslySetInnerHTML={{ __html: svg }} />
}
