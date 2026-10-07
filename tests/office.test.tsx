import { expect, mock, test } from 'claude-code/testing'

// A mounted drawing; its acts (select, input) depend on the surface the test names.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mount = any

const SESSION_MODEL = 'claude-opus-5-5'
const SESSION_EFFORT = 'high'
const START = { source: 'startup', cwd: '/tmp', surface: 'desktop', isInteractive: true } as never
// As the desktop sends it: a docked pane, its scroll window and its width.
const PANE = { plugin: 'office-router', component: 'Pane', requestId: 'office', props: { bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 43 } } } as const
const PICKER = { plugin: 'office-router', component: 'Pane', requestId: 'effort', props: { bodyColumns: 100 } } as const
const MODE = { plugin: 'office-router', component: 'SessionMode', props: { modes: ['auto'] } } as const

// The engine beneath the plugin: just enough of it for these hooks.
// `classify` answers $.model.classify. `seen` records what reached the engine.
function world(on: any, classify: (text: string) => string | undefined) {
  const seen = {
    sent: [] as string[],
    efforts: [] as unknown[],
    entered: [] as string[],
    filled: [] as string[],
    sends: [] as { to: unknown; text: string }[],
    spawned: [] as { description: string; model?: string }[],
    agents: [] as { id: string; description: string; type: string; status: string }[],
    asked: 0,
    forks: 0,
  }
  const clock = mock.clock(on, { now: 1_000 })
  on('command.register', async () => ({ value: undefined }))
  on('tool.register', async () => ({ value: undefined }))
  on('session.model', async () => ({ value: SESSION_MODEL }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.close', async () => ({ value: undefined }))
  // The engine's own drawing beneath the plugin, which the footer and strip wrap.
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine</Text>
  })
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.start', async (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('prompt.submit', async (_$: unknown, e: { text: string }) => {
    seen.entered.push(e.text)
    return { text: e.text }
  })
  on('session.send', async (_$: unknown, e: { to: unknown; text: string }) => {
    seen.sends.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })
  on('agent.spawn', async (_$: unknown, e: { description: string; model?: string }) => {
    seen.spawned.push({ description: e.description, model: e.model })
    return { model: e.model ?? 'claude-haiku-4-5-20251001', agentId: `agent-${e.description}` }
  })
  on('agent.list', async () => ({ value: seen.agents }))
  on('turn.complete', async (_$: unknown, e: { answer?: string }) => ({ text: e.answer ?? '' }))
  on('model.fork', async () => {
    seen.forks += 1
    return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 4, output_tokens: 1, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 0 } } }
  })
  on('session.usage', async () => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      context: {
        window: 200_000,
        breakdown: {
          categories: [
            { name: 'System prompt', tokens: 6000, kind: 'used' },
            { name: 'System tools', tokens: 14_000, kind: 'used' },
            { name: 'Memory files', tokens: 3000, kind: 'used' },
            { name: 'Messages', tokens: 20_000, kind: 'used' },
            { name: 'Free space', tokens: 150_000, kind: 'free' },
          ],
        },
      },
    },
  }))
  on('prompt.fill', async (_$: unknown, e: { text: string }) => {
    seen.filled.push(e.text)
    return { value: undefined }
  })
  on('model.classify', async (_$: unknown, e: { text: string }) => {
    seen.asked += 1
    return { value: classify(e.text) }
  })
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number; model: string; effort?: unknown }) {
    seen.sent.push(e.model)
    seen.efforts.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return Object.assign(seen, { clock })
}

