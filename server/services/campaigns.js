// ─────────────────────────────────────────────────────────────────────────────
// CAMPAIGNS — load authored campaign JSON from data/campaigns/. Authored content
// lives as git-friendly files (the Story Editor writes them); only runtime saves
// live in SQLite. On load, a campaign's bespoke skill→stat mappings are registered.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { registerSkillStats } from './dice.js'
import { lint } from './storyGraph.js'

const CAMP_DIR = join(dirname(fileURLToPath(import.meta.url)), '../data/campaigns')
const cache = new Map()

function loadFile(id) {
  const path = join(CAMP_DIR, `${id}.json`)
  if (!existsSync(path)) return null
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (raw.universe?.skillStats) registerSkillStats(raw.universe.skillStats)
  return raw
}

export function getCampaign(id) {
  if (!cache.has(id)) {
    const c = loadFile(id)
    if (!c) return null
    cache.set(id, c)
  }
  return cache.get(id)
}

// Public summary for the start screen + setup screen (roles included for assignment).
export function campaignSummary(c) {
  return {
    id: c.id,
    name: c.universe.name,
    genre: c.universe.genre,
    tone: c.universe.tone,
    artStyle: c.universe.artStyle,
    primer: c.universe.primer,
    roles: (c.roles || []).map(r => ({
      id: r.id, name: r.name, race: r.race, class: r.class, tags: r.tags,
      stats: r.stats, resources: r.resources,
      abilities: (r.abilities || []).map(a => ({ id: a.id, name: a.name, desc: a.desc, cost: a.cost })),
      backstory: r.backstory,
    })),
    mainQuestNodes: (c.mainQuest?.nodes || []).length,
    sideQuests: (c.sideQuests || []).length,
  }
}

export function listCampaigns() {
  return readdirSync(CAMP_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => getCampaign(f.replace(/\.json$/, '')))
    .filter(Boolean)
    .map(campaignSummary)
}

// Write a campaign (Story Editor). Validated by lint before it lands; refuses on errors.
export function saveCampaign(campaign) {
  const report = lint(campaign)
  if (!report.ok) return { ok: false, ...report }
  writeFileSync(join(CAMP_DIR, `${campaign.id}.json`), JSON.stringify(campaign, null, 2), 'utf8')
  cache.set(campaign.id, campaign)
  if (campaign.universe?.skillStats) registerSkillStats(campaign.universe.skillStats)
  return { ok: true, ...report }
}
