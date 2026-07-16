// ─────────────────────────────────────────────────────────────────────────────
// ROLE / ABILITY GATING — hard, pre-roll, authoritative. Narration never overrides.
//
// GENRE-AGNOSTIC: resources are an OPEN named-pool map. A fantasy role might use
// {hp, mana, stamina}; a sci-fi role {hp, energy, shields, heat}. The engine only
// knows two universals: hp <= 0 means "down", and an ability's cost{poolName: n}
// requires at least n in that pool. Everything else is campaign-defined.
// ─────────────────────────────────────────────────────────────────────────────

// Merge the role sheet's starting pools with live overrides from gameState.party[roleId].
function liveResources(role, live) {
  const merged = { ...(role?.resources || {}) }
  if (live) for (const k of Object.keys(live)) if (k !== 'conditions') merged[k] = live[k]
  merged.hp = live?.hp ?? role?.resources?.hp ?? 1
  merged.conditions = live?.conditions ?? []
  return merged
}

const INCAPACITATING = new Set(['stunned', 'unconscious', 'paralyzed', 'petrified', 'frozen'])

// Returns { ok, reason }. reason ∈ down | incapacitated | no-<pool> | ok.
export function canPerform(role, live, ability) {
  if (!role || !ability) return { ok: false, reason: 'no-ability' }
  const r = liveResources(role, live)
  if ((r.hp ?? 1) <= 0) return { ok: false, reason: 'down' }
  if ((r.conditions || []).some(c => INCAPACITATING.has(String(c).toLowerCase()))) {
    return { ok: false, reason: 'incapacitated' }
  }
  const cost = ability.cost || {}
  for (const [pool, need] of Object.entries(cost)) {
    if ((need ?? 0) > (r[pool] ?? 0)) return { ok: false, reason: `no-${pool}` }
  }
  return { ok: true, reason: 'ok' }
}

// Every ability annotated with whether it can currently be performed — for UI greying
// and for pruning a companion's declared intent.
export function availableAbilities(role, live) {
  return (role?.abilities || []).map(a => ({ ability: a, ...canPerform(role, live, a) }))
}

// Deduct an ability's cost from a live resources object across whatever pools it names.
export function spendCost(live, ability) {
  const cost = ability?.cost || {}
  const out = { ...live }
  for (const [pool, amt] of Object.entries(cost)) {
    out[pool] = Math.max(0, (live?.[pool] ?? 0) - (amt ?? 0))
  }
  return out
}
