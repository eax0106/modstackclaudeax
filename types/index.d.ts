export type Tier = 'haiku' | 'sonnet' | 'opus'

// 'auto' classifies every prompt, 'off' leaves the session's model alone,
// a tier pins every prompt to that model.
export type RouteMode = 'auto' | 'off' | Tier

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type Route = {
  turnId: string
  tier: Tier | null
  why: 'classified' | 'pinned' | 'unsure' | 'failed'
  // The effort the person clicked; null keeps the session's own.
  effort: Effort | null
  prompt: string
  at: number
}

// What the person picked for one subagent in its card; null keeps what it was started with.
export type AgentPick = { model: Tier | null; effort: Effort | null }

// One task of a plan the model proposed for a big request.
export type PlanTask = {
  n: number
  title: string
  instructions: string
  why: string
  model: Tier
  effort: Effort
  // Task numbers that must finish first.
  after: number[]
  // False once the person drops it from the plan.
  keep: boolean
}

export type Plan = {
  id: string
  summary: string
  status: 'proposed' | 'approved' | 'cancelled'
  tasks: PlanTask[]
}

// The main session's prompt-cache record and its warmer.
export type CacheState = {
  // On by default; the person's toggle turns it off.
  warm: boolean
  // Seconds the cache lives: 3600 (Claude Code's 1-hour cache) or 300.
  ttl: number
  // When the cache was last written or read: a main turn's end or a warm ping.
  lastAt: number | null
  // Pings since the person last sent anything; capped.
  pings: number
  warmRead: number
  pingLog: { at: number; read: number; ok: boolean }[]
  // Input tokens over the main session's turns: read from the cache, written to it, sent fresh.
  totals: { read: number; written: number; fresh: number }
  // What the context is made of, from the last turn's usage breakdown.
  blocks: { system: number; project: number; conversation: number } | null
}

// A typed prompt held until the person picks its effort.
export type Pending = {
  text: string
  attachments: readonly unknown[]
  tier: Tier | null
  why: Route['why']
  recommended: Effort
  // Set by the person's click; 'keep' keeps the session's effort.
  choice: Effort | 'keep' | null
  at: number
}

export type WorkerStatus = 'working' | 'idle' | 'done' | 'error'

// A task the model set for itself; `owner` is the worker's id ('main' or an agent id).
export type TaskStatus = 'pending' | 'in_progress' | 'completed'
export type Task = { id: string; subject: string; status: TaskStatus; owner: string }

// One line of the conversation shown in a worker's card.
export type ChatLine = { from: 'you' | 'agent' | 'note'; text: string; at: number }

export type Worker = {
  id: string
  name: string
  kind: 'session' | 'subagent'
  type: string
  status: WorkerStatus
  task: string
  model: string | null
  lastTool: string | null
  tools: number
  // Absent on workers recorded before the chat existed.
  chat?: ChatLine[]
  // Tokens its turns used (input, output and cache); absent until a turn ends.
  tokens?: number
  startedAt: number
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'office-router': {
      mode: RouteMode
      current: Route | null
      routes: Route[]
      pending: Pending | null
      workers: Worker[]
      selected: string
      tasks: Task[]
      // The main session's effort once the person picked it: null asks again,
      // 'session' keeps the session's own.
      mainEffort: Effort | 'session' | null
      agentPicks: Record<string, AgentPick>
      plan: Plan | null
      cache: CacheState
    }
  }
}
