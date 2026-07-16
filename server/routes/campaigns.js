import { Router } from 'express'
import { listCampaigns, getCampaign, campaignSummary, saveCampaign } from '../services/campaigns.js'
import { generateCampaign } from '../services/storyGen.js'
import { lint } from '../services/storyGraph.js'

const router = Router()

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
