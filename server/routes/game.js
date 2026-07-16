import { Router } from 'express'
import { randomUUID } from 'crypto'
import { getCampaign, campaignSummary } from '../services/campaigns.js'
import { buildInitialState, applyDeltas } from '../services/gameState.js'
import { createSave, loadSave, listSaves, updateMoods, commitRound, loadTranscript, deleteSave, getPortrait, setPortrait } from '../services/saves.js'
import { nodeById, advance, triggeredSideQuests, chooseBranchTrace, conditionFlags } from '../services/storyGraph.js'
import { resolve } from '../services/dice.js'
import { spendCost } from '../services/roles.js'
import { getBaselineTraits, BOTS } from '../services/bots.js'
import { parseIntent, narrateGM, adjudicate, companionInnerRead, companionAction, companionCheckFor, extractImageTag, extractOptions } from '../services/gm.js'
import { generateImage } from '../services/imageGen.js'

const router = Router()

const publicNode = (n) => n && { id: n.id, title: n.title, type: n.type, setup: n.setup, objectives: n.objectives || [] }

// Deterministic scout-order detection so a companion actually obeys "go scout ahead",
// regardless of how the reasoning model classifies its own decision.
const SCOUT_RE = /\b(scout|reconnoit|recon|look ahead|scan ahead|check the (?:road|path|woods|forest|river|way|area|trail|surroundings)|see what(?:'s| is| lies)?\s*(?:ahead|out there)|report back|tell (?:us|me) what you see|survey the|case the|eyes? (?:on|ahead))\b/i
const addressesCompanion = (action, role, botFirst) => {
  const a = action.toLowerCase()
  const roleFirst = (role?.name || '').split(/[\s,]/)[0].toLowerCase()
  return (roleFirst && a.includes(roleFirst)) || (botFirst && a.includes(botFirst.toLowerCase()))
}
const SCOUT_TAGS = new Set(['scout', 'stealth', 'perception', 'ranged'])
const roleAgi = (campaign, roleId) => campaign.roles.find(r => r.id === roleId)?.stats?.agility ?? 0

function groundImagePrompt(campaign, gs, pi) {
  const parts = [pi.prompt]
  if (pi.subject && pi.subject !== 'scene') {
    const role = campaign.roles.find(r => r.id === pi.subject)
    if (role) parts.unshift(`${role.race} ${role.class} named ${role.name}`)
  }
  if (gs.location?.name) parts.push(gs.location.name)
  return parts.join(', ')
}

// ── Saves list (must precede GET /:id) ────────────────────────────────────────
router.get('/saves', (req, res) => {
  const rows = listSaves().map(s => {
    const c = getCampaign(s.campaignId)
    return { ...s, campaignName: c?.universe?.name || s.campaignId }
  })
  res.json(rows)
})

// ── Start a new session (locks the party) ─────────────────────────────────────
router.post('/start', (req, res) => {
  const { campaignId, userName, party, moods } = req.body
  const campaign = getCampaign(campaignId)
  if (!campaign) return res.status(404).json({ error: 'unknown campaign' })
  if (!party?.userRoleId) return res.status(400).json({ error: 'party.userRoleId required' })

  const resolvedMoods = {}
  for (const [roleId, botId] of Object.entries(party.assignments || {})) {
    resolvedMoods[roleId] = (moods && moods[roleId]) || getBaselineTraits(botId)
  }
  const gameState = buildInitialState(campaign, party)
  const sessionId = 'sess_' + randomUUID().slice(0, 8)
  const save = createSave({ sessionId, campaignId, userName, party: { ...party, locked: true }, moods: resolvedMoods, gameState })
  console.log(`[start] session=${sessionId} campaign=${campaignId} — you play ${party.userRoleId}; ${Object.entries(party.assignments || {}).map(([r, b]) => `${b}→${r}`).join(', ')}`)
  res.json({ sessionId, save, campaign: campaignSummary(campaign) })
})

// ── Resume ────────────────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const save = loadSave(req.params.id)
  if (!save) return res.status(404).json({ error: 'not found' })
  const campaign = getCampaign(save.campaignId)
  res.json({
    save,
    transcript: loadTranscript(req.params.id),
    campaign: campaign ? campaignSummary(campaign) : null,
    node: campaign ? publicNode(nodeById(campaign, save.gameState.story.mainNodeId)) : null,
  })
})

