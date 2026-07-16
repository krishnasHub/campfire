const DIALS = ['wit', 'warmth', 'sarcasm', 'drama', 'flirt', 'profanity', 'eros']

export default function MoodSliders({ traits, onChange, compact }) {
  const t = traits || {}
  const set = (k, v) => onChange({ ...t, [k]: Number(v) })
  return (
    <div className={`grid ${compact ? 'grid-cols-1' : 'grid-cols-2'} gap-x-4 gap-y-1`}>
      {DIALS.map(k => (
        <label key={k} className="text-[10px] text-stone-400 flex items-center gap-2">
          <span className="w-14 capitalize shrink-0">{k}</span>
          <input type="range" min="0" max="5" value={t[k] ?? 2} onChange={e => set(k, e.target.value)} className="flex-1 accent-ember" />
          <span className="w-3 text-stone-500 text-right">{t[k] ?? 2}</span>
        </label>
      ))}
    </div>
  )
}
