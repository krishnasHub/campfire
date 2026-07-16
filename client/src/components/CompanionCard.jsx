export default function CompanionCard({ bot, compact }) {
  if (!bot) return null
  return (
    <div className="bg-ash-800 border border-ash-600 rounded-lg p-3" style={{ borderLeftColor: bot.color, borderLeftWidth: 3 }}>
      <div className="flex items-center gap-2">
        <span className="text-xl">{bot.emoji}</span>
        <div className="min-w-0">
          <div className="font-medium text-stone-100 truncate">{bot.name}</div>
          <div className="text-[10px] text-stone-500">{bot.heritage} · {bot.gender}</div>
        </div>
      </div>
      {!compact && (
        <>
          <p className="text-xs text-stone-400 mt-2">{bot.shortBio}</p>
          <div className="flex flex-wrap gap-1 mt-2">
            {bot.fandoms.map(f => <span key={f} className="text-[9px] bg-ash-700 text-stone-400 rounded px-1.5 py-0.5">{f}</span>)}
          </div>
          <div className="text-[10px] text-stone-500 mt-2 capitalize">{Object.values(bot.playstyle).join(' · ')}</div>
        </>
      )}
    </div>
  )
}
