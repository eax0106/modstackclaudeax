import { expect, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const

test('tasks the model sets show in the footer and the pane', async ($, on) => {
  // Stand in for the engine beneath the plugin: its own drawing is none, its tools answer.
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text key="engine">engine</Text> })
  const opened: string[] = []
  on('ui.open', (_$, e) => { opened.push(e.id); return { value: { isPlaced: true } } })
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => ({ result: { task: { id: '7', subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))
  on('tool.call', { tool: 'TodoWrite' }, (_$, e) => ({ result: { oldTodos: [], newTodos: e.todos } }))

  for (const surface of SURFACES) {
    const empty = await $.ui.mount({ plugin: 'task-tracker', surface, component: 'SessionMode', props: { modes: [] } })
    expect(await empty.find({ key: 'open-tasks' })).toBeUndefined()
    await empty.unmount()
  }

  await $.tool.call({ tool: 'TodoWrite', todos: [
    { content: 'Write schema', status: 'completed', activeForm: 'Writing schema' },
    { content: 'Add route', status: 'in_progress', activeForm: 'Adding route' },
  ] })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Run tests', description: 'all of them' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'completed' })

  for (const surface of SURFACES) {
    const footer = await $.ui.mount({ plugin: 'task-tracker', surface, component: 'SessionMode', props: { modes: ['focus'] } })
    expect((await footer.find({ key: 'open-tasks' }))?.text).toBe('Tasks 2/3')
    await footer.press({ key: 'open-tasks' })
    expect(opened.at(-1)).toBe('task-tracker')
    await footer.unmount()

    const pane = await $.ui.mount({ plugin: 'task-tracker', surface, component: 'Pane', requestId: 'task-tracker', props: {} as never })
    expect(await pane.find({ type: 'Text', text: /2\/3 done/ })).toBeDefined()
    if (surface === 'desktop') {
      // The desktop draws the board: every task's subject and status are in it.
      const board = JSON.stringify(await pane.find({ type: 'Svg' }))
      for (const text of ['Write schema', 'Add route', 'Run tests', 'IN PROGRESS', '2/3']) expect(board).toContain(text)
    } else {
      expect(await pane.find({ type: 'Text', text: /\[x\] Write schema/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /\[~\] Add route/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /\[x\] Run tests/ })).toBeDefined()
    }
    await pane.unmount()
  }

  // A rewritten todo list replaces the old todos, keeps TaskCreate tasks.
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Ship', status: 'pending', activeForm: 'Shipping' }] })
  const footer = await $.ui.mount({ plugin: 'task-tracker', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  expect((await footer.find({ key: 'open-tasks' }))?.text).toBe('Tasks 1/2')
  await footer.unmount()
})

test('the mod\'s own set_tasks tool fills the footer and pane', async ($, on) => {
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text key="engine">engine</Text> })

  const ran = await $.tool.call({ tool: 'mcp__task-tracker__set_tasks', tasks: [
    { subject: 'Plan', status: 'completed' },
    { subject: 'Build', status: 'in_progress' },
  ] })
  expect(JSON.stringify(ran.result)).toContain('1/2 tasks done')

  const footer = await $.ui.mount({ plugin: 'task-tracker', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  expect((await footer.find({ key: 'open-tasks' }))?.text).toBe('Tasks 1/2')
  await footer.unmount()

  // A second call replaces the list rather than appending.
  await $.tool.call({ tool: 'mcp__task-tracker__set_tasks', tasks: [{ subject: 'Build', status: 'completed' }] })
  const again = await $.ui.mount({ plugin: 'task-tracker', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  expect((await again.find({ key: 'open-tasks' }))?.text).toBe('Tasks 1/1')
  await again.unmount()

  const bad = await $.tool.call({ tool: 'mcp__task-tracker__set_tasks', tasks: [{ subject: 'x', status: 'done' }] })
  expect(JSON.stringify(bad.result)).toContain('"isError":true')
})

test('the footer and the strip keep what is beneath and show the count', async ($, on) => {
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text key="engine">engine</Text> })
  on('ui.open', () => ({ value: { isPlaced: true } }))

  // Nothing to show yet: the strip is left to what is beneath.
  const quiet = await $.ui.mount({ plugin: 'task-tracker', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10 } as never })
  expect(await quiet.find({ key: 'open-tasks-band' })).toBeUndefined()
  await quiet.unmount()

  await $.tool.call({ tool: 'mcp__task-tracker__set_tasks', tasks: [
    { subject: 'Plan', status: 'completed' },
    { subject: 'Build the board', status: 'in_progress' },
    { subject: 'Ship', status: 'pending' },
  ] })

  for (const surface of SURFACES) {
    const footer = await $.ui.mount({ plugin: 'task-tracker', surface, component: 'SessionMode', props: { modes: [] } })
    expect((await footer.find({ key: 'open-tasks' }))?.text).toBe('Tasks 1/3')
    expect(await footer.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
    await footer.unmount()

    const strip = await $.ui.mount({ plugin: 'task-tracker', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10 } as never })
    expect((await strip.find({ key: 'open-tasks-band' }))?.text).toBe('Tasks 1/3')
    expect(await strip.find({ type: 'Text', text: /now: Build the board/ })).toBeDefined()
    expect(await strip.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
    await strip.unmount()
  }

  // A survey holds the strip: the mod steps aside.
  const survey = await $.ui.mount({ plugin: 'task-tracker', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: true, isWorking: false, maxRows: 10 } as never })
  expect(await survey.find({ key: 'open-tasks-band' })).toBeUndefined()
  await survey.unmount()
})

test('an empty pane shows the empty board on desktop', async ($, on) => {
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text key="engine">engine</Text> })
  const pane = await $.ui.mount({ plugin: 'task-tracker', surface: 'desktop', component: 'Pane', requestId: 'task-tracker', props: {} as never })
  expect(JSON.stringify(await pane.find({ type: 'Svg' }))).toContain('No tasks yet')
  await pane.unmount()
})