// The person types a prompt in the box.
const type = ($: any, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

// The engine runs the turn the released prompt starts.
async function run($: any, text: string, turnId: string, agentId?: string) {
  await $.turn.start({ text, turnId })
  const stream = $.turn.step({
    turnId,
    index: 0,
    model: SESSION_MODEL,
    effort: SESSION_EFFORT,
    messageCount: 1,
    ...(agentId ? { agentId } : {}),
  })
  for await (const _ of stream) {
    // drain the response
  }
}

// The person clicks a button in the effort picker.
async function pick($: any, key: string) {
  const picker = (await $.ui.mount({ ...PICKER, surface: 'desktop' })) as Mount
  await picker.press({ key })
  await picker.unmount()
}

test('a typed prompt is held until the person picks an effort', async ($, on) => {
  const seen = world(on, () => 'complex')
  const held = await type($, 'Redesign the auth architecture')
  expect(held).toHaveProperty('drop')
  expect(seen.entered).toEqual([])

  await pick($, 'effort-max')
  expect(seen.entered).toEqual(['Redesign the auth architecture'])

  await run($, 'Redesign the auth architecture', 't1')
  expect(seen.sent).toEqual(['claude-opus-5-5'])
  expect(seen.efforts).toEqual(['max'])
})

test('the picker recommends an effort from the model, and the person can overrule it', async ($, on) => {
  const seen = world(on, () => 'simple')
  await type($, 'rename this variable')
  const picker = (await $.ui.mount({ ...PICKER, surface: 'desktop' } as never)) as Mount
  expect(await picker.find({ type: 'Text', text: /Recommended effort: low/ })).toBeDefined()
  await picker.press({ key: 'effort-high' })
  await picker.unmount()

  await run($, 'rename this variable', 't2')
  expect(seen.sent).toEqual(['claude-haiku-4-5-20251001'])
  expect(seen.efforts).toEqual(['high'])
})

test('keep current leaves the session effort as it was', async ($, on) => {
  const seen = world(on, () => 'moderate')
  await type($, 'fix the failing login test')
  await pick($, 'effort-keep')
  await run($, 'fix the failing login test', 't3')
  expect(seen.sent).toEqual(['claude-sonnet-5-5'])
  expect(seen.efforts).toEqual([SESSION_EFFORT])
})

test('the router never sets effort without a click', async ($, on) => {
  const seen = world(on, () => 'complex')
  await type($, 'Redesign everything')
  // No click: a turn with the same text arrives from elsewhere.
  await run($, 'Redesign everything', 't4')
  expect(seen.sent).toEqual([SESSION_MODEL])
  expect(seen.efforts).toEqual([SESSION_EFFORT])
})

test('an unsure classifier keeps the session model but still asks for effort', async ($, on) => {
  const seen = world(on, () => undefined)
  await type($, 'something odd')
  await pick($, 'effort-medium')
  await run($, 'something odd', 't5')
  expect(seen.sent).toEqual([SESSION_MODEL])
  expect(seen.efforts).toEqual(['medium'])
})

test('a subagent request is never rerouted', async ($, on) => {
  const seen = world(on, () => 'simple')
  await type($, 'rename x')
  await pick($, 'effort-low')
  await run($, 'rename x', 't6', 'agent-1')
  expect(seen.sent).toEqual([SESSION_MODEL])
  expect(seen.efforts).toEqual([SESSION_EFFORT])
})

test('/route sonnet pins the model and skips the classifier', async ($, on) => {
  const seen = world(on, () => 'complex')
  await $.command.run({ command: 'route', args: 'sonnet' } as never)
  await type($, 'Redesign everything')
  await pick($, 'effort-keep')
  await run($, 'Redesign everything', 't7')
  expect(seen.sent).toEqual(['claude-sonnet-5-5'])
  expect(seen.asked).toBe(0)
})

test('/route off sends prompts straight through with no picker', async ($, on) => {
  const seen = world(on, () => 'simple')
  await $.command.run({ command: 'route', args: 'off' } as never)
  const result = await type($, 'rename x')
  expect(result).toEqual({ text: 'rename x' })
  await run($, 'rename x', 't8')
  expect(seen.sent).toEqual([SESSION_MODEL])
  expect(seen.efforts).toEqual([SESSION_EFFORT])
})

test('the footer button and the office pane draw on terminal and desktop', async ($, on) => {
  world(on, () => 'simple')
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const footer = (await $.ui.mount({ ...MODE, surface } as never)) as Mount
    expect(await footer.find({ key: 'open-office' })).toBeDefined()
    expect(await footer.find({ type: 'Text', text: /^engine$/ }), 'keeps what is beneath').toBeDefined()
    await footer.unmount()

    const strip = await $.ui.mount({
      plugin: 'office-router',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 },
      surface,
    } as never)
    expect(await strip.find({ key: 'open-office-band' })).toBeDefined()
    expect(await strip.find({ type: 'Text', text: /^engine$/ }), 'keeps what is beneath').toBeDefined()
    await strip.unmount()

    const pane = (await $.ui.mount({ ...PANE, surface } as never)) as Mount
    expect(await pane.find({ key: 'mode-auto' })).toBeDefined()
    expect(await pane.find({ key: 'w-main' })).toBeDefined()
    await pane.unmount()
  }
})

