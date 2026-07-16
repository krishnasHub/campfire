# campfire — Progress & Handoff

_A running record of what's built, the decisions behind it, and what's next. In a new session, read this first, then continue._

**Repo:** `github.com/krishnasHub/campfire` (main). **Local:** `C:\Users\krish\dev\campfire`.
**Run:** `.\start.ps1` (self-updates, installs deps, opens browser, Ctrl+C stops both). Server :3001, client :5173.
**Original plan file:** `C:\Users\krish\.claude\plans\crispy-greeting-dijkstra.md`.

---

## What it is
A text storytelling RPG. A roster of **9 AI "gamer companions"** (real people with personalities + adjustable "mood" dials) play a story alongside you. You pick a campaign, choose one of its ≤4 roles, assign companions to the rest, and play round-by-round with a narrator (GM), dice, companion turns, images, a fog-of-war map, and player-controlled pacing. Powered by **Venice AI**; saves in **SQLite**.

## The core model
- **Role × Actor.** A campaign defines ≤4 role sheets (stats/abilities/resources). You play one; companions play the others. A companion's behavior = *their personality × the role's toolkit × their current mood.*
- **Two state layers:** dynamic **Game State** (HP/mana/stamina/flags/discovered) + an authored **Story decision-graph** (nodes = beats, engine-evaluated branch conditions). Engine (pure JS) owns transitions; the LLM narrates.
- **Genre-agnostic engine:** resources are open named pools, skills extensible, image styles a table. A sci-fi campaign runs on the same code (proven by a unit test).

---

## Status: fully playable end-to-end
Milestones **M0–M9 complete**, plus a big round of play-UX. All 13 engine unit tests green (`npm test` in /server). The backend is verified live against Venice; the **in-browser UI has NOT been personally click-tested by the assistant** (no browser tooling) — build + API are verified.

### Done
- **M0** Express + SQLite scaffold, venice/imageGen/modelJobs.
- **M1** 9 companions (`server/services/bots.js`) — fixed core + 7 mood dials (wit/warmth/sarcasm/drama/flirt/profanity/eros), mood→behavior prompt.
- **M2** Dice engine (`dice.js`: d20+stat+proficiency→tiers) + gating (`roles.js`: `canPerform`, open resource pools).
- **M3** Game state (`gameState.js`) + SQLite saves/transcript (`saves.js`, `db.js`) + campaign loader (`campaigns.js`).
- **M4** Story-graph engine (`storyGraph.js`: condition DSL, `advance`, `lint`, `chooseBranchTrace`) + **Hollowreach** campaign (`data/campaigns/hollowreach.json`).
- **M5/M6** Round orchestrator (`routes/game.js`) + GM/companion LLM layer (`gm.js`): intent→dice→GM→adjudicate→advance→companions.
- **M7** React client: StartScreen, SetupScreen, PlayScreen (streaming), components.
- **M8** In-play images.
- **M9** Story Editor (`StoryEditor.jsx`) + AI generation (`storyGen.js`, lint-clean, cross-genre) + Mermaid flow map.

