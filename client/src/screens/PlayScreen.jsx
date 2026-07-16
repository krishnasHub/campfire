import { useState, useEffect, useRef, useCallback } from 'react'
import { getJSON, patchJSON, streamNDJSON } from '../api.js'
import PartyPanel from '../components/PartyPanel.jsx'
import ObjectiveTracker from '../components/ObjectiveTracker.jsx'
import DiceRoll from '../components/DiceRoll.jsx'
import MoodSliders from '../components/MoodSliders.jsx'

const uid = () => Math.random().toString(36).slice(2)

export default function PlayScreen({ sessionId, companions, onExit }) {
  const [campaign, setCampaign] = useState(null)
  const [node, setNode] = useState(null)
  const [gameState, setGameState] = useState(null)
  const [party, setParty] = useState(null)
  const [moods, setMoods] = useState({})
  const [feed, setFeed] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('active')
  const [moodOpen, setMoodOpen] = useState(false)

  const feedRef = useRef([])
  const gmRef = useRef(null)
  const compRef = useRef(null)
  const scrollRef = useRef(null)

  const botById = useCallback((id) => companions.find(c => c.id === id), [companions])
  const roleName = useCallback((id) => campaign?.roles?.find(r => r.id === id)?.name || id, [campaign])

  const flush = () => setFeed(feedRef.current.slice())
  const push = (item) => { feedRef.current.push({ id: uid(), ...item }); flush() }

  // ── stream event handler ────────────────────────────────────────────────────
  const handleEvent = useCallback((ev) => {
    if (window.__cfDebug) console.debug('[cf]', ev.event, ev)
    if (ev.event === 'error') console.error('[campfire] round error:', ev.error)
    const f = feedRef.current
    switch (ev.event) {
      case 'round_start': f.push({ id: uid(), type: 'system', text: `— round ${ev.round} —` }); break
      case 'dice_roll': f.push({ id: uid(), type: 'dice', roll: ev, actor: ev.actor, roleId: ev.roleId }); break
      case 'gm_start': gmRef.current = { id: uid(), type: 'gm', text: '', streaming: true }; f.push(gmRef.current); break
      case 'gm_chunk': if (gmRef.current) gmRef.current.text += ev.chunk; break
      case 'gm_done': if (gmRef.current) { gmRef.current.text = ev.content || gmRef.current.text; gmRef.current.streaming = false; gmRef.current = null } break
      case 'node_transition': f.push({ id: uid(), type: 'transition', from: ev.from, to: ev.to, label: ev.label }); if (ev.node) setNode(ev.node); break
      case 'side_quest': f.push({ id: uid(), type: 'side', title: ev.title }); break
      case 'companion_start': compRef.current = { id: uid(), type: 'companion', botId: ev.botId, roleId: ev.roleId, read: '', text: '', decision: null, streaming: true }; f.push(compRef.current); break
      case 'companion_innerlife': if (compRef.current) compRef.current.read = ev.chunk; break
      case 'companion_action_start': if (compRef.current) compRef.current.decision = ev.decision; break
      case 'companion_chunk': if (compRef.current) compRef.current.text += ev.chunk; break
      case 'companion_done': if (compRef.current) { compRef.current.text = ev.content || compRef.current.text; compRef.current.streaming = false; compRef.current = null } break
      case 'companion_pass': if (compRef.current) { compRef.current.passed = true; compRef.current.streaming = false; compRef.current = null } break
      case 'state_update': setGameState({ ...ev.gameState }); break
      case 'image_start': f.push({ id: uid(), type: 'image', subject: ev.subject, loading: true }); break
      case 'image': { const img = [...f].reverse().find(x => x.type === 'image' && x.loading && x.subject === ev.subject); if (img) { img.loading = false; img.url = ev.url } break }
      case 'round_done': setStatus(ev.status); break
      case 'error': f.push({ id: uid(), type: 'system', text: '⚠ ' + ev.error }); break
      default: break
    }
    flush()
  }, [])

  const runStream = useCallback(async (url, body) => {
    setBusy(true); gmRef.current = null; compRef.current = null
    try { await streamNDJSON(url, body, handleEvent) }
    catch (e) { push({ type: 'system', text: '⚠ ' + e.message }) }
    finally { setBusy(false) }
  }, [handleEvent])

  // ── initial load / opening ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    getJSON('/api/game/' + sessionId).then(d => {
      if (cancelled || !d.save) return
      setCampaign(d.campaign); setNode(d.node); setGameState(d.save.gameState)
      setParty(d.save.party); setMoods(d.save.moods || {}); setStatus(d.save.status)
      const hist = (d.transcript || []).map(t => transcriptToFeed(t)).filter(Boolean)
      feedRef.current = hist; flush()
      const hasGM = (d.transcript || []).some(t => t.type === 'gm')
      if (!hasGM) runStream('/api/game/' + sessionId + '/opening', {})
    })
    return () => { cancelled = true }
  }, [sessionId, runStream])

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [feed])

  function transcriptToFeed(t) {
    if (t.type === 'action') return { id: uid(), type: 'player', text: t.text }
    if (t.type === 'gm') return { id: uid(), type: 'gm', text: t.text }
    if (t.type === 'roll') return { id: uid(), type: 'dice', roll: t, actor: t.actor, roleId: t.roleId }
    if (t.type === 'companion') return { id: uid(), type: 'companion', botId: t.botId, roleId: t.roleId, decision: t.decision, text: t.text }
    if (t.type === 'companion_pass') return { id: uid(), type: 'companion', botId: t.botId, roleId: t.roleId, passed: true }
    return null
  }

  function send() {
    const a = input.trim()
    if (!a || busy) return
    setInput(''); push({ type: 'player', text: a })
    runStream('/api/game/' + sessionId + '/round', { action: a })
  }

  async function changeMood(roleId, traits) {
    setMoods(m => ({ ...m, [roleId]: traits }))
    await patchJSON('/api/game/' + sessionId + '/mood', { roleId, traits })
  }

  const companionRoleIds = party ? Object.keys(party.assignments || {}) : []
  const isEnding = status === 'completed' || node?.type === 'ending'

  return (
    <div className="h-full flex flex-col max-w-6xl mx-auto">
      <header className="flex items-center justify-between px-4 py-3 border-b border-ash-700">
        <div>
          <span className="font-serif text-ember">{campaign?.name || 'Loading…'}</span>
          <span className="text-stone-600 text-xs ml-2">{node?.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setMoodOpen(o => !o)} className="text-xs text-stone-400 hover:text-ember border border-ash-600 rounded px-2 py-1">🎚 moods</button>
          <button onClick={onExit} className="text-xs text-stone-400 hover:text-stone-200 border border-ash-600 rounded px-2 py-1">exit</button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* main feed */}
        <div className="flex-1 flex flex-col min-w-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {feed.map(item => <FeedItem key={item.id} item={item} botById={botById} roleName={roleName} />)}
            {busy && <div className="text-stone-600 text-xs blink">the story unfolds</div>}
            {isEnding && <div className="text-center text-ember font-serif py-4">✦ The story has reached an ending. ✦</div>}
          </div>
          <div className="border-t border-ash-700 p-3">
            <div className="flex gap-2">
              <textarea
                value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder={isEnding ? 'The tale is told.' : 'What do you do?  (quote "spoken words"; describe actions plainly)'}
                disabled={busy || isEnding} rows={2}
                className="flex-1 resize-none bg-ash-800 border border-ash-600 rounded px-3 py-2 text-sm focus:border-ember outline-none disabled:opacity-50"
              />
              <button onClick={send} disabled={busy || isEnding || !input.trim()}
                className="bg-ember-dark hover:bg-ember disabled:opacity-40 text-black font-medium rounded px-5 self-stretch transition-colors">
                {busy ? '…' : 'Act'}
              </button>
            </div>
          </div>
        </div>

        {/* sidebar */}
        <aside className="w-64 border-l border-ash-700 overflow-y-auto p-3 space-y-3 hidden md:block">
          <ObjectiveTracker node={node} gameState={gameState} />
          <div>
            <div className="text-[10px] uppercase tracking-wide text-stone-500 mb-2">Party</div>
            <PartyPanel gameState={gameState} campaign={campaign} companions={companions} />
          </div>
          {moodOpen && (
            <div className="border-t border-ash-700 pt-3">
              <div className="text-[10px] uppercase tracking-wide text-stone-500 mb-2">Companion moods (live)</div>
              {companionRoleIds.map(rid => {
                const botId = party.assignments[rid]
                const b = botById(botId)
                return (
                  <div key={rid} className="mb-3">
                    <div className="text-xs text-stone-300 mb-1">{b?.emoji} {roleName(rid)} <span className="text-stone-600">as {b?.name.split(' ')[0]}</span></div>
                    <MoodSliders compact traits={moods[rid] || b?.traits || {}} onChange={t => changeMood(rid, t)} />
                  </div>
                )
              })}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

// ── feed item renderer ────────────────────────────────────────────────────────
function FeedItem({ item, botById, roleName }) {
  if (item.type === 'system') return <div className="text-center text-[11px] text-stone-600 uppercase tracking-wider">{item.text}</div>
  if (item.type === 'transition') return <div className="text-center text-xs text-ember/80">▸ {item.label || `${item.from} → ${item.to}`}</div>
  if (item.type === 'side') return <div className="text-center text-xs text-purple-400">✦ Side quest: {item.title}</div>
  if (item.type === 'player') return (
    <div className="flex justify-end fade-in"><div className="bg-ash-700 border border-ash-600 rounded-lg px-3 py-2 text-sm max-w-[80%] text-stone-200">{item.text}</div></div>
  )
  if (item.type === 'dice') {
    const name = item.actor === 'user' ? 'You' : (botById(item.actor)?.name.split(' ')[0] || item.actor)
    return <DiceRoll roll={item.roll} actorName={name} />
  }
  if (item.type === 'gm') return (
    <div className="fade-in text-stone-300 leading-relaxed whitespace-pre-wrap font-serif">
      <span className={item.streaming ? 'blink' : ''}>{item.text}</span>
    </div>
  )
  if (item.type === 'image') return (
    <div className="fade-in">
      {item.loading ? <div className="w-full max-w-md h-40 bg-ash-800 border border-ash-600 rounded animate-pulse flex items-center justify-center text-stone-600 text-xs">conjuring image…</div>
        : item.url ? <img src={item.url} alt="scene" className="rounded-lg border border-ash-600 max-w-md w-full" />
          : null}
    </div>
  )
  if (item.type === 'companion') {
    const b = botById(item.botId)
    return (
      <div className="fade-in border-l-2 pl-3" style={{ borderColor: b?.color || '#57534e' }}>
        <div className="flex items-center gap-1.5 text-xs">
          <span>{b?.emoji}</span>
          <span className="font-medium text-stone-200">{b?.name.split(' ')[0]}</span>
          <span className="text-stone-600">as {roleName(item.roleId)}</span>
          {item.decision && <span className="text-[9px] uppercase bg-ash-700 text-stone-400 rounded px-1.5 py-0.5">{item.decision}</span>}
        </div>
        {item.read && <div className="text-[11px] italic text-stone-500 mt-1">💭 {item.read}</div>}
        {item.passed ? <div className="text-xs text-stone-600 mt-1">…stays quiet.</div>
          : <div className="text-sm text-stone-300 mt-1 whitespace-pre-wrap">{item.text}<span className={item.streaming ? 'blink' : ''} /></div>}
      </div>
    )
  }
  return null
}
