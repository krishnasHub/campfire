// ─────────────────────────────────────────────────────────────────────────────
// STORY GENERATION — staged LLM authoring of a full campaign from a seed, then a
// pure-JS repair pass that GUARANTEES a lint-clean graph (fix dangling targets,
// insert catch-alls, ensure an ending is reachable). The Story Editor then lets the
// user tweak the draft. Genre-agnostic: the seed decides fantasy/sci-fi/etc.
// ─────────────────────────────────────────────────────────────────────────────
import { streamChatCompletion } from './venice.js'
import { modelForJob } from './modelJobs.js'
import { lint, allNodes } from './storyGraph.js'
import { safeParseJson } from './gm.js'

function slug(s) {
  return String(s || 'campaign').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'campaign'
}

// Reasoning models spend a hidden pass against max_tokens, so authoring needs a large
// budget or the JSON gets truncated. Try the reasoner; on a parse miss, retry once on
// the obedient fallback model (more reliable at raw JSON).
async function llmJson(job, sys, usr, maxTokens = 5000) {
  const call = (model) => streamChatCompletion({
    messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
    model, temperature: 0.7, maxTokens,
  })
  let parsed = safeParseJson(await call(modelForJob(job)))
  if (!parsed) {
    console.warn(`[gen] ${job}: primary model parse failed — retrying on fallback model`)
    parsed = safeParseJson(await call(modelForJob('storyGenFallback')))
  }
  return parsed
}

const STAGE1 = `You author the SETUP for a text-RPG campaign. Given a seed, return ONLY JSON:
{"universe":{"name","genre","tone","artStyle","primer"},"narrator":{"name","persona"},"roles":[ up to 4 ]}
narrator = an in-world character who tells this tale (e.g. an elven seer for fantasy, a ship's AI for sci-fi, a grizzled war-journalist for grimdark): "name" + a one-sentence "persona" describing their voice/cadence.
artStyle ∈ cinematic-fantasy | sci-fi | space-opera | cyberpunk | post-apocalyptic | anime.
Each role: {"id":"r_slug","name","race","class","backstory","stats":{"might","agility","wits","presence","resolve"} each integer -1..4,"resources":{"hp","hpMax","mana","manaMax","stamina","staminaMax"},"proficiencies":[..],"abilities":[{"id","name","cost":{"mana"?,"stamina"?},"effect","check":{"skill","dc"?},"desc"}],"gear":[{"itemId"}],"tags":[..]}.
Make FOUR distinct archetypes (e.g. tank, ranged/scout, caster, face/rogue). Martial roles have manaMax 0. Keep it tight.`

const STAGE2 = `You author the MAIN-QUEST node graph (a DAG) for the campaign. Return ONLY JSON:
{"startNodeId","nodes":[ ... ]}
Node: {"id":"n_slug","title","type":"beat"|"ending","setup":"2-3 sentence GM scene seed","objectives":[{"id","desc","optional"?}],"flags":["scene flags the story can set"],"spawns":["enemyId"?],"requireObjectivesToLeave"?:bool,"branches":[{"id","to","priority","when":<cond>,"label"}]}
Rules: 6-8 "beat" nodes then 2-3 "ending" nodes (type:"ending", NO branches). Every non-ending node's LAST branch MUST be a catch-all {"when":{"always":true},"to":<its own id>}. Lower priority number wins. Conditions: {"flag":"x"} | {"any":[..]} | {"all":[..]} | {"always":true}. Every flag read by a branch MUST appear in some node's "flags". The climax beat branches to the endings.`

const STAGE3 = `You author 2-3 optional SIDE QUESTS as small node subgraphs. Return ONLY a JSON array:
[{"id":"sq_slug","trigger":<cond>,"entryNodeId","weave":"parallel","onComplete":[{"setFlag","to":true}],"nodes":[ entry + ending ]}]
Each side quest: one entry node {"type":"side_entry",...,"requireObjectivesToLeave":true} and one {"type":"ending"} node. Triggers: {"locationVisited":"<mainNodeId>"} or {"flag":"x"}. Same catch-all rule on non-ending nodes.`

