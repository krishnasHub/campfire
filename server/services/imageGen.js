import axios from 'axios'

const BASE_URL = 'https://api.venice.ai/api/v1'

// Art-style -> { Venice image model, prompt prefix }. GENRE-AGNOSTIC: the campaign's
// universe.artStyle selects the look, so a sci-fi story renders as sci-fi, not fantasy.
// Models verified against the live API. Unknown styles fall back to a neutral cinematic prefix.
const STYLES = {
  'cinematic-fantasy':  { model: 'seedream-v5-pro',  prefix: 'cinematic fantasy concept art, dramatic lighting, highly detailed, atmospheric,' },
  'sci-fi':             { model: 'seedream-v5-pro',  prefix: 'cinematic science-fiction concept art, sleek advanced technology, dramatic lighting, highly detailed,' },
  'space-opera':        { model: 'seedream-v5-pro',  prefix: 'epic space-opera concept art, starships and alien vistas, dramatic lighting, highly detailed,' },
  'cyberpunk':          { model: 'seedream-v5-pro',  prefix: 'cyberpunk concept art, neon-drenched, rain-slick streets, highly detailed,' },
  'post-apocalyptic':   { model: 'seedream-v5-pro',  prefix: 'post-apocalyptic concept art, weathered ruins, moody atmosphere, highly detailed,' },
  'character-portrait': { model: 'flux-2-pro',       prefix: 'cinematic character portrait, sharp focus, highly detailed,' },
  'anime':              { model: 'wai-Illustrious',  prefix: 'anime illustration, vivid, highly detailed,' },
  'highest-quality':    { model: 'qwen-image',       prefix: 'ultra high quality, highly detailed, masterwork,' },
}
const DEFAULT_STYLE = 'cinematic-fantasy'
const NEUTRAL_PREFIX = 'cinematic concept art, dramatic lighting, highly detailed, atmospheric,'
const EXPLICIT_FALLBACK_MODEL = 'lustify-v8'

const EXPLICIT_RE = /\b(naked|nude|topless|lingerie|sex(?:ual|ually)?|fuck(?:ing|ed)?|cock|pussy|cum(?:ming)?|orgasm|penetrat|blowjob|nipple|bare\s+breast|genitals?|aroused|climax|erotic(?:ally)?)\b/i

const BASE_NEGATIVE = 'ugly, deformed, blurry, extra limbs, bad anatomy, watermark, text, logo, low quality, jpeg artifacts'

function client() {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${process.env.VENICE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 120000,
  })
}

// Generate one scene/character image. Grounded prompt is built by the caller (gm/withAppearance).
// artStyle selects the model; explicit=true (or an explicit-reading prompt) routes to lustify;
// a content violation on a general model retries once on lustify as a second line of defence.
export async function generateImage(prompt, { artStyle = DEFAULT_STYLE, explicit = false, width = 1216, height = 832 } = {}) {
  const style = STYLES[artStyle] ?? { model: STYLES[DEFAULT_STYLE].model, prefix: NEUTRAL_PREFIX }
  const wantsExplicit = explicit || EXPLICIT_RE.test(prompt)
  const model = wantsExplicit ? EXPLICIT_FALLBACK_MODEL : style.model
  const body = {
    model,
    prompt: `${style.prefix} ${prompt}`,
    negative_prompt: BASE_NEGATIVE,
    width,
    height,
    format: 'webp',
    safe_mode: false,
  }

  console.log(`[imageGen] model=${model} style=${artStyle} explicit=${wantsExplicit} (${body.prompt.length} chars)`)

  for (let attempt = 1; attempt <= 3; attempt++) {
    let res
    try {
      res = await client().post('/image/generate', body)
    } catch (err) {
      const status = err.response?.status
      if (attempt < 3 && (status === 504 || status === 429 || status === 502)) {
        const wait = status === 429 ? parseInt(err.response.headers['retry-after'] ?? '10', 10) * 1000 : 6000
        console.warn(`[imageGen] ${status} on attempt ${attempt} — retrying in ${wait / 1000}s`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      throw err
    }

    const isViolation = res.headers['x-venice-is-content-violation'] === 'true'
    const isBlurred = res.headers['x-venice-is-blurred'] === 'true'
    if ((isViolation || isBlurred) && body.model !== EXPLICIT_FALLBACK_MODEL) {
      console.warn(`[imageGen] content violation on ${body.model} — retrying on ${EXPLICIT_FALLBACK_MODEL}`)
      body.model = EXPLICIT_FALLBACK_MODEL
      continue
    }

    const raw = res.data.images?.[0]
    if (!raw) throw new Error('No image data in Venice response')
    console.log(`[imageGen] got image (${Math.round(raw.length / 1024)}KB)`)
    return `data:image/webp;base64,${raw}`
  }
  throw new Error('Image generation failed after retries')
}
