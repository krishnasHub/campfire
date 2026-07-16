import axios from 'axios'

const BASE_URL = 'https://api.venice.ai/api/v1'

// Default text model when a caller doesn't specify one. Every game job passes an explicit
// model via modelJobs.js, so this is just a safety fallback.
const TEXT_MODEL = 'venice-uncensored-role-play'

function headers() {
  return {
    Authorization: `Bearer ${process.env.VENICE_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

// Core streaming request — returns the accumulated visible content string.
// Reasoning models emit hidden thinking under delta.reasoning_content; we ignore it
// (only delta.content is surfaced). Reasoning jobs get a larger maxTokens (see modelJobs).
async function doStream(model, messages, onChunk, temperature = 0.92, maxTokens = 600, _retry = true) {
  let response
  try {
    response = await axios({
      method: 'post',
      url: `${BASE_URL}/chat/completions`,
      headers: headers(),
      data: { model, messages, temperature, max_tokens: maxTokens, stream: true },
      responseType: 'stream',
      timeout: 90000,
    })
  } catch (err) {
    if (_retry && err.response?.status === 429) {
      const wait = parseInt(err.response.headers['retry-after'] ?? '10', 10) * 1000
      console.warn(`[venice] rate limited — retrying in ${wait / 1000}s`)
      await new Promise(r => setTimeout(r, wait))
      return doStream(model, messages, onChunk, temperature, maxTokens, false)
    }
    throw err
  }

  let fullContent = ''
  return new Promise((resolve, reject) => {
    let buffer = ''
    response.data.on('data', (raw) => {
      buffer += raw.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        const payload = trimmed.slice(6)
        if (payload === '[DONE]') continue
        try {
          const parsed = JSON.parse(payload)
          const delta = parsed.choices?.[0]?.delta ?? {}
          const chunk = delta.content ?? ''
          if (chunk) { fullContent += chunk; onChunk?.(chunk) }
        } catch { /* malformed SSE line */ }
      }
    })
    response.data.on('end', () => resolve(fullContent))
    response.data.on('error', reject)
  })
}

// Stream a chat completion, forwarding visible chunks via onChunk. Returns the full string.
export async function streamChatCompletion({ messages, onChunk = null, temperature = 0.92, maxTokens = 600, model = null }) {
  return doStream(model || TEXT_MODEL, messages, onChunk, temperature, maxTokens)
}
