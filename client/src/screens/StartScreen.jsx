import { useState } from 'react'
import CompanionCard from '../components/CompanionCard.jsx'

export default function StartScreen({ companions, campaigns, saves, userName, onName, onPlay, onResume, onDelete }) {
  const [name, setName] = useState(userName)
  const activeSaves = saves.filter(s => s.status === 'active')

  return (
    <div className="min-h-full max-w-6xl mx-auto px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-4xl font-serif text-ember">🔥 campfire</h1>
          <p className="text-stone-400 text-sm mt-1">A story RPG played with friends who never leave the table.</p>
        </div>
        <div className="text-right">
          <label className="text-xs text-stone-500 block mb-1">Your name</label>
          <input
            value={name} onChange={e => setName(e.target.value)} onBlur={() => onName(name.trim())}
            placeholder="traveler"
            className="bg-ash-800 border border-ash-600 rounded px-3 py-1.5 text-sm w-40 focus:border-ember outline-none"
          />
        </div>
      </header>

      {activeSaves.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-serif text-stone-300 mb-3">Continue</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeSaves.map(s => (
              <div key={s.sessionId} className="bg-ash-800 border border-ash-600 rounded-lg p-4 flex flex-col">
                <div className="font-serif text-ember">{s.campaignName}</div>
                <div className="text-xs text-stone-500 mb-3">Round {s.round} · {new Date(s.updatedAt).toLocaleString()}</div>
                <div className="mt-auto flex gap-2">
                  <button onClick={() => onResume(s.sessionId)} className="flex-1 bg-ember-dark hover:bg-ember text-black font-medium rounded px-3 py-1.5 text-sm transition-colors">Resume</button>
                  <button onClick={() => onDelete(s.sessionId)} title="Delete" className="text-stone-500 hover:text-red-400 px-2 text-sm">🗑</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mb-10">
        <h2 className="text-lg font-serif text-stone-300 mb-3">Stories</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {campaigns.map(c => (
            <button key={c.id} onClick={() => onPlay(c)}
              className="text-left bg-ash-800 border border-ash-600 hover:border-ember rounded-lg p-5 transition-colors group">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xl font-serif text-stone-100 group-hover:text-ember">{c.name}</h3>
                <span className="text-[10px] uppercase tracking-wide text-stone-500 border border-ash-600 rounded px-2 py-0.5 shrink-0">{c.genre}</span>
              </div>
              <p className="text-xs text-stone-400 mt-2 line-clamp-3">{c.primer}</p>
              <div className="text-[11px] text-stone-500 mt-3">{c.roles.length} roles · {c.mainQuestNodes} beats · {c.sideQuests} side quests</div>
            </button>
          ))}
          {!campaigns.length && <div className="text-stone-500 text-sm">No stories yet.</div>}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-serif text-stone-300 mb-3">Your companions <span className="text-stone-500 text-sm">({companions.length})</span></h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {companions.map(b => <CompanionCard key={b.id} bot={b} />)}
        </div>
      </section>
    </div>
  )
}
