// The cache panel under the office map, in the same ALTERX language: a ring that
// runs down to the cache's expiry, the hit rate, what the context is made of, and
// the warmer's state. SMIL only; nothing in it ticks through a redraw.

const C = {
  bg: '#030806',
  panel: '#06110B',
  glass: '#0B1F15',
  deep: '#123D27',
  text: '#E8F7EE',
  muted: '#91A89B',
  mint: '#9FFFC0',
  mint2: '#5BEA99',
  gold: '#E9D58A',
}
const FONT = 'Manrope, Inter, ui-sans-serif, system-ui, sans-serif'
export const CACHE_VIEW = { width: 720, height: 300 }

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const kilo = n => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`)

// Share of input tokens served from the cache, over everything sent.
export function hitRate(totals) {
  const all = totals.read + totals.written + totals.fresh
  return all === 0 ? null : totals.read / all
}

function bar(label, tokens, share, y, color, k) {
  const width = Math.max(2, 300 * share)
  return `<g transform="translate(380 ${y})">
  <text y="0" font-size="8" letter-spacing="2.5" fill="${C.muted}">${label}</text>
  <text x="300" y="0" text-anchor="end" font-size="9" font-weight="700" fill="${C.text}">${kilo(tokens)}</text>
  <rect y="6" width="300" height="6" rx="3" fill="${C.mint}" fill-opacity="0.08"/>
  <rect y="6" width="0" height="6" rx="3" fill="${color}">
    <animate attributeName="width" values="0;${width.toFixed(1)}" dur="0.9s" begin="${k * 0.12}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.7 0.3 1"/></rect>
</g>`
}

// `state` is the mod's cache record; `left` the seconds the cache has left now.
export function cachePanelSvg(state, left, width, height) {
  const rate = hitRate(state.totals)
  const ring = 2 * Math.PI * 62
  const share = state.ttl > 0 ? Math.max(0, Math.min(1, left / state.ttl)) : 0
  const live = state.lastAt !== null && left > 0
  const cap = state.ttl <= 300 ? 10 : 3
  const saved = state.totals.read * 0.9
  const blocks = state.blocks
  const used = blocks ? blocks.system + blocks.project + blocks.conversation : 0
  const lastPing = state.pingLog.length > 0 ? state.pingLog[state.pingLog.length - 1] : null

  // The ring runs from the share left now down to empty over the seconds left.
  const countdown = live
    ? `<animate attributeName="stroke-dashoffset" values="${(ring * (1 - share)).toFixed(2)};${ring.toFixed(2)}" dur="${Math.max(1, Math.round(left))}s" fill="freeze"/>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${CACHE_VIEW.width} ${CACHE_VIEW.height}" font-family="${FONT}">
<defs>
  <radialGradient id="cGlow" cx="18%" cy="50%" r="55%"><stop offset="0" stop-color="${C.mint2}" stop-opacity="0.16"/><stop offset="1" stop-color="${C.bg}" stop-opacity="0"/></radialGradient>
  <filter id="cSoft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<rect width="720" height="300" fill="${C.bg}"/>
<rect x="8" y="8" width="704" height="284" rx="16" fill="${C.panel}" stroke="${C.mint}" stroke-opacity="0.16"/>
<rect x="8" y="8" width="704" height="284" rx="16" fill="url(#cGlow)"/>
<text x="28" y="38" font-size="10" font-weight="800" letter-spacing="5" fill="${C.text}">PROMPT<tspan fill="${C.mint}"> CACHE</tspan></text>
<text x="692" y="38" text-anchor="end" font-size="8" letter-spacing="2" fill="${C.muted}">TTL ${state.ttl >= 3600 ? '1 HOUR' : `${Math.round(state.ttl / 60)} MIN`} · ${live ? 'WARM' : 'COLD'}</text>
<g transform="translate(130 165)">
  <circle r="62" fill="none" stroke="${C.mint}" stroke-opacity="0.1" stroke-width="9"/>
  <circle r="62" fill="none" stroke="${live ? C.mint : C.muted}" stroke-width="9" stroke-linecap="round" transform="rotate(-90)" stroke-dasharray="${ring.toFixed(2)}" stroke-dashoffset="${(ring * (1 - share)).toFixed(2)}" filter="url(#cSoft)">${countdown}</circle>
  <text y="2" text-anchor="middle" font-size="26" font-weight="800" fill="${C.text}">${rate === null ? '—' : `${Math.round(rate * 100)}%`}</text>
  <text y="20" text-anchor="middle" font-size="7.5" letter-spacing="2.5" fill="${C.muted}">HIT RATE</text>
  <text y="96" text-anchor="middle" font-size="8" letter-spacing="2" fill="${live ? C.mint : C.muted}">${live ? 'TIME LEFT ON THE RING' : 'NOT CACHED YET'}</text>
</g>
${blocks ? bar('SYSTEM', blocks.system, used ? blocks.system / used : 0, 72, C.mint, 0) : ''}
${blocks ? bar('PROJECT', blocks.project, used ? blocks.project / used : 0, 108, C.gold, 1) : ''}
${blocks ? bar('CONVERSATION', blocks.conversation, used ? blocks.conversation / used : 0, 144, '#7FE3FF', 2) : `<text x="380" y="110" font-size="10" fill="${C.muted}">Context breakdown shows after the first reply.</text>`}
<g transform="translate(380 194)">
  <text font-size="8" letter-spacing="2.5" fill="${C.muted}">TOKENS SAVED</text>
  <text y="20" font-size="16" font-weight="800" fill="${C.mint}">${kilo(saved)}</text>
  <text x="150" font-size="8" letter-spacing="2.5" fill="${C.muted}">READ · WRITTEN</text>
  <text x="150" y="20" font-size="12" font-weight="700" fill="${C.text}">${kilo(state.totals.read)} · ${kilo(state.totals.written)}</text>
</g>
<g transform="translate(380 244)">
  <circle cx="4" cy="-3" r="4" fill="${state.warm ? C.mint : C.muted}">${state.warm ? `<animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite"/>` : ''}</circle>
  <text x="14" font-size="8" letter-spacing="2" fill="${state.warm ? C.mint : C.muted}">WARMER ${state.warm ? 'ON' : 'OFF'} · ${state.pings}/${cap} PINGS${state.pings >= cap ? ' · CAP REACHED' : ''}</text>
  <text x="14" y="16" font-size="8.5" fill="${C.muted}">${esc(lastPing ? `last ping read ${kilo(lastPing.read)} from cache${lastPing.ok ? '' : ' (failed)'} · ${kilo(state.warmRead)} read by warming in all` : 'pings once the session sits idle near the end of the TTL')}</text>
</g>
</svg>`
}