// ── Adjust a companion's mood dials (any time) ────────────────────────────────
router.patch('/:id/mood', (req, res) => {
  const save = loadSave(req.params.id)
  if (!save) return res.status(404).json({ error: 'not found' })
  const moods = { ...save.moods, ...(req.body.moods || {}) }
  if (req.body.roleId && req.body.traits) {
    moods[req.body.roleId] = { ...(moods[req.body.roleId] || {}), ...req.body.traits }
  }
  updateMoods(req.params.id, moods)
  res.json({ moods })
})

router.delete('/:id', (req, res) => res.json({ deleted: deleteSave(req.params.id) }))

// Fog-of-war region map — the server applies the fog so spoilers never reach the client.
// visited/current/known places carry name+desc; adjacent-but-unknown places are "hint"
// markers (no name); everything else is omitted. Endings are never hinted.
router.get('/:id/map', (req, res) => {
  const save = loadSave(req.params.id)
  if (!save) return res.status(404).json({ error: 'not found' })
  const campaign = getCampaign(save.campaignId)
  const gs = save.gameState
  const nodes = campaign?.mainQuest?.nodes || []
  const coords = campaign?.map?.nodes || {}
  const completed = new Set(gs.story?.completedNodes || [])
  const current = gs.story?.mainNodeId
  const known = new Set([...(gs.discovered || []), ...completed, current])

  const hints = new Set()
  for (const n of nodes) if (known.has(n.id)) for (const b of n.branches || []) {
    const t = nodeById(campaign, b.to)
    if (t && !known.has(t.id) && t.type !== 'ending' && coords[t.id]) hints.add(t.id)
  }
  const places = []
  for (const n of nodes) {
    const c = coords[n.id]
    if (!c) continue
    let state
    if (n.id === current) state = 'current'
    else if (completed.has(n.id)) state = 'visited'
    else if (known.has(n.id)) state = 'known'
    else if (hints.has(n.id)) state = 'hint'
    else continue
    places.push({
      id: n.id, x: c.x, y: c.y, terrain: c.terrain, state,
      name: state === 'hint' ? null : n.title,
      desc: state === 'hint' ? null : (n.setup || '').slice(0, 240),
    })
  }
  const visible = new Set(places.map(p => p.id))
  const edges = []
  for (const n of nodes) if (visible.has(n.id)) for (const b of n.branches || []) {
    if (b.to !== n.id && visible.has(b.to)) edges.push({ from: n.id, to: b.to, traveled: completed.has(n.id) })
  }
  res.json({ style: campaign?.universe?.artStyle || 'cinematic-fantasy', region: campaign?.universe?.name, places, edges })
})

// Character portrait — generated once per campaign+role, then cached & reused.
router.post('/:id/portrait', async (req, res) => {
  const save = loadSave(req.params.id)
  if (!save) return res.status(404).json({ error: 'not found' })
  const campaign = getCampaign(save.campaignId)
  const role = campaign?.roles?.find(r => r.id === req.body.roleId)
  if (!role) return res.status(400).json({ error: 'unknown role' })
  const key = `${save.campaignId}:${role.id}`
  let url = getPortrait(key)
  if (!url) {
    const prompt = `${role.race} ${role.class} named ${role.name}. ${(role.backstory || '').slice(0, 160)} — character portrait, upper body, looking toward the viewer`
    try {
      console.log(`[portrait] generating ${key}`)
      url = await generateImage(prompt, { artStyle: 'character-portrait', width: 832, height: 1024 })
      setPortrait(key, url)
    } catch (e) { console.error('[portrait]', e.message); return res.status(500).json({ error: e.message }) }
  }
  res.json({ url })
})

