import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import { CACHE_VIEW, cachePanelSvg } from './cache-panel.js'
import { officeSvg } from './office-map.js'
import type { AgentPick, CacheState, ChatLine, Effort, Pending, Plan, PlanTask, Route, RouteMode, Task, Tier, Worker, WorkerStatus } from '../types'

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
// Measured on the desktop: a pane column is about 8 px wide and a row about 16 px tall.
const COLUMN_PX = 8
const ROW_PX = 16

// The ALTERX palette the office map uses, for the native parts of the panes.
const UI = { panel: '#06110B', edge: '#1E3A2B', text: '#E8F7EE', muted: '#91A89B', mint: '#9FFFC0' }
const TIER_UI: Record<Tier, string> = { haiku: '#9FFFC0', sonnet: '#7FE3FF', opus: '#C9A8FF' }
const STATUS_COLOR: Record<WorkerStatus, string> = { working: '#9FFFC0', idle: '#E9D58A', done: '#91A89B', error: '#FF6B6B' }
const modelName = (model: string | null) => {
  if (model === null) return 'MODEL UNKNOWN'
  const tier = (['haiku', 'sonnet', 'opus'] as const).find(t => model.includes(t))
  const version = /(\d+)-(\d+)/.exec(model)
  return tier ? `${tier.toUpperCase()}${version ? ` ${version[1]}.${version[2]}` : ''}` : model.toUpperCase()
}

const mode = atom({ plugin: 'office-router', key: 'mode' } as const, 'auto')
const current = atom({ plugin: 'office-router', key: 'current' } as const, null)
const routes = atom({ plugin: 'office-router', key: 'routes' } as const, [])
const workers = atom({ plugin: 'office-router', key: 'workers' } as const, [])
const selected = atom({ plugin: 'office-router', key: 'selected' } as const, MAIN)
const pending = atom({ plugin: 'office-router', key: 'pending' } as const, null)
const tasks = atom({ plugin: 'office-router', key: 'tasks' } as const, [])
const mainEffort = atom({ plugin: 'office-router', key: 'mainEffort' } as const, null)
const agentPicks = atom({ plugin: 'office-router', key: 'agentPicks' } as const, {})

const MODEL_OPTIONS = [
  { value: 'auto', label: 'auto-route' },
  { value: 'haiku', label: 'haiku' },
  { value: 'sonnet', label: 'sonnet' },
  { value: 'opus', label: 'opus' },
  { value: 'off', label: 'routing off' },
]
const EFFORT_OPTIONS = [
  { value: 'ask', label: 'ask me' },
  ...(['low', 'medium', 'high', 'xhigh', 'max'] as const).map(value => ({ value, label: value })),
  { value: 'session', label: 'session default' },
]
const AGENT_MODEL_OPTIONS = [{ value: 'inherit', label: 'as started' }, ...MODEL_OPTIONS.slice(1, 4)]
const AGENT_EFFORT_OPTIONS = [{ value: 'inherit', label: 'as started' }, ...EFFORT_OPTIONS.slice(1, 6)]

const OWN_TOOL = 'mcp__office-router__set_tasks'
const PLAN_TOOL = 'mcp__office-router__propose_plan'
const PLAN_PANE = 'plan'
const plan = atom({ plugin: 'office-router', key: 'plan' } as const, null)
const NEW_CACHE: CacheState = {
  warm: true,
  ttl: 3600,
  lastAt: null,
  pings: 0,
  warmRead: 0,
  pingLog: [],
  totals: { read: 0, written: 0, fresh: 0 },
  blocks: null,
}
const cache = atom({ plugin: 'office-router', key: 'cache' } as const, NEW_CACHE)
// Warming pays while pings cost less than re-writing the cache: a write costs
// 1.25x the prompt (2x for the 1-hour cache) and each warm read 0.1x.
const warmCap = (ttl: number) => (ttl <= 300 ? 10 : 3)
const TIER_RANK: Record<Tier, number> = { haiku: 0, sonnet: 1, opus: 2 }
const EFFORT_RANK: Record<Effort, number> = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 }
// An agent the approved plan started is named `plan:<n> <title>` (or `plan:all`).
const PLAN_NAME = /^plan:(\d+|all)\b/
const STATUSES: readonly string[] = ['pending', 'in_progress', 'completed']
const MARK = { pending: '○', in_progress: '◐', completed: '✓' } as const

// Replace one agent's tasks under an id prefix, keeping everyone else's.
const replaceOwned = (list: readonly Task[], prefix: string, next: Task[]) => [...list.filter(t => !t.id.startsWith(prefix)), ...next]
const doneOf = (list: readonly Task[]) => `${list.filter(t => t.status === 'completed').length}/${list.length}`

