![What's Agent Doing: each step of a bug fix, live above the Claude Code prompt](media/hero.gif)

# What's Agent Doing

**See what Claude Code is doing at every step, in plain English, live.**

A box above the prompt names the step Claude is on and how long it has been on it. Click ▸ to see every step it has taken.

## Why

With today's models, Claude goes into deep work: bisects, one-off scripts, long chains of flags. For minutes at a time you see a spinner and commands scrolling past, and you can't easily tell:

- what it is trying to do right now,
- what that command is for,
- whether it's stuck or just slow.

## A bug fix, step by step

> The cart total is wrong when a coupon is applied. Fix it.

To track this down, Claude runs commands you'd have to stop and decode. The box says what each one is for, and how long it has been running:

| Claude runs | The box says |
|---|---|
| `npx tsx -e "import {cartTotal} from './src/cart'; console.log(cartTotal({…coupon:{amount:10},taxRate:0.08}))"` | Reproduce the total with a $10 coupon |
| `git bisect start HEAD v2.3.0 && git bisect run npx vitest run src/cart -t "fixed coupon"` | Find the commit that broke fixed-amount coupons · 1m 48s |
| `git bisect reset && npx vitest run src/cart` | Reset the bisect and rerun the cart tests |

The bisect runs for almost two minutes. The box shows it is bisecting, not stuck.

**Click ▸ for every step and how it went:**

```
╭─────────────────────────────────────────────────────────────╮
│ ▾ ○ Claude: Idle · last turn done in 2m 40s, 5 actions      │
│                                                             │
│ › The cart total is wrong when a coupon is applied. Fix it. │
│ ✓ Reading cart.ts  0.6s                                     │
│ ✓ Reproduce the total with a $10 coupon  2.1s               │
│ ✓ Find the commit that broke fixed-amount coupons  1m 48s   │
│ ✓ Editing cart.ts  0.6s                                     │
│ ✓ Reset the bisect and rerun the cart tests  7.4s           │
│ ✎ Wrote the reply (47 words)  5.8s                          │
│ ✓ Done in 2m 40s, 5 actions  2m 40s                         │
╰─────────────────────────────────────────────────────────────╯
```

| You wonder | Without | With the box |
|---|---|---|
| Is it stuck? | A spinner and a long command line | The step in plain English, and how long it has been on it |
| What is that command for? | Decode the flags yourself | The command's own description: `Find the commit that broke fixed-amount coupons` |
| What happened while I was away? | Scroll back and piece it together | ▸ history with ✓ done, ✗ failed, ⊘ denied, ■ interrupted, and durations |

**Background agents get a row each**, and keep it after your turn ends, while they're still working:

```
╭───────────────────────────────────────────────────────────────────╮
│ ▸ ● Claude: 2 agents working · 34s                                │
│ ◆ Find callers of applyCoupon › Searching for "applyCoupon("  34s │
│ ◆ Check the coupon tests › Reading coupon.test.ts  33s            │
╰───────────────────────────────────────────────────────────────────╯
```

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

**Requirements:** Claude Code in a terminal, or in the desktop app's Code tab. The plugin is a [mod](https://github.com/anthropics/claude-code/blob/main/mods/README.md), written with Claude Code's function hooks, which are early access: they load only where function hooks are enabled, and their API may change between releases. The box is drawn in the band above the prompt; hooks are not loaded in Claude chat or Cowork.

## What it shows

| State | Example |
|-------|---------|
| Reading the prompt | `Reading your prompt` |
| Thinking: the thought's latest sentence where the model streams it, else the last action with the dot turned magenta | `Thinking: …the hook needs to await next` |
| Writing a tool call, once its input says what it does (a file's path, a command's description) | `Writing register.tsx · 2.3 KB` |
| Running a tool | `Reading app.ts`, `Find the commit that broke fixed-amount coupons` (a command's own description), `Fetching github.com` |
| A subagent at work | `Running an agent: find the bug › Reading app.ts` |
| Background agents, during a turn or after it | `3 agents working`, with a row per agent: `◆ Draft the plan › Searching the web  1m 12s` |
| Waiting on you | `Waiting for your approval: Reset the bisect and rerun the cart tests`, `Waiting for your answer` |
| Reading tool results | `Reviewing the results of 3 actions` |
| Writing the reply | `Writing the reply · 120 words` |
| Compacting | `Compacting the conversation` |
| Between turns | `Idle · last turn done in 42s, 6 actions` (or interrupted, stopped on an error, declined) |

Parallel calls show the newest with `(+N more)`, and a timer counts how long the current state has lasted.

Click the triangle (or focus the band with `ctrl+x tab` and press Enter) to expand the history: each prompt, stretch of thinking, tool call (✓ done, ✗ failed, ⊘ denied, ■ interrupted), reply and turn ending, with durations. The box steps aside while a survey holds the band; collapse the whole band with `ctrl+x ctrl+a`. Other mods that draw above the prompt keep their place: their boxes stack under this one.

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
| `tests/register.test.tsx` | Idle, a whole turn state by state, the history toggle, thinking and commands without repeats, hostile labels, an approval wait, background agents after the turn, another mod's band kept beneath |
| `.claude-plugin/marketplace.json` | Makes this repository its own one-plugin marketplace |
| `.claude-plugin/icon.png` | The listing icon: the box and its status dot above the prompt |

## License

MIT