// Guarantee lint-cleanliness with pure JS (LLM graphs are fragile).
export function repairGraph(campaign) {
  const mq = campaign.mainQuest || (campaign.mainQuest = { nodes: [] })
  let nodes = Array.isArray(mq.nodes) ? mq.nodes : []
  if (!nodes.some(n => n.type === 'ending')) {
    nodes.push({ id: 'end_generic', title: 'The End', type: 'ending', setup: 'The story concludes.' })
  }
  const ids = new Set(nodes.map(n => n.id))
  if (!mq.startNodeId || !ids.has(mq.startNodeId)) mq.startNodeId = nodes.find(n => n.type !== 'ending')?.id || nodes[0]?.id
  const endingId = nodes.find(n => n.type === 'ending').id

  for (const n of nodes) {
    if (n.type === 'ending') { n.branches = []; continue }
    n.branches = Array.isArray(n.branches) ? n.branches : []
    n.flags = Array.isArray(n.flags) ? n.flags : []
    for (const b of n.branches) if (!ids.has(b.to)) b.to = n.id
    if (!n.branches.some(b => b.when?.always === true)) {
      n.branches.push({ id: `${n.id}_stay`, to: n.id, priority: 999, when: { always: true }, label: 'Stay in this moment' })
    }
  }
  // ensure some non-ending node reaches an ending
  const reachesEnding = nodes.some(n => (n.branches || []).some(b => nodes.find(x => x.id === b.to)?.type === 'ending'))
  if (!reachesEnding) {
    const climax = [...nodes].reverse().find(n => n.type !== 'ending')
    if (climax) climax.branches.unshift({ id: `${climax.id}_end`, to: endingId, priority: 1, when: { always: true }, label: 'Conclude' })
  }
  mq.nodes = nodes

  // side quests: same catch-all + target repair
  for (const sq of campaign.sideQuests || []) {
    const sIds = new Set((sq.nodes || []).map(n => n.id))
    for (const n of sq.nodes || []) {
      if (n.type === 'ending') { n.branches = []; continue }
      n.branches = Array.isArray(n.branches) ? n.branches : []
      n.flags = Array.isArray(n.flags) ? n.flags : []
      for (const b of n.branches) if (!sIds.has(b.to)) b.to = n.id
      if (!n.branches.some(b => b.when?.always === true)) n.branches.push({ id: `${n.id}_stay`, to: n.id, priority: 999, when: { always: true }, label: 'Stay' })
    }
  }

  // auto-fill bestiary for any referenced spawns, and items for role gear
  campaign.bestiary = campaign.bestiary || {}
  for (const n of allNodes(campaign)) for (const id of n.spawns || []) {
    if (!campaign.bestiary[id]) campaign.bestiary[id] = { hp: 20, hpMax: 20, defense: 12, attack: '+3', threat: 'medium' }
  }
  campaign.items = campaign.items || {}
  for (const r of campaign.roles || []) for (const g of r.gear || []) {
    const iid = g.itemId || g
    if (iid && !campaign.items[iid]) campaign.items[iid] = { name: iid.replace(/_/g, ' '), slot: 'gear' }
  }
  return campaign
}

// Generate a full campaign from a seed { title, vibe, genre }.
export async function generateCampaign({ title, vibe, genre }) {
  const seed = `Seed title: "${title || 'Untitled'}". Vibe: ${vibe || 'an adventure'}. Genre lean: ${genre || 'fantasy'}.`
  console.log(`[gen] ═══ generating from seed: ${JSON.stringify({ title, vibe, genre })}`)

  const setup = await llmJson('storyGen', STAGE1, seed, 4500)
  if (!setup?.universe || !Array.isArray(setup.roles)) throw new Error('generation failed at setup stage (universe/roles did not parse)')
  console.log(`[gen] stage1: universe="${setup.universe.name}" style=${setup.universe.artStyle} roles=${setup.roles.length}`)

  const ctx = `Universe: ${JSON.stringify(setup.universe)}\nRoles: ${setup.roles.map(r => `${r.id} ${r.name} (${r.class})`).join(', ')}`
  const main = await llmJson('storyGen', STAGE2, `${ctx}\n\nAuthor the main quest.`, 6000)
  console.log(`[gen] stage2: main nodes=${main?.nodes?.length || 0} start=${main?.startNodeId}`)
  const sides = await llmJson('storyGen', STAGE3, `${ctx}\nMain nodes: ${(main?.nodes || []).map(n => n.id).join(', ')}\n\nAuthor the side quests.`, 4000)
  console.log(`[gen] stage3: side quests=${Array.isArray(sides) ? sides.length : 0}`)

  let campaign = {
    id: slug(setup.universe.name || title),
    schemaVersion: 1,
    universe: setup.universe,
    narrator: setup.narrator || null,
    roles: setup.roles.slice(0, 4),
    mainQuest: { startNodeId: main?.startNodeId, nodes: main?.nodes || [] },
    sideQuests: Array.isArray(sides) ? sides : [],
    bestiary: {},
    items: {},
  }
  campaign = repairGraph(campaign)
  const report = lint(campaign)
  console.log(`[gen] ═══ done: id=${campaign.id} lint.ok=${report.ok} errors=${report.errors.length} warnings=${report.warnings.length}`)
  return { campaign, lint: report }
}