test('pressing a worker shows its task, and the map draws on desktop', async ($, on) => {
  world(on, () => 'moderate')
  await $.session.start(START)
  await type($, 'Fix the checkout bug')
  await pick($, 'effort-medium')
  await $.turn.start({ text: 'Fix the checkout bug', turnId: 't9' })
  const pane = (await $.ui.mount({ ...PANE, surface: 'desktop' } as never)) as Mount
  await pane.press({ key: 'w-main' })
  expect(await pane.find({ type: 'Text', text: /Fix the checkout bug/ }), 'task text').toBeDefined()
  expect(await pane.find({ type: 'Svg' }), 'map').toBeDefined()
  await pane.unmount()
})

test('a message typed in a subagent card goes to that agent', async ($, on) => {
  const seen = world(on, () => 'simple')
  await $.session.start(START)
  await $.agent.spawn({
    prompt: 'Map the auth code',
    description: 'auth',
    subagentType: 'Explore',
    background: true,
    fork: false,
    parentModel: SESSION_MODEL,
    provider: { plugin: 'engine', tier: 'core' },
  } as never)
  const pane = (await $.ui.mount({ ...PANE, surface: 'desktop' } as never)) as Mount
  await pane.press({ key: 'w-agent-auth' })
  await pane.input({ key: 'talk-agent-auth', text: 'Now check the session code too' })
  expect(seen.sends).toEqual([{ to: expect.anything(), text: 'Now check the session code too' }])
  expect(JSON.stringify(seen.sends[0]!.to)).toContain('agent-auth')
  expect(await pane.find({ type: 'Text', text: /You: Now check the session code too/ })).toBeDefined()
  await pane.unmount()
})

test('a message typed in the main session card is routed and waits for an effort click', async ($, on) => {
  const seen = world(on, () => 'complex')
  await $.session.start(START)
  const pane = (await $.ui.mount({ ...PANE, surface: 'desktop' } as never)) as Mount
  await pane.input({ key: 'talk-main', text: 'Continue the refactor' })
  await pane.unmount()
  expect(seen.entered).toEqual([])
  await pick($, 'effort-high')
  expect(seen.entered).toEqual(['Continue the refactor'])
  await run($, 'Continue the refactor', 'm1')
  expect(seen.sent).toEqual(['claude-opus-5-5'])
  expect(seen.efforts).toEqual(['high'])
})