const snippet = (text: string, n: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > n ? flat.slice(0, n - 1) + '…' : flat
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
  // Later prompts reuse this effort and the model this one went to, until the
  // person changes them in the dropdowns.
  await update($, mainEffort, () => (choice === 'keep' ? 'session' : choice))
  if (held.tier !== null && (await read($, mode)) === 'auto') await update($, mode, () => held.tier as Tier)
  await $.ui.close({ id: PICKER })
  void $.prompt.submit({ text: held.text, attachments: held.attachments as never, asUser: true })
}

// Adds a line to a worker's conversation, keeping the last few.
async function say($: EngineInterface, id: string, from: ChatLine['from'], text: string) {
  const at = await $.clock.now()
  const line: ChatLine = { from, text: snippet(text, 600), at }
  await update($, workers, list => list.map(w => (w.id === id ? { ...w, chat: [...(w.chat ?? []), line].slice(-8) } : w)))
}

// A follow-up for the main session once its effort is chosen: route it (or use
// the picked model) and mark it for the turn it starts, with no dialog.
async function queue($: EngineInterface, text: string, attachments: readonly unknown[], effort: Effort | 'session') {
  const { tier, why } = await classify($, text)
  const held: Pending = {
    text,
    attachments,
    tier,
    why,
    recommended: tier ? RECOMMEND[tier] : 'medium',
    choice: effort === 'session' ? 'keep' : effort,
    at: await $.clock.now(),
  }
  await update($, pending, () => held)
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
    const effort = await read($, mainEffort)
    if ((await read($, mode)) === 'off') await $.prompt.submit({ text, asUser: true })
    else if (effort === null) await hold($, text, [])
    else {
      await queue($, text, [], effort)
      await $.prompt.submit({ text, asUser: true })
    }
    return
  }
  await say($, id, 'you', text)
  const sent = await $.session.send({ to: { agentId: id }, text })
  if (sent.isDelivered) await touch($, id, { status: 'working' })
  else await say($, id, 'note', `Not delivered: ${sent.reason}`)
}

// The last map drawn and what it showed. The pane redraws on every scroll; handing
// the surface the same source keeps the map's frame, so its animations do not restart.
let lastMap = { key: '', svg: '' }

function officeMap(list: Worker[], chosen: string, width: number, height: number, coreTier: string, allTasks: Task[]) {
  // Only what the drawing shows: a change in anything else (time running, chat, token
  // counts) must not redraw it.
  const key = JSON.stringify([
    list.map(w => [w.id, w.name, w.status, w.model, w.lastTool, w.task]),
    allTasks.map(t => [t.owner, t.status]),
    chosen,
    width,
    height,
    coreTier,
  ])
  if (key !== lastMap.key) lastMap = { key, svg: officeSvg(list, chosen, width, height, coreTier, allTasks) }
  return lastMap.svg
}

let lastCache = { key: '', svg: '' }

// The cache panel, rebuilt only when its record or size changes. The ring's start
// is taken when it is rebuilt and then runs down on its own.
function cachePanel(c: CacheState, now: number, width: number, height: number) {
  const key = JSON.stringify([c, width, height])
  if (key !== lastCache.key) {
    const left = c.lastAt === null ? 0 : Math.max(0, c.ttl - (now - c.lastAt) / 1000)
    lastCache = { key, svg: cachePanelSvg(c, left, width, height) }
  }
  return lastCache.svg
}

// The approved model and effort for an agent the plan named, if any.
function planChoice(p: Plan | null, description: string): { model: Tier; effort: Effort } | undefined {
  const match = PLAN_NAME.exec(description)
  if (p === null || p.status !== 'approved' || match === null) return undefined
  const kept = p.tasks.filter(t => t.keep)
  if (match[1] === 'all') {
    if (kept.length === 0) return undefined
    const model = kept.reduce((m, t) => (TIER_RANK[t.model] > TIER_RANK[m] ? t.model : m), kept[0]!.model)
    const effort = kept.reduce((m, t) => (EFFORT_RANK[t.effort] > EFFORT_RANK[m] ? t.effort : m), kept[0]!.effort)
    return { model, effort }
  }
  const task = kept.find(t => t.n === Number(match[1]))
  return task && { model: task.model, effort: task.effort }
}

