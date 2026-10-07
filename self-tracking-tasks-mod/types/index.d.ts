export type TaskStatus = 'pending' | 'in_progress' | 'completed'
export type Task = { id: string; subject: string; status: TaskStatus; owner: string }

declare module 'claude-code' {
  interface PluginState {
    'task-tracker': { tasks: Task[] }
  }
}
