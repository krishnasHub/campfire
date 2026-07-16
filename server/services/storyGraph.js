// ─────────────────────────────────────────────────────────────────────────────
// STORY DECISION-GRAPH ENGINE — pure JS, no LLM. Owns all node transitions.
// The GM narrates within a node; this engine decides when to move, by evaluating
// branch conditions over Game State. This keeps stories coherent and consequential.
// ─────────────────────────────────────────────────────────────────────────────

// ── Branch condition DSL — a JSON predicate over Game State ───────────────────
export function evalCondition(cond, gs) {
  if (!cond || typeof cond !== 'object') return false
  if (cond.always) return true
  if ('all' in cond) return (cond.all || []).every(c => evalCondition(c, gs))
  if ('any' in cond) return (cond.any || []).some(c => evalCondition(c, gs))
  if ('not' in cond) return !evalCondition(cond.not, gs)

  if ('flag' in cond) {
    const want = cond.eq === undefined ? true : cond.eq
    return (gs.flags?.[cond.flag] ?? false) === want
  }
  if ('counter' in cond) {
    const v = gs.counters?.[cond.counter] ?? 0
    if ('gte' in cond) return v >= cond.gte
    if ('gt' in cond) return v > cond.gt
    if ('lte' in cond) return v <= cond.lte
    if ('lt' in cond) return v < cond.lt
    if ('eq' in cond) return v === cond.eq
    return v > 0
  }
  if ('hasItem' in cond) {
    const party = gs.party || {}
    return Object.values(party).some(p => (p.inventory || []).some(it => (it.itemId || it) === cond.hasItem))
  }
  if ('enemyDefeated' in cond) {
    const e = gs.enemies?.[cond.enemyDefeated]
    return !e || (e.hp ?? 1) <= 0 || e.status === 'defeated'
  }
  if ('roleAlive' in cond) return (gs.party?.[cond.roleAlive]?.hp ?? 0) > 0
  if ('locationVisited' in cond) {
    return (gs.story?.completedNodes || []).includes(cond.locationVisited) || gs.story?.mainNodeId === cond.locationVisited
  }
  if ('check' in cond) {
    const lc = gs.lastCheck
    if (!lc) return false
    const c = cond.check
    if (c.skill && lc.skill !== c.skill) return false
    if (c.target && lc.target !== c.target) return false
    if (c.tier && !c.tier.includes(lc.tier)) return false
    return true
  }
  return false
}

// ── Node lookup ───────────────────────────────────────────────────────────────
export function allNodes(campaign) {
  const nodes = [...(campaign.mainQuest?.nodes || [])]
  for (const sq of campaign.sideQuests || []) nodes.push(...(sq.nodes || []))
  return nodes
}
export function nodeById(campaign, id) {
  return allNodes(campaign).find(n => n.id === id) || null
}

// Required (non-optional) objectives are "met" when a flag named after the objective id is true.
export function objectivesMet(node, gs) {
  const req = (node.objectives || []).filter(o => !o.optional)
  return req.every(o => (gs.flags?.[o.id] ?? false) === true)
}

// Pick the winning branch: lowest priority number first; skip branches that would leave
// the node while requireObjectivesToLeave and objectives are unmet (self-loops still allowed).
export function chooseBranch(node, gs) {
  if (!node?.branches) return null
  const gate = node.requireObjectivesToLeave && !objectivesMet(node, gs)
  const sorted = [...node.branches].sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))
  for (const b of sorted) {
    if (!evalCondition(b.when, gs)) continue
    if (gate && b.to !== node.id) continue
    return b
  }
  return null
}

export function applyEntryEffects(node, gs) {
  if (!node?.entryEffects) return
  gs.flags = gs.flags || {}
  for (const e of node.entryEffects) {
    if (e.setFlag) gs.flags[e.setFlag] = e.to === undefined ? true : e.to
  }
}

// Advance the main-quest pointer if a branch fires. Mutates gs.story. Returns the
// transition {from,to,label,branchId} or null if the party stayed on the current node.
export function advance(campaign, gs) {
  if (!gs.story) {
    gs.story = { mainNodeId: campaign.mainQuest.startNodeId, sideStack: [], completedNodes: [] }
    applyEntryEffects(nodeById(campaign, gs.story.mainNodeId), gs)
  }
  const current = nodeById(campaign, gs.story.mainNodeId)
  if (!current) return null
  const branch = chooseBranch(current, gs)
  if (!branch || branch.to === current.id) return null
  if (!gs.story.completedNodes.includes(current.id)) gs.story.completedNodes.push(current.id)
  gs.story.mainNodeId = branch.to
  applyEntryEffects(nodeById(campaign, branch.to), gs)
  return { from: current.id, to: branch.to, label: branch.label, branchId: branch.id }
}