### Play-UX & feature work (post-M9)
- **End-to-end logging** → `server.log` (cleared each restart). `[round]`, `[gm]`, `[req]` traces; adjudicator flag deltas; branch pass/blocked traces; `DEBUG_PROMPTS=1` dumps full prompts. Browser: `localStorage.setItem('cf-debug','1')`.
- **Player-driven pacing.** Enter **stages** a line (compose a turn from several say/do messages). **"End turn"** runs the round. **"Press onward →"** advances the story (pulses when the goal is met). Normal turns only fire **reactive** branches (consequences like an alarm, flagged `"reactive": true`); progress requires press-onward. Press-onward "commits fresh" (clears the beat's tentative progress flags so your stated direction wins — fixed a stray-flag bug).
- **Current-goal banner** + new-beat scene cards + suggested-action chips (`[OPTIONS: …]` from the GM) + one-time how-to.
- **Per-campaign narrator.** `narrator {name, persona}` drives the GM voice; Hollowreach = **Elaneth, the Ashen Seer**. Hard anti-leak rule (no "I am GLM…"). storyGen authors one.
- **Companion delegation + scouting.** Companions now see your actual words and obey direct orders. A scout order (regex + who's addressed) forces `SCOUT` deterministically; the companion returns concrete intel and **reveals the adjacent nodes** (`gameState.discovered`) = lifts fog.
- **Fog-of-war map** (`🗺` toggle, `MapView.jsx`). `GET /api/game/:id/map` applies fog server-side: visited/current/known named; adjacent-unknown are unnamed **"hint"** markers; endings never hinted. Themed (parchment / star-chart). Hollowreach has authored `map.nodes` coords + terrain.
- **Character ⓘ** on setup AND play (`CharacterSheet.jsx`): generated **portrait** + backstory + stats + abilities. Portraits are **campaign-level** cached (`POST /api/campaigns/:id/portrait`).
- **Story snapshots** on setup: 5 spoiler-safe images (2 landscape, 2 hero, 1 mood), generated **in parallel**, cached (`snapshots` table), `↻` refresh strip.

---

## Key decisions (and why)
- **SQLite (better-sqlite3)** over JSON files — user chose it; installs via prebuilt binary (no native build). saves + append-only transcript, atomic per-round commit. Authored campaigns stay as **git-friendly JSON files**; only runtime saves + images (portraits/snapshots) are in the DB. Schema migrations via `PRAGMA user_version` (currently v3).
- **Unfiltered content tier.** Models per job (`modelJobs.js`): GM/companion-read/storyGen = `olafangensan-glm-4.7-flash-heretic` (uncensored reasoner); companion action = `venice-uncensored-role-play`; adjudicator/intent = `venice-uncensored-1-2`; storyGen fallback = `gemma-4-uncensored`.
- **Images:** `seedream-v5-pro` default (cinematic, user preference), `flux-2-pro` for character portraits, `lustify-v8` uncensored fallback. Style table by `universe.artStyle` (fantasy/sci-fi/cyberpunk/…).
- **Pacing = player controls WHEN, engine controls WHERE.** Chosen after the story rushed through beats. Reactive-vs-progress branch split + press-onward.
- **Narrator per-campaign** (not one voice) — user wanted Galadriel-style for RPG, ship's-AI for sci-fi. Hollowreach's narrator is an original character (not literally Galadriel).
- **Map = schematic fog-of-war, derived from the story graph** (accurate, spoiler-safe, free) — chosen over an AI-drawn map (garbled labels, fake geography). Coords are lightly authored per campaign; auto-layout is the fallback for generated campaigns (auto-layout NOT yet implemented — see TODO).
- **Scout obedience is deterministic** (regex override), because the reasoning model wouldn't reliably pick the SCOUT decision token.

---

## Known issues / polish TODO
- **Latency:** a full round is ~60–95s (many serial reasoning-model calls: intent + GM + adjudicate + 3×(read+action+adjudicate)). Consider a non-reasoning model for cheap passes and/or parallelizing companion inner-reads. Snapshots ~47s (parallel).
- **Role-detail drift:** the GM occasionally misremembers a role's class/gear (e.g. gave the warden a longbow). Fix: put class/gear into the serialized scene-state block (`gameState.serializeForPrompt`).
- **Generated-campaign maps:** `map.nodes` coords are authored only for Hollowreach; AI-generated campaigns have no coords → **auto-layout not built yet**, so their map would be empty. Either add auto-layout or have `storyGen` emit coords.
- **In-browser UI unverified by assistant** — worth a real playthrough; send `server.log` / browser console (`cf-debug`) if anything's off.
- **Snapshots "fresh per game"** is currently "cached + ↻ refresh" (not auto-fresh per playthrough) — revisit if desired.

## Open ideas (discussed, not built)
- AI-generated **decorative map backdrop** per campaign (under the accurate schematic).
- **Campaigns #2 & #3** (The Ashfall Marches, Veils of Qadir) via the Story Editor.
- **Player-initiated scouting** reveal (currently companion SCOUT reveals; player scout could too).
- Deeper combat / beat turn-minimums / initiative.

---

## File map (where things live)
```
server/services/
  bots.js        9 companions, buildSystemPrompt (+anti-leak), inner-read/DECISION
  dice.js        roll/resolve/tiers, skill→stat (+registerSkillStats)
  roles.js       canPerform (open resource pools), spendCost
  storyGraph.js  condition DSL, advance(reactiveOnly), lint, chooseBranchTrace, conditionFlags
  gameState.js   buildInitialState, serializeForPrompt, applyDeltas, discovered
  gm.js          parseIntent, narrateGM(+narrator/anti-leak/OPTIONS), adjudicate,
                 companionInnerRead(+delegation), companionAction(+scoutIntel), extractOptions
  storyGen.js    staged AI authoring + repairGraph (guarantees lint-clean) + narrator
  campaigns.js   load/list/save campaign JSON
  modelJobs.js   model-per-job map
  saves.js       SQLite CRUD: saves, transcript, portraits, snapshots
  db.js          SQLite + migrations (v3)
  imageGen.js    Venice image client, artStyle table, explicit fallback
  venice.js      streaming chat client
server/routes/
  game.js        start/opening/round/resume/mood/delete/portrait/map (round orchestrator)
  campaigns.js   list/get/validate/save/generate/portrait/snapshots
server/data/campaigns/hollowreach.json   the launch campaign (+narrator +map)
client/src/screens/    StartScreen, SetupScreen, PlayScreen, StoryEditor
client/src/components/  CompanionCard, PartyPanel, MoodSliders, DiceRoll, ObjectiveTracker,
                       CharacterSheet, MapView, StoryGraphView
```

## The 9 companions
Arjun (Indian, planner/ranged/stealth), Sofia (Italian, reckless/melee/face), Daniel (Nigerian-British, planner/support/leader), Kenji (Japanese, opportunist/melee), Nadia (Egyptian, opportunist/ranged/stealth), Oliver (Czech, planner/caster/support), Camila (Mexican, balanced/support/leader), Ji-woo (Korean, reckless/caster), Talia (Samoan, balanced/melee/support). Each: multi-fandom, real-life personality, 7 mood dials.
