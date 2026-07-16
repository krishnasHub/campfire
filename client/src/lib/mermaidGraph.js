// Turn a campaign's node graph into a Mermaid `graph TD` definition — the derived,
// read-only flow map that shows "this choice → this outcome". Self-loops are omitted
// for readability (they're the always-stay catch-alls).
export function campaignToMermaid(campaign) {
  const nodes = campaign?.mainQuest?.nodes || []
  if (!nodes.length) return 'graph TD\n  empty["(no nodes)"]'
  const clean = (s) => String(s || '').replace(/["\n]/g, ' ').slice(0, 30)
  const lines = ['graph TD']
  for (const n of nodes) {
    const label = clean(n.title || n.id)
    lines.push(n.type === 'ending' ? `  ${n.id}(["${label}"])` : `  ${n.id}["${label}"]`)
  }
  for (const n of nodes) {
    for (const b of n.branches || []) {
      if (b.to === n.id) continue
      const lbl = clean(b.label)
      lines.push(lbl ? `  ${n.id} -->|"${lbl}"| ${b.to}` : `  ${n.id} --> ${b.to}`)
    }
  }
  // style endings
  for (const n of nodes) if (n.type === 'ending') lines.push(`  style ${n.id} fill:#78350f,stroke:#f59e0b,color:#fde68a`)
  return lines.join('\n')
}
