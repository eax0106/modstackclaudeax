// The office map, drawn in the ALTERX design language: near-black green, mint
// accents, glass panels and a morphing blob at the centre. Motion is SMIL only,
// since the desktop draws the SVG in a frame that runs no script.

const C = {
  bg: '#030806',
  panel: '#06110B',
  glass: '#0B1F15',
  deep: '#123D27',
  text: '#E8F7EE',
  muted: '#91A89B',
  mint: '#9FFFC0',
  mint2: '#5BEA99',
  error: '#FF6B6B',
}
const FONT = 'Manrope, Inter, ui-sans-serif, system-ui, sans-serif'
const TIER_COLOR = { haiku: '#9FFFC0', sonnet: '#7FE3FF', opus: '#C9A8FF' }

const CORE = { x: 440, y: 236 }
const DESKS = Array.from({ length: 9 }, (_, i) => ({ x: 52 + (i % 3) * 112, y: 96 + Math.floor(i / 3) * 104 }))
const LOUNGE = Array.from({ length: 4 }, (_, i) => ({ x: 582 + (i % 2) * 76, y: 328 + Math.floor(i / 2) * 58 }))
const ARCHIVE = Array.from({ length: 4 }, (_, i) => ({ x: 582 + (i % 2) * 76, y: 156 + Math.floor(i / 2) * 54 }))

// Three blobs with the same commands, so the core can morph between them.
const BLOBS = [
  'M0,-38 C22,-40 40,-20 38,0 C36,22 20,38 0,38 C-24,40 -40,20 -38,0 C-36,-22 -20,-36 0,-38Z',
  'M4,-42 C30,-36 36,-14 40,4 C42,26 14,34 -2,40 C-26,42 -42,16 -36,-4 C-32,-28 -18,-44 4,-42Z',
  'M-2,-36 C18,-44 44,-26 34,-2 C30,18 26,42 2,36 C-20,32 -44,26 -40,2 C-38,-20 -22,-30 -2,-36Z',
]

// Where each worker stood at the last drawing, so a status change walks them over.
const lastSeat = new Map()

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const short = (s, n) => {
  const flat = String(s).replace(/\s+/g, ' ').trim()
  return flat.length > n ? flat.slice(0, n - 1) + '…' : flat
}
const hash = s => {
  let h = 7
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}
const tierOf = model => (model ? ['haiku', 'sonnet', 'opus'].find(t => model.includes(t)) ?? null : null)

function seatAll(list) {
  const seats = []
  let desk = 0
  let lounge = 0
  let archive = 0
  let hidden = 0
  for (const w of list) {
    let spot
    if (w.status === 'working' || w.status === 'error') {
      const d = DESKS[desk]
      spot = d && { x: d.x + 32, y: d.y + 60, desk: desk }
      desk += 1
    } else if (w.status === 'idle') {
      spot = LOUNGE[lounge++]
    } else {
      spot = ARCHIVE[archive++]
    }
    if (spot) seats.push({ w, ...spot })
    else hidden += 1
  }
  return { seats, hidden }
}

function desk(d, i, worker) {
  const busy = worker && worker.status === 'working'
  const broken = worker && worker.status === 'error'
  const glow = busy ? (TIER_COLOR[tierOf(worker.model)] ?? C.mint) : broken ? C.error : null
  const lines = busy
    ? [0, 1, 2]
        .map(
          k => `<rect x="${26}" y="${8 + k * 3.5}" height="1.6" rx="0.8" fill="${glow}" opacity="0.85">
      <animate attributeName="width" values="2;${10 + ((i + k) % 3) * 3};4;${12 - k * 2};2" dur="${1.2 + k * 0.35}s" repeatCount="indefinite"/></rect>`,
        )
        .join('')
    : ''
  return `<g transform="translate(${d.x} ${d.y})">
  <rect x="0" y="0" width="64" height="28" rx="6" fill="${C.glass}" stroke="${C.mint}" stroke-opacity="0.16"/>
  <rect x="18" y="4" width="28" height="17" rx="3" fill="${C.bg}" stroke="${glow ?? C.mint}" stroke-opacity="${glow ? 0.9 : 0.25}">
    ${glow ? `<animate attributeName="stroke-opacity" values="0.5;1;0.5" dur="${broken ? 0.5 : 2.2}s" repeatCount="indefinite"/>` : ''}
  </rect>
  ${glow ? `<rect x="14" y="0" width="36" height="25" rx="6" fill="${glow}" opacity="0.08" filter="url(#soft)"><animate attributeName="opacity" values="0.04;0.14;0.04" dur="2.4s" repeatCount="indefinite"/></rect>` : ''}
  ${lines}
  <rect x="22" y="40" width="20" height="10" rx="5" fill="${C.deep}" opacity="0.8"/>
</g>`
}