test('tasks the model sets show in its card, on the roster and on the map', async ($, on) => {
  world(on, () => 'simple')
  on('tool.call', { tool: 'TodoWrite' }, (_$: unknown, e: { todos: unknown[] }) => ({ result: { oldTodos: [], newTodos: e.todos } }))
  await $.session.start(START)

  const ran = await $.tool.call({ tool: 'mcp__office-router__set_tasks', tasks: [
    { subject: 'Plan the merge', status: 'completed' },
    { subject: 'Move tasks into the office', status: 'in_progress' },
    { subject: 'Push one mod', status: 'pending' },
  ] } as never)
  expect(JSON.stringify(ran.result)).toContain('1/3 of your tasks done')

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = (await $.ui.mount({ ...PANE, surface } as never)) as Mount
    await pane.press({ key: 'w-main' })
    expect((await pane.find({ key: 'w-main' }))?.text).toContain('1/3')
    expect(await pane.find({ type: 'Text', text: /^TASKS 1\/3$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /◐ Move tasks into the office/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /✓ Plan the merge/ })).toBeDefined()
    if (surface === 'desktop') expect(JSON.stringify(await pane.find({ type: 'Svg' }))).toContain('1/3')
    await pane.unmount()
  }

  // A new list replaces the old one; a bad one is refused.
  await $.tool.call({ tool: 'mcp__office-router__set_tasks', tasks: [{ subject: 'Push one mod', status: 'completed' }] } as never)
  const pane = (await $.ui.mount({ ...PANE, surface: 'terminal' } as never)) as Mount
  expect(await pane.find({ type: 'Text', text: /^TASKS 1\/1$/ })).toBeDefined()
  await pane.unmount()
  const bad = await $.tool.call({ tool: 'mcp__office-router__set_tasks', tasks: [{ subject: 'x', status: 'done' }] } as never)
  expect(JSON.stringify(bad.result)).toContain('"isError":true')

  // The built-in todo tool, where a session has it, lands in the same list.
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Write docs', status: 'pending', activeForm: 'Writing docs' }] } as never)
  const again = (await $.ui.mount({ ...PANE, surface: 'terminal' } as never)) as Mount
  expect(await again.find({ type: 'Text', text: /○ Write docs/ })).toBeDefined()
  await again.unmount()
})

test('the strip shows the main session task progress and what it is doing now', async ($, on) => {
  world(on, () => 'simple')
  await $.tool.call({ tool: 'mcp__office-router__set_tasks', tasks: [
    { subject: 'Plan', status: 'completed' },
    { subject: 'Build the board', status: 'in_progress' },
  ] } as never)
  const strip = await $.ui.mount({
    plugin: 'office-router',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 },
    surface: 'desktop',
  } as never)
  expect(await strip.find({ type: 'Text', text: /tasks 1\/2 · now: Build the board/ })).toBeDefined()
  await strip.unmount()
})

const STRIP = {
  plugin: 'office-router',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 },
  surface: 'desktop',
} as const

test('a follow-up keeps the first effort and model, with no dialog', async ($, on) => {
  const seen = world(on, () => 'complex')
  await type($, 'Redesign the auth flow')
  await pick($, 'effort-high')
  await run($, 'Redesign the auth flow', 'f1')

  // The follow-up enters at once: no dialog, no new routing.
  const result = await type($, 'Now add tests for it')
  expect(result).toEqual({ text: 'Now add tests for it' })
  await run($, 'Now add tests for it', 'f2')
  expect(seen.sent).toEqual(['claude-opus-5-5', 'claude-opus-5-5'])
  expect(seen.efforts).toEqual(['high', 'high'])
  expect(seen.asked).toBe(1)
})

test('the dropdowns change the model and effort for the next prompt', async ($, on) => {
  const seen = world(on, () => 'complex')
  await type($, 'First task')
  await pick($, 'effort-high')
  await run($, 'First task', 'd1')

  const strip = (await $.ui.mount(STRIP as never)) as Mount
  await strip.select({ key: 'strip-model', value: 'haiku' })
  await strip.select({ key: 'strip-effort', value: 'low' })
  await strip.unmount()

  expect(await type($, 'Quick rename')).toEqual({ text: 'Quick rename' })
  await run($, 'Quick rename', 'd2')
  expect(seen.sent.at(-1)).toBe('claude-haiku-4-5-20251001')
  expect(seen.efforts.at(-1)).toBe('low')

  // "ask me" brings the dialog back for the next prompt.
  const again = (await $.ui.mount(STRIP as never)) as Mount
  await again.select({ key: 'strip-effort', value: 'ask' })
  await again.unmount()
  expect(await type($, 'Another one')).toHaveProperty('drop')
})

test('auto-route re-routes each follow-up while keeping the chosen effort', async ($, on) => {
  const seen = world(on, text => (text.includes('rename') ? 'simple' : 'complex'))
  await type($, 'Big redesign')
  await pick($, 'effort-medium')
  await run($, 'Big redesign', 'a1')

  const strip = (await $.ui.mount(STRIP as never)) as Mount
  await strip.select({ key: 'strip-model', value: 'auto' })
  await strip.unmount()

  expect(await type($, 'rename a variable')).toEqual({ text: 'rename a variable' })
  await run($, 'rename a variable', 'a2')
  expect(seen.sent).toEqual(['claude-opus-5-5', 'claude-haiku-4-5-20251001'])
  expect(seen.efforts).toEqual(['medium', 'medium'])
})

