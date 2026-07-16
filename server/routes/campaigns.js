import { Router } from 'express'
import { listCampaigns, getCampaign, campaignSummary, saveCampaign } from '../services/campaigns.js'
import { generateCampaign } from '../services/storyGen.js'
import { lint } from '../services/storyGraph.js'
import { generateImage } from '../services/imageGen.js'
import { getPortrait, setPortrait, getSnapshots, setSnapshots } from '../services/saves.js'

const router = Router()

// Build 5 evocative, spoiler-safe snapshot prompts from the campaign (2 landscapes,
// 2 hero shots, 1 mood) — a mix of aspect ratios.
function snapshotSpecs(campaign) {
  const u = campaign.universe
  const world = `${u.name}, ${u.genre}, ${u.tone}`
  const start = campaign.mainQuest?.nodes?.find(n => n.id === campaign.mainQuest.startNodeId)
  const startSetup = (start?.setup || '').slice(0, 160)
  const specs = [
    { prompt: `${world} — a sweeping establishing landscape, wide cinematic vista, no visible characters`, w: 1216, h: 832 },
    { prompt: `${startSetup} — atmospheric wide establishing shot`, w: 1216, h: 832 },
    { prompt: `${(u.primer || '').slice(0, 150)} — ominous, atmospheric, ${u.tone}`, w: 1216, h: 832 },
  ]
  for (const r of (campaign.roles || []).slice(0, 2)) {
    specs.push({ prompt: `${r.race} ${r.class} named ${r.name}, dramatic hero shot in the world of ${u.name}`, w: 832, h: 1216 })
  }
  return specs.slice(0, 5)
}

// GET /api/campaigns — summaries for the start/setup screens
router.get('/', (req, res) => res.json(listCampaigns()))

// GET /api/campaigns/:id — summary, or ?full=1 for the raw campaign (editor)
router.get('/:id', (req, res) => {
  const c = getCampaign(req.params.id)
  if (!c) return res.status(404).json({ error: 'not found' })
  res.json(req.query.full ? c : campaignSummary(c))
})

// POST /api/campaigns/:id/validate — lint a campaign (body, or the stored one)
router.post('/:id/validate', (req, res) => {
  const campaign = req.body && req.body.id ? req.body : getCampaign(req.params.id)
  if (!campaign) return res.status(404).json({ error: 'not found' })
  res.json(lint(campaign))
})

// POST /api/campaigns — create/update (Story Editor); lint-gated before write
router.post('/', (req, res) => {
  const result = saveCampaign(req.body)
  res.status(result.ok ? 200 : 400).json(result)
})

// POST /api/campaigns/:id/portrait — character portrait, cached per campaign+role
router.post('/:id/portrait', async (req, res) => {
  const campaign = getCampaign(req.params.id)
  const role = campaign?.roles?.find(r => r.id === req.body.roleId)
  if (!role) return res.status(400).json({ error: 'unknown role' })
  const key = `${campaign.id}:${role.id}`
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

// GET /api/campaigns/:id/snapshots?refresh=1 — 5 cached snapshots, generated IN PARALLEL
router.get('/:id/snapshots', async (req, res) => {
  const campaign = getCampaign(req.params.id)
  if (!campaign) return res.status(404).json({ error: 'not found' })
  if (!req.query.refresh) {
    const cached = getSnapshots(campaign.id)
    if (cached?.length) return res.json({ urls: cached })
  }
  const specs = snapshotSpecs(campaign)
  console.log(`[snapshots] generating ${specs.length} for ${campaign.id} in parallel`)
  const urls = (await Promise.all(specs.map(s =>
    generateImage(s.prompt, { artStyle: campaign.universe.artStyle, width: s.w, height: s.h })
      .catch(e => { console.error('[snapshots]', e.message); return null })
  ))).filter(Boolean)
  setSnapshots(campaign.id, urls)
  res.json({ urls })
})

// POST /api/campaigns/generate — AI authoring (returns a lint-clean draft, not saved)
router.post('/generate', async (req, res) => {
  try {
    const { title, vibe, genre } = req.body || {}
    const result = await generateCampaign({ title, vibe, genre })
    res.json(result)
  } catch (err) {
    console.error('[generate]', err)
    res.status(500).json({ error: err.message })
  }
})

export default router
