// ─────────────────────────────────────────────────────────────────────────────
// MODEL-PER-JOB MAP — single source of truth (shaped like chat-gen's heatLevels,
// but keyed by JOB, not a user-facing dial). No model-swap / reasoning-toggle layer.
//
// Jobs that must *reason* (GM adjudication, tactical companion read, story authoring)
// use the uncensored reasoner. Jobs that must be *fast + obedient* (JSON state
// extraction, intent/dice parsing) use venice-uncensored-1-2. Content is uncensored
// across the board via these Venice models, so there is no filtered branching.
// ─────────────────────────────────────────────────────────────────────────────

export const MODEL_JOBS = {
  gmNarration:      'olafangensan-glm-4.7-flash-heretic', // uncensored reasoner
  companionRead:    'olafangensan-glm-4.7-flash-heretic', // tactical inner-read benefits from reasoning
  companionAction:  'venice-uncensored-role-play',        // fast, characterful action prose
  adjudicator:      'venice-uncensored-1-2',              // obedient JSON state-extraction
  intentParse:      'venice-uncensored-1-2',              // fast classify / dice-intent
  storyGen:         'olafangensan-glm-4.7-flash-heretic', // long structured authoring
  storyGenFallback: 'gemma-4-uncensored',
}

// Reasoning models spend a hidden pass against max_tokens, so they need a larger budget
// or the visible reply gets starved.
const REASONING_JOBS = new Set(['gmNarration', 'companionRead', 'storyGen', 'storyGenFallback'])
const REASONING_MAX_TOKENS = 3000
const DIRECT_MAX_TOKENS = 600

export function modelForJob(job) {
  return MODEL_JOBS[job] ?? MODEL_JOBS.companionAction
}

export function maxTokensForJob(job) {
  return REASONING_JOBS.has(job) ? REASONING_MAX_TOKENS : DIRECT_MAX_TOKENS
}

export function isReasoningJob(job) {
  return REASONING_JOBS.has(job)
}
