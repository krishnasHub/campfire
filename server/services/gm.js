// ─────────────────────────────────────────────────────────────────────────────
// GM & COMPANION LLM LAYER — the model-driven passes of a round:
//   parseIntent      → does the player's action need a dice check? (fast, JSON)
//   narrateGM        → Pass A: stream GM narration of a resolved outcome
//   adjudicate       → Pass B: extract state deltas, constrained to the node vocabulary
//   companionInnerRead → Pass 1: private tactical read + a DECISION token (moods drive it)
//   companionAction  → Pass 2: stream the companion's in-character action
// The engine (dice.js / storyGraph.js) owns all numbers and transitions; the LLM narrates.
// ─────────────────────────────────────────────────────────────────────────────
import { streamChatCompletion } from './venice.js'
import { modelForJob, maxTokensForJob } from './modelJobs.js'
import { serializeForPrompt } from './gameState.js'
import { buildSystemPrompt, INNER_READ_INSTRUCTION } from './bots.js'
import { canPerform } from './roles.js'
import { DC } from './dice.js'

export function safeParseJson(raw) {
  try {
    return JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, ''))
  } catch { return null }
}

export function extractImageTag(content) {
  const m = content.match(/\[IMAGE:\s*([^\]]+)\]/i)
  if (!m) return { cleaned: content, imagePrompt: null }
  return { cleaned: content.replace(/\[IMAGE:[^\]]+\]/gi, '').replace(/\s{2,}/g, ' ').trim(), imagePrompt: m[1].trim() }
}

// ── Intent parse ──────────────────────────────────────────────────────────────
export async function parseIntent({ campaign, node, gs, actionText, userRole }) {
  const sys = `You classify a player's action in a tabletop RPG. Decide whether it needs a dice check (uncertain, contested, or risky) or not (pure talk, trivial movement, roleplay).
Return ONLY JSON: {"needsRoll": boolean, "skill": string|null, "target": string|null, "dc": number|null}
Common skills: melee, ranged, stealth, perception, athletics, persuade, deceive, intimidate, lore, tactics, sleight, acrobatics — plus any setting skills (tech, piloting, hacking, etc.).
DC ladder: easy 8, medium 12, hard 16, very hard 20. "target" = an enemy or npc id if the action is against someone, else null.`
  const usr = `${serializeForPrompt(gs, campaign, node)}\n\nThe player is ${userRole?.name} (${userRole?.race} ${userRole?.class}).\nPlayer action: "${actionText}"\n\nClassify it.`
  const raw = await streamChatCompletion({
    messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
    model: modelForJob('intentParse'), temperature: 0.2, maxTokens: 180,
  })
  const j = safeParseJson(raw)
  if (!j || typeof j.needsRoll !== 'boolean') return { needsRoll: false, skill: null, target: null, dc: null }
  return { needsRoll: j.needsRoll, skill: j.skill || null, target: j.target || null, dc: j.dc || DC.medium }
}

// ── GM narration (Pass A) ──────────────────────────────────────────────────────
export async function narrateGM({ campaign, node, gs, actionText, actorName, check, onChunk, opening = false }) {
  const sys = `You are the Game Master of an immersive text RPG set in ${campaign.universe.name}. ${campaign.universe.primer}
Narrate vividly — second person ("you") for the player, third person for companions and NPCs. Stay strictly grounded in the CURRENT SCENE STATE: never contradict who is present, the party's HP/resources, or the established location. Keep it to 2–4 tight paragraphs.
You do NOT decide success and you never invent dice numbers. When a DICE OUTCOME is given, narrate exactly that tier: crit = spectacular success; success = it works; partial = it works but at a cost or with a complication; fail = it doesn't work; fumble = it backfires.
Rarely, on a genuinely dramatic visual beat, you may emit ONE line of the exact form [IMAGE: a vivid one-sentence description] on its own line. Do not overuse it.
Never speak or act for the player's own character beyond the direct consequences of what they declared.`
  const outcome = check
    ? `\n\nDICE OUTCOME for this action (${check.skill}${check.target ? ` vs ${check.target}` : ''}): ${String(check.tier).toUpperCase()} (rolled ${check.total} vs DC ${check.dc}).`
    : ''
  const usr = opening
    ? `${serializeForPrompt(gs, campaign, node)}\n\nOpen the scene: set the stage for this beat and hand the moment to the player. Do not resolve anything yet.`
    : `${serializeForPrompt(gs, campaign, node)}\n\n${actorName} does: "${actionText}"${outcome}\n\nNarrate what happens.`
  return streamChatCompletion({
    messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
    model: modelForJob('gmNarration'), maxTokens: maxTokensForJob('gmNarration'), temperature: 0.9, onChunk,
  })
}

