import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createWriteStream } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import './services/db.js' // opens the SQLite DB + runs migrations at boot
import campaignsRouter from './routes/campaigns.js'
import gameRouter from './routes/game.js'
import { BOT_LIST } from './services/bots.js'

// Mirror all console output to server.log in the project root so logs can be read externally
const __dirname = dirname(fileURLToPath(import.meta.url))
const LOG_PATH = join(__dirname, '..', 'server.log')
const logStream = createWriteStream(LOG_PATH, { flags: 'w' }) // 'w' clears on each restart

function writeLine(level, args) {
  const ts = new Date().toISOString()
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
  logStream.write(`[${ts}] [${level}] ${msg}\n`)
}

const _log = console.log.bind(console)
const _warn = console.warn.bind(console)
const _error = console.error.bind(console)
console.log = (...a) => { _log(...a); writeLine('LOG', a) }
console.warn = (...a) => { _warn(...a); writeLine('WARN', a) }
console.error = (...a) => { _error(...a); writeLine('ERROR', a) }

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json({ limit: '10mb' }))

app.use('/api/campaigns', campaignsRouter)
app.use('/api/game', gameRouter)

// The 9 companions (public roster for the start screen)
app.get('/api/companions', (req, res) => res.json(BOT_LIST))

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', apiKeySet: !!process.env.VENICE_API_KEY })
})

app.listen(PORT, () => {
  console.log(`campfire server running on http://localhost:${PORT}`)
  if (!process.env.VENICE_API_KEY) {
    console.warn('WARNING: VENICE_API_KEY is not set. Copy .env.example to server/.env and add your key.')
  }
})
