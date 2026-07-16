import { Router } from 'express'
import { randomUUID } from 'crypto'
import { getCampaign, campaignSummary } from '../services/campaigns.js'
import { buildInitialState, applyDeltas } from '../services/gameState.js'
import { createSave, loadSave, listSaves, updateMoods, commitRound, loadTranscript, deleteSave } from '../services/saves.js'
import { nodeById, advance, triggeredSideQuests } from '../services/storyGraph.js'
import { resolve } from '../services/dice.js'
import { spendCost } from '../services/roles.js'
import { getBaselineTraits } from '../services/bots.js'
import { parseIntent, narrateGM, adjudicate, companionInnerRead, companionAction, companionCheckFor, extractImageTag } from '../services/gm.js'
import { generateImage } from '../services/imageGen.js'

const router = Router()

const publicNode = (n) => n && { id: n.id, title: n.title, type: n.type, objectives: n.objectives || [] }
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
  send({ event: 'gm_start' })
  try {
    let text = await narrateGM({ campaign, node: nodeById(campaign, gs.story.mainNodeId), gs, opening: true, onChunk: ch => send({ event: 'gm_chunk', chunk: ch }) })
    const { cleaned, imagePrompt } = extractImageTag(text)
    text = cleaned
    send({ event: 'gm_done', content: text })
    commitRound(req.params.id, { gameState: gs, round: 0, transcriptEntries: [{ type: 'gm', text }] })
    if (imagePrompt) {
      send({ event: 'image_start', subject: 'scene' })
      try {
        const url = await generateImage(groundImagePrompt(campaign, gs, { subject: 'scene', prompt: imagePrompt }), { artStyle: campaign.universe.artStyle })
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
  const { action } = req.body
  if (!action?.trim()) return res.status(400).json({ error: 'action required' })

  const campaign = getCampaign(save.campaignId)
  const gs = save.gameState
  const round = (save.round || 0) + 1
  const node = () => nodeById(campaign, gs.story.mainNodeId)

  res.setHeader('Content-Type', 'application/x-ndjson')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')
  const send = (o) => res.write(JSON.stringify(o) + '\n')
  const transcript = [{ type: 'action', actor: 'user', text: action }]
  const pendingImages = []

  send({ event: 'round_start', round })

  try {
    const userRole = campaign.roles.find(r => r.id === save.party.userRoleId)

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
    gmText = gmImg.cleaned
    send({ event: 'gm_done', content: gmText })
    transcript.push({ type: 'gm', text: gmText })
    if (gmImg.imagePrompt) pendingImages.push({ subject: 'scene', prompt: gmImg.imagePrompt })

    // 3. Adjudicate (Pass B) + apply
    applyDeltas(gs, await adjudicate({ campaign, node: node(), gs, narration: gmText }))
    send({ event: 'state_update', gameState: gs })

    // 4. Advance the story graph + side-quest triggers
    const t = advance(campaign, gs)
    if (t) send({ event: 'node_transition', ...t, node: publicNode(node()) })
    for (const sq of triggeredSideQuests(campaign, gs)) {
      gs.story.sideStack.push(`${sq.id}:${sq.entryNodeId}`)
      send({ event: 'side_quest', id: sq.id, title: sq.nodes?.[0]?.title || sq.id })
    }

    // 5. Companion turns (initiative-lite by agility)
    let lastNarration = gmText
    const companionRoleIds = Object.entries(gs.party)
      .filter(([, p]) => p.actor !== 'user' && (p.hp ?? 1) > 0)
      .map(([rid]) => rid)
      .sort((a, b) => roleAgi(campaign, b) - roleAgi(campaign, a))

    for (const roleId of companionRoleIds) {
      const botId = gs.party[roleId].actor
      const role = campaign.roles.find(r => r.id === roleId)
      const mood = save.moods?.[roleId] || getBaselineTraits(botId)
      const live = gs.party[roleId]
      send({ event: 'companion_start', botId, roleId })

      const { read, decision } = await companionInnerRead({ campaign, node: node(), gs, botId, mood, role, situation: lastNarration.slice(0, 700) })
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

      send({ event: 'companion_action_start', botId, roleId, decision })
      let actText = await companionAction({ campaign, node: node(), gs, botId, mood, role, decision, read, check: cCheck, onChunk: ch => send({ event: 'companion_chunk', botId, roleId, chunk: ch }) })
      const cImg = extractImageTag(actText)
      actText = cImg.cleaned
      send({ event: 'companion_done', botId, roleId, content: actText })
      transcript.push({ type: 'companion', botId, roleId, decision, text: actText })
      lastNarration = actText
      if (cImg.imagePrompt) pendingImages.push({ subject: roleId, prompt: cImg.imagePrompt })

      applyDeltas(gs, await adjudicate({ campaign, node: node(), gs, narration: actText }))
      send({ event: 'state_update', gameState: gs })
      const t2 = advance(campaign, gs)
      if (t2) send({ event: 'node_transition', ...t2, node: publicNode(node()) })
    }

    send({ event: 'all_done' })

    // 6. Images (parallel), grounded in state
    if (pendingImages.length) {
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
    send({ event: 'round_done', round, status })
  } catch (err) {
    console.error('[round] error', err)
    send({ event: 'error', error: err.message })
  }
  res.end()
})

export default router
