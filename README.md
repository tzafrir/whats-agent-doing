# What's Agent Doing

A Claude Code plugin that adds a little box above the prompt that always says what Claude is doing right now, and expands to show what it has done.

```
╭────────────────────────────────────────────────────────────────╮
│ ▸ ● Claude: Editing register.tsx · 4.2s                        │
╰────────────────────────────────────────────────────────────────╯
```

## Install

In Claude Code:

```
/plugin marketplace add tzafrir/whats-agent-doing
/plugin install whats-agent-doing@tzafrir
```

Or from your shell:

```
claude plugin marketplace add tzafrir/whats-agent-doing
claude plugin install whats-agent-doing@tzafrir
```

Then start a new session (or run `/reload-plugins`). Update later with `claude plugin marketplace update tzafrir`.

**Requirements:** Claude Code in a terminal. The plugin is a [mod](https://github.com/anthropics/claude-code/blob/main/mods/README.md), written with Claude Code's function hooks, which are early access: they load only where function hooks are enabled, and their API may change between releases. The box is drawn in the band above the prompt, which only the terminal has; hooks are not loaded in Claude chat or Cowork.

## What it shows

| State | Example |
|-------|---------|
| Reading the prompt | `Reading your prompt` |
| Thinking: the thought's latest sentence where the model streams it, else the last action with the dot turned magenta | `Thinking: …the hook needs to await next` |
| Writing a tool call, once its input says what it does (a file's path, a command's description) | `Writing register.tsx · 2.3 KB` |
| Running a tool | `Reading app.ts`, `Run the tests`, `Fetching github.com` |
| A subagent at work | `Running an agent: find the bug › Reading app.ts` |
| Waiting on you | `Waiting for your approval: Run the tests`, `Waiting for your answer` |
| Reading tool results | `Reviewing the results of 3 actions` |
| Writing the reply | `Writing the reply · 120 words` |
| Compacting | `Compacting the conversation` |
| Between turns | `Idle · last turn done in 42s, 6 actions` (or interrupted, stopped on an error, declined) |

Parallel calls show the newest with `(+N more)`, and a timer counts how long the current state has lasted.

Click the triangle (or focus the band with `ctrl+x tab` and press Enter) to expand the history: each prompt, stretch of thinking, tool call (✓ done, ✗ failed, ⊘ denied, ■ interrupted), reply and turn ending, with durations. The box steps aside while a survey holds the band; collapse the whole band with `ctrl+x ctrl+a`.

## Data and privacy

- **Stays in the session.** The plugin keeps its headline and history in the session's own state (`$.state`) and nothing else: no files, no network, no processes, no storage across sessions. `claude plugin validate` lists every call it makes: `$.clock`, `$.state` and `$.ui`.
- **Never changes what Claude does.** Every hook passes its event on unchanged: tool calls, permission requests and the model's stream run exactly as they would without it.
- **Shows what Claude is working on.** The box and its history display your prompts, file paths, URLs, the descriptions of commands (or the command itself when it has none), MCP tool names and, where the model streams it, a line of its thinking. Anyone who can see your screen, or a screen share, can read them. Labels are cleaned of control and invisible characters before they are drawn.

## Support

Report a problem or ask for a feature in [GitHub Issues](https://github.com/tzafrir/whats-agent-doing/issues).

## Develop

Load the plugin from a clone; the session reloads it as you edit:

```
git clone https://github.com/tzafrir/whats-agent-doing
claude --plugin-dir whats-agent-doing
```

```
claude plugin validate .
claude plugin test .
```

Loading the plugin writes the API's types to `.claude-plugin/types/`, which `tsconfig.json` extends; then `npx -p typescript tsc -p .` typechecks it.

| File | What it does |
|------|--------------|
| `hooks/register.tsx` | The hooks: the model's stream (`turn.step`), tools (`tool.call`), approvals (`classic.PermissionRequest`), subagents, compaction, turns, and the box's drawing (`ui.render` on `AbovePrompt`) |
| `hooks/activity-of.ts` | Turns a tool call, whole or still streaming, into its short label |
| `hooks/text.ts` | Printable labels, thought snippets, word counts, sizes, durations |
| `types/index.d.ts` | The `$.state` contract: the headline, the history, the toggle |
| `tests/register.test.tsx` | Idle, a whole turn state by state, the history toggle, thinking and commands without repeats, hostile labels, an approval wait |
| `.claude-plugin/marketplace.json` | Makes this repository its own one-plugin marketplace |

## License

MIT
