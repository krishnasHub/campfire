import { useEffect, useState } from 'react'
import { postJSON } from '../api.js'

export default function CharacterSheet({ campaignId, role, actorBot, onClose }) {
  const [portrait, setPortrait] = useState(null)
  const [loadingImg, setLoadingImg] = useState(true)

  useEffect(() => {
    let ok = true
    postJSON(`/api/campaigns/${campaignId}/portrait`, { roleId: role.id })
      .then(r => { if (ok) { setPortrait(r.url || null); setLoadingImg(false) } })
      .catch(() => { if (ok) setLoadingImg(false) })
    return () => { ok = false }
  }, [campaignId, role.id])

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 fade-in" onClick={onClose}>
      <div className="bg-ash-800 border border-ash-600 rounded-lg max-w-lg w-full max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex gap-4 p-4">
          <div className="w-40 shrink-0">
            {loadingImg
              ? <div className="w-40 h-52 bg-ash-900 rounded animate-pulse flex items-center justify-center text-stone-600 text-xs">painting…</div>
              : portrait
                ? <img src={portrait} className="w-40 rounded border border-ash-600" alt={role.name} />
                : <div className="w-40 h-52 bg-ash-900 rounded border border-ash-600 flex items-center justify-center text-stone-600 text-xs text-center px-2">no portrait</div>}
          </div>
          <div className="min-w-0">
            <h3 className="text-xl font-serif text-ember">{role.name}</h3>
            <div className="text-xs text-stone-500">{role.race} · {role.class}</div>
            {actorBot && <div className="text-[11px] text-stone-400 mt-1">played by {actorBot.emoji} {actorBot.name}</div>}
            <div className="flex flex-wrap gap-1 mt-3">
              {Object.entries(role.stats || {}).map(([k, v]) => (
                <span key={k} className="text-[10px] bg-ash-900 rounded px-1.5 py-0.5 text-stone-400 uppercase">{k.slice(0, 3)} {v}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="px-4 pb-4">
          {role.backstory && <p className="text-sm text-stone-300 leading-relaxed">{role.backstory}</p>}
          {role.abilities?.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wide text-stone-500 mb-1">Abilities</div>
              <ul className="space-y-1">
                {role.abilities.map(a => (
                  <li key={a.id} className="text-xs text-stone-400"><span className="text-stone-200">{a.name}</span>{a.desc ? ` — ${a.desc}` : ''}</li>
                ))}
              </ul>
            </div>
          )}
          <button onClick={onClose} className="mt-4 text-xs border border-ash-600 rounded px-4 py-1.5 hover:border-ember">Close</button>
        </div>
      </div>
    </div>
  )
}
