// ─────────────────────────────────────────────────────────────────────────────
// GAME STATE — the dynamic world/party graph (forked in spirit from chat-gen's
// sceneGraph.js). Built deterministically at scene start (no LLM), serialized into
// prompts, and updated each round by applying adjudicator deltas. Genre-agnostic:
// resources are whatever pools the role sheet declares.
// ─────────────────────────────────────────────────────────────────────────────

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

function initRoleState(role, actor) {
  const live = { actor, conditions: [], position: '', inventory: (role.gear || []).map(g => ({ itemId: g.itemId || g })) }
  for (const [k, v] of Object.entries(role.resources || {})) live[k] = v // hp, mana, stamina, shields, energy…
  return live
}

export function applySpawns(campaign, node, gs) {
  for (const id of node?.spawns || []) {
    const b = campaign.bestiary?.[id]
    if (b && !gs.enemies[id]) gs.enemies[id] = { ...b, status: 'active' }
  }
}

// Deterministic initial state from the campaign's start node + assigned roles.
export function buildInitialState(campaign, party) {
  const start = campaign.mainQuest.nodes.find(n => n.id === campaign.mainQuest.startNodeId)
  const gs = {
    schemaVersion: 1,
    campaignId: campaign.id,
    location: { name: start?.title || campaign.universe.name, details: (start?.setup || '').slice(0, 220) },
    time: { day: 1, timeOfDay: 'the start' },
    atmosphere: { mood: campaign.universe.tone || '' },
    party: {},
    enemies: {},
    npcs: {},
    flags: {},
    counters: {},
    relationships: {},
    lastCheck: null,
    story: { mainNodeId: campaign.mainQuest.startNodeId, sideStack: [], completedNodes: [], completedSideQuests: [], beatTurns: 0 },
  }
  const roleById = Object.fromEntries((campaign.roles || []).map(r => [r.id, r]))
  const assignments = { ...(party.assignments || {}) }
  if (party.userRoleId) assignments[party.userRoleId] = 'user'
  for (const [roleId, actor] of Object.entries(assignments)) {
    const role = roleById[roleId]
    if (!role) continue
    gs.party[roleId] = initRoleState(role, actor)
    gs.relationships[roleId] = { toUser: { affinity: 0, tension: 0 } }
  }
  applySpawns(campaign, start, gs)
  for (const e of start?.entryEffects || []) if (e.setFlag) gs.flags[e.setFlag] = e.to ?? true
  return gs
}

export function roleName(campaign, id) {
  if (id === 'user') return 'You'
  return campaign.roles?.find(r => r.id === id)?.name || id
}

// Compact block injected into GM / companion / adjudicator prompts.
export function serializeForPrompt(gs, campaign, node) {
  const parts = []
  const u = campaign.universe
  parts.push(`SETTING: ${u.name} — ${u.genre}. ${u.tone}.`)
  if (node) {
    parts.push(`CURRENT BEAT: "${node.title}". ${node.setup || ''}`)
    const objs = (node.objectives || []).map(o => `${gs.flags?.[o.id] ? '[done] ' : ''}${o.desc}${o.optional ? ' (optional)' : ''}`)
    if (objs.length) parts.push('OBJECTIVES:\n- ' + objs.join('\n- '))
  }
  if (gs.location?.name) parts.push(`LOCATION: ${gs.location.name}${gs.location.details ? ` — ${gs.location.details}` : ''}`)

  const pl = []
  for (const [rid, p] of Object.entries(gs.party || {})) {
    const bits = [`HP ${p.hp}/${p.hpMax ?? p.hp}`]
    for (const pool of ['mana', 'stamina', 'shields', 'energy']) {
      const max = p[`${pool}Max`]
      if (p[pool] != null && (max == null || max > 0) && (p[pool] > 0 || max > 0)) {
        bits.push(`${pool} ${p[pool]}${max != null ? `/${max}` : ''}`)
      }
    }
    if (p.conditions?.length) bits.push(`conditions: ${p.conditions.join(', ')}`)
    const who = p.actor === 'user' ? 'the player' : 'companion'
    pl.push(`${roleName(campaign, rid)} (${who}): ${bits.join(', ')}${p.position ? ` — ${p.position}` : ''}`)
  }
  if (pl.length) parts.push('PARTY:\n' + pl.join('\n'))

  const el = []
  for (const [eid, e] of Object.entries(gs.enemies || {})) {
    if ((e.hp ?? 1) > 0 && e.status !== 'defeated') el.push(`${eid}: HP ${e.hp}/${e.hpMax ?? e.hp} — ${e.threat || 'unknown'} threat`)
  }
  if (el.length) parts.push('ENEMIES PRESENT:\n' + el.join('\n'))

  return parts.join('\n\n')
}

// Apply a validated adjudicator delta to the live game state (mutates gs).
export function applyDeltas(gs, deltas) {
  if (!deltas || typeof deltas !== 'object') return
  gs.flags = gs.flags || {}
  gs.counters = gs.counters || {}
  for (const [k, v] of Object.entries(deltas.flags || {})) gs.flags[k] = v
  for (const [k, v] of Object.entries(deltas.counters || {})) gs.counters[k] = v

  for (const [rid, d] of Object.entries(deltas.party || {})) {
    const p = gs.party?.[rid]
    if (!p || !d) continue
    if (d.hpDelta) p.hp = clamp((p.hp ?? 0) + d.hpDelta, 0, p.hpMax ?? 9999)
    for (const pool of ['mana', 'stamina', 'shields', 'energy']) {
      const key = `${pool}Delta`
      if (d[key]) p[pool] = clamp((p[pool] ?? 0) + d[key], 0, p[`${pool}Max`] ?? 9999)
    }
    if (d.position) p.position = d.position
    p.conditions = p.conditions || []
    for (const c of d.conditionsAdd || []) if (!p.conditions.includes(c)) p.conditions.push(c)
    if (d.conditionsRemove) p.conditions = p.conditions.filter(c => !d.conditionsRemove.includes(c))
  }

  for (const [eid, d] of Object.entries(deltas.enemies || {})) {
    const e = gs.enemies?.[eid]
    if (!e || !d) continue
    if (d.hpDelta) e.hp = Math.max(0, (e.hp ?? 0) + d.hpDelta)
    if (d.status) e.status = d.status
    if (e.hp <= 0) e.status = 'defeated'
  }

  for (const [rid, d] of Object.entries(deltas.relationships || {})) {
    if (!d) continue
    gs.relationships[rid] = gs.relationships[rid] || { toUser: { affinity: 0, tension: 0 } }
    const r = gs.relationships[rid].toUser
    if (d.affinityDelta) r.affinity = clamp(r.affinity + d.affinityDelta, -10, 10)
    if (d.tensionDelta) r.tension = clamp(r.tension + d.tensionDelta, -10, 10)
  }

  if (deltas.location) gs.location = { ...gs.location, ...deltas.location }
}
