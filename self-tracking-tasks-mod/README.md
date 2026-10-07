# Self-tracking tasks mod for Claude Code

A Claude Code mod that keeps the model's own task list in one place. When the model plans work of 3 or more steps, it records the list, and you can follow it live. This works for the main session and for every subagent it starts.

Built for the **Claude Code desktop app** (Code tab), in the same ALTERX design language as the office mod. It also runs in the terminal, where the board is drawn as a plain list.

## What you get

- **A Tasks button** showing done out of total, for example `Tasks 2/5`. It appears in the strip above the prompt box, next to the task in progress, and in the footer. It hides while there are no tasks.
- **A Tasks board** (the button or `/tasks`):
  - a header with a progress bar and a ring showing done out of total
  - a glass card per task, grouped by main session and by agent
  - in-progress cards with a spinning ring and a light sweep, done cards with a tick that draws itself in and a line through the text, pending cards with a dashed circle
- **A tool for the model**, `set_tasks`, which the model sees as `mcp__task-tracker__set_tasks`. The model sends its whole list each time, and each call replaces that agent's previous list. Desktop sessions have no built-in todo tool, so without this the board would stay empty.

If the session also has Claude Code's built-in `TodoWrite`, `TaskCreate` or `TaskUpdate` tools, their tasks show on the board too.

## Install

1. Clone the repo somewhere permanent, if you have not already for the office mod:

   ```bash
   git clone https://github.com/eax0106/office-model-routing-mod- ~/.claude/mods/office-router
   ```

2. Add this folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`. Use absolute paths and separate folders with `:`. With both mods it looks like this:

   ```json
   {
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "/Users/<you>/.claude/mods/office-router:/Users/<you>/.claude/mods/office-router/self-tracking-tasks-mod",
       "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
     }
   }
   ```

3. Start a new session and send a first message. Sessions that were already open load the mod only after a restart.

To try it in one terminal session without changing settings:

```bash
claude --plugin-dir ~/.claude/mods/office-router/self-tracking-tasks-mod
```

## Limits

- Tasks the model set before the mod loaded do not appear.
- `/clear` keeps the old tasks.
- The model records tasks only when the tool's description persuades it to, which it aims at work of 3 or more steps.
- The board and its buttons share the footer and the strip with other mods, such as the office mod, instead of replacing them.

## Develop

Run the checks on this folder:

```bash
claude plugin validate ~/.claude/mods/office-router/self-tracking-tasks-mod
claude plugin test ~/.claude/mods/office-router/self-tracking-tasks-mod
```

`claude plugin test` runs every test file under the folder it is given, so running it at the repo root also picks up this folder's tests and they fail there. Run each mod's tests on its own folder.

| File | What it holds |
| --- | --- |
| `.claude-plugin/plugin.json` | the manifest |
| `hooks/register.tsx` | the hooks: the `set_tasks` tool, built-in todo tracking, the buttons and the pane |
| `hooks/tasks-board.js` | the animated task board (SVG with SMIL animation, in the ALTERX design language) |
| `types/index.d.ts` | the mod's state contract |
| `tests/tasks.test.tsx` | the test suite |
