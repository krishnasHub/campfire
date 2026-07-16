const J = { 'Content-Type': 'application/json' }

export const getJSON = (u) => fetch(u).then(r => r.json())
export const postJSON = (u, b) => fetch(u, { method: 'POST', headers: J, body: JSON.stringify(b || {}) }).then(r => r.json())
export const patchJSON = (u, b) => fetch(u, { method: 'PATCH', headers: J, body: JSON.stringify(b || {}) }).then(r => r.json())
export const del = (u) => fetch(u, { method: 'DELETE' }).then(r => r.json())

// Stream an NDJSON POST response, invoking onEvent(obj) for each JSON line.
export async function streamNDJSON(url, body, onEvent, signal) {
  const res = await fetch(url, { method: 'POST', headers: J, body: JSON.stringify(body || {}), signal })
  if (!res.ok || !res.body) throw new Error('stream failed: ' + res.status)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const l of lines) {
      if (!l.trim()) continue
      try { onEvent(JSON.parse(l)) } catch { /* skip malformed */ }
    }
  }
}