// ── Adjudicator (Pass B) ───────────────────────────────────────────────────────
export async function adjudicate({ campaign, node, gs, narration }) {
  const flagVocab = [...new Set([...(node.flags || []), ...(node.objectives || []).map(o => o.id)])]
  const enemyIds = Object.keys(gs.enemies || {})
  const roleIds = Object.keys(gs.party || {})
  const sys = `You are the state-tracker for an RPG engine. Given the latest narration and current state, output ONLY the concrete changes as JSON. Change nothing the narration didn't clearly establish; keep it conservative.
You may ONLY set these flags (booleans): ${flagVocab.join(', ') || '(none)'}
Party role ids: ${roleIds.join(', ') || '(none)'}. Enemy ids: ${enemyIds.join(', ') || '(none)'}.
Return ONLY JSON, omitting empty keys:
{"flags":{"<allowedFlag>":true|false},"counters":{"<name>":int},"party":{"<roleId>":{"hpDelta":int,"manaDelta":int,"staminaDelta":int,"position":str,"conditionsAdd":[str],"conditionsRemove":[str]}},"enemies":{"<enemyId>":{"hpDelta":int,"status":str}},"relationships":{"<roleId>":{"affinityDelta":int,"tensionDelta":int}}}
Set a flag true only when the narration clearly makes it so. Never output a flag outside the allowed list.`
  const usr = `CURRENT STATE:\n${serializeForPrompt(gs, campaign, node)}\n\nNARRATION JUST NOW:\n${narration}\n\nOutput the state changes as JSON.`
  const raw = await streamChatCompletion({
    messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
    model: modelForJob('adjudicator'), temperature: 0.1, maxTokens: 400,
  })
  const deltas = safeParseJson(raw) || {}
  if (deltas.flags) {
    const allowed = new Set(flagVocab)
    for (const k of Object.keys(deltas.flags)) if (!allowed.has(k)) delete deltas.flags[k]
  }
  return deltas
}

// ── Companion inner-read (Pass 1) — mood-driven DECISION ───────────────────────
export async function companionInnerRead({ campaign, node, gs, botId, mood, role, situation }) {
  const abilities = (role.abilities || []).map(a => a.name).join(', ')
  const sys = buildSystemPrompt(botId, mood)
    + `\n\nRIGHT NOW you are playing ${role.name}, a ${role.race} ${role.class} (tags: ${(role.tags || []).join(', ')}). Your abilities: ${abilities}.`
    + `\n\n${INNER_READ_INSTRUCTION(role.name)}`
  const usr = `${serializeForPrompt(gs, campaign, node)}\n\nWhat just happened: ${situation}\n\nYour private read, then your DECISION line.`
  const raw = (await streamChatCompletion({
    messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
    model: modelForJob('companionRead'), maxTokens: maxTokensForJob('companionRead'), temperature: 0.9,
  })).trim()
  const dm = raw.match(/DECISION:\s*(PASS|MOVE|SCOUT|ATTACK|CAST|ASSIST|SOCIAL|INTIMATE|SPEAK)/i)
  const decision = dm ? dm[1].toUpperCase() : 'SPEAK'
  const read = raw.replace(/DECISION:\s*\w+.*$/is, '').replace(/^\s*(inner read|read)\s*[:—-]*/i, '').trim()
  return { read, decision }
}

// ── Companion action (Pass 2) ──────────────────────────────────────────────────
export async function companionAction({ campaign, node, gs, botId, mood, role, decision, read, check, onChunk }) {
  const modeLine = decision === 'INTIMATE'
    ? 'This is an intimate/flirtatious beat toward the player or a companion — play it in character with your current mood.'
    : decision === 'SOCIAL'
      ? 'You are working an NPC — persuading, deceiving, intimidating, or seducing.'
      : `You are acting: ${decision.toLowerCase()}.`
  const sys = buildSystemPrompt(botId, mood)
    + `\n\nYou are ${role.name}, a ${role.race} ${role.class}. Narrate your action in third person, vivid but brief (1–3 sentences). Speak dialogue in "quotes". ${modeLine} Do not narrate other characters' choices or the player's actions, and never invent dice outcomes.`
    + (check ? `\n\nDICE OUTCOME of your action: ${String(check.tier).toUpperCase()}.` : '')
    + `\n\nYour private read going in (never quote it, let it drive you): ${read}`
  const usr = `${serializeForPrompt(gs, campaign, node)}\n\nIt's your moment. Act as ${role.name}.`
  return streamChatCompletion({
    messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
    model: modelForJob('companionAction'), maxTokens: 320, temperature: 0.95, onChunk,
  })
}

// Pick a dice check for a companion's declared decision (or null for no-roll decisions).
export function companionCheckFor(role, decision, live, gs) {
  const familyByDecision = { ATTACK: 'attack', CAST: 'attack', SOCIAL: 'social', SCOUT: 'scout' }
  const fam = familyByDecision[decision]
  if (!fam) return null // MOVE / ASSIST / SPEAK / INTIMATE / PASS → no roll

  const candidates = (role.abilities || []).filter(a => {
    const eff = String(a.effect || '')
    const match = fam === 'attack' ? eff.startsWith('attack') : eff.startsWith(fam)
    if (!match) return false
    if (decision === 'CAST') return (a.cost?.mana ?? 0) > 0 && canPerform(role, live, a).ok
    return canPerform(role, live, a).ok
  })
  const ability = candidates[0]
  if (fam === 'attack') {
    const skill = ability?.check?.skill || (role.tags?.includes('ranged') ? 'ranged' : 'melee')
    // target the first living enemy; DC from its defense if present
    const enemyEntry = Object.entries(gs.enemies || {}).find(([, e]) => (e.hp ?? 1) > 0 && e.status !== 'defeated')
    const dc = enemyEntry?.[1]?.defense || DC.medium
    return { ability, skill, dc, target: enemyEntry?.[0] || null }
  }
  if (fam === 'social') {
    const skill = ability?.check?.skill || (role.proficiencies?.find(p => ['persuade', 'deceive', 'intimidate'].includes(p))) || 'persuade'
    return { ability, skill, dc: DC.medium, target: null }
  }
  // scout
  return { ability, skill: ability?.check?.skill || 'perception', dc: ability?.check?.dc || DC.easy, target: null }
}
