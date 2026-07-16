function Bar({ cur, max, color }) {
  const pct = Math.max(0, Math.min(100, (100 * (cur ?? 0)) / (max || 1)))
  return (
    <div className="h-1.5 flex-1 bg-ash-900 rounded overflow-hidden">
      <div className="h-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

export default function PartyPanel({ gameState, campaign, companions }) {
  if (!gameState) return null
  const roleName = (id) => campaign?.roles?.find(r => r.id === id)?.name || id
  const bot = (id) => companions.find(c => c.id === id)
  return (
    <div className="space-y-2">
      {Object.entries(gameState.party).map(([rid, p]) => {
        const b = p.actor === 'user' ? null : bot(p.actor)
        const down = (p.hp ?? 1) <= 0
        return (
          <div key={rid} className={`bg-ash-800 border rounded p-2 text-xs ${down ? 'border-red-900 opacity-60' : 'border-ash-600'}`}>
            <div className="flex items-center justify-between">
              <span className="font-medium text-stone-200">{roleName(rid)}</span>
              <span className="text-[10px] text-stone-500">{p.actor === 'user' ? '★ you' : (b ? `${b.emoji} ${b.name.split(' ')[0]}` : p.actor)}</span>
            </div>
            <div className="mt-1.5 space-y-1">
              <div className="flex items-center gap-1"><span className="w-8 text-[9px] text-stone-500">HP</span><Bar cur={p.hp} max={p.hpMax} color="#ef4444" /><span className="w-10 text-right text-[9px] text-stone-500">{p.hp}/{p.hpMax}</span></div>
              {p.manaMax > 0 && <div className="flex items-center gap-1"><span className="w-8 text-[9px] text-stone-500">MP</span><Bar cur={p.mana} max={p.manaMax} color="#3b82f6" /><span className="w-10 text-right text-[9px] text-stone-500">{p.mana}/{p.manaMax}</span></div>}
              {p.staminaMax > 0 && <div className="flex items-center gap-1"><span className="w-8 text-[9px] text-stone-500">STM</span><Bar cur={p.stamina} max={p.staminaMax} color="#22c55e" /><span className="w-10 text-right text-[9px] text-stone-500">{p.stamina}/{p.staminaMax}</span></div>}
            </div>
            {p.conditions?.length > 0 && <div className="mt-1 text-[9px] text-amber-400">{p.conditions.join(', ')}</div>}
          </div>
        )
      })}
    </div>
  )
}