function beam(seat, i, color) {
  const mx = (CORE.x + seat.x) / 2
  const my = Math.min(CORE.y, seat.y) - 40
  const d = `M${CORE.x},${CORE.y} Q${mx},${my} ${seat.x},${seat.y - 30}`
  const sparks = [0, 0.7, 1.4]
    .map(
      b => `<circle r="2.2" fill="${color}" filter="url(#glow)">
    <animateMotion dur="2.1s" begin="${b + (i % 3) * 0.23}s" repeatCount="indefinite"><mpath href="#beam-${i}"/></animateMotion>
    <animate attributeName="opacity" values="0;1;1;0" dur="2.1s" begin="${b + (i % 3) * 0.23}s" repeatCount="indefinite"/></circle>`,
    )
    .join('')
  return `<path id="beam-${i}" d="${d}" fill="none" stroke="${color}" stroke-opacity="0.22" stroke-width="1.2" stroke-dasharray="3 6">
    <animate attributeName="stroke-dashoffset" values="0;-36" dur="1.4s" repeatCount="indefinite"/></path>${sparks}`
}

function person(seat, isSelected) {
  const { w, x, y } = seat
  const h = hash(w.id)
  const tier = tierOf(w.model)
  const color = tier ? TIER_COLOR[tier] : C.muted
  const from = lastSeat.get(w.id)
  const walks = from !== undefined && (from.x !== x || from.y !== y)
  const dx = walks ? from.x - x : 0
  const dy = walks ? from.y - y : 0
  const walkFor = walks ? Math.min(2.6, Math.max(1.1, Math.hypot(dx, dy) / 150)) : 0
  lastSeat.set(w.id, { x, y })

  const enter = walks
    ? `<animateTransform attributeName="transform" type="translate" from="${dx} ${dy}" to="0 0" dur="${walkFor}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.45 0 0.2 1"/>`
    : ''
  const strides = walks ? Math.max(2, Math.round(walkFor / 0.36)) : 0
  const legSwing = (dir, delay) =>
    w.status === 'idle'
      ? `<animateTransform attributeName="transform" type="rotate" values="${-18 * dir} 0 0;${18 * dir} 0 0;${-18 * dir} 0 0" dur="0.9s" begin="${walkFor + delay}s" repeatCount="indefinite"/>`
      : walks
        ? `<animateTransform attributeName="transform" type="rotate" values="${-24 * dir} 0 0;${24 * dir} 0 0;${-24 * dir} 0 0" dur="0.36s" repeatCount="${strides}"/>`
        : ''

  let motion = ''
  if (w.status === 'idle') {
    const a = 10 + (h % 9)
    const b = 6 + ((h >> 3) % 8)
    motion = `<animateMotion path="M0,0 C${a},-${b} ${a + 8},${b} ${a},${b + 4} S-${a},${b} -${a - 2},0 S-4,-${b} 0,0" dur="${9 + (h % 5)}s" begin="${walkFor}s" repeatCount="indefinite"/>`
  } else if (w.status === 'working') {
    motion = `<animateTransform attributeName="transform" type="translate" values="0 0;0 -1.6;0 0" dur="${0.5 + (h % 3) * 0.08}s" begin="${walkFor}s" repeatCount="indefinite"/>`
  } else if (w.status === 'error') {
    motion = `<animateTransform attributeName="transform" type="translate" values="0 0;-2 0;2 0;-1 0;0 0" dur="0.45s" begin="${walkFor}s" repeatCount="indefinite"/>`
  }

  const ring = isSelected
    ? `<g><ellipse cx="0" cy="2" rx="19" ry="7" fill="none" stroke="${C.mint}" stroke-width="1.4" stroke-dasharray="5 4" filter="url(#glow)">
        <animate attributeName="stroke-dashoffset" values="0;-18" dur="1.2s" repeatCount="indefinite"/></ellipse>
        <ellipse cx="0" cy="2" rx="19" ry="7" fill="${C.mint}" opacity="0.08"/></g>`
    : ''
  const alarm =
    w.status === 'error'
      ? `<circle cx="0" cy="-14" r="16" fill="none" stroke="${C.error}" stroke-width="1.5">
        <animate attributeName="r" values="12;26" dur="1.1s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.9;0" dur="1.1s" repeatCount="indefinite"/></circle>`
      : ''
  const bubble =
    w.status === 'working' && w.lastTool
      ? `<g transform="translate(12 -50)" opacity="0">
        <animate attributeName="opacity" values="0;1" dur="0.4s" begin="${walkFor + 0.1}s" fill="freeze"/>
        <rect width="${Math.min(96, 24 + short(w.lastTool, 12).length * 5.4)}" height="16" rx="8" fill="${C.panel}" stroke="${color}" stroke-opacity="0.7"/>
        <text x="8" y="11" font-size="8.5" fill="${C.text}" font-family="${FONT}" font-weight="600">${esc(short(w.lastTool, 12))}</text>
        ${[0, 1, 2]
          .map(
            k => `<circle cx="${Math.min(96, 24 + short(w.lastTool, 12).length * 5.4) - 14 + k * 4}" cy="8" r="1.2" fill="${color}">
          <animate attributeName="opacity" values="0.2;1;0.2" dur="0.9s" begin="${k * 0.15}s" repeatCount="indefinite"/></circle>`,
          )
          .join('')}
      </g>`
      : ''
  const dot = { working: C.mint, idle: '#E9D58A', done: C.muted, error: C.error }[w.status]
  const tag = `<g transform="translate(0 17)">
    <rect x="-38" y="-8" width="76" height="15" rx="7.5" fill="${C.panel}" fill-opacity="0.92" stroke="${color}" stroke-opacity="${isSelected ? 0.9 : 0.3}"/>
    <circle cx="-29" cy="-0.5" r="2.6" fill="${dot}">
      ${w.status === 'working' ? `<animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite"/>` : ''}
    </circle>
    <text x="-23" y="2.6" font-size="8" fill="${C.text}" font-family="${FONT}" font-weight="600">${esc(short(w.name, 13))}</text>
  </g>`

  return `<g transform="translate(${x} ${y})" opacity="${w.status === 'done' ? 0.72 : 1}">
  <title>${esc(w.name)} (${esc(w.status)}): ${esc(short(w.task, 160))}</title>
  <g>${enter}
    ${ring}
    <g>${motion}
      <ellipse cx="0" cy="2" rx="11" ry="3.6" fill="#000" opacity="0.45"/>
      <g transform="translate(-3 -6)"><line x1="0" y1="0" x2="0" y2="7" stroke="${C.text}" stroke-opacity="0.75" stroke-width="2.6" stroke-linecap="round">${legSwing(1, 0)}</line></g>
      <g transform="translate(3 -6)"><line x1="0" y1="0" x2="0" y2="7" stroke="${C.text}" stroke-opacity="0.75" stroke-width="2.6" stroke-linecap="round">${legSwing(-1, 0.45)}</line></g>
      <rect x="-8" y="-25" width="16" height="21" rx="8" fill="${color}" filter="url(#body)"/>
      <rect x="-8" y="-25" width="16" height="21" rx="8" fill="url(#sheen)"/>
      <circle cx="0" cy="-32" r="7" fill="${C.text}"/>
      <rect x="-4.5" y="-34" width="9" height="2.6" rx="1.3" fill="${C.bg}"/>
      <rect x="-4.5" y="-34" width="3" height="2.6" rx="1.3" fill="${color}">
        <animate attributeName="x" values="-4.5;1.5;-4.5" dur="${2.5 + (h % 4) * 0.5}s" repeatCount="indefinite"/>
      </rect>
      ${alarm}
    </g>
    ${bubble}
    ${tag}
  </g>
</g>`
}

function core(coreTier) {
  const color = TIER_COLOR[coreTier] ?? C.mint
  const label = coreTier === 'off' ? 'ROUTING OFF' : coreTier === 'auto' ? 'AUTO' : `→ ${String(coreTier).toUpperCase()}`
  const orbit = 'M58,0 A58,58 0 1,1 -58,0 A58,58 0 1,1 58,0'
  return `<g transform="translate(${CORE.x} ${CORE.y})">
  <circle r="70" fill="url(#coreGlow)"><animate attributeName="r" values="62;78;62" dur="5s" repeatCount="indefinite"/></circle>
  ${[0, 1.3]
    .map(
      b => `<circle r="44" fill="none" stroke="${color}" stroke-width="1">
    <animate attributeName="r" values="42;84" dur="2.6s" begin="${b}s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.55;0" dur="2.6s" begin="${b}s" repeatCount="indefinite"/></circle>`,
    )
    .join('')}
  <circle r="58" fill="none" stroke="${C.mint}" stroke-opacity="0.12" stroke-dasharray="2 5">
    <animateTransform attributeName="transform" type="rotate" values="0;360" dur="40s" repeatCount="indefinite"/></circle>
  <path d="${BLOBS[0]}" fill="url(#blob)" filter="url(#glow)">
    <animate attributeName="d" values="${BLOBS[0]};${BLOBS[1]};${BLOBS[2]};${BLOBS[0]}" dur="9s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.33;0.66;1" keySplines="0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1"/>
    <animateTransform attributeName="transform" type="rotate" values="0;8;-6;0" dur="13s" repeatCount="indefinite"/>
  </path>
  <circle r="5" fill="${C.mint}" filter="url(#glow)"><animateMotion path="${orbit}" dur="7s" repeatCount="indefinite"/></circle>
  <text y="-52" text-anchor="middle" font-size="7.5" letter-spacing="3" fill="${C.muted}" font-family="${FONT}">ROUTER</text>
  <text y="4" text-anchor="middle" font-size="10" font-weight="800" letter-spacing="1.5" fill="${C.bg}" font-family="${FONT}">${esc(label)}</text>
</g>`
}

function ambient() {
  const dust = Array.from({ length: 16 }, (_, i) => {
    const x = 30 + ((i * 97) % 660)
    const y = 120 + ((i * 53) % 280)
    const dur = 7 + (i % 5) * 1.6
    return `<circle cx="${x}" cy="${y}" r="${1 + (i % 3) * 0.4}" fill="${C.mint}">
    <animate attributeName="cy" values="${y};${y - 70}" dur="${dur}s" begin="${-i * 0.7}s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0;0.5;0" dur="${dur}s" begin="${-i * 0.7}s" repeatCount="indefinite"/></circle>`
  }).join('')
  return `<rect x="16" y="52" width="160" height="372" fill="url(#sweep)" opacity="0.5">
    <animate attributeName="x" values="-160;720" dur="8s" repeatCount="indefinite"/></rect>${dust}`
}

function rooms() {
  const files = Array.from({ length: 12 }, (_, i) => {
    const colors = [C.mint, '#7FE3FF', '#C9A8FF', C.mint2]
    return `<rect x="${552 + i * 11.5}" y="94" width="8" height="18" rx="2" fill="${colors[i % 4]}" opacity="0.25">
      <animate attributeName="opacity" values="0.2;0.9;0.2" dur="3.6s" begin="${i * 0.3}s" repeatCount="indefinite"/></rect>`
  }).join('')
  const steam = [0, 1, 2]
    .map(
      k => `<path d="M${662 + k * 5},300 q-3,-6 0,-12 q3,-6 0,-12" fill="none" stroke="${C.text}" stroke-opacity="0.35" stroke-width="1.2" stroke-linecap="round">
    <animate attributeName="opacity" values="0;0.8;0" dur="2.4s" begin="${k * 0.6}s" repeatCount="indefinite"/>
    <animateTransform attributeName="transform" type="translate" values="0 4;0 -6" dur="2.4s" begin="${k * 0.6}s" repeatCount="indefinite"/></path>`,
    )
    .join('')
  return `
  <rect x="540" y="62" width="156" height="170" rx="12" fill="${C.glass}" fill-opacity="0.55" stroke="${C.mint}" stroke-opacity="0.14"/>
  <text x="552" y="82" font-size="7.5" letter-spacing="3" fill="${C.muted}" font-family="${FONT}">ARCHIVE · DONE</text>
  ${files}
  <rect x="540" y="244" width="156" height="172" rx="12" fill="${C.glass}" fill-opacity="0.55" stroke="${C.mint}" stroke-opacity="0.14"/>
  <text x="552" y="264" font-size="7.5" letter-spacing="3" fill="${C.muted}" font-family="${FONT}">LOUNGE · IDLE</text>
  <rect x="556" y="278" width="96" height="22" rx="11" fill="${C.deep}"/>
  <rect x="556" y="272" width="96" height="10" rx="5" fill="${C.mint}" opacity="0.18"/>
  <rect x="654" y="300" width="18" height="14" rx="3" fill="${C.text}" opacity="0.85"/>
  ${steam}
  <path d="M684,290 c-8,-10 -2,-24 6,-26 c2,10 2,20 -6,26z" fill="${C.mint2}">
    <animateTransform attributeName="transform" type="rotate" values="-4 684 290;5 684 290;-4 684 290" dur="4s" repeatCount="indefinite"/></path>`
}

export function officeSvg(list, chosen, width, height, coreTier) {
  const { seats, hidden } = seatAll(list)
  const byDesk = new Map(seats.filter(s => s.desk !== undefined).map(s => [s.desk, s.w]))
  const working = list.filter(w => w.status === 'working').length
  const idle = list.filter(w => w.status === 'idle').length
  const done = list.filter(w => w.status === 'done').length
  const errors = list.filter(w => w.status === 'error').length
  const beams = seats
    .filter(s => s.w.status === 'working')
    .map((s, i) => beam(s, i, TIER_COLOR[tierOf(s.w.model)] ?? C.mint))
    .join('')
  // People further down the floor are drawn later, so they stand in front.
  const people = [...seats]
    .sort((a, b) => a.y - b.y)
    .map(s => person(s, s.w.id === chosen))
    .join('\n')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 720 440" font-family="${FONT}">
<defs>
  <radialGradient id="bgGlow" cx="61%" cy="54%" r="60%"><stop offset="0" stop-color="${C.mint2}" stop-opacity="0.16"/><stop offset="1" stop-color="${C.bg}" stop-opacity="0"/></radialGradient>
  <radialGradient id="coreGlow"><stop offset="0" stop-color="${C.mint}" stop-opacity="0.35"/><stop offset="1" stop-color="${C.mint}" stop-opacity="0"/></radialGradient>
  <radialGradient id="blob" cx="35%" cy="30%"><stop offset="0" stop-color="#D8FFE7"/><stop offset="0.6" stop-color="${C.mint}"/><stop offset="1" stop-color="${C.mint2}"/></radialGradient>
  <linearGradient id="sweep" x1="0" x2="1"><stop offset="0" stop-color="${C.mint}" stop-opacity="0"/><stop offset="0.5" stop-color="${C.mint}" stop-opacity="0.07"/><stop offset="1" stop-color="${C.mint}" stop-opacity="0"/></linearGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="${C.mint}" stroke-opacity="0.05"/></pattern>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
  <filter id="body" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="0" stdDeviation="2.4" flood-opacity="0.55"/></filter>
</defs>
<rect width="720" height="440" fill="${C.bg}"/>
<rect width="720" height="440" fill="url(#bgGlow)"/>
<rect x="16" y="52" width="688" height="372" rx="16" fill="${C.panel}" stroke="${C.mint}" stroke-opacity="0.16"/>
<rect x="16" y="52" width="688" height="372" rx="16" fill="url(#grid)"/>
<text x="28" y="33" font-size="11" font-weight="800" letter-spacing="5" fill="${C.text}">ALTER<tspan fill="${C.mint}">X</tspan><tspan fill="${C.muted}" font-weight="500" letter-spacing="4"> · HEADQUARTERS</tspan></text>
<text x="700" y="32" text-anchor="end" font-size="8" letter-spacing="1.6" fill="${C.muted}"><tspan fill="${C.mint}">●<animate attributeName="opacity" values="1;0.25;1" dur="1.6s" repeatCount="indefinite"/></tspan> LIVE · ${working} WORKING · ${idle} IDLE · ${done} DONE${errors ? ` · ${errors} ERROR` : ''}${hidden ? ` · +${hidden}` : ''}</text>
<text x="40" y="80" font-size="7.5" letter-spacing="3" fill="${C.muted}">WORK FLOOR</text>
${ambient()}
${rooms()}
${DESKS.map((d, i) => desk(d, i, byDesk.get(i))).join('')}
${beams}
${core(coreTier)}
${people}
</svg>`
}