// The message that hands the approved plan to the main session to run.
function planMessage(p: Plan, asOne: boolean) {
  const kept = p.tasks.filter(t => t.keep)
  if (asOne) {
    return (
      `The person approved running this work as one agent. Start a single agent with the Agent tool, its ` +
      `description exactly "plan:all ${p.summary}" (the office applies the approved model and effort by that ` +
      `name), and give it all of these instructions. When it finishes, report its result to the person.\n\n` +
      kept.map(t => `- ${t.title}: ${t.instructions}`).join('\n')
    )
  }
  const lines = kept.map(t => {
    const after = t.after.filter(n => kept.some(k => k.n === n))
    return (
      `plan:${t.n} ${t.title}\n` +
      `  after: ${after.length ? after.map(n => `plan:${n}`).join(', ') : 'none'}\n` +
      `  instructions: ${t.instructions}`
    )
  })
  return (
    `The person approved this plan. Run it with the Agent tool, one agent per task, each agent's description ` +
    `exactly the task's first line (the office applies the approved model and effort by that name). Start the ` +
    `tasks with no "after" together, in the background. Start a task only once the tasks in its "after" have ` +
    `finished, and give it their results. When every task is done, combine the results into one answer for ` +
    `the person.\n\n${lines.join('\n\n')}`
  )
}

async function decide($: EngineInterface, choice: 'approve' | 'one' | 'cancel') {
  const p = await read($, plan)
  if (p === null || p.status !== 'proposed') return
  const kept = p.tasks.filter(t => t.keep)
  if (choice !== 'cancel' && kept.length === 0) return
  await update($, plan, () => ({ ...p, status: choice === 'cancel' ? 'cancelled' : 'approved' }))
  await $.ui.close({ id: PLAN_PANE })
  const text =
    choice === 'cancel'
      ? 'The person cancelled the proposed plan. Do not start the work; ask them how they want to proceed.'
      : planMessage(p, choice === 'one')
  void $.prompt.submit({ text, asUser: true })
}

async function editTask($: EngineInterface, n: number, patch: Partial<PlanTask>) {
  await update($, plan, p => (p === null ? p : { ...p, tasks: p.tasks.map(t => (t.n === n ? { ...t, ...patch } : t)) }))
}

// The main session's Model and Effort dropdowns, for the strip and its card.
function mainDropdowns(
  $: EngineInterface,
  { Box, Select }: Pick<Elements['desktop'], 'Box' | 'Select'>,
  m: RouteMode,
  effort: Effort | 'session' | null,
  keyPrefix: string,
) {
  return (
    <Box flexDirection="row" gap={1}>
      <Select
        key={`${keyPrefix}-model`}
        label="Model"
        options={MODEL_OPTIONS}
        value={m}
        onSelect={value => void update($, mode, () => value as RouteMode)}
      />
      <Select
        key={`${keyPrefix}-effort`}
        label="Effort"
        options={EFFORT_OPTIONS}
        value={effort ?? 'ask'}
        onSelect={value => void update($, mainEffort, () => (value === 'ask' ? null : (value as Effort | 'session')))}
      />
    </Box>
  )
}

// Groups the context's categories into what the cache panel shows.
function cacheBlocks(categories: readonly { name: string; tokens: number; kind: string }[]) {
  const blocks = { system: 0, project: 0, conversation: 0 }
  for (const c of categories) {
    if (c.kind !== 'used' && c.kind !== 'deferred') continue
    if (/message/i.test(c.name)) blocks.conversation += c.tokens
    else if (/memory|skill|agent|claude\.md/i.test(c.name)) blocks.project += c.tokens
    else blocks.system += c.tokens
  }
  return blocks
}

// Keeps the cache warm while the session sits idle: one tiny fork over the
// session's own transcript, served from the cache, which adds nothing to the
// conversation. Fires just before the cache expires, never while a turn runs,
// and stops at the cap until the person sends something again.
async function warmTick($: EngineInterface) {
  const c = await read($, cache)
  if (!c.warm || c.lastAt === null || c.pings >= warmCap(c.ttl)) return
  if ((await read($, workers)).some(w => w.id === MAIN && w.status === 'working')) return
  const now = await $.clock.now()
  if (now - c.lastAt < (c.ttl - 60) * 1000) return
  const blocks = c.blocks
  if (blocks !== null && blocks.system + blocks.project + blocks.conversation < 5000) return
  const r = await $.model.fork({ prompt: 'Reply with the single word: ok' })
  const readTokens = 'usage' in r && r.usage ? r.usage.cache_read_input_tokens : 0
  await update($, cache, s => ({
    ...s,
    lastAt: r.isAnswered ? now : s.lastAt,
    pings: s.pings + 1,
    warmRead: s.warmRead + readTokens,
    pingLog: [...s.pingLog, { at: now, read: readTokens, ok: r.isAnswered }].slice(-5),
  }))
}