// ── Opening scene (streamed GM scene-set) ─────────────────────────────────────
router.post('/:id/opening', async (req, res) => {
  const save = loadSave(req.params.id)
  if (!save) return res.status(404).json({ error: 'not found' })
  const campaign = getCampaign(save.campaignId)
  const gs = save.gameState
  res.setHeader('Content-Type', 'application/x-ndjson')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')
  const send = (o) => res.write(JSON.stringify(o) + '\n')
  console.log(`[opening] session=${req.params.id} node=${gs.story.mainNodeId}`)
  send({ event: 'gm_start' })
  try {
    const userRole = campaign.roles.find(r => r.id === save.party.userRoleId)
    let text = await narrateGM({ campaign, node: nodeById(campaign, gs.story.mainNodeId), gs, opening: true, actorName: userRole?.name, onChunk: ch => send({ event: 'gm_chunk', chunk: ch }) })
    const img = extractImageTag(text)
    const opt = extractOptions(img.cleaned)
    text = opt.cleaned
    send({ event: 'gm_done', content: text })
    if (opt.options.length) send({ event: 'options', options: opt.options })
    commitRound(req.params.id, { gameState: gs, round: 0, transcriptEntries: [{ type: 'gm', text }] })
    if (img.imagePrompt) {
      send({ event: 'image_start', subject: 'scene' })
      try {
        const url = await generateImage(groundImagePrompt(campaign, gs, { subject: 'scene', prompt: img.imagePrompt }), { artStyle: campaign.universe.artStyle })
        send({ event: 'image', subject: 'scene', url })
      } catch (e) { send({ event: 'image', subject: 'scene', url: null }); console.error('[opening image]', e.message) }
    }
    send({ event: 'round_done', round: 0, status: 'active' })
  } catch (e) { console.error('[opening]', e); send({ event: 'error', error: e.message }) }
  res.end()
})

