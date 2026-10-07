import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Task } from '../types'

import { tasksBoard } from './tasks-board.js'

const PANE = 'task-tracker'
const TITLE = 'Tasks'
// Ask for as much room as the app will give; it caps both at what the layout spares.
const OPEN = { id: PANE, title: TITLE, rows: 200, columns: 400 }
const tasks = atom({ plugin: 'task-tracker', key: 'tasks' } as const, [])

const MARK = { pending: '[ ]', in_progress: '[~]', completed: '[x]' } as const

const OWN_TOOL = 'mcp__task-tracker__set_tasks'
const STATUSES: readonly string[] = ['pending', 'in_progress', 'completed']

// Replace one agent's tasks under an id prefix, keeping everyone else's.
const replaceOwned = (list: readonly Task[], prefix: string, next: Task[]) => [
  ...list.filter(t => !t.id.startsWith(prefix)),
  ...next,
]

const counts = (list: readonly Task[]) =>
  `${list.filter(t => t.status === 'completed').length}/${list.length}`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tasks',
      description: 'Show every task the model set in this session',
    })

    await $.tool.register({
      name: 'set_tasks',
      description:
        'Record your task list so the person can follow it in the Tasks pane. Use it for any work ' +
        'with 3 or more steps: call it with the full list before starting, then again with the whole ' +
        'updated list each time a task starts or finishes, keeping exactly one task in_progress. ' +
        'Each call replaces the previous list.',
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

    return next(e)
  })

  // The mod's own tool: the model sends its whole list, it replaces that agent's tasks.
  on('tool.call', { tool: OWN_TOOL }, async ($, e) => {
    const raw = (e as { tasks?: unknown }).tasks
    const isValid =
      Array.isArray(raw) &&
      raw.every(
        (t): t is { subject: string; status: Task['status'] } =>
          typeof t?.subject === 'string' && STATUSES.includes(t?.status),
      )
    if (!isValid) {
      return {
        result: {
          content: [{ type: 'text', text: 'tasks must be an array of { subject, status }.' }],
          isError: true,
        },
      }
    }

    const owner = e.agentId ?? 'main'
    const prefix = `own:${owner}:`
    const mine: Task[] = raw.map((t, i) => ({ id: `${prefix}${i}`, subject: t.subject, status: t.status, owner }))
    const list = await update($, tasks, all => replaceOwned(all, prefix, mine))

    return { result: { content: [{ type: 'text', text: `Recorded. ${counts(list)} tasks done.` }] } }
  })

  on('command.run', { command: 'tasks' }, async $ => {
    await $.ui.open(OPEN)

    return { text: 'Tasks pane opened.' }
  })

  // TodoWrite sends the whole list each time: replace that agent's todos.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran

    const owner = e.agentId ?? 'main'
    const todos: Task[] = e.todos.map((t, i) => ({
      id: `todo:${owner}:${i}`,
      subject: t.content,
      status: t.status,
      owner,
    }))
    await update($, tasks, list => replaceOwned(list, `todo:${owner}:`, todos))

    return ran
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran

    const task: Task = {
      id: `task:${ran.result.task.id}`,
      subject: e.subject,
      status: 'pending',
      owner: e.agentId ?? 'main',
    }
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
        : list.map(t =>
            t.id === id
              ? { ...t, subject: e.subject ?? t.subject, status: status ?? t.status }
              : t,
          ),
    )

    return ran
  })

  // Footer: a clickable count after whatever is beneath (the engine's labels,
  // another mod's buttons). Hidden while there are no tasks.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const list = await read($, tasks)
    if (list.length === 0) return next(e)

    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" gap={1}>
        {below}
        <Button key="open-tasks" label={`Tasks ${counts(list)}`} plain onPress={() => void $.ui.open(OPEN)} />
      </Box>
    )
  })

  // The same count in the strip above the prompt, which the desktop reliably draws.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, tasks)
    if (e.props.hasSurvey || list.length === 0) return next(e)

    const below = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const doing = list.find(t => t.status === 'in_progress')

    return (
      <Box flexDirection="row" gap={2}>
        {below}
        <Box flexDirection="row" gap={1}>
          <Button key="open-tasks-band" label={`Tasks ${counts(list)}`} onPress={() => void $.ui.open(OPEN)} />
          {doing && <Text dimColor wrap="truncate-end">now: {doing.subject}</Text>}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, tasks)

    if (e.surface === 'desktop') {
      const { Box, Svg, Text } = $.ui.resolve(e)
      // About 7 px per column, as the office pane sizes its map.
      const columns = Number.isFinite(e.props.bodyColumns) ? e.props.bodyColumns : 100
      const board = tasksBoard(list, Math.min(2400, Math.max(560, Math.round(columns * 7))))
      return (
        <Box flexDirection="column">
          <Svg
            key="board"
            source={board.svg}
            width={board.width}
            height={board.height}
            alt={list.length === 0 ? 'No tasks set yet.' : `${counts(list)} tasks done`}
            isInteractive
          />
          <Text dimColor>{list.length === 0 ? 'No tasks set yet.' : `${counts(list)} done`}</Text>
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    const owners = [...new Set(list.map(t => t.owner))]

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No tasks set yet.</Text>}
        {list.length > 0 && <Text bold>{counts(list)} done</Text>}
        {owners.map(owner => (
          <Box flexDirection="column" key={owner}>
            {owners.length > 1 && (
              <Text dimColor>{owner === 'main' ? 'Main session' : `Agent ${owner}`}</Text>
            )}
            {list
              .filter(t => t.owner === owner)
              .map(t => (
                <Text key={t.id} dimColor={t.status === 'completed'} bold={t.status === 'in_progress'}>
                  {MARK[t.status]} {t.subject}
                </Text>
              ))}
          </Box>
        ))}
      </Box>
    )
  })
}
