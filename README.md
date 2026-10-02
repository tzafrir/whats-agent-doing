<!-- HERO GIF: replace this line with ![Three agents working, live above the Claude Code prompt](media/hero.gif) -->

# What's Agent Doing

**See what Claude Code is doing, in plain English, live. Even when three agents are working at once.**

A box above the prompt names the current step and how long it has been on it. Each background agent gets a row of its own. Click ▸ to see everything that has already happened.

## The run that planned this launch

To plan this plugin's launch, I had Claude start a three-person marketing panel, a CMO, a marketing manager and a motion designer, as three background agents working in parallel.

The turn ended within seconds and the prompt came back. Without the box, that's all you see: nothing tells you the three are still going, what each one is doing, or whether one has stalled.

With the box, this is what my terminal showed 21 seconds in (agent names as v0.4.1 shows them):

<!-- REAL CAPTURE: ![The box during that run: 3 agents working, a row each](media/three-agents.png) -->

```
╭──────────────────────────────────────────────────────────────────────────────────────╮
│ ▸ ● Claude: 3 agents working · 21s                                                   │
│ ◆ CMO: today-only launch strategy › Searching the web for "Claude mods launch …  21s │
│ ◆ Motion designer: visuals buildable today › Read duration format, agent finis…  20s │
│ ◆ Agentic MM: README rewrite and copy › Read README and helper sources  20s          │
╰──────────────────────────────────────────────────────────────────────────────────────╯
```

Each row gives an agent's task, its current step and how long it has been running. A web search appears as its query. A shell command appears as its own description ("Read README and helper sources"), not as raw bash. The border stays cyan for as long as any agent is still working.

**Click ▸ to see what has happened so far.** The history lists every prompt, thought, tool call and reply, each with how long it took. A background agent is added to it when it finishes:

```
╭─────────────────────────────────────────────────────────────────────────────╮
│ ▾ ● Claude: 2 agents working · 6m 48s                                       │
│ ◆ Motion designer: visuals buildable today › Reading register.tsx  6m 47s   │
│ ◆ Agentic MM: README rewrite and copy › Writing today-agentic-mm.md  6m 47s │
│                                                                             │
│ › Run the marketing panel again. Every action happens today.                │
│ ∴ Thought (96 words)  4.2s                                                  │
│ ✓ Running an agent: CMO: today-only launch strategy  0.3s                   │
│ ✓ Running an agent: Motion designer: visuals buildable today  0.3s          │
│ ✓ Running an agent: Agentic MM: README rewrite and copy  0.2s               │
│ ✎ Wrote the reply (31 words)  1.9s                                          │
│ ✓ Done in 9.4s, 3 actions  9.4s                                             │
│ ✓ Agent: CMO: today-only launch strategy  6m 12s                            │
╰─────────────────────────────────────────────────────────────────────────────╯
```

**When Claude needs you, the box turns yellow**, and the timer shows how long it has been waiting:

```
╭────────────────────────────────────────────────────────────╮
│ ▸ ● Claude: Waiting for your approval: Run the tests · 41s │
╰────────────────────────────────────────────────────────────╯
```

| You wonder | Without | With the box |
|---|---|---|
| Is it stuck? | A spinner | The current step, and how long it has been on it |
| What are the agents doing? | Out of view once the turn ends | One `◆` row per agent, updated live |
| Is it waiting for me? | A dialog you see only if you're looking | A yellow box: `Waiting for your approval: Run the tests` |
| What just ran? | Raw bash in the scrollback | `Read README and helper sources` |
| What happened while I was away? | Scroll back and piece it together | ▸ history with ✓ done, ✗ failed, ⊘ denied, ■ interrupted, and durations |

When nothing is running, the box shows how the last turn ended, e.g. `○ Claude: Idle · last turn done in 9.4s, 3 actions`.

The plugin is free and MIT-licensed. It only displays: no network, no files, no telemetry. It is one of the first [mods](https://github.com/anthropics/claude-code/blob/main/mods/README.md), built on Claude Code's new function hooks.

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
| Background agents, during a turn or after it | `3 agents working`, with a row per agent: `◆ Draft the plan › Searching the web  1m 12s` |
| Waiting on you | `Waiting for your approval: Run the tests`, `Waiting for your answer` |
| Reading tool results | `Reviewing the results of 3 actions` |
| Writing the reply | `Writing the reply · 120 words` |
| Compacting | `Compacting the conversation` |
| Between turns | `Idle · last turn done in 42s, 6 actions` (or interrupted, stopped on an error, declined) |

Parallel calls show the newest with `(+N more)`, and a timer counts how long the current state has lasted.

Click the triangle (or focus the band with `ctrl+x tab` and press Enter) to expand the history: each prompt, stretch of thinking, tool call (✓ done, ✗ failed, ⊘ denied, ■ interrupted), reply and turn ending, with durations. The box steps aside while a survey holds the band; collapse the whole band with `ctrl+x ctrl+a`.

## Data and privacy

- **Stays in the session.** The plugin keeps its headline and history in the session's own state (`$.state`) and nothing else: no files, no network, no processes, no storage across sessions. `claude plugin validate` lists every call it makes: `$.clock`, `$.state` and `$.ui`.
- **Only displays, never changes what Claude does.** Every hook is display only and changes nothing: `session.start`, `turn.start`, `turn.step` (the model's stream), `tool.call`, `classic.PermissionRequest`, `classic.SubagentStop`, `classic.PreCompact`, `classic.PostCompact` and `turn.complete` each read their event and pass it on as it came. Settings, instructions, tool descriptions, other hooks' results, tool calls and their results, and the model's stream all reach Claude exactly as they would without the plugin.
- **Only displays permission prompts, never answers them.** The plugin hooks `classic.PermissionRequest`, which runs each time a tool call, Claude's or a subagent's, needs your approval. The hook is display only and decides nothing: it never allows, denies or changes the request, adds no permission rules, and passes the request on as it came. Its one job is to show `Waiting for your approval: <tool>` in the box until you answer.
- **Shows what Claude is working on.** The box and its history display your prompts, file paths, URLs, the descriptions of commands (or the command itself when it has none), MCP tool names and, where the model streams it, a line of its thinking. Anyone who can see your screen, or a screen share, can read them. Labels are cleaned of control and invisible characters before they are drawn.

Read the full [privacy policy](https://tzafrir.github.io/whats-agent-doing/privacy).

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
| `hooks/register.tsx` | The hooks: the model's stream (`turn.step`), tools (`tool.call`), approvals (`classic.PermissionRequest`), subagents (`agent.spawn`, their calls and stops), compaction, turns, and the box's drawing (`ui.render` on `AbovePrompt`) |
| `hooks/activity-of.ts` | Turns a tool call, whole or still streaming, into its short label |
| `hooks/text.ts` | Printable labels, thought snippets, word counts, sizes, durations |
| `types/index.d.ts` | The `$.state` contract: the headline, the agents at work, the history, the toggle |
| `tests/register.test.tsx` | Idle, a whole turn state by state, the history toggle, thinking and commands without repeats, hostile labels, an approval wait, background agents after the turn |
| `.claude-plugin/marketplace.json` | Makes this repository its own one-plugin marketplace |
| `.claude-plugin/icon.png` | The listing icon: the box and its status dot above the prompt |

## License

MIT