// ── The round orchestrator ────────────────────────────────────────────────────
router.post('/:id/round', async (req, res) => {
  const save = loadSave(req.params.id)
  if (!save) return res.status(404).json({ error: 'not found' })
  const rawAction = (req.body.action || '').trim()
  const pressOnward = !!req.body.advance   // player clicked "Press onward →": allow progress branches
  if (!rawAction && !pressOnward) return res.status(400).json({ error: 'action required' })
  const action = rawAction || 'The party is ready — press onward to whatever comes next.'

  const campaign = getCampaign(save.campaignId)
  const gs = save.gameState
  if (!gs.discovered) gs.discovered = [gs.story.mainNodeId] // back-compat for older saves
  const round = (save.round || 0) + 1
  const node = () => nodeById(campaign, gs.story.mainNodeId)

  res.setHeader('Content-Type', 'application/x-ndjson')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')
  const send = (o) => res.write(JSON.stringify(o) + '\n')
  const transcript = [{ type: 'action', actor: 'user', text: action }]
  const pendingImages = []

  // Log the advance decision (or why it stayed) — the most common "huh?" during play.
  const logAdvance = (who, t) => {
    if (t) { console.log(`[round]   ADVANCE (${who}): ${t.from} -> ${t.to} (${t.label})`); return }
    const tr = chooseBranchTrace(node(), gs)
    console.log(`[round]   stayed at ${node()?.id} (${who})${tr.gate ? ' [objectives-gate ON]' : ''}; branches: ${tr.evaluated.map(e => `${e.id}->${e.to}:${e.pass ? 'PASS' : 'no'}${e.blocked ? '(blk)' : ''}`).join(', ')}`)
  }

  // Advancement: on a normal turn only REACTIVE branches (consequences) can fire, so the
  // story doesn't progress until the player presses onward. On a press-onward turn, all
  // branches are eligible (the player chose to move; the engine still decides where).
  // At most one transition per round either way.
  let advancedThisRound = false
  const tryAdvance = (who) => {
    if (advancedThisRound) return null
    const t = advance(campaign, gs, { reactiveOnly: !pressOnward })
    if (t) { advancedThisRound = true; gs.story.beatTurns = 0 }
    logAdvance(who, t)
    if (t) send({ event: 'node_transition', ...t, node: publicNode(node()) })
    return t
  }

  gs.story.beatTurns = (gs.story.beatTurns || 0) + 1
  send({ event: 'round_start', round })
  console.log(`[round] ═══ session=${req.params.id} round=${round} node=${gs.story.mainNodeId} beatTurn=${gs.story.beatTurns}${pressOnward ? ' PRESS-ONWARD' : ''} action="${action.replace(/\s+/g, ' ').slice(0, 100)}"`)

  try {
    const userRole = campaign.roles.find(r => r.id === save.party.userRoleId)

    // Press-onward commits fresh: clear this beat's tentative progress flags so the
    // player's STATED direction decides where we go — not a stray flag from exploring.
    if (pressOnward) {
      const clear = new Set()
      for (const b of node()?.branches || []) if (!b.reactive) conditionFlags(b.when, clear)
      const cleared = []
      for (const f of clear) if (gs.flags[f]) { gs.flags[f] = false; cleared.push(f) }
      if (cleared.length) console.log(`[round]   press-onward: cleared stale progress flags [${cleared}] to commit fresh`)
    }

    // 1. Intent → optional player check
    let check = null
    const intent = await parseIntent({ campaign, node: node(), gs, actionText: action, userRole })
    if (intent.needsRoll && intent.skill) {
      send({ event: 'check_start', actor: 'user', roleId: save.party.userRoleId, skill: intent.skill, dc: intent.dc })
      const r = resolve({ role: userRole, skill: intent.skill, dc: intent.dc })
      check = { ...r, target: intent.target }
      gs.lastCheck = { skill: intent.skill, target: intent.target, tier: r.tier, total: r.total, dc: r.dc, actor: 'user' }
      send({ event: 'dice_roll', actor: 'user', roleId: save.party.userRoleId, ...r, target: intent.target })
      transcript.push({ type: 'roll', actor: 'user', ...r })
    }

    // 2. GM narration (Pass A)
    send({ event: 'gm_start' })
    let gmText = await narrateGM({ campaign, node: node(), gs, actionText: action, actorName: userRole?.name || 'The player', check, onChunk: ch => send({ event: 'gm_chunk', chunk: ch }) })
    const gmImg = extractImageTag(gmText)
    const gmOpt = extractOptions(gmImg.cleaned)
    gmText = gmOpt.cleaned
    send({ event: 'gm_done', content: gmText })
    if (gmOpt.options.length) send({ event: 'options', options: gmOpt.options })
    transcript.push({ type: 'gm', text: gmText })
    if (gmImg.imagePrompt) pendingImages.push({ subject: 'scene', prompt: gmImg.imagePrompt })

    // 3. Adjudicate (Pass B) + apply
    applyDeltas(gs, await adjudicate({ campaign, node: node(), gs, narration: gmText }))
    send({ event: 'state_update', gameState: gs })
    console.log(`[round]   flags now: [${Object.keys(gs.flags).filter(k => gs.flags[k]).join(', ')}]`)

    // 4. Advance the story graph (turn-gated) + side-quest triggers
    tryAdvance('player')
    for (const sq of triggeredSideQuests(campaign, gs)) {
      gs.story.sideStack.push(`${sq.id}:${sq.entryNodeId}`)
      console.log(`[round]   SIDE QUEST triggered: ${sq.id}`)
      send({ event: 'side_quest', id: sq.id, title: sq.nodes?.[0]?.title || sq.id })
    }

    // 5. Companion turns (initiative-lite by agility)
    let lastNarration = gmText
    const scoutOrder = SCOUT_RE.test(action)
    const roleFirstNames = campaign.roles.map(r => (r.name || '').split(/[\s,]/)[0].toLowerCase()).filter(Boolean)
    const mentionsSomeRole = roleFirstNames.some(n => action.toLowerCase().includes(n))
    const companionRoleIds = Object.entries(gs.party)
      .filter(([, p]) => p.actor !== 'user' && (p.hp ?? 1) > 0)
      .map(([rid]) => rid)
      .sort((a, b) => roleAgi(campaign, b) - roleAgi(campaign, a))

    for (const roleId of companionRoleIds) {
      const botId = gs.party[roleId].actor
      const role = campaign.roles.find(r => r.id === roleId)
      const mood = save.moods?.[roleId] || getBaselineTraits(botId)
      const live = gs.party[roleId]
      console.log(`[round]   -- companion turn: ${botId} as ${roleId} --`)
      send({ event: 'companion_start', botId, roleId })

      let { read, decision } = await companionInnerRead({ campaign, node: node(), gs, botId, mood, role, situation: lastNarration.slice(0, 700), playerAction: action })
      // Deterministic obedience: if the player ordered a scout (and addressed this
      // companion, or gave a generic order and this one is the scout type), force SCOUT.
      if (scoutOrder) {
        const botFirst = BOTS[botId]?.name?.split(' ')[0]
        const scoutTagged = (role.tags || []).some(t => SCOUT_TAGS.has(t))
        if (addressesCompanion(action, role, botFirst) || (!mentionsSomeRole && scoutTagged)) {
          if (decision !== 'SCOUT') console.log(`[round]   ${botId} obeys scout order (was ${decision} → SCOUT)`)
          decision = 'SCOUT'
        }
      }
      if (read) send({ event: 'companion_innerlife', botId, roleId, chunk: read })
      if (decision === 'PASS') {
        send({ event: 'companion_pass', botId, roleId })
        transcript.push({ type: 'companion_pass', botId, roleId })
        continue
      }

      let cCheck = null
      const spec = companionCheckFor(role, decision, live, gs)
      if (spec?.skill) {
        send({ event: 'check_start', actor: botId, roleId, skill: spec.skill, dc: spec.dc })
        const r = resolve({ role, skill: spec.skill, dc: spec.dc })
        cCheck = { ...r, target: spec.target }
        gs.lastCheck = { skill: spec.skill, target: spec.target, tier: r.tier, total: r.total, dc: r.dc, actor: botId, roleId }
        send({ event: 'dice_roll', actor: botId, roleId, ...r, target: spec.target })
        if (spec.ability) gs.party[roleId] = spendCost(live, spec.ability)
        transcript.push({ type: 'roll', actor: botId, roleId, ...r })
      }

      // SCOUT reveals what lies down the paths ahead — lifts fog + gives real intel to report.
      let scoutIntel = null
      if (decision === 'SCOUT') {
        const cur = node()
        const targets = (cur?.branches || []).filter(b => b.to !== cur.id).map(b => nodeById(campaign, b.to)).filter(n => n && n.type !== 'ending')
        const revealed = []
        for (const t of targets) if (!gs.discovered.includes(t.id)) { gs.discovered.push(t.id); revealed.push(t.id) }
        if (targets.length) scoutIntel = targets.map(t => `${t.title} — ${t.setup}`).join('  ||  ')
        if (revealed.length) { send({ event: 'discovered', nodes: revealed }); console.log(`[round]   SCOUT by ${botId} revealed: [${revealed}]`) }
      }

      send({ event: 'companion_action_start', botId, roleId, decision })
      let actText = await companionAction({ campaign, node: node(), gs, botId, mood, role, decision, read, check: cCheck, scoutIntel, onChunk: ch => send({ event: 'companion_chunk', botId, roleId, chunk: ch }) })
      const cImg = extractImageTag(actText)
      actText = cImg.cleaned
      send({ event: 'companion_done', botId, roleId, content: actText })
      transcript.push({ type: 'companion', botId, roleId, decision, text: actText })
      lastNarration = actText
      if (cImg.imagePrompt) pendingImages.push({ subject: roleId, prompt: cImg.imagePrompt })

      applyDeltas(gs, await adjudicate({ campaign, node: node(), gs, narration: actText }))
      send({ event: 'state_update', gameState: gs })
      tryAdvance(botId)
    }

    send({ event: 'all_done' })

    // 6. Images (parallel), grounded in state
    if (pendingImages.length) {
      console.log(`[round]   generating ${pendingImages.length} image(s): ${pendingImages.map(p => p.subject).join(', ')}`)
      await Promise.all(pendingImages.map(async (pi) => {
        send({ event: 'image_start', subject: pi.subject })
        try {
          const url = await generateImage(groundImagePrompt(campaign, gs, pi), { artStyle: campaign.universe.artStyle })
          send({ event: 'image', subject: pi.subject, url })
        } catch (e) { send({ event: 'image', subject: pi.subject, url: null }); console.error('[round image]', e.message) }
      }))
    }

    // 7. Persist (atomic)
    const status = node()?.type === 'ending' ? 'completed' : 'active'
    commitRound(req.params.id, { gameState: gs, round, status, transcriptEntries: transcript })
    console.log(`[round] ═══ persisted round=${round} status=${status} node=${gs.story.mainNodeId} (+${transcript.length} transcript entries)`)
    send({ event: 'round_done', round, status })
  } catch (err) {
    console.error(`[round] ERROR at node=${gs?.story?.mainNodeId} round=${round}:`, err.stack || err.message)
    send({ event: 'error', error: err.message })
  }
  res.end()
})

export default router
