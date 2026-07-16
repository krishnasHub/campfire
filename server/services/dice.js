// ─────────────────────────────────────────────────────────────────────────────
// DICE & STAT RESOLUTION — server-authoritative. The LLM is only ever told the
// resulting tier; it never rolls or invents numbers. Light by design: only genuinely
// uncertain actions call resolve().
// ─────────────────────────────────────────────────────────────────────────────

// Skill → governing stat. The 5 stats are genre-universal (Might/Agility/Wits/Presence/
// Resolve map to any setting). The default map covers common fantasy AND sci-fi skills;
// campaigns extend it with their own skills via registerSkillStats(). Skills may be
// namespaced ("attack:ranged"); we fall back to the prefix/suffix around ":".
const STAT_FOR_SKILL = {
  // Might
  melee: 'might', athletics: 'might', break: 'might', grapple: 'might', attack: 'might',
  // Agility
  ranged: 'agility', stealth: 'agility', sleight: 'agility', dodge: 'agility', traps: 'agility',
  acrobatics: 'agility', piloting: 'agility', gunnery: 'agility', firearms: 'agility', blaster: 'agility',
  // Wits
  lore: 'wits', investigation: 'wits', perception: 'wits', tactics: 'wits', scout: 'wits',
  tech: 'wits', hacking: 'wits', computers: 'wits', science: 'wits', engineering: 'wits', medicine: 'wits',
  // Presence
  persuade: 'presence', intimidate: 'presence', deceive: 'presence', seduce: 'presence',
  perform: 'presence', command: 'presence', diplomacy: 'presence',
  // Resolve
  willpower: 'resolve', concentration: 'resolve', fear: 'resolve',
}

// Merge campaign-specific skill→stat mappings (e.g. a setting's bespoke skills).
export function registerSkillStats(map) {
  if (!map) return
  for (const [skill, stat] of Object.entries(map)) STAT_FOR_SKILL[String(skill).toLowerCase()] = stat
}

export const DC = { easy: 8, medium: 12, hard: 16, veryHard: 20 }

export function statForSkill(skill) {
  if (!skill) return null
  const key = String(skill).toLowerCase()
  if (STAT_FOR_SKILL[key]) return STAT_FOR_SKILL[key]
  const [prefix, suffix] = key.split(':')
  return STAT_FOR_SKILL[suffix] ?? STAT_FOR_SKILL[prefix] ?? null
}

// Stats are stored on the −1..+4 scale and act directly as the modifier.
export function statMod(role, skill) {
  const stat = statForSkill(skill)
  return stat ? (role?.stats?.[stat] ?? 0) : 0
}

export function isProficient(role, skill) {
  if (!role?.proficiencies || !skill) return false
  const s = String(skill).toLowerCase()
  const base = s.split(':').pop()
  return role.proficiencies.some(p => {
    const pl = String(p).toLowerCase()
    return pl === s || pl === base || s.startsWith(pl) || pl.startsWith(base)
  })
}

// Deterministic RNG for tests (xorshift32). Omit seed for Math.random.
export function makeRng(seed) {
  if (seed == null) return Math.random
  let s = (seed >>> 0) || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >> 17
    s ^= s << 5; s >>>= 0
    return (s >>> 0) / 4294967296
  }
}

export function rollD20(rng = Math.random) {
  return 1 + Math.floor(rng() * 20)
}

// Resolve a check into an outcome tier. nat20 → crit (auto), nat1 → fumble (auto),
// otherwise total vs DC with a "partial" band 3 below the DC.
export function resolve({ role, skill, dc = DC.medium, situational = 0, rng = Math.random }) {
  const d20 = rollD20(rng)
  const mod = statMod(role, skill)
  const prof = isProficient(role, skill) ? 2 : 0
  const total = d20 + mod + prof + situational
  let tier
  if (d20 === 20) tier = 'crit'
  else if (d20 === 1) tier = 'fumble'
  else if (total >= dc) tier = 'success'
  else if (total >= dc - 3) tier = 'partial'
  else tier = 'fail'
  return { d20, mod, prof, situational, total, dc, tier, skill: skill ?? null }
}
