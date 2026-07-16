import { useEffect, useState } from 'react'
import { getJSON } from '../api.js'

const TERRAIN = { village: '⌂', warcamp: '※', river: '≈', forest: '♣', mountains: '▲', gate: '∏', barrow: '†', ruins: '⌂', station: '◇', ship: '◇' }

const THEMES = {
  parchment: {
    bg: 'radial-gradient(120% 100% at 50% 40%, #efe4c6 0%, #e2d3ab 55%, #cdb684 100%)',
    frame: '#b49a68', ink: '#3c2c17', inkSoft: '#6b5334', ember: '#e8791a', emberGlow: '#ffb54d',
    trail: '#5b431f', fog: 'rgba(150,140,120,.55)', label: 'rgba(241,230,200,.9)', title: '#3c2c17',
  },
  starchart: {
    bg: 'radial-gradient(120% 100% at 50% 30%, #0f1830 0%, #0a0f1f 60%, #05070f 100%)',
    frame: '#1e2b4a', ink: '#9fc7ff', inkSoft: '#6f8fc0', ember: '#f59e0b', emberGlow: '#ffd27a',
    trail: '#3a5488', fog: 'rgba(60,80,120,.5)', label: 'rgba(6,10,20,.85)', title: '#bcd4ff',
  },
}
const themeFor = (style) => /sci-?fi|space|cyber|station|nebula|star/i.test(style || '') ? THEMES.starchart : THEMES.parchment

export default function MapView({ sessionId, onClose }) {
  const [data, setData] = useState(null)
  const [sel, setSel] = useState(null)

  useEffect(() => {
    getJSON('/api/game/' + sessionId + '/map').then(d => {
      setData(d)
      setSel((d.places || []).find(p => p.state === 'current') || null)
    }).catch(() => setData({ places: [], edges: [] }))
  }, [sessionId])

  const t = themeFor(data?.style)
  const place = (id) => data?.places?.find(p => p.id === id)

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 fade-in" onClick={onClose}>
      <div className="w-full max-w-4xl rounded-lg overflow-hidden" style={{ background: '#17110b', border: `1px solid ${t.frame}` }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: t.frame }}>
          <div className="font-serif" style={{ color: t.title, letterSpacing: '.04em' }}>🗺 {data?.region || 'Region'} — as far as you have wandered</div>
          <button onClick={onClose} className="text-xs text-stone-400 hover:text-stone-200 border border-ash-600 rounded px-2 py-1">close</button>
        </div>

        <div className="relative w-full" style={{ aspectRatio: '16/10', background: t.bg }}>
          {/* trails */}
          <svg viewBox="0 0 100 62.5" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
            {(data?.edges || []).map((e, i) => {
              const a = place(e.from), b = place(e.to)
              if (!a || !b) return null
              return <line key={i} x1={a.x} y1={a.y * 0.625} x2={b.x} y2={b.y * 0.625}
                stroke={t.trail} strokeWidth="0.5" vectorEffect="non-scaling-stroke"
                strokeLinecap="round" strokeDasharray={e.traveled ? '0.6 2.4' : '0.4 3'} opacity={e.traveled ? 0.9 : 0.45} />
            })}
          </svg>

          {/* fog blooms over hint markers */}
          {(data?.places || []).filter(p => p.state === 'hint').map(p => (
            <div key={'f' + p.id} className="absolute rounded-full pointer-events-none" style={{
              left: p.x + '%', top: p.y + '%', width: 120, height: 120, transform: 'translate(-50%,-50%)',
              background: `radial-gradient(closest-side, ${t.fog}, transparent)`, filter: 'blur(6px)',
            }} />
          ))}

          {/* place markers */}
          {(data?.places || []).map(p => {
            const isCur = p.state === 'current'
            const glyph = TERRAIN[p.terrain] || '•'
            return (
              <button key={p.id} onClick={() => setSel(p)} title={p.name || 'unexplored'}
                className="absolute -translate-x-1/2 -translate-y-1/2 text-center focus:outline-none"
                style={{ left: p.x + '%', top: p.y + '%', width: 120 }}>
                {p.state === 'hint' ? (
                  <div style={{ color: t.inkSoft }}>
                    <div style={{ fontSize: 18, opacity: 0.7 }}>?</div>
                    <div className="text-[9px] italic" style={{ opacity: 0.6 }}>something ahead</div>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-center">
                      {isCur ? (
                        <span className="relative inline-flex" style={{ width: 20, height: 20 }}>
                          <span className="absolute inset-0 m-auto rounded-full" style={{ width: 10, height: 10, background: `radial-gradient(circle at 40% 35%, ${t.emberGlow}, ${t.ember})`, boxShadow: `0 0 10px 3px ${t.ember}aa` }} />
                          <span className="absolute inset-0 m-auto rounded-full ping-ring" style={{ width: 10, height: 10, border: `2px solid ${t.ember}` }} />
                        </span>
                      ) : (
                        <span style={{ fontSize: 17, color: t.ink, opacity: p.state === 'visited' ? 0.95 : 0.8 }}>{glyph}</span>
                      )}
                    </div>
                    <div className="text-[11px] font-serif" style={{
                      color: isCur ? t.ember : t.ink, letterSpacing: '.06em',
                      textShadow: `0 1px 1px ${t.label}`, fontWeight: isCur ? 700 : 500,
                      opacity: p.state === 'known' ? 0.85 : 1,
                    }}>{p.name}</div>
                    {isCur && <div className="text-[8px] uppercase tracking-widest" style={{ color: t.ember }}>you are here</div>}
                    {p.state === 'known' && <div className="text-[8px] italic" style={{ color: t.inkSoft }}>scouted</div>}
                  </>
                )}
              </button>
            )
          })}

          {!data && <div className="absolute inset-0 flex items-center justify-center text-stone-500 text-sm">unrolling the map…</div>}
        </div>

        {/* selected place / legend */}
        <div className="px-4 py-3 flex items-start justify-between gap-4" style={{ background: '#1a130b' }}>
          <div className="min-w-0">
            {sel ? <>
              <div className="font-serif" style={{ color: t.emberGlow }}>{sel.name}</div>
              <p className="text-xs text-stone-400 mt-0.5">{sel.desc}</p>
            </> : <div className="text-xs text-stone-500">The rest is lost in mist — explore, or send a scout, to reveal it.</div>}
          </div>
          <div className="text-[10px] text-stone-500 whitespace-nowrap space-y-0.5 text-right shrink-0">
            <div><span style={{ color: t.ember }}>●</span> here &nbsp; <span style={{ color: t.ink }}>†</span> visited</div>
            <div><span style={{ color: t.inkSoft }}>?</span> unexplored &nbsp; <span style={{ color: t.inkSoft }}>scouted</span> = seen, not been</div>
          </div>
        </div>
      </div>
    </div>
  )
}