test("an agent's card picks the model and effort its next steps use", async ($, on) => {
  const seen = world(on, () => 'simple')
  await $.session.start(START)
  await $.agent.spawn({
    prompt: 'Map the auth code',
    description: 'auth',
    subagentType: 'Explore',
    background: true,
    fork: false,
    parentModel: SESSION_MODEL,
    provider: { plugin: 'engine', tier: 'core' },
  } as never)
  const pane = (await $.ui.mount({ ...PANE, surface: 'desktop' } as never)) as Mount
  await pane.press({ key: 'w-agent-auth' })
  await pane.select({ key: 'agent-model-agent-auth', value: 'sonnet' })
  await pane.select({ key: 'agent-effort-agent-auth', value: 'max' })
  await pane.unmount()

  await run($, 'unused', 's1', 'agent-auth')
  expect(seen.sent).toEqual(['claude-sonnet-5-5'])
  expect(seen.efforts).toEqual(['max'])
})

const PLAN = { plugin: 'office-router', component: 'Pane', requestId: 'plan', props: { bodyColumns: 100 } } as const
const PROPOSAL = {
  summary: 'Add a billing page',
  tasks: [
    { title: 'Read the billing API', instructions: 'List the endpoints', model: 'haiku', effort: 'low', why: 'Lookup only' },
    { title: 'Build the page', instructions: 'Build it', model: 'opus', effort: 'high', why: 'New UI', after: [1] },
    { title: 'Write tests', instructions: 'Test it', model: 'sonnet', effort: 'medium', after: [2] },
  ],
}
const spawn = ($: any, description: string) =>
  $.agent.spawn({ prompt: 'go', description, subagentType: 'general-purpose', background: true, fork: false, parentModel: SESSION_MODEL, provider: { plugin: 'engine', tier: 'core' } })

test('a proposed plan waits for approval, and the approved models and efforts are applied', async ($, on) => {
  const seen = world(on, () => 'simple')
  const ran = await $.tool.call({ tool: 'mcp__office-router__propose_plan', ...PROPOSAL } as never)
  expect(JSON.stringify(ran.result)).toContain('wait')
  expect(seen.entered).toEqual([])

  // The person moves "Build the page" from Opus to Sonnet, then approves.
  const pane = (await $.ui.mount({ ...PLAN, surface: 'desktop' } as never)) as Mount
  expect(await pane.find({ type: 'Text', text: /Why haiku: Lookup only/ })).toBeDefined()
  await pane.select({ key: 'plan-model-2', value: 'sonnet' })
  await pane.press({ key: 'plan-approve' })
  await pane.unmount()

  const message = seen.entered.at(-1) ?? ''
  expect(message).toContain('plan:1 Read the billing API')
  expect(message).toContain('plan:2 Build the page\n  after: plan:1')
  expect(message).toContain('plan:3 Write tests\n  after: plan:2')

  // The main session starts the agents by those names: each gets its approved model and effort.
  await spawn($, 'plan:1 Read the billing API')
  await spawn($, 'plan:2 Build the page')
  await spawn($, 'Some other agent')
  expect(seen.spawned.map(s => s.model)).toEqual(['claude-haiku-4-5-20251001', 'claude-sonnet-5-5', undefined])
  await run($, 'unused', 'p1', 'agent-plan:1 Read the billing API')
  await run($, 'unused', 'p2', 'agent-plan:2 Build the page')
  expect(seen.efforts).toEqual(['low', 'high'])
})

