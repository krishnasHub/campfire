import { useState } from 'react'
import { postJSON } from '../api.js'
import MoodSliders from '../components/MoodSliders.jsx'

function defaultAssign(otherRoles, companions) {
  const a = {}
  otherRoles.forEach((r, i) => { a[r.id] = companions[i % companions.length]?.id })
  return a
}

const STAT_LABELS = { might: 'MGT', agility: 'AGI', wits: 'WIT', presence: 'PRE', resolve: 'RES' }

export default function SetupScreen({ campaign, companions, userName, onBegin, onBack }) {
  const roles = campaign.roles
  const [userRoleId, setUserRoleId] = useState(roles[0].id)
  const otherRoles = roles.filter(r => r.id !== userRoleId)
  const [assignments, setAssignments] = useState(() => defaultAssign(roles.filter(r => r.id !== roles[0].id), companions))
  const [moods, setMoods] = useState({})
  const [openMood, setOpenMood] = useState(null)
  const [busy, setBusy] = useState(false)

  function pickRole(id) {
    setUserRoleId(id)
    setAssignments(defaultAssign(roles.filter(r => r.id !== id), companions))
    setMoods({})
  }
  const assign = (roleId, botId) => setAssignments(a => ({ ...a, [roleId]: botId }))
  const botFor = (roleId) => companions.find(c => c.id === assignments[roleId])
  const moodFor = (roleId) => moods[roleId] || botFor(roleId)?.traits || {}
  const setMood = (roleId, traits) => setMoods(m => ({ ...m, [roleId]: traits }))

  const assigned = Object.values(assignments)
  const hasDupes = new Set(assigned).size !== assigned.length

  async function begin() {
    setBusy(true)
    const resolvedMoods = {}
    for (const rid of Object.keys(assignments)) resolvedMoods[rid] = moodFor(rid)
    const r = await postJSON('/api/game/start', {
      campaignId: campaign.id, userName,
      party: { userRoleId, assignments }, moods: resolvedMoods,
    })
    setBusy(false)
    if (r.sessionId) onBegin(r.sessionId)
  }

  return (
    <div className="min-h-full max-w-5xl mx-auto px-4 py-8">
      <button onClick={onBack} className="text-stone-500 hover:text-stone-300 text-sm mb-4">← back</button>
      <h1 className="text-3xl font-serif text-ember">{campaign.name}</h1>
      <div className="text-xs uppercase tracking-wide text-stone-500 mt-1">{campaign.genre} · {campaign.tone}</div>
      <p className="text-sm text-stone-400 mt-3 max-w-3xl">{campaign.primer}</p>

      <section className="mt-8">
        <h2 className="text-lg font-serif text-stone-300 mb-1">Choose your character</h2>
        <p className="text-xs text-stone-500 mb-3">You play one. Your companions play the rest. Locked once you begin.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {roles.map(r => {
            const mine = r.id === userRoleId
            return (
              <button key={r.id} onClick={() => pickRole(r.id)}
                className={`text-left rounded-lg p-3 border transition-colors ${mine ? 'border-ember bg-ash-700' : 'border-ash-600 bg-ash-800 hover:border-stone-500'}`}>
                <div className="font-serif text-stone-100">{r.name}</div>
                <div className="text-[10px] text-stone-500">{r.race} · {r.class}</div>
                <div className="flex gap-1 mt-2 flex-wrap">
                  {Object.entries(r.stats).map(([k, v]) => (
                    <span key={k} className="text-[9px] bg-ash-900 rounded px-1 py-0.5 text-stone-400">{STAT_LABELS[k]} {v}</span>
                  ))}
                </div>
                <div className="text-[10px] text-ember mt-2">{mine ? '★ You' : 'Companion plays this'}</div>
              </button>
            )
          })}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-serif text-stone-300 mb-3">Assign your companions</h2>
        {hasDupes && <div className="text-xs text-red-400 mb-2">Each companion can only play one role — pick distinct companions.</div>}
        <div className="space-y-2">
          {otherRoles.map(r => {
            const bot = botFor(r.id)
            return (
              <div key={r.id} className="bg-ash-800 border border-ash-600 rounded-lg p-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="min-w-[9rem]">
                    <div className="font-serif text-stone-100">{r.name}</div>
                    <div className="text-[10px] text-stone-500">{r.race} · {r.class}</div>
                  </div>
                  <span className="text-stone-600">←</span>
                  <select value={assignments[r.id] || ''} onChange={e => assign(r.id, e.target.value)}
                    className="bg-ash-900 border border-ash-600 rounded px-2 py-1.5 text-sm text-stone-200 focus:border-ember outline-none">
                    {companions.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                  </select>
                  {bot && <span className="text-[10px] text-stone-500 capitalize">{Object.values(bot.playstyle).slice(0, 3).join(' · ')}</span>}
                  <button onClick={() => setOpenMood(openMood === r.id ? null : r.id)}
                    className="ml-auto text-[11px] text-stone-400 hover:text-ember border border-ash-600 rounded px-2 py-1">
                    🎚 mood {openMood === r.id ? '▲' : '▼'}
                  </button>
                </div>
                {openMood === r.id && (
                  <div className="mt-3 pt-3 border-t border-ash-700">
                    <MoodSliders traits={moodFor(r.id)} onChange={t => setMood(r.id, t)} />
                    <div className="text-[10px] text-stone-600 mt-2">You can retune this any time during play.</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <div className="mt-8 flex justify-end">
        <button onClick={begin} disabled={busy || hasDupes}
          className="bg-ember-dark hover:bg-ember disabled:opacity-40 disabled:hover:bg-ember-dark text-black font-medium rounded px-6 py-2.5 transition-colors">
          {busy ? 'Kindling the fire…' : 'Begin the story →'}
        </button>
      </div>
    </div>
  )
}
