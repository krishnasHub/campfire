# 🔥 campfire

A text-based storytelling RPG where a party of **9 AI "gamer companions"** adventure alongside you across fantasy (and sci-fi) campaigns. Each companion has a fixed personality **and** live "mood" dials — and both drive *what they do*, not just how they talk. You play one role in a story; your companions play the rest, coloured by who they are and how they're feeling.

Built with Node/Express + React/Vite, powered by the [Venice AI](https://venice.ai) API. Saves live in SQLite.

## The core ideas
- **Role × Actor** — a story defines up to 4 character sheets (stats/abilities/resources); you play one, companions play the rest. How a companion plays a role = *their personality × the role's toolkit × their current mood*.
- **Authored story decision-graph** — each campaign is a DAG of quest beats with branch conditions the engine (not the LLM) evaluates, so stories stay coherent and consequential. Lint guarantees no dead-ends.
- **Light dice** — the server rolls (d20 + stat + proficiency → outcome tier); the LLM narrates the result and never invents numbers. A 0-mana knight literally can't cast.
- **Genre-agnostic engine** — resources are open named pools, skills are extensible, image styles are a table. A sci-fi campaign runs on the same code as a fantasy one.

## Setup
```bash
npm run install:all                 # root + server + client deps
cp .env.example server/.env         # then set VENICE_API_KEY=...
```

## Run
```bash
# Windows:  start.bat   (or start.ps1)
# Mac/Linux: ./start.sh
# or:
npm run dev                         # server :3001 + client :5173
```
Open http://localhost:5173.

## Structure
```
server/
  services/  bots, campaigns, roles, dice, gameState, storyGraph, gm, modelJobs, db, saves, venice, imageGen
  routes/    campaigns.js, game.js         (NDJSON round orchestrator)
  data/      campaigns/*.json (authored)  + campfire.db (SQLite saves)
client/src/
  screens/   StartScreen, SetupScreen, PlayScreen
  components/ CompanionCard, PartyPanel, MoodSliders, DiceRoll, ObjectiveTracker
```

## Status
Playable end-to-end: pick a story → choose your role → assign companions (+ tune moods) → play round-by-round with streaming GM narration, dice, companion inner-reads/actions, and scene images. Story Editor + more campaigns are in progress.
