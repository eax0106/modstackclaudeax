import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { officeSvg } from './office-map.js'
import type { ChatLine, Effort, Pending, Route, RouteMode, Tier, Worker, WorkerStatus } from '../types'

const PLUGIN = 'office-router'
const PANE = 'office'
const PICKER = 'effort'
// Ask for as much room as the app will give: it caps rows and columns at what the layout spares.
const OFFICE = { id: PANE, title: 'Office', rows: 200, columns: 400 }
const MAIN = 'main'

// The router picks the model. Effort is only ever what the person clicks in the picker.
const MODELS: Record<Tier, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
}
const LABELS = ['simple', 'moderate', 'complex'] as const
const TIER_OF: Record<string, Tier> = { simple: 'haiku', moderate: 'sonnet', complex: 'opus' }
const MODES: readonly RouteMode[] = ['auto', 'haiku', 'sonnet', 'opus', 'off']
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const RECOMMEND: Record<Tier, Effort> = { haiku: 'low', sonnet: 'medium', opus: 'high' }

const mode = atom({ plugin: 'office-router', key: 'mode' } as const, 'auto')
const current = atom({ plugin: 'office-router', key: 'current' } as const, null)
const routes = atom({ plugin: 'office-router', key: 'routes' } as const, [])
const workers = atom({ plugin: 'office-router', key: 'workers' } as const, [])
const selected = atom({ plugin: 'office-router', key: 'selected' } as const, MAIN)
const pending = atom({ plugin: 'office-router', key: 'pending' } as const, null)

const snippet = (text: string, n: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > n ? flat.slice(0, n - 1) + '…' : flat
}

