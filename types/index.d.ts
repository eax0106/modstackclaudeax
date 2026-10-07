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
    }
  }
}