// ---------------------------------------------------------------- hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'office', description: 'Open the office pane: your session and its agents at work' })
    await $.command.register({ name: 'tasks', description: 'Open the office on the main session and its task list' })
    await $.command.register({ name: 'cache', description: 'Open the office on the prompt cache panel; /cache warm on|off' })
    $.clock.every(30_000, () => void warmTick($).catch(() => undefined))
    await $.tool.register({
      name: 'set_tasks',
      description:
        'Record your task list so the person can follow it in the office. Use it for any work with 3 or more ' +
        'steps: call it with the full list before starting, then again with the whole updated list each time a ' +
        'task starts or finishes, keeping exactly one task in_progress. Each call replaces your previous list.',
      inputSchema: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                subject: { type: 'string', description: 'Short imperative title' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              },
              required: ['subject', 'status'],
            },
          },
        },
        required: ['tasks'],
      },
    })
    await $.tool.register({
      name: 'propose_plan',
      description:
        'Propose splitting a big request into tasks, each run by its own agent on the smallest model that can do ' +
        'it well, to save usage. Use it only when the request has clearly separate parts of different difficulty ' +
        '(a master prompt, a multi-part build); for anything else just do the work yourself or use one agent. ' +
        'For each task give a short title, self-contained instructions, the model (haiku: mechanical edits, ' +
        'lookups, boilerplate; sonnet: normal features, fixes, tests; opus: architecture, hard debugging, careful ' +
        'judgment), an effort level, a one-line reason, and the numbers of tasks that must finish first. The ' +
        'person reviews and approves the plan before anything starts: after calling this, stop and wait. You will ' +
        'get a message telling you to run it, run it as one agent, or not to start.',
      inputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'One line: what the whole request achieves' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                instructions: { type: 'string', description: 'Everything the agent needs to do the task on its own' },
                model: { type: 'string', enum: ['haiku', 'sonnet', 'opus'] },
                effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'] },
                why: { type: 'string', description: 'One line: why this model' },
                after: { type: 'array', items: { type: 'number' }, description: 'Task numbers (from 1) that must finish first' },
              },
              required: ['title', 'instructions', 'model', 'effort'],
            },
          },
        },
        required: ['summary', 'tasks'],
      },
    })
    await $.command.register({
      name: 'route',
      description: 'Model routing: /route auto | haiku | sonnet | opus | off (no argument shows the status)',
    })
    const now = await $.clock.now()
    const model = await $.session.model()
    const mainWorker: Worker = {
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
    }
    await update($, workers, list => (list.some(w => w.id === MAIN) ? list : [mainWorker, ...list]))
    return next(e)
  })

  on('command.run', { command: 'office' }, async $ => {
    await $.ui.open(OFFICE)
    return { text: 'Office pane opened.' }
  })

  on('command.run', { command: 'cache' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'warm on' || arg === 'warm off') {
      await update($, cache, c => ({ ...c, warm: arg === 'warm on' }))
      return { text: `Cache warmer ${arg === 'warm on' ? 'on' : 'off'}.` }
    }
    await $.ui.open(OFFICE)
    return { text: 'Office opened; the cache panel is under the map.' }
  })

  on('command.run', { command: 'tasks' }, async $ => {
    await update($, selected, () => MAIN)
    await $.ui.open(OFFICE)
    return { text: 'Office opened on the main session and its tasks.' }
  })

  // The model's proposed plan: shown to the person, who approves it before anything starts.
  on('tool.call', { tool: PLAN_TOOL }, async ($, e) => {
    const input = e as { summary?: unknown; tasks?: unknown }
    const raw = input.tasks
    const tiers: readonly string[] = ['haiku', 'sonnet', 'opus']
    const isValid =
      typeof input.summary === 'string' &&
      Array.isArray(raw) &&
      raw.length > 0 &&
      raw.every(
        t =>
          typeof t?.title === 'string' &&
          typeof t?.instructions === 'string' &&
          tiers.includes(t?.model) &&
          (EFFORTS as readonly string[]).includes(t?.effort),
      )
    if (!isValid) {
      return {
        result: {
          content: [{ type: 'text', text: 'A plan needs a summary and tasks of { title, instructions, model, effort }.' }],
          isError: true,
        },
      }
    }
    const tasksIn = raw as { title: string; instructions: string; model: Tier; effort: Effort; why?: unknown; after?: unknown }[]
    const proposed: Plan = {
      id: String(await $.clock.now()),
      summary: input.summary as string,
      status: 'proposed',
      tasks: tasksIn.map((t, i) => ({
        n: i + 1,
        title: t.title,
        instructions: t.instructions,
        why: typeof t.why === 'string' ? t.why : '',
        model: t.model,
        effort: t.effort,
        after: Array.isArray(t.after) ? t.after.filter((n): n is number => typeof n === 'number' && n >= 1 && n <= tasksIn.length && n !== i + 1) : [],
        keep: true,
      })),
    }
    await update($, plan, () => proposed)
    await $.ui.open({ id: PLAN_PANE, title: 'Approve plan', focus: true, rows: 200, columns: 400 })
    return {
      result: {
        content: [
          {
            type: 'text',
            text:
              `The plan (${proposed.tasks.length} tasks) is shown to the person for approval. Stop here and wait: ` +
              'do not start the work. A message will tell you whether to run it.',
          },
        ],
      },
    }
  })

  // The mod's own tool: the model sends its whole list, which replaces that agent's tasks.
  on('tool.call', { tool: OWN_TOOL }, async ($, e) => {
    const raw = (e as { tasks?: unknown }).tasks
    const isValid =
      Array.isArray(raw) &&
      raw.every((t): t is { subject: string; status: Task['status'] } => typeof t?.subject === 'string' && STATUSES.includes(t?.status))
    if (!isValid) {
      return { result: { content: [{ type: 'text', text: 'tasks must be an array of { subject, status }.' }], isError: true } }
    }
    const owner = e.agentId ?? MAIN
    const prefix = `own:${owner}:`
    const mine: Task[] = raw.map((t, i) => ({ id: `${prefix}${i}`, subject: t.subject, status: t.status, owner }))
    const list = await update($, tasks, all => replaceOwned(all, prefix, mine))
    return { result: { content: [{ type: 'text', text: `Recorded. ${doneOf(list.filter(t => t.owner === owner))} of your tasks done.` }] } }
  })

  // Sessions that have the built-in todo and task tools are tracked too.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    const owner = e.agentId ?? MAIN
    const todos: Task[] = e.todos.map((t, i) => ({ id: `todo:${owner}:${i}`, subject: t.content, status: t.status, owner }))
    await update($, tasks, list => replaceOwned(list, `todo:${owner}:`, todos))
    return ran
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    const task: Task = { id: `task:${ran.result.task.id}`, subject: e.subject, status: 'pending', owner: e.agentId ?? MAIN }
    await update($, tasks, list => [...list.filter(t => t.id !== task.id), task])
    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError || !ran.result.success) return ran
    const id = `task:${e.taskId}`
    const status = e.status
    await update($, tasks, list =>
      status === 'deleted'
        ? list.filter(t => t.id !== id)
        : list.map(t => (t.id === id ? { ...t, subject: e.subject ?? t.subject, status: status ?? t.status } : t)),
    )
    return ran
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
    const effort = await read($, mainEffort)
    if (effort !== null) {
      await queue($, e.text, e.attachments ?? [], effort)
      return next(e)
    }
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
    await update($, cache, c => (c.pings === 0 ? c : { ...c, pings: 0 }))
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

  // Main loop: the routed or picked model and the clicked effort. A subagent keeps
  // what it was spawned with unless the person picked otherwise in its card.
  on('turn.step', async function* ($, e, next) {
    const cur = await read($, current)
    if (e.agentId === undefined && cur !== null && cur.turnId === e.turnId) {
      return yield* next({
        ...e,
        ...(cur.tier !== null ? { model: MODELS[cur.tier] } : {}),
        ...(cur.effort !== null ? { effort: cur.effort } : {}),
      })
    }
    let pick = e.agentId === undefined ? undefined : (await read($, agentPicks))[e.agentId]
    if (e.agentId !== undefined && pick === undefined) {
      // A plan agent's first request can come before its spawn returned: find it by name.
      const p = await read($, plan)
      const info = p?.status === 'approved' ? (await $.agent.list()).find(a => a.id === e.agentId) : undefined
      const chosen = info && planChoice(p, info.description)
      if (chosen) pick = { model: chosen.model, effort: chosen.effort }
    }
    if (pick !== undefined && (pick.model !== null || pick.effort !== null)) {
      return yield* next({
        ...e,
        ...(pick.model !== null ? { model: MODELS[pick.model] } : {}),
        ...(pick.effort !== null ? { effort: pick.effort } : {}),
      })
    }
    return yield* next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    // An agent the approved plan named runs on the model and effort the person approved.
    const chosen = planChoice(await read($, plan), e.description)
    const result = await next(chosen ? { ...e, model: MODELS[chosen.model] } : e)
    if (chosen && result.agentId !== undefined) {
      const id = result.agentId
      await update($, agentPicks, all => ({ ...all, [id]: { model: chosen.model, effort: chosen.effort } }))
    }
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
    const u = e.usage
    if (u && e.agentId === undefined) {
      const end = await $.clock.now()
      await update($, cache, c => ({
        ...c,
        lastAt: end,
        totals: {
          read: c.totals.read + (u.cache_read_input_tokens ?? 0),
          written: c.totals.written + (u.cache_creation_input_tokens ?? 0),
          fresh: c.totals.fresh + (u.input_tokens ?? 0),
        },
      }))
      try {
        const usage = await $.session.usage({ breakdown: 'full' })
        const categories = usage.context.breakdown?.categories
        if (categories) await update($, cache, c => ({ ...c, blocks: cacheBlocks(categories) }))
      } catch {
        // No breakdown this turn; the panel keeps the last one.
      }
    }
    if (u) {
      const used = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
      await update($, workers, list => list.map(w => (w.id === id ? { ...w, tokens: (w.tokens ?? 0) + used } : w)))
    }
    if (e.answer.trim()) await say($, id, 'agent', e.answer)
    return next(e)
  })

  // The button beside the footer's mode labels, drawn after whatever is beneath
  // (the engine's labels, another mod's buttons).
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const cur = await read($, current)
    const m = await read($, mode)
    const label = m === 'off' ? 'Office' : `Office · ${cur?.tier ?? m}`
    return (
      <Box flexDirection="row" gap={1}>
        {below}
        <Button key="open-office" label={label} plain onPress={() => void $.ui.open(OFFICE)} />
      </Box>
    )
  })

  // The same button in the strip directly above the prompt box.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const below = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const cur = await read($, current)
    const m = await read($, mode)
    const working = (await read($, workers)).filter(w => w.status === 'working').length
    const mine = (await read($, tasks)).filter(t => t.owner === MAIN)
    const doing = mine.find(t => t.status === 'in_progress')
    const dropdowns = e.surface === 'mobile' ? null : mainDropdowns($, $.ui.resolve(e), m, await read($, mainEffort), 'strip')
    return (
      <Box flexDirection="row" gap={2}>
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
            {mine.length > 0 ? ` · tasks ${doneOf(mine)}` : ''}
            {doing ? ` · now: ${snippet(doing.subject, 40)}` : ''}
          </Text>
          {dropdowns}
        </Box>
        {below}
      </Box>
    )
  })

  // The plan the model proposed: the person changes any task's model or effort,
  // drops tasks, then approves, runs it as one agent, or cancels.
  on('ui.render', { component: 'Pane', requestId: PLAN_PANE }, async ($, e) => {
    const p = await read($, plan)
    const { Box, Text, Button } = $.ui.resolve(e)
    if (p === null || p.status !== 'proposed') return <Text dimColor>No plan is waiting for approval.</Text>
    const kept = p.tasks.filter(t => t.keep)
    const table = e.surface === 'mobile' ? null : $.ui.resolve(e)
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Proposed plan: {p.summary}</Text>
        <Text dimColor>
          {kept.length} of {p.tasks.length} tasks · each runs as its own agent on the model you approve · nothing starts until you approve
        </Text>
        {p.tasks.map(t => (
          <Box key={`task-${t.n}`} flexDirection="column" borderStyle="round" paddingX={1}>
            <Text bold dimColor={!t.keep}>
              {t.n}. {t.title}
              {t.after.length > 0 ? `  (after ${t.after.join(', ')})` : ''}
              {t.keep ? '' : '  · dropped'}
            </Text>
            {t.why !== '' && <Text dimColor>Why {t.model}: {t.why}</Text>}
            <Text dimColor wrap="truncate-end">{t.instructions}</Text>
            <Box flexDirection="row" gap={1}>
              {table !== null && (
                <table.Select
                  key={`plan-model-${t.n}`}
                  label="Model"
                  options={AGENT_MODEL_OPTIONS.slice(1)}
                  value={t.model}
                  onSelect={value => void editTask($, t.n, { model: value as Tier })}
                />
              )}
              {table !== null && (
                <table.Select
                  key={`plan-effort-${t.n}`}
                  label="Effort"
                  options={AGENT_EFFORT_OPTIONS.slice(1)}
                  value={t.effort}
                  onSelect={value => void editTask($, t.n, { effort: value as Effort })}
                />
              )}
              <Button
                key={`plan-keep-${t.n}`}
                label={t.keep ? 'Drop' : 'Keep'}
                onPress={() => void editTask($, t.n, { keep: !t.keep })}
              />
            </Box>
          </Box>
        ))}
        <Box flexDirection="row" gap={1}>
          <Button key="plan-approve" label={`Approve ${kept.length} agents`} variant="primary" onPress={() => void decide($, 'approve')} />
          <Button key="plan-one" label="Run as one agent" onPress={() => void decide($, 'one')} />
          <Button key="plan-cancel" label="Cancel" role="dismiss" onPress={() => void decide($, 'cancel')} />
        </Box>
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
    const recent = (await read($, routes)).slice(-3).reverse()
    const w = list.find(one => one.id === chosen) ?? list[0]
    const allTasks = await read($, tasks)
    const tasksOf = (id: string) => allTasks.filter(t => t.owner === id)
    const { Box, Text, Button } = $.ui.resolve(e)

    const roster = (
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {list.map(one => (
          <Button
            key={`w-${one.id}`}
            label={`${{ working: '●', idle: '○', done: '✓', error: '!' }[one.status]} ${snippet(one.name, 22)}${tasksOf(one.id).length > 0 ? ` · ${doneOf(tasksOf(one.id))}` : ''}`}
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

    // Model and Effort for the next message to this worker.
    let cardDropdowns = null
    if (w && e.surface !== 'mobile') {
      const table = $.ui.resolve(e)
      if (w.id === MAIN) {
        cardDropdowns = mainDropdowns($, table, m, await read($, mainEffort), 'card')
      } else {
        const { Box, Select } = table
        const pick: AgentPick = (await read($, agentPicks))[w.id] ?? { model: null, effort: null }
        const setPick = (patch: Partial<AgentPick>) =>
          void update($, agentPicks, all => ({ ...all, [w.id]: { ...(all[w.id] ?? { model: null, effort: null }), ...patch } }))
        cardDropdowns = (
          <Box flexDirection="row" gap={1}>
            <Select
              key={`agent-model-${w.id}`}
              label="Model"
              options={AGENT_MODEL_OPTIONS}
              value={pick.model ?? 'inherit'}
              onSelect={value => setPick({ model: value === 'inherit' ? null : (value as Tier) })}
            />
            <Select
              key={`agent-effort-${w.id}`}
              label="Effort"
              options={AGENT_EFFORT_OPTIONS}
              value={pick.effort ?? 'inherit'}
              onSelect={value => setPick({ effort: value === 'inherit' ? null : (value as Effort) })}
            />
          </Box>
        )
      }
    }

    const tokens = w?.tokens === undefined ? null : w.tokens >= 1000 ? `${(w.tokens / 1000).toFixed(1)}k tokens` : `${w.tokens} tokens`
    const mineTasks = w ? tasksOf(w.id) : []
    // Nothing here changes on its own between redraws (no running clock): a scroll
    // redraws the pane with an identical tree, so the surface leaves the map alone.
    const detail = w && (
      <Box key="detail" flexDirection="column" borderStyle="round" borderColor={UI.edge} backgroundColor={UI.panel} paddingX={2} paddingY={1} gap={1}>
        <Box flexDirection="row" gap={2}>
          <Text bold color={UI.text}>
            {w.name}
          </Text>
          <Text bold color={STATUS_COLOR[w.status]}>
            {w.status.toUpperCase()}
          </Text>
          <Text color={UI.muted}>
            {(w.kind === 'session' ? 'SESSION' : w.type.toUpperCase())} · {modelName(w.model)}
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text color={UI.muted}>NOW</Text>
          <Text wrap="wrap" color={UI.text}>
            {w.task}
          </Text>
        </Box>
        <Text color={UI.muted}>
          {w.lastTool ?? 'no tool yet'} · {w.tools} tool calls{tokens ? ` · ${tokens}` : ''}
        </Text>
        {mineTasks.length > 0 && (
          <Box flexDirection="column">
            <Text color={UI.muted}>TASKS {doneOf(mineTasks)}</Text>
            {mineTasks.slice(0, 6).map(t => (
              <Text
                key={t.id}
                wrap="wrap"
                bold={t.status === 'in_progress'}
                color={t.status === 'in_progress' ? UI.mint : t.status === 'completed' ? UI.muted : UI.text}
              >
                {MARK[t.status]} {t.subject}
              </Text>
            ))}
            {mineTasks.length > 6 && <Text color={UI.muted}>+{mineTasks.length - 6} more</Text>}
          </Box>
        )}
        {(w.chat ?? []).length > 0 && (
          <Box flexDirection="column">
            <Text color={UI.muted}>CONVERSATION</Text>
            {(w.chat ?? []).slice(-4).map((line, i) => (
              <Text key={`chat-${i}`} wrap="wrap" color={line.from === 'agent' ? UI.mint : line.from === 'note' ? UI.muted : UI.text}>
                <Text bold color={line.from === 'agent' ? UI.mint : UI.muted}>
                  {line.from === 'you' ? 'You' : line.from === 'agent' ? w.name : 'Note'}:
                </Text>{' '}
                {snippet(line.text, 180)}
              </Text>
            ))}
          </Box>
        )}
        {cardDropdowns}
        {talkBox}
      </Box>
    )

    const routing = (
      <Box flexDirection="column" borderStyle="round" borderColor={UI.edge} backgroundColor={UI.panel} paddingX={2} paddingY={1} gap={1}>
        <Box flexDirection="row" gap={1}>
          <Text bold color={UI.muted}>
            ROUTING
          </Text>
          {MODES.map(one => (
            <Button
              key={`mode-${one}`}
              label={one}
              variant={one === m ? 'primary' : 'secondary'}
              onPress={() => update($, mode, () => one)}
            />
          ))}
        </Box>
        {recent.length === 0 && <Text color={UI.muted}>No prompts routed yet.</Text>}
        {recent.map(r => (
          <Text key={`r-${r.turnId}`} wrap="truncate-end" color={UI.muted}>
            <Text bold color={r.tier ? TIER_UI[r.tier] : UI.muted}>
              {(r.tier ?? 'kept').toUpperCase()}
            </Text>
            {' '}· effort {r.effort ?? 'unchanged'} · {r.why} · {r.prompt}
          </Text>
        ))}
      </Box>
    )

    if (e.surface === 'desktop') {
      const { Svg, Select } = $.ui.resolve(e)
      const c = await read($, cache)
      // The desktop scrolls a pane through the engine: every scroll step redraws the
      // whole pane, which reloads the map and makes the scroll stutter. So the pane is
      // laid out to fit its window with nothing to scroll. Wide: the map and the cache
      // panel on the left, exactly as wide as the map, the workers and the card on the
      // right. Narrow: one column.
      const columns = e.props.bodyColumns
      const rows = e.props.scroll.bodyRows
      const isWide = columns >= 110
      // The left column holds the map (720:440), the cache panel (720:300) and a row
      // of controls, with gaps: about 5 rows besides the two drawings.
      const tall = (CACHE_VIEW.height + 440) / 720
      const fitWidth = Math.floor(((rows - 5) * ROW_PX) / tall)
      const width = Math.max(320, Math.min(fitWidth, Math.floor((isWide ? columns * 0.62 : columns) * COLUMN_PX)))
      const mapHeight = Math.round((width * 440) / 720)
      const cacheHeight = Math.round((width * CACHE_VIEW.height) / 720)
      const leftColumns = Math.ceil(width / COLUMN_PX)
      const now = await $.clock.now()
      const left = (
        <Box flexDirection="column" gap={1} width={isWide ? leftColumns : undefined}>
          <Svg
            key="map"
            source={officeMap(list, w?.id ?? MAIN, width, mapHeight, (await read($, current))?.tier ?? m, allTasks)}
            width={width}
            height={mapHeight}
            alt={`Office with ${list.length} workers`}
            isInteractive
          />
          <Svg
            key="cache"
            source={cachePanel(c, now, width, cacheHeight)}
            width={width}
            height={cacheHeight}
            alt={`Prompt cache: warmer ${c.warm ? 'on' : 'off'}`}
            isInteractive
          />
          <Box flexDirection="row" gap={1}>
            <Button
              key="warm-toggle"
              label={c.warm ? '● Warmer on' : '○ Warmer off'}
              variant={c.warm ? 'primary' : 'secondary'}
              onPress={() => void update($, cache, x => ({ ...x, warm: !x.warm }))}
            />
            <Select
              key="warm-ttl"
              label="Cache"
              options={[
                { value: '3600', label: '1 hour' },
                { value: '300', label: '5 minutes' },
              ]}
              value={String(c.ttl)}
              onSelect={value => void update($, cache, x => ({ ...x, ttl: Number(value), pings: 0 }))}
            />
          </Box>
        </Box>
      )
      if (isWide) {
        return (
          <Box flexDirection="row" gap={2}>
            {left}
            <Box flexDirection="column" gap={1} width={columns - leftColumns - 2}>
              {roster}
              {detail}
              {routing}
            </Box>
          </Box>
        )
      }
      return (
        <Box flexDirection="column" gap={1}>
          {left}
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
