// The Tasks pane's board, drawn in the ALTERX design language: near-black
// green, mint accents, glass cards. Motion is SMIL only, since the desktop
// draws the SVG in a frame that runs no script.

const C = {
  bg: '#030806',
  panel: '#06110B',
  glass: '#0B1F15',
  deep: '#123D27',
  text: '#E8F7EE',
  muted: '#91A89B',
  mint: '#9FFFC0',
  mint2: '#5BEA99',
}
const FONT = 'Manrope, Inter, ui-sans-serif, system-ui, sans-serif'
const WIDTH = 720
const HEADER = 96
const LANE_GAP = 30
const ROW = 34

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const short = (s, n) => {
  const flat = String(s).replace(/\s+/g, ' ').trim()
  return flat.length > n ? flat.slice(0, n - 1) + '…' : flat
}

const ownerName = owner =>
  owner === 'main' ? 'MAIN SESSION' : /^agent/i.test(owner) ? short(owner, 24).toUpperCase() : `AGENT ${short(owner, 18).toUpperCase()}`

// The drawing's height in its own units, for the given tasks.
export function boardHeight(tasks) {
  if (tasks.length === 0) return 260
  const owners = new Set(tasks.map(t => t.owner)).size
  return HEADER + owners * LANE_GAP + tasks.length * ROW + 20
}

function icon(status, k) {
  if (status === 'completed') {
    return `<circle r="8" fill="${C.mint}"/>
    <path d="M-3.6,0.2 L-1,2.8 L3.8,-2.4" fill="none" stroke="${C.bg}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="12" stroke-dashoffset="12">
      <animate attributeName="stroke-dashoffset" values="12;0" dur="0.45s" begin="${0.25 + k * 0.05}s" fill="freeze"/></path>`
  }
  if (status === 'in_progress') {
    return `<circle r="8" fill="none" stroke="${C.mint}" stroke-opacity="0.18" stroke-width="2"/>
    <circle r="8" fill="none" stroke="${C.mint}" stroke-width="2" stroke-linecap="round" stroke-dasharray="14 36">
      <animateTransform attributeName="transform" type="rotate" values="0;360" dur="1s" repeatCount="indefinite"/></circle>
    <circle r="2.4" fill="${C.mint}"><animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite"/></circle>`
  }
  return `<circle r="7.5" fill="none" stroke="${C.muted}" stroke-opacity="0.6" stroke-width="1.5" stroke-dasharray="2.5 2.5"/>`
}

function card(t, y, k) {
  const active = t.status === 'in_progress'
  const done = t.status === 'completed'
  const chip = { pending: 'PENDING', in_progress: 'IN PROGRESS', completed: 'DONE' }[t.status]
  const chipWidth = chip.length * 6 + 16
  const subject = esc(short(t.subject, 86))
  const shimmer = active
    ? `<rect x="-160" y="0" width="160" height="28" fill="url(#shimmer)" clip-path="url(#clip${k})">
      <animate attributeName="x" values="-160;${WIDTH}" dur="2.2s" repeatCount="indefinite"/></rect>`
    : ''
  const strike = done
    ? `<line x1="40" y1="14.5" x2="40" y2="14.5" stroke="${C.muted}" stroke-opacity="0.6" stroke-width="1">
      <animate attributeName="x2" values="40;${Math.min(560, 42 + short(t.subject, 86).length * 5.7)}" dur="0.5s" begin="${0.3 + k * 0.05}s" fill="freeze"/></line>`
    : ''
  return `<g transform="translate(24 ${y})" opacity="0">
  <animate attributeName="opacity" values="0;1" dur="0.35s" begin="${k * 0.05}s" fill="freeze"/>
  <animateTransform attributeName="transform" type="translate" values="16 ${y};24 ${y}" dur="0.35s" begin="${k * 0.05}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.7 0.3 1"/>
  <clipPath id="clip${k}"><rect width="672" height="28" rx="9"/></clipPath>
  <rect width="672" height="28" rx="9" fill="${active ? C.deep : C.glass}" fill-opacity="${done ? 0.45 : 0.8}" stroke="${active ? C.mint : C.mint}" stroke-opacity="${active ? 0.55 : 0.12}"/>
  ${shimmer}
  <g transform="translate(20 14)">${icon(t.status, k)}</g>
  <text x="40" y="18" font-size="11.5" font-weight="${active ? 700 : 500}" fill="${done ? C.muted : C.text}">${subject}</text>
  ${strike}
  <g transform="translate(${672 - chipWidth - 10} 7)">
    <rect width="${chipWidth}" height="14" rx="7" fill="${active ? C.mint : 'none'}" fill-opacity="${active ? 0.14 : 0}" stroke="${active ? C.mint : C.muted}" stroke-opacity="${active ? 0.7 : 0.3}"/>
    <text x="${chipWidth / 2}" y="10" text-anchor="middle" font-size="7.5" letter-spacing="1.4" font-weight="700" fill="${active ? C.mint : C.muted}">${chip}</text>
  </g>
</g>`
}