const since = (from: number, now: number) => {
  const s = Math.max(0, Math.round((now - from) / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

async function touch($: EngineInterface, id: string, patch: Partial<Worker>) {
  const now = await $.clock.now()
  await update($, workers, list => list.map(w => (w.id === id ? { ...w, ...patch, updatedAt: now } : w)))
}

async function classify($: EngineInterface, text: string): Promise<Pick<Route, 'tier' | 'why'>> {
  const chosen = await read($, mode)
  if (chosen === 'off') return { tier: null, why: 'unsure' }
  if (chosen !== 'auto') return { tier: chosen, why: 'pinned' }
  try {
    const label = await $.model.classify(
      `How hard is this request for a coding assistant? simple = lookup, small edit, short answer. ` +
        `moderate = normal feature, bug fix, a few files. complex = architecture, deep debugging, many files, careful judgment.\n\nRequest:\n${text.slice(0, 4000)}`,
      LABELS,
      { model: 'haiku' },
    )
    const tier = label === undefined ? undefined : TIER_OF[label]
    return tier ? { tier, why: 'classified' } : { tier: null, why: 'unsure' }
  } catch {
    return { tier: null, why: 'failed' }
  }
}

// The person's click: send the held prompt with the effort they picked.
async function choose($: EngineInterface, choice: Effort | 'keep') {
  const held = await read($, pending)
  if (held === null || held.choice !== null) return
  await update($, pending, () => ({ ...held, choice }))
  await $.ui.close({ id: PICKER })
  void $.prompt.submit({ text: held.text, attachments: held.attachments as never, asUser: true })
}

// Adds a line to a worker's conversation, keeping the last few.
async function say($: EngineInterface, id: string, from: ChatLine['from'], text: string) {
  const at = await $.clock.now()
  const line: ChatLine = { from, text: snippet(text, 600), at }
  await update($, workers, list => list.map(w => (w.id === id ? { ...w, chat: [...(w.chat ?? []), line].slice(-8) } : w)))
}

// Holds a prompt for the main session: route it and ask for its effort.
async function hold($: EngineInterface, text: string, attachments: readonly unknown[]) {
  const { tier, why } = await classify($, text)
  const held: Pending = {
    text,
    attachments,
    tier,
    why,
    recommended: tier ? RECOMMEND[tier] : 'medium',
    choice: null,
    at: await $.clock.now(),
  }
  await update($, pending, () => held)
  await $.ui.open({ id: PICKER, title: 'Choose effort', focus: true, closeOnEscape: true, holdToasts: true })
  return tier
}

// A message typed in a worker's card. The main session gets it as a prompt,
// routed and held for its effort like a typed one; a subagent gets it as a
// message, which resumes it when it had finished.
async function talk($: EngineInterface, id: string, value: string) {
  const text = value.trim()
  if (!text) return
  if (id === MAIN) {
    if ((await read($, mode)) === 'off') await $.prompt.submit({ text, asUser: true })
    else await hold($, text, [])
    return
  }
  await say($, id, 'you', text)
  const sent = await $.session.send({ to: { agentId: id }, text })
  if (sent.isDelivered) await touch($, id, { status: 'working' })
  else await say($, id, 'note', `Not delivered: ${sent.reason}`)
}

// ---------------------------------------------------------------- hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'office', description: 'Open the office pane: your session and its agents at work' })
    await $.command.register({
      name: 'route',
      description: 'Model routing: /route auto | haiku | sonnet | opus | off (no argument shows the status)',
    })
    const now = await $.clock.now()
    const model = await $.session.model()
    await update($, workers, list =>
      list.some(w => w.id === MAIN)
        ? list
        : [
            {
              id: MAIN,
              name: 'Main session',
              kind: 'session',
              type: 'session',
              status: 'idle',
              task: 'Waiting for your prompt',
              model,
              lastTool: null,
              tools: 0,
              startedAt: now,
              updatedAt: now,
            },
            ...list,
          ],
    )
    return next(e)
  })

  on('command.run', { command: 'office' }, async $ => {
    await $.ui.open(OFFICE)
    return { text: 'Office pane opened.' }
  })

  on('command.run', { command: 'route' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if ((MODES as readonly string[]).includes(arg)) {
      await update($, mode, () => arg as RouteMode)
      $.ui.status(arg === 'off' ? undefined : `route: ${arg}`)
      return { text: `Model routing set to ${arg}.` }
    }
    const m = await read($, mode)
    const cur = await read($, current)
    return {
      text: `Model routing is ${m}. Last prompt: ${cur?.tier ?? 'session model kept'} (${cur?.why ?? 'none yet'}). Use /route auto | haiku | sonnet | opus | off.`,
    }
  })

  // Hold each typed prompt: route it, recommend an effort, and send it only
  // after the person clicks one in the picker.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer') return next(e)
    const text = e.text.trim()
    if (!text || text.startsWith('/') || (await read($, mode)) === 'off') return next(e)
    const tier = await hold($, e.text, e.attachments ?? [])
    return { drop: `Routed to ${tier ?? 'your current model'}. Pick an effort level to start.` }
  })

  // Esc on the picker: nothing is sent, and the prompt goes back in the box.
  on('ui.close', async ($, e, next) => {
    const held = e.id === PICKER && e.origin.kind === 'person' ? await read($, pending) : null
    const result = await next(e)
    if (held !== null && held.choice === null) {
      await update($, pending, () => null)
      await $.prompt.fill({ text: held.text, mode: 'replace' })
    }
    return result
  })

  // Apply the person's pick to the turn their prompt starts.
  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    const held = await read($, pending)
    if (held !== null && held.choice !== null && held.text === e.text) {
      const route: Route = {
        turnId: e.turnId,
        tier: held.tier,
        why: held.why,
        effort: held.choice === 'keep' ? null : held.choice,
        prompt: snippet(e.text, 120),
        at: now,
      }
      await update($, pending, () => null)
      await update($, current, () => route)
      await update($, routes, list => [...list, route].slice(-50))
      $.ui.status(`route: ${route.tier ?? 'session model'} · effort ${route.effort ?? 'unchanged'}`)
      const model = route.tier ? MODELS[route.tier] : await $.session.model()
      await touch($, MAIN, { status: 'working', task: snippet(e.text, 300), model })
      await say($, MAIN, 'you', e.text)
    } else {
      await update($, current, () => null)
      await touch($, MAIN, e.text.trim() ? { status: 'working', task: snippet(e.text, 300) } : { status: 'working' })
    }
    return next(e)
  })

  // Main loop only; subagents keep the model they were spawned with.
  on('turn.step', async function* ($, e, next) {
    const cur = await read($, current)
    if (e.agentId === undefined && cur !== null && cur.turnId === e.turnId) {
      return yield* next({
        ...e,
        ...(cur.tier !== null ? { model: MODELS[cur.tier] } : {}),
        ...(cur.effort !== null ? { effort: cur.effort } : {}),
      })
    }
    return yield* next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.agentId !== undefined) {
      const now = await $.clock.now()
      const worker: Worker = {
        id: result.agentId,
        name: e.name ?? e.description,
        kind: 'subagent',
        type: e.subagentType,
        status: 'working',
        task: `${e.description}: ${snippet(e.prompt, 280)}`,
        model: result.model,
        lastTool: null,
        tools: 0,
        chat: [{ from: 'you', text: snippet(e.prompt, 600), at: now }],
        startedAt: now,
        updatedAt: now,
      }
      await update($, workers, list => [...list.filter(w => w.id !== worker.id), worker].slice(-30))
    }
    return result
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    await update($, workers, list =>
      list.map(w => (w.id === id ? { ...w, status: 'working', lastTool: String(e.tool), tools: w.tools + 1 } : w)),
    )
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const status: WorkerStatus = e.reason === 'error' ? 'error' : id === MAIN ? 'idle' : 'done'
    await touch($, id, { status })
    if (e.text.trim()) await say($, id, 'agent', e.text)
    return next(e)
  })

  // The button beside the footer's mode labels.
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const cur = await read($, current)
    const m = await read($, mode)
    const label = m === 'off' ? 'Office' : `Office · ${cur?.tier ?? m}`
    return (
      <Box flexDirection="row" gap={1}>
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')}</Text>}
        <Button key="open-office" label={label} plain onPress={() => void $.ui.open(OFFICE)} />
      </Box>
    )
  })

  // The same button in the strip directly above the prompt box.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const cur = await read($, current)
    const m = await read($, mode)
    const working = (await read($, workers)).filter(w => w.status === 'working').length
    return (
      <Box flexDirection="row" gap={1}>
        <Button
          key="open-office-band"
          label="Open office"
          variant="primary"
          onPress={() => void $.ui.open(OFFICE)}
        />
        <Text dimColor>
          routing {m}
          {cur?.tier ? ` · last: ${cur.tier}` : ''} · {working} working
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PICKER }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const held = await read($, pending)
    if (held === null || held.choice !== null) return <Text dimColor>No prompt is waiting.</Text>
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>
          Routed to {held.tier ?? 'your current model'} ({held.why})
        </Text>
        <Text dimColor wrap="truncate-end">
          {snippet(held.text, 160)}
        </Text>
        <Text>Recommended effort: {held.recommended}. You choose:</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {EFFORTS.map((one, i) => (
            <Button
              key={`effort-${one}`}
              hotkey={String(i + 1)}
              label={one === held.recommended ? `${one} (recommended)` : one}
              variant={one === held.recommended ? 'primary' : 'secondary'}
              {...(one === held.recommended ? { autoFocus: true as const } : {})}
              onPress={() => choose($, one)}
            />
          ))}
          <Button key="effort-keep" hotkey="6" label="keep current" onPress={() => choose($, 'keep')} />
        </Box>
        <Text dimColor>Esc cancels: nothing is sent and your prompt goes back in the box.</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, workers)
    const chosen = await read($, selected)
    const m = await read($, mode)
    const recent = (await read($, routes)).slice(-6).reverse()
    const now = await $.clock.now()
    const w = list.find(one => one.id === chosen) ?? list[0]
    const { Box, Text, Button } = $.ui.resolve(e)

    const roster = (
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {list.map(one => (
          <Button
            key={`w-${one.id}`}
            label={`${{ working: '●', idle: '○', done: '✓', error: '!' }[one.status]} ${snippet(one.name, 22)}`}
            variant={one.id === w?.id ? 'primary' : 'secondary'}
            onPress={() => update($, selected, () => one.id)}
          />
        ))}
      </Box>
    )

    // The mobile app draws no text field yet.
    let talkBox = null
    if (w && e.surface !== 'mobile') {
      const { Input } = $.ui.resolve(e)
      talkBox = (
        <Input
          key={`talk-${w.id}`}
          placeholder={w.id === MAIN ? 'Message the main session (routed, you pick the effort)' : `Message ${w.name} to continue its work`}
          submitLabel="Send"
          onSubmit={value => void talk($, w.id, value)}
        />
      )
    }

    const detail = w && (
      <Box key="detail" flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold>{w.name}</Text>
        <Text>
          {w.status} · {w.kind === 'session' ? 'session' : w.type} · {w.model ?? 'model unknown'}
        </Text>
        <Text wrap="wrap">Working on: {w.task}</Text>
        <Text dimColor>
          Last tool: {w.lastTool ?? 'none'} · {w.tools} tool calls · running {since(w.startedAt, now)}
        </Text>
        {(w.chat ?? []).map((line, i) => (
          <Text key={`chat-${i}`} wrap="wrap" dimColor={line.from === 'note'}>
            {line.from === 'you' ? 'You' : line.from === 'agent' ? w.name : 'Note'}: {line.text}
          </Text>
        ))}
        {talkBox}
      </Box>
    )

    const routing = (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text bold>Routing</Text>
          {MODES.map(one => (
            <Button
              key={`mode-${one}`}
              label={one}
              variant={one === m ? 'primary' : 'secondary'}
              onPress={() => update($, mode, () => one)}
            />
          ))}
        </Box>
        {recent.length === 0 && <Text dimColor>No prompts routed yet.</Text>}
        {recent.map(r => (
          <Text key={`r-${r.turnId}`} dimColor wrap="truncate-end">
            {r.tier ?? 'kept'} · effort {r.effort ?? 'unchanged'} · {r.why} · {r.prompt}
          </Text>
        ))}
      </Box>
    )

    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      // The desktop frames an interactive SVG at a fixed height unless told its size,
      // so size it to the pane: about 7 px per column, kept at the drawing's 720:440.
      const width = Math.min(2400, Math.max(560, Math.round(e.props.bodyColumns * 7)))
      const height = Math.round((width * 440) / 720)
      return (
        <Box flexDirection="column" gap={1}>
          <Svg
            key="map"
            source={officeSvg(list, w?.id ?? MAIN, width, height, (await read($, current))?.tier ?? m)}
            width={width}
            height={height}
            alt={`Office with ${list.length} workers`}
            isInteractive
          />
          {roster}
          {detail}
          {routing}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Office ({list.filter(one => one.status === 'working').length} working)</Text>
        {roster}
        {detail}
        {routing}
      </Box>
    )
  })
}