test('dropping tasks and running as one agent uses the largest kept model and effort', async ($, on) => {
  const seen = world(on, () => 'simple')
  await $.tool.call({ tool: 'mcp__office-router__propose_plan', ...PROPOSAL } as never)
  const pane = (await $.ui.mount({ ...PLAN, surface: 'terminal' } as never)) as Mount
  await pane.press({ key: 'plan-keep-2' })
  expect(await pane.find({ type: 'Text', text: /dropped/ })).toBeDefined()
  await pane.press({ key: 'plan-one' })
  await pane.unmount()
  expect(seen.entered.at(-1)).toContain('plan:all Add a billing page')
  expect(seen.entered.at(-1)).not.toContain('Build the page')
  await spawn($, 'plan:all Add a billing page')
  expect(seen.spawned.at(-1)?.model).toBe('claude-sonnet-5-5')
})

test('a cancelled plan starts nothing and names no models', async ($, on) => {
  const seen = world(on, () => 'simple')
  await $.tool.call({ tool: 'mcp__office-router__propose_plan', ...PROPOSAL } as never)
  const pane = (await $.ui.mount({ ...PLAN, surface: 'desktop' } as never)) as Mount
  await pane.press({ key: 'plan-cancel' })
  await pane.unmount()
  expect(seen.entered.at(-1)).toContain('Do not start the work')
  await spawn($, 'plan:1 Read the billing API')
  expect(seen.spawned.at(-1)?.model).toBeUndefined()

  const bad = await $.tool.call({ tool: 'mcp__office-router__propose_plan', summary: 'x', tasks: [{ title: 'y' }] } as never)
  expect(JSON.stringify(bad.result)).toContain('"isError":true')
})

test("a plan agent's first request gets its effort even before its spawn returns", async ($, on) => {
  const seen = world(on, () => 'simple')
  await $.tool.call({ tool: 'mcp__office-router__propose_plan', ...PROPOSAL } as never)
  const pane = (await $.ui.mount({ ...PLAN, surface: 'desktop' } as never)) as Mount
  await pane.press({ key: 'plan-approve' })
  await pane.unmount()
  // No spawn seen yet: the engine already lists the agent by its plan name.
  seen.agents.push({ id: 'early', description: 'plan:3 Write tests', type: 'general-purpose', status: 'running' })
  await run($, 'unused', 'e1', 'early')
  expect(seen.sent).toEqual(['claude-sonnet-5-5'])
  expect(seen.efforts).toEqual(['medium'])
})

test("a worker's card shows the tokens its turns used", async ($, on) => {
  world(on, () => 'simple')
  await $.session.start(START)
  await $.turn.complete({
    turnId: 't1',
    reason: 'answer',
    answer: 'All done here',
    durationMs: 1000,
    isAborted: false,
    usage: { model: SESSION_MODEL, input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 500 },
  } as never)
  const pane = (await $.ui.mount({ ...PANE, surface: 'terminal' } as never)) as Mount
  await pane.press({ key: 'w-main' })
  expect(await pane.find({ type: 'Text', text: /2\.0k tokens/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Main session: All done here/ }), 'the reply joins the chat').toBeDefined()
  await pane.unmount()
})

test('redrawing the office with nothing changed hands back the same map', async ($, on) => {
  world(on, () => 'simple')
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
  await $.session.start(START)
  await spawn($, 'Explore auth')
  // The first drawing walks the new agent in; a redraw (a scroll) must not drop that.
  const first = (await $.ui.mount({ ...PANE, surface: 'desktop' } as never)) as Mount
  const before = JSON.stringify(await first.find({ type: 'Svg' }))
  await first.unmount()
  const again = (await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 4, bodyRows: 43 } }, surface: 'desktop' } as never)) as Mount
  expect(JSON.stringify(await again.find({ type: 'Svg' }))).toBe(before)
  await again.unmount()

  // A change the map shows draws a new one.
  await $.tool.call({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'u1' } as never)
  const changed = (await $.ui.mount({ ...PANE, surface: 'desktop' } as never)) as Mount
  expect(JSON.stringify(await changed.find({ type: 'Svg' }))).not.toBe(before)
  await changed.unmount()
})

