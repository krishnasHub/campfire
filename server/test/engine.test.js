import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve, statMod, isProficient, DC } from '../services/dice.js'
import { canPerform, spendCost } from '../services/roles.js'

const mage = {
  stats: { might: 0, agility: 1, wits: 3, presence: 1, resolve: 2 },
  resources: { hp: 14, mana: 6, stamina: 4 },
  proficiencies: ['lore', 'perception'],
  abilities: [
    { id: 'firebolt', cost: { mana: 3 } },
    { id: 'smash', cost: { stamina: 2 } },
    { id: 'bighit', cost: { stamina: 10 } },
  ],
}

// rng that forces a specific d20 face: 1 + floor(rng()*20) === n
const face = (n) => () => (n - 0.5) / 20

test('rng forces the intended d20 face', () => {
  assert.equal(resolve({ role: mage, skill: 'lore', rng: face(20) }).d20, 20)
  assert.equal(resolve({ role: mage, skill: 'lore', rng: face(1) }).d20, 1)
  assert.equal(resolve({ role: mage, skill: 'lore', rng: face(11) }).d20, 11)
})

test('statMod maps skills to stats; namespaced skills fall back to suffix', () => {
  assert.equal(statMod(mage, 'lore'), 3)          // wits
  assert.equal(statMod(mage, 'attack:ranged'), 1) // agility
  assert.equal(statMod(mage, 'persuade'), 1)      // presence
})

test('proficiency adds +2 only for known skills', () => {
  assert.equal(isProficient(mage, 'lore'), true)
  assert.equal(isProficient(mage, 'stealth'), false)
})

test('outcome tiers: crit / fumble / success / partial / fail', () => {
  assert.equal(resolve({ role: mage, skill: 'lore', dc: 20, rng: face(20) }).tier, 'crit')   // nat20 auto
  assert.equal(resolve({ role: mage, skill: 'lore', dc: 5, rng: face(1) }).tier, 'fumble')   // nat1 auto
  // d20=11 + wits3 + prof2 = 16
  assert.equal(resolve({ role: mage, skill: 'lore', dc: 12, rng: face(11) }).total, 16)
  assert.equal(resolve({ role: mage, skill: 'lore', dc: 12, rng: face(11) }).tier, 'success')
  assert.equal(resolve({ role: mage, skill: 'lore', dc: 18, rng: face(11) }).tier, 'partial') // 16 >= 15
  assert.equal(resolve({ role: mage, skill: 'lore', dc: 20, rng: face(11) }).tier, 'fail')    // 16 < 17
})

test('canPerform gates on mana / stamina / hp', () => {
  const [firebolt, smash, bighit] = mage.abilities
  assert.equal(canPerform(mage, { mana: 6, stamina: 4 }, firebolt).ok, true)
  assert.deepEqual(canPerform(mage, { mana: 2, stamina: 4 }, firebolt), { ok: false, reason: 'no-mana' })
  assert.equal(canPerform(mage, { mana: 6, stamina: 4 }, smash).ok, true)
  assert.deepEqual(canPerform(mage, { mana: 6, stamina: 4 }, bighit), { ok: false, reason: 'no-stamina' })
  assert.deepEqual(canPerform(mage, { hp: 0, mana: 6, stamina: 4 }, firebolt), { ok: false, reason: 'down' })
})

test('a 0-mana martial role cannot cast', () => {
  const knight = { resources: { hp: 26, mana: 0, stamina: 10 }, abilities: [{ id: 'fireball', cost: { mana: 3 } }] }
  assert.deepEqual(canPerform(knight, null, knight.abilities[0]), { ok: false, reason: 'no-mana' })
})

test('spendCost deducts mana + stamina, floored at 0', () => {
  assert.deepEqual(spendCost({ mana: 6, stamina: 4 }, mage.abilities[0]), { mana: 3, stamina: 4 })
  assert.deepEqual(spendCost({ mana: 0, stamina: 1 }, mage.abilities[1]), { mana: 0, stamina: 0 })
})
