import { useState, useEffect, useRef, useCallback } from 'react'
import { getJSON, patchJSON, streamNDJSON } from '../api.js'
import PartyPanel from '../components/PartyPanel.jsx'
import ObjectiveTracker from '../components/ObjectiveTracker.jsx'
import DiceRoll from '../components/DiceRoll.jsx'
import MoodSliders from '../components/MoodSliders.jsx'
import CharacterSheet from '../components/CharacterSheet.jsx'
import MapView from '../components/MapView.jsx'

const uid = () => Math.random().toString(36).slice(2)
const HELP_KEY = 'cf-help-seen'

export default function PlayScreen({ sessionId, companions, onExit }) {
  const [campaign, setCampaign] = useState(null)
  const [node, setNode] = useState(null)
  const [gameState, setGameState] = useState(null)
  const [party, setParty] = useState(null)
  const [moods, setMoods] = useState({})
  const [feed, setFeed] = useState([])
  const [options, setOptions] = useState([])
  const [staged, setStaged] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('active')
  const [moodOpen, setMoodOpen] = useState(false)
  const [expandRole, setExpandRole] = useState(null)
  const [showMap, setShowMap] = useState(false)
  const [showHelp, setShowHelp] = useState(() => localStorage.getItem(HELP_KEY) !== '1')

  const feedRef = useRef([])
  const gmRef = useRef(null)
  const compRef = useRef(null)
  const scrollRef = useRef(null)

  const botById = useCallback((id) => companions.find(c => c.id === id), [companions])
  const roleName = useCallback((id) => campaign?.roles?.find(r => r.id === id)?.name || id, [campaign])

  const flush = () => setFeed(feedRef.current.slice())
  const push = (item) => { feedRef.current.push({ id: uid(), ...item }); flush() }

  const handleEvent = useCallback((ev) => {
    if (window.__cfDebug) console.debug('[cf]', ev.event, ev)
    if (ev.event === 'error') console.error('[campfire] round error:', ev.error)
    const f = feedRef.current
    switch (ev.event) {
      case 'round_start': setOptions([]); f.push({ id: uid(), type: 'system', text: `— turn ${ev.round} —` }); break
      case 'dice_roll': f.push({ id: uid(), type: 'dice', roll: ev, actor: ev.actor, roleId: ev.roleId }); break
      case 'gm_start': gmRef.current = { id: uid(), type: 'gm', text: '', streaming: true }; f.push(gmRef.current); break
      case 'gm_chunk': if (gmRef.current) gmRef.current.text += ev.chunk; break
      case 'gm_done': if (gmRef.current) { gmRef.current.text = ev.content || gmRef.current.text; gmRef.current.streaming = false; gmRef.current = null } break
      case 'options': setOptions(ev.options || []); break
      case 'node_transition':
        f.push({ id: uid(), type: 'newbeat', title: ev.node?.title, setup: ev.node?.setup, label: ev.label })
        if (ev.node) setNode(ev.node)
        break
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

  const runStream = useCallback(async (body) => {
    setBusy(true); gmRef.current = null; compRef.current = null
    try { await streamNDJSON('/api/game/' + sessionId + '/round', body, handleEvent) }
    catch (e) { push({ type: 'system', text: '⚠ ' + e.message }) }
    finally { setBusy(false) }
  }, [handleEvent, sessionId])

  const runOpening = useCallback(async () => {
    setBusy(true); gmRef.current = null
    try { await streamNDJSON('/api/game/' + sessionId + '/opening', {}, handleEvent) }
    catch (e) { push({ type: 'system', text: '⚠ ' + e.message }) }
    finally { setBusy(false) }
  }, [handleEvent, sessionId])

  useEffect(() => {
    let cancelled = false
    getJSON('/api/game/' + sessionId).then(d => {
      if (cancelled || !d.save) return
      setCampaign(d.campaign); setNode(d.node); setGameState(d.save.gameState)
      setParty(d.save.party); setMoods(d.save.moods || {}); setStatus(d.save.status)
      feedRef.current = (d.transcript || []).map(t => transcriptToFeed(t)).filter(Boolean); flush()
      if (!(d.transcript || []).some(t => t.type === 'gm')) runOpening()
    })
    return () => { cancelled = true }
  }, [sessionId, runOpening])

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [feed])

  function transcriptToFeed(t) {
    if (t.type === 'action') return { id: uid(), type: 'player', text: t.text }
    if (t.type === 'gm') return { id: uid(), type: 'gm', text: t.text }
    if (t.type === 'roll') return { id: uid(), type: 'dice', roll: t, actor: t.actor, roleId: t.roleId }
    if (t.type === 'companion') return { id: uid(), type: 'companion', botId: t.botId, roleId: t.roleId, decision: t.decision, text: t.text }
    if (t.type === 'companion_pass') return { id: uid(), type: 'companion', botId: t.botId, roleId: t.roleId, passed: true }
    return null
  }

  // Stage a line (say/do) into the current turn — the round doesn't run until "End turn".
  function stage(text) {
    const a = (text ?? input).trim()
    if (!a || busy) return
    setStaged(s => [...s, a]); push({ type: 'player', text: a }); setInput(''); setOptions([])
  }
  // End the turn: send everything staged (+ any trailing input). advance=true also lets the story progress.
  function endTurn(advance = false) {
    if (busy || isEnding) return
    const all = [...staged]
    const trailing = input.trim()
    if (trailing) { all.push(trailing); push({ type: 'player', text: trailing }) }
    if (!all.length && !advance) return
    setStaged([]); setInput(''); setOptions([])
    push({ type: 'system', text: advance ? '▸ you press onward…' : '— you end your turn —' })
    runStream({ action: all.join('\n\n') || undefined, advance })
  }
  async function changeMood(roleId, traits) {
    setMoods(m => ({ ...m, [roleId]: traits }))
    await patchJSON('/api/game/' + sessionId + '/mood', { roleId, traits })
  }
  function dismissHelp() { setShowHelp(false); localStorage.setItem(HELP_KEY, '1') }

  const companionRoleIds = party ? Object.keys(party.assignments || {}) : []
  const isEnding = status === 'completed' || node?.type === 'ending'
  const requiredObjs = (node?.objectives || []).filter(o => !o.optional)
  const goalText = requiredObjs.map(o => o.desc).join('  ·  ') || node?.title || ''
  const goalDone = requiredObjs.length > 0 && requiredObjs.every(o => gameState?.flags?.[o.id])
  const expandRoleObj = expandRole && campaign?.roles?.find(r => r.id === expandRole)
  const expandActor = expandRole && party?.assignments?.[expandRole] ? botById(party.assignments[expandRole]) : null

  return (
    <div className="h-full flex flex-col max-w-6xl mx-auto">
      <header className="flex items-center justify-between px-4 py-3 border-b border-ash-700">
        <div><span className="font-serif text-ember">{campaign?.name || 'Loading…'}</span></div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowMap(true)} className="text-xs text-stone-400 hover:text-ember border border-ash-600 rounded px-2 py-1">🗺 map</button>
          <button onClick={() => setMoodOpen(o => !o)} className="text-xs text-stone-400 hover:text-ember border border-ash-600 rounded px-2 py-1">🎚 moods</button>
          <button onClick={onExit} className="text-xs text-stone-400 hover:text-stone-200 border border-ash-600 rounded px-2 py-1">exit</button>
        </div>
      </header>

      {/* current goal banner */}
      {node && (
        <div className="px-4 py-2 border-b border-ash-700 bg-ash-800/40 flex items-center gap-2">
          <span className="text-ember">⚑</span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wide text-stone-500">{isEnding ? 'The end' : 'Current goal'}</div>
            <div className="text-sm text-stone-200 truncate">{goalText}</div>
          </div>
          {goalDone && !isEnding && <span className="text-[10px] text-green-400 whitespace-nowrap animate-pulse">✓ ready — press onward</span>}
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {feed.map(item => <FeedItem key={item.id} item={item} botById={botById} roleName={roleName} />)}
            {busy && <div className="text-stone-600 text-xs blink">the story unfolds</div>}
            {isEnding && <div className="text-center text-ember font-serif py-4">✦ The story has reached an ending. ✦</div>}
          </div>

          {/* suggested actions */}
          {options.length > 0 && !busy && !isEnding && (
            <div className="px-4 pt-2 flex flex-wrap gap-2 items-center">
              <span className="text-[10px] text-stone-600">try:</span>
              {options.map((o, i) => (
                <button key={i} onClick={() => setInput(o)} className="text-xs bg-ash-800 border border-ash-600 hover:border-ember rounded-full px-3 py-1 text-stone-300 transition-colors">{o}</button>
              ))}
            </div>
          )}

          {showHelp && (
            <div className="mx-4 mt-2 text-[11px] text-stone-400 bg-ash-800 border border-ash-600 rounded px-3 py-2 flex items-start gap-2">
              <span>💡</span>
              <span className="flex-1">Type freely — "quotes" for speech, plain text for actions. Press <span className="text-stone-200">Enter</span> to add each line to your turn (say something, then do something…), then <span className="text-ember">End turn</span> to see what happens. Dice roll on their own. Chase the <span className="text-ember">goal</span> over as many turns as you like, then <span className="text-ember">Press onward →</span> to advance the story.</span>
              <button onClick={dismissHelp} className="text-stone-500 hover:text-stone-300">✕</button>
            </div>
          )}

          <div className="border-t border-ash-700 p-3">
            {staged.length > 0 && (
              <div className="text-[11px] text-stone-500 mb-2">Your turn: <span className="text-stone-300">{staged.length}</span> staged · Enter to add more, then <span className="text-ember">End turn</span>.</div>
            )}
            <div className="flex gap-2">
              <textarea
                value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); stage() } }}
                placeholder={isEnding ? 'The tale is told.' : 'Say or do something — Enter to add it to your turn'}
                disabled={busy || isEnding} rows={2}
                className="flex-1 resize-none bg-ash-800 border border-ash-600 rounded px-3 py-2 text-sm focus:border-ember outline-none disabled:opacity-50"
              />
              <div className="flex flex-col gap-2 w-32 shrink-0">
                <button onClick={() => stage()} disabled={busy || isEnding || !input.trim()} title="Add to your turn (Enter)"
                  className="border border-ash-600 hover:border-ember disabled:opacity-30 text-stone-300 rounded px-3 py-1 text-xs transition-colors">+ Add line</button>
                <button onClick={() => endTurn(false)} disabled={busy || isEnding || (!staged.length && !input.trim())}
                  className="bg-ember-dark hover:bg-ember disabled:opacity-40 text-black font-medium rounded px-3 py-1.5 text-sm transition-colors">{busy ? '…' : 'End turn'}</button>
                <button onClick={() => endTurn(true)} disabled={busy || isEnding} title="End turn and move the story forward"
                  className={`border rounded px-3 py-1.5 text-xs transition-colors ${goalDone ? 'border-ember text-ember animate-pulse' : 'border-ash-600 text-stone-400 hover:border-ember hover:text-ember'}`}>Press onward →</button>
              </div>
            </div>
          </div>
        </div>

        <aside className="w-64 border-l border-ash-700 overflow-y-auto p-3 space-y-3 hidden md:block">
          <ObjectiveTracker node={node} gameState={gameState} />
          <div>
            <div className="text-[10px] uppercase tracking-wide text-stone-500 mb-2">Party <span className="text-stone-600">(ⓘ for details)</span></div>
            <PartyPanel gameState={gameState} campaign={campaign} companions={companions} onExpand={setExpandRole} />
          </div>
          {moodOpen && (
            <div className="border-t border-ash-700 pt-3">
              <div className="text-[10px] uppercase tracking-wide text-stone-500 mb-2">Companion moods (live)</div>
              {companionRoleIds.map(rid => {
                const b = botById(party.assignments[rid])
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

      {expandRoleObj && (
        <CharacterSheet sessionId={sessionId} role={expandRoleObj} actorBot={expandActor} onClose={() => setExpandRole(null)} />
      )}
      {showMap && <MapView sessionId={sessionId} onClose={() => setShowMap(false)} />}
    </div>
  )
}

function FeedItem({ item, botById, roleName }) {
  if (item.type === 'system') return <div className="text-center text-[11px] text-stone-600 uppercase tracking-wider">{item.text}</div>
  if (item.type === 'newbeat') return (
    <div className="fade-in border border-ember/30 bg-ember/5 rounded-lg p-3 my-1">
      <div className="text-[10px] uppercase tracking-wide text-ember/80">▸ New goal{item.label ? ` · ${item.label}` : ''}</div>
      <div className="font-serif text-stone-100 mt-0.5">{item.title}</div>
      {item.setup && <div className="text-xs text-stone-400 mt-1">{item.setup}</div>}
    </div>
  )
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
