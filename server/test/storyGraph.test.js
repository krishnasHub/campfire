import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { lint, evalCondition, advance, nodeById, triggeredSideQuests } from '../services/storyGraph.js'
import { canPerform } from '../services/roles.js'
import { statForSkill, registerSkillStats } from '../services/dice.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const hollowreach = JSON.parse(readFileSync(join(__dirname, '../data/campaigns/hollowreach.json'), 'utf8'))

test('hollowreach lints clean (no errors, no warnings)', () => {
  const r = lint(hollowreach)
  assert.deepEqual(r.errors, [], 'errors: ' + JSON.stringify(r.errors))
  assert.deepEqual(r.warnings, [], 'warnings: ' + JSON.stringify(r.warnings))
  assert.equal(r.ok, true)
})

test('evalCondition DSL covers the branch predicates', () => {
  const gs = {
    flags: { a: true, b: false }, counters: { g: 3 },
    party: { r1: { hp: 5 }, r2: { hp: 0 } }, enemies: { troll: { hp: 0 } },
    lastCheck: { skill: 'stealth', tier: 'success' },
  }
  assert.equal(evalCondition({ always: true }, gs), true)
  assert.equal(evalCondition({ flag: 'a' }, gs), true)
  assert.equal(evalCondition({ flag: 'b' }, gs), false)
  assert.equal(evalCondition({ flag: 'b', eq: false }, gs), true)
  assert.equal(evalCondition({ counter: 'g', gte: 3 }, gs), true)
  assert.equal(evalCondition({ roleAlive: 'r1' }, gs), true)
  assert.equal(evalCondition({ roleAlive: 'r2' }, gs), false)
  assert.equal(evalCondition({ enemyDefeated: 'troll' }, gs), true)
  assert.equal(evalCondition({ all: [{ flag: 'a' }, { counter: 'g', gte: 2 }] }, gs), true)
  assert.equal(evalCondition({ any: [{ flag: 'b' }, { flag: 'a' }] }, gs), true)
  assert.equal(evalCondition({ not: { flag: 'b' } }, gs), true)
  assert.equal(evalCondition({ check: { skill: 'stealth', tier: ['success', 'crit'] } }, gs), true)
})

test('advance walks the main graph via flags to an ending', () => {
  const gs = { flags: {}, story: { mainNodeId: 'n_elsvale', sideStack: [], completedNodes: [] } }
  assert.equal(advance(hollowreach, gs), null, 'stays until a route is chosen')
  gs.flags.route_forest = true
  assert.equal(advance(hollowreach, gs).to, 'n_orccamp')
  gs.flags.camp_slipped = true
  assert.equal(advance(hollowreach, gs).to, 'n_passes')
  gs.flags.gate_reached = true
  assert.equal(advance(hollowreach, gs).to, 'n_gate')
  assert.equal(advance(hollowreach, gs), null, 'gate requires its objective to leave')
  gs.flags.gate_opened = true
  assert.equal(advance(hollowreach, gs).to, 'n_barrow')
  gs.flags.sealed = true
  assert.equal(advance(hollowreach, gs).to, 'end_dawn')
  assert.equal(nodeById(hollowreach, 'end_dawn').type, 'ending')
})

test('branch priority: an alarm reroutes to pursuit even if slipped is also set', () => {
  const gs = { flags: { route_forest: true, alarm_raised: true, camp_slipped: true },
    story: { mainNodeId: 'n_orccamp', sideStack: [], completedNodes: ['n_elsvale'] } }
  assert.equal(advance(hollowreach, gs).to, 'n_pursuit')
})

test('side quest triggers on reaching a location', () => {
  const gs = { flags: {}, story: { mainNodeId: 'n_orccamp', completedNodes: ['n_elsvale'], sideStack: [] } }
  assert.ok(triggeredSideQuests(hollowreach, gs).some(s => s.id === 'sq_orc_captive'))
})

// ── Genre-agnostic proof: a sci-fi campaign runs on the SAME engine ───────────
test('engine is genre-agnostic: a sci-fi campaign lints, gates, and advances', () => {
  registerSkillStats({ slicing: 'wits' })
  const scifi = {
    id: 'derelict', schemaVersion: 1,
    universe: { name: 'The Kessel Drift', genre: 'space-opera', artStyle: 'sci-fi', primer: 'A derelict cruiser drifts...' },
    roles: [{
      id: 'r_vanguard', name: 'Vex', race: 'Human', class: 'Vanguard',
      stats: { might: 3, agility: 2, wits: 1, presence: 2, resolve: 3 },
      resources: { hp: 24, shields: 6, energy: 4 },          // <- NOT mana/stamina
      proficiencies: ['firearms', 'blaster'],
      abilities: [
        { id: 'overcharge', cost: { energy: 3 }, effect: 'attack:blaster', check: { skill: 'blaster' } },
        { id: 'barrier', cost: { shields: 2 }, effect: 'assist' },
      ],
      tags: ['tank'],
    }],
    mainQuest: {
      startNodeId: 'n_airlock',
      nodes: [
        { id: 'n_airlock', title: 'Airlock', type: 'beat', objectives: [{ id: 'breached', desc: 'Breach' }], flags: ['hull_cut'],
          branches: [{ id: 'a1', to: 'n_bridge', priority: 10, when: { flag: 'hull_cut' }, label: 'In' }, { id: 'a2', to: 'n_airlock', priority: 100, when: { always: true }, label: 'stay' }] },
        { id: 'n_bridge', title: 'Bridge', type: 'beat', flags: ['core_slaved'],
          branches: [{ id: 'b1', to: 'end_escape', priority: 10, when: { flag: 'core_slaved' }, label: 'Escape' }, { id: 'b2', to: 'n_bridge', priority: 100, when: { always: true }, label: 'stay' }] },
        { id: 'end_escape', title: 'Clear', type: 'ending', setup: 'Jump to lightspeed.' },
      ],
    },
    sideQuests: [], bestiary: {}, items: {},
  }
  assert.deepEqual(lint(scifi).errors, [])
  const role = scifi.roles[0]
  assert.equal(canPerform(role, { energy: 4, shields: 6, hp: 24 }, role.abilities[0]).ok, true)
  assert.deepEqual(canPerform(role, { energy: 1, shields: 6, hp: 24 }, role.abilities[0]), { ok: false, reason: 'no-energy' })
  assert.equal(statForSkill('slicing'), 'wits')    // campaign-registered
  assert.equal(statForSkill('blaster'), 'agility') // built-in sci-fi skill
  const gs = { flags: {}, story: { mainNodeId: 'n_airlock', sideStack: [], completedNodes: [] } }
  gs.flags.hull_cut = true
  assert.equal(advance(scifi, gs).to, 'n_bridge')
  gs.flags.core_slaved = true
  assert.equal(advance(scifi, gs).to, 'end_escape')
})
