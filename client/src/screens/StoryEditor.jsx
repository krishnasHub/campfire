import { useState } from 'react'
import { postJSON } from '../api.js'
import StoryGraphView from '../components/StoryGraphView.jsx'

const GENRES = ['fantasy', 'sci-fi', 'space-opera', 'cyberpunk', 'post-apocalyptic', 'horror', 'mystery']
const STYLES = ['cinematic-fantasy', 'sci-fi', 'space-opera', 'cyberpunk', 'post-apocalyptic', 'anime', 'highest-quality']

export default function StoryEditor({ onBack, onSaved }) {
  const [seed, setSeed] = useState({ title: '', vibe: '', genre: 'fantasy' })
  const [campaign, setCampaign] = useState(null)
  const [lintR, setLintR] = useState(null)
  const [busy, setBusy] = useState(false)
  const [raw, setRaw] = useState('')
  const [showRaw, setShowRaw] = useState(false)
  const [msg, setMsg] = useState('')

  function apply(next) { setCampaign(next); setRaw(JSON.stringify(next, null, 2)); setLintR(null) }

  async function generate() {
    setBusy(true); setMsg('')
    try {
      const r = await postJSON('/api/campaigns/generate', seed)
      if (r.campaign) { apply(r.campaign); setLintR(r.lint) }
      else setMsg(r.error || 'generation failed')
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const setU = (k, v) => apply({ ...campaign, universe: { ...campaign.universe, [k]: v } })
  const setNode = (i, k, v) => {
    const nodes = campaign.mainQuest.nodes.map((n, j) => j === i ? { ...n, [k]: v } : n)
    apply({ ...campaign, mainQuest: { ...campaign.mainQuest, nodes } })
  }

  async function validate() { setLintR(await postJSON(`/api/campaigns/${campaign.id}/validate`, campaign)) }
  async function save() {
    const r = await postJSON('/api/campaigns', campaign)
    if (r.ok) { setMsg('Saved! It will appear on the start screen.'); onSaved && onSaved() }
    else { setLintR(r); setMsg('Cannot save — fix the errors below.') }
  }
  function applyRaw() {
    try { const c = JSON.parse(raw); setCampaign(c); setLintR(null); setMsg('') }
    catch (e) { setMsg('Invalid JSON: ' + e.message) }
  }

  return (
    <div className="min-h-full max-w-5xl mx-auto px-4 py-8">
      <button onClick={onBack} className="text-stone-500 hover:text-stone-300 text-sm mb-4">← back</button>
      <h1 className="text-3xl font-serif text-ember">Story Editor</h1>
      <p className="text-sm text-stone-400 mt-1">Describe a seed, let the fire imagine it, then tweak. Any genre — fantasy or sci-fi.</p>

      {/* seed */}
      <div className="mt-6 bg-ash-800 border border-ash-600 rounded-lg p-4 grid sm:grid-cols-[1fr_auto] gap-3">
        <div className="grid gap-2">
          <input value={seed.title} onChange={e => setSeed({ ...seed, title: e.target.value })} placeholder="Title (e.g. Neon Requiem)"
            className="bg-ash-900 border border-ash-600 rounded px-3 py-2 text-sm focus:border-ember outline-none" />
          <textarea value={seed.vibe} onChange={e => setSeed({ ...seed, vibe: e.target.value })} rows={2} placeholder="Vibe — a sentence or two about the world and the hook"
            className="bg-ash-900 border border-ash-600 rounded px-3 py-2 text-sm resize-none focus:border-ember outline-none" />
          <select value={seed.genre} onChange={e => setSeed({ ...seed, genre: e.target.value })}
            className="bg-ash-900 border border-ash-600 rounded px-3 py-2 text-sm w-48 focus:border-ember outline-none">
            {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <button onClick={generate} disabled={busy}
          className="bg-ember-dark hover:bg-ember disabled:opacity-40 text-black font-medium rounded px-5 py-2 self-start transition-colors">
          {busy ? 'Imagining…' : '✨ Generate'}
        </button>
      </div>

      {msg && <div className="mt-3 text-sm text-ember">{msg}</div>}

      {campaign && (
        <>
          {/* universe */}
          <section className="mt-6">
            <h2 className="text-lg font-serif text-stone-300 mb-2">Universe</h2>
            <div className="grid sm:grid-cols-2 gap-2">
              <input value={campaign.universe.name} onChange={e => setU('name', e.target.value)} className="bg-ash-800 border border-ash-600 rounded px-3 py-2 text-sm" placeholder="name" />
              <select value={campaign.universe.artStyle} onChange={e => setU('artStyle', e.target.value)} className="bg-ash-800 border border-ash-600 rounded px-3 py-2 text-sm">
                {STYLES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input value={campaign.universe.tone} onChange={e => setU('tone', e.target.value)} className="bg-ash-800 border border-ash-600 rounded px-3 py-2 text-sm sm:col-span-2" placeholder="tone" />
              <textarea value={campaign.universe.primer} onChange={e => setU('primer', e.target.value)} rows={3} className="bg-ash-800 border border-ash-600 rounded px-3 py-2 text-sm sm:col-span-2 resize-none" placeholder="primer" />
            </div>
            <div className="text-xs text-stone-500 mt-2">Roles: {campaign.roles.map(r => `${r.name} (${r.class})`).join(' · ')}</div>
          </section>

          {/* flow map */}
          <section className="mt-6">
            <h2 className="text-lg font-serif text-stone-300 mb-2">Story flow</h2>
            <StoryGraphView campaign={campaign} />
          </section>

          {/* beats */}
          <section className="mt-6">
            <h2 className="text-lg font-serif text-stone-300 mb-2">Beats</h2>
            <div className="space-y-2">
              {campaign.mainQuest.nodes.map((n, i) => (
                <div key={n.id} className="bg-ash-800 border border-ash-600 rounded p-3">
                  <div className="flex items-center gap-2">
                    <input value={n.title} onChange={e => setNode(i, 'title', e.target.value)} className="bg-ash-900 border border-ash-600 rounded px-2 py-1 text-sm font-serif text-stone-100 flex-1" />
                    <span className="text-[10px] uppercase text-stone-500">{n.type}</span>
                  </div>
                  <textarea value={n.setup || ''} onChange={e => setNode(i, 'setup', e.target.value)} rows={2} className="mt-2 w-full bg-ash-900 border border-ash-600 rounded px-2 py-1 text-xs text-stone-400 resize-none" />
                  <div className="text-[10px] text-stone-600 mt-1">{(n.branches || []).filter(b => b.to !== n.id).map(b => `${b.label || '→'} → ${b.to}`).join('  ·  ') || 'ending'}</div>
                </div>
              ))}
            </div>
          </section>

          {/* raw + lint + actions */}
          <section className="mt-6">
            <button onClick={() => setShowRaw(s => !s)} className="text-xs text-stone-400 hover:text-ember">{showRaw ? '▲ hide' : '▼ show'} raw JSON (advanced)</button>
            {showRaw && (
              <div className="mt-2">
                <textarea value={raw} onChange={e => setRaw(e.target.value)} rows={12} className="w-full bg-ash-900 border border-ash-600 rounded px-3 py-2 text-xs font-mono text-stone-300" spellCheck={false} />
                <button onClick={applyRaw} className="mt-1 text-xs border border-ash-600 rounded px-3 py-1 hover:border-ember">apply JSON</button>
              </div>
            )}
          </section>

          {lintR && (
            <div className={`mt-4 text-xs rounded p-3 ${lintR.ok ? 'bg-green-950 text-green-300' : 'bg-red-950 text-red-300'}`}>
              {lintR.ok ? '✓ Valid — no dead-ends, all branches resolve.' : '✗ ' + (lintR.errors || []).join('; ')}
              {lintR.warnings?.length > 0 && <div className="text-amber-400 mt-1">warnings: {lintR.warnings.join('; ')}</div>}
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button onClick={validate} className="border border-ash-600 hover:border-ember rounded px-4 py-2 text-sm">Validate</button>
            <button onClick={save} className="bg-ember-dark hover:bg-ember text-black font-medium rounded px-5 py-2 text-sm transition-colors">Save story</button>
          </div>
        </>
      )}
    </div>
  )
}
