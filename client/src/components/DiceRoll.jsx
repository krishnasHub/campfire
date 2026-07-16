const TIER_COLOR = { crit: '#22c55e', success: '#84cc16', partial: '#eab308', fail: '#f97316', fumble: '#ef4444' }

export default function DiceRoll({ roll, actorName }) {
  return (
    <div className="flex items-center gap-2 text-xs my-1 fade-in">
      <span className="dice-rolling inline-block w-6 h-6 rounded bg-ash-700 border border-ash-600 text-center leading-6 font-bold text-ember">{roll.d20}</span>
      <span className="text-stone-400">{actorName} · {roll.skill}</span>
      <span className="text-stone-600 hidden sm:inline">{roll.d20}{roll.mod ? `+${roll.mod}` : ''}{roll.prof ? `+${roll.prof}` : ''} = {roll.total} vs DC {roll.dc}</span>
      <span className="ml-auto text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ color: '#000', background: TIER_COLOR[roll.tier] || '#78716c' }}>{roll.tier}</span>
    </div>
  )
}