test('a scroll a minute later redraws the whole office pane identically', async ($, on) => {
  const seen = world(on, () => 'simple')
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
  await $.session.start(START)
  await type($, 'list my files')
  await pick($, 'effort-low')
  await $.turn.start({ text: 'list my files', turnId: 'z1' })
  await $.tool.call({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'u1' } as never)

  const first = (await $.ui.mount({ ...PANE, surface: 'desktop' } as never)) as Mount
  // Handler handles are the engine's own, minted per drawing; everything drawn must match.
  const drawn = async (m: Mount) => JSON.stringify(await m.drawn()).replace(/"handle":\d+/g, '"handle":0')
  const before = await drawn(first)
  await first.unmount()
  await seen.clock.advance(60_000)
  const again = (await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 9, bodyRows: 43 } }, surface: 'desktop' } as never)) as Mount
  expect(await drawn(again)).toBe(before)
  await again.unmount()
})

test('a wide desktop pane fits its window: map and cache on the left, the card on the right', async ($, on) => {
  world(on, () => 'simple')
  await $.session.start(START)
  // The pane the desktop docked in the scroll test: 149 columns, 43 rows (about 8 px x 16 px each).
  const pane = (await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 149 }, surface: 'desktop' } as never)) as Mount
  const [map, panel] = (await pane.findAll({ type: 'Svg' })) as { props: { width: number; height: number } }[]
  expect(map!.props.height + panel!.props.height + 5 * 16).toBeLessThanOrEqual(43 * 16)
  expect(map!.props.width).toBeLessThanOrEqual(149 * 0.62 * 8)
  expect(panel!.props.width).toBe(map!.props.width)
  expect(JSON.stringify(await pane.drawn())).toContain('"flexDirection":"row"')
  await pane.unmount()
})

const mainTurnEnds = ($: any, usage: Record<string, number>) =>
  $.turn.complete({ turnId: 'c', reason: 'answer', answer: '', durationMs: 1, isAborted: false, usage: { model: SESSION_MODEL, ...usage } } as never)

test('the cache panel shows the hit rate and what the context is made of', async ($, on) => {
  world(on, () => 'simple')
  await $.session.start(START)
  await mainTurnEnds($, { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 36_000, cache_creation_input_tokens: 3000 })
  const pane = (await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 149 }, surface: 'desktop' } as never)) as Mount
  const panel = JSON.stringify((await pane.findAll({ type: 'Svg' }))[1])
  // 36k read of 40k sent: 90%. System 20k (prompt + tools), project 3k (memory), conversation 20k.
  for (const text of ['90%', 'SYSTEM', '20.0k', 'PROJECT', '3.0k', 'CONVERSATION', 'WARMER ON', 'TTL 1 HOUR']) expect(panel).toContain(text)
  expect((await pane.find({ key: 'warm-toggle' }))?.text).toBe('● Warmer on')
  await pane.press({ key: 'warm-toggle' })
  expect((await pane.find({ key: 'warm-toggle' }))?.text).toBe('○ Warmer off')
  await pane.unmount()
})

test('the warmer pings once just before the cache expires, then stops at its cap', async ($, on) => {
  const seen = world(on, () => 'simple')
  await $.session.start(START)
  await mainTurnEnds($, { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 36_000, cache_creation_input_tokens: 3000 })
  // Idle 58 minutes of a 1-hour cache: nothing yet.
  await seen.clock.advance(58 * 60_000)
  expect(seen.forks).toBe(0)
  // Past 59 minutes: one ping, and the cache counts as fresh again.
  await seen.clock.advance(90_000)
  expect(seen.forks).toBe(1)
  expect(seen.entered).toEqual([])
  // Three pings for the 1-hour cache, then it stops.
  await seen.clock.advance(4 * 60 * 60_000)
  expect(seen.forks).toBe(3)
})

test('the warmer does nothing when it is off', async ($, on) => {
  const seen = world(on, () => 'simple')
  await $.session.start(START)
  await mainTurnEnds($, { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 36_000, cache_creation_input_tokens: 3000 })
  await $.command.run({ command: 'cache', args: 'warm off' } as never)
  await seen.clock.advance(3 * 60 * 60_000)
  expect(seen.forks).toBe(0)
})
