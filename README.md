# Office + Model Routing mod for Claude Code

A Claude Code mod (a plugin of function hooks) with four jobs:

1. **Model routing.** Before each prompt you type, Haiku rates how hard it is and picks the model: simple → Haiku 4.5, moderate → Sonnet 5.5, complex → Opus 5.5.
2. **Effort is always yours.** Your first prompt is held until you pick an effort level in a small dialog. The dialog recommends one (Haiku → low, Sonnet → medium, Opus → high), and nothing runs until you click. Follow-up prompts then keep that effort and the model the first prompt went to, with no dialog. To change either, use the **Model** and **Effort** dropdowns above the prompt box before you send.

3. **The model tracks its own tasks.** When it plans work of 3 or more steps, the model records the list with the mod's `set_tasks` tool (it sees it as `mcp__office-router__set_tasks`), and updates it as each task starts and finishes. The main session and every subagent keep their own list. Sessions with Claude Code's built-in `TodoWrite`, `TaskCreate` or `TaskUpdate` tools are tracked too.

4. **Big requests become a plan you approve.** When a request has clearly separate parts of different difficulty (a master prompt, a multi-part build), the model proposes a plan with the mod's `propose_plan` tool. Each task gets its own agent, a model (Haiku, Sonnet or Opus) and an effort level, and can wait for other tasks to finish first. An **Approve plan** window lists every task, with a Model and an Effort dropdown and a Drop button on each. Choose **Approve**, **Run as one agent** or **Cancel**. Nothing starts until you approve. The main session then starts the agents by their plan names, the mod gives each one the model and effort you approved, and the main session combines their results into one answer. Smaller requests are not split.

All of it lives in one **Office**: a live, animated map of your session and its subagents.

- Workers walk in through a door and follow the office's aisles and corridors to their desks. Idle workers stroll to the coffee, the router, the archive shelf and back.
- Working agents type at glowing desks while beams carry data to them from the router core in the middle, which shows the model the last prompt went to.
- Each worker's name tag carries a small ring that fills as its tasks get done, for example `2/4`.
- Click a worker's name to see what it is doing, **its task list** (✓ done, ◐ in progress, ○ pending), and to **talk to it**. A message to a subagent goes straight to that agent and resumes it if it had finished. A message to the main session is routed and waits for your effort click, like a typed prompt.

Built for the **Claude Code desktop app** (Code tab). It also runs in the terminal, where the office is drawn as a list instead of a map.

## Requirements

- Claude Code with function-hook mods (tested on 2.1.284 CLI and 2.1.288 desktop). The mod API is early access and may change between releases.
- Access to Haiku, Sonnet and Opus on your account.

## Install

1. Clone the repo somewhere permanent:

   ```bash
   git clone https://github.com/eax0106/office-model-routing-mod- ~/.claude/mods/office-router
   ```

2. Tell Claude Code to load it in every session. Add this `env` block to `~/.claude/settings.json`, or merge it into an `env` block you already have. Replace the path with your own absolute path, because `~` must expand to your home folder:

   ```json
   {
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "/Users/<you>/.claude/mods/office-router",
       "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
     }
   }
   ```

   If `CLAUDE_CODE_PLUGIN_DIRS` already lists other folders, add this one after a `:`.
   `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` makes desktop sessions reload the mod when its files change, which helps when you pull an update.

3. Start a **new** session and send a first message. Sessions that were already open load the mod only after a restart, and the new-session welcome screen shows nothing until the first message starts the session.

To try it in a single terminal session without changing settings:

```bash
claude --plugin-dir ~/.claude/mods/office-router
```

## Use

| What | How |
| --- | --- |
| Open the office | the **Open office** button above the prompt box, the **Office** label in the footer, or `/office` |
| See the tasks | `/tasks` opens the office on the main session's task list; the strip above the prompt shows `tasks 2/4 · now: <task>`; click any worker for its own list |
| Talk to an agent | click its name under the map, type in the box at the bottom of its card, press **Send** |
| Pick the effort for a prompt | the first time, click a level in the **Choose effort** dialog, or press 1–6 (6 keeps your current effort); after that, the **Effort** dropdown above the prompt box (**ask me** brings the dialog back) |
| Change the model for the next prompt | the **Model** dropdown above the prompt box (**auto-route** re-routes every prompt) |
| Approve a plan | change any task's Model or Effort, Drop tasks you don't want, then **Approve**, **Run as one agent** or **Cancel** |
| Change a subagent's model or effort | the Model and Effort dropdowns in its card |
| See what a worker used | its card shows the tokens its turns used |
| Cancel a held prompt | Esc in the dialog: nothing is sent and your text goes back into the prompt box |
| Turn routing off for this session | `/route off` (prompts go straight through, no dialog) |
| Pin a model | `/route haiku`, `/route sonnet`, `/route opus` |
| Back to automatic | `/route auto` |
| See the last decision | `/route` |

Routing starts in `auto` in every new session. `/route off` lasts only for the session you type it in.

## What it does and does not do

- Effort changes only when you click it, in the dialog, the dropdowns or the plan window. Tests check this.
- Subagents keep the model and effort they were started with, unless you pick otherwise in their card or in an approved plan.
- A plan only saves usage when big parts run on smaller models. Each agent re-reads the files it needs, and the main session spends tokens planning and combining. Check each worker's token count in the office to see whether a plan paid off.
- If the rating is unclear or the classifier fails, your current model is kept. You are still asked for effort.
- Slash commands and messages you did not type (background task notices, for example) go straight through.
- Each prompt costs one small Haiku call for the rating and adds about a second before the reply starts.
- Switching models between turns discards the prompt cache, so long conversations can cost more. Use `/route off` when that matters.
- Tasks the model set before the mod loaded do not appear, `/clear` keeps the old tasks, and the model records tasks only when the tool's description persuades it to (work of 3 or more steps).
- The office shows this session and its subagents only, so you can talk only to this session's agents. Other sessions are not visible to a mod yet.
- The mobile app draws no text field yet, so there you can read a worker's conversation but not reply.
- The desktop redraws the office whenever something changes, so the ambient animations restart on each change. A walk that is cut short by a change shows the worker at its destination.
- The mod forgets where workers stood when it reloads, so the next drawing walks everyone in from the door again.

## Develop

```bash
claude plugin validate ~/.claude/mods/office-router
claude plugin test ~/.claude/mods/office-router
```

The tests cover routing to each model, the held prompt and the effort dialog, the rule that effort never changes without a click, `/route` pinning and off, subagents being left alone, messages to a subagent and to the main session, tasks in a worker's card, on the roster, on the map and in the strip, follow-ups keeping their effort and model, the dropdowns, a plan waiting for approval and running with the approved models and efforts, and token counts, and the button, pane and map drawing on both the terminal and the desktop.

| File | What it holds |
| --- | --- |
| `.claude-plugin/plugin.json` | the manifest |
| `hooks/hooks.json` | names the hooks module |
| `hooks/register.tsx` | the hooks: routing, the effort dialog and dropdowns, the `propose_plan` and `set_tasks` tools, todo tracking, the office state, the buttons and panes |
| `hooks/office-map.js` | the animated office map: lanes, walking and roaming (SVG with SMIL animation, in the ALTERX design language) |
| `types/index.d.ts` | the mod's state contract |
| `tests/office.test.tsx` | the test suite |

`.claude-plugin/types/` is written by Claude Code each time it loads the mod, and is ignored by git.