// Side quests whose trigger is now satisfied and which aren't already active/completed.
export function triggeredSideQuests(campaign, gs) {
  const active = new Set((gs.story?.sideStack || []).map(s => String(s).split(':')[0]))
  const done = new Set(gs.story?.completedSideQuests || [])
  return (campaign.sideQuests || []).filter(sq =>
    !active.has(sq.id) && !done.has(sq.id) && evalCondition(sq.trigger, gs))
}

// ── Lint — the anti-broken-graph guarantee ────────────────────────────────────
function collectReadFlags(cond, out) {
  if (!cond || typeof cond !== 'object') return
  if ('flag' in cond) out.add(cond.flag)
  for (const k of ['all', 'any']) if (cond[k]) cond[k].forEach(c => collectReadFlags(c, out))
  if (cond.not) collectReadFlags(cond.not, out)
  if (cond.check?.tier) { /* tiers not flags */ }
}

export function lint(campaign) {
  const errors = [], warnings = []
  const nodes = allNodes(campaign)
  const ids = new Set(nodes.map(n => n.id))
  const start = campaign.mainQuest?.startNodeId

  if (!start || !ids.has(start)) errors.push(`startNodeId "${start}" is missing from nodes`)

  for (const n of nodes) {
    for (const b of n.branches || []) {
      if (!ids.has(b.to)) errors.push(`node ${n.id}: branch "${b.id || '?'}" points to unknown node "${b.to}"`)
    }
    if (n.type !== 'ending') {
      const hasCatch = (n.branches || []).some(b => b.when?.always === true)
      if (!hasCatch) errors.push(`node ${n.id}: non-ending node has no {always:true} catch-all branch`)
    }
  }

  // reachability from start
  const reachable = new Set()
  if (start && ids.has(start)) {
    const stack = [start]
    while (stack.length) {
      const id = stack.pop()
      if (reachable.has(id)) continue
      reachable.add(id)
      const nd = nodes.find(n => n.id === id)
      for (const b of nd?.branches || []) if (!reachable.has(b.to)) stack.push(b.to)
    }
  }
  for (const n of campaign.mainQuest?.nodes || []) {
    if (!reachable.has(n.id)) warnings.push(`main node ${n.id} is unreachable from start`)
  }

  // every reachable node can reach an ending
  const endingIds = new Set(nodes.filter(n => n.type === 'ending').map(n => n.id))
  if (!endingIds.size) errors.push('campaign has no ending nodes')
  const reachesEnding = (from) => {
    const seen = new Set(); const st = [from]
    while (st.length) {
      const id = st.pop(); if (seen.has(id)) continue; seen.add(id)
      if (endingIds.has(id)) return true
      const nd = nodes.find(n => n.id === id)
      for (const b of nd?.branches || []) st.push(b.to)
    }
    return false
  }
  for (const id of reachable) if (!endingIds.has(id) && !reachesEnding(id)) {
    warnings.push(`node ${id} cannot reach any ending`)
  }

  // declared vs read flags
  const declared = new Set()
  for (const n of nodes) {
    for (const f of n.flags || []) declared.add(f)
    for (const o of n.objectives || []) declared.add(o.id)
    for (const e of n.entryEffects || []) if (e.setFlag) declared.add(e.setFlag)
  }
  const read = new Set()
  for (const n of nodes) for (const b of n.branches || []) collectReadFlags(b.when, read)
  for (const sq of campaign.sideQuests || []) collectReadFlags(sq.trigger, read)
  for (const f of read) if (!declared.has(f)) warnings.push(`flag "${f}" is read by a condition but not declared in any node.flags`)

  return { ok: errors.length === 0, errors, warnings }
}

// Auto-insert a {always:true} self-loop on any non-ending node missing a catch-all.
export function ensureCatchAlls(campaign) {
  let added = 0
  for (const n of allNodes(campaign)) {
    if (n.type === 'ending') continue
    n.branches = n.branches || []
    if (!n.branches.some(b => b.when?.always === true)) {
      n.branches.push({ id: `${n.id}_stay`, to: n.id, priority: 999, when: { always: true }, label: 'Stay' })
      added++
    }
  }
  return added
}