function empty(width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${WIDTH} 260" font-family="${FONT}">
<rect width="${WIDTH}" height="260" fill="${C.bg}"/>
<rect x="12" y="12" width="${WIDTH - 24}" height="236" rx="16" fill="${C.panel}" stroke="${C.mint}" stroke-opacity="0.14"/>
<text x="32" y="44" font-size="11" font-weight="800" letter-spacing="5" fill="${C.text}">ALTER<tspan fill="${C.mint}">X</tspan><tspan fill="${C.muted}" font-weight="500" letter-spacing="4"> · TASKS</tspan></text>
<g transform="translate(360 128)">
  <circle r="26" fill="${C.mint}" opacity="0.12"><animate attributeName="r" values="22;34;22" dur="3s" repeatCount="indefinite"/></circle>
  <circle r="14" fill="${C.mint}"><animate attributeName="r" values="13;15.5;13" dur="3s" repeatCount="indefinite"/></circle>
</g>
<text x="360" y="186" text-anchor="middle" font-size="13" font-weight="700" fill="${C.text}">No tasks yet</text>
<text x="360" y="206" text-anchor="middle" font-size="10" fill="${C.muted}">The model's task list shows here once it plans work of 3 or more steps.</text>
</svg>`
}

// The surface takes an SVG of at most 4096 px a side: a long list narrows the
// board to keep its proportions.
export function tasksBoard(tasks, wanted) {
  const viewHeight = boardHeight(tasks)
  const width = Math.min(wanted, Math.floor((4096 * WIDTH) / viewHeight))
  const height = Math.round((width * viewHeight) / WIDTH)
  if (tasks.length === 0) return { svg: empty(width, height), width, height }

  const done = tasks.filter(t => t.status === 'completed').length
  const active = tasks.filter(t => t.status === 'in_progress').length
  const pending = tasks.length - done - active
  const share = done / tasks.length
  const ring = 2 * Math.PI * 24
  const owners = [...new Set(tasks.map(t => t.owner))]

  let y = HEADER
  let k = 0
  const lanes = owners
    .map(owner => {
      const mine = tasks.filter(t => t.owner === owner)
      const mineDone = mine.filter(t => t.status === 'completed').length
      const head = `<text x="28" y="${y + 18}" font-size="8" letter-spacing="3" fill="${C.muted}">${esc(ownerName(owner))}<tspan fill="${C.mint}" dx="10">${mineDone}/${mine.length}</tspan></text>`
      y += LANE_GAP
      const cards = mine
        .map(t => {
          const drawn = card(t, y, k++)
          y += ROW
          return drawn
        })
        .join('\n')
      return head + cards
    })
    .join('\n')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${WIDTH} ${viewHeight}" font-family="${FONT}">
<defs>
  <linearGradient id="shimmer" x1="0" x2="1"><stop offset="0" stop-color="${C.mint}" stop-opacity="0"/><stop offset="0.5" stop-color="${C.mint}" stop-opacity="0.16"/><stop offset="1" stop-color="${C.mint}" stop-opacity="0"/></linearGradient>
  <linearGradient id="bar" x1="0" x2="1"><stop offset="0" stop-color="${C.mint2}"/><stop offset="1" stop-color="${C.mint}"/></linearGradient>
  <radialGradient id="glow" cx="90%" cy="0%" r="70%"><stop offset="0" stop-color="${C.mint2}" stop-opacity="0.14"/><stop offset="1" stop-color="${C.bg}" stop-opacity="0"/></radialGradient>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<rect width="${WIDTH}" height="${viewHeight}" fill="${C.bg}"/>
<rect width="${WIDTH}" height="${viewHeight}" fill="url(#glow)"/>
<rect x="12" y="12" width="${WIDTH - 24}" height="${viewHeight - 24}" rx="16" fill="${C.panel}" stroke="${C.mint}" stroke-opacity="0.14"/>
<text x="32" y="44" font-size="11" font-weight="800" letter-spacing="5" fill="${C.text}">ALTER<tspan fill="${C.mint}">X</tspan><tspan fill="${C.muted}" font-weight="500" letter-spacing="4"> · TASKS</tspan></text>
<text x="32" y="64" font-size="8" letter-spacing="2" fill="${C.muted}"><tspan fill="${C.mint}">${active} IN PROGRESS</tspan> · ${pending} PENDING · ${done} DONE</text>
<rect x="32" y="74" width="580" height="4" rx="2" fill="${C.mint}" fill-opacity="0.1"/>
<rect x="32" y="74" width="0" height="4" rx="2" fill="url(#bar)">
  <animate attributeName="width" values="0;${(580 * share).toFixed(1)}" dur="1.1s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.7 0.3 1"/></rect>
<g transform="translate(662 52)">
  <circle r="24" fill="none" stroke="${C.mint}" stroke-opacity="0.12" stroke-width="5"/>
  <circle r="24" fill="none" stroke="${C.mint}" stroke-width="5" stroke-linecap="round" transform="rotate(-90)" stroke-dasharray="${ring.toFixed(2)}" stroke-dashoffset="${ring.toFixed(2)}" filter="url(#soft)">
    <animate attributeName="stroke-dashoffset" values="${ring.toFixed(2)};${(ring * (1 - share)).toFixed(2)}" dur="1.1s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.7 0.3 1"/></circle>
  <text y="4" text-anchor="middle" font-size="12" font-weight="800" fill="${C.text}">${done}/${tasks.length}</text>
</g>
${lanes}
</svg>`
  return { svg, width, height }
}
