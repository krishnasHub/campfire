export default function ObjectiveTracker({ node, gameState }) {
  if (!node) return null
  return (
    <div className="bg-ash-800 border border-ash-600 rounded p-3">
      <div className="text-[10px] uppercase tracking-wide text-stone-500">Current beat</div>
      <div className="font-serif text-stone-100 text-sm mt-0.5">{node.title}</div>
      {node.type === 'ending' && <div className="text-ember text-xs mt-1">✦ An ending</div>}
      <ul className="mt-2 space-y-1">
        {(node.objectives || []).map(o => {
          const done = gameState?.flags?.[o.id]
          return (
            <li key={o.id} className={`text-xs flex items-start gap-1.5 ${done ? 'text-stone-500 line-through' : 'text-stone-300'}`}>
              <span>{done ? '☑' : '☐'}</span>
              <span>{o.desc}{o.optional ? ' (optional)' : ''}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
